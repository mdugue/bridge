import { expect, jest, test } from "bun:test";
import { BoxGeometry, Group, Mesh, MeshBasicNodeMaterial } from "three/webgpu";
import {
  COMPILE_WAIT_MS,
  createLateParts,
  MAX_LATE_OVERTAKES,
} from "./late-parts";
import type { Compiled, LatePart } from "./late-parts";
import { fakeHost, flush, gate } from "./late-parts.fixture";
import { disposeObject3D } from "./three-utils";

/** A part: a group with one box, its geometry's dispose counted, what it
 *  does logged under `name`. */
function fakePart(
  name: string,
  log: string[],
  over: Partial<LatePart<Group>> = {}
) {
  const group = new Group();
  const box = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  group.add(box);
  const freed = { count: 0 };
  box.geometry.addEventListener("dispose", () => {
    freed.count += 1;
  });
  const seen: { signal: AbortSignal | null } = { signal: null };
  const part: LatePart<Group> = {
    kind: "dressing",
    tile: name,
    rank: 1,
    hangAt: "wait",
    build: async (signal) => {
      seen.signal = signal;
      log.push(`${name} build`);
      return await Promise.resolve(group);
    },
    objects: (g) => [g],
    bytes: () => 100,
    hang: () => {
      log.push(`${name} hang`);
      return () => {
        log.push(`${name} down`);
      };
    },
    free: (g) => {
      log.push(`${name} free`);
      return disposeObject3D(g);
    },
    ...over,
  };
  return { freed, group, part, seen };
}

/** How a part has settled by now, or "pending". */
async function settledNow(h: { settled: Promise<unknown> }) {
  const now = Symbol("pending");
  const outcome = await Promise.race([h.settled, flush().then(() => now)]);
  return outcome === now ? "pending" : outcome;
}

test("a part builds, compiles, is ready, and hangs only once the content is recorded", async () => {
  const log: string[] = [];
  const { compiles, host, load } = fakeHost();
  const parts = createLateParts(host);
  const { part } = fakePart("a", log);
  const handle = parts.add(part);
  await flush();
  expect(log).toEqual(["a build"]);
  expect(compiles.map((c) => c.where)).toEqual(["dressing a"]);
  compiles[0].end("done");
  // ready while the content is not yet recorded (a hand-over awaits it)
  await handle.ready;
  await flush();
  expect(log).toEqual(["a build"]);
  load();
  expect(await handle.settled).toBe("hung");
  expect(log).toEqual(["a build", "a hang"]);
});

test("a part asks for the content's record when it would hang: one made after it was added holds it, none fails it loudly", async () => {
  const log: string[] = [];
  const { calls, compiles, host } = fakeHost();
  const record: { loaded?: Promise<void> } = {};
  const parts = createLateParts({
    ...host,
    loaded: async () => {
      if (record.loaded === undefined) {
        throw new Error("no record");
      }
      await record.loaded;
    },
  });
  const held = parts.add(fakePart("a", log).part);
  const lone = parts.add(fakePart("b", log).part);
  await flush();
  const recorded = gate();
  record.loaded = recorded.opened;
  compiles[0].end("done");
  await flush();
  expect(await settledNow(held)).toBe("pending");
  recorded.open();
  expect(await held.settled).toBe("hung");
  record.loaded = undefined;
  await flush();
  compiles[1].end("done");
  expect(await lone.settled).toBe("failed");
  expect(
    calls.failed.map(([error, tile]) => [(error as Error).message, tile])
  ).toEqual([["no record", "b"]]);
  expect(log).toEqual(["a build", "b build", "a hang", "b free"]);
});

