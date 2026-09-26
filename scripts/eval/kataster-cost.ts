/**
 * Cost of the tree cadastre and the laser-scan vegetation, measured the way
 * the renderer would pay it — without a GPU. For every tile of the site it
 * builds the vegetation three ways — `canopy` (rows + canopy only, the look
 * before the cadastre), `kataster` (the same plus the cadastre with the
 * canopy/row veto, its trunks and broadleaf crowns merged into the canopy's
 * chunk meshes) and `shipped` (that plus the laser-scan extra trees and the
 * OSM hedges: what the viewer draws) — then reports:
 *
 *   - build: CPU time of the tile builds, and what was built (the census:
 *     meshes, instances, triangles — both crown LODs included)
 *   - per view (the shots/kat-*.json poses): after the distance LOD swap,
 *     the draw calls and triangles three would issue for the vegetation in
 *     the main pass (per-object frustum test on each InstancedMesh's bounding
 *     sphere, exactly what three culls on) and in one shadow-map render
 *     (casters within the fitted shadow frustum's half-size of its focus —
 *     lib/city/shadow-fit.ts; the map only re-renders on a move/invalidate)
 *
 * Run: bun scripts/eval/kataster-cost.ts   (after prepare-data, for the
 * tileset's offset, and
 * scripts/eval/kataster-shots.py; no GPU, no browser)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Frustum,
  InstancedMesh,
  Matrix4,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Vector3,
} from "three";
import { sceneCensus } from "../../app/_components/scene-census";
import { buildLowVegetation } from "../../app/_components/low-vegetation-layer";
import { buildTreeInventory } from "../../app/_components/tree-inventory-layer";
import {
  buildVegetation,
  type VegetationControl,
} from "../../app/_components/vegetation-layer";
import type {
  CanopyExtraFeature,
  CanopyFeature,
  FeatureCollection,
  LowVegFeature,
  TreeFeature,
  VegRowFeature,
} from "../../lib/city/features";
import { directionOf } from "../../lib/city/pose";
import { fitShadowRadius, shadowFocusAhead } from "../../lib/city/shadow-fit";
import { sampleHeightfield } from "../../lib/city/terrain-geometry";
import {
  type DataManifest,
  dgmSourceFiles,
  tileIds,
} from "../../lib/city/tile";
import { parseTilesetExtras, TILESET_FILE } from "../../lib/city/tileset";
import { currentSite } from "../../sites";
import { readDgm } from "../bake-tiles";
import { DRESDEN } from "../../sites/dresden";

const ROOT = join(import.meta.dir, "..", "..");
const PUB = join(ROOT, "public", "data");
const manifest = JSON.parse(
  readFileSync(join(PUB, "manifest.json"), "utf8")
) as DataManifest;
const served = (file: string) => join(PUB, manifest.files[file] ?? file);
const features = <F>(file: string): F[] => {
  try {
    return (
      (
        JSON.parse(
          readFileSync(join(ROOT, "data", "dresden", "dlm", file), "utf8")
        ) as FeatureCollection<F>
      ).features ?? []
    );
  } catch {
    return []; // an optional artifact this tile does not have
  }
};

// The recenter offset the viewer uses, from the published tileset.
const { offset } = parseTilesetExtras(
  JSON.parse(readFileSync(served(TILESET_FILE), "utf8"))
);

/** Ground height from the committed DGM, resampled to 1024² (vegetation
 *  placement only — a few centimetres off the fine level's TIN). */
async function heightAtFor(tile: string) {
  const src = dgmSourceFiles(DRESDEN, tile);
  const tif = readFileSync(join(ROOT, src.tif));
  const tfw = join(ROOT, src.tfw);
  const n = 1024;
  const { elevations, bounds } = await readDgm(
    tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength),
    existsSync(tfw) ? readFileSync(tfw, "utf8") : null,
    n
  );
  return (x: number, y: number) =>
    sampleHeightfield({ elevations, n, bounds }, x, y);
}

const MODES = ["canopy", "kataster", "shipped"] as const;
type Mode = (typeof MODES)[number];
/** What a mode built: its vegetation controls plus any static groups. */
const controls: Record<
  Mode,
  { group: Object3D; updateLod?: VegetationControl["updateLod"] }[]
> = {
  canopy: [],
  kataster: [],
  shipped: [],
};
const buildMs: Record<Mode, number> = { canopy: 0, kataster: 0, shipped: 0 };
const heights: ((x: number, y: number) => number | null)[] = [];

