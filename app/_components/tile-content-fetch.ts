/** The renderer's requests through the viewer's one fetch. */
import { TILE_FETCH_BUDGET_MS } from "@/lib/city/fetch-retry";
import { abortError } from "@/lib/city/task-gate";
import type { AheadRequest } from "./boot-ahead";
import { eitherSignal, fetchBytes } from "./fetch-optional";
import type { FetchedBytes } from "./fetch-optional";

/** Rejects with the abort once `signal` fires, after `then`; `stop` ends
 *  the watch. */
function whenAborted(
  signal: AbortSignal,
  then: () => void
): { gone: Promise<never>; stop: () => void } {
  const watching = new AbortController();
  const gone = new Promise<never>((_resolve, reject) => {
    const leave = () => {
      then();
      reject(abortError(signal));
    };
    if (signal.aborted) {
      leave();
    } else {
      signal.addEventListener("abort", leave, {
        once: true,
        signal: watching.signal,
      });
    }
  });
  gone.catch(() => {
    // (read by its race, or not at all)
  });
  return { gone, stop: () => watching.abort() };
}

/**
 * Every request the renderer makes — the tileset and each tile's content —
 * through the viewer's one fetch (fetch-optional.ts `fetchBytes`): a
 * network failure is retried while the page is visible, so a tile that hit
 * a blip stays loading (its coarse level shown, the boot waiting) instead
 * of failing; one that gives up is brought back later (tile-retry.ts). The
 * `.glb.gz` content is pre-gzipped (static hosts do not compress binary
 * types) and inflated natively inside the retries — unless the host already
 * did (isGzipped). Content comes back as its bytes, which the renderer
 * parses as they are (no Response to copy them through again); JSON as a
 * Response, which the renderer reads itself; a status no retry fixes as an
 * empty Response with that status, which the renderer reports.
 *
 * What the boot asked for ahead (boot-ahead.ts: the tileset, the boot
 * tile's first contents) is taken from there, once each, instead of asked
 * again; one the network failed there is asked here, with its retries.
 */
export class ContentFetchPlugin {
  name = "BRIDGE_CONTENT_FETCH";
  /** aborts every request in flight when the stream goes (dispose) */
  private readonly aborter = new AbortController();
  /** a request the boot already made for a URL, handed over once */
  private readonly ahead?: (url: string) => AheadRequest | undefined;

  constructor(ahead?: (url: string) => AheadRequest | undefined) {
    this.ahead = ahead;
  }

  /**
   * What the boot already asked for, when it was answered. A request the
   * tile no longer wants (`signal`: the renderer dropped it) is stopped
   * and rejects with the abort, as its own fetch would — not waited out,
   * nor asked a second time.
   */
  private async early(
    url: string,
    signal: AbortSignal
  ): Promise<FetchedBytes | null> {
    const request = this.ahead?.(url);
    if (!request) {
      return null;
    }
    const watch = whenAborted(signal, request.abort);
    let got: FetchedBytes | null = null;
    try {
      got = await Promise.race([request.got, watch.gone]);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      // failed there (or the boot let it go): asked here, with its retries
    } finally {
      watch.stop();
    }
    // (a status came through the same fetch and its retries: none fixes it)
    return got;
  }

  async fetchData(
    url: string,
    options: RequestInit
  ): Promise<Response | ArrayBuffer> {
    const { signal, ...init } = options;
    const either = eitherSignal(signal, this.aborter.signal);
    try {
      const got =
        (await this.early(url, either.signal)) ??
        (await fetchBytes(url, {
          signal: either.signal,
          budgetMs: TILE_FETCH_BUDGET_MS,
          gunzip: url.endsWith(".gz"),
          init,
        }));
      if (!got.ok) {
        return new Response(null, { status: got.status });
      }
      return new URL(url, window.location.href).pathname.endsWith(".json")
        ? new Response(got.bytes, { status: got.status })
        : got.bytes.buffer;
    } finally {
      either.release();
    }
  }

  dispose(): void {
    this.aborter.abort();
  }
}
