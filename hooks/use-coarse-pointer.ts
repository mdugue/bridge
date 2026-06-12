import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse) and (hover: none)";

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => mql.removeEventListener("change", onStoreChange);
}

/**
 * True on touch-first devices (phones/tablets): the primary pointer is
 * coarse and cannot hover. Drives the touch UI (joystick, drawer, action
 * bar) independently of viewport width.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
