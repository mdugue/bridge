/**
 * `useOnce`: a value made once for a component's life. (The hole in the
 * destructuring: react/hook-use-state asks for a setter's place.)
 */
import { useState } from "react";

/** A value made once for the component's life, which useMemo does not
 *  promise: React may drop a memo's cache. */
export function useOnce<T>(init: () => T): T {
  const [value, ,] = useState(init);
  return value;
}
