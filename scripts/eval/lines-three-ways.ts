/**
 * Plan 090, phase 0, step 3: the rails three ways on one tile — by
 * default the Neustadt yards (`33410_5656_2_sn`), the tile the spike of
 * PR #156 grew most on.
 *
 *   1. today: the runtime builders (rail-layer.ts, tram-layer.ts) lay the
 *      rails as triangles on the scene's thread, from the published
 *      GeoJSON;
 *   2. the spike's triangles: the same triangles written as glTF nodes the
 *      way PR #156's scripts/bake-lines.ts wrote them (welded, positions
 *      quantised to 16 bits over the node, meshopt; scripts/tile-glb.ts);
 *   3. a segment table (lib/city/rail-table.ts): twenty bytes a segment of
 *      track, expanded by the GPU (app/_components/rail-segments.ts).
 *
 * The builders of today run under Bun as they are (mesh-kit.ts is plain
 * arithmetic over three's geometry classes), so arm 2 needs no copy of
 * the spike's DOM-free builders: the runs the builders lay (handed to a
 * `RailSink`) are the input of all three arms, and arm 1's triangles are
 * mesh-kit's own ribbons over them.
 *
 * Per arm: bytes on the wire (gzip 9), the scene thread's milliseconds
 * (here: this machine's, under Bun — which arm is heavy, not what a phone
 * pays), bytes on the GPU (as three uploads them, gpu-bytes.ts), and the
 * street rail against the road: how far each rail-head vertex of a tram
 * track in the paving stands over the drawn ground (the fine level's own
 * triangles) — the builders stand it RAIL_PAVED 2 cm proud.
 *
 *   bun scripts/eval/lines-three-ways.ts [site] [tile]
 *
 * Writes .cache/ledger-dressing/lines.json; `bun run ledger` folds it into
 * the ledger's `dressing.recorded.lines`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import nodePath from "node:path";
import { gzipSync } from "node:zlib";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BufferGeometry, Mesh, Object3D } from "three/webgpu";
import { MeshoptDecoder } from "meshoptimizer";
import { addRibbon, mesh3, meshFrom } from "../../app/_components/mesh-kit";
import type { Mesh3 } from "../../app/_components/mesh-kit";
import { railSteps } from "../../app/_components/rail-layer";
import {
  railChunkMesh,
  railProfile,
} from "../../app/_components/rail-segments";
import { tramSteps } from "../../app/_components/tram-layer";
import { finished } from "../../lib/city/build-steps";
import type {
  AreaFeature,
  BridgeFeature,
  RailFeature,
  TramFeature,
} from "../../lib/city/features";
import { worldToEpsg } from "../../lib/city/ground-clamp";
import {
  expandRail,
  packRails,
  RAIL_RECORD_BYTES,
  RAIL_STEP_M,
  RAIL_STEP_Y_M,
  RAIL_TOLERANCE,
  railFile,
  railSegmentAt,
  railSegmentCount,
  railSink,
  runBearings,
  simplifyRun,
} from "../../lib/city/rail-table";
import type { RailLook, RailRun } from "../../lib/city/rail-table";
import { toExtMeshopt } from "../khr-meshopt";
import { DRESSING_SCRATCH } from "../ledger-dressing";
import { writeMeshGlb } from "../tile-glb";
import { gpuBytesOf } from "./gpu-bytes";
import { publishedTile } from "./published-ground";

const RAIL_HALF = 0.075;
const LOOKS: RailLook[] = ["rail", "tram", "tram-street"];
const gz = (bytes: Uint8Array): number => gzipSync(bytes, { level: 9 }).length;

/** The median of `runs` timings of `work` (ms), after one warm-up. */
function timed(work: () => unknown, runs = 5): number {
  work();
  const ms: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    work();
    ms.push(performance.now() - start);
  }
  return (
    Math.round(ms.toSorted((a, b) => a - b)[Math.floor(runs / 2)] * 10) / 10
  );
}

/** A run's two rails as the runtime's ribbons (rail-layer.ts `addRail`,
 *  tram-layer.ts `addTrack`). */
function ribbons(acc: Mesh3, run: RailRun): void {
  for (const side of [1, -1]) {
    addRibbon(
      acc,
      [...run.pts],
      run.lateral + (side * run.gauge) / 2,
      RAIL_HALF,
      run.web
    );
  }
}

