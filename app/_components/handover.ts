/**
 * The Laden → Erster Frame handover.
 *
 * This was a shared-element morph: the dark surface shrank into the pill, the
 * plate stack into its glyph, each swatch into a segment, via React's
 * `<ViewTransition>`. It looked right on paper and stuttered on every real
 * device it was tried on, and the reason is structural rather than a tuning
 * problem. A view transition animates its groups by **width and height**, which
 * is layout and paint work on the main thread — the same thread that, at
 * exactly this moment, is compiling shaders, drawing the first shadow map and
 * running the post stack for the scene's most expensive frames. Holding the
 * streaming tail back (see `CityWalkHandle.startStreaming`) bought a lot, but
 * it cannot buy the frames the scene itself needs.
 *
 * So the handover is a cross-fade now, and deliberately nothing more: the
 * scrim's `opacity` and the pill's `opacity`/`transform`. Those are composited
 * off the main thread, so they keep their frame rate while the renderer is
 * busy — the one property that matters here. The narrative survives: the dark
 * surface lifts and the live scene is revealed underneath, rather than being
 * faded in over it, because the scene has been rendering behind the scrim the
 * whole time.
 *
 * The animations themselves live in `app/globals.css`.
 */

/** How long the handover runs, as the stylesheet defines it. */
export function handoverDurationMs(): number {
  const FALLBACK_MS = 450;
  if (typeof document === "undefined") {
    return FALLBACK_MS;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--handover-duration")
    .trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    return FALLBACK_MS;
  }
  return raw.endsWith("ms") ? value : value * 1000;
}
