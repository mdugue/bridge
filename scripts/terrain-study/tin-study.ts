/**
 * Terrain study, TypeScript half (the Python half is build_grids.py and
 * metrics.py). Reproducible from the committed inputs + the gitignored LAZ:
 *
 *   bun scripts/terrain-study/tin-study.ts grids <study_dir>
 *     V0  = the 1024² grid the fine level used to be (readDgm → 1024²), and
 *           V0c = V0 + the wall conflation (what the viewer walked on);
 *     V1c / V2c = the wall conflation applied to v1_2000 / v2_4000 at their
 *           native resolution (the "burn breaklines at bake time" option).
 *   bun scripts/terrain-study/tin-study.ts tin <study_dir> <grid> <tolerances…>
 *     Delatin error-bounded TIN of <grid>.f32 at each tolerance (m), coarse to
 *     fine (one incremental refinement), written as <grid>_tin<cm>.{coords,tris}.u32
 *     + a stats JSON line (vertices, triangles, gzipped glTF bytes as the
 *     fine level ships it, bake ms).
 *   bun scripts/terrain-study/tin-study.ts client <study_dir> <grid> <cm>
 *     Client-side cost of one variant: the triangle index `heightAt` reads
 *     (terrain-layer.ts builds it when the fine level lands).
 *
 * Not part of the app; nothing imports it. See docs/transformations.md
 * ("Terrain TIN") for the results. The whole study, in order (STUDY = any
 * scratch dir, e.g. data/_raw/sn/lsc/33412_5656_2_sn_tin; the LAZ is
 * the gitignored GeoSN laser scan of the spawn tile):
 *
 *   PY="uv run --with numpy --with rasterio --with scipy --with matplotlib \
 *       --with laspy[lazrs] python"
 *   $PY scripts/terrain-study/lsc_extract.py <laz> $STUDY
 *   $PY scripts/terrain-study/build_grids.py data/dresden/dgm/…/dgm1_<tile>.tif $STUDY
 *   bun scripts/terrain-study/tin-study.ts grids $STUDY
 *   bun scripts/terrain-study/tin-study.ts tin $STUDY v1_2000 0.25 0.2 0.15 0.1 0.05
 *   bun scripts/terrain-study/tin-study.ts tin $STUDY v1c_2000 0.25 0.1
 *   bun scripts/terrain-study/tin-study.ts tin $STUDY v2_4000 0.25 0.1
 *   bun scripts/terrain-study/tin-study.ts tin $STUDY v2c_4000 0.25 0.1
 *   $PY scripts/terrain-study/metrics.py $STUDY $STUDY/metrics.json
 *   bun scripts/terrain-study/tin-study.ts client $STUDY v1_2000 15
 *
 * The study predates the 3D Tiles bake: its shipping-size numbers in the
 * docs were measured on the earlier custom TIN payload, not the glTF.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import Delatin from "delatin";
import { BufferAttribute, BufferGeometry } from "three";
import type { WallFeature } from "../../lib/city/features";
import { conflateWalls, type WallLine } from "../../lib/city/terrain-conflate";
import type { TerrainBounds } from "../../lib/city/terrain-geometry";
import {
  buildTinGeometryData,
  TinIndex,
  tinFromMesher,
  tinSurface,
} from "../../lib/city/terrain-tin";
import { dgmSourceFiles, wallSourceFile } from "../../lib/city/tile";
import { readDgm } from "../bake-tiles";
import { writeMeshGlb } from "../tile-glb";
import { DRESDEN } from "../../sites/dresden";

const SPAWN_TILE = "33412_5656_2_sn";
const BOUNDS: TerrainBounds = [412_000, 5_656_000, 414_000, 5_658_000];
const OFFSET = { cx: 413_000, cy: 5_657_000 };

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function readF32(path: string): Float32Array {
  const buf = readFileSync(path);
  return new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

function gridN(name: string): number {
  const m = /_(\d+)$/.exec(name);
  if (!m) {
    throw new Error(`grid name must end in _<n>: ${name}`);
  }
  return Number(m[1]);
}

function wallLines(): WallLine[] {
  const doc = JSON.parse(
    readFileSync(wallSourceFile(DRESDEN, SPAWN_TILE), "utf8")
  ) as {
    features: WallFeature[];
  };
  return doc.features
    .filter((f) => f.geometry?.type === "LineString")
    .map((f) => ({
      coords: f.geometry.coordinates,
      kind: f.properties?.kind ?? "wall",
    }));
}

async function grids(dir: string): Promise<void> {
  const src = dgmSourceFiles(DRESDEN, SPAWN_TILE);
  const tif = readFileSync(src.tif);
  const { elevations: v0 } = await readDgm(
    tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength),
    readFileSync(src.tfw, "utf8"),
    1024
  );
  writeFileSync(join(dir, "v0_1024.f32"), v0);
  const walls = wallLines();
  const conflate = (name: string, grid: ArrayLike<number>, n: number) => {
    const t = performance.now();
    const c = conflateWalls({ elevations: grid, n, bounds: BOUNDS, walls });
    writeFileSync(join(dir, `${name}_${n}.f32`), c);
    out(`${name}_${n}: conflated in ${(performance.now() - t).toFixed(0)} ms`);
  };
  conflate("v0c", v0, 1024);
  conflate("v1c", readF32(join(dir, "v1_2000.f32")), 2000);
  conflate("v2c", readF32(join(dir, "v2_4000.f32")), 4000);
}

async function tin(
  dir: string,
  grid: string,
  tolerances: number[]
): Promise<void> {
  const n = gridN(grid);
  const data = readF32(join(dir, `${grid}.f32`));
  const t0 = performance.now();
  const mesher = new Delatin(data, n, n);
  for (const tol of [...tolerances].sort((a, b) => b - a)) {
    mesher.run(tol);
    const ms = performance.now() - t0;
    const coords = Uint32Array.from(mesher.coords);
    const tris = Uint32Array.from(mesher.triangles);
    const cm = Math.round(tol * 100);
    writeFileSync(join(dir, `${grid}_tin${cm}.coords.u32`), coords);
    writeFileSync(join(dir, `${grid}_tin${cm}.tris.u32`), tris);
    const gz = gzipSync(await tinGlb(data, n, coords, tris)).byteLength;
    const naive = gzipSync(
      Buffer.concat([Buffer.from(coords.buffer), Buffer.from(tris.buffer)])
    ).byteLength;
    out(
      JSON.stringify({
        grid,
        tolM: tol,
        vertices: coords.length / 2,
        triangles: tris.length / 3,
        maxErrM: Number(mesher.getMaxError().toFixed(4)),
        gzBytes: gz,
        naiveGzBytes: naive,
        cumulativeBakeMs: Math.round(ms),
      })
    );
  }
}

/** The fine level's glTF for a TIN, as prepare-data writes it (no
 *  extras, no walls). */
