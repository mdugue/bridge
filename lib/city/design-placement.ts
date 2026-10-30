/**
 * Where a loaded design stands (ADR 0054): the pure half of the design
 * layer (app/_components/design-layer.ts). A design comes as a glTF in its
 * own frame — Y up, metres, and almost never a word on where in the world
 * it belongs — and lands in the site's frame by a placement: an anchor on
 * the ground in the site's EPSG coordinates, a turn about the vertical and
 * the height of its lowest point. No THREE, no DOM.
 *
 * The anchor is the middle of the design's box in plan at its lowest
 * point: turning it turns it about its middle, and setting it on the
 * ground sets its foot there.
 */

import { distanceOutside } from "./geolocation";
import { DEG2RAD } from "./pose";
import type { TerrainBounds } from "./terrain-geometry";

/** A design's box in its own frame (glTF: Y up, −Z north where it is
 *  north at all), computed in doubles from its nodes. */
export interface DesignBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** Where a design stands in the site. */
export interface DesignPlacement {
  /** the anchor's easting and northing, the site's EPSG (m) */
  east: number;
  north: number;
  /** the elevation of the design's lowest point (m above NHN) */
  base: number;
  /** a turn about the vertical, degrees clockwise seen from above (a
   *  compass turn: 90 points the design's north to the east) */
  rotation: number;
}

/** What the file said about its place, as the panel tells it. */
export type PlacementSource =
  /** the design's own coordinates are the Land's (UTM), its heights NHN */
  | "file"
  /** UTM in plan, heights relative: set on the ground */
  | "file-plan"
  /** a placement file (`parsePlacementFile`) */
  | "placement-file"
  /** nothing: set down in front of the player */
  | "here"
  /** moved or turned in the panel */
  | "manual";

/** Eastings a UTM zone's projected coordinates take (m), generously. */
const EAST_MIN = 100_000;
const EAST_MAX = 900_000;
/** Northings across Germany (47°–55° N, m), generously. */
const NORTH_MIN = 5_200_000;
const NORTH_MAX = 6_200_000;
/** Heights a design's own Y can take to be read as NHN (m): the Land's
 *  ground lies between −5 (the Wilstermarsch) and 2962 (the Zugspitze). */
const NHN_MIN = -10;
const NHN_MAX = 3000;
/** How far a design's own NHN base may lie from the ground under it and
 *  still be believed (m): further, its heights are relative. */
const NHN_TRUST_M = 40;

/** The UTM zone of an ETRS89/UTM EPSG code (25832 → 32), or null. */
export function utmZone(epsg: number): number | null {
  return epsg >= 25_828 && epsg <= 25_838 ? epsg - 25_800 : null;
}

/** What a design's own coordinates say about its place, if anything. */
export interface Georeference {
  east: number;
  north: number;
  /** the design's lowest point as NHN, where its heights look like it */
  base: number | null;
  /** the eastings carried the zone in front (33 412 500 for 412 500) */
  zonePrefixed: boolean;
}

/**
 * Reads a design's box for coordinates of the site's UTM zone: an easting
 * in X — plain or with the zone in front, as German survey plans often
 * write it — and a northing in −Z (glTF's north). Null where they are
 * not: a design drawn about its own origin.
 */
export function detectGeoreference(
  box: DesignBox,
  epsg: number
): Georeference | null {
  const zone = utmZone(epsg);
  if (zone === null) {
    return null;
  }
  const x = (box.min[0] + box.max[0]) / 2;
  const north = -(box.min[2] + box.max[2]) / 2;
  if (north < NORTH_MIN || north > NORTH_MAX) {
    return null;
  }
  let east = x;
  let zonePrefixed = false;
  if (x >= zone * 1e6 + EAST_MIN && x <= zone * 1e6 + EAST_MAX) {
    east = x - zone * 1e6;
    zonePrefixed = true;
  } else if (x < EAST_MIN || x > EAST_MAX) {
    return null;
  }
  const minY = box.min[1];
  const base = minY >= NHN_MIN && minY <= NHN_MAX ? minY : null;
  return { east, north, base, zonePrefixed };
}

/**
 * The base a georeferenced design keeps: its own where the ground under it
 * agrees within NHN_TRUST_M (or where there is no ground to ask), the
 * ground's otherwise — a model whose ±0 is its ground floor.
 */
export function trustedBase(
  own: number | null,
  ground: number | null
): number | null {
  if (own === null) {
    return ground;
  }
  if (ground === null || Math.abs(own - ground) <= NHN_TRUST_M) {
    return own;
  }
  return ground;
}

/** How far beyond the site's tiles a design may stand where its file
 *  says (m): past that there is no ground and no city around it, and it
 *  is set down in front of the player instead. */
export const SITE_REACH_M = 2000;
/** How far a design's box may lie from its own origin and still be drawn
 *  about it (m): farther, the file is in another place's or another
 *  system's coordinates (an IFC site in another Land, Gauß–Krüger). */
