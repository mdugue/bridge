import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ExtrudeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShapeUtils,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FurnitureFeature } from "@/lib/city/features";
import {
  type FurnitureArea,
  FURNITURE_MODELS,
  type FurnitureModel,
  type FurniturePiece,
  furnitureAreas,
  furniturePieces,
  inRing,
} from "@/lib/city/furniture";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { subdividePolyline } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * Street furniture (`pipeline/bake/furniture.py`: OSM benches, picnic
 * tables, litter bins, bicycle stands, bollards, post boxes and stop
 * shelters, and playgrounds). Each kind is one small, abstracted model —
 * softened blocks, capsules and single tube strokes, like the pieces of an
 * architect's model, in the scene's pastels carried as vertex colours —
 * instanced once per tile under one matte material. A model's front is its local
 * +Z, turned to the bearing the bake gave (towards the nearest way); a
 * bench is stretched to its mapped length, a bollard to its tagged height.
 *
 * A playground is its OSM outline as a pale sand floor flush on the
 * ground (a sandpit drawn as an area, a sand slab on it), merged into one
 * mesh per tile; only the equipment OSM maps stands on it, each piece a
 * soft one-coloured sculpture — an arch for a swing, a wave for a slide, a
 * faceted dome for a climbing frame. An empty playground stays empty.
 *
 * Built per fine terrain tile by the dressing plugin (tile-stream.ts), in
 * the Y-up frame, stood on that tile's ground. Non-fatal: missing or empty
 * input yields an empty group.
 */

export interface FurnitureContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

/*
 * The palette: the pastel family of the ground (lib/city/landcover.ts) and
 * the buildings' clay, a shade deeper so the pieces read on the paving.
 * Seating is a warm honey clay, everything metal a soft slate-lavender (the
 * road's own hue), stone a pale warm grey; the playground's colours are the
 * same pastels, a little brighter.
 */
const HONEY = 0xd3_b0_8c; // seats, tables, playground timber
const HONEY_DEEP = 0xb9_97_77; // what carries them
const SLATE = 0x9d_9c_b0; // hoops, frames, bins, posts
const STONE = 0xdc_d4_c7; // stone bollards
const BRONZE = 0x9a_86_66; // metal bollards (the Stallhof's bronze columns)
const MUSTARD = 0xe0_c1_78; // post boxes
const ROOF = 0xb1_b3_c2;
const PANE = 0xdc_e6_ea;
/*
 * The playground's pieces are soft, single-coloured sculptures — a play
 * landscape in an architect's model rather than catalogue equipment — each
 * in one of five pastels taken from the scene's own: the meadow's sage, the
 * water's dusty blue, a peach and a butter from the sandstone and the
 * lamps' warm light, a lilac from the roads. The floor is a pale sand a
 * breath warmer than the paving, so the playground reads as a place, not
 * as a slab.
 */
const PLAY_FLOOR = 0xec_df_c9;
const SAND = 0xf1_e3_c1;
const PEACH = 0xe9_bd_a4;
const SAGE = 0xbf_cf_ab;
const DUSK_BLUE = 0xab_c5_d6;
const BUTTER = 0xee_da_a2;
const LILAC = 0xcb_bd_d8;
/** A playground slab's top over the ground (m), and a sandpit's over that. */
const PATCH_LIFT = 0.04;
const SAND_LIFT = 0.06;
/** The slab's edge reaches this far below its top, so no slope shows under it. */
const PATCH_SKIRT = 0.2;
/** Ring vertices this far apart at most, each seated on the ground (m). */
const PATCH_STEP = 2;

/** A part in one colour, non-indexed: RoundedBoxGeometry has no index and
 *  mergeGeometries needs every part alike. */
function tinted(source: BufferGeometry, hex: number): BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source;
  if (geo !== source) {
    source.dispose();
  }
  const c = new Color(hex);
  const n = geo.getAttribute("position").count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgb.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  return geo;
}

/** A softened block: chamfered edges catch the light like a model's card. */
function block(
  size: [number, number, number],
  at: [number, number, number],
  hex: number,
  radius = Math.min(...size) * 0.3
): BufferGeometry {
  const geo = new RoundedBoxGeometry(...size, 1, radius);
  geo.translate(...at);
  return tinted(geo, hex);
}

/** A rounded column standing on the ground (a capsule sunk to its waist). */
function pillar(
  radius: number,
  height: number,
  at: [number, number],
  hex: number
): BufferGeometry {
  const geo = new CapsuleGeometry(
    radius,
    Math.max(height - radius, 0.01),
    3,
    8
  );
  geo.translate(at[0], (height - radius) / 2, at[1]);
  return tinted(geo, hex);
}