/** World (Y-up) → the recentred data frame the glTF writer takes. */
function worldToData(xyz: readonly number[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(xyz.length);
  for (let i = 0; i < xyz.length; i += 3) {
    out[i] = xyz[i];
    out[i + 1] = -xyz[i + 2];
    out[i + 2] = xyz[i + 1];
  }
  return out;
}

/** What a street rail's head stands over its paving (lib/city/tram.ts
 *  `RAIL_TOP_M.street`), and how far over the ground a vertex still counts
 *  as lying in a street (a track on a bridge is "street" too: its deck is
 *  paved, and metres over the ground). */
const STREET_PROUD_M = 0.02;
const ON_GROUND_M = 0.5;

const mm = (v: number) => Math.round(v * 1000) / 1000;

interface Heights {
  /** the share of rail-head vertices under the ground */
  buried: number;
  /** the worst of them (m under the ground) */
  deepest: number;
  /** the head over the ground less the 2 cm it is meant to stand proud:
   *  the 5th, 50th and 95th percentile (m) */
  p05: number;
  p50: number;
  p95: number;
  vertices: number;
}

/** How the rail-head vertices that lie in a street stand against it (m,
 *  to the millimetre). */
function heights(over: number[]): Heights {
  const sorted = over
    .filter((v) => Math.abs(v) < ON_GROUND_M)
    .toSorted((a, b) => a - b);
  const at = (q: number) =>
    mm((sorted[Math.floor(q * (sorted.length - 1))] ?? 0) - STREET_PROUD_M);
  return {
    vertices: sorted.length,
    p05: at(0.05),
    p50: at(0.5),
    p95: at(0.95),
    buried:
      Math.round(
        (sorted.filter((v) => v < 0).length / Math.max(sorted.length, 1)) *
          10_000
      ) / 10_000,
    deepest: mm(Math.min(0, sorted[0] ?? 0)),
  };
}

function geometriesUnder(root: Object3D): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  root.traverse((o) => {
    const { geometry } = o as Mesh;
    if (geometry) {
      out.push(geometry);
    }
  });
  return out;
}

type Over = (x: number, y: number, z: number) => number | null;

/** The rails of one look as the runtime's triangle soup. */
function soupsOf(runs: readonly RailRun[]): Record<RailLook, Mesh3> {
  const soups: Record<RailLook, Mesh3> = {
    rail: mesh3(),
    tram: mesh3(),
    "tram-street": mesh3(),
  };
  for (const run of runs) {
    ribbons(soups[run.look], run);
  }
  return soups;
}

/** Arm 2: `runs` as glTF nodes, written as PR #156 wrote them. */
async function bakedArm(runs: readonly RailRun[], over: Over) {
  const soups = soupsOf(runs);
  const nodes = LOOKS.flatMap((look) => {
    const soup = soups[look];
    return soup.pos.length === 0
      ? []
      : [
          {
            name: `${look}-rails`,
            positions: worldToData(soup.pos),
            normals: worldToData(soup.nrm),
            weld: true,
          },
        ];
  });
  const [first, ...rest] = nodes;
  if (!first) {
    return null;
  }
  const glb = await writeMeshGlb({ ...first, children: rest, extras: {} });
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const body = toExtMeshopt(glb);
  const parse = async () => await loader.parseAsync(body.slice().buffer, "");
  const gltf = await parse();
  const parseMs: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    await parse();
    parseMs.push(performance.now() - start);
  }
  gltf.scene.updateMatrixWorld(true);
  const streetOver: number[] = [];
  let step = 0;
  let vertices = 0;
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.geometry) {
      return;
    }
    const position = mesh.geometry.getAttribute("position");
    vertices += position.count;
    if (!mesh.name.startsWith("tram-street")) {
      return;
    }
    const normal = mesh.geometry.getAttribute("normal");
    const e = mesh.matrixWorld.elements;
    // one unit of the stored integers, in metres (a normalized 16-bit
    // integer spans −1…1 in 65 534 steps)
    step =
      Math.max(Math.abs(e[0]), Math.abs(e[5]), Math.abs(e[10])) /
      (position.normalized ? 32_767 : 1);
    for (let i = 0; i < position.count; i += 1) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      // the glTF is Y-up like the scene; a rail head's normal points up
      if (normal.getY(i) > 0.5) {
        const d = over(
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14]
        );
        if (d !== null) {
          streetOver.push(d);
        }
      }
    }
  });
  const sample = geometriesUnder(gltf.scene)[0]?.getAttribute("position");
  return {
    wire: { glb: gz(glb) },
    sceneThreadMs: {
      // the glTF's parse and meshopt decode (in the viewer inside the
      // level's own parse)
      parse: Math.round(parseMs.toSorted((a, b) => a - b)[2] * 10) / 10,
    },
    gpuBytes: gpuBytesOf(geometriesUnder(gltf.scene)),
    vertices,
    positions: sample
      ? `${sample.array.constructor.name}${sample.normalized ? ", normalized" : ""}, ${sample.itemSize} an item`
      : "none",
    positionStepM: Math.round(step * 100_000) / 100_000,
    streetRailOverRoad: heights(streetOver),
  };
}

