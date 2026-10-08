import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  attribute,
  dot,
  float,
  Fn,
  fract,
  materialColor,
  materialEmissive,
  materialOpacity,
  mix,
  normalize,
  normalView,
  normalWorldGeometry,
  positionLocal,
  positionViewDirection,
  positionWorld,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type {
  FountainStyle,
  MonumentFeature,
  MonumentKind,
  ReliefGrid,
} from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import {
  basinLevels,
  FINISH,
  type Finish,
  figureShare,
  jetHeight,
  jetPlaces,
  type MarkerPiece,
  type MarkerTones,
  type MeasuredMarker,
  markerTones,
  measuredMarker,
  partFinish,
  pedestalCourses,
  type MarkerSolid,
  markerPieces,
  openRing,
  POINT_BASIN_R,
  reliefSurface,
  ringArea,
  ringCentre,
  yawOf,
} from "@/lib/city/monuments";
import type { Point2 } from "@/lib/city/polyline";
import { ashlar, footprint } from "./bridge-surface";
import { gdNoise } from "./ground-detail";
import { Instances, instanceFloat, instancePosition } from "./instancing";
import type { F, Live } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * Fountains, statues, memorial stones and columns
 * (`pipeline/bake/monuments.py`: the Basis-DLM's monuments with their
 * official names, OSM's fountain basins, and the sculptures' bulk measured
 * in DOM1 − DGM1). Nothing here invents a shape the data does not carry:
 *
 * - a measured monument is a few clean solids in the same pale clay as
 *   the buildings, at its measured footprint, axis and height: a pedestal
 *   with the figure on it (lib/city/monuments.ts `measuredMarker`) —
 *   smoothed, its 1 m relief read as a heap;
 * - a fountain's measured sculpture is its relief, smoothed into one soft
 *   form (`reliefSurface`; in DOM1 it is the winter housing);
 * - a monument nothing measured is an abstract marker in that clay, built
 *   of the parts its form has where OSM names it (a pedestal under a
 *   statue, a needle on an obelisk's base — `markerPieces`), never a figure;
 * - a basin is its OSM outline as a low clay rim around water, and a jet
 *   a translucent water bell rising from it.
 *
 * The fountains move, gently: every bell breathes on its own phase and
 * droplets run down its curtain, light shimmers across the water; by
 * night the water glows and a fountain's sculpture is lit from its basin
 * (one shared clock and night factor, `setFountainTime`/`setFountainNight`).
 *
 * Built per fine terrain tile by the dressing plugin (tile-stream.ts), in
 * the Y-up frame; rims, water and reliefs are merged, markers and jets
 * instanced: eight draw calls per tile at most. Its four materials carry
 * nothing of a tile (the clock and the night are module uniforms), so every
 * tile wears the same ones (`sceneMaterial`). Non-fatal: missing/empty
 * inputs yield an empty group.
 */

/** The buildings' clay (visual-style.ts): one material language for all that is built. */
const CLAY_COLOR = 0xec_e7_df;
const WATER_COLOR = 0x9c_bc_d0; // a lighter cousin of the river's dusty blue
const WATER_GLOW = 0x12_1c_22; // lifts the water out of the rim's shade
const SPRAY_COLOR = 0xf4_f8_fb;
const RIM_M = 0.35; // a point fountain's rim width (the bake insets outlines by the same)

/** One instance: where, how big, which way, in which tone (sRGB; null: clay). */
interface Placed {
  at: Vector3;
  /** how its surface is finished (lib/city/monuments.ts `FINISH`) */
  finish: Finish;
  scale: Vector3;
  tone: number | null;
  yaw: number;
}

/** Everything one tile's monuments add up to, before it becomes meshes. */
interface Parts {
  jets: Placed[];
  /** the markers' clay solids, by solid */
  markers: Record<MarkerSolid, Placed[]>;
  reliefs: BufferGeometry[];
  /** a fountain's sculptures: lit from the basin by night */
  sculptures: BufferGeometry[];
  rims: BufferGeometry[];
  waters: BufferGeometry[];
}

/** A pillar 1 m wide and 1 m tall, standing on the origin (scaled per instance). */
function unitPillar(): BufferGeometry {
  // radius 0.5 + length 0 → a sphere; stretched per instance into a pillar.
  return new CapsuleGeometry(0.5, 1, 6, 16)
    .scale(1, 0.5, 1)
    .translate(0, 0.5, 0);
}

/** A block 1 m on each side with crisp edges, as a stone is cut: rounded,
 *  scaled to a pedestal's size, it read as a moulded cushion. */
function unitBlock(): BufferGeometry {
  return new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
}

/** An obelisk's needle 1 m wide at its foot and 1 m tall: a four-sided
 *  shaft tapering to 0.6, its last tenth the pyramidion. */
function unitNeedle(): BufferGeometry {
  const r = Math.SQRT1_2; // the circumradius of a 1 m square
  const shaft = new CylinderGeometry(0.62 * r, r, 0.9, 4, 1, true)
    .rotateY(Math.PI / 4)
    .translate(0, 0.45, 0);
  const tip = new ConeGeometry(0.62 * r, 0.1, 4, 1, true)
    .rotateY(Math.PI / 4)
    .translate(0, 0.95, 0);
  const geo = mergeGeometries([shaft, tip]);
  shaft.dispose();
  tip.dispose();
  return geo;
}

/** WebGPU draws from eight vertex buffers: an instance's matrix takes
 *  four, its tint one — the clay reads no uv, so a solid carries none. */
function withoutUv(make: () => BufferGeometry): () => BufferGeometry {
  return () => make().deleteAttribute("uv");
}

const UNIT_SOLID: Record<MarkerSolid, () => BufferGeometry> = {
  block: withoutUv(unitBlock),
  needle: withoutUv(unitNeedle),
  pillar: withoutUv(unitPillar),
};

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

/**
 * The bell's alpha along its profile, from the lathe's v (0 at the nozzle,
 * 1 at the curtain's hem): a faint jet (90/255) that thickens to 200/255
 * where it opens and falls, then thins back and dissolves to nothing at
 * the hem — the stops of the 4×64 canvas gradient it once was (drawn from
 * canvas bottom, stop 0, to top, stop 1; the upload's flipY put the top at
 * v = 1, so stop 0 is v = 0), interpolated linearly as the canvas did.
 */
function bellAlpha(v: F): F {
  const a = float(90 / 255);
  const b = float(200 / 255);
  return select(
    v.lessThan(0.4),
    mix(a, b, v.div(0.4)),
    select(
      v.lessThan(0.6),
      mix(b, a, v.sub(0.4).div(0.2)),
      mix(a, float(0), v.sub(0.6).div(0.4).clamp(0, 1))
    )
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
  tones: MarkerTones,
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
  geo.setAttribute("aTint", reliefTint(s.heights, tones));
  // The plane's +y (north) became −z: its winding now faces up.
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/** A tone (sRGB hex, null: the clay) as linear RGB. */
function linear(tone: number | null): Color {
  return new Color(tone ?? CLAY_COLOR);
}

/**
 * Each relief vertex's colour (linear RGB): the figure's tone above the
 * pedestal, the pedestal's below it (`figureShare`; a relief too low for
 * a pedestal is all figure), the clay where nothing names a material.
 */
function reliefTint(
  heights: Float32Array,
  tones: MarkerTones
): BufferAttribute {
  const figure = linear(tones.figure);
  const base = linear(tones.base);
  const top = heights.reduce((a, b) => Math.max(a, b), 0);
  const tint = new Float32Array(heights.length * 3);
  const c = new Color();
  for (let i = 0; i < heights.length; i++) {
    c.copy(base).lerp(figure, figureShare(heights[i], top));
    tint.set([c.r, c.g, c.b], i * 3);
  }
  return new BufferAttribute(tint, 3);
}

/** Each vertex's height above the basin's water (the uplight's falloff). */
function withLift(geo: BufferGeometry, water: number): BufferGeometry {
  const pos = geo.getAttribute("position");
  const lift = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    lift[i] = Math.max(pos.getY(i) - water, 0);
  }
  geo.setAttribute("aLift", new BufferAttribute(lift, 1));
  return geo;
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
    const geo = reliefMesh(
      relief,
      ctx,
      markerTones(f.properties?.material),
      levels.water - 0.3
    );
    if (geo) {
      parts.sculptures.push(withLift(geo, levels.water));
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
      finish: FINISH.clay,
      tone: null,
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
  const marker = markerOf(f.properties, kind, f.geometry.coordinates);
  const ground = ctx.heightAt(marker.centre[0], marker.centre[1]);
  if (ground === null) {
    return;
  }
  const tones = markerTones(f.properties?.material);
  const ux = Math.cos(marker.yaw);
  const uy = Math.sin(marker.yaw);
  const material = f.properties?.material;
  for (const piece of marker.pieces) {
    const px = marker.centre[0] + piece.along * ux;
    const py = marker.centre[1] + piece.along * uy;
    // the foot of a marker of two pieces or more is its pedestal, built
    // in courses as masonry is
    const pedestal =
      marker.pieces.length > 1 && piece.lift === 0 && piece.solid === "block";
    for (const p of pedestal ? pedestalCourses(piece) : [piece]) {
      // A foot on the ground reaches below the lowest ground under its
      // corners, so a pedestal on a slope never shows its underside; a
      // piece on a pedestal sits into it.
      const sink =
        p.lift > 0 ? 0.1 : 0.15 + ground - footGround(p, px, py, ux, uy, ctx);
      parts.markers[p.solid].push({
        at: worldAt([px, py], ground + p.lift - sink, ctx),
        finish: partFinish(material, pedestal),
        scale: new Vector3(p.width, p.height + sink, p.depth),
        tone: pedestal ? tones.base : tones.figure,
        yaw: marker.yaw,
      });
    }
  }
}

/** A monument's solids: its measured relief composed, else the marker of
 *  its form or kind at its point, turned by a stable hash. */
function markerOf(
  props: MonumentFeature["properties"],
  kind: Exclude<MonumentKind, "fountain">,
  [x, y]: Point2
): MeasuredMarker {
  const measured = props?.relief
    ? measuredMarker(props.relief, kind, props.form)
    : null;
  return (
    measured ?? {
      centre: [x, y],
      yaw: yawOf(x, y),
      pieces: markerPieces(kind, props?.form, props?.height).map((p) => ({
        ...p,
        along: 0,
      })),
    }
  );
}

/** The lowest ground under a piece's four corners (m, world Y). */
function footGround(
  p: MarkerPiece,
  x: number,
  y: number,
  ux: number,
  uy: number,
  ctx: GroundContext
): number {
  let low = Number.POSITIVE_INFINITY;
  for (const [a, b] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    const da = (a * p.width) / 2;
    const db = (b * p.depth) / 2;
    const h = ctx.heightAt(x + da * ux - db * uy, y + da * uy + db * ux);
    if (h !== null) {
      low = Math.min(low, h);
    }
  }
  return Number.isFinite(low) ? low : (ctx.heightAt(x, y) ?? 0);
}

function instanced(
  geo: BufferGeometry,
  material: Material,
  places: Placed[],
  shadows: boolean
): Instances {
  const mesh = new Instances(geo, material, places.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const tinted = places.some((p) => p.tone !== null);
  for (let i = 0; i < places.length; i++) {
    q.setFromAxisAngle(up, places[i].yaw);
    mesh.setMatrixAt(i, m.compose(places[i].at, q, places[i].scale));
    if (tinted) {
      mesh.setColorAt(i, linear(places[i].tone));
    }
  }
  if (places.some((p) => p.finish !== FINISH.clay)) {
    mesh.geometry.setAttribute(
      "iFinish",
      new InstancedBufferAttribute(
        Float32Array.from(places, (p) => p.finish),
        1
      )
    );
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

/**
 * The one clock and night factor every tile's fountains share (uniform
 * nodes every material reads): `create-app.ts` advances them each frame
 * and at dusk, tiles that stream in later pick them up as they are.
 */
const fountainTime: Live = uniform(0);
const fountainNight: Live = uniform(0);

/** The frame clock (s) the jets and the water shimmer run on. */
export function setFountainTime(elapsed: number): void {
  fountainTime.value = elapsed;
}

/** 0 by day → 1 at night: the basins light up softly with the lamps. */
export function setFountainNight(t: number): void {
  fountainNight.value = Math.min(Math.max(t, 0), 1);
}

/** A jet's own phase (0..2π), hashed from its instance's position (the
 *  matrix's translation column, world x and z), 0 off an instanced set. */
const jetPhase = Fn((builder) => {
  if (!builder.geometry.hasAttribute("iMat3")) {
    return float(0);
  }
  const at = attribute("iMat3", "vec4");
  return fract(
    sin(dot(vec2(at.x, at.z), vec2(12.9898, 78.233))).mul(43758.5453)
  ).mul(6.2831);
});

/**
 * The jets: each bell breathes (its height swells and settles on its own
 * phase, from its position — the local y scaled before the instance
 * transform) and droplets run down the curtain as soft streaks in its
 * alpha (a swirl round the lathe's u, streaks down its v). By night the
 * water catches the light: the spray tints toward a warm white.
 */
function sprayMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({
    color: SPRAY_COLOR,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: DoubleSide,
  });
  const phase = jetPhase() as F;
  const breath = float(1)
    .add(sin(fountainTime.mul(1.1).add(phase)).mul(0.07))
    .add(sin(fountainTime.mul(2.7).add(phase.mul(1.7))).mul(0.03));
  m.positionNode = instancePosition(
    vec3(positionLocal.x, positionLocal.y.mul(breath), positionLocal.z)
  );
  const vPhase = varying(phase, "vJetPhase");
  const bell = uv();
  const swirl = sin(bell.x.mul(43.98).add(vPhase)).mul(1.5);
  const streaks = float(0.72).add(
    sin(bell.y.mul(38).sub(fountainTime.mul(5)).add(swirl)).mul(0.28)
  );
  m.opacityNode = materialOpacity.mul(bellAlpha(bell.y)).mul(streaks);
  m.colorNode = vec4(
    mix(materialColor.rgb, vec3(1, 0.93, 0.8).mul(1.5), fountainNight.mul(0.5)),
    1
  );
  return m;
}

/**
 * The water: a slow shimmer of light across the surface (three crossing
 * swells in world x/z, none aligned with another, so no stripes read,
 * tilting the view-space normal and brightening the emissive), and a soft
 * glow from below once the lamps are on.
 */
function waterMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    color: WATER_COLOR,
    emissive: WATER_GLOW,
    roughness: 0.12,
    metalness: 0,
  });
  const p = positionWorld;
  const t = fountainTime;
  const ripA = sin(p.x.mul(2.3).add(p.z.mul(0.7)).add(t.mul(1.6)))
    .add(sin(p.z.mul(2.9).sub(p.x.mul(1.1)).sub(t.mul(1.3))))
    .add(sin(p.x.add(p.z).mul(4.1).add(t.mul(2.3))))
    .div(3);
  const ripB = sin(p.x.mul(3.7).sub(p.z.mul(1.9)).add(t.mul(2.1)));
  m.normalNode = normalize(
    normalView.add(vec3(ripA.mul(0.06), ripB.mul(0.06), 0))
  );
  m.emissiveNode = materialEmissive
    .add(vec3(0.03, 0.04, 0.045).mul(ripA.mul(0.5).add(0.5)))
    .add(vec3(0.12, 0.17, 0.2).mul(fountainNight).mul(ripA.mul(0.2).add(0.8)));
  return m;
}

/**
 * A clay part's colour: an instance's (`iColor`) or a vertex's (`aTint`,
 * the reliefs) where its material is named, else the clay. One material
 * for all three: the build is keyed by the attribute layout anyway.
 */
const clayTint = Fn((builder) => {
  if (builder.geometry.hasAttribute("iColor")) {
    return attribute("iColor", "vec3");
  }
  if (builder.geometry.hasAttribute("aTint")) {
    return attribute("aTint", "vec3");
  }
  return vec3(materialColor);
});

/** The buildings' matte clay, for rims, reliefs and markers (instanced or
 *  merged: `instancePosition` is the plain vertex off a set), tinted by
 *  what a monument is made of (`clayTint`). */
function clayMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    color: CLAY_COLOR,
    roughness: 0.95,
    metalness: 0,
  });
  m.positionNode = instancePosition();
  const f = finishOf();
  m.colorNode = mix(
    clayTint().mul(finishGrain(f)),
    VERDIGRIS,
    f.patina.mul(verdigrisSpots())
  );
  m.roughnessNode = float(0.95)
    .sub(f.worked.mul(0.07))
    .sub(f.patina.mul(0.4))
    .sub(f.gilded.mul(0.62));
  // No environment map lights the scene: a metal's sheen is the sky it
  // catches at a grazing angle, warm on gilding, faint on a patina.
  const grazing = float(1)
    .sub(dot(normalView, positionViewDirection).abs().clamp(0, 1))
    .pow(3);
  m.emissiveNode = materialEmissive.add(
    vec3(0.95, 0.75, 0.38)
      .mul(f.gilded)
      .mul(grazing.mul(0.4).add(0.04))
      .add(vec3(0.5, 0.58, 0.55).mul(f.patina).mul(grazing.mul(0.12)))
  );
  return m;
}

