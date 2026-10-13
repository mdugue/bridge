/**
 * Thin wires as camera-facing ribbons, before the camera: each vertex is a
 * centre point, the segment's direction, the side (±1) and the half-width;
 * the material pushes it across the wire and the view ray
 * (app/_components/wire-ribbons.ts). The trams' overhead line (baked with
 * the fine terrain, lib/city/tram-mesh.ts) and the wires the street lamps
 * hang on (app/_components/lamp-layer.ts). No THREE, no DOM.
 */
import type { Pt } from "./mesh3";

/** Wire segments as camera-facing ribbons: each vertex is a centre point,
 *  the segment's direction, the side (±1) and the half-width. */
export interface Wires {
  dir: number[];
  half: number[];
  index: number[];
  pos: number[];
  side: number[];
}

export function wires(): Wires {
  return { pos: [], dir: [], side: [], half: [], index: [] };
}

export function addWire(w: Wires, pts: Pt[], half: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (dx === 0 && dy === 0 && dz === 0) {
      continue;
    }
    const base = w.pos.length / 3;
    for (const p of [a, b]) {
      for (const s of [-1, 1]) {
        w.pos.push(p.x, p.y, p.z);
        w.dir.push(dx, dy, dz);
        w.side.push(s);
        w.half.push(half);
      }
    }
    w.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}
