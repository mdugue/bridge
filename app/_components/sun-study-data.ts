/**
 * What a sun study reads (lib/city/sun-study.ts), fetched for the tiles its
 * circle and the crowns' reach touch: each tile's horizon raster, its tree
 * crowns as the viewer draws them (the register's trees, the canopy and the
 * laser scan's extra crowns, the DLM's rows where the canopy did not place
 * them; where a register tree stands the viewer's own veto drops the
 * others, tree-inventory.ts) and the places it ranks (OSM playgrounds or benches), named by the
 * nearest address Stadtwissen knows. Fetched on demand, held while the
 * study computes, then let go: only the results stay (ADR 0047).
 */
import type {
  FurnitureFeature,
  TreeFeature,
  VegRowFeature,
} from "@/lib/city/features";
import {
  pointFeatures,
  ROWS_MEASURED,
  unpackPoints,
} from "@/lib/city/point-pack";
import { decodeGreyPng } from "@/lib/city/png-raster";
import { samplePolyline } from "@/lib/city/polyline";
import { type Site, tileExtentOf, tileIdOf } from "@/lib/city/site";
import { siteDataBase } from "@/lib/city/site-index";
import type { WissenTile } from "@/lib/city/stadtwissen";
import {
  type Crown,
  crownOf,
  type HorizonRaster,
  MAX_REACH_M,
  placeLabel,
  type StudyPlace,
  type SunStudyRecipe,
} from "@/lib/city/sun-study";
import { type DataManifest, MANIFEST_FILE, manifestUrl } from "@/lib/city/tile";
import { inventoryCovers } from "@/lib/city/tree-inventory";
import {
  BASE_TREE_H,
  canopyCrownWidth,
  CROWN_TO_HEIGHT,
  hash,
  plantedRows,
  TREE_SPACING,
  type TreeVeto,
} from "@/lib/city/tree-placement";
import {
  fetchFeatures,
  fetchOptionalBinary,
  fetchOptionalJson,
} from "./fetch-optional";

/** A canopy or laser-scan point (lib/city/point-pack.ts). */
type CanopyPoint = ReturnType<typeof pointFeatures>[number];

/** A place with its name for the list. */
export interface NamedPlace extends StudyPlace {
  label: string;
}

export interface StudyInputs {
  horizon: HorizonRaster[];
  crowns: Crown[];
  places: NamedPlace[];
  tiles: number;
  /** what the inputs hold while the study runs (bytes, about) */
  bytes: number;
}

interface TileFiles {
  minX: number;
  minY: number;
  size: number;
  name: (stem: string, ext: string) => string;
}

/** The site's tiles the circle (with the crowns' reach) touches. */
function tilesFor(site: Site, recipe: SunStudyRecipe, x: number, y: number) {
  const pad = recipe.radius + MAX_REACH_M;
  return site.tiles
    .map((cell) => ({
      cell,
      id: tileIdOf(site, cell),
      ext: tileExtentOf(cell),
    }))
    .filter(
      ({ ext }) =>
        ext[0] < x + pad &&
        ext[2] > x - pad &&
        ext[1] < y + pad &&
        ext[3] > y - pad
    );
}

async function horizonOf(
  t: TileFiles,
  signal: AbortSignal
): Promise<HorizonRaster | null> {
  const buffer = await fetchOptionalBinary(t.name("horizon", "png"), signal);
  if (!buffer) {
    return null;
  }
  const grey = await decodeGreyPng(new Uint8Array(buffer));
  return { data: grey.data, minX: t.minX, maxY: t.minY + t.size, size: t.size };
}

/** A canopy or laser-scan file's points, and whether the canopy holds the
 *  DLM's rows already (ROWS_MEASURED). */
async function pointsOf(
  t: TileFiles,
  kind: "canopy" | "canopyx",
  signal: AbortSignal
): Promise<{ points: CanopyPoint[]; rowsMeasured: boolean }> {
  const buffer = await fetchOptionalBinary(t.name(kind, "pts.gz"), signal);
  const packed = buffer ? unpackPoints(buffer) : null;
  if (!packed) {
    return { points: [], rowsMeasured: false };
  }
  return {
    points: pointFeatures(packed),
    rowsMeasured: (packed.flags & ROWS_MEASURED) !== 0,
  };
}

/** Canopy points as tall and as wide as canopyPlacements draws them, but
 *  where a register tree stands (`covers`, the viewer's keepTree turned
 *  round). */
function canopyCrowns(points: CanopyPoint[], covers: TreeVeto): Crown[] {
  const out: Crown[] = [];
  for (const f of points) {
    const p = f.properties;
    const [x, y] = f.geometry.coordinates;
    if (!p || covers(x, y, p.h)) {
      continue;
    }
    const seed = x * 0.13 + y * 0.07;
    const h =
      Math.min(Math.max(p.h / BASE_TREE_H, 0.5), 7) *
      (0.9 + hash(seed) * 0.2) *
      BASE_TREE_H;
    const r = "r" in p ? p.r : undefined;
    const width = canopyCrownWidth(h, r, hash(seed * 2.3 + 0.7));
    const road = "c" in p && p.c === 1;
    const c = crownOf(x, y, h, width, p.l === "e", road);
    if (c) {
      out.push(c);
    }
  }
  return out;
}

