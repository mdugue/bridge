import { expect, test } from "bun:test";
import { createCoalescer } from "./coalesce";

const endOfTask = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the reports of one task run once, at its end", async () => {
  let runs = 0;
  const change = createCoalescer(() => runs++);
  change.queue();
  change.queue();
  change.queue();
  expect(runs).toBe(0);
  await endOfTask();
  expect(runs).toBe(1);
  // the next task's report runs again
  change.queue();
  await endOfTask();
  expect(runs).toBe(2);
});

test("a flush runs the queued pass now, and the task's end does not repeat it", async () => {
  let runs = 0;
  const change = createCoalescer(() => runs++);
  change.flush();
  expect(runs).toBe(0);
  change.queue();
  change.flush();
  expect(runs).toBe(1);
  await endOfTask();
  expect(runs).toBe(1);
});

test("a report while the pass runs queues the next one", async () => {
  let runs = 0;
  const change = createCoalescer(() => {
    runs++;
    if (runs === 1) {
      change.queue();
    }
  });
  change.queue();
  change.flush();
  expect(runs).toBe(1);
  await endOfTask();
  expect(runs).toBe(2);
});
