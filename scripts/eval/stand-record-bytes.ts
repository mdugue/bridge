/**
 * Plan 090, phase 0, step 2 — the stand record's bytes: a coarse level's
 * crowns as the file published today (`CRW1`, lib/city/coarse-crowns.ts:
 * float x and z, no height, the viewer makes each matrix and reads the
 * ground) against the same crowns as stand records
 * (lib/city/stand-record.ts: the place over the tile's box with the
 * height in it, turn and scale, sorted by vegetation chunk and crown
 * form as a set draws them), for the plan's four tiles. Gzip 9 both; the
 * bytes a crown's placement takes on the GPU; and how far a record's
 * place and scale lie from the matrix the viewer writes today.
 *
 * The heights are the fine level's ground, standing in for the coarse
 * level's the crowns stand on today (a build would bake the coarse
 * ground's: the same kind of number, so the same bytes).
 *
 *   bun scripts/eval/stand-record-bytes.ts
 *
 * Writes .cache/ledger-dressing/stands.json (with the probe's answers,
 * scripts/eval/stand-record-probe.ts --out, where that was run first);
 * `bun run ledger` folds it into the ledger's `dressingRecorded.stands`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { Matrix4 } from "three/webgpu";
import { crownStand } from "../../app/_components/coarse-crowns-layer";
import { coarseForm, unpackCrowns } from "../../lib/city/coarse-crowns";
import {
  packStands,
  standAt,
  standOrigin,
  STAND_RECORD_BYTES,
  STAND_SCALE_UNIT,
  STAND_STEP_M,
} from "../../lib/city/stand-record";
import type { Stand } from "../../lib/city/stand-record";
import { bucketByCell } from "../../lib/city/tree-placement";
import { DRESSING_SCRATCH } from "../ledger";
import { publishedTile } from "./published-ground";

const TILES = [
  { site: "dresden", tile: "33412_5656_2_sn", what: "spawn" },
  { site: "dresden", tile: "33416_5658_2_sn", what: "forest" },
  { site: "dresden", tile: "33410_5656_2_sn", what: "yards" },
  { site: "muenchen", tile: "32690_5334_2_by", what: "heaviest" },
] as const;

const FORMS = ["broad", "cone", "pine"] as const;
const gz = (bytes: Uint8Array): number => gzipSync(bytes, { level: 9 }).length;
const mm = (m: number): number => Math.round(m * 10_000) / 10_000;

/** The stands as a file: a magic, the count, the origin, the records. */
function standFile(words: Uint16Array, origin: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(20 + words.byteLength);
  const view = new DataView(bytes.buffer);
  const magic = "STD0";
  for (let i = 0; i < magic.length; i += 1) {
    view.setUint8(i, magic.codePointAt(i) ?? 0);
  }
  view.setUint32(4, words.length / (STAND_RECORD_BYTES / 2), true);
  for (let axis = 0; axis < 3; axis += 1) {
    view.setFloat32(8 + axis * 4, origin[axis], true);
  }
  bytes.set(
    new Uint8Array(words.buffer, words.byteOffset, words.byteLength),
    20
  );
  return bytes;
}

async function measure(site: string, id: string, what: string) {
  const tile = await publishedTile(site, id);
  const name = (tile.tile.terrain[1].extras.coarse as { crowns?: string })
    .crowns;
  if (!name) {
    return { site, tile: id, what, crowns: 0 };
  }
  const served = tile.published.read(name);
  const raw = new Uint8Array(gunzipSync(served));
  const crowns = unpackCrowns(raw.buffer) ?? [];
  const m = new Matrix4();
  // as the layer stands them: on the ground, bucketed by chunk and form
  const standing = crowns.flatMap((c) => {
    const ground = tile.heightAt(c.x + tile.offset.cx, tile.offset.cy - c.z);
    return ground === null ? [] : [{ ...c, ground }];
  });
  const sorted = bucketByCell(standing).flatMap((cell) =>
    FORMS.flatMap((form) => cell.filter((c) => coarseForm(c) === form))
  );
  const stands: Stand[] = sorted.map((c) => crownStand(c, c.ground, m));
  const origin = standOrigin(stands);
  const words = packStands(stands, origin);
  let place = 0;
  let scale = 0;
  let clamped = 0;
  for (const [i, s] of stands.entries()) {
    const back = standAt(words, i, origin);
    place = Math.max(
      place,
      Math.hypot(back.x - s.x, back.y - s.y, back.z - s.z)
    );
    for (let axis = 0; axis < 3; axis += 1) {
      const d = Math.abs(back.scale[axis] - s.scale[axis]);
      if (d > 1 / STAND_SCALE_UNIT) {
        clamped += 1;
      }
      scale = Math.max(scale, d / Math.max(s.scale[axis], 1e-6));
    }
  }
  return {
    site,
    tile: id,
    what,
    crowns: crowns.length,
    // (a crown whose spot the fine ground does not cover is left out)
    standing: stands.length,
    today: {
      recordBytes: 20,
      wire: served.length,
      raw: raw.length,
      // sixteen floats a crown, written on the scene's thread
      gpuPlacementBytes: stands.length * 64,
    },
    record: {
      recordBytes: STAND_RECORD_BYTES,
      wire: gz(standFile(words, origin)),
      raw: 20 + words.byteLength,
      // the file's own bytes, uploaded
      gpuPlacementBytes: words.byteLength,
      stepM: STAND_STEP_M,
      // against the matrix the viewer writes today
      worstPlaceM: mm(place),
      worstScaleShare: mm(scale),
      scalesOutOfRange: clamped,
    },
  };
}

async function main(): Promise<void> {
  const tiles = [];
  for (const { site, tile, what } of TILES) {
    if (existsSync(nodePath.join("public/data", site, "manifest.json"))) {
      tiles.push(await measure(site, tile, what));
    }
  }
  mkdirSync(DRESSING_SCRATCH, { recursive: true });
  const probeFile = nodePath.join(DRESSING_SCRATCH, "stand-probe.json");
  const probe = existsSync(probeFile)
    ? (JSON.parse(readFileSync(probeFile, "utf-8")) as { probe?: unknown })
        .probe
    : undefined;
  const result = {
    read: new Date().toISOString().slice(0, 10),
    bytes: tiles,
    ...(probe === undefined ? {} : { probe }),
  };
  writeFileSync(
    nodePath.join(DRESSING_SCRATCH, "stands.json"),
    `${JSON.stringify(result, null, 2)}\n`
  );
  process.stdout.write(
    `${JSON.stringify({ ...result, probe: undefined }, null, 2)}\n`
  );
}

await main();