function registerCrowns(trees: TreeFeature[]): Crown[] {
  const crowns: Crown[] = [];
  for (const f of trees) {
    const p = f.properties;
    if (!p) {
      continue;
    }
    const [x, y] = f.geometry.coordinates;
    const width = p.d > 0 ? p.d : p.h * CROWN_TO_HEIGHT;
    const c = crownOf(x, y, p.h, width, p.l === "e");
    if (c) {
      crowns.push(c);
    }
  }
  return crowns;
}

/** A DLM tree row's trees as the viewer plants them (rowPlacements): one
 *  every TREE_SPACING along it, each its own scale of the generic tree,
 *  none where a register tree stands. */
function rowCrowns(rows: VegRowFeature[], covers: TreeVeto): Crown[] {
  const crowns: Crown[] = [];
  for (const f of rows) {
    if (f.properties?.kind === "hedge" || f.geometry?.type !== "LineString") {
      continue;
    }
    const pts = samplePolyline(f.geometry.coordinates, TREE_SPACING);
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (covers(x, y)) {
        continue;
      }
      const h = (0.8 + hash(x * 0.13 + y * 0.07 + i) * 0.6) * BASE_TREE_H;
      const c = crownOf(x, y, h, h * CROWN_TO_HEIGHT, false);
      if (c) {
        crowns.push(c);
      }
    }
  }
  return crowns;
}

/** One tile's crowns as the viewer draws them: the register's trees, the
 *  canopy's and the laser scan's points and the DLM's tree rows (where the
 *  canopy did not measure them), none of the last three where a register
 *  tree stands. */
export function tileCrowns(
  trees: TreeFeature[],
  points: CanopyPoint[],
  rows: VegRowFeature[],
  rowsMeasured: boolean
): Crown[] {
  const covers = inventoryCovers(trees);
  return [
    ...registerCrowns(trees),
    ...canopyCrowns(points, covers),
    ...rowCrowns(plantedRows(rows, rowsMeasured), covers),
  ];
}

function placesOf(
  furniture: FurnitureFeature[],
  recipe: SunStudyRecipe,
  centre: { x: number; y: number }
): StudyPlace[] {
  const kind = recipe.what === "spielplatz" ? "playground" : "bench";
  const out: StudyPlace[] = [];
  for (const f of furniture) {
    if (f.properties?.k !== kind) {
      continue;
    }
    const g = f.geometry;
    const rings = g.type === "Polygon" ? g.coordinates : null;
    const outer = rings?.[0];
    const [x, y] = outer
      ? [
          outer.reduce((s, p) => s + p[0], 0) / outer.length,
          outer.reduce((s, p) => s + p[1], 0) / outer.length,
        ]
      : (g.coordinates as [number, number]);
    if (Math.hypot(x - centre.x, y - centre.y) <= recipe.radius) {
      out.push({ id: 0, rings, x, y });
    }
  }
  return out;
}

async function tileInputs(
  t: TileFiles,
  recipe: SunStudyRecipe,
  centre: { x: number; y: number },
  signal: AbortSignal
) {
  const [horizon, trees, canopy, scan, rows, furniture, wissen] =
    await Promise.all([
      horizonOf(t, signal),
      fetchFeatures<TreeFeature>(t.name("trees", "geojson"), signal),
      pointsOf(t, "canopy", signal),
      pointsOf(t, "canopyx", signal),
      fetchFeatures<VegRowFeature>(t.name("vegrows", "geojson"), signal),
      fetchFeatures<FurnitureFeature>(t.name("furniture", "geojson"), signal),
      fetchOptionalJson<WissenTile>(t.name("stadtwissen", "json"), signal),
    ]);
  const crowns = tileCrowns(
    trees,
    [...canopy.points, ...scan.points],
    rows,
    canopy.rowsMeasured
  );
  const addresses = (wissen?.buildings ?? []).flatMap((b) =>
    b.addr ? [{ addr: b.addr, x: b.x, y: b.y }] : []
  );
  return {
    horizon,
    crowns,
    places: placesOf(furniture, recipe, centre),
    addresses,
  };
}

/** Everything a study at (x, y) reads. */
export async function loadStudyInputs(
  site: Site,
  recipe: SunStudyRecipe,
  centre: { x: number; y: number },
  signal: AbortSignal
): Promise<StudyInputs> {
  const base = siteDataBase(site.id);
  const manifest = await fetchOptionalJson<DataManifest>(
    `${base}/${MANIFEST_FILE}`,
    signal
  );
  const tiles = tilesFor(site, recipe, centre.x, centre.y);
  const parts = await Promise.all(
    tiles.map(({ id, ext }) =>
      tileInputs(
        {
          minX: ext[0],
          minY: ext[1],
          size: ext[2] - ext[0],
          name: (stem, kind) =>
            manifestUrl(manifest, `${stem}_${id}.${kind}`, base),
        },
        recipe,
        centre,
        signal
      )
    )
  );
  const addresses = parts.flatMap((p) => p.addresses);
  const places = parts
    .flatMap((p) => p.places)
    .map((p, id) => ({
      ...p,
      id,
      label: placeLabel(p.x, p.y, addresses, centre),
    }));
  const horizon = parts.flatMap((p) => (p.horizon ? [p.horizon] : []));
  const crowns = parts.flatMap((p) => p.crowns);
  return {
    horizon,
    crowns,
    places,
    tiles: tiles.length,
    bytes:
      horizon.reduce((s, r) => s + r.data.byteLength, 0) + crowns.length * 64,
  };
}
