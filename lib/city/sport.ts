/**
 * The sports grounds (pipeline/bake/sport.py): football pitches, tennis and
 * basketball courts, running tracks, beach-volleyball sand, the sandpits of
 * playgrounds. The bake writes a table — one row per ground, its frame, its
 * playing surface and the lines painted on it — and an index raster naming
 * the row that reaches each texel; the terrain shader draws the ground in
 * its own fragment pass (app/_components/sport-ground.ts). The surface
 * colours are here, like the land-cover palette: a colour change is a look
 * change, not a re-bake. No THREE, no DOM.
 */

export interface SportSurface {
  key: string;
  /** pastel tint, sRGB 0..255; null keeps the ground as it is */
  srgb: readonly [number, number, number] | null;
}

/**
 * The playing surfaces (the bake's `SURFACES`; the ids are the index).
 * Pastels in the land-cover palette's key: a pitch reads as a deeper, cooler
 * green than the meadow around it, a tartan track as terracotta, a clay
 * court as warm apricot — the colours of the real thing, washed out.
 */
export const SPORT_SURFACES: readonly SportSurface[] = [
  { key: "ground", srgb: null },
  { key: "grass", srgb: [168, 198, 146] }, // pitch green
  { key: "turf", srgb: [150, 190, 152] }, // cooler artificial turf
  { key: "tartan", srgb: [212, 152, 132] }, // soft terracotta
  { key: "clay", srgb: [221, 168, 134] }, // warm apricot clay
  { key: "sand", srgb: [238, 214, 168] }, // warm golden sand
  { key: "hard", srgb: [188, 194, 199] }, // light blue-grey court
  { key: "cinder", srgb: [207, 176, 152] }, // dusty red cinder (Tenne)
];

/** The line schemes (the bake's `MARKINGS`; the ids are the index). */
export const SPORT_MARKINGS = [
  "none",
  "football",
  "tennis",
  "basketball",
  "volleyball",
  "court",
  "lanes",
  "board",
] as const;
export type SportMarking = (typeof SPORT_MARKINGS)[number];

/** The outline models (the bake's `SHAPES`; the ids are the index). */
export const SPORT_SHAPES = ["rect", "stadium", "free"] as const;
export type SportShape = (typeof SPORT_SHAPES)[number];

export function sportSurfaceId(key: string): number {
  return SPORT_SURFACES.findIndex((s) => s.key === key);
}

export function sportMarkingId(kind: SportMarking): number {
  return SPORT_MARKINGS.indexOf(kind);
}

export function sportShapeId(kind: SportShape): number {
  return SPORT_SHAPES.indexOf(kind);
}

/** One row of the table: `[cx, cy, angle, p1, p2, p3, surface, marking,
 *  shape]` — the centre in metres from the tile's north-west corner (x east,
 *  y north), the long axis in radians from east. */
export type SportRow = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** `sport_<tile>.json` as the bake writes it (only what the viewer reads). */
export interface SportTable {
  grounds: SportRow[];
}

/** Floats per row in the packed table: two RGBA texels. */
export const SPORT_ROW_FLOATS = 8;

/**
 * The packed code in a row's second texel: surface + 8·marking + 64·shape,
 * small integers a float holds exactly.
 */
export function sportCode(
  surface: number,
  marking: number,
  shape: number
): number {
  return surface + 8 * marking + 64 * shape;
}

/**
 * The table as the shader's data texture: row i is column i of a 2-texel-
 * high RGBA float texture — texel 0 (cx, cy, cos, sin), texel 1 (p1, p2, p3,
 * code). Returns the texel data laid out row-major (the first texel row,
 * then the second) and the width. Rows with ids the viewer does not know
 * are kept but drawn as nothing (code 0 → ground, no lines, rect), so the
 * raster's row numbers stay valid.
 */
export function packSportTable(table: SportTable): {
  data: Float32Array;
  width: number;
} {
  const rows = table.grounds;
  const width = rows.length;
  const data = new Float32Array(width * SPORT_ROW_FLOATS);
  for (const [i, row] of rows.entries()) {
    const [cx, cy, angle, p1, p2, p3, surface, marking, shape] = row;
    const known =
      surface < SPORT_SURFACES.length &&
      marking < SPORT_MARKINGS.length &&
      shape < SPORT_SHAPES.length;
    const top = i * 4;
    const bottom = (width + i) * 4;
    data.set([cx, cy, Math.cos(angle), Math.sin(angle)], top);
    data.set(
      [p1, p2, p3, known ? sportCode(surface, marking, shape) : 0],
      bottom
    );
  }
  return { data, width };
}

