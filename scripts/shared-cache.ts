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
 * under addresses of its own. Production trusts only itself: its builds
 * store under a scope of their own and read only that one; a preview reads
 * production's scope, then the previews' one, and stores under the
 * previews'. A key that misses an input (a gap no test caught) thus never
 * brings an unmerged branch's bytes to production. Each entry is stored
 * behind its SHA-256: a fetched entry whose bytes do not match is a miss.
 *
 * Never fatal: off without Vercel's token or with `BAKE_SHARED_CACHE=0`; a
 * failed request logs a line and the bake goes on as if the entry were
 * missing; after `MAX_FAILURES` failures in a row the run stops asking. A
 * request is cut off `ANSWER_MS` plus its size at `MIN_RATE` after it
 * starts (`allowedMs`); `MAX_STALLS` uploads cut off end the run's uploads
 * (the fetches go on): the link is down or crawling, and every lane would
 * wait out its deadline. An entry the cache refuses for its size is
 * skipped alone; one whose local copy cannot be read back is skipped too.
 * Uploads wait for the run's end (`flush`), then run `LANES` at a time,
 * each entry read back from the local cache as it goes; a large one logs
 * its size and time. Not beside the bake: Vercel's builds went silent in
 * München whenever uploads ran beside its bake (twice, at the same tile;
 * the same bake alone, and locally with them beside it, ran through), and
 * a queue of bytes beside a bake's peak is memory the build machine lacks.
 * The price: a run that dies shares nothing it baked.
 */
import { createHash } from "node:crypto";

export interface SharedCache {
  /** The entry's bytes, or null when the cache has none. */
  get: (name: string, key: string) => Promise<Uint8Array | null>;
  /** Notes the entry for upload at the run's end; `read` gives its bytes
   *  then, or null (or throws) when they are gone: the entry is skipped. */
  put: (name: string, key: string, read: () => Uint8Array | null) => void;
  /** Uploads every noted entry (best effort). */
  flush: () => Promise<void>;
  /** What this run fetched and stored, for the closing log line. */
  stats: () => { hits: number; misses: number; stored: number; bytes: number };
}

const API = "https://api.vercel.com/v8/artifacts";
/** The longest a request waits for its answer (a hit's or a miss's
 *  headers, an upload's reply beyond its bytes' time). */
const ANSWER_MS = 30_000;
/** The slowest rate (bytes per second) a request's time allows for its
 *  size (`allowedMs`): slower, sharing loses to baking. */
const MIN_RATE = 1024 ** 2;
/** A fetched entry's size when its answer names none: the largest an
 *  entry runs to. */
const UNKNOWN_BYTES = 256 * 1024 ** 2;
/** Uploads cut off that end the run's uploads. */
const MAX_STALLS = 2;
/** Failures in a row (not a miss, not a refused size) that end the run's
 *  use of the cache: a revoked token or an outage fails every request. */
const MAX_FAILURES = 3;
/** Uploads that run side by side (at the run's end a 13 MB entry took
 *  under half a second from Vercel's build; beside the bake, an 11 MB one
 *  took 7–11 s). */
const LANES = 4;
/** An upload this large logs its size and time. */
const LOG_BYTES = 8 * 1024 ** 2;
/** The size of the digest stored before an entry's bytes. */
const DIGEST = 32;

/** The entry's address: hex, as the API's path expects; the scope that
 *  stored it and the runtime its bytes were baked on are part of it. */
