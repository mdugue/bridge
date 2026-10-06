import { expect, test } from "bun:test";
import {
  backoffMs,
  createRetryTally,
  createUsableClock,
  errorVerdict,
  type FetchAnswer,
  healDelayMs,
  isNetworkFailure,
  isNetworkMessage,
  NetworkError,
  type RetryEnv,
  RETRY_CAP_MS,
  retryAfterMs,
  statusVerdict,
  withRetry,
} from "./fetch-retry";

/**
 * A page on a fake clock: sleeping moves the clock, the page is usable
 * except over the `hidden` spans (ms, half-open), and waiting for it to be
 * usable skips to the end of the span it is in.
 */
function fakePage(hidden: [number, number][] = []) {
  let now = 0;
  const usableAt = (t: number) => !hidden.some(([a, b]) => t >= a && t < b);
  const usableBetween = (to: number) => {
    let total = 0;
    for (let t = 0; t < to; t += 10) {
      total += usableAt(t) ? Math.min(10, to - t) : 0;
    }
    return total;
  };
  const env: RetryEnv = {
    now: () => now,
    random: () => 0.5,
    sleep: (ms, signal) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      now += ms;
      return Promise.resolve();
    },
    whenUsable: () => {
      const span = hidden.find(([a, b]) => now >= a && now < b);
      if (span) {
        now = span[1];
      }
      return Promise.resolve();
    },
    usableMs: () => usableBetween(now),
    describe: () => "online visible",
  };
  return { env, at: () => now };
}

const ok = (value = "body"): FetchAnswer<string> => ({ status: 200, value });

test("statuses: ok, absent, transient (timeouts, throttling, the server's own errors), fatal", () => {
  expect(statusVerdict(200)).toBe("ok");
  expect(statusVerdict(206)).toBe("ok");
  expect(statusVerdict(404)).toBe("absent");
  expect(statusVerdict(410)).toBe("absent");
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    expect(statusVerdict(status)).toBe("transient");
  }
  for (const status of [400, 401, 403, 0]) {
    expect(statusVerdict(status)).toBe("fatal");
  }
});

test("errors: an abort is the caller's, the browsers' network errors are transient, a parse error is fatal", () => {
  expect(errorVerdict(new DOMException("x", "AbortError"))).toBe("aborted");
  for (const message of [
    "Load failed",
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "The compressed data was not valid",
  ]) {
    expect(errorVerdict(new TypeError(message))).toBe("transient");
  }
  expect(errorVerdict(new DOMException("x", "NetworkError"))).toBe("transient");
  expect(errorVerdict(new NetworkError("network: x", 3))).toBe("transient");
  expect(errorVerdict(new SyntaxError("Unexpected token"))).toBe("fatal");
  expect(errorVerdict(new RangeError("out of bounds"))).toBe("fatal");
});

test("a load-error is the network's when it gave up on it, or in a browser's network text — not any TypeError", () => {
  expect(isNetworkFailure(new NetworkError("network: Load failed", 4))).toBe(
    true
  );
  expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);
  expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
  expect(
    isNetworkFailure(new TypeError("The network connection was lost."))
  ).toBe(true);
  expect(
    isNetworkFailure(new TypeError("Cannot read properties of undefined"))
  ).toBe(false);
  expect(
    isNetworkFailure(new Error("Failed to load model with error code 404"))
  ).toBe(false);
  expect(isNetworkMessage("network: Load failed (5 attempts)")).toBe(true);
  expect(isNetworkMessage("Load failed")).toBe(true);
  expect(isNetworkMessage("Failed to fetch /x: HTTP 404")).toBe(false);
});

test("the backoff doubles from half a second to its cap, spread ×0.5–1.5", () => {
  expect(backoffMs(0, 0.5)).toBe(500);
  expect(backoffMs(1, 0.5)).toBe(1000);
  expect(backoffMs(3, 0.5)).toBe(4000);
  expect(backoffMs(10, 0.5)).toBe(RETRY_CAP_MS);
  expect(backoffMs(0, 0)).toBe(250);
  expect(backoffMs(0, 0.999)).toBeCloseTo(749.5);
});

test("a Retry-After is read as seconds or as a date, capped, and ignored when unreadable", () => {
  expect(retryAfterMs("3", 0)).toBe(3000);
  expect(retryAfterMs(" 0 ", 0)).toBe(0);
  const now = Date.parse("2026-10-06T04:24:00Z");
  expect(retryAfterMs("Tue, 06 Oct 2026 04:24:07 GMT", now)).toBe(7000);
  expect(retryAfterMs("Tue, 06 Oct 2026 04:23:00 GMT", now)).toBe(0);
  expect(retryAfterMs("86400", 0)).toBe(60_000);
  expect(retryAfterMs("soon", 0)).toBeUndefined();
  expect(retryAfterMs(null, 0)).toBeUndefined();
});

test("the usable clock stands still while the page is hidden or offline", () => {
  const clock = createUsableClock(true, 0);
  clock.set(false, 1000);
  expect(clock.usableMs(5000)).toBe(1000);
  clock.set(true, 9000);
  clock.set(true, 9500);
  expect(clock.usableMs(10_000)).toBe(2000);
  const hidden = createUsableClock(false, 0);
  expect(hidden.usableMs(3000)).toBe(0);
});