/** Bronze and copper's verdigris, where the patina gathers (linear RGB). */
const VERDIGRIS = vec3(0.36, 0.5, 0.42);

interface FinishMasks {
  dressed: F;
  gilded: F;
  patina: F;
  worked: F;
}

/** The part's finish as one 0/1 mask each (0 everywhere off an instance
 *  set with finishes: rims, fountain sculptures, plain markers). */
function finishOf(): FinishMasks {
  const f = instanceFloat("iFinish");
  const is = (k: number): F => step(k - 0.5, f).mul(step(f, k + 0.5));
  return {
    dressed: is(FINISH.dressed),
    worked: is(FINISH.worked),
    patina: is(FINISH.patina),
    gilded: is(FINISH.gilded),
  };
}

/**
 * The surface's grain, a factor on the tint: a pedestal is ashlar (the
 * bridges' courses, joints and block shades — bridge-surface.ts
 * `ashlar`), a stone figure a fine tooled mottle, a metal figure the
 * streaks rain draws down a patina, gilding a faint unevenness. Branch-
 * free: every finish is computed and masked.
 */
function finishGrain(f: FinishMasks): F {
  const p = positionWorld;
  const stone = ashlar(p, normalWorldGeometry, footprint());
  const tooled = float(1)
    .add(
      gdNoise(p.xz.mul(1.7).add(p.y.mul(0.9)))
        .sub(0.5)
        .mul(0.12)
    )
    .add(
      gdNoise(p.xz.mul(9).add(p.y.mul(7)))
        .sub(0.5)
        .mul(0.06)
    );
  const streaks = float(1).add(
    gdNoise(vec2(p.x.add(p.z.mul(0.7)).mul(3.1), p.y.mul(0.35)))
      .sub(0.5)
      .mul(0.3)
  );
  const leaf = float(1).add(
    gdNoise(p.xz.mul(4).add(p.y.mul(3)))
      .sub(0.5)
      .mul(0.08)
  );
  return float(1)
    .add(f.dressed.mul(stone.sub(1)))
    .add(f.worked.mul(tooled.sub(1)))
    .add(f.patina.mul(streaks.sub(1)))
    .add(f.gilded.mul(leaf.sub(1)));
}

