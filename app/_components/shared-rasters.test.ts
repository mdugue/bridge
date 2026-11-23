import { expect, test } from "bun:test";
import { createSharedRasters } from "./shared-rasters";

const tick = async () =>
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

test("a shared raster loads once and is freed with its last reader", async () => {
  const loads: string[] = [];
  const freed: string[] = [];
  const share = createSharedRasters(
    async (key) => {
      loads.push(key);
      return `tex:${key}`;
    },
    (value) => {
      freed.push(value);
    }
  );
  const [a, b] = await Promise.all([
    share.acquire("svf"),
    share.acquire("svf"),
  ]);
  expect(a).toBe("tex:svf");
  expect(b).toBe(a);
  expect(loads).toEqual(["svf"]);
  share.release("svf");
  await tick();
  expect(freed).toEqual([]);
  share.release("svf");
  await tick();
  expect(freed).toEqual(["tex:svf"]);
  expect(share.held()).toBe(0);
  // a later reader loads it afresh
  await share.acquire("svf");
  expect(loads).toEqual(["svf", "svf"]);
});

test("a raster released before it lands is freed when it lands", async () => {
  let land: ((value: string) => void) | undefined;
  const freed: string[] = [];
  const share = createSharedRasters(
    async () =>
      await new Promise<string>((resolve) => {
        land = resolve;
      }),
    (value) => {
      freed.push(value);
    }
  );
  const pending = share.acquire("svf");
  share.release("svf");
  land?.("tex");
  await pending;
  await tick();
  expect(freed).toEqual(["tex"]);
});

test("a failed load is null, never a rejection", async () => {
  const share = createSharedRasters<string>(
    async () => {
      throw new Error("404");
    },
    () => {}
  );
  expect(await share.acquire("x")).toBeNull();
});

test("a clear frees every held raster, pending ones when they land", async () => {
  let land: ((value: string) => void) | undefined;
  const freed: string[] = [];
  const share = createSharedRasters(
    async (key) =>
      key === "late"
        ? await new Promise<string>((resolve) => {
            land = resolve;
          })
        : await Promise.resolve(`tex:${key}`),
    (value) => {
      freed.push(value);
    }
  );
  await share.acquire("a");
  await share.acquire("a");
  const pending = share.acquire("late");
  share.clear();
  expect(share.held()).toBe(0);
  await tick();
  expect(freed).toEqual(["tex:a"]);
  land?.("tex:late");
  await pending;
  await tick();
  expect(freed).toEqual(["tex:a", "tex:late"]);
  // the readers' own releases come after the clear: nothing twice
  share.release("a");
  share.release("late");
  await tick();
  expect(freed).toEqual(["tex:a", "tex:late"]);
});

test("a load every reader left before it landed is aborted", async () => {
  let seen: AbortSignal | null = null;
  const share = createSharedRasters(
    async (_key, signal) => {
      seen = signal;
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
    () => {}
  );
  const pending = share.acquire("class");
  const second = share.acquire("class");
  share.release("class");
  expect((seen as AbortSignal | null)?.aborted).toBe(false);
  share.release("class");
  expect((seen as AbortSignal | null)?.aborted).toBe(true);
  // the reader sees no raster, never a rejection
  expect(await pending).toBeNull();
  expect(await second).toBeNull();
});

test("the stream's teardown stops the loads still on their way", async () => {
  const signals: AbortSignal[] = [];
  const share = createSharedRasters(
    async (key, signal) => {
      signals.push(signal);
      return key === "landed"
        ? await Promise.resolve("tex")
        : await new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          });
    },
    () => {}
  );
  await share.acquire("landed");
  const pending = share.acquire("on its way");
  share.clear();
  expect(signals.map((s) => s.aborted)).toEqual([false, true]);
  expect(await pending).toBeNull();
});

test("the first asker's rank reaches the load", async () => {
  const ranks: (number | undefined)[] = [];
  const share = createSharedRasters(
    async (_key, _signal, rank) => {
      ranks.push(rank);
      return await Promise.resolve("raster");
    },
    () => {}
  );
  await Promise.all([share.acquire("near", 0), share.acquire("near", 900)]);
  await share.acquire("far", 2400);
  expect(ranks).toEqual([0, 2400]);
});
