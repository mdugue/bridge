/**
 * The Laden → Erster Frame handover, and why it no longer animates.
 *
 * It began as a shared-element morph: the dark surface shrank into the pill,
 * the plate stack into its glyph, each swatch into a segment, via React's
 * `<ViewTransition>`. It stuttered on every real device. The reason is
 * structural rather than a tuning problem — a view transition animates its
 * groups by **width and height**, which is layout and paint work on the main
 * thread, at the exact moment that thread is compiling shaders, drawing the
 * first shadow map and running the post stack for the scene's most expensive
 * frames. Holding the streaming tail back (see `CityWalkHandle.startStreaming`)
 * bought a lot, but it cannot buy the frames the scene itself needs.
 *
 * The next version was a plain cross-fade — opacity and transform only, both
 * composited off the main thread. It still did not read as smooth. Beyond a
 * point this is not something CSS can fix: the first seconds of the scene are
 * genuinely frame-starved, and any animation laid over them inherits that.
 *
 * So nothing animates here any more. The loading screen is frosted glass
 * (`--hud-veil` in globals.css) rather than a curtain: while the canvas has
 * nothing to show it sits on the opaque scrim below and reads as the same dark
 * screen it always was, and the moment the first frame is drawn the city
 * appears behind it, softened by the backdrop blur. That arrival costs React
 * and the main thread nothing at all — it is the renderer painting under a
 * layer that is already there. After a short hold the glass is removed in one
 * frame, from blurred city to sharp city, which is a far smaller step than
 * dark screen to city and has no in-between frames to drop.
 */

/**
 * How long the veil stays up once the scene is live behind it.
 *
 * Long enough to see the city arrive through the glass, short enough not to
 * feel like a delay — and the scene is already interactive throughout, the
 * veil stops taking pointer events the moment the first frame lands.
 */
export const VEIL_HOLD_MS = 600;