/** One continuous soft tube through the points (arches, frames). */
function tube(
  points: [number, number, number][],
  radius: number,
  hex: number,
  segments = 12
): BufferGeometry {
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(...p)),
    false,
    "centripetal"
  );
  return tinted(new TubeGeometry(curve, segments, radius, 5, false), hex);
}

/**
 * A bench as one soft profile run along its length: the seat, and with a
 * back the rest curving up out of it — drawn as a section (x = −depth, so
 * the front ends up at local +Z), extruded, bevelled — on two inset cheeks.
 */
function bench(back: boolean): BufferGeometry[] {
  const section = new Shape();
  section.moveTo(-0.22, 0.4);
  section.lineTo(-0.22, 0.49);
  if (back) {
    section.lineTo(0.12, 0.49);
    section.quadraticCurveTo(0.2, 0.5, 0.24, 0.62);
    section.lineTo(0.32, 0.88);
    section.lineTo(0.38, 0.88);
    section.lineTo(0.3, 0.56);
    section.quadraticCurveTo(0.26, 0.42, 0.18, 0.4);
  } else {
    section.lineTo(0.22, 0.49);
    section.lineTo(0.22, 0.4);
  }
  section.closePath();
  const body = new ExtrudeGeometry(section, {
    depth: 1.76,
    bevelEnabled: true,
    bevelSize: 0.02,
    bevelThickness: 0.02,
    bevelSegments: 2,
    curveSegments: 4,
  });
  body.rotateY(Math.PI / 2);
  body.translate(-0.88, 0, 0);
  return [
    tinted(body, HONEY),
    block([0.12, 0.42, 0.34], [-0.62, 0.21, 0], HONEY_DEEP, 0.04),
    block([0.12, 0.42, 0.34], [0.62, 0.21, 0], HONEY_DEEP, 0.04),
  ];
}

/** A table between its two benches, long side across the front. */
function picnic(): BufferGeometry[] {
  return [
    block([1.8, 0.08, 0.8], [0, 0.74, 0], HONEY),
    block([1.8, 0.07, 0.3], [0, 0.44, 0.62], HONEY),
    block([1.8, 0.07, 0.3], [0, 0.44, -0.62], HONEY),
    block([0.1, 0.72, 1.4], [-0.7, 0.36, 0], HONEY_DEEP),
    block([0.1, 0.72, 1.4], [0.7, 0.36, 0], HONEY_DEEP),
  ];
}

/** An inverted U in the plane of its front, one soft stroke. */
function hoop(): BufferGeometry[] {
  return [
    tube(
      [
        [0, 0, 0.35],
        [0, 0.55, 0.35],
        [0, 0.78, 0.2],
        [0, 0.82, 0],
        [0, 0.78, -0.2],
        [0, 0.55, -0.35],
        [0, 0, -0.35],
      ],
      0.035,
      SLATE
    ),
  ];
}

/** A thin roof over a frosted back pane: the open side (local +Z) to the street. */
function shelter(): BufferGeometry[] {
  return [
    block([3.6, 0.1, 1.6], [0, 2.4, 0], ROOF, 0.05),
    block([3.4, 1.9, 0.06], [0, 1.3, -0.7], PANE, 0.03),
    block([0.06, 1.9, 1.2], [-1.7, 1.3, -0.1], PANE, 0.03),
    pillar(0.06, 2.4, [-1.75, -0.75], SLATE),
    pillar(0.06, 2.4, [1.75, -0.75], SLATE),
    block([1.4, 0.07, 0.35], [0.6, 0.47, -0.5], HONEY),
  ];
}

/** A shape's section extruded `depth` along local X, softly bevelled and
 *  centred (the section is drawn in the YZ plane, x = −z). */
