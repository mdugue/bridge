import { expect, test } from "bun:test";
import type { AheadRequest } from "./boot-ahead";
import type { FetchedBytes } from "./fetch-optional";
import { ContentFetchPlugin } from "./tile-content-fetch";

/** A request of the boot's that never answers, and whether it was stopped. */
function pending(): { request: AheadRequest; stopped: () => boolean } {
  let stopped = false;
  return {
    request: {
      abort: () => {
        stopped = true;
      },
      got: new Promise<FetchedBytes>(() => {
        // (never settles)
      }),
    },
    stopped: () => stopped,
  };
}

/** What a request failed with (null: it did not). */
async function failureOf(job: Promise<unknown>): Promise<Error | null> {
  try {
    await job;
    return null;
  } catch (error) {
    return error as Error;
  }
}

test("a tile dropped while the boot's request for it is under way stops that request and rejects", async () => {
  const { request, stopped } = pending();
  const plugin = new ContentFetchPlugin(() => request);
  const tile = new AbortController();
  const job = failureOf(
    plugin.fetchData("https://city.test/a.glb.gz", { signal: tile.signal })
  );
  tile.abort();
  const failed = await job;
  expect(failed?.name).toBe("AbortError");
  expect(stopped()).toBe(true);
});

test("the stream's end stops the boot's request a tile still waits on", async () => {
  const { request, stopped } = pending();
  const plugin = new ContentFetchPlugin(() => request);
  const job = failureOf(plugin.fetchData("https://city.test/a.glb.gz", {}));
  plugin.dispose();
  const failed = await job;
  expect(failed?.name).toBe("AbortError");
  expect(stopped()).toBe(true);
});