test("a part disposed, or its tile left, before the lane's gate opens leaves at once and never builds; one added after is gone at once", async () => {
  const log: string[] = [];
  const g = gate();
  const { compiles, host } = fakeHost(g.opened);
  const parts = createLateParts(host);
  const disposed = parts.add(fakePart("a", log).part);
  disposed.dispose();
  expect(await settledNow(disposed)).toBe("gone");
  const handle = parts.add(fakePart("b", log).part);
  parts.leave();
  await handle.ready;
  expect(await settledNow(handle)).toBe("gone");
  // one added once the tile has left is gone as it is added
  const late = parts.add(fakePart("c", log).part);
  expect(await settledNow(late)).toBe("gone");
  await late.ready;
  expect(parts.bytes()).toBe(0);
  g.open();
  await flush();
  expect(log).toEqual([]);
  expect(compiles).toHaveLength(0);
});

test("a tile left during the build aborts it; what it made after all is freed, never compiled or weighed", async () => {
  const log: string[] = [];
  const { calls, compiles, host } = fakeHost();
  const parts = createLateParts(host);
  const finish = gate();
  const { freed, group, part, seen } = fakePart("a", log, {
    build: async (signal) => {
      seen.signal = signal;
      await finish.opened;
      return group;
    },
  });
  const handle = parts.add(part);
  await flush();
  parts.leave();
  expect(seen.signal?.aborted).toBe(true);
  finish.open();
  expect(await handle.settled).toBe("gone");
  expect(compiles).toHaveLength(0);
  expect(freed.count).toBe(1);
  expect(parts.bytes()).toBe(0);
  expect(calls.failed).toEqual([]);
});

test("a part weighs from its build until it is given up", async () => {
  const log: string[] = [];
  const { calls, compiles, host, load } = fakeHost();
  const parts = createLateParts(host);
  const handle = parts.add(fakePart("a", log, { hangAt: "compile" }).part);
  await flush();
  // built, compiling: weighed already
  expect(parts.bytes()).toBe(100);
  expect(calls.reweigh).toBe(1);
  load();
  compiles[0].end("out of memory");
  expect(await handle.settled).toBe("out of memory");
  expect(parts.bytes()).toBe(0);
  expect(calls.reweigh).toBe(2);
});

test("a part that hangs at its compile's end and ran out of memory never hangs, is freed, and is reported by the compile only", async () => {
  const log: string[] = [];
  const { calls, compiles, host, load } = fakeHost();
  const parts = createLateParts(host);
  const { freed, part } = fakePart("a", log, { hangAt: "compile" });
  const handle = parts.add(part);
  load();
  await flush();
  compiles[0].end("out of memory");
  expect(await handle.settled).toBe("out of memory");
  await flush();
  expect(log).toEqual(["a build", "a free"]);
  expect(freed.count).toBe(1);
  expect(calls.allocation).toEqual([]);
});

test("a part that hangs at the wait comes down again when its compile then runs out of memory", async () => {
  jest.useFakeTimers();
  try {
    const log: string[] = [];
    const { calls, compiles, host, load } = fakeHost();
    const parts = createLateParts(host);
    const { freed, part } = fakePart("a", log);
    const handle = parts.add(part);
    load();
    await flush();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    await handle.ready;
    await flush();
    // hung while its compile runs on: settled as hung
    expect(log).toEqual(["a build", "a hang"]);
    expect(await handle.settled).toBe("hung");
    const { changed } = calls;
    compiles[0].end("out of memory");
    await flush();
    expect(log).toEqual(["a build", "a hang", "a down", "a free"]);
    expect(freed.count).toBe(1);
    expect(parts.bytes()).toBe(0);
    expect(calls.changed).toBeGreaterThan(changed);
  } finally {
    jest.useRealTimers();
  }
});

test("a part that hangs at the wait and ran out of memory within it never hangs", async () => {
  const log: string[] = [];
  const { calls, compiles, host, load } = fakeHost();
  const parts = createLateParts(host);
  const { freed, part } = fakePart("a", log);
  const handle = parts.add(part);
  await flush();
  compiles[0].end("out of memory");
  await handle.ready;
  load();
  expect(await handle.settled).toBe("out of memory");
  await flush();
  expect(log).toEqual(["a build", "a free"]);
  expect(freed.count).toBe(1);
  expect(parts.bytes()).toBe(0);
  expect(calls.changed).toBe(0);
});