for (const tile of tileIds(currentSite())) {
  const heightAt = await heightAtFor(tile);
  heights.push(heightAt);
  const ctx = { offset, heightAt };
  const rows = features<VegRowFeature>(`vegrows_${tile}.geojson`);
  const canopy = features<CanopyFeature>(`canopy_${tile}.geojson`);
  const trees = features<TreeFeature>(`trees_${tile}.geojson`);
  const scan = features<CanopyExtraFeature>(`canopyx_${tile}.geojson`);
  const hedges = features<LowVegFeature>(`lowveg_${tile}.geojson`);
  let t0 = performance.now();
  controls.canopy.push(buildVegetation({ rows, canopy }, ctx));
  buildMs.canopy += performance.now() - t0;
  t0 = performance.now();
  const inv = buildTreeInventory(trees, ctx);
  controls.kataster.push(
    inv.control,
    buildVegetation(
      { rows, canopy, keepTree: inv.keepTree, extraTrees: inv.instances },
      ctx
    )
  );
  buildMs.kataster += performance.now() - t0;
  t0 = performance.now();
  const inv2 = buildTreeInventory(trees, ctx);
  controls.shipped.push(
    inv2.control,
    buildVegetation(
      {
        rows,
        canopy: [...canopy, ...scan],
        keepTree: inv2.keepTree,
        extraTrees: inv2.instances,
      },
      ctx
    ),
    { group: buildLowVegetation(hedges, ctx) }
  );
  buildMs.shipped += performance.now() - t0;
}

const groundAt = (x: number, y: number): number => {
  for (const h of heights) {
    const v = h(x, y);
    if (v !== null) {
      return v;
    }
  }
  return 105;
};

interface PassCost {
  calls: number;
  triangles: number;
}

function trisOf(mesh: Mesh): number {
  const g = mesh.geometry;
  const count = g.index
    ? g.index.count
    : (g.getAttribute("position")?.count ?? 0);
  return Math.floor(count / 3);
}

/** Every visible instanced mesh under the roots (all vegetation is one). */
function meshesOf(roots: Object3D[]): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  for (const r of roots) {
    r.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh && o.visible) {
        out.push(o as InstancedMesh);
      }
    });
  }
  return out;
}

function passCost(
  meshes: InstancedMesh[],
  test: (m: InstancedMesh) => boolean
): PassCost {
  const cost = { calls: 0, triangles: 0 };
  for (const m of meshes) {
    if (!m.boundingSphere || !test(m)) {
      continue;
    }
    cost.calls += 1;
    cost.triangles += trisOf(m) * m.count;
  }
  return cost;
}

interface Shot {
  camera: {
    headingDeg: number;
    pitchDeg: number;
    pos: { x: number; y: number; z: number };
    epsg: { x: number; y: number };
  };
}

const shotsDir = join(ROOT, "shots");
const shots = readdirSync(shotsDir)
  .filter((f) => f.startsWith("kat-") && f.endsWith(".json"))
  .sort();

const report: Record<string, unknown> = {
  buildMs: Object.fromEntries(MODES.map((m) => [m, Math.round(buildMs[m])])),
  built: Object.fromEntries(
    MODES.map((m) => [m, sceneCensus(controls[m].map((c) => c.group))])
  ),
};

const views: Record<
  string,
  Record<Mode, { main: PassCost; shadow: PassCost }>
> = {};
for (const file of shots) {
  const shot = JSON.parse(readFileSync(join(shotsDir, file), "utf8")) as Shot;
  const cam = new PerspectiveCamera(55, 1.6, 0.3, 6000);
  const { pos, headingDeg, pitchDeg, epsg } = shot.camera;
  cam.position.set(pos.x, pos.y, pos.z);
  const d = directionOf(
    (headingDeg * Math.PI) / 180,
    (pitchDeg * Math.PI) / 180
  );
  cam.lookAt(pos.x + d.x, pos.y + d.y, pos.z + d.z);
  cam.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
  );
  // The shadow frustum: fitted half-size, centred on the ground under the
  // camera and pushed along the view (sun-rig.ts follow()).
  const ground = groundAt(epsg.x, epsg.y);
  const radius = fitShadowRadius(pos.y - ground, 110);
  const ahead = shadowFocusAhead(radius);
  const focus = new Vector3(pos.x + d.x * ahead, ground, pos.z + d.z * ahead);
  const entry = {} as Record<Mode, { main: PassCost; shadow: PassCost }>;
  for (const mode of MODES) {
    for (const c of controls[mode]) {
      c.updateLod?.(cam.position);
    }
    const meshes = meshesOf(controls[mode].map((c) => c.group));
    entry[mode] = {
      main: passCost(meshes, (m) =>
        frustum.intersectsSphere(m.boundingSphere as never)
      ),
      shadow: passCost(meshes, (m) => {
        const s = m.boundingSphere;
        if (!(m.castShadow && s)) {
          return false;
        }
        const dx = Math.max(Math.abs(s.center.x - focus.x) - s.radius, 0);
        const dz = Math.max(Math.abs(s.center.z - focus.z) - s.radius, 0);
        return dx <= radius && dz <= radius;
      }),
    };
  }
  views[file.replace(/\.json$/, "")] = entry;
}
report.views = views;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
