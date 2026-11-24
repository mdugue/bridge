import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MANIFEST_FILE } from "../lib/city/tile";
import { pullSite, publishSite, siteKey } from "./data-store";
import { createPublisher } from "./publisher";

const made: string[] = [];
const fresh = (name: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), `${name}-`));
  made.push(dir);
  return dir;
};
const bytes = (text: string) => new TextEncoder().encode(text);

/** A checkout in small: prepare-data.ts, a module it imports, a site's
 *  data, a patch and a lockfile. */
function checkout(): string {
  const root = fresh("checkout");
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  write("scripts/prepare-data.ts", 'import "./step";\n');
  write("scripts/step.ts", "export const level = 9;\n");
  write("scripts/viewer.ts", "export const fov = 60;\n");
  write("data/meissen/dgm/a.tif", "heights");
  write("data/grimma/dgm/a.tif", "heights");
  write("patches/tool.patch", "-a\n+b\n");
  write("bun.lock", '{ "packages": {} }\n');
  write("package.json", '{ "packageManager": "bun@1.4.4" }\n');
  return root;
}

test("a site's key follows what its bytes are made from, and nothing else", () => {
  const root = checkout();
  const key = siteKey("meissen", root);
  // every checkout computes the same key: CI's and the web build's
  const moved = fresh("moved");
  cpSync(root, moved, { recursive: true });
  expect(siteKey("meissen", moved)).toBe(key);

  const changes: [file: string, text: string, moves: boolean][] = [
    ["scripts/viewer.ts", "export const fov = 70;\n", false],
    ["data/grimma/dgm/a.tif", "other heights", false],
    ["scripts/step.ts", "export const level = 6;\n", true],
    ["data/meissen/dgm/a.tif", "other heights", true],
    ["data/meissen/dlm/new.geojson", "{}", true],
    ["patches/tool.patch", "-a\n+c\n", true],
    ["package.json", '{ "packageManager": "bun@1.5.0" }\n', true],
  ];
  let last = key;
  for (const [file, text, moves] of changes) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
    const next = siteKey("meissen", root);
    expect([file, next !== last]).toEqual([file, moves]);
    last = next;
  }
});

// --- a store in a folder: reads by path, uploads by `?pathname=` ---------------

const shelf = fresh("store");
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "PUT") {
        const dest = path.join(shelf, url.searchParams.get("pathname") ?? "");
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, await req.bytes());
        return new Response("{}");
      }
      const file = Bun.file(path.join(shelf, url.pathname));
      return (await file.exists())
        ? new Response(file)
        : new Response(null, { status: 404 });
    },
  });
  process.env.DATA_STORE = `http://localhost:${server.port}`;
  process.env.DATA_STORE_API = `http://localhost:${server.port}/`;
});

afterAll(async () => {
  await server.stop(true);
  delete process.env.DATA_STORE;
  delete process.env.DATA_STORE_API;
  for (const dir of made) {
    rmSync(dir, { recursive: true });
  }
});

/** A baked site: two hashed files, the stats, the manifest. */
function baked(lamps: string): string {
  const dir = fresh("baked");
  const publisher = createPublisher(dir);
  publisher.publish("lamps_t.geojson", bytes(lamps));
  publisher.publish("city_t.glb.gz", bytes("mesh"));
  publisher.publishPlain("site-stats.json", bytes("{}"));
  publisher.finish();
  return dir;
}

test("a published site is pulled back whole; what is there is sent once", async () => {
  const dir = baked("lamps");
  expect(await publishSite("meissen", dir, "k1")).toBe(4);
  // the same bake again: the key is there, with these bytes
  expect(await publishSite("meissen", dir, "k1")).toBe(0);
  // another key that shares a file sends only what is new
  expect(await publishSite("meissen", baked("more lamps"), "k2")).toBe(3);

  const pulled = path.join(fresh("pulled"), "meissen");
  await pullSite("meissen", pulled, "k1", 0);
  expect(readdirSync(pulled).toSorted()).toEqual(readdirSync(dir).toSorted());
  for (const name of readdirSync(dir)) {
    expect(readFileSync(path.join(pulled, name))).toEqual(
      readFileSync(path.join(dir, name))
    );
  }
});

test("a key over other bytes fails the publish: the key missed an input", async () => {
  await publishSite("grimma", baked("lamps"), "k1");
  await expect(publishSite("grimma", baked("other"), "k1")).rejects.toThrow(
    /not the one just baked/u
  );
});

test("a pull fails on a key nobody published and on bytes that are not the name's", async () => {
  const into = path.join(fresh("pulled"), "unna");
  await expect(pullSite("unna", into, "nobody", 0)).rejects.toThrow(
    /no manifest\.nobody\.json/u
  );
  expect(existsSync(into)).toBe(false);

  await publishSite("unna", baked("lamps"), "k1");
  const lamps = readdirSync(path.join(shelf, "unna")).find((name) =>
    name.startsWith("lamps_t")
  );
  writeFileSync(path.join(shelf, "unna", lamps ?? ""), "tampered");
  await expect(pullSite("unna", into, "k1", 0)).rejects.toThrow(
    /not the bytes its name says/u
  );
  // no manifest: the next run does not take the folder for a site
  expect(existsSync(path.join(into, MANIFEST_FILE))).toBe(false);
});