/** `runs` as point lists: a run's offset and count, then x, y, z and the
 *  bearing of each point as four words (for the size alone). */
function pointList(runs: readonly RailRun[]): Uint8Array {
  const words: number[] = [];
  const minX = Math.min(...runs.flatMap((r) => r.pts.map((p) => p.x)));
  const minY = Math.min(...runs.flatMap((r) => r.pts.map((p) => p.y)));
  const minZ = Math.min(...runs.flatMap((r) => r.pts.map((p) => p.z)));
  for (const run of runs) {
    const bearings = run.bearings ?? runBearings(run.pts);
    words.push(Math.round(run.lateral * 1000) + 32_768, run.pts.length);
    for (const [i, p] of run.pts.entries()) {
      words.push(
        Math.round((p.x - minX) * 32),
        Math.round((p.y - minY) * 256),
        Math.round((p.z - minZ) * 32),
        Math.round((((bearings[i] / (Math.PI * 2)) % 1) + 1) * 65_536) % 65_536
      );
    }
  }
  return new Uint8Array(Uint16Array.from(words).buffer);
}

/** Arm 3: `runs` as a segment table. */
function tableArm(runs: readonly RailRun[], over: Over) {
  const report = { clamped: 0, segments: 0 };
  const chunks = packRails(runs, report);
  const file = railFile(chunks);
  const profiles = new Map<string, BufferGeometry>();
  const sets = () =>
    chunks.map((chunk) => {
      const key = `${chunk.gauge}:${chunk.web}`;
      let profile = profiles.get(key);
      if (!profile) {
        profile = railProfile(chunk.gauge, chunk.web);
        profiles.set(key, profile);
      }
      return railChunkMesh(chunk, profile);
    });
  const meshes = sets();
  const streetOver: number[] = [];
  for (const chunk of chunks) {
    if (chunk.look !== "tram-street") {
      continue;
    }
    for (let i = 0; i < railSegmentCount(chunk); i += 1) {
      const s = railSegmentAt(chunk, i);
      // a segment that replaces several samples is checked along itself
      const length = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const stations = Math.max(1, Math.ceil(length / 2));
      for (let k = 0; k <= stations; k += 1) {
        for (const side of [1, -1]) {
          for (const edge of [1, -1]) {
            const p = expandRail(
              s,
              k / stations,
              (side * chunk.gauge) / 2 + edge * RAIL_HALF
            );
            const d = over(p.x, p.y, p.z);
            if (d !== null) {
              streetOver.push(d);
            }
          }
        }
      }
    }
  }
  return {
    wire: {
      table: gz(file),
      raw: file.length,
      // were a run's points written once (eight bytes a point, a segment
      // being two neighbours) — which needs a second view a record on
      // the GPU, or a storage buffer: an estimate, not built
      asPointList: gz(pointList(runs)),
    },
    sceneThreadMs: {
      // a view a chunk and its sphere: nothing is placed
      sets: timed(sets),
    },
    gpuBytes: gpuBytesOf(meshes.map((m) => m.geometry)),
    segments: report.segments,
    chunks: chunks.length,
    clamped: report.clamped,
    streetRailOverRoad: heights(streetOver),
  };
}

const isTrack = (f: unknown) => (f as TramFeature).properties?.k === "track";

/** A run's length in plan (m). */
function runMetres(run: RailRun): number {
  let d = 0;
  for (let i = 1; i < run.pts.length; i += 1) {
    d += Math.hypot(
      run.pts[i].x - run.pts[i - 1].x,
      run.pts[i].z - run.pts[i - 1].z
    );
  }
  return d;
}

