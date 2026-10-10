import { expect, test } from "bun:test";
import { lazyFeature } from "./feature-seam";

/** A feature that counts its starts and stops. */
function counted() {
  let starts = 0;
  let stops = 0;
  return {
    starts: () => starts,
    stops: () => stops,
    start: () => {
      starts++;
      return {
        dispose: () => {
          stops++;
        },
      };
    },
  };
}

test("a feature wanted many times loads and starts once", async () => {
  let imports = 0;
  const feature = counted();
  const lazy = lazyFeature(() => {
    imports++;
    return Promise.resolve({});
  }, feature.start);
  expect(lazy.current()).toBeNull();
  const [a, b] = await Promise.all([lazy.want(), lazy.want()]);
  await lazy.want();
  expect(imports).toBe(1);
  expect(feature.starts()).toBe(1);
  expect(a).toBe(b);
  expect(lazy.current()).toBe(a);
});

test("a module that did not load is asked for again on the next want", async () => {
  let imports = 0;
  const feature = counted();
  const lazy = lazyFeature(() => {
    imports++;
    return imports === 1
      ? Promise.reject(new Error("load"))
      : Promise.resolve({});
  }, feature.start);
  const failed = await lazy.want().then(
    () => null,
    (error: unknown) => error
  );
  expect(failed).toBeInstanceOf(Error);
  expect(lazy.current()).toBeNull();
  expect(await lazy.want()).not.toBeNull();
  expect(imports).toBe(2);
  expect(feature.starts()).toBe(1);
});

test("a spine gone before the module came never starts the feature; one gone after stops it", async () => {
  let arrive = (): void => undefined;
  const coming = new Promise<object>((resolve) => {
    arrive = () => resolve({});
  });
  const early = counted();
  const gone = lazyFeature(() => coming, early.start);
  const wanted = gone.want();
  gone.dispose();
  arrive();
  expect(await wanted).toBeNull();
  expect(early.starts()).toBe(0);
  expect(gone.current()).toBeNull();

  const late = counted();
  const started = lazyFeature(() => Promise.resolve({}), late.start);
  await started.want();
  started.dispose();
  expect(late.stops()).toBe(1);
  expect(started.current()).toBeNull();
});
