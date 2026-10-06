/**
 * When a failed fetch is worth another try, and how long to wait for it.
 * Nothing used to retry: a tile whose download hit a blip (Safari's "Load
 * failed" on a Wi-Fi handover, a resume from the background, a reload that
 * cancelled it) stayed a hole, and one that was the spawn tile failed the
 * boot. The policy here: an abort is the caller's (never retried), a 404 or
 * 410 is absent, a network error or a 408/425/429/5xx is transient and
 * retried with jittered exponential backoff (a Retry-After honoured), any
 * other status is fatal. The budget counts only time the page could have
 * succeeded in — visible and online — so a phone in a pocket does not use
 * it up. The browser side (the fetch, the page's state) is
 * app/_components/fetch-optional.ts `fetchBytes` and
 * app/_components/net-gate.ts. No DOM.
 */

/** What one fetch's outcome means for the next. */
export type FetchVerdict = "ok" | "aborted" | "absent" | "transient" | "fatal";

/** The first wait after a failure, doubled per attempt up to the cap. */
export const RETRY_BASE_MS = 500;
export const RETRY_CAP_MS = 15_000;
/** The longest a Retry-After is honoured for. */
export const RETRY_AFTER_CAP_MS = 60_000;
/** How long a tile's content is retried (ms of a usable page). */
export const TILE_FETCH_BUDGET_MS = 20_000;
/** …an optional side file (lamps, rails, …): it must not hold up the
 *  tile's serial dressing chain for long. */
export const OPTIONAL_FETCH_BUDGET_MS = 8_000;
/** …the site's manifest, before the copy the browser cached will do. */
export const MANIFEST_FETCH_BUDGET_MS = 20_000;
/** How long the boot waits for the network (the tileset, the spawn tile). */
export const BOOT_NET_WAIT_MS = 60_000;
/** When the tiles that gave up on the network are asked for again: the
 *  last step repeats while any are left. */
export const HEAL_DELAYS_MS = [5_000, 15_000, 45_000, 120_000] as const;

/** A fetch that gave up after its budget (or a load that gave up on one). */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
  /** a later try may succeed (what the tile healer and the boot read) */
  readonly transient = true;
  readonly attempts: number;
  constructor(message: string, attempts: number, cause?: unknown) {
    super(message, { cause });
    this.attempts = attempts;
  }
}

/** The prefix of every network give-up's message: the HUD and the crash
 *  trail tell a network cause by it. */
export const NETWORK_PREFIX = "network: ";

/** What a final HTTP status means. */
export function statusVerdict(status: number): FetchVerdict {
  if (status >= 200 && status < 300) {
    return "ok";
  }
  if (status === 404 || status === 410) {
    return "absent";
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return "transient";
  }
  return "fatal";
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "name" in err
    ? String(err.name)
    : undefined;
}

/**
 * What an error thrown by the fetch or its body read means. Every browser
 * rejects a failed request with a TypeError (Safari "Load failed", Chrome
 * "Failed to fetch", Firefox "NetworkError when attempting to fetch
 * resource."), and a body cut off mid-transfer too — worth another try.
 * Anything else (a SyntaxError, a RangeError) is not the network's, and
 * neither is a gzip that does not inflate once read whole: the browser
 * side rethrows that as a plain Error (fetch-optional.ts `inflate`).
 */
export function errorVerdict(err: unknown): FetchVerdict {
  const name = errorName(err);
  if (name === "AbortError") {
    return "aborted";
  }
  if (err instanceof TypeError || name === "NetworkError" || isTransient(err)) {
    return "transient";
  }
  return "fatal";
}

function isTransient(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "transient" in err &&
    err.transient === true
  );
}

/** The browsers' texts for a request the network failed (or cancelled):
 *  the whole message, so "Failed to fetch /x: HTTP 404" is not one. */
const NETWORK_TEXT =
  /^(?:load failed|failed to fetch|networkerror when attempting to fetch resource|the network connection was lost|the internet connection appears to be offline|network request failed|cancelled)\.?$/i;

/**
 * Whether an error that reached us from elsewhere (a tile's load-error)
 * is the network's: a give-up after retries, or a TypeError in one of the
 * browsers' network texts — not any TypeError, which is as often a bug.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (isTransient(err)) {
    return true;
  }
  return err instanceof TypeError && NETWORK_TEXT.test(err.message);
}

/** Whether a message (a boot failure's, a layer's) names a network cause. */
export function isNetworkMessage(message: string): boolean {
  return message.startsWith(NETWORK_PREFIX) || NETWORK_TEXT.test(message);
}

/**
 * The wait after the `attempt`-th failure (0 = the first): 0.5 s doubled
 * per attempt, capped at 15 s, then spread by ×0.5–1.5 (`random` in
 * [0, 1)) — so the tiles that failed together do not come back together.
 */
export function backoffMs(attempt: number, random: number): number {
  const base = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
  return base * (0.5 + random);
}

/**
 * A Retry-After header as a wait (ms): delta-seconds or an HTTP date,
 * capped; undefined when absent or unreadable.
 */
export function retryAfterMs(
  header: string | null | undefined,
  nowMs: number
): number | undefined {
  const value = header?.trim();
  if (!value) {
    return undefined;
  }
  const wait = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - nowMs;
  return Number.isFinite(wait)
    ? Math.min(Math.max(wait, 0), RETRY_AFTER_CAP_MS)
    : undefined;
}

