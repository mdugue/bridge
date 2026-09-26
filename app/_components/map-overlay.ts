/**
 * The map's own marks in the scene — the ferry lines on the Elbe
 * (riverside-layer.ts) — show only from the air: faded in with the
 * camera's height over the ground, from nothing on foot to full once the
 * view is a map. One shared uniform the render loop sets (create-app.ts),
 * like the fountains' clock.
 */

/** Height over the ground (m) where the marks start to show, and where
 *  they are full. */
export const MAP_FADE_M = { from: 25, to: 60 } as const;

export const MAP_OVERLAY_UNIFORMS = {
  /** the camera's height over the ground under it (m) */
  uMapAltitude: { value: 0 },
};

export function setMapAltitude(metres: number): void {
  MAP_OVERLAY_UNIFORMS.uMapAltitude.value = metres;
}

/** GLSL: the fade factor from the shared altitude uniform. */
export const MAP_FADE_GLSL = `uniform float uMapAltitude;
float mapFade() {
	return smoothstep( ${MAP_FADE_M.from.toFixed(1)}, ${MAP_FADE_M.to.toFixed(1)}, uMapAltitude );
}
`;