test("a network error is retried until an answer comes", async () => {
  const page = fakePage();
  let calls = 0;
  const answer = await withRetry(
    () => {
      calls++;
      return calls < 3
        ? Promise.reject(new TypeError("Load failed"))
        : Promise.resolve(ok());
    },
    { budgetMs: 20_000, env: page.env }
  );
  expect(answer.value).toBe("body");
  expect(calls).toBe(3);
  // waited 0.5 s, then 1 s
  expect(page.at()).toBe(1500);
});

test("an absent or fatal status is answered at once, never retried", async () => {
  for (const status of [404, 403]) {
    let calls = 0;
    const answer = await withRetry(
      () => {
        calls++;
        return Promise.resolve({ status, value: "" });
      },
      { budgetMs: 20_000, env: fakePage().env }
    );
    expect(answer.status).toBe(status);
    expect(calls).toBe(1);
  }
});

test("a fatal error and an abort reject as they are, without a retry", async () => {
  const parse = new SyntaxError("Unexpected token");
  let calls = 0;
  // bun-types declare the `rejects` matchers as void, but bun resolves them
  // asynchronously — dropping the await would end the test before it runs.
  // oxlint-disable-next-line typescript/await-thenable
  await expect(
    withRetry(
      () => {
        calls++;
        return Promise.reject(parse);
      },
      { budgetMs: 20_000, env: fakePage().env }
    )
  ).rejects.toBe(parse);
  const abort = new DOMException("aborted", "AbortError");
  // (bun-types declare `rejects` as void; see above)
  // oxlint-disable-next-line typescript/await-thenable
  await expect(
    withRetry(
      () => {
        calls++;
        return Promise.reject(abort);
      },
      { budgetMs: 20_000, env: fakePage().env }
    )
  ).rejects.toBe(abort);
  expect(calls).toBe(2);
});

test("an abort during the wait ends the retries", async () => {
  const aborter = new AbortController();
  let calls = 0;
  const run = withRetry(
    () => {
      calls++;
      aborter.abort();
      return Promise.reject(new TypeError("Load failed"));
    },
    { budgetMs: 20_000, env: fakePage().env, signal: aborter.signal }
  );
  // (bun-types declare `rejects` as void; see above)
  // oxlint-disable-next-line typescript/await-thenable
  await expect(run).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});

test("a transient status waits at least its Retry-After", async () => {
  const page = fakePage();
  let calls = 0;
  await withRetry(
    () => {
      calls++;
      return Promise.resolve(
        calls === 1 ? { status: 503, retryAfter: "4", value: "" } : ok()
      );
    },
    { budgetMs: 20_000, env: page.env }
  );
  expect(page.at()).toBe(4000);
});

test("the budget spent, the retries give up with a NetworkError that says how often and where", async () => {
  const page = fakePage();
  const notes: number[] = [];
  let calls = 0;
  const run = withRetry(
    () => {
      calls++;
      return Promise.reject(new TypeError("Load failed"));
    },
    {
      budgetMs: 8000,
      env: page.env,
      onRetry: (note) => notes.push(note.attempt),
    }
  );
  // (bun-types declare `rejects` as void; see above)
  // oxlint-disable-next-line typescript/await-thenable
  await expect(run).rejects.toBeInstanceOf(NetworkError);
  const error = (await run.catch((err: unknown) => err)) as NetworkError;
  // 0.5 + 1 + 2 + 4 s waited; the next 8 s would pass the budget
  expect(calls).toBe(5);
  expect(notes).toEqual([1, 2, 3, 4]);
  expect(page.at()).toBe(7500);
  expect(error.transient).toBe(true);
  expect(error.attempts).toBe(5);
  expect(error.message).toBe(
    "network: Load failed (5 attempts, online visible)"
  );
});

test("time the page is hidden or offline does not count against the budget", async () => {
  // hidden from 1 s to 61 s: the retries wait it out and still have budget
  const page = fakePage([[1000, 61_000]]);
  let calls = 0;
  const answer = await withRetry(
    () => {
      calls++;
      return calls < 5
        ? Promise.reject(new TypeError("Load failed"))
        : Promise.resolve(ok());
    },
    { budgetMs: 10_000, env: page.env }
  );
  expect(answer.status).toBe(200);
  expect(page.at()).toBeGreaterThan(61_000);
});

test("retries in a burst make one note at its start and one per interval, with the count", () => {
  const tally = createRetryTally(10_000);
  const note = { attempt: 1, delayMs: 500, cause: "Load failed" };
  expect(tally.add(note, 0)).toBe("1× Load failed");
  expect(tally.add(note, 100)).toBeNull();
  expect(tally.add(note, 5000)).toBeNull();
  expect(tally.add({ ...note, cause: "HTTP 503" }, 10_000)).toBe("3× HTTP 503");
});

test("the healer waits longer each time, the last wait repeating", () => {
  expect([0, 1, 2, 3, 4, 9].map(healDelayMs)).toEqual([
    5000, 15_000, 45_000, 120_000, 120_000, 120_000,
  ]);
});
