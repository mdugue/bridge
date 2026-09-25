import {
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type {
  FountainStyle,
  MonumentFeature,
  ReliefGrid,
} from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import {
  basinLevels,
  jetHeight,
  jetPlaces,
  MARKER_SHAPE,
  openRing,
  POINT_BASIN_R,
  reliefSurface,
  ringArea,
  ringCentre,
  yawOf,
} from "@/lib/city/monuments";
import type { Point2 } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * Fountains, statues, memorial stones and columns
 * (`pipeline/bake/monuments.py`: the Basis-DLM's monuments with their
 * official names, OSM's fountain basins, and the sculptures' bulk measured
 * in DOM1 − DGM1). Nothing here invents a shape the data does not carry:
 *
 * - a measured monument or fountain sculpture is its relief, smoothed into
 *   one soft form in the same pale clay as the buildings (lib/city/
 *   monuments.ts `reliefSurface`) — the right size and silhouette, no
 *   detail the 1 m grid does not have;
 * - a monument nothing measured is an abstract marker in that clay;
 * - a basin is its OSM outline as a low clay rim around still water, and a
 *   jet a translucent water bell rising from it.
 *
 * Built per fine terrain tile by the dressing plugin (tile-stream.ts), in
 * the Y-up frame; rims, water and reliefs are merged, markers and jets
 * instanced. Non-fatal: missing/empty inputs yield an empty group.
 */

export interface MonumentContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

/** The buildings' clay (visual-style.ts): one material language for all that is built. */
const CLAY_COLOR = 0xec_e7_df;
const WATER_COLOR = 0x9c_bc_d0; // a lighter cousin of the river's dusty blue
const WATER_GLOW = 0x12_1c_22; // lifts the water out of the rim's shade
const SPRAY_COLOR = 0xf4_f8_fb;
const RIM_M = 0.35; // a point fountain's rim width (the bake insets outlines by the same)

/** One instance: where, how big, which way. */
interface Placed {
  at: Vector3;
  scale: Vector3;
  yaw: number;
}

/** Everything one tile's monuments add up to, before it becomes meshes. */
interface Parts {
  jets: Placed[];
  pillars: Placed[];
  reliefs: BufferGeometry[];
  rims: BufferGeometry[];
  slabs: Placed[];
  waters: BufferGeometry[];
}

/** A pillar 1 m wide and 1 m tall, standing on the origin (scaled per instance). */
function unitPillar(): BufferGeometry {
  // radius 0.5 + length 0 → a sphere; stretched per instance into a pillar.
  return new CapsuleGeometry(0.5, 1, 6, 16)
    .scale(1, 0.5, 1)
    .translate(0, 0.5, 0);
}

function unitSlab(): BufferGeometry {
  return new RoundedBoxGeometry(1, 1, 1, 3, 0.2).translate(0, 0.5, 0);
}

/**
 * A water bell 1 m tall: a thin jet that opens at the top and falls back
 * in a widening curtain (a lathe of that profile). Its alpha fades along
 * the profile, so the falling water dissolves before it lands.
 */
function unitBell(): BufferGeometry {
  const profile = [
    [0.03, 0],
    [0.026, 0.55],
    [0.02, 0.92],
    [0.07, 1],
    [0.17, 0.95],
    [0.26, 0.8],
    [0.32, 0.58],
    [0.36, 0.33],
    [0.38, 0.08],
  ].map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(profile, 24);
}

/** The bell's alpha along its profile (lathe v: 0 at the nozzle, 1 at the
 *  curtain's hem; a canvas is flipped, so its top is v = 1). */
function bellAlpha(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, "rgb(90,90,90)");
    g.addColorStop(0.4, "rgb(200,200,200)");
    g.addColorStop(0.6, "rgb(90,90,90)");
    g.addColorStop(1, "rgb(0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
  }
  return new CanvasTexture(canvas);
}

/** A ring in shape space: (world x, −world z), which the −90° X turn maps
 *  back onto the ground plane. */
function shapePoints(ring: readonly Point2[], ctx: GroundContext): Vector2[] {
  return openRing(ring).map(([x, y]) => {
    const w = epsgToWorld(x, y, ctx.offset);
    return new Vector2(w.x, -w.z);
  });
}