async function main(): Promise<void> {
  const site = process.argv[2] ?? "dresden";
  const id = process.argv[3] ?? "33410_5656_2_sn";
  const tile = await publishedTile(site, id);
  const ctx = { offset: tile.offset, heightAt: tile.heightAt };
  const rail = {
    rails: tile.features<RailFeature>("rail"),
    bridges: tile.features<BridgeFeature>("bridge"),
    ballast: tile.features<AreaFeature>("railarea"),
    platforms: tile.features<AreaFeature>("platform"),
  };
  const trams = tile.features<TramFeature>("tram");
  const over = (x: number, y: number, z: number): number | null => {
    const e = worldToEpsg(x, z, tile.offset);
    const ground = tile.heightAt(e.x, e.y);
    return ground === null ? null : y - ground;
  };

  // --- the runs the builders lay -------------------------------------------
  const sink = railSink();
  finished(railSteps(rail, { ...ctx, railTable: sink }));
  finished(tramSteps(trams, rail.bridges, { ...ctx, railTable: sink }));
  const { runs } = sink;
  const segments = runs.reduce((n, r) => n + Math.max(r.pts.length - 1, 0), 0);
  const metres = runs.reduce((sum, r) => sum + runMetres(r), 0);

  // --- arm 1: today ---------------------------------------------------------
  const builders = {
    // the whole builders, rails and everything else they build
    railBuilder: timed(() => finished(railSteps(rail, ctx))),
    tramBuilder: timed(() => finished(tramSteps(trams, rail.bridges, ctx))),
    // … with the rails' triangles left out (handed to a sink): the
    // difference is what laying the rails as triangles costs
    railBuilderWithoutRails: timed(() =>
      finished(railSteps(rail, { ...ctx, railTable: railSink() }))
    ),
    tramBuilderWithoutRails: timed(() =>
      finished(
        tramSteps(trams, rail.bridges, { ...ctx, railTable: railSink() })
      )
    ),
  };
  const soups = soupsOf(runs);
  const todayMeshes = LOOKS.flatMap((look) => {
    const m = meshFrom(soups[look], 0, { cast: false });
    return m ? [m] : [];
  });
  const source = (kind: string, keep: (f: unknown) => boolean): number => {
    const file = (
      tile.tile.terrain[0].extras.dressing as Record<string, string>
    )[kind];
    if (!file) {
      return 0;
    }
    const doc = JSON.parse(
      new TextDecoder().decode(tile.published.read(file))
    ) as { features: unknown[] };
    return gz(
      new TextEncoder().encode(
        JSON.stringify({ ...doc, features: doc.features.filter(keep) })
      )
    );
  };
  const streetOver: number[] = [];
  const street = soups["tram-street"];
  for (let i = 0; i < street.pos.length; i += 3) {
    if (street.nrm[i + 1] > 0.5) {
      const d = over(street.pos[i], street.pos[i + 1], street.pos[i + 2]);
      if (d !== null) {
        streetOver.push(d);
      }
    }
  }
  const today = {
    wire: {
      // the files as fetched: the rail file is lines alone, the tram file
      // also holds masts, spans, arms and stops
      railFile: source("rail", () => true),
      tramFile: source("tram", () => true),
      tramTracksOnly: source("tram", isTrack),
    },
    sceneThreadMs: {
      ...builders,
      rails:
        Math.round(
          (builders.railBuilder -
            builders.railBuilderWithoutRails +
            builders.tramBuilder -
            builders.tramBuilderWithoutRails) *
            10
        ) / 10,
    },
    gpuBytes: gpuBytesOf(todayMeshes.map((m) => m.geometry)),
    vertices: todayMeshes.reduce(
      (n, m) => n + m.geometry.getAttribute("position").count,
      0
    ),
    streetRailOverRoad: heights(streetOver),
  };

  // --- arms 2 and 3, over every sample and over what a build would keep ----
  const kept = runs.map((r) => simplifyRun(r));
  const keptSegments = kept.reduce(
    (n, r) => n + Math.max(r.pts.length - 1, 0),
    0
  );
  const baked = {
    everySample: await bakedArm(runs, over),
    simplified: await bakedArm(kept, over),
  };
  const table = {
    recordBytes: RAIL_RECORD_BYTES,
    stepM: { plan: RAIL_STEP_M, height: RAIL_STEP_Y_M },
    everySample: tableArm(runs, over),
    simplified: tableArm(kept, over),
  };

  const all = cpus();
  const result = {
    site,
    tile: id,
    read: new Date().toISOString().slice(0, 10),
    machine: `${all[0]?.model.trim() ?? "unknown CPU"} ×${all.length}, ${process.platform}-${process.arch}, Bun ${Bun.version} (timings under Bun, not in a browser)`,
    runs: runs.length,
    segments,
    // what a build keeps of them (rail-table.ts `simplifyRun`)
    segmentsSimplified: keptSegments,
    simplifyTolerance: RAIL_TOLERANCE,
    trackMetres: Math.round(metres),
    today,
    baked,
    table,
  };
  mkdirSync(DRESSING_SCRATCH, { recursive: true });
  const out = nodePath.join(DRESSING_SCRATCH, "lines.json");
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

await main();
