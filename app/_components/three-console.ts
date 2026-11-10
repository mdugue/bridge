import { getConsoleFunction, setConsoleFunction } from "three/webgpu";

/**
 * three's own errors into the crash trail. three reports what fails
 * inside it — a render pipeline whose creation failed, with WebGPU's
 * reason — only through its console function (`error()` in three's
 * utils), never to `renderer.onError`. The trail then saw only what came
 * after: "Invalid RenderPipeline … is invalid due to a previous error"
 * (Sentry CITY-WALK-S), never the error before it. So three's `error`
 * calls are noted too, as text, and still printed as three prints them.
 * Its `log` and `warn` (deprecations, once-a-session hints) stay on the
 * console only.
 */

/** three's console function: a kind, its `THREE.`-prefixed message, the
 *  rest of what it was called with. */
type ConsoleFunction = Parameters<typeof setConsoleFunction>[0];

/** One of three's console calls as a line of text: its message and the
 *  parameters that read as text (an error's message, a string, a
 *  number); an object three hands along for the console is left out. */
export function threeErrorText(message: string, params: unknown[]): string {
  const parts = [message];
  for (const param of params) {
    if (typeof param === "string" || typeof param === "number") {
      parts.push(String(param));
    } else if (param instanceof Error) {
      parts.push(param.message);
    }
  }
  return parts.join(" ");
}

/** What three itself prints without a console function (utils.js). */
function print(
  type: "log" | "warn" | "error",
  message: string,
  params: unknown[]
): void {
  const write = { error: console.error, warn: console.warn, log: console.info }[
    type
  ];
  const [first] = params as [
    { isStackTrace?: boolean; getError?: (m: string) => Error } | undefined,
  ];
  if (first?.isStackTrace && first.getError) {
    write(first.getError(message));
  } else {
    write(message, ...params);
  }
}

/**
 * Routes three's errors to `noteError` (the trail's coalescing error
 * note) as well as to the console function that was there before, or
 * the console. Returns the undo, which puts that function back.
 */
export function routeThreeErrors(
  noteError: (text: string) => void
): () => void {
  // three's own is null until one is set (its typing says otherwise)
  const before = getConsoleFunction() as ConsoleFunction | null;
  const routed: ConsoleFunction = (type, message, ...params) => {
    if (type === "error") {
      try {
        noteError(threeErrorText(message, params));
      } catch {
        // A trail that fails is no reason to lose the console line.
      }
    }
    if (before) {
      before(type, message, ...params);
    } else {
      print(type, message, params);
    }
  };
  setConsoleFunction(routed);
  return () => {
    if (getConsoleFunction() === routed) {
      // three takes no null back: printing as three does is the same
      setConsoleFunction(
        before ?? ((type, message, ...params) => print(type, message, params))
      );
    }
  };
}
