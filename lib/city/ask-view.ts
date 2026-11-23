/**
 * Where *Frag die Stadt*'s `zeige` puts the camera (ADR 0056): a vantage
 * looking at a target the tools found. On foot the walker stands in front
 * of it, on the side they come from, far enough back to see it whole; from
 * the air the camera hangs off it at about 35° down. The pitch takes the
 * eye's ground for the target's (the scene measures the real one on
 * arrival). Pure: the card hands the result to the scene's glide.
 */
import type { ViewpointGeometry } from "./site";

const DEG = 180 / Math.PI;

export interface AskTarget {
  /** height above its ground (m), where the tools know it */
  h?: number;
  x: number;
  y: number;
}

/** Eye height on foot (m). */
const EYE = 1.6;

/**
 * The vantage on `target`, seen from the side of `from` (the camera's
 * place now; straight from the south where it stands on the target).
 */
export function askView(
  target: AskTarget,
  from: { x: number; y: number },
  aerial: boolean
): ViewpointGeometry {
  const h = Math.max(target.h ?? 15, 4);
  let dx = from.x - target.x;
  let dy = from.y - target.y;
  if (Math.hypot(dx, dy) < 1) {
    dx = 0;
    dy = -1;
  }
  const len = Math.hypot(dx, dy);
  // far enough to see it whole: its height across a 60° lens, and a street
  const back = aerial ? Math.max(160, h * 2.4) : Math.max(35, h * 1.4 + 15);
  const above = aerial ? Math.max(90, h * 1.8) : EYE;
  const ex = target.x + (dx / len) * back;
  const ey = target.y + (dy / len) * back;
  // look at a third of its height (on foot), at its foot (from the air)
  const aimHeight = aerial ? h * 0.3 : h * 0.35;
  const pitch = Math.atan2(aimHeight - above, back) * DEG;
  const heading = (Math.atan2(target.x - ex, target.y - ey) * DEG + 360) % 360;
  return {
    epsg: { x: Math.round(ex * 10) / 10, y: Math.round(ey * 10) / 10 },
    aboveGround: above,
    headingDeg: Math.round(heading * 10) / 10,
    pitchDeg: Math.round(Math.max(-60, Math.min(35, pitch)) * 10) / 10,
    fov: 60,
    mode: aerial ? "fly" : "walk",
  };
}
