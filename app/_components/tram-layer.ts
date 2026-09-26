import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import {
  attribute,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  clamp,
  cross,
  float,
  length,
  materialOpacity,
  max,
  modelViewMatrix,
  modelWorldMatrixInverse,
  positionGeometry,
  select,
  smoothstep,
  varying,
  vec3,
  vec4,
  viewportSize,
} from "three/tsl";
import type {
  BridgeFeature,
  FurnitureFeature,
  TramBed,
  TramFeature,
} from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { LANDCOVER_CLASSES, MEADOW_CLASS } from "@/lib/city/landcover";
import type { Point2 } from "@/lib/city/polyline";
import { subdividePolyline } from "@/lib/city/polyline";
import {
  CONTACT_WIRE_M,
  MAST_HEIGHT_M,
  RAIL_TOP_M,
  RAIL_TOP_ON_DECK_M,
  SPAN_ANCHOR_M,
  spanHeight,
  spanLift,
  TRAM_GAUGE,
  wireDrop,
  wireStations,
} from "@/lib/city/tram";
import { buildFurniture } from "./furniture-layer";
import { Instances, instancePosition } from "./instancing";
import {
  addRail,
  addRibbon,
  buildDeckTable,
  COLORS,
  type DeckPoly,
  deckLift,
  type Mesh3,
  meshFrom,
  mesh3,
  type Pt,
} from "./rail-layer";
import type { F, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * Trams (pipeline/bake/tram.py, OSM, ODbL): the tracks in their bed and the
 * overhead line above them.
 *
 * - Tracks: two rails per track at Dresden's 1 450 mm gauge, reusing the
 *   rail layer's profile, in a soft lavender-grey a shade under the road's.
 *   In the street the rail heads flush with the road (no sleepers, no
 *   groove: fewer, calmer lines); on a lawn (*Rasengleis*) the rails a hand
 *   higher over a meadow strip; on ballast a ballast strip.
 *   A track the OSM way puts on a bridge rides the deck (the rail layer's
 *   lift table, every deck kind).
 * - Overhead line: one contact wire per track 5.6 m over the rail top,
 *   sagging between the supports the bake found (`s`); span wires between
 *   masts or facade rosettes with a hanger down to each wire they cross;
 *   cantilever arms with a stay. All wires are camera-facing ribbons whose
 *   width never drops below a pixel floor, their alpha carrying the true
 *   coverage, faded out with distance — thin lines that would otherwise
 *   break into crawling dashes. Light and faint on purpose: a soft slate at
 *   under two-thirds opacity, like a pencil line on the watercolour, not
 *   ink. Wires never cast (the shadow map stays as it was); only the masts
 *   do.
 * - Masts: a pale green-grey pole each, instanced (`Instances`).
 * - Stops: the bus stop's "H" sign (furniture-layer.ts, plan 030) on the
 *   platform of each tram stop the bake found one for.
 *
 * Built per fine terrain tile in the Y-up frame on the cross-tile ground
 * (tracks and spans reach past the tile edge); freed with the tile.
 */

const SAMPLE_M = 2; // rails follow the TIN closely
const WIRE_SAMPLE_M = 4;
const RAIL_HALF = 0.075; // rail-layer's drawn rail
/** a street rail shows only the 2 cm it stands out of the road */
const STREET_RAIL_WEB = 0.04;
const BED_HALF: Record<TramBed, number> = {
  street: 0,
  grass: 1.3,
  ballast: 1.4,
};
const BED_WEB: Record<TramBed, number> = {
  street: 0,
  grass: 0.2,
  ballast: 0.3,
};
/** bed strip top under the rail top (m) */
const BED_BELOW_RAIL = 0.1;
/** half-widths (m) of the drawn wires */
const WIRE_HALF = { contact: 0.006, span: 0.005, hanger: 0.004, arm: 0.03 };
/** the pixel floor of a wire's drawn width, and its fade with distance (m) */
const WIRE_MIN_PX = 0.8;
const WIRE_FADE = { near: 150, far: 350 };
/** the wires' ink and its opacity at full coverage: light and faint */
const WIRE_COLOR = 0x80_85_90;
const WIRE_OPACITY = 0.6;
const MAST_COLOR = 0xb7_bc_b4; // pale green-grey
/** rail heads: the road's lavender-grey (200, 200, 206), a shade deeper */
const TRAM_RAIL = 0xa9_aa_b4;
/** the lawn under a *Rasengleis*: the ground's own meadow colour */
const MEADOW = (() => {
  const [r, g, b] = LANDCOVER_CLASSES.find((k) => k.id === MEADOW_CLASS)
    ?.srgb ?? [197, 211, 170];
  return (r << 16) | (g << 8) | b;
})();

// --- the wire ribbons ---------------------------------------------------------

/** Wire segments as camera-facing ribbons: each vertex is a centre point,
 *  the segment's direction, the side (±1) and the half-width. */
interface Wires {
  dir: number[];
  half: number[];
  index: number[];
  pos: number[];
  side: number[];
}

function wires(): Wires {
  return { pos: [], dir: [], side: [], half: [], index: [] };
}

function addWire(w: Wires, pts: Pt[], half: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (dx === 0 && dy === 0 && dz === 0) {
      continue;
    }
    const base = w.pos.length / 3;
    for (const p of [a, b]) {
      for (const s of [-1, 1]) {
        w.pos.push(p.x, p.y, p.z);
        w.dir.push(dx, dy, dz);
        w.side.push(s);
        w.half.push(half);
      }
    }
    w.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

/**
 * The wire's frame at this vertex, all in view space from the vertex's
 * own centre point (`positionGeometry`, so the drawn offset never feeds
 * back into it): the direction across the wire and the view ray, the
 * depth, the metres a pixel spans there, the true and the drawn half-width
 * and the distance fade. The pixel size needs the height of the target
 * being drawn into — the post stack's scene target, at the drawing-buffer
 * size, not the canvas — which `viewportSize` reads from the render target
 * current at draw time.
 */
function wireFrame() {
  const half = attribute("wireHalf", "float") as F;
  const centre = modelViewMatrix.mul(vec4(positionGeometry, 1)).xyz as V3;
  const dirV = modelViewMatrix.mul(vec4(attribute("wireDir", "vec3"), 0))
    .xyz as V3;
  const acrossRaw = cross(dirV, centre);
  const acrossLen = length(acrossRaw);
  const across = select(
    acrossLen.greaterThan(1e-6),
    acrossRaw.div(acrossLen),
    vec3(1, 0, 0)
  ) as V3;
  const depth = max(centre.z.negate(), 0.05) as F;
  // metres per pixel at this depth; projection[1][1] is the y row of the
  // projection's second column
  const focalY = cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y;
  const px = depth.mul(2).div(focalY.mul(viewportSize.y)) as F;
  const truePx = half.mul(2).div(px);
  const drawnHalf = max(half, px.mul(0.5 * WIRE_MIN_PX)) as F;
  const fade = smoothstep(WIRE_FADE.near, WIRE_FADE.far, depth);
  return { across, centre, drawnHalf, fade, truePx };
}

/**
 * The unlit wire ink, fogged like everything else (the scene's fog node).
 * The vertex is pushed across the wire and the view ray by its drawn
 * half-width — never under half the pixel floor — in view space, and handed
 * back to the position slot in the mesh's local frame (the camera's world
 * matrix, then the model's inverse), so the regular projection lands it
 * exactly where the view-space ribbon puts it. The alpha carries the true
 * coverage (true width over the floor, at least a fifth) times the
 * distance fade, at the ink's own faint opacity; it is worked out per
 * vertex and interpolated, as a varying.
 */
function wireMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("tram-wire", () => {
    const m = new MeshBasicNodeMaterial({
      color: new Color(WIRE_COLOR),
      transparent: true,
      depthWrite: false,
    });
    const { across, centre, drawnHalf, fade, truePx } = wireFrame();
    const side = attribute("wireSide", "float") as F;
    const drawn = centre.add(across.mul(drawnHalf).mul(side));
    m.positionNode = modelWorldMatrixInverse
      .mul(cameraWorldMatrix)
      .mul(vec4(drawn, 1)).xyz;
    const alpha = float(WIRE_OPACITY)
      .mul(clamp(truePx.div(WIRE_MIN_PX), 0.2, 1))
      .mul(float(1).sub(fade));
    m.opacityNode = materialOpacity.mul(varying(alpha));
    return m;
  });
}

function wireMesh(w: Wires): Mesh | null {
  if (w.index.length === 0) {
    return null;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(w.pos, 3));
  g.setAttribute("wireDir", new Float32BufferAttribute(w.dir, 3));
  g.setAttribute("wireSide", new Float32BufferAttribute(w.side, 1));
  g.setAttribute("wireHalf", new Float32BufferAttribute(w.half, 1));
  g.setIndex(w.index);
  g.computeBoundingSphere();
  const mesh = new Mesh(g, wireMaterial());
  mesh.name = "tram-wires";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// --- tracks -------------------------------------------------------------------

/** The rail top along one track, split where the ground has no data. */
interface TrackRun {
  /** distance (m) along the drawn line of each point */
  d: number[];
  pts: Pt[];
}

function trackRuns(
  coords: Point2[],
  bed: TramBed,
  onBridge: boolean,
  decks: DeckPoly[],
  ctx: GroundContext,
  spacing: number
): TrackRun[] {
  const runs: TrackRun[] = [];
  let run: TrackRun = { d: [], pts: [] };
  let d = 0;
  let prev: Point2 | null = null;
  for (const p of subdividePolyline(coords, spacing)) {
    if (prev) {
      d += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    }
    prev = p;
    const w = epsgToWorld(p[0], p[1], ctx.offset);
    const lift = onBridge ? deckLift(decks, w.x, w.z) : null;
    const ground = lift === null ? ctx.heightAt(p[0], p[1]) : null;
    if (lift !== null) {
      run.pts.push({ x: w.x, y: lift + RAIL_TOP_ON_DECK_M, z: w.z });
      run.d.push(d);
    } else if (ground === null) {
      if (run.pts.length >= 2) {
        runs.push(run);
      }
      run = { d: [], pts: [] };
    } else {
      run.pts.push({ x: w.x, y: ground + RAIL_TOP_M[bed], z: w.z });
      run.d.push(d);
    }
  }
  if (run.pts.length >= 2) {
    runs.push(run);
  }
  return runs;
}

interface TrackMeshes {
  ballast: Mesh3;
  grass: Mesh3;
  rail: Mesh3;
  streetRail: Mesh3;
}

function addTrack(acc: TrackMeshes, run: TrackRun, bed: TramBed): void {
  const half = TRAM_GAUGE / 2;
  if (bed === "street") {
    for (const side of [-1, 1]) {
      addRibbon(
        acc.streetRail,
        run.pts,
        side * half,
        RAIL_HALF,
        STREET_RAIL_WEB
      );
    }
    return;
  }
  addRail(acc.rail, run.pts, half);
  addRail(acc.rail, run.pts, -half);
  const strip = run.pts.map((p) => ({ ...p, y: p.y - BED_BELOW_RAIL }));
  addRibbon(
    bed === "grass" ? acc.grass : acc.ballast,
    strip,
    0,
    BED_HALF[bed],
    BED_WEB[bed]
  );
}

// --- the overhead line ----------------------------------------------------------

/** Where the contact wires are held (x, y projected; h wire height), so a
 *  hanger from a span ends exactly on its wire. */
type WirePoint = { h: number; x: number; y: number };

function addContactWire(
  w: Wires,
  held: WirePoint[],
  run: TrackRun,
  stations: number[],
  ctx: GroundContext
): void {
  const wire = run.pts.map((p, i) => ({
    x: p.x,
    y: p.y + CONTACT_WIRE_M - wireDrop(stations, run.d[i]),
    z: p.z,
  }));
  addWire(w, wire, WIRE_HALF.contact);
  for (let i = 0; i < wire.length; i++) {
    const q = wire[i];
    held.push({
      x: q.x + ctx.offset.cx,
      y: ctx.offset.cy - q.z,
      h: q.y,
    });
  }
}

/** The contact wire's height nearest a projected point (≤ 3 m away). */
function heldAt(held: WirePoint[], x: number, y: number): number | null {
  let best: number | null = null;
  let bd = 9;
  for (const p of held) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p.h;
    }
  }
  return best;
}

