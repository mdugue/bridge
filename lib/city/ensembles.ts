/**
 * Ensembles: LoD2 Buildings that are one building to a visitor. The
 * cadastre splits what stands as one house wherever its parcels or its
 * survey do — Dresden's Residenzschloss is two Buildings, the main complex
 * (with the Hausmannsturm's spire as one of its parts) and the
 * Hausmannsturm's shaft — while OpenStreetMap maps it as one outline with
 * one name. Building trees that carry the same OSM name and touch are one
 * ensemble: asked, outlined and demolished together, the card's facts the
 * whole ensemble's. A name is required: unnamed terraces stay a house each.
 * No THREE, no DOM.
 */

type Ring = readonly (readonly [number, number])[];

/** How far apart (m) two footprints may lie and still touch: the survey's
 *  neighbours share their walls, give or take its rounding. */
export const ENSEMBLE_TOUCH_M = 0.5;

/** One building tree, as the bake knows it. */
export interface EnsembleTree {
  /** the tree's OSM name ("" none) */
  name: string;
  /** the root's object index */
  root: number;
  /** every footprint ring of the tree (EPSG metres) */
  rings: readonly Ring[];
}

interface Box {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

function boxOf(rings: readonly Ring[]): Box {
  const box = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return box;
}

const boxesMeet = (a: Box, b: Box, gap: number) =>
  a.minX <= b.maxX + gap &&
  b.minX <= a.maxX + gap &&
  a.minY <= b.maxY + gap &&
  b.minY <= a.maxY + gap;

function segmentDistance2(
  [px, py]: readonly [number, number],
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number]
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 > 0
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      : 0;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

function inside([px, py]: readonly [number, number], ring: Ring): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < xi + ((py - yi) * (xj - xi)) / (yj - yi)) {
      odd = !odd;
    }
  }
  return odd;
}

/** Whether a vertex of `a` lies within `gap` of `b`'s outline or inside it. */
function reaches(a: readonly Ring[], b: readonly Ring[], gap: number): boolean {
  const gap2 = gap * gap;
  for (const ring of a) {
    for (const p of ring) {
      for (const other of b) {
        if (inside(p, other)) {
          return true;
        }
        for (let i = 0; i < other.length; i++) {
          const q = other[(i + 1) % other.length];
          if (segmentDistance2(p, other[i], q) <= gap2) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/** Whether two footprints touch, overlap or lie within `gap` (m). */
export function footprintsTouch(
  a: readonly Ring[],
  b: readonly Ring[],
  gap = ENSEMBLE_TOUCH_M
): boolean {
  return (
    boxesMeet(boxOf(a), boxOf(b), gap) &&
    (reaches(a, b, gap) || reaches(b, a, gap))
  );
}

/**
 * Each tree's ensemble: the lowest root index among the trees it is joined
 * to (itself when alone). Trees join when they carry the same name and
 * their footprints touch, transitively — a row of named wings is one.
 */
export function ensembleRoots(
  trees: readonly EnsembleTree[]
): Map<number, number> {
  const lead = new Map<number, number>();
  for (const t of trees) {
    lead.set(t.root, t.root);
  }
  const find = (r: number): number => {
    let at = r;
    while (lead.get(at) !== at) {
      at = lead.get(at) ?? at;
    }
    lead.set(r, at);
    return at;
  };
  const byName = new Map<string, EnsembleTree[]>();
  for (const t of trees) {
    if (t.name && t.rings.length > 0) {
      byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
    }
  }
  for (const named of byName.values()) {
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const a = find(named[i].root);
        const b = find(named[j].root);
        if (a !== b && footprintsTouch(named[i].rings, named[j].rings)) {
          lead.set(Math.max(a, b), Math.min(a, b));
        }
      }
    }
  }
  for (const r of lead.keys()) {
    find(r);
  }
  return lead;
}
