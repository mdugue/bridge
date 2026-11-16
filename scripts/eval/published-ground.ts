/**
 * A published tile as the browser gets it, for the measuring scripts of
 * plan 090's phase 0 (scripts/eval/lines-three-ways.ts,
 * stand-record-bytes.ts): its fine terrain level's ground — the very
 * triangles the GPU draws, decoded from the published glTF and indexed as
 * the viewer indexes them (lib/city/terrain-tin.ts `TinIndex`) — and its
 * side files, read through the ledger's one reader (`publishedFiles`).
 * Build-time only; reads public/data/<site>/.
 */
import { gunzipSync } from "node:zlib";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { ledgerTiles } from "../../lib/city/ledger";
import type { LedgerTile } from "../../lib/city/ledger";
import type { RecenterOffset } from "../../lib/city/ground-clamp";
import type { TerrainBounds } from "../../lib/city/terrain-geometry";
import { TinIndex } from "../../lib/city/terrain-tin";
import { toExtMeshopt } from "../khr-meshopt";
import { publishedFiles } from "../ledger";
import type { PublishedFiles } from "../ledger";

export interface PublishedTile {
  bounds: TerrainBounds;
  /** a side file of the fine level's dressing, parsed (its features), or
   *  none where the tile has none of the kind */
  features: <F>(kind: string) => F[];
  /** the fine level's ground (EPSG in, elevation out; null off the tile) */
  heightAt: (x: number, y: number) => number | null;
  offset: RecenterOffset;
  published: PublishedFiles;
  tile: LedgerTile;
}

async function reader(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
}

/** The published tile `id` of `site`, its fine ground decoded. */
export async function publishedTile(
  site: string,
  id: string
): Promise<PublishedTile> {
  const published = publishedFiles(site);
  const tile = ledgerTiles(published.tileset).find((t) => t.id === id);
  if (!tile) {
    throw new Error(`${site} publishes no tile ${id}`);
  }
  const { offset } = (
    published.tileset as { extras: { offset: RecenterOffset } }
  ).extras;
  const glb = new Uint8Array(gunzipSync(published.read(tile.terrain[0].uri)));
  const io = await reader();
  const doc = await io.readBinary(toExtMeshopt(glb));
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === "terrain" && n.getMesh());
  const prim = node?.getMesh()?.listPrimitives()[0];
  const position = prim?.getAttribute("POSITION");
  const indices = prim?.getIndices();
  if (!(node && position && indices)) {
    throw new Error(`${id}: no terrain node in the fine level`);
  }
  // glTF's Y-up frame → the projected one: world (x, y, z) is data
  // (x, −z, y), recentred by the tileset's offset
  const m = node.getWorldMatrix();
  const count = position.getCount();
  const xy = new Float64Array(count * 2);
  const z = new Float32Array(count);
  const p = [0, 0, 0];
  const bounds: TerrainBounds = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let i = 0; i < count; i += 1) {
    position.getElement(i, p);
    const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const wy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const ex = wx + offset.cx;
    const ey = offset.cy - wz;
    xy[2 * i] = ex;
    xy[2 * i + 1] = ey;
    z[i] = wy;
    bounds[0] = Math.min(bounds[0], ex);
    bounds[1] = Math.min(bounds[1], ey);
    bounds[2] = Math.max(bounds[2], ex);
    bounds[3] = Math.max(bounds[3], ey);
  }
  const triangles = indices.getArray();
  if (!triangles) {
    throw new Error(`${id}: the fine level has no index`);
  }
  const tin = new TinIndex({ bounds, xy, z, triangles });
  const dressing = (tile.terrain[0].extras.dressing ?? {}) as Record<
    string,
    string | undefined
  >;
  return {
    bounds,
    offset,
    published,
    tile,
    heightAt: (x, y) => tin.heightAt(x, y),
    features: <F>(kind: string): F[] => {
      const file = dressing[kind];
      if (!file) {
        return [];
      }
      const collection = JSON.parse(
        new TextDecoder().decode(published.read(file))
      ) as { features?: F[] };
      return collection.features ?? [];
    },
  };
}
