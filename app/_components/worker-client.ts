/** One page's worker for one kind of job, with one rule for its failures. */
import { abortError, createTaskGate } from "@/lib/city/task-gate";

/**
 * The client of a worker that does one kind of job for the page (the
 * ground's heights, a tile's window niches, a building tile's BVH), and
 * the one rule all of them follow:
 *
 * - **One worker, one job at a time**, started at the first job. The jobs
 *   wait in a line (lib/city/task-gate.ts), a lower `rank` first; one whose
 *   signal aborts while it waits leaves the line and is never run.
 * - **A handshake first.** Nothing goes over before the worker's script
 *   said `{ ready: true }`: one that fails to load would keep what it was
 *   handed. A worker that says nothing for `HANDSHAKE_MS` is ended, its
 *   jobs run here, and the next job starts one more (a slow first load is
 *   not a session without workers); a second silence is the last.
 * - **Here where there is no worker** (a test, a browser that refuses it,
 *   a script that fails to load, a message that cannot be sent, a job
 *   `pack` keeps back): the work runs on the main thread, each job in a
 *   later task of its own, so a line of them never freezes the page in
 *   one. A job whose signal aborted by then is not worked on.
 * - **A worker that dies is started again once.** The job it held runs
 *   here when its input was `kept` (copied); one that was handed over is
 *   gone with it and rejects. A second death, or one before the handshake,
 *   and every later job runs here.
 * - **`stop` ends the worker** and rejects the job it held and those
 *   waiting with an `AbortError`; a later job starts a new one.
 */
export interface WorkerClientSpec<In, Reply, Out> {
  /** in the errors' wording: "the <name> worker stopped" */
  name: string;
  /** a new worker (may throw: there is none then) */
  start: () => Worker;
  /**
   * What goes over for `input`, asked at the job's turn, the worker ready;
   * `kept` says whether `input` can still be worked on here afterwards
   * (it was copied, not handed over). null: this job is done here.
   */
  pack: (
    input: In
  ) => { message: unknown; transfer: Transferable[]; kept: boolean } | null;
  /** the job's result out of the worker's reply (a throw fails the job) */
  unpack: (reply: Reply, input: In) => Out;
  /** the work on the main thread */
  here: (input: In) => Out | Promise<Out>;
  /** a job's place in the line: a lower one first (default 0) */
  rank?: (input: In) => number;
  /** `pack` was called for `input`, and the message did not go */
  unsent?: (input: In) => void;
  /** the worker ended (died or stopped): what it held is gone */
  ended?: () => void;
  /** how long the handshake may take (ms; default `HANDSHAKE_MS`) */
  handshakeMs?: number;
}

/** How long a new worker has to say it runs (ms): its script is in the
 *  page's cache with the scene's, so this is a stalled load, not a slow
 *  one — and without it every job would wait on it for ever. */
const HANDSHAKE_MS = 15_000;

export interface WorkerClient<In, Out> {
  /** the job's result, from the worker or from here */
  run: (input: In, signal?: AbortSignal) => Promise<Out>;
  /** ends the worker and every job it held or that waits */
  stop: () => void;
  /** whether a worker is there (started, not given up on) */
  up: () => boolean;
}

/** how a held job ends when no reply comes */
type Ended = "died" | "stopped";

/** A task of its own: what runs after it does not share this one. */
const laterTask = async (): Promise<void> =>
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