export function artifactHash(
  name: string,
  key: string,
  runtime: string,
  scope: string
): string {
  return createHash("sha256")
    .update(`prepare-data\n${scope}\n${runtime}\n${name}\n${key}`)
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

/** The time a request of `bytes` gets (`ANSWER_MS`, `MIN_RATE`). */
export const allowedMs = (bytes: number) =>
  ANSWER_MS + Math.ceil((bytes / MIN_RATE) * 1000);

/**
 * A request's deadline, moved once its size is known. It aborts the
 * request and, so a fetch that ignores its signal (a body stalled on the
 * socket) cannot hold the run, rejects whatever `race` waits on.
 */
function deadline(ms: number) {
  const controller = new AbortController();
  let reject: (error: Error) => void = () => {};
  const cut = new Promise<never>((_, no) => {
    reject = no;
  });
  // only `race` waits on it
  cut.catch(() => {});
  const fire = () => {
    const error = new DOMException("timed out", "TimeoutError");
    controller.abort(error);
    reject(error);
  };
  let timer = setTimeout(fire, ms);
  return {
    signal: controller.signal,
    race: <T>(work: Promise<T>) => Promise.race([work, cut]),
    move(next: number) {
      clearTimeout(timer);
      timer = setTimeout(fire, next);
    },
    clear: () => clearTimeout(timer),
  };
}

const timedOut = (error: unknown) =>
  (error as Error | undefined)?.name === "TimeoutError";

/**
 * The shared cache for this environment, or null with the reason it is off.
 * `VERCEL_ARTIFACTS_TOKEN` / `VERCEL_ARTIFACTS_OWNER` / `VERCEL_ENV` are
 * what Vercel's build sets; `runtime` names what bakes (Bun's version and
 * the platform).
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
  const scope = env.VERCEL_ENV === "production" ? "production" : "preview";
  const reads = scope === "production" ? [scope] : ["production", scope];
  const counts = { bytes: 0, hits: 0, misses: 0, stored: 0 };
  // a stand-in API for a local trial of the cache; ignored on Vercel, so
  // its token never goes elsewhere
  const api = env.VERCEL ? API : (env.BAKE_SHARED_CACHE_API ?? API);
  const url = (name: string, key: string, from: string) =>
    `${api}/${artifactHash(name, key, runtime, from)}${query}`;
  let failures = 0;
  let stalls = 0;
  /** The entries this run baked, uploaded by `flush`. */
  const noted = new Map<
    string,
    { key: string; name: string; read: () => Uint8Array | null }
  >();

  const failed = (what: string, reason: string) => {
    failures += 1;
    // a preview's fetches run two at a time: one may land past the last
    if (failures > MAX_FAILURES) {
      return;
    }
    log(
      `shared cache: ${what} failed (${reason})${failures === MAX_FAILURES ? ", not asked again this run" : ""}`
    );
  };
  const on = () => failures < MAX_FAILURES;
  const storing = () => on() && stalls < MAX_STALLS;

  const upload = async (name: string, key: string, bytes: Uint8Array) => {
    if (!storing()) {
      return;
    }
    const t0 = performance.now();
    const time = deadline(allowedMs(bytes.byteLength));
    try {
      const res = await time.race(
        fetcher(url(name, key, scope), {
          body: sealed(bytes),
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          method: "PUT",
          signal: time.signal,
        })
      );
      if (res.status === 413) {
        log(`shared cache: ${name} (${bytes.byteLength} bytes) is too large`);
        return;
      }
      if (!res.ok) {
        failed(
          `storing ${name}`,
          `${res.status} ${await time.race(res.text())}`.trim()
        );
        return;
      }
      failures = 0;
      counts.stored += 1;
      if (bytes.byteLength >= LOG_BYTES) {
        log(
          `shared cache: stored ${name} (${(bytes.byteLength / 1024 ** 2).toFixed(1)} MB) in ${Math.round(performance.now() - t0)} ms`
        );
      }
    } catch (error) {
      if (timedOut(error)) {
        stalls += 1;
        log(
          `shared cache: storing ${name} (${bytes.byteLength} bytes) timed out${stalls === MAX_STALLS ? ", no more uploads this run" : ""}`
        );
        return;
      }
      failed(`storing ${name}`, (error as Error).message);
    } finally {
      time.clear();
    }
  };

  /** One scope's entry: its bytes, null for a miss, undefined when the
   *  request failed. */
  const fetchFrom = async (
    name: string,
    key: string,
    from: string
  ): Promise<Uint8Array | null | undefined> => {
    const time = deadline(ANSWER_MS);
    try {
      const res = await time.race(
        fetcher(url(name, key, from), { headers, signal: time.signal })
      );
      if (res.status === 404) {
        failures = 0;
        return null;
      }
      if (!res.ok) {
        failed(`fetching ${name}`, String(res.status));
        return undefined;
      }
      const length = Number(res.headers.get("content-length"));
      time.move(allowedMs(length > 0 ? length : UNKNOWN_BYTES));
      const bytes = unsealed(
        new Uint8Array(await time.race(res.arrayBuffer()))
      );
      if (!bytes) {
        failed(`fetching ${name}`, "its bytes do not match their digest");
        return undefined;
      }
      failures = 0;
      return bytes;
    } catch (error) {
      failed(
        `fetching ${name}`,
        timedOut(error) ? "timed out" : (error as Error).message
      );
      return undefined;
    } finally {
      time.clear();
    }
  };

  /** An entry's bytes for upload, or null when its local copy is gone or
   *  unreadable: the run's bake is done, its upload is best effort. */
  const readBack = (e: { name: string; read: () => Uint8Array | null }) => {
    try {
      return e.read();
    } catch (error) {
      log(
        `shared cache: ${e.name} not read back (${(error as Error).message})`
      );
      return null;
    }
  };

  const cache: SharedCache = {
    async get(name, key) {
      if (!on()) {
        return null;
      }
      // every scope at once, the first that has it in `reads`' order
      const found = (
        await Promise.all(reads.map((from) => fetchFrom(name, key, from)))
      ).find((bytes) => bytes);
      if (found) {
        counts.hits += 1;
        counts.bytes += found.byteLength;
        return found;
      }
      counts.misses += 1;
      return null;
    },
    put(name, key, read) {
      noted.set(`${name}\n${key}`, { key, name, read });
    },
    async flush() {
      const entries = [...noted.values()];
      noted.clear();
      // each lane uploads one entry at a time, the lanes side by side
      const lane = async () => {
        for (let e = entries.shift(); e; e = entries.shift()) {
          const bytes = storing() ? readBack(e) : null;
          if (bytes) {
            await upload(e.name, e.key, bytes);
          }
        }
      };
      await Promise.all(Array.from({ length: LANES }, lane));
    },
    stats: () => ({ ...counts }),
  };
  return {
    cache,
    reason: `on (${scope}${owner ? `, team ${owner}` : ""})`,
  };
}