export const OWN_FRAME_M = 50_000;

/** How far (m) a projected point lies beyond the nearest of `extents`
 *  ([minX, minY, maxX, maxY]); 0 inside one. */
export function beyondExtents(
  extents: readonly TerrainBounds[],
  x: number,
  y: number
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const extent of extents) {
    best = Math.min(best, distanceOutside(extent, x, y));
  }
  return best;
}

/** Whether a design's box lies in some other place's coordinates: far
 *  from its own origin, and not the site's (`detectGeoreference`). */
export function elsewhereFrame(box: DesignBox): boolean {
  const x = (box.min[0] + box.max[0]) / 2;
  const z = (box.min[2] + box.max[2]) / 2;
  return Math.hypot(x, z) > OWN_FRAME_M;
}

/** The panel's line for a design the file puts somewhere it cannot
 *  stand: `beyond` m outside the site, or (null) in coordinates of
 *  another place or system. */
export function elsewhereNote(beyond: number | null): string {
  const where =
    beyond === null
      ? "Die Datei ist in den Koordinaten eines anderen Orts oder Systems verortet"
      : `Laut Datei liegt der Entwurf ${Math.round(beyond / 1000).toLocaleString("de-DE")} km außerhalb dieser Stadt`;
  return `${where}; vor dir abgesetzt, bitte platzieren.`;
}

/** The anchor in the design's own frame: its box's middle in plan, at
 *  its lowest point. */
export function designAnchor(box: DesignBox): [number, number, number] {
  return [
    (box.min[0] + box.max[0]) / 2,
    box.min[1],
    (box.min[2] + box.max[2]) / 2,
  ];
}

/** The design's half extents in plan about its anchor (m): x east, z
 *  south in its own frame. */
export function designHalfSize(box: DesignBox): [number, number] {
  return [(box.max[0] - box.min[0]) / 2, (box.max[2] - box.min[2]) / 2];
}

/**
 * A point of the design's own frame, relative to its anchor (x east, y up,
 * z south), in the site's EPSG coordinates and NHN under `placement`.
 */
export function placePoint(
  placement: DesignPlacement,
  local: readonly [number, number, number]
): { x: number; y: number; z: number } {
  const turn = placement.rotation * DEG2RAD;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  // local (x east, −z north) turned clockwise by `turn`
  const e = local[0];
  const n = -local[2];
  return {
    x: placement.east + e * c + n * s,
    y: placement.north - e * s + n * c,
    z: placement.base + local[1],
  };
}

/** The four corners of the design's box in plan under `placement`
 *  (EPSG), anticlockwise. */
export function placedCorners(
  placement: DesignPlacement,
  box: DesignBox
): [number, number][] {
  const [hx, hz] = designHalfSize(box);
  return (
    [
      [-hx, hz],
      [hx, hz],
      [hx, -hz],
      [-hx, -hz],
    ] as const
  ).map(([x, z]) => {
    const p = placePoint(placement, [x, 0, z]);
    return [p.x, p.y];
  });
}

/**
 * The base that sets a design on the ground: the lowest ground under its
 * middle and its box's corners, so it stands in a slope rather than over
 * it (a ground floor a little above the street, as drawn). Null where the
 * ground is nowhere under it.
 */
export function groundBase(
  placement: Omit<DesignPlacement, "base">,
  box: DesignBox,
  heightAt: (x: number, y: number) => number | null
): number | null {
  const at = { ...placement, base: 0 };
  let low: number | null = heightAt(placement.east, placement.north);
  for (const [x, y] of placedCorners(at, box)) {
    const h = heightAt(x, y);
    if (h !== null && (low === null || h < low)) {
      low = h;
    }
  }
  return low;
}

/**
 * The base that stands a design on `ground`: its ±0 there where its own
 * heights run through 0 — an architect's model drawn about its ground
 * floor, its basement below — else its lowest point.
 */
export function standingBase(box: DesignBox, ground: number): number {
  return box.min[1] < 0 && box.max[1] > 0 ? ground + box.min[1] : ground;
}

/**
 * Where a design without a place of its own lands: on the ground ahead of
 * the player, far enough that its near side stands `gap` m before them.
 * `heading` is the pose's (radians, clockwise from north).
 */
export function placeAhead(
  player: { epsgX: number; epsgY: number; heading: number },
  box: DesignBox,
  gap = 15
): Pick<DesignPlacement, "east" | "north" | "rotation"> {
  const [hx, hz] = designHalfSize(box);
  const reach = Math.hypot(hx, hz) + gap;
  return {
    east: player.epsgX + Math.sin(player.heading) * reach,
    north: player.epsgY + Math.cos(player.heading) * reach,
    rotation: 0,
  };
}

