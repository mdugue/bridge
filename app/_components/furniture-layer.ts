import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FurnitureFeature } from "@/lib/city/features";
import {
  FURNITURE_MODELS,
  type FurnitureModel,
  type FurniturePiece,
  furniturePieces,
} from "@/lib/city/furniture";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * Street furniture (`pipeline/bake/furniture.py`: OSM benches, picnic
 * tables, litter bins, bicycle stands, bollards, post boxes and stop
 * shelters). Each kind is one small model — a few boxes and cylinders in
 * muted, pastel-leaning tones carried as vertex colours — instanced once per
 * tile under one material: eight draw calls per tile at most. A model's
 * front is its local +Z, turned to the bearing the bake gave (towards the
 * nearest way); a bench is stretched to its mapped length.
 *
 * Built per fine terrain tile by the dressing plugin (tile-stream.ts), in
 * the Y-up frame, stood on that tile's ground. Non-fatal: missing or empty
 * input yields an empty group.
 */

export interface FurnitureContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

const WOOD = 0xa6_84_64;
const IRON = 0x55_59_5f;
const STONE = 0xc9_c3_b8;
const BIN = 0x6d_78_6c;
const POSTBOX = 0xe2_c2_5c;
const ROOF = 0x8d_96_a0;
const PANE = 0xc9_d7_df;

function tinted(geo: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const n = geo.getAttribute("position").count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  return geo;
}

function box(
  size: [number, number, number],
  at: [number, number, number],
  hex: number
): BufferGeometry {
  const geo = new BoxGeometry(...size);
  geo.translate(...at);
  return tinted(geo, hex);
}

function post(
  radius: number,
  height: number,
  at: [number, number],
  hex: number,
  top = radius
): BufferGeometry {
  const geo = new CylinderGeometry(top, radius, height, 8);
  geo.translate(at[0], height / 2, at[1]);
  return tinted(geo, hex);
}

/** Slats on two iron legs, a raked backrest at the rear (local −Z). */
function bench(back: boolean): BufferGeometry[] {
  const parts = [
    box([1.8, 0.06, 0.42], [0, 0.45, 0.02], WOOD),
    box([0.06, 0.44, 0.42], [-0.75, 0.22, 0.02], IRON),
    box([0.06, 0.44, 0.42], [0.75, 0.22, 0.02], IRON),
  ];
  if (back) {
    const rest = new BoxGeometry(1.8, 0.4, 0.05);
    rest.rotateX(-0.2);
    rest.translate(0, 0.72, -0.2);
    parts.push(tinted(rest, WOOD));
  }
  return parts;
}

/** A table with its two benches, long side across the front. */
function picnic(): BufferGeometry[] {
  return [
    box([1.8, 0.06, 0.8], [0, 0.74, 0], WOOD),
    box([1.8, 0.05, 0.28], [0, 0.44, 0.6], WOOD),
    box([1.8, 0.05, 0.28], [0, 0.44, -0.6], WOOD),
    box([0.08, 0.72, 1.5], [-0.7, 0.36, 0], WOOD),
    box([0.08, 0.72, 1.5], [0.7, 0.36, 0], WOOD),
  ];
}

/** An inverted-U stand in the plane of its front (bikes lean along it). */
function hoop(): BufferGeometry[] {
  const r = 0.35;
  const arc = new TorusGeometry(r, 0.025, 6, 12, Math.PI);
  arc.rotateY(Math.PI / 2);
  arc.translate(0, 0.45, 0);
  return [
    tinted(arc, IRON),
    post(0.025, 0.45, [0, r], IRON),
    post(0.025, 0.45, [0, -r], IRON),
  ];
}

/** Posts, a back pane, a flat roof: the open side (local +Z) to the street. */
function shelter(): BufferGeometry[] {
  return [
    box([3.6, 0.08, 1.6], [0, 2.4, 0], ROOF),
    box([3.4, 1.9, 0.04], [0, 1.25, -0.7], PANE),
    box([0.04, 1.9, 1.3], [-1.7, 1.25, -0.05], PANE),
    post(0.05, 2.4, [-1.75, -0.75], IRON),
    post(0.05, 2.4, [1.75, -0.75], IRON),
    post(0.05, 2.4, [-1.75, 0.75], IRON),
    post(0.05, 2.4, [1.75, 0.75], IRON),
    box([1.4, 0.05, 0.35], [0.6, 0.47, -0.5], WOOD),
  ];
}

function modelParts(model: FurnitureModel): BufferGeometry[] {
  switch (model) {
    case "bench":
      return bench(true);
    case "stool":
      return bench(false);
    case "picnic":
      return picnic();
    case "bin":
      return [
        post(0.22, 0.85, [0, 0], BIN, 0.24),
        post(0.04, 0.1, [0, 0], IRON),
      ];
    case "hoop":
      return hoop();
    case "bollard":
      return [post(0.09, 0.9, [0, 0], STONE, 0.07)];
    case "postbox":
      return [
        box([0.48, 0.64, 0.36], [0, 0.82, 0], POSTBOX),
        post(0.05, 0.5, [0, 0], IRON),
      ];
    case "shelter":
      return shelter();
    default:
      return [];
  }
}

function modelGeometry(model: FurnitureModel): BufferGeometry | null {
  const parts = modelParts(model);
  const geo = parts.length > 0 ? mergeGeometries(parts) : null;
  for (const p of parts) {
    p.dispose();
  }
  return geo;
}

interface Stood {
  at: Vector3;
  piece: FurniturePiece;
}

function instanced(
  model: FurnitureModel,
  stood: Stood[],
  material: MeshStandardMaterial
): InstancedMesh | null {
  const geo = modelGeometry(model);
  if (!geo) {
    return null;
  }
  const mesh = new InstancedMesh(geo, material, stood.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < stood.length; i++) {
    const { at, piece } = stood[i];
    q.setFromAxisAngle(up, piece.yaw);
    s.set(piece.scaleX, 1, 1);
    mesh.setMatrixAt(i, m.compose(at, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Spread-out cloud: recompute the sphere or it culls when the origin is off-screen.
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `furniture-${model}`;
  return mesh;
}

/** One tile's street furniture as instanced models on its ground. */
export function buildFurniture(
  features: FurnitureFeature[],
  ctx: FurnitureContext
): Group {
  const group = new Group();
  group.name = "furniture";
  const byModel = new Map<FurnitureModel, Stood[]>();
  for (const piece of furniturePieces(features)) {
    const ground = ctx.heightAt(piece.x, piece.y);
    if (ground === null) {
      continue; // off the tile / NoData
    }
    const { x, z } = epsgToWorld(piece.x, piece.y, ctx.offset);
    const list = byModel.get(piece.model) ?? [];
    list.push({ at: new Vector3(x, ground, z), piece });
    byModel.set(piece.model, list);
  }
  if (byModel.size === 0) {
    return group;
  }
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
  });
  const { heightFog } = ctx;
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  for (const model of FURNITURE_MODELS) {
    const stood = byModel.get(model);
    const mesh = stood ? instanced(model, stood, material) : null;
    if (mesh) {
      group.add(mesh);
    }
  }
  return group;
}
