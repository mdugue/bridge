/**
 * Cost of the 🧪 tree-cadastre layer (`?trees=kataster`), measured the way
 * the renderer would pay it — without a GPU. For the whole 2×2 block it
 * builds the vegetation twice (today's rows + canopy; the same plus the
 * cadastre with the canopy/row veto), then reports:
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
 * Run: bun scripts/eval/kataster-cost.ts   (after prepare-data and
 * scripts/eval/kataster-shots.py; no GPU, no browser)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
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
import { buildTreeInventory } from "../../app/_components/tree-inventory-layer";
import {
  buildVegetation,
  type VegetationControl,
} from "../../app/_components/vegetation-layer";
import type {
  CanopyFeature,
  FeatureCollection,
  TreeFeature,
  VegRowFeature,
} from "../../lib/city/features";
import {
  decodeHeightfield,
  parseHeightfieldHeader,
} from "../../lib/city/heightfield";
import { directionOf } from "../../lib/city/pose";
import { fitShadowRadius, shadowFocusAhead } from "../../lib/city/shadow-fit";
import { sampleHeightfield } from "../../lib/city/terrain-geometry";
import { TILE_BLOCK, type DataManifest } from "../../lib/city/tile";

const ROOT = join(import.meta.dir, "..", "..");
const PUB = join(ROOT, "public", "data");
const manifest = JSON.parse(
  readFileSync(join(PUB, "manifest.json"), "utf8")
) as DataManifest;
const served = (file: string) => join(PUB, manifest.files[file] ?? file);
const features = <F>(file: string): F[] =>
  (
    JSON.parse(
      readFileSync(join(ROOT, "data", "dlm", file), "utf8")
    ) as FeatureCollection<F>
  ).features ?? [];

const primary = TILE_BLOCK[0];
const meta = JSON.parse(
  readFileSync(served(`city_${primary.tile}.mesh.json`), "utf8")
) as { offset: { cx: number; cy: number } };
const offset = meta.offset;

function heightAtFor(tile: string, n: number) {
  const header = parseHeightfieldHeader(
    JSON.parse(
      readFileSync(served(`dgm1_${tile}.heightfield-${n}.json`), "utf8")
    )
  );
  const raw = gunzipSync(readFileSync(join(PUB, header.data)));
  const elevations = decodeHeightfield(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    header
  );
  return (x: number, y: number) =>
    sampleHeightfield({ elevations, n, bounds: header.bounds }, x, y);
}

type Mode = "canopy" | "kataster";
const controls: Record<Mode, VegetationControl[]> = {
  canopy: [],
  kataster: [],
};
const buildMs: Record<Mode, number> = { canopy: 0, kataster: 0 };
const heights: ((x: number, y: number) => number | null)[] = [];

for (const spec of TILE_BLOCK) {
  const heightAt = heightAtFor(spec.tile, spec.n);
  heights.push(heightAt);
  const ctx = { offset, heightAt };
  const rows = features<VegRowFeature>(`vegrows_${spec.tile}.geojson`);
  const canopy = features<CanopyFeature>(`canopy_${spec.tile}.geojson`);
  const trees = features<TreeFeature>(`trees_${spec.tile}.geojson`);
  let t0 = performance.now();
  controls.canopy.push(buildVegetation({ rows, canopy }, ctx));
  buildMs.canopy += performance.now() - t0;
  t0 = performance.now();
  const inv = buildTreeInventory(trees, ctx);
  controls.kataster.push(
    inv.control,
    buildVegetation({ rows, canopy, keepTree: inv.keepTree }, ctx)
  );
  buildMs.kataster += performance.now() - t0;
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

const CHUNK = 250;
const tmp = new Matrix4();
const at = new Vector3();
/** The 250 m chunk an instanced mesh belongs to (its first instance). */
function chunkOf(m: InstancedMesh): string {
  m.getMatrixAt(0, tmp);
  at.setFromMatrixPosition(tmp);
  return `${Math.floor(at.x / CHUNK)},${Math.floor(at.z / CHUNK)}`;
}

/** Inventory parts that would fold into the canopy's own chunk meshes if the
 *  layer were merged (same crown / trunk geometry and material). */
const MERGEABLE = new Set(["trunk", "broad"]);

function passCost(
  meshes: InstancedMesh[],
  test: (m: InstancedMesh) => boolean
): PassCost & { callsIfMerged: number } {
  const cost = { calls: 0, triangles: 0, callsIfMerged: 0 };
  const canopyChunks = new Set<string>();
  const mergeable: InstancedMesh[] = [];
  for (const m of meshes) {
    if (!m.boundingSphere || !test(m)) {
      continue;
    }
    cost.calls += 1;
    cost.triangles += trisOf(m) * m.count;
    const part = m.userData.treePart as string | undefined;
    if (part === undefined) {
      canopyChunks.add(chunkOf(m));
    } else if (MERGEABLE.has(part)) {
      mergeable.push(m);
    }
  }
  const folded = mergeable.filter((m) => canopyChunks.has(chunkOf(m))).length;
  cost.callsIfMerged = cost.calls - folded;
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
  buildMs: {
    canopy: Math.round(buildMs.canopy),
    kataster: Math.round(buildMs.kataster),
  },
  built: {
    canopy: sceneCensus(controls.canopy.map((c) => c.group)),
    kataster: sceneCensus(controls.kataster.map((c) => c.group)),
  },
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
  for (const mode of ["canopy", "kataster"] as Mode[]) {
    for (const c of controls[mode]) {
      c.updateLod(cam.position);
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
