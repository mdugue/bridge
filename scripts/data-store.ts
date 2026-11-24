/**
 * The store the baked sites are published to, so that the web build bakes
 * nothing (plan 088, ADR 0037): CI bakes every site and runs this file,
 * which uploads public/data/<site>/ (`publishSite`); the web build pulls
 * it back (`pullSite`, `prepare-sites.ts --pull`). Both find a site's
 * manifest under its **site key** (`siteKey`), which either computes from
 * its checkout alone: no lock file, nothing to commit.
 *
 * In the store a file keeps its content-hashed name (`<site>/<name>`: the
 * same name is the same bytes, uploaded once); the two a site serves
 * unhashed carry the key (`<site>/manifest.<key>.json`), the manifest last,
 * so a manifest that is there names only files that are.
 *
 * The store is read without a credential; only an upload needs
 * `BLOB_READ_WRITE_TOKEN` (Vercel Blob; a secret of CI's, never the
 * repository's). `DATA_STORE` and `DATA_STORE_API` point reads and uploads
 * elsewhere for a test.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SITE_STATS_FILE } from "../lib/city/site-stats";
import { MANIFEST_FILE } from "../lib/city/tile";
import type { DataManifest } from "../lib/city/tile";
import {
  contentKey,
  createContentHasher,
  lockedVersions,
  moduleGraph,
  packageImports,
  readLockfile,
} from "./bake-sources";
import { hashedName, writeWhole } from "./publisher";

/** The store's public address (Vercel Blob). */
const STORE = "https://w2dgtpmysbifmv6s.public.blob.vercel-storage.com";
const UNHASHED = new Set([MANIFEST_FILE, SITE_STATS_FILE]);
/** How long a pull waits for CI to publish a key, and how often it asks. */
const PATIENCE_MS = 15 * 60_000;
const ASK_MS = 10_000;
/** Requests side by side, and how often one is tried. */
const LANES = 12;
const TRIES = 3;

/**
 * What a site's published bytes are made from, as one key: every file of
 * data/<site>/, every module prepare-data.ts reaches (other sites' configs
 * among them: coarse on purpose, a miss only costs a bake from CI's warm
 * cache), the locked versions of the packages they import, the patches,
 * and the Bun the repository pins, whose gzip writes the bytes (not the
 * running one: the host's differs and bakes nothing). Paths relative to `root`, so every checkout agrees.
 */
export function siteKey(site: string, root = process.cwd()): string {
  const under = (dir: string) =>
    readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(root, path.join(entry.parentPath, entry.name))
      );
  const modules = moduleGraph("scripts/prepare-data.ts", root);
  const packages = new Set(
    modules.flatMap((file) => packageImports(path.join(root, file)))
  );
  const hashOf = createContentHasher();
  return contentKey(
    (file) => hashOf(path.join(root, file)),
    [...modules, ...under(`data/${site}`), ...under("patches")].toSorted(),
    [
      lockedVersions(
        readLockfile(readFileSync(path.join(root, "bun.lock"), "utf-8")),
        [...packages].toSorted()
      ),
      (
        JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
          packageManager?: string;
        }
      ).packageManager,
    ]
  );
}

/** A site's file as the store names it. */
const stored = (site: string, name: string, key: string) =>
  UNHASHED.has(name)
    ? `${site}/${name.replace(/\.json$/u, `.${key}.json`)}`
    : `${site}/${name}`;

/** `fetch`, tried again after a pause where the network or the server
 *  (5xx) failed: one blip among a site's files is no failed deployment. */
async function request(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status < 500 || attempt === TRIES) {
        return res;
      }
    } catch (error) {
      if (attempt === TRIES) {
        throw error;
      }
    }
    await Bun.sleep(2000 * attempt);
  }
}

/** The store's answer for `file`: a missing one is a 404, anything else
 *  but success fails the run. */
async function ask(file: string, method = "GET"): Promise<Response | null> {
  const res = await request(`${process.env.DATA_STORE ?? STORE}/${file}`, {
    method,
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`data store: ${method} ${file} answered ${res.status}`);
  }
  return res;
}

async function read(file: string): Promise<Uint8Array | null> {
  const res = await ask(file);
  return res ? await res.bytes() : null;
}

