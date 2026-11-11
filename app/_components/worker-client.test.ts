import { expect, test } from "bun:test";
import { createWorkerClient } from "./worker-client";
import type { WorkerClientSpec } from "./worker-client";

/** A worker of the test's own: what it was sent, and its listeners. */
class FakeWorker {
  sent: unknown[] = [];
  ended = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: unknown): void {
    if (typeof message === "function") {
      throw new DOMException("cannot be cloned", "DataCloneError");
    }
    this.sent.push(message);
  }

  terminate(): void {
    this.ended = true;
  }

  say(data: unknown): void {
    this.emit("message", { data });
  }

  fail(): void {
    this.emit("error", {
      preventDefault: () => {
        // (the page's handler asks for it)
      },
    });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

interface Rig {
  workers: FakeWorker[];
  here: number[];
  spec: WorkerClientSpec<number, { out: number }, number>;
}

function rig(kept = true): Rig {
  const workers: FakeWorker[] = [];
  const here: number[] = [];
  return {
    workers,
    here,
    spec: {
      name: "test",
      start: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      pack: (input) => ({ message: input, transfer: [], kept }),
      unpack: (reply) => reply.out,
      here: (input) => {
        here.push(input);
        return -input;
      },
    },
  };
}

/** Lets the client's promises and its later tasks run. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
};

/** What a job failed with (null: it did not). */
async function failureOf(job: Promise<unknown>): Promise<Error | null> {
  try {
    await job;
    return null;
  } catch (error) {
    return error as Error;
  }
}

test("nothing goes over before the worker said it runs", async () => {
  const { workers, spec } = rig();
  const client = createWorkerClient(spec);
  const first = client.run(1);
  await settle();
  expect(workers[0].sent).toEqual([]);
  workers[0].say({ ready: true });
  await settle();
  expect(workers[0].sent).toEqual([1]);
  workers[0].say({ out: 10 });
  expect(await first).toBe(10);
  client.stop();
});

test("one job at a time, a lower rank first, and an aborted one never sent", async () => {
  const { workers, spec } = rig();
  const client = createWorkerClient({ ...spec, rank: (n) => (n > 5 ? 1 : 0) });
  const order: number[] = [];
  const note = async (n: number, signal?: AbortSignal) => {
    order.push(await client.run(n, signal));
  };
  const aborter = new AbortController();
  const all = [
    note(1),
    note(9),
    note(2),
    note(3, aborter.signal).catch(() => order.push(-1)),
  ];
  aborter.abort();
  await settle();
  workers[0].say({ ready: true });
  for (let i = 0; i < 3; i += 1) {
    await settle();
    expect(workers[0].sent.length).toBe(i + 1);
    workers[0].say({ out: workers[0].sent[i] as number });
  }
  await Promise.all(all);
  expect(workers[0].sent).toEqual([1, 2, 9]);
  expect(order).toEqual([-1, 1, 2, 9]);
  client.stop();
});

test("a worker that dies before its handshake is given up: every job runs here, one a task", async () => {
  const { workers, here, spec } = rig();
  const client = createWorkerClient(spec);
  const jobs = [client.run(1), client.run(2)];
  await settle();
  workers[0].fail();
  expect(await Promise.all(jobs)).toEqual([-1, -2]);
  expect(await client.run(3)).toBe(-3);
  expect(workers.length).toBe(1);
  expect(here).toEqual([1, 2, 3]);
  expect(client.up()).toBe(false);
});

test("a worker that never says it runs is given up after the handshake's time", async () => {
  const { workers, here, spec } = rig();
  const client = createWorkerClient({ ...spec, handshakeMs: 20 });
  expect(await client.run(1)).toBe(-1);
  expect(workers[0].ended).toBe(true);
  expect(workers[0].sent).toEqual([]);
  expect(here).toEqual([1]);
  expect(client.up()).toBe(false);
});

test("a worker that dies at work is started again once; the job it held runs here when its input was kept", async () => {
  const { workers, here, spec } = rig();
  const client = createWorkerClient(spec);
  const held = client.run(1);
  await settle();
  workers[0].say({ ready: true });
  await settle();
  workers[0].fail();
  expect(await held).toBe(-1);
  expect(workers[0].ended).toBe(true);
  const next = client.run(2);
  await settle();
  expect(workers.length).toBe(2);
  workers[1].say({ ready: true });
  await settle();
  workers[1].say({ out: 20 });
  expect(await next).toBe(20);
  // a second death is the last
  const last = client.run(3);
  await settle();
  workers[1].fail();
  expect(await last).toBe(-3);
  expect(await client.run(4)).toBe(-4);
  expect(workers.length).toBe(2);
  expect(here).toEqual([1, 3, 4]);
});

test("a job handed over to a worker that dies is lost", async () => {
  const { workers, here, spec } = rig(false);
  const client = createWorkerClient(spec);
  const held = failureOf(client.run(1));
  await settle();
  workers[0].say({ ready: true });
  await settle();
  workers[0].fail();
  const lost = await held;
  expect(lost?.message).toBe("the test worker died with a job");
  expect(here).toEqual([]);
});

test("a message that cannot be sent is worked on here, and the line goes on", async () => {
  const { workers, spec } = rig();
  const unsent: number[] = [];
  const client = createWorkerClient({
    ...spec,
    pack: (input) => ({
      message: input === 1 ? () => 0 : input,
      transfer: [],
      kept: true,
    }),
    unsent: (input) => {
      unsent.push(input);
    },
  });
  const jobs = [client.run(1), client.run(2)];
  await settle();
  workers[0].say({ ready: true });
  await settle();
  workers[0].say({ out: 20 });
  expect(await Promise.all(jobs)).toEqual([-1, 20]);
  expect(unsent).toEqual([1]);
  client.stop();
});

test("a stop ends the held job and those waiting, and the next job starts a new worker", async () => {
  const { workers, here, spec } = rig();
  let ended = 0;
  const client = createWorkerClient({
    ...spec,
    ended: () => {
      ended += 1;
    },
  });
  const jobs = [client.run(1), client.run(2)].map(failureOf);
  await settle();
  workers[0].say({ ready: true });
  await settle();
  client.stop();
  const failed = await Promise.all(jobs);
  expect(failed.map((e) => e?.name)).toEqual(["AbortError", "AbortError"]);
  expect(workers[0].ended).toBe(true);
  expect(ended).toBe(1);
  // the stopped worker's last word is not about the new one's job
  const again = client.run(3);
  await settle();
  workers[0].say({ out: 99 });
  workers[1].say({ ready: true });
  await settle();
  workers[1].say({ out: 30 });
  expect(await again).toBe(30);
  expect(here).toEqual([]);
  client.stop();
});

test("a job aborted before its turn here is not worked on", async () => {
  const { workers, here, spec } = rig();
  const client = createWorkerClient(spec);
  const aborter = new AbortController();
  const held = failureOf(client.run(1, aborter.signal));
  await settle();
  workers[0].say({ ready: true });
  await settle();
  // the worker dies with the job, and nobody waits for it any more
  aborter.abort();
  workers[0].fail();
  const failed = await held;
  expect(failed?.name).toBe("AbortError");
  expect(here).toEqual([]);
});
