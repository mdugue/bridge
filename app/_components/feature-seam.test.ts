import { expect, test } from "bun:test";
import { createWatch, follow, startOnce, wantOnSwitchOn } from "./feature-seam";

/** Every promise the calls before started has settled. */
const settled = async () =>
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** A feature that counts its starts and stops. */
function counted() {
  let starts = 0;
  let stops = 0;
  return {
    starts: () => starts,
    stops: () => stops,
    start: () => {
      starts += 1;
      return {
        dispose: () => {
          stops += 1;
        },
      };
    },
  };
}

test("a feature wanted many times starts once, after the call that wanted it", async () => {
  const feature = counted();
  const once = startOnce(feature.start);
  expect(once.current()).toBeNull();
  const wants = [once.want(), once.want()];
  expect(feature.starts()).toBe(0);
  const [a, b] = await Promise.all(wants);
  await once.want();
  expect(feature.starts()).toBe(1);
  expect(a).toBe(b);
  expect(once.current()).toBe(a);
});

test("a start that throws fails every want, and is not tried again", async () => {
  let starts = 0;
  const once = startOnce((): { dispose: () => void } => {
    starts += 1;
    throw new Error("start");
  });
  const failed = async () =>
    await once.want().then(
      () => null,
      (error: unknown) => error
    );
  expect(await failed()).toBeInstanceOf(Error);
  expect(await failed()).toBeInstanceOf(Error);
  expect(starts).toBe(1);
  expect(once.current()).toBeNull();
});

test("a spine gone before the start never starts the feature; one gone after stops it", async () => {
  const early = counted();
  const gone = startOnce(early.start);
  const wanted = gone.want();
  gone.dispose();
  expect(await wanted).toBeNull();
  expect(early.starts()).toBe(0);
  expect(gone.current()).toBeNull();

  const late = counted();
  const started = startOnce(late.start);
  await started.want();
  started.dispose();
  expect(late.stops()).toBe(1);
  expect(started.current()).toBeNull();
  // nor is the stopped feature handed out (a tile's slot asking late)
  expect(await started.want()).toBeNull();
  expect(late.starts()).toBe(1);
});

test("the spine wants the feature on each switch-on, not on every change while on", async () => {
  let wants = 0;
  const failures: unknown[] = [];
  const want = wantOnSwitchOn(
    {
      want: async () => {
        wants += 1;
        return await Promise.reject(new Error("start"));
      },
    },
    (reason) => {
      failures.push(reason);
    }
  );
  want(false);
  want(true);
  await settled();
  expect(failures).toHaveLength(1);
  // another change while a layer is on (a slider, a second layer)
  want(true);
  await settled();
  expect(wants).toBe(1);
  // off and on again
  want(false);
  want(true);
  await settled();
  expect(wants).toBe(2);
  expect(failures).toHaveLength(2);
});

test("a follower hears the value of now first, then every change, until it lets go", () => {
  const day = createWatch(180);
  const heard: number[] = [];
  const unfollow = follow(day, (d) => {
    heard.push(d);
  });
  expect(heard).toEqual([180]);
  day.set(9);
  day.set(9);
  expect(heard).toEqual([180, 9, 9]);
  unfollow();
  day.set(200);
  expect(heard).toEqual([180, 9, 9]);
});
