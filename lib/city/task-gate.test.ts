import { expect, test } from "bun:test";
import { createTaskGate } from "./task-gate";

/** A task that runs until `finish` is called, noting when it starts. */
function held(log: string[], name: string) {
  let finish = (): void => undefined;
  const task = () =>
    new Promise<string>((resolve) => {
      log.push(`start ${name}`);
      finish = () => resolve(name);
    });
  return { task, finish: () => finish() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What `promise` rejects with (undefined when it resolves). */
const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (err: unknown) => err
  );

test("one place runs the tasks one after another, in the order they came", async () => {
  const gate = createTaskGate(1);
  const log: string[] = [];
  const a = held(log, "a");
  const b = held(log, "b");
  const c = held(log, "c");
  const results = [gate.run(a.task), gate.run(b.task), gate.run(c.task)];
  await settle();
  expect(log).toEqual(["start a"]);
  expect(gate.waiting()).toBe(2);
  a.finish();
  await settle();
  expect(log).toEqual(["start a", "start b"]);
  b.finish();
  await settle();
  c.finish();
  expect(await Promise.all(results)).toEqual(["a", "b", "c"]);
  expect(gate.running()).toBe(0);
});

test("never more at once than the gate has places", async () => {
  const gate = createTaskGate(2);
  let now = 0;
  let most = 0;
  const task = async () => {
    now++;
    most = Math.max(most, now);
    await settle();
    now--;
  };
  await Promise.all(Array.from({ length: 7 }, () => gate.run(task)));
  expect(most).toBe(2);
});

test("a waiter whose signal aborts leaves the line without running", async () => {
  const gate = createTaskGate(1);
  const log: string[] = [];
  const a = held(log, "a");
  const b = held(log, "b");
  const c = held(log, "c");
  const controller = new AbortController();
  const first = gate.run(a.task);
  const dropped = gate.run(b.task, controller.signal);
  const last = gate.run(c.task);
  controller.abort();
  expect(await failure(dropped)).toMatchObject({ name: "AbortError" });
  a.finish();
  await settle();
  c.finish();
  await Promise.all([first, last]);
  expect(log).toEqual(["start a", "start c"]);
  // aborted before it asked: never queued
  expect(await failure(gate.run(b.task, controller.signal))).toMatchObject({
    name: "AbortError",
  });
  expect(gate.waiting()).toBe(0);
});

test("a task that fails frees its place", async () => {
  const gate = createTaskGate(1);
  const outcome = (p: Promise<string>) =>
    p.then(
      (value) => value,
      (err: unknown) => `failed: ${(err as Error).message}`
    );
  const results = await Promise.all([
    outcome(gate.run(() => Promise.reject(new Error("decode failed")))),
    outcome(
      gate.run(() => {
        throw new Error("thrown at once");
      })
    ),
    outcome(gate.run(() => Promise.resolve("next"))),
  ]);
  expect(results).toEqual([
    "failed: decode failed",
    "failed: thrown at once",
    "next",
  ]);
  expect(gate.running()).toBe(0);
});

test("a raised limit starts the waiters at once; a lowered one lets the running finish", async () => {
  const gate = createTaskGate(1);
  const log: string[] = [];
  const a = held(log, "a");
  const b = held(log, "b");
  const c = held(log, "c");
  const results = [gate.run(a.task), gate.run(b.task), gate.run(c.task)];
  await settle();
  expect(log).toEqual(["start a"]);
  gate.setLimit(3);
  await settle();
  expect(log).toEqual(["start a", "start b", "start c"]);
  gate.setLimit(1);
  const d = held(log, "d");
  const later = gate.run(d.task);
  a.finish();
  b.finish();
  await settle();
  // still one running (c): d waits for it
  expect(log).not.toContain("start d");
  c.finish();
  await settle();
  expect(log).toContain("start d");
  d.finish();
  expect(await Promise.all([...results, later])).toEqual(["a", "b", "c", "d"]);
});