function worldPt(x: number, y: number, h: number, ctx: GroundContext): Pt {
  const w = epsgToWorld(x, y, ctx.offset);
  return { x: w.x, y: h, z: w.z };
}

/** A span wire between two anchors with a hanger down to every contact wire
 *  it crosses. */
function addSpan(
  w: Wires,
  f: TramFeature,
  held: WirePoint[],
  ctx: GroundContext
): void {
  if (f.geometry.type !== "LineString" || f.geometry.coordinates.length < 2) {
    return;
  }
  const [[ax, ay], [bx, by]] = f.geometry.coordinates;
  const ga = ctx.heightAt(ax, ay);
  const gb = ctx.heightAt(bx, by);
  if (ga === null || gb === null) {
    return;
  }
  const anchor =
    f.properties?.k === "rosette" ? SPAN_ANCHOR_M.rosette : SPAN_ANCHOR_M.mast;
  const crossings: { h: number; t: number }[] = [];
  for (const t of f.properties?.x ?? []) {
    const h = heldAt(held, ax + (bx - ax) * t, ay + (by - ay) * t);
    if (h !== null) {
      crossings.push({ t, h });
    }
  }
  const lift = spanLift(ga + anchor, gb + anchor, crossings);
  const ha = ga + anchor + lift;
  const hb = gb + anchor + lift;
  const n = 8;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(
      worldPt(
        ax + (bx - ax) * t,
        ay + (by - ay) * t,
        spanHeight(ha, hb, t),
        ctx
      )
    );
  }
  addWire(w, pts, WIRE_HALF.span);
  for (const { t, h } of crossings) {
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    addWire(
      w,
      [worldPt(x, y, spanHeight(ha, hb, t), ctx), worldPt(x, y, h, ctx)],
      WIRE_HALF.hanger
    );
  }
}