async function tinGlb(
  data: Float32Array,
  n: number,
  coords: ArrayLike<number>,
  triangles: ArrayLike<number>
): Promise<Uint8Array> {
  const mesh = tinOf(data, n, coords, triangles);
  const { positions, indices } = buildTinGeometryData(mesh, OFFSET);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  g.computeVertexNormals();
  return writeMeshGlb({
    name: "terrain",
    extras: {},
    positions,
    normals: g.getAttribute("normal").array as Float32Array,
    indices,
  });
}

function tinOf(
  data: Float32Array,
  n: number,
  coords: ArrayLike<number>,
  triangles: ArrayLike<number>
) {
  return tinFromMesher({
    bounds: BOUNDS,
    n,
    coords,
    triangles,
    heightAt: (x, y) => data[y * n + x],
  });
}

function client(dir: string, grid: string, cm: number): void {
  const n = gridN(grid);
  const data = readF32(join(dir, `${grid}.f32`));
  const coords = new Uint32Array(
    readFileSync(join(dir, `${grid}_tin${cm}.coords.u32`)).buffer
  );
  const tris = new Uint32Array(
    readFileSync(join(dir, `${grid}_tin${cm}.tris.u32`)).buffer
  );
  const surface = tinSurface(tinOf(data, n, coords, tris));
  const t = performance.now();
  const index = new TinIndex(surface);
  const built = performance.now() - t;
  const q = performance.now();
  for (let i = 0; i < 100_000; i++) {
    index.heightAt(
      BOUNDS[0] + ((i * 7919) % 2000),
      BOUNDS[1] + ((i * 104_729) % 2000)
    );
  }
  out(
    `${grid} tin${cm}: index ${built.toFixed(0)} ms, 100k heightAt ${(performance.now() - q).toFixed(0)} ms`
  );
}

const [cmd, dir, ...rest] = process.argv.slice(2);
if (cmd === "grids" && dir) {
  await grids(dir);
} else if (cmd === "tin" && dir && rest.length > 1) {
  await tin(dir, rest[0], rest.slice(1).map(Number));
} else if (cmd === "client" && dir && rest.length === 2) {
  client(dir, rest[0], Number(rest[1]));
} else {
  out("usage: tin-study.ts grids|tin|client <study_dir> …");
  process.exit(1);
}
