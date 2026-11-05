/** Whether the viewer's mobile media query matches, kept live for React. */
import { useSyncExternalStore } from "react";
import { MOBILE_MEDIA_QUERY as QUERY } from "./scene-profile";

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