/**
 * A clock that runs only while the page is usable (visible and online):
 * `set` says when that changes, `usableMs` how long it has been usable
 * since the clock started.
 */
export interface UsableClock {
  set: (usable: boolean, nowMs: number) => void;
  usableMs: (nowMs: number) => number;
}

export function createUsableClock(usable: boolean, nowMs: number): UsableClock {
  let total = 0;
  let since: number | null = usable ? nowMs : null;
  return {
    set: (now, at) => {
      if (now && since === null) {
        since = at;
      } else if (!now && since !== null) {
        total += Math.max(at - since, 0);
        since = null;
      }
    },
    usableMs: (at) => total + (since === null ? 0 : Math.max(at - since, 0)),
  };
}

/** What one attempt returns: its final HTTP status and what it read. */
export interface FetchAnswer<T> {
  status: number;
  /** the Retry-After header of a transient status */
  retryAfter?: string | null;
  value: T;
}

/** The page the retries run in (net-gate.ts; a fake clock in the tests). */
export interface RetryEnv {
  /** resolves once a try can succeed (the page visible and online) */
  whenUsable: (signal?: AbortSignal) => Promise<void>;
  /** waits `ms`; rejects when `signal` aborts */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** the page's usable time so far (a UsableClock) */
  usableMs: () => number;
  /** wall-clock ms (Retry-After dates) */
  now: () => number;
  random: () => number;
  /** the page's state for a give-up's message ("online visible") */
  describe?: () => string;
}

/** One retry about to wait (the crash trail's "net-retry"). */
export interface RetryNote {
  /** the attempt that failed (1 = the first) */
  attempt: number;
  delayMs: number;
  cause: string;
}

export interface RetryOptions {
  /** how long transient failures are retried, in usable ms */
  budgetMs: number;
  env: RetryEnv;
  signal?: AbortSignal;
  onRetry?: (note: RetryNote) => void;
}

function causeText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** The wait before the next try, or the reason a transient failure is
 *  final (thrown as it is). */
async function nextWait<T>(
  attempt: () => Promise<FetchAnswer<T>>,
  env: RetryEnv,
  signal: AbortSignal | undefined,
  tries: number
): Promise<{ answer: FetchAnswer<T> } | { cause: unknown; delayMs: number }> {
  const backoff = backoffMs(tries - 1, env.random());
  try {
    const answer = await attempt();
    if (statusVerdict(answer.status) !== "transient") {
      return { answer };
    }
    const after = retryAfterMs(answer.retryAfter, env.now()) ?? 0;
    return {
      cause: new Error(`HTTP ${answer.status}`),
      delayMs: Math.max(backoff, after),
    };
  } catch (err) {
    // an abort that surfaced as something else is still the caller's
    if (signal?.aborted) {
      throw abortError();
    }
    if (errorVerdict(err) !== "transient") {
      throw err;
    }
    return { cause: err, delayMs: backoff };
  }
}

/**
 * Runs `attempt` until it answers with a status that is not transient (ok,
 * absent, fatal: the caller decides), retrying network errors and
 * transient statuses for `budgetMs` of usable time. The first try goes at
 * once; each later one after its backoff and once the page is usable. An
 * abort rejects at once with an AbortError; a fatal error rejects as it
 * is; a budget spent rejects with a NetworkError.
 */
export async function withRetry<T>(
  attempt: () => Promise<FetchAnswer<T>>,
  opts: RetryOptions
): Promise<FetchAnswer<T>> {
  const { budgetMs, env, signal, onRetry } = opts;
  const start = env.usableMs();
  for (let tries = 1; ; tries++) {
    if (signal?.aborted) {
      throw abortError();
    }
    const next = await nextWait(attempt, env, signal, tries);
    if ("answer" in next) {
      return next.answer;
    }
    const spent = env.usableMs() - start;
    if (spent + next.delayMs > budgetMs) {
      const state = env.describe?.();
      throw new NetworkError(
        `${NETWORK_PREFIX}${causeText(next.cause)} (${tries} attempts${state ? `, ${state}` : ""})`,
        tries,
        next.cause
      );
    }
    onRetry?.({
      attempt: tries,
      delayMs: next.delayMs,
      cause: causeText(next.cause),
    });
    await env.sleep(next.delayMs, signal);
    await env.whenUsable(signal);
  }
}

/**
 * The crash trail's "net-retry" notes, coalesced: a burst of retries (a
 * whole view of tiles losing the network at once) is one note at its start
 * and one per `everyMs` while it lasts, with the count since the last —
 * the trail keeps only its newest forty events.
 */
export function createRetryTally(everyMs: number) {
  let count = 0;
  let last = "";
  let notedAt = Number.NEGATIVE_INFINITY;
  return {
    /** counts a retry; the note's detail when one is due */
    add(note: RetryNote, nowMs: number): string | null {
      count++;
      last = note.cause;
      if (nowMs - notedAt < everyMs) {
        return null;
      }
      const detail = `${count}× ${last}`;
      count = 0;
      notedAt = nowMs;
      return detail;
    },
  };
}

/** The wait before the healer's `step`-th try (the last step repeats). */
export function healDelayMs(step: number): number {
  return HEAL_DELAYS_MS[Math.min(step, HEAL_DELAYS_MS.length - 1)];
}
