import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FountainStyle, MonumentFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import {
  basinLevels,
  fountainFigure,
  insideRing,
  jetHeight,
  jetPlaces,
  MONUMENT_SHAPE,
  openRing,
  POINT_BASIN_R,
  ringArea,
  ringCentre,
  yawOf,
} from "@/lib/city/monuments";
import type { Point2 } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * Fountains, statues, memorial stones and columns
 * (`pipeline/bake/monuments.py`: the Basis-DLM's monuments with their
 * official names, OSM's fountain basins). The DLM gives a monument's place,
 * never its shape, so every statue is the same stylised figure on a plinth
 * (lib/city/monuments.ts); a fountain is its basin outline raised into a
 * sandstone rim with water in it, jets, and — when a DLM monument stands
 * in it — a figure. Built per fine terrain tile by the dressing plugin
 * (tile-stream.ts), in the Y-up frame; boxes, cylinders, figures and jets
 * are instanced, rims and water merged, so a tile is six draw calls.
 * Non-fatal: missing/empty inputs yield an empty group.
 */

export interface MonumentContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

const STONE_COLOR = 0xd6_cb_b4; // pale sandstone, a shade lighter than the walls
const BRONZE_COLOR = 0x6f_8c_84; // weathered, patinated bronze
const WATER_COLOR = 0x86_a8_c4; // the river's dusty blue (water-layer.ts)
const SPRAY_COLOR = 0xf2_f7_fa;
const SPRAY_OPACITY = 0.55;
const RIM_M = 0.35; // a point fountain's rim width (the bake insets outlines by the same)

/** One instance: where, how big, which way. */
interface Placed {
  at: Vector3;
  scale: Vector3;
  yaw: number;
}

/** Everything one tile's monuments add up to, before it becomes meshes. */
interface Parts {
  boxes: Placed[];
  columns: Placed[];
  figures: Placed[];
  jets: Placed[];
  rims: BufferGeometry[];
  waters: BufferGeometry[];
}

/** A unit box / cylinder standing on the origin (scaled per instance). */
function unitBox(): BufferGeometry {
  return new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}

function unitColumn(): BufferGeometry {
  const shaft = new CylinderGeometry(0.42, 0.5, 0.94, 10).translate(0, 0.47, 0);
  const cap = new BoxGeometry(1.1, 0.06, 1.1).translate(0, 0.97, 0);
  return mergeGeometries([shaft.toNonIndexed(), cap.toNonIndexed()]) ?? shaft;
}

/** A figure 1 m tall: a tapered body and a head — read as "someone" from any side. */
function unitFigure(): BufferGeometry {
  const body = new CylinderGeometry(0.11, 0.17, 0.78, 10).translate(0, 0.39, 0);
  const head = new SphereGeometry(0.1, 12, 8).translate(0, 0.89, 0);
  return mergeGeometries([body.toNonIndexed(), head.toNonIndexed()]) ?? body;
}

/** A jet 1 m tall: a slender open column spreading into a crown at the top. */
function unitJet(): BufferGeometry {
  const column = new CylinderGeometry(0.025, 0.06, 0.9, 8, 1, true).translate(
    0,
    0.45,
    0
  );
  const crown = new CylinderGeometry(0.11, 0.03, 0.3, 12, 1, true).translate(
    0,
    0.85,
    0
  );
  return (
    mergeGeometries([column.toNonIndexed(), crown.toNonIndexed()]) ?? column
  );
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

/** The rim and the water of one basin, as shapes on the ground plane. */
function basinShapes(
  b: Basin,
  ctx: GroundContext
): { pad: Shape; rim: Shape; water: Shape } {
  if (!b.outer) {
    const w = epsgToWorld(b.centre[0], b.centre[1], ctx.offset);
    const rim = new Shape().absarc(w.x, -w.z, POINT_BASIN_R, 0, Math.PI * 2);
    rim.holes.push(circle(POINT_BASIN_R - RIM_M, w.x, -w.z));
    const water = new Shape().absarc(
      w.x,
      -w.z,
      POINT_BASIN_R - RIM_M,
      0,
      Math.PI * 2
    );
    const pad = new Shape().absarc(w.x, -w.z, POINT_BASIN_R, 0, Math.PI * 2);
    return { pad, rim, water };
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
  const figure = f.properties?.figure === true;
  const onWater = basin.water ?? basin.outer;
  if (figure && (!onWater || insideRing(basin.centre, onWater))) {
    const p = fountainFigure(basin.area);
    const yaw = yawOf(basin.centre[0], basin.centre[1]);
    parts.boxes.push({
      at: worldAt(basin.centre, levels.base, ctx),
      scale: new Vector3(
        p.width,
        levels.water - levels.base + p.height,
        p.width
      ),
      yaw,
    });
    parts.figures.push({
      at: worldAt(basin.centre, levels.water + p.height, ctx),
      scale: new Vector3(p.figure, p.figure, p.figure),
      yaw,
    });
  }
  const h = jetHeight(basin.area, style);
  if (h <= 0) {
    return;
  }
  for (const place of jetPlaces(basin.centre, basin.area, figure, onWater)) {
    parts.jets.push({
      at: worldAt(place, levels.water, ctx),
      scale: new Vector3(h, h, h),
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
  const [x, y] = f.geometry.coordinates;
  const ground = ctx.heightAt(x, y);
  if (ground === null) {
    return;
  }
  const s = MONUMENT_SHAPE[kind];
  const yaw = yawOf(x, y);
  // Sunk a little, so a plinth on a slope never shows its underside.
  const base = worldAt([x, y], ground - 0.2, ctx);
  const place = {
    at: base,
    scale: new Vector3(s.width, s.height + 0.2, s.depth),
    yaw,
  };
  (kind === "column" ? parts.columns : parts.boxes).push(place);
  if (s.figure > 0) {
    parts.figures.push({
      at: worldAt([x, y], ground + s.height, ctx),
      scale: new Vector3(s.figure, s.figure, s.figure),
      yaw,
    });
  }
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

function materials(heightFog: HeightFogUniforms | undefined) {
  const stone = new MeshStandardMaterial({
    color: STONE_COLOR,
    roughness: 0.92,
    metalness: 0,
  });
  const bronze = new MeshStandardMaterial({
    color: BRONZE_COLOR,
    roughness: 0.55,
    metalness: 0.35,
  });
  const water = new MeshStandardMaterial({
    color: WATER_COLOR,
    roughness: 0.12,
    metalness: 0.1,
  });
  const spray = new MeshBasicMaterial({
    color: SPRAY_COLOR,
    transparent: true,
    opacity: SPRAY_OPACITY,
    depthWrite: false,
    side: DoubleSide,
  });
  const all = { stone, bronze, water, spray };
  if (heightFog) {
    for (const m of Object.values(all)) {
      m.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
    }
  }
  return all;
}

/**
 * Builds one tile's monuments (the features its bake owns) into one group;
 * the meshes, their geometries and materials are freed with the scene.
 */
export function buildMonuments(
  features: MonumentFeature[],
  ctx: MonumentContext
): Group {
  const group = new Group();
  group.name = "monuments";
  const parts: Parts = {
    boxes: [],
    columns: [],
    figures: [],
    jets: [],
    rims: [],
    waters: [],
  };
  for (const f of features) {
    if (f.properties?.kind === "fountain") {
      addFountain(f, ctx, parts);
    } else {
      addMonument(f, ctx, parts);
    }
  }
  const mat = materials(ctx.heightFog);
  const meshes = [
    merged(parts.rims, mat.stone, true),
    merged(parts.waters, mat.water, false),
    parts.boxes.length > 0
      ? instanced(unitBox(), mat.stone, parts.boxes, true)
      : null,
    parts.columns.length > 0
      ? instanced(unitColumn(), mat.stone, parts.columns, true)
      : null,
    parts.figures.length > 0
      ? instanced(unitFigure(), mat.bronze, parts.figures, true)
      : null,
    parts.jets.length > 0
      ? instanced(unitJet(), mat.spray, parts.jets, false)
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
  return group;
}