test("a part disposed while its compile runs comes down now and is freed, and leaves the tile's weight, once the compile ends, once", async () => {
  jest.useFakeTimers();
  try {
    const log: string[] = [];
    const { calls, compiles, host, load } = fakeHost();
    const parts = createLateParts(host);
    const { freed, part } = fakePart("a", log, {
      free: (g) => {
        log.push("a free");
        disposeObject3D(g);
        return ["free threw"];
      },
    });
    const handle = parts.add(part);
    load();
    await flush();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    await flush();
    expect(log).toEqual(["a build", "a hang"]);
    const weighed = calls.reweigh;
    expect(handle.dispose()).toEqual([]);
    expect(log).toEqual(["a build", "a hang", "a down"]);
    expect(freed.count).toBe(0);
    // still on the GPU: still weighed (ADR 0047)
    expect(parts.bytes()).toBe(100);
    expect(calls.reweigh).toBe(weighed);
    compiles[0].end("done");
    await flush();
    expect(freed.count).toBe(1);
    expect(parts.bytes()).toBe(0);
    expect(calls.reweigh).toBe(weighed + 1);
    expect(calls.freeFailed).toEqual([["free threw"]]);
    // a second dispose or the release frees nothing more
    expect(handle.dispose()).toEqual([]);
    expect(parts.release()).toEqual([]);
    expect(freed.count).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});

test("a build that throws is an allocation failure or a failure, and nothing once the tile has left", async () => {
  const cases = [
    {
      error: new RangeError("Array buffer allocation failed"),
      leave: false,
    },
    { error: new TypeError("bad furniture"), leave: false },
    { error: new TypeError("bad furniture"), leave: true },
  ];
  for (const { error, leave } of cases) {
    const { calls, host } = fakeHost();
    const parts = createLateParts(host);
    const thrown = gate();
    const handle = parts.add(
      fakePart("a", [], {
        build: async () => {
          await thrown.opened;
          throw error;
        },
      }).part
    );
    await flush();
    if (leave) {
      parts.leave();
    }
    thrown.open();
    const outcome = await handle.settled;
    if (leave) {
      expect(outcome).toBe("gone");
      expect(calls.allocation).toEqual([]);
      expect(calls.failed).toEqual([]);
    } else if (error instanceof RangeError) {
      expect(calls.allocation).toEqual([[error, "dressing a"]]);
      expect(calls.failed).toEqual([]);
    } else {
      expect(calls.failed).toEqual([[error, "a"]]);
      expect(calls.allocation).toEqual([]);
    }
  }
});

/** The compile of the part logged as `name` (the fake host's). */
const compileOf = (
  compiles: { where: string; end: (c: Compiled) => void }[],
  name: string
) => compiles.find((c) => c.where === `dressing ${name}`);

test("the lane: lower rank first, a build one compile wait ahead at most, a compile part holding it, rank null outside it", async () => {
  const log: string[] = [];
  const builds = () => log.filter((l) => l.endsWith(" build"));
  const { compiles, host, load } = fakeHost();
  load();
  const parts = createLateParts(host);
  // a "compile" part holds the lane through its compile wait...
  parts.add(fakePart("holder", log, { hangAt: "compile" }).part);
  await flush();
  // ...so these queue behind it, the coarse (rank 0) ahead of the fine
  parts.add(fakePart("fine", log).part);
  parts.add(fakePart("coarse", log, { rank: 0 }).part);
  // ...while one outside the lane builds at once
  parts.add(fakePart("murals", log, { rank: null, hangAt: "compile" }).part);
  await flush();
  expect(builds()).toEqual(["holder build", "murals build"]);
  compileOf(compiles, "holder")?.end("done");
  await flush();
  // a "wait" part frees the lane after its build: the fine builds over
  // the coarse's compile...
  expect(builds().slice(2)).toEqual(["coarse build", "fine build"]);
  // ...and a third waits out the compile wait before the last one
  parts.add(fakePart("third", log).part);
  await flush();
  expect(builds().at(-1)).toBe("fine build");
  compileOf(compiles, "coarse")?.end("done");
  await flush();
  expect(builds().at(-1)).toBe("third build");
});

test("the lane lets a lower rank overtake a part a bounded number of times", async () => {
  const log: string[] = [];
  const builds = () => log.filter((l) => l.endsWith(" build"));
  const { compiles, host, load } = fakeHost();
  load();
  const parts = createLateParts(host);
  parts.add(fakePart("holder", log, { hangAt: "compile" }).part);
  await flush();
  parts.add(fakePart("fine", log).part);
  for (let i = 0; i <= MAX_LATE_OVERTAKES; i += 1) {
    parts.add(fakePart(`coarse${i}`, log, { rank: 0, hangAt: "compile" }).part);
  }
  // each holds the lane through its compile: end them as they come
  for (let i = 0; i < MAX_LATE_OVERTAKES + 3; i += 1) {
    await flush();
    for (const c of compiles) {
      c.end("done");
    }
  }
  await flush();
  // the holder, then as many coarse as may overtake, then the fine
  expect(builds().indexOf("fine build")).toBe(1 + MAX_LATE_OVERTAKES);
  expect(builds().at(-1)).toBe(`coarse${MAX_LATE_OVERTAKES} build`);
});

test("a part with an owner goes when its owner goes", async () => {
  const log: string[] = [];
  const { compiles, host, load } = fakeHost();
  load();
  const parts = createLateParts(host);
  const owner = parts.add(fakePart("dressing", log, { rank: null }).part);
  await flush();
  compiles[0].end("done");
  await owner.settled;
  const { freed, part } = fakePart("traffic", log, {
    rank: null,
    hangAt: "compile",
  });
  const child = parts.add(part, owner);
  await flush();
  compiles[1].end("done");
  expect(await child.settled).toBe("hung");
  owner.dispose();
  await flush();
  expect(freed.count).toBe(1);
  expect(log).toContain("traffic down");
});

test("a part added to an owner its compile's running out of memory took down never builds", async () => {
  jest.useFakeTimers();
  try {
    const log: string[] = [];
    const { compiles, host, load } = fakeHost();
    load();
    const parts = createLateParts(host);
    const owner = parts.add(fakePart("dressing", log, { rank: null }).part);
    await flush();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    expect(await owner.settled).toBe("hung");
    compiles[0].end("out of memory");
    await flush();
    expect(log).toContain("dressing free");
    const child = parts.add(
      fakePart("traffic", log, { rank: null, hangAt: "compile" }).part,
      owner
    );
    await flush();
    expect(log).not.toContain("traffic build");
    expect(compiles).toHaveLength(1);
    expect(await child.settled).toBe("gone");
  } finally {
    jest.useRealTimers();
  }
});

test("a root's parts weigh together, and its release frees every one", async () => {
  const log: string[] = [];
  const { compiles, host, load } = fakeHost();
  load();
  const parts = createLateParts(host);
  const a = fakePart("a", log, { rank: null, hangAt: "compile" });
  const b = fakePart("b", log, {
    rank: null,
    hangAt: "compile",
    bytes: () => 50,
  });
  const handles = [parts.add(a.part), parts.add(b.part)];
  await flush();
  expect(parts.bytes()).toBe(150);
  for (const c of compiles) {
    c.end("done");
  }
  await Promise.all(handles.map(async (h) => await h.settled));
  expect(parts.release()).toEqual([]);
  expect(parts.bytes()).toBe(0);
  expect([a.freed.count, b.freed.count]).toEqual([1, 1]);
});

/** Whether what `ref` names is gone after a full collection. */
async function collected(ref: WeakRef<object>): Promise<boolean> {
  // (a WeakRef holds its target until the job that made it ends)
  await flush();
  Bun.gc(true);
  await flush();
  return ref.deref() === undefined;
}

test("a freed part's build is let go though its handle and its owner's are still held", async () => {
  const { compiles, host, load } = fakeHost();
  load();
  const parts = createLateParts(host);
  const owner = parts.add(fakePart("dressing", [], { rank: null }).part);
  await flush();
  compiles[0].end("done");
  await owner.settled;
  const refs: WeakRef<Group>[] = [];
  const child = parts.add(
    fakePart("traffic", [], {
      rank: null,
      hangAt: "compile",
      build: async () => {
        // made here: nothing of the test's holds it
        const group = new Group();
        refs.push(new WeakRef(group));
        return await Promise.resolve(group);
      },
    }).part,
    owner
  );
  await flush();
  compiles[1].end("done");
  expect(await child.settled).toBe("hung");
  // (the fake host keeps what it compiled)
  compiles.length = 0;
  // the traffic's slot keeps its handle after its dispose
  expect(child.dispose()).toEqual([]);
  expect(refs).toHaveLength(1);
  expect(await collected(refs[0])).toBe(true);
  expect(owner).toBeDefined();
});

test("a take-down that throws still frees the part, once, and says what threw", async () => {
  const log: string[] = [];
  const { compiles, host, load } = fakeHost();
  load();
  const parts = createLateParts(host);
  const thrown = new Error("down threw");
  const { freed, part } = fakePart("a", log, {
    rank: null,
    hangAt: "compile",
    hang: () => () => {
      throw thrown;
    },
  });
  const handle = parts.add(part);
  await flush();
  compiles[0].end("done");
  expect(await handle.settled).toBe("hung");
  expect(handle.dispose()).toEqual([thrown]);
  expect(freed.count).toBe(1);
  expect(parts.bytes()).toBe(0);
  expect(parts.release()).toEqual([]);
  expect(freed.count).toBe(1);
});

test("a part gone while it waits in the lane, or on the compile before the last, leaves at once", async () => {
  const log: string[] = [];
  const { compiles, host, load } = fakeHost();
  load();
  const parts = createLateParts(host);
  // in line behind a part holding the lane through its compile
  parts.add(fakePart("holder", log, { hangAt: "compile" }).part);
  await flush();
  const queued = parts.add(fakePart("queued", log).part);
  await flush();
  queued.dispose();
  expect(await settledNow(queued)).toBe("gone");
  compileOf(compiles, "holder")?.end("done");
  await flush();
  // two built, their compiles running: a third waits on the older one's
  parts.add(fakePart("a", log).part);
  parts.add(fakePart("b", log).part);
  await flush();
  const third = parts.add(fakePart("third", log).part);
  await flush();
  third.dispose();
  expect(await settledNow(third)).toBe("gone");
  expect(log.filter((l) => l.endsWith(" build"))).toEqual([
    "holder build",
    "a build",
    "b build",
  ]);
});

test("a hung part freed as its tile leaves never asks the cache to weigh the tile again", async () => {
  // (the renderer's cache frees a tile inside its eviction, after it took
  // the tile's bytes off its total: a re-weigh there adds them back for good)
  const log: string[] = [];
  const { calls, compiles, host, load } = fakeHost();
  const parts = createLateParts(host);
  const handle = parts.add(fakePart("a", log).part);
  load();
  await flush();
  compiles[0].end("done");
  expect(await handle.settled).toBe("hung");
  const weighed = calls.reweigh;
  parts.leave();
  expect(parts.release()).toEqual([]);
  expect(log).toContain("a free");
  expect(parts.bytes()).toBe(0);
  expect(calls.reweigh).toBe(weighed);
});