/** A cantilever arm from a mast out over its track, a stay from the mast
 *  head to its middle and a hanger at its end. */
function addArm(
  w: Wires,
  f: TramFeature,
  held: WirePoint[],
  ctx: GroundContext
): void {
  if (f.geometry.type !== "LineString" || f.geometry.coordinates.length < 2) {
    return;
  }
  const [[ax, ay], [bx, by]] = f.geometry.coordinates;
  const ga = ctx.heightAt(ax, ay);
  const gb = ctx.heightAt(bx, by);
  if (ga === null || gb === null) {
    return;
  }
  const wire = heldAt(held, bx, by) ?? gb + RAIL_TOP_M.street + CONTACT_WIRE_M;
  const armH = wire + 0.35;
  addWire(
    w,
    [worldPt(ax, ay, armH, ctx), worldPt(bx, by, armH, ctx)],
    WIRE_HALF.arm
  );
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  addWire(
    w,
    [
      worldPt(ax, ay, ga + MAST_HEIGHT_M - 0.2, ctx),
      worldPt(mx, my, armH, ctx),
    ],
    WIRE_HALF.arm / 2
  );
  addWire(
    w,
    [worldPt(bx, by, armH, ctx), worldPt(bx, by, wire, ctx)],
    WIRE_HALF.hanger
  );
}