/** A turn in (−180, 180]. */
export function normalizeRotation(deg: number): number {
  if (deg > -180 && deg <= 180) {
    return deg;
  }
  const r = ((((deg + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

/** The placement file's format tag. */
export const PLACEMENT_FORMAT = "city-walk-entwurf/1";

/** The placement as a file to keep beside the design. */
export function placementFile(
  placement: DesignPlacement,
  epsg: number,
  design: string,
  scale: DesignScale = METRES
): string {
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  return `${JSON.stringify(
    {
      format: PLACEMENT_FORMAT,
      design,
      epsg,
      east: round(placement.east, 3),
      north: round(placement.north, 3),
      base: round(placement.base, 3),
      rotation: round(placement.rotation, 2),
      // (a file without them is in metres, as before they were kept)
      unit: scale.unit,
      factor: scale.factor,
    },
    null,
    2
  )}\n`;
}

/**
 * Reads a placement file: the placement, or why not. A file for another
 * EPSG is refused rather than reprojected (it belongs to another Land).
 */
export function parsePlacementFile(
  text: string,
  epsg: number
): { placement: DesignPlacement; scale: DesignScale } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "Die Lagedatei ist kein gültiges JSON." };
  }
  const o = json as Record<string, unknown> | null;
  if (o?.format !== PLACEMENT_FORMAT) {
    return { error: "Das ist keine Lagedatei von city walk." };
  }
  if (o.epsg !== epsg) {
    return {
      error: `Die Lagedatei gilt für EPSG:${String(o.epsg)}, diese Stadt rechnet in EPSG:${epsg}.`,
    };
  }
  const num = (k: string) =>
    typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] : null;
  const east = num("east");
  const north = num("north");
  const base = num("base");
  const rotation = num("rotation");
  if (east === null || north === null || base === null || rotation === null) {
    return { error: "Der Lagedatei fehlen Koordinaten, Höhe oder Drehung." };
  }
  const unit = o.unit ?? "m";
  const factor = num("factor") ?? 1;
  if (!isDesignUnit(unit) || !validFactor(factor)) {
    return { error: "Die Lagedatei nennt einen ungültigen Maßstab." };
  }
  return {
    placement: { east, north, base, rotation: normalizeRotation(rotation) },
    scale: { unit, factor },
  };
}

/** The units a design's file may be drawn in, in metres. */
export const DESIGN_UNITS = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  ft: 0.3048,
} as const;
export type DesignUnit = keyof typeof DESIGN_UNITS;

/** A design's scale: the unit its file is drawn in, times a factor (a
 *  model built at 1:100, a game asset in its own units). */
export interface DesignScale {
  unit: DesignUnit;
  factor: number;
}
export const METRES: DesignScale = { unit: "m", factor: 1 };

/** The factors the panel takes: from a hundredth to a thousandfold. */
const FACTOR_MIN = 0.01;
const FACTOR_MAX = 1000;

export function isDesignUnit(v: unknown): v is DesignUnit {
  return typeof v === "string" && Object.hasOwn(DESIGN_UNITS, v);
}

export function validFactor(v: number): boolean {
  return Number.isFinite(v) && v >= FACTOR_MIN && v <= FACTOR_MAX;
}

/** How many metres one of the file's units is. */
export function scaleMetres(scale: DesignScale): number {
  return DESIGN_UNITS[scale.unit] * scale.factor;
}

/** A design's box scaled by `f` about its anchor (the middle in plan, at
 *  its lowest point), which stays where it is. */
export function scaleBox(box: DesignBox, f: number): DesignBox {
  const a = designAnchor(box);
  const at = (v: number, i: number) => a[i] + (v - a[i]) * f;
  return {
    min: [at(box.min[0], 0), at(box.min[1], 1), at(box.min[2], 2)],
    max: [at(box.max[0], 0), at(box.max[1], 1), at(box.max[2], 2)],
  };
}

/** A design's size (m): width east–west, depth, height. */
export function designSize(box: DesignBox): [number, number, number] {
  return [
    box.max[0] - box.min[0],
    box.max[2] - box.min[2],
    box.max[1] - box.min[1],
  ];
}

/** Below this a design is likely in centimetres or a game's own units
 *  (m: a 2.9 m "skyscraper"); above, in millimetres (m: 30 km). */
const SMALL_M = 4;
const LARGE_M = 3000;

/**
 * A line for the panel where a design's size suggests its file is not in
 * metres — a model of a few metres or of kilometres —, null otherwise.
 * Only a hint: a bench is small, a landscape plan large.
 */
export function scaleHint(box: DesignBox): string | null {
  const longest = Math.max(...designSize(box));
  const m = (v: number) =>
    v.toLocaleString("de-DE", { maximumFractionDigits: 1 });
  if (longest < SMALL_M) {
    return `Nur ${m(longest)} m groß: ist die Datei in Zentimetern oder eigenen Einheiten? Den Maßstab unten einstellen.`;
  }
  if (longest > LARGE_M) {
    return `${m(longest / 1000)} km groß: ist die Datei in Millimetern oder Zentimetern? Den Maßstab unten einstellen.`;
  }
  return null;
}
