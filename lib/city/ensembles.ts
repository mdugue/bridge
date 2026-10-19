/**
 * Ensembles: LoD2 Buildings that are one building to a visitor. The
 * cadastre splits what stands as one house wherever its parcels or its
 * survey do — Dresden's Residenzschloss is three Buildings, among them the
 * main complex (with the Hausmannsturm's spire as one of its parts) and the
 * Hausmannsturm's shaft — while OpenStreetMap maps it as one named outline.
 * Building trees under one named OSM outline, or carrying the same name
 * and touching, are one ensemble: asked, outlined and demolished together,
 * the card's facts the whole ensemble's — across tile edges too
 * (`ensembleGroup`). Unnamed outlines and terraces stay a house each.
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
  /** the key of the named OSM outline covering the tree ("" none;
   *  pipeline/bake/osm_buildings.py `tree_outlines`) */
  outline: string;
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

const side = (
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
  [px, py]: readonly [number, number]
) => Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));

/** Whether an edge of `a` crosses an edge of `b` (a plus-shaped overlap
 *  has no vertex inside the other). */
function crosses(a: readonly Ring[], b: readonly Ring[]): boolean {
  for (const ra of a) {
    for (let i = 0; i < ra.length; i++) {
      const p = ra[i];
      const q = ra[(i + 1) % ra.length];
      for (const rb of b) {
        for (let j = 0; j < rb.length; j++) {
          const r = rb[j];
          const s = rb[(j + 1) % rb.length];
          if (
            side(p, q, r) * side(p, q, s) < 0 &&
            side(r, s, p) * side(r, s, q) < 0
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
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
    (reaches(a, b, gap) || reaches(b, a, gap) || crosses(a, b))
  );
}

/**
 * Each tree's ensemble: the lowest root index among the trees it is joined
 * to (itself when alone). Trees join when they share an OSM outline, or
 * when they carry the same name and their footprints touch — unless both
 * have outlines and those differ (two buildings OSM tells apart, named
 * alike). Transitively: a row of named wings is one.
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
  // each set's outline: a set holds one at most, so a tree OSM's outline
  // misses never bridges two buildings OSM tells apart
  const outlineOf = new Map<number, string>();
  for (const t of trees) {
    if (t.outline) {
      outlineOf.set(t.root, t.outline);
    }
  }
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    const oa = outlineOf.get(ra);
    const ob = outlineOf.get(rb);
    if (ra === rb || (oa && ob && oa !== ob)) {
      return;
    }
    const [to, from] = ra < rb ? [ra, rb] : [rb, ra];
    lead.set(from, to);
    const outline = oa ?? ob;
    if (outline) {
      outlineOf.set(to, outline);
    }
  };
  const byOutline = new Map<string, number>();
  const byName = new Map<string, EnsembleTree[]>();
  for (const t of trees) {
    if (t.outline) {
      const first = byOutline.get(t.outline);
      if (first === undefined) {
        byOutline.set(t.outline, t.root);
      } else {
        join(first, t.root);
      }
    }
    if (t.name && t.rings.length > 0) {
      const named = byName.get(t.name);
      if (named) {
        named.push(t);
      } else {
        byName.set(t.name, [t]);
      }
    }
  }
  for (const named of byName.values()) {
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const [a, b] = [named[i], named[j]];
        const [oa, ob] = [find(a.root), find(b.root)].map((r) =>
          outlineOf.get(r)
        );
        if (
          find(a.root) !== find(b.root) &&
          !(oa && ob && oa !== ob) &&
          footprintsTouch(a.rings, b.rings)
        ) {
          join(a.root, b.root);
        }
      }
    }
  }
  for (const r of lead.keys()) {
    find(r);
  }
  return lead;
}

/** Where a relation's key starts: way ids run below it (1.4·10⁹ in 2026). */
const RELATION_BASE = 2 ** 31;

/**
 * An ensemble's key across the site (0: none) — tiles are baked apart, and
 * a building across a tile edge is two trees in two tiles that share their
 * outline. The outline's own OSM id: a way's as it is, a relation's above
 * `RELATION_BASE`; an id out of that range is hashed (FNV-1a).
 */
export function ensembleGroup(outline: string): number {
  const match = /^([wr])(\d+)$/.exec(outline);
  const id = match ? Number(match[2]) : Number.NaN;
  if (match && id > 0 && id < RELATION_BASE) {
    return match[1] === "w" ? id : RELATION_BASE + id;
  }
  if (!outline) {
    return 0;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < outline.length; i++) {
    h ^= outline.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h === 0 ? 1 : h;
}