async function put(file: string, body: Uint8Array<ArrayBuffer>): Promise<void> {
  const api = process.env.DATA_STORE_API ?? "https://vercel.com/api/blob/";
  const res = await request(`${api}?pathname=${encodeURIComponent(file)}`, {
    body,
    headers: {
      authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
      "x-add-random-suffix": "0",
      // the same name is the same bytes: a second upload changes nothing
      "x-allow-overwrite": "1",
      "x-api-version": "13",
      "x-content-type": "application/octet-stream",
      "x-vercel-blob-access": "public",
    },
    method: "PUT",
  });
  if (!res.ok) {
    throw new Error(`data store: storing ${file} answered ${res.status}`);
  }
}

/** `work` for every item, `LANES` at a time. */
async function each<T>(items: T[], work: (item: T) => Promise<void>) {
  const queue = [...items];
  const lane = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
}

/**
 * Uploads the site baked into `dir`; resolves with the files it sent. A
 * manifest already under the key must be the one just baked: the same key
 * over other bytes is an input the key misses, or a bake that depends on
 * the machine, and fails here rather than serving stale tiles.
 */
export async function publishSite(
  site: string,
  dir: string,
  key = siteKey(site)
): Promise<number> {
  const manifest = readFileSync(path.join(dir, MANIFEST_FILE));
  const there = await read(stored(site, MANIFEST_FILE, key));
  if (there) {
    if (!manifest.equals(there)) {
      throw new Error(
        `${site}: the store's manifest.${key}.json is not the one just baked — an input siteKey (scripts/data-store.ts) does not cover, or a bake whose bytes depend on the machine`
      );
    }
    return 0;
  }
  let sent = 0;
  await each(
    readdirSync(dir).filter((name) => name !== MANIFEST_FILE),
    async (name) => {
      const file = stored(site, name, key);
      if (UNHASHED.has(name) || !(await ask(file, "HEAD"))) {
        await put(file, readFileSync(path.join(dir, name)));
        sent += 1;
      }
    }
  );
  await put(stored(site, MANIFEST_FILE, key), manifest);
  return sent + 1;
}

/**
 * Writes the site into `dir` as CI baked it for this checkout's key, every
 * hashed file checked against its name. Waits `patience` for the manifest:
 * a push starts the web build and CI's bake side by side.
 */
export async function pullSite(
  site: string,
  dir: string,
  key = siteKey(site),
  patience = PATIENCE_MS
): Promise<void> {
  const until = Date.now() + patience;
  let manifest = await read(stored(site, MANIFEST_FILE, key));
  while (!manifest) {
    if (Date.now() >= until) {
      throw new Error(
        `${site}: the store has no manifest.${key}.json after ${Math.round(patience / 60_000)} min. CI publishes it: see the step "Publish the sites" of the job "E2E (whole site, shell, docs)" for this commit (a pull request from a fork or from Dependabot has no secret to publish with)`
      );
    }
    await Bun.sleep(Math.min(ASK_MS, patience));
    manifest = await read(stored(site, MANIFEST_FILE, key));
  }
  mkdirSync(dir, { recursive: true });
  const { files } = JSON.parse(
    new TextDecoder().decode(manifest)
  ) as DataManifest;
  await each(Object.entries(files), async ([logical, name]) => {
    const dest = path.join(dir, name);
    if (existsSync(dest) && hashedName(logical, readFileSync(dest)) === name) {
      return;
    }
    const bytes = await read(`${site}/${name}`);
    if (!bytes || hashedName(logical, bytes) !== name) {
      throw new Error(
        `${site}/${name}: ${bytes ? "not the bytes its name says" : "not in the store"}`
      );
    }
    writeWhole(dest, bytes);
  });
  const stats = await read(stored(site, SITE_STATS_FILE, key));
  if (stats) {
    writeWhole(path.join(dir, SITE_STATS_FILE), stats);
  }
  writeWhole(path.join(dir, MANIFEST_FILE), manifest);
}

if (import.meta.main) {
  const out = path.join(process.cwd(), "public/data");
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    for (const site of readdirSync(out)) {
      if (existsSync(path.join(out, site, MANIFEST_FILE))) {
        const key = siteKey(site);
        const sent = await publishSite(site, path.join(out, site), key);
        process.stdout.write(
          `data-store: ${site} at ${key}: ${sent} files sent\n`
        );
      }
    }
  } else {
    process.stdout.write(
      "::notice::data-store: no token (a fork's or Dependabot's pull request has none) — nothing published; a web build of this commit finds its sites only where their keys were published before\n"
    );
  }
}