function buildMasts(masts: Point2[], ctx: GroundContext): Instances | null {
  const stood: Matrix4[] = [];
  for (const [x, y] of masts) {
    const ground = ctx.heightAt(x, y);
    if (ground === null) {
      continue;
    }
    const w = epsgToWorld(x, y, ctx.offset);
    stood.push(new Matrix4().makeTranslation(w.x, ground - 0.2, w.z));
  }
  if (stood.length === 0) {
    return null;
  }
  const geo = new CylinderGeometry(0.1, 0.14, MAST_HEIGHT_M + 0.2, 8);
  geo.translate(0, (MAST_HEIGHT_M + 0.2) / 2, 0);
  const material = sceneMaterial("tram-mast", () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(MAST_COLOR),
      roughness: 0.7,
      metalness: 0.2,
    });
    m.positionNode = instancePosition();
    return m;
  });
  const mesh = new Instances(geo, material, stood.length);
  for (let i = 0; i < stood.length; i++) {
    mesh.setMatrixAt(i, stood[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "tram-masts";
  return mesh;
}

function buildTracks(
  tracks: TramFeature[],
  decks: DeckPoly[],
  ctx: GroundContext,
  w: Wires,
  held: WirePoint[]
): Mesh[] {
  const acc: TrackMeshes = {
    rail: mesh3(),
    streetRail: mesh3(),
    grass: mesh3(),
    ballast: mesh3(),
  };
  for (const f of tracks) {
    if (f.geometry.type !== "LineString") {
      continue;
    }
    const bed = f.properties?.bed ?? "street";
    const onBridge = f.properties?.bridge === 1;
    const coords = f.geometry.coordinates;
    for (const run of trackRuns(coords, bed, onBridge, decks, ctx, SAMPLE_M)) {
      addTrack(acc, run, onBridge ? "street" : bed);
    }
    let length = 0;
    for (let i = 1; i < coords.length; i++) {
      length += Math.hypot(
        coords[i][0] - coords[i - 1][0],
        coords[i][1] - coords[i - 1][1]
      );
    }
    const stations = wireStations(length, f.properties?.s ?? []);
    for (const run of trackRuns(
      coords,
      bed,
      onBridge,
      decks,
      ctx,
      WIRE_SAMPLE_M
    )) {
      addContactWire(w, held, run, stations, ctx);
    }
  }
  const parts: [Mesh3, number, number][] = [
    [acc.rail, TRAM_RAIL, -1],
    [acc.streetRail, TRAM_RAIL, -2],
    [acc.grass, MEADOW, -1],
    [acc.ballast, COLORS.ballast, -1],
  ];
  const meshes: Mesh[] = [];
  for (const [part, color, offsetUnits] of parts) {
    const m = meshFrom(part, color, {
      cast: false,
      offsetUnits,
      roughness: 0.9,
    });
    if (m) {
      m.name = "tram-track";
      meshes.push(m);
    }
  }
  return meshes;
}

/** The tram stops' signs: the furniture layer's stop model and instancing. */
function buildStops(stops: TramFeature[], ctx: GroundContext): Group | null {
  const signs: FurnitureFeature[] = stops.flatMap((f) =>
    f.geometry.type === "Point"
      ? [
          {
            geometry: f.geometry,
            properties: { k: "stop", a: f.properties?.a },
          },
        ]
      : []
  );
  if (signs.length === 0) {
    return null;
  }
  const group = buildFurniture(signs, ctx);
  group.name = "tram-stops";
  return group;
}

/** One tile's trams: tracks, masts, the overhead line and the stop signs.
 *  Empty input yields an empty group; freed with the tile
 *  (disposeObject3D). */
export function buildTram(
  features: TramFeature[],
  bridges: BridgeFeature[],
  ctx: GroundContext
): Group {
  const group = new Group();
  group.name = "tram";
  const byKind = (k: string) => features.filter((f) => f.properties?.k === k);
  const tracks = byKind("track");
  if (features.length === 0) {
    return group;
  }
  const decks = buildDeckTable(bridges, ctx.offset);
  const w = wires();
  const held: WirePoint[] = [];
  const parts: (Group | Mesh | null)[] = buildTracks(
    tracks,
    decks,
    ctx,
    w,
    held
  );
  for (const f of [...byKind("span"), ...byKind("rosette")]) {
    addSpan(w, f, held, ctx);
  }
  for (const f of byKind("arm")) {
    addArm(w, f, held, ctx);
  }
  parts.push(
    buildMasts(
      byKind("mast").flatMap((f) =>
        f.geometry.type === "Point" ? [f.geometry.coordinates] : []
      ),
      ctx
    ),
    wireMesh(w),
    buildStops(byKind("stop"), ctx)
  );
  for (const part of parts) {
    if (part) {
      group.add(part);
    }
  }
  return group;
}