/** A flat shape extruded from `base` up to `top`, lying on the ground plane. */
function extrude(shape: Shape, base: number, top: number): BufferGeometry {
  const geo = new ExtrudeGeometry(shape, {
    depth: Math.max(top - base, 0.01),
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, base, 0);
  geo.deleteAttribute("uv");
  return geo;
}

function flat(shape: Shape, y: number): BufferGeometry {
  const geo = new ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  geo.deleteAttribute("uv");
  return geo.toNonIndexed();
}

function circle(r: number, cx: number, cy: number): Path {
  const p = new Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return p;
}

/** A fountain's outline, water ring and centre, in projected coordinates. */
interface Basin {
  area: number;
  centre: Point2;
  /** the rim polygon's outer ring (null: a round basin at `centre`) */
  outer: Point2[] | null;
  /** the water's outline, when the rim has a hole */
  water: Point2[] | null;
}

function basinOf(f: MonumentFeature): Basin | null {
  const g = f.geometry;
  if (g?.type === "Point") {
    return {
      area: Math.PI * POINT_BASIN_R ** 2,
      centre: g.coordinates,
      outer: null,
      water: null,
    };
  }
  if (g?.type !== "Polygon" || !g.coordinates[0]) {
    return null;
  }
  const [outer, water] = g.coordinates;
  const centre = ringCentre(water ?? outer);
  return { area: ringArea(outer), centre, outer, water: water ?? null };
}

/** The pad (the whole outline), the rim and the water of one basin, as
 *  shapes on the ground plane. */
function basinShapes(
  b: Basin,
  ctx: GroundContext
): { pad: Shape; rim: Shape; water: Shape } {
  if (!b.outer) {
    const w = epsgToWorld(b.centre[0], b.centre[1], ctx.offset);
    const disc = (r: number) =>
      new Shape().absarc(w.x, -w.z, r, 0, Math.PI * 2, false);
    const rim = disc(POINT_BASIN_R);
    rim.holes.push(circle(POINT_BASIN_R - RIM_M, w.x, -w.z));
    return {
      pad: disc(POINT_BASIN_R),
      rim,
      water: disc(POINT_BASIN_R - RIM_M),
    };
  }
  const pad = new Shape(shapePoints(b.outer, ctx));
  const rim = new Shape(shapePoints(b.outer, ctx));
  if (b.water) {
    rim.holes.push(new Path(shapePoints(b.water, ctx)));
    return { pad, rim, water: new Shape(shapePoints(b.water, ctx)) };
  }
  // Too small to inset: a solid bowl, its water a smaller copy on top.
  const c = epsgToWorld(b.centre[0], b.centre[1], ctx.offset);
  const inner = shapePoints(b.outer, ctx).map(
    (p) => new Vector2(c.x + (p.x - c.x) * 0.7, -c.z + (p.y + c.z) * 0.7)
  );
  return { pad, rim, water: new Shape(inner) };
}

function groundUnder(b: Basin, ctx: GroundContext): number[] {
  const probes = b.outer ? [...openRing(b.outer), b.centre] : [b.centre];
  return probes
    .map(([x, y]) => ctx.heightAt(x, y))
    .filter((h): h is number => h !== null);
}

function worldAt(p: Point2, y: number, ctx: GroundContext): Vector3 {
  const w = epsgToWorld(p[0], p[1], ctx.offset);
  return new Vector3(w.x, y, w.z);
}

/**
 * The measured relief as a mesh on the ground: its smoothed heights
 * (`reliefSurface`) over the terrain under each sample, so the form sits
 * on a slope as the laser saw it. `floor` lifts the ground to a basin's
 * water, out of which a fountain's sculpture rises.
 */
function reliefMesh(
  grid: ReliefGrid,
  ctx: GroundContext,
  floor = Number.NEGATIVE_INFINITY
): BufferGeometry | null {
  const s = reliefSurface(grid);
  const centreGround = ctx.heightAt(
    s.west + (s.cols * s.step) / 2,
    s.north - (s.rows * s.step) / 2
  );
  if (centreGround === null) {
    return null;
  }
  const geo = new PlaneGeometry(
    (s.cols - 1) * s.step,
    (s.rows - 1) * s.step,
    s.cols - 1,
    s.rows - 1
  );
  geo.deleteAttribute("uv");
  const pos = geo.getAttribute("position") as BufferAttribute;
  // PlaneGeometry: vertices row by row from the top-left (+y) corner, which
  // is the grid's north-west sample.
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) {
      const i = row * s.cols + col;
      const x = s.west + col * s.step;
      const y = s.north - row * s.step;
      const ground = Math.max(ctx.heightAt(x, y) ?? centreGround, floor);
      const w = epsgToWorld(x, y, ctx.offset);
      pos.setXYZ(i, w.x, ground + s.heights[i], w.z);
    }
  }
  // The plane's +y (north) became −z: its winding now faces up.
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

function addFountain(
  f: MonumentFeature,
  ctx: GroundContext,
  parts: Parts
): void {
  const basin = basinOf(f);
  if (!basin) {
    return;
  }
  const style: FountainStyle = f.properties?.style ?? "basin";
  const levels = basinLevels(groundUnder(basin, ctx), style);
  if (!levels) {
    return; // off the loaded terrain
  }
  const shapes = basinShapes(basin, ctx);
  if (style === "splash") {
    // No rim: the whole pad is wet paving.
    parts.waters.push(flat(shapes.pad, levels.water));
  } else {
    parts.rims.push(extrude(shapes.rim, levels.base, levels.rim));
    // A bowl too small for a hole carries its water on top.
    const solid = basin.outer !== null && basin.water === null;
    parts.waters.push(
      flat(shapes.water, solid ? levels.rim + 0.01 : levels.water)
    );
  }
  const relief = f.properties?.relief;
  if (relief) {
    const geo = reliefMesh(relief, ctx, levels.water - 0.3);
    if (geo) {
      parts.reliefs.push(geo);
    }
  }
  const h = jetHeight(basin.area, style);
  if (h <= 0) {
    return;
  }
  const onWater = basin.water ?? basin.outer;
  // A sculpture takes the middle: the jets stand round it.
  for (const place of jetPlaces(
    basin.centre,
    basin.area,
    relief !== undefined,
    onWater
  )) {
    const spread = relief ? 0.6 : 0.85;
    parts.jets.push({
      at: worldAt(place, levels.water, ctx),
      scale: new Vector3(h * spread, h * spread, h * spread),
      yaw: 0,
    });
  }
}

