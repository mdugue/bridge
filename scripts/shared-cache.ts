/**
 * The bake cache every branch shares (scripts/prepare-data.ts `cached`).
 * Vercel restores each branch's build cache from that branch's last build
 * (else production's), so branches that rebase onto the same main each
 * baked the same entries cold, side by side. Behind the local cache
 * (bake-cache.ts) this one is content-addressed in Vercel's Remote Cache
 * (the artifacts API Turborepo uses; Vercel's build passes a token for it):
 * an entry is fetched before it is baked and uploaded after, under a hash of
 * its name and key, so a key is baked once for every branch.
 *
 * Never fatal: off without a token (a local run, CI) or with
 * `BAKE_SHARED_CACHE=0`; a failed request logs a line and the bake goes on
 * as if the entry were missing. After the first failed upload the run stops
 * uploading (a size limit or a full cache fails every one alike).
 */
import { createHash } from "node:crypto";

export interface SharedCache {
  /** The entry's bytes, or null when the cache has none. */
  get: (name: string, key: string) => Promise<Uint8Array | null>;
  /** Stores the entry (best effort). */
  put: (name: string, key: string, bytes: Uint8Array) => Promise<void>;
  /** What this run fetched and stored, for the closing log line. */
  stats: () => { hits: number; misses: number; stored: number; bytes: number };
}

const API = "https://api.vercel.com/v8/artifacts";

/** The artifact's hash: hex, as the API's path expects. */
export function artifactHash(name: string, key: string): string {
  return createHash("sha256")
    .update(`prepare-data\n${name}\n${key}`)
    .digest("hex");
}

/**
 * The shared cache for this environment, or null with the reason it is off.
 * `VERCEL_ARTIFACTS_TOKEN` / `VERCEL_ARTIFACTS_OWNER` are what Vercel's build
 * sets; `TURBO_TOKEN` / `TURBO_TEAM` name the same for a run elsewhere.
 */
export function sharedCache(
  env: Record<string, string | undefined>,
  log: (message: string) => void,
  fetcher: typeof fetch = fetch
): { cache: SharedCache | null; reason: string } {
  if (env.BAKE_SHARED_CACHE === "0") {
    return { cache: null, reason: "off (BAKE_SHARED_CACHE=0)" };
  }
  const token = env.VERCEL_ARTIFACTS_TOKEN ?? env.TURBO_TOKEN;
  if (!token) {
    return { cache: null, reason: "off (no Remote Cache token)" };
  }
  const owner = env.VERCEL_ARTIFACTS_OWNER ?? env.TURBO_TEAM;
  const query = owner ? `?teamId=${encodeURIComponent(owner)}` : "";
  const headers = { Authorization: `Bearer ${token}` };
  const counts = { hits: 0, misses: 0, stored: 0, bytes: 0 };
  let uploads = true;

  const cache: SharedCache = {
    async get(name, key) {
      try {
        const res = await fetcher(`${API}/${artifactHash(name, key)}${query}`, {
          headers,
        });
        if (res.status === 404) {
          counts.misses += 1;
          return null;
        }
        if (!res.ok) {
          log(`shared cache: fetching ${name} failed (${res.status})`);
          counts.misses += 1;
          return null;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        counts.hits += 1;
        counts.bytes += bytes.byteLength;
        return bytes;
      } catch (error) {
        log(
          `shared cache: fetching ${name} failed (${(error as Error).message})`
        );
        counts.misses += 1;
        return null;
      }
    },
    async put(name, key, bytes) {
      if (!uploads) {
        return;
      }
      try {
        const res = await fetcher(`${API}/${artifactHash(name, key)}${query}`, {
          // every entry is baked into, or read from, a plain ArrayBuffer
          body: bytes as Uint8Array<ArrayBuffer>,
          headers: {
            ...headers,
            "Content-Type": "application/octet-stream",
          },
          method: "PUT",
        });
        if (!res.ok) {
          throw new Error(`${res.status} ${await res.text()}`.trim());
        }
        counts.stored += 1;
      } catch (error) {
        uploads = false;
        log(
          `shared cache: storing ${name} (${bytes.byteLength} bytes) failed, no more uploads this run (${(error as Error).message})`
        );
      }
    },
    stats: () => ({ ...counts }),
  };
  return { cache, reason: owner ? `on (team ${owner})` : "on" };
}
