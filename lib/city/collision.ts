/**
 * Pure 2D wall-slide math for walk-mode collision. No THREE, no DOM —
 * the WebGL layer raycasts walls and feeds the horizontal components here.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Removes the into-wall component of a horizontal move so the player slides
 * along the facade instead of stopping dead (or walking through). Motion
 * away from the wall (or along it) is returned unchanged.
 */
export function horizontalSlide(move: Vec2, wallNormal: Vec2): Vec2 {
  const len = Math.hypot(wallNormal.x, wallNormal.z);
  if (len === 0) {
    return move;
  }
  const nx = wallNormal.x / len;
  const nz = wallNormal.z / len;
  const dot = move.x * nx + move.z * nz;
  // dot >= 0 means the move points away from the wall — nothing to cancel.
  if (dot >= 0) {
    return move;
  }
  return { x: move.x - nx * dot, z: move.z - nz * dot };
}
