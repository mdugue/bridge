/**
 * `data/<site>/dlm/walls_<tile>.geojson`: OSM's walls and cliffs and the
 * measured quays, then its fences and railings, then the gates standing on
 * those lines (ODbL). Written by pipeline/bake/walls.py (step `walls`); a
 * terrain bake input, not served, read by scripts/tile-sources.ts
 * (lib/city/features.ts `WallFileFeature`; features.test.ts holds the order
 * and the ranges). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import {
  featureCollection,
  featureOf,
  lineGeometry,
  pointGeometry,
} from "./bake-file";
import type { BakeFile } from "./bake-file";

/** The barrier/man_made kind or "cliff" (only retaining kinds and cliffs
 *  reshape the terrain). A `quay` is no OSM line: measured where the water
 *  meets the land in the DGM (walls.py `quays`), its height the measured
 *  rise. */
const wallProps = z.strictObject({
  /** tagged, else measured in the surface model, else the kind's fallback
   *  (m) */
  h: z.number(),
  kind: z.enum([
    "city_wall",
    "cliff",
    "embankment",
    "quay",
    "retaining_wall",
    "wall",
  ]),
  /** a wall's, retaining or city wall's material: tagged, else the site's
   *  majority (lib/city/walls.ts `WALL_TONES`) */
  mat: z.string().optional(),
});

/** OSM fences and railings: the panel (`rail` for a handrail) and the
 *  height in metres. */
const fenceProps = z.strictObject({
  h: z.number(),
  kind: z.literal("fence"),
  type: z.enum(["mesh", "picket", "rail", "railing"]),
});

/** OSM gates standing on a wall or fence line: the gap's width (m), the
 *  line's kind, the barrier where it is not a plain gate, and `seam` on a
 *  neighbouring tile's gate whose gap reaches over the seam (it cuts this
 *  tile's piece of the line too). */
const gateProps = z.strictObject({
  kind: z.literal("gate"),
  on: z.enum(["fence", "wall"]),
  seam: z.literal(true).optional(),
  type: z.enum(["cycle_barrier", "lift_gate", "swing_gate"]).optional(),
  w: z.number(),
});

const wallsFile = featureCollection(
  z.union([
    featureOf(lineGeometry, wallProps),
    featureOf(lineGeometry, fenceProps),
    featureOf(pointGeometry, gateProps),
  ])
);

export type WallProps = z.infer<typeof wallProps>;
export type FenceProps = z.infer<typeof fenceProps>;
export type GateProps = z.infer<typeof gateProps>;

export const WALLS_FILE: BakeFile<typeof wallsFile> = {
  file: "lib/city/walls-file.ts",
  schema: wallsFile,
  step: "walls",
  writer: "pipeline/bake/walls.py",
};