function addMonument(
  f: MonumentFeature,
  ctx: GroundContext,
  parts: Parts
): void {
  const kind = f.properties?.kind;
  if (f.geometry?.type !== "Point" || !kind || kind === "fountain") {
    return;
  }
  const relief = f.properties?.relief;
  if (relief) {
    const geo = reliefMesh(relief, ctx);
    if (geo) {
      parts.reliefs.push(geo);
      return;
    }
  }
  const [x, y] = f.geometry.coordinates;
  const ground = ctx.heightAt(x, y);
  if (ground === null) {
    return;
  }
  const s = MARKER_SHAPE[kind];
  // Sunk a little, so a marker on a slope never shows its underside.
  (kind === "stone" ? parts.slabs : parts.pillars).push({
    at: worldAt([x, y], ground - 0.15, ctx),
    scale: new Vector3(s.width, s.height + 0.15, s.depth),
    yaw: yawOf(x, y),
  });
}

function instanced(
  geo: BufferGeometry,
  material: Material,
  places: Placed[],
  shadows: boolean
): InstancedMesh {
  const mesh = new InstancedMesh(geo, material, places.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < places.length; i++) {
    q.setFromAxisAngle(up, places[i].yaw);
    mesh.setMatrixAt(i, m.compose(places[i].at, q, places[i].scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Spread-out cloud: recompute the sphere or it culls when the origin is off-screen.
  mesh.computeBoundingSphere();
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

function merged(
  geos: BufferGeometry[],
  material: Material,
  cast: boolean
): Mesh | null {
  if (geos.length === 0) {
    return null;
  }
  const geo = mergeGeometries(geos);
  for (const g of geos) {
    g.dispose();
  }
  if (!geo) {
    return null;
  }
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

function materials(
  heightFog: HeightFogUniforms | undefined,
  alpha: CanvasTexture
) {
  const clay = new MeshStandardMaterial({
    color: CLAY_COLOR,
    roughness: 0.95,
    metalness: 0,
  });
  const water = new MeshStandardMaterial({
    color: WATER_COLOR,
    emissive: WATER_GLOW,
    roughness: 0.12,
    metalness: 0,
  });
  const spray = new MeshBasicMaterial({
    color: SPRAY_COLOR,
    alphaMap: alpha,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: DoubleSide,
  });
  const all = { clay, water, spray };
  if (heightFog) {
    for (const m of Object.values(all)) {
      m.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
    }
  }
  return all;
}

/** One tile's monuments: the group, and the jets' alpha texture to free. */
export interface MonumentLayer {
  /** frees the shared alpha texture; the meshes are freed with the scene */
  dispose: () => void;
  group: Group;
}

/**
 * Builds one tile's monuments (the features its bake owns) into one group;
 * the meshes, their geometries and materials are freed with the scene.
 */
export function buildMonuments(
  features: MonumentFeature[],
  ctx: MonumentContext
): MonumentLayer {
  const group = new Group();
  group.name = "monuments";
  const parts: Parts = {
    jets: [],
    pillars: [],
    reliefs: [],
    rims: [],
    slabs: [],
    waters: [],
  };
  for (const f of features) {
    if (f.properties?.kind === "fountain") {
      addFountain(f, ctx, parts);
    } else {
      addMonument(f, ctx, parts);
    }
  }
  const alpha = bellAlpha();
  const mat = materials(ctx.heightFog, alpha);
  const meshes = [
    merged(parts.rims, mat.clay, true),
    merged(parts.reliefs, mat.clay, true),
    merged(parts.waters, mat.water, false),
    parts.pillars.length > 0
      ? instanced(unitPillar(), mat.clay, parts.pillars, true)
      : null,
    parts.slabs.length > 0
      ? instanced(unitSlab(), mat.clay, parts.slabs, true)
      : null,
    parts.jets.length > 0
      ? instanced(unitBell(), mat.spray, parts.jets, false)
      : null,
  ];
  for (const mesh of meshes) {
    if (mesh) {
      group.add(mesh);
    }
  }
  // Unused materials are never compiled; free them now rather than leak.
  const used = new Set(
    group.children.map((c) => (c as Mesh).material as Material)
  );
  for (const m of Object.values(mat)) {
    if (!used.has(m)) {
      m.dispose();
    }
  }
  return { group, dispose: () => alpha.dispose() };
}
