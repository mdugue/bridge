/**
 * Runs `then` now, or once the page is in view again: a page reloaded in
 * the background boots hidden, which is where iOS takes GPUs away (the
 * GPU recovery's reload waits for it, city-walk.tsx).
 */
export function whenVisible(then: () => void): void {
  if (!document.hidden) {
    then();
    return;
  }
  const onShow = () => {
    if (!document.hidden) {
      document.removeEventListener("visibilitychange", onShow);
      then();
    }
  };
  document.addEventListener("visibilitychange", onShow);
}