export function createWorkerClient<In, Reply extends object, Out>(
  spec: WorkerClientSpec<In, Reply, Out>
): WorkerClient<In, Out> {
  const gate = createTaskGate(1);
  let worker: Worker | null = null;
  /** settles true once the worker said it runs, false if it ended first */
  let ready: Promise<boolean> | null = null;
  let notReady: (() => void) | null = null;
  let broken = typeof Worker === "undefined";
  let restarted = false;
  /** the job away in the worker */
  let held: ((reply: Reply | Ended) => void) | null = null;
  /** counts the stops: a job from before one is not run after it */
  let generation = 0;

  const stoppedError = (): Error =>
    new DOMException(`the ${spec.name} worker stopped`, "AbortError");

  const end = (why: Ended): void => {
    const w = worker;
    worker = null;
    ready = null;
    w?.terminate();
    notReady?.();
    notReady = null;
    spec.ended?.();
    const settle = held;
    held = null;
    settle?.(why);
  };

  /**
   * The worker died: before its handshake (`failed`: its script does not
   * load), or a second time, for good. One that only was `late` with its
   * handshake counts as a death at work: the next job starts it once more
   * (a slow first load has the script by then).
   */
  const die = (how: "failed" | "late" | "working"): void => {
    if (how === "failed" || restarted) {
      broken = true;
    }
    restarted = true;
    end("died");
  };

  /** The worker, started if need be; false where there is none. */
  const started = async (): Promise<boolean> => {
    if (broken) {
      return false;
    }
    if (worker && ready) {
      return await ready;
    }
    let w: Worker;
    try {
      w = spec.start();
    } catch {
      broken = true;
      return false;
    }
    worker = w;
    let said = false;
    const handshake = new Promise<boolean>((resolve) => {
      notReady = () => resolve(false);
      // a stopped worker's last word is not about the one now running
      w.addEventListener(
        "message",
        ({ data }: MessageEvent<Reply & { ready?: true }>) => {
          if (worker !== w) {
            return;
          }
          if (data.ready) {
            said = true;
            resolve(true);
            return;
          }
          const settle = held;
          held = null;
          settle?.(data);
        }
      );
    });
    ready = handshake;
    const overdue = setTimeout(() => {
      if (worker === w && !said) {
        die("late");
      }
    }, spec.handshakeMs ?? HANDSHAKE_MS);
    void handshake.then(() => clearTimeout(overdue));
    w.addEventListener("error", (event) => {
      event.preventDefault();
      if (worker === w) {
        die(said ? "working" : "failed");
      }
    });
    // a reply that cannot be read: its job would wait for ever, and what
    // it handed over is lost — as good as a dead worker
    w.addEventListener("messageerror", () => {
      if (worker === w) {
        die(said ? "working" : "failed");
      }
    });
    return await handshake;
  };

  /** Hands `input` to the worker; null when it is to be done here. */
  const send = (
    input: In
  ): { reply: Promise<Reply | Ended>; kept: boolean } | null => {
    const w = worker;
    const packed = w ? spec.pack(input) : null;
    if (!(w && packed)) {
      return null;
    }
    const reply = new Promise<Reply | Ended>((resolve) => {
      held = resolve;
    });
    try {
      w.postMessage(packed.message, packed.transfer);
    } catch {
      // not sent (a clone fails before the transfer): the input is here
      held = null;
      spec.unsent?.(input);
      return null;
    }
    return { reply, kept: packed.kept };
  };

  const hereLater = async (
    input: In,
    mine: number,
    signal?: AbortSignal
  ): Promise<Out> => {
    await laterTask();
    if (mine !== generation) {
      throw stoppedError();
    }
    // nobody waits for it any more: the page does not work it out
    if (signal?.aborted) {
      throw abortError(signal);
    }
    return await spec.here(input);
  };

  const inTurn = async (
    input: In,
    mine: number,
    signal?: AbortSignal
  ): Promise<Out> => {
    // (a job from before a stop starts no worker of its own)
    const there = mine === generation && (await started());
    if (mine !== generation) {
      throw stoppedError();
    }
    const sent = there ? send(input) : null;
    if (!sent) {
      return await hereLater(input, mine, signal);
    }
    const reply = await sent.reply;
    if (reply === "stopped") {
      throw stoppedError();
    }
    if (reply === "died") {
      if (!sent.kept) {
        throw new Error(`the ${spec.name} worker died with a job`);
      }
      return await hereLater(input, mine, signal);
    }
    return spec.unpack(reply, input);
  };

  return {
    run: async (input, signal) => {
      const mine = generation;
      return await gate.run(
        async () => await inTurn(input, mine, signal),
        signal,
        spec.rank?.(input) ?? 0
      );
    },
    stop: () => {
      generation += 1;
      end("stopped");
    },
    up: () => worker !== null && !broken,
  };
}