function extrudedX(section: Shape, depth: number, hex: number): BufferGeometry {
  const geo = new ExtrudeGeometry(section, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.04,
    bevelThickness: 0.04,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(-depth / 2, 0, 0);
  return tinted(geo, hex);
}

/** One soft arch, and a pill-shaped seat hanging from it. */
function swing(): BufferGeometry[] {
  const seat = new CapsuleGeometry(0.08, 0.34, 3, 8);
  seat.rotateZ(Math.PI / 2);
  seat.translate(0, 0.5, 0);
  return [
    tube(
      [
        [-1.25, 0, 0],
        [-1.15, 1.6, 0],
        [-0.75, 2.15, 0],
        [0, 2.3, 0],
        [0.75, 2.15, 0],
        [1.15, 1.6, 0],
        [1.25, 0, 0],
      ],
      0.09,
      DUSK_BLUE,
      28
    ),
    tinted(seat, DUSK_BLUE),
    block([0.03, 1.7, 0.03], [-0.2, 1.4, 0], DUSK_BLUE, 0.012),
    block([0.03, 1.7, 0.03], [0.2, 1.4, 0], DUSK_BLUE, 0.012),
  ];
}

/** A wave: a soft rise at the back falling in one curve to the front. */
function slide(): BufferGeometry[] {
  const wave = new Shape();
  wave.moveTo(1.1, 0);
  wave.lineTo(1.1, 1.3);
  wave.quadraticCurveTo(1.1, 1.55, 0.8, 1.55);
  wave.quadraticCurveTo(0.2, 1.55, -0.4, 0.6);
  wave.quadraticCurveTo(-0.8, 0.12, -1.5, 0.12);
  wave.lineTo(-1.5, 0);
  wave.closePath();
  return [extrudedX(wave, 0.7, PEACH)];
}

/** A low faceted dome, the climbing hill. */
function climb(): BufferGeometry[] {
  const dome = new SphereGeometry(1.2, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const faceted = dome.toNonIndexed();
  dome.dispose();
  faceted.scale(1, 0.85, 1);
  faceted.computeVertexNormals();
  return [tinted(faceted, SAGE)];
}

/** An egg on a short stem. */
function springy(): BufferGeometry[] {
  const egg = new SphereGeometry(0.3, 12, 8);
  egg.scale(0.75, 0.9, 1.2);
  egg.translate(0, 0.62, 0);
  return [pillar(0.06, 0.36, [0, 0], BUTTER), tinted(egg, BUTTER)];
}

/** A long soft plank on a half-round pivot. */
function seesaw(): BufferGeometry[] {
  const pivot = new CylinderGeometry(0.22, 0.22, 0.3, 14, 1, false, 0, Math.PI);
  pivot.rotateZ(Math.PI / 2);
  pivot.rotateY(Math.PI / 2);
  return [
    tinted(pivot, LILAC),
    block([3, 0.1, 0.3], [0, 0.28, 0], LILAC, 0.05),
  ];
}

/** A flat disc with a rounded rim. */
function roundabout(): BufferGeometry[] {
  const disc = new CylinderGeometry(1, 1, 0.12, 24);
  disc.translate(0, 0.28, 0);
  const rim = new TorusGeometry(1, 0.06, 6, 24);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.34, 0);
  return [
    tinted(disc, DUSK_BLUE),
    tinted(rim, DUSK_BLUE),
    pillar(0.12, 0.28, [0, 0], DUSK_BLUE),
  ];
}

/** A house silhouette, extruded and softened. */
function playhouse(): BufferGeometry[] {
  const house = new Shape();
  house.moveTo(-0.7, 0);
  house.lineTo(0.7, 0);
  house.lineTo(0.7, 1.1);
  house.lineTo(0, 1.8);
  house.lineTo(-0.7, 1.1);
  house.closePath();
  return [extrudedX(house, 1.4, PEACH)];
}

/** Sand in a soft rounded frame (a sandpit mapped as a point). */
function sandbox(): BufferGeometry[] {
  const frame = new TorusGeometry(1.35, 0.1, 6, 4);
  frame.rotateX(Math.PI / 2);
  frame.rotateY(Math.PI / 4);
  frame.translate(0, 0.1, 0);
  return [
    block([2.6, 0.12, 2.6], [0, 0.06, 0], SAND, 0.04),
    tinted(frame, SAGE),
  ];
}

const MODEL_PARTS: Record<FurnitureModel, () => BufferGeometry[]> = {
  bench: () => bench(true),
  stool: () => bench(false),
  picnic,
  // A soft drum with a darker lid.
  bin: () => [
    pillar(0.22, 0.86, [0, 0], SLATE),
    block([0.4, 0.05, 0.4], [0, 0.86, 0], HONEY_DEEP, 0.02),
  ],
  hoop,
  bollard: () => [pillar(0.09, 0.9, [0, 0], STONE)],
  post: () => [pillar(0.09, 0.9, [0, 0], BRONZE)],
  postbox: () => [
    block([0.46, 0.6, 0.34], [0, 0.84, 0], MUSTARD),
    pillar(0.05, 0.56, [0, 0], SLATE),
  ],
  shelter,
  swing,
  slide,
  climb,
  springy,
  seesaw,
  roundabout,
  playhouse,
  sandbox,
};

function modelGeometry(model: FurnitureModel): BufferGeometry | null {
  const parts = MODEL_PARTS[model]();
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
    s.set(piece.scaleX, piece.scaleY, 1);
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

/** Non-indexed triangles with per-vertex normal and colour. */
interface Tris {
  colors: number[];
  normals: number[];
  positions: number[];
}

function pushVertex(t: Tris, p: Vector3, n: Vector3, c: Color): void {
  t.positions.push(p.x, p.y, p.z);
  t.normals.push(n.x, n.y, n.z);
  t.colors.push(c.r, c.g, c.b);
}

/** One area as a slab: the top at `lift` over the ground under each ring
 *  vertex, its edge dropping PATCH_SKIRT. */
function addSlab(
  t: Tris,
  area: FurnitureArea,
  lift: number,
  hex: number,
  ctx: FurnitureContext
): void {
  const closed = [...area.ring, area.ring[0]];
  const ring = subdividePolyline(closed, PATCH_STEP).slice(0, -1);
  const top: Vector3[] = [];
  for (const [ex, ey] of ring) {
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      return; // part off the loaded ground: leave the patch out
    }
    const { x, z } = epsgToWorld(ex, ey, ctx.offset);
    top.push(new Vector3(x, ground + lift, z));
  }
  const color = new Color(hex);
  const up = new Vector3(0, 1, 0);
  const contour = top.map((p) => new Vector2(p.x, p.z));
  // Wound either way in the data: face every triangle up.
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
    const [pa, pb, pc] = [top[a], top[b], top[c]];
    const ccw =
      (pb.x - pa.x) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.x - pa.x) < 0;
    for (const p of ccw ? [pa, pb, pc] : [pa, pc, pb]) {
      pushVertex(t, p, up, color);
    }
  }
  const centre = top
    .reduce((sum, p) => sum.add(p), new Vector3())
    .divideScalar(top.length);
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const q = top[(i + 1) % top.length];
    const n = new Vector3(q.z - p.z, 0, p.x - q.x).normalize();
    const mid = p.clone().add(q).multiplyScalar(0.5).sub(centre);
    if (n.dot(mid) < 0) {
      n.negate();
    }
    const pd = p.clone().setY(p.y - PATCH_SKIRT);
    const qd = q.clone().setY(q.y - PATCH_SKIRT);
    // (p, pd, q) faces n when (pd − p) × (q − p) points along it.
    const face = pd.clone().sub(p).cross(q.clone().sub(p));
    const quad =
      face.dot(n) > 0 ? [p, pd, q, q, pd, qd] : [p, q, pd, q, qd, pd];
    for (const v of quad) {
      pushVertex(t, v, n, color);
    }
  }
}

