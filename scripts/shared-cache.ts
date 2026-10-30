/**
 * The bake cache every branch shares (scripts/prepare/context.ts `cached`).
 * Vercel restores each branch's build cache from that branch's last build
 * (else production's), so branches that rebase onto the same main each
 * baked the same entries cold, side by side. Behind the local cache
 * (bake-cache.ts) this one is content-addressed in Vercel's Remote Cache
 * (the artifacts API Turborepo uses; Vercel's build passes a token for it):
 * an entry is fetched before it is baked and uploaded after, so a key is
 * baked once for every branch.
 *
 * Only Vercel's builds read and write it: they share one runtime, and the
 * address carries it (`artifactHash`), so a branch that bumps Bun bakes
 * under addresses of its own. Each entry is stored behind its SHA-256: a
 * fetched entry whose bytes do not match is a miss.
 *
 * Never fatal: off without Vercel's token or with `BAKE_SHARED_CACHE=0`; a
 * failed request logs a line and the bake goes on as if the entry were
 * missing; a request that hangs is cut off (`TIMEOUT_MS`); after
 * `MAX_FAILURES` failures in a row the run stops asking. An entry the
 * cache refuses for its size is skipped alone. Uploads run one at a time
 * behind the bake (`flush` waits for them), at most `QUEUE_BYTES` waiting.
 */
import { createHash } from "node:crypto";

export interface SharedCache {
  /** The entry's bytes, or null when the cache has none. */
  get: (name: string, key: string) => Promise<Uint8Array | null>;
  /** Queues the entry's upload (best effort); waits only while the queue
   *  is full. */
  put: (name: string, key: string, bytes: Uint8Array) => Promise<void>;
  /** Waits for every queued upload. */
  flush: () => Promise<void>;
  /** What this run fetched and stored, for the closing log line. */
  stats: () => { hits: number; misses: number; stored: number; bytes: number };
}

const API = "https://api.vercel.com/v8/artifacts";
/** A request that takes longer is cut off (a large glb uploads in seconds). */
const TIMEOUT_MS = 120_000;
/** Failures in a row (not a miss, not a refused size) that end the run's
 *  use of the cache: a revoked token or an outage fails every request. */
const MAX_FAILURES = 3;
/** The bytes that may wait for upload before a bake waits for the queue:
 *  a small share of the build machine's 8 GB. */
const QUEUE_BYTES = 256 * 1024 ** 2;
/** The size of the digest stored before an entry's bytes. */
const DIGEST = 32;

/** The entry's address: hex, as the API's path expects; the runtime the
 *  bytes were baked on is part of it. */
export function artifactHash(
  name: string,
  key: string,
  runtime: string
): string {
  return createHash("sha256")
    .update(`prepare-data\n${runtime}\n${name}\n${key}`)
    .digest("hex");
}

const sha256 = (bytes: Uint8Array) =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

/** The entry as stored: its digest, then its bytes. */
export function sealed(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(DIGEST + bytes.byteLength);
  out.set(sha256(bytes), 0);
  out.set(bytes, DIGEST);
  return out;
}

/** The bytes of a stored entry, or null when they are not what was stored. */
export function unsealed(stored: Uint8Array): Uint8Array | null {
  if (stored.byteLength < DIGEST) {
    return null;
  }
  const bytes = stored.subarray(DIGEST);
  const digest = sha256(bytes);
  return digest.every((b, i) => b === stored[i]) ? bytes : null;
}

/**
 * The shared cache for this environment, or null with the reason it is off.
 * `VERCEL_ARTIFACTS_TOKEN` / `VERCEL_ARTIFACTS_OWNER` are what Vercel's
 * build sets; `runtime` names what bakes (Bun's version and the platform).
 */
export function sharedCache(
  env: Record<string, string | undefined>,
  log: (message: string) => void,
  runtime: string,
  fetcher: typeof fetch = fetch
): { cache: SharedCache | null; reason: string } {
  if (env.BAKE_SHARED_CACHE === "0") {
    return { cache: null, reason: "off (BAKE_SHARED_CACHE=0)" };
  }
  const token = env.VERCEL_ARTIFACTS_TOKEN;
  if (!token) {
    return { cache: null, reason: "off (not a Vercel build)" };
  }
  const owner = env.VERCEL_ARTIFACTS_OWNER;
  const query = owner ? `?teamId=${encodeURIComponent(owner)}` : "";
  const headers = { Authorization: `Bearer ${token}` };
  const counts = { bytes: 0, hits: 0, misses: 0, stored: 0 };
  const url = (name: string, key: string) =>
    `${API}/${artifactHash(name, key, runtime)}${query}`;
  let failures = 0;
  let queue = Promise.resolve();
  let queued = 0;

  const failed = (what: string, reason: string) => {
    failures += 1;
    log(
      `shared cache: ${what} failed (${reason})${failures === MAX_FAILURES ? ", not asked again this run" : ""}`
    );
  };
  const on = () => failures < MAX_FAILURES;

  const upload = async (name: string, key: string, bytes: Uint8Array) => {
    if (!on()) {
      return;
    }
    try {
      const res = await fetcher(url(name, key), {
        body: sealed(bytes),
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        method: "PUT",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 413) {
        log(`shared cache: ${name} (${bytes.byteLength} bytes) is too large`);
        return;
      }
      if (!res.ok) {
        failed(`storing ${name}`, `${res.status} ${await res.text()}`.trim());
        return;
      }
      failures = 0;
      counts.stored += 1;
    } catch (error) {
      failed(`storing ${name}`, (error as Error).message);
    }
  };

  const cache: SharedCache = {
    async get(name, key) {
      if (!on()) {
        return null;
      }
      try {
        const res = await fetcher(url(name, key), {
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status === 404) {
          failures = 0;
          counts.misses += 1;
          return null;
        }
        if (!res.ok) {
          failed(`fetching ${name}`, String(res.status));
          counts.misses += 1;
          return null;
        }
        const bytes = unsealed(new Uint8Array(await res.arrayBuffer()));
        if (!bytes) {
          failed(`fetching ${name}`, "its bytes do not match their digest");
          counts.misses += 1;
          return null;
        }
        failures = 0;
        counts.hits += 1;
        counts.bytes += bytes.byteLength;
        return bytes;
      } catch (error) {
        failed(`fetching ${name}`, (error as Error).message);
        counts.misses += 1;
        return null;
      }
    },
    async put(name, key, bytes) {
      if (!on()) {
        return;
      }
      if (queued + bytes.byteLength > QUEUE_BYTES) {
        await queue;
      }
      queued += bytes.byteLength;
      queue = queue.then(async () => {
        await upload(name, key, bytes);
        queued -= bytes.byteLength;
      });
    },
    flush: () => queue,
    stats: () => ({ ...counts }),
  };
  return { cache, reason: owner ? `on (team ${owner})` : "on" };
}