/** Where verdigris gathers on a patina: soft spots and runs, 0–0.45. */
function verdigrisSpots(): F {
  const p = positionWorld;
  return smoothstep(
    0.5,
    0.85,
    gdNoise(vec2(p.x.add(p.z).mul(1.3), p.y.mul(0.8)))
  ).mul(0.45);
}

/**
 * A fountain's sculpture, lit from its basin by night: warm at the water,
 * fading up the form (a real fountain's floodlights, abstracted) — the
 * uplight is strongest where it rises from the water and gone 2.5 m above
 * it (`aLift`, each vertex's height over the basin's water).
 */
function litClayMaterial(): MeshStandardNodeMaterial {
  const m = clayMaterial();
  const lift = attribute("aLift", "float");
  m.emissiveNode = materialEmissive.add(
    vec3(1, 0.82, 0.6)
      .mul(0.55)
      .mul(fountainNight)
      .mul(float(1).sub(smoothstep(0, 2.5, lift)))
  );
  return m;
}

/** The monuments' four materials, one each for the whole scene. */
const materials = {
  clay: () => sceneMaterial("monument-clay", clayMaterial),
  litClay: () => sceneMaterial("monument-lit-clay", litClayMaterial),
  water: () => sceneMaterial("monument-water", waterMaterial),
  spray: () => sceneMaterial("monument-spray", sprayMaterial),
};

