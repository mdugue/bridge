import { expect, test } from "bun:test";
import { createSharedRasters } from "./shared-rasters";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a shared raster loads once and is freed with its last reader", async () => {
  const loads: string[] = [];
  const freed: string[] = [];
  const share = createSharedRasters(
    (key) => {
      loads.push(key);
      return Promise.resolve(`tex:${key}`);
    },
    (value) => freed.push(value)
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
  let land: (value: string) => void = () => undefined;
  const freed: string[] = [];
  const share = createSharedRasters(
    () =>
      new Promise<string>((resolve) => {
        land = resolve;
      }),
    (value) => freed.push(value)
  );
  const pending = share.acquire("svf");
  share.release("svf");
  land("tex");
  await pending;
  await tick();
  expect(freed).toEqual(["tex"]);
});

test("a failed load is null, never a rejection", async () => {
  const share = createSharedRasters<string>(
    () => Promise.reject(new Error("404")),
    () => undefined
  );
  expect(await share.acquire("x")).toBeNull();
});

test("a clear frees every held raster, pending ones when they land", async () => {
  let land: (value: string) => void = () => undefined;
  const freed: string[] = [];
  const share = createSharedRasters(
    (key) =>
      key === "late"
        ? new Promise<string>((resolve) => {
            land = resolve;
          })
        : Promise.resolve(`tex:${key}`),
    (value) => freed.push(value)
  );
  await share.acquire("a");
  await share.acquire("a");
  const pending = share.acquire("late");
  share.clear();
  expect(share.held()).toBe(0);
  await tick();
  expect(freed).toEqual(["tex:a"]);
  land("tex:late");
  await pending;
  await tick();
  expect(freed).toEqual(["tex:a", "tex:late"]);
  // the readers' own releases come after the clear: nothing twice
  share.release("a");
  share.release("late");
  await tick();
  expect(freed).toEqual(["tex:a", "tex:late"]);
});
