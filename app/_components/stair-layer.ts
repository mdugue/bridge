import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import type { StairFeature } from "@/lib/city/features";
import type { RecenterOffset } from "@/lib/city/ground-clamp";
import {
  STAIR_CHEEK,
  STAIR_RISER,
  type StairLine,
  stairGeometry,
  stairLineOf,
} from "@/lib/city/stairs";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * Flights of steps from OSM (`pipeline/bake/stairs.py`). The DGM1 smooths a
 * staircase into a bank, so the terrain bake lowers the ground under each
 * flight (lib/city/stairs.ts `burnStairs`) and this stands the steps on it
 * as stone blocks — treads, risers, side cheeks — at the landing heights the
 * bake read. Built per fine terrain tile by the dressing plugin
 * (tile-stream.ts), for the flights whose middle that tile owns; authored
 * Y-up, so it lives in the Y-up frame. Missing/empty inputs: an empty group.
 */

export interface StairContext {
  heightFog?: HeightFogUniforms;
  offset: RecenterOffset;
}

/** Pale sandstone, a shade lighter than the walls (0xc9bda4). */
const STONE = new Color(0xd8_ce_b9);
/** Risers a touch darker than the treads, cheeks between: the flight reads
 *  as steps even under a flat, overcast light. */
const SHADE = { tread: 1, riser: 0.82, cheek: 0.9 };

function shadeOf(kind: number): number {
  if (kind === STAIR_RISER) {
    return SHADE.riser;
  }
  return kind === STAIR_CHEEK ? SHADE.cheek : SHADE.tread;
}

function buildStairGeometry(
  stairs: StairLine[],
  offset: RecenterOffset
): BufferGeometry | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  for (const stair of stairs) {
    const data = stairGeometry(stair, offset);
    if (!data) {
      continue;
    }
    pos.push(...data.positions);
    nrm.push(...data.normals);
    for (const kind of data.kinds) {
      const s = shadeOf(kind);
      col.push(STONE.r * s, STONE.g * s, STONE.b * s);
    }
  }
  if (pos.length === 0) {
    return null;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** A tile's flights as one mesh; freed with the tile. */
export function buildStairs(
  features: StairFeature[],
  ctx: StairContext
): Group {
  const group = new Group();
  group.name = "stairs";
  const stairs = features.flatMap((f) => stairLineOf(f) ?? []);
  const geo = stairs.length > 0 ? buildStairGeometry(stairs, ctx.offset) : null;
  if (!geo) {
    return group;
  }
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    side: DoubleSide,
  });
  const heightFog = ctx.heightFog;
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  const mesh = new Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