/** One tile's monuments: the group (freed with the scene). */
export interface MonumentLayer {
  /** nothing of the tile's own to free: the meshes go with the scene and
   *  the materials are scene-wide */
  dispose: () => void;
  group: Group;
}

/**
 * Builds one tile's monuments (the features its bake owns) into one group;
 * the meshes, their geometries and materials are freed with the scene.
 */
export function buildMonuments(
  features: MonumentFeature[],
  ctx: GroundContext
): MonumentLayer {
  const group = new Group();
  group.name = "monuments";
  const parts: Parts = {
    jets: [],
    markers: { block: [], needle: [], pillar: [] },
    reliefs: [],
    sculptures: [],
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
  const meshes = [
    merged(parts.rims, materials.clay(), true),
    merged(parts.reliefs, materials.clay(), true),
    merged(parts.sculptures, materials.litClay(), true),
    merged(parts.waters, materials.water(), false),
    ...(Object.keys(UNIT_SOLID) as MarkerSolid[]).map((solid) =>
      parts.markers[solid].length > 0
        ? instanced(
            UNIT_SOLID[solid](),
            materials.clay(),
            parts.markers[solid],
            true
          )
        : null
    ),
    parts.jets.length > 0
      ? instanced(unitBell(), materials.spray(), parts.jets, false)
      : null,
  ];
  for (const mesh of meshes) {
    if (mesh) {
      group.add(mesh);
    }
  }
  return {
    group,
    dispose: () => {
      // the meshes go with the tile (disposeObject3D); the materials are
      // the scene's
    },
  };
}
