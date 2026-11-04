/** The renderer's requests through the viewer's one fetch. */
import { TILE_FETCH_BUDGET_MS } from "@/lib/city/fetch-retry";
import { eitherSignal, fetchBytes } from "./fetch-optional";

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
 */
export class ContentFetchPlugin {
  name = "BRIDGE_CONTENT_FETCH";
  /** aborts every request in flight when the stream goes (dispose) */
  private readonly aborter = new AbortController();
  async fetchData(
    url: string,
    options: RequestInit
  ): Promise<Response | ArrayBuffer> {
    const { signal, ...init } = options;
    const either = eitherSignal(signal, this.aborter.signal);
    try {
      const got = await fetchBytes(url, {
        signal: either.signal,
        budgetMs: TILE_FETCH_BUDGET_MS,
        gunzip: url.endsWith(".gz"),
        init,
      });
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