function buildPatches(
  areas: FurnitureArea[],
  material: MeshStandardMaterial,
  ctx: FurnitureContext
): Mesh | null {
  const t: Tris = { positions: [], normals: [], colors: [] };
  for (const area of areas) {
    if (area.kind === "playground") {
      addSlab(t, area, PATCH_LIFT, PLAY_FLOOR, ctx);
    }
  }
  for (const area of areas) {
    if (area.kind === "sandpit") {
      addSlab(t, area, PATCH_LIFT + SAND_LIFT, SAND, ctx);
    }
  }
  if (t.positions.length === 0) {
    return null;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(t.positions, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(t.normals, 3));
  geo.setAttribute("color", new Float32BufferAttribute(t.colors, 3));
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, material);
  mesh.name = "furniture-playgrounds";
  mesh.receiveShadow = true;
  return mesh;
}

/** How far a piece stands over the ground: onto a playground's slab, or a
 *  sandpit's on it. */
function liftAt(areas: FurnitureArea[], x: number, y: number): number {
  let lift = 0;
  for (const area of areas) {
    if (inRing(area.ring, x, y)) {
      lift = Math.max(
        lift,
        area.kind === "sandpit" ? PATCH_LIFT + SAND_LIFT : PATCH_LIFT
      );
    }
  }
  return lift;
}

function furnitureMaterial(
  ctx: FurnitureContext,
  flush = false
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0,
  });
  if (flush) {
    // The slab lies a hand's width over the ground: keep it off the terrain.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -2;
  }
  const { heightFog } = ctx;
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  return material;
}

/** One tile's street furniture as instanced models on its ground. */
export function buildFurniture(
  features: FurnitureFeature[],
  ctx: FurnitureContext
): Group {
  const group = new Group();
  group.name = "furniture";
  const areas = furnitureAreas(features);
  const byModel = new Map<FurnitureModel, Stood[]>();
  for (const piece of furniturePieces(features)) {
    const ground = ctx.heightAt(piece.x, piece.y);
    if (ground === null) {
      continue; // off the tile / NoData
    }
    const { x, z } = epsgToWorld(piece.x, piece.y, ctx.offset);
    const y = ground + liftAt(areas, piece.x, piece.y);
    const list = byModel.get(piece.model) ?? [];
    list.push({ at: new Vector3(x, y, z), piece });
    byModel.set(piece.model, list);
  }
  if (byModel.size === 0 && areas.length === 0) {
    return group;
  }
  const material = furnitureMaterial(ctx);
  for (const model of FURNITURE_MODELS) {
    const stood = byModel.get(model);
    const mesh = stood ? instanced(model, stood, material) : null;
    if (mesh) {
      group.add(mesh);
    }
  }
  const patches = buildPatches(areas, furnitureMaterial(ctx, true), ctx);
  if (patches) {
    group.add(patches);
  }
  return group;
}