/**
 * The playing field inside a rectangle ground (half length, half width):
 * the lines keep a small margin off the mapped outline — OSM draws a pitch
 * at its lines or a little outside them. The terrain shader uses the same
 * margin (sport-ground.ts `f`).
 */
export function sportField(p1: number, p2: number): [number, number] {
  const margin = Math.min(Math.max(0.03 * p2, 0.3), 1.5);
  return [p1 - margin, p2 - margin];
}

/** What stands on a ground: goals, basketball posts, the nets across a
 *  court. */
export type SportFixtureKind = "goal" | "hoop" | "net";

export interface SportFixture {
  /** the direction it faces (a goal and a hoop into the field; a net's
   *  normal, along the court), radians from east */
  angle: number;
  /** m: a goal's crossbar, a hoop's rim, a net's top */
  height: number;
  kind: SportFixtureKind;
  /** m: a goal's mouth, a net between its posts */
  width: number;
  /** the base's centre, m from the tile's north-west corner (x east,
   *  y north) — the table's frame */
  x: number;
  y: number;
}

/** Tennis: the doubles court and the net posts 0.914 m outside it. */
const TENNIS_HALF = [11.885, 5.485] as const;
const NET_POST_OUT = 0.914;

function place(
  row: SportRow,
  u: number,
  v: number,
  facing: number
): Pick<SportFixture, "angle" | "x" | "y"> {
  const [cx, cy, angle] = row;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: cx + u * c - v * s,
    y: cy + u * s + v * c,
    angle: angle + facing,
  };
}

function goals(row: SportRow, width: number, height: number): SportFixture[] {
  const [fx] = sportField(row[3], row[4]);
  return [
    { kind: "goal", width, height, ...place(row, fx, 0, Math.PI) },
    { kind: "goal", width, height, ...place(row, -fx, 0, 0) },
  ];
}

function footballGoals(row: SportRow): SportFixture[] {
  const [fx, fy] = sportField(row[3], row[4]);
  const s = Math.min(1, fx / 52.5, fy / 34);
  const width = Math.min(Math.max(7.32 * s, 3), 7.32);
  return goals(row, width, Math.min(Math.max(width / 3, 2), 2.44));
}

function hoops(row: SportRow): SportFixture[] {
  const [fx, fy] = sportField(row[3], row[4]);
  const hoop = { kind: "hoop" as const, width: 1.8, height: 3.05 };
  // Nearly square: a half court, its basket at the -x end (as the shader).
  if (fx < 1.3 * fy) {
    return [{ ...hoop, ...place(row, -fx, 0, 0) }];
  }
  return [
    { ...hoop, ...place(row, fx, 0, Math.PI) },
    { ...hoop, ...place(row, -fx, 0, 0) },
  ];
}

function tennisNet(row: SportRow): SportFixture[] {
  const s = Math.min(
    1,
    (row[3] - 0.3) / TENNIS_HALF[0],
    (row[4] - 0.3) / TENNIS_HALF[1]
  );
  const width = 2 * (TENNIS_HALF[1] * s + NET_POST_OUT);
  return [{ kind: "net", width, height: 1.07, ...place(row, 0, 0, 0) }];
}

function volleyballNet(row: SportRow): SportFixture[] {
  const [fx, fy] = sportField(row[3], row[4]);
  const beach = row[6] === sportSurfaceId("sand");
  const half = beach ? [8, 4] : [9, 4.5];
  const s = Math.min(1, fx / half[0], fy / half[1]);
  const width = 2 * (half[1] * s + 1);
  return [{ kind: "net", width, height: 2.43, ...place(row, 0, 0, 0) }];
}

/**
 * The fixtures of the rectangle grounds, in the table's frame — what the
 * dressing stands on the ground (app/_components/sport-fixtures.ts). A
 * multi-sport court gets small goals; tracks, free outlines and grounds
 * without lines get nothing.
 */
export function sportFixtures(table: SportTable): SportFixture[] {
  const out: SportFixture[] = [];
  for (const row of table.grounds) {
    const [, , , p1, p2, , , marking, shape] = row;
    if (shape !== sportShapeId("rect") || p1 <= 0 || p2 <= 0) {
      continue;
    }
    switch (SPORT_MARKINGS[marking]) {
      case "football":
        out.push(...footballGoals(row));
        break;
      case "court":
        out.push(...goals(row, 3, 2));
        break;
      case "basketball":
        out.push(...hoops(row));
        break;
      case "tennis":
        out.push(...tennisNet(row));
        break;
      case "volleyball":
        out.push(...volleyballNet(row));
        break;
      case "lanes":
      case "board":
      case "none":
        break;
    }
  }
  return out;
}
