import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { RiversideFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { MAP_FADE_GLSL, MAP_OVERLAY_UNIFORMS } from "./map-overlay";
import {
  addFootprint,
  addRibbon,
  type Mesh3,
  meshFrom,
  mesh3,
  type Pt,
  quad,
  type Ring2,
  ringToWorld,
} from "./rail-layer";

/**
 * The Elbe's landing stages, groynes and ferry lines (plan 031;
 * pipeline/bake/riverside.py, OSM, ODbL).
 *
 * - Pier: a timber deck 0.3 m thick at the baked `deck` height, on piles
 *   every 4 m round its edge where it stands over the water, with a
 *   railing along the edges over the water.
 * - Pontoon: a soft slate hull and a pale deck floating 0.5 m over the drawn
 *   water — the water sheet lies on the terrain (water-layer.ts), so its
 *   level is the lowest ground under the hull (the DGM's river surface is
 *   flat), never a baked height; a ticket hut on one longer than 15 m; a
 *   gangway to the bank where no fixed pier reaches it. The paddle
 *   steamers themselves are not drawn: no dataset has them.
 * - Groyne: a low stone ridge along its line, crest 0.5 m over the ground
 *   (half under water where the river covers it).
 * - Ferry: a faint dashed wake along the route on the water — a map
 *   element, shown only from the air (map-overlay.ts), never casting.
 *
 * Built per fine terrain tile in the Y-up frame on the cross-tile ground;
 * freed with the tile.
 */

export interface RiversideContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

const PIER_DEPTH = 0.3;
const PILE_EVERY_M = 4;
const PILE_INSET = 0.35;
const RAIL_H = 1.0;
const POST_EVERY_M = 3;
const PONTOON_FREEBOARD = 0.5;
const HULL_TOP = 0.35;
const HULL_DRAFT = 0.3;
const HUT_FROM_M = 15;
const GANGWAY_HALF = 0.7;
const GROYNE_CREST = 0.5;
const GROYNE_HALF = 2.5;
const FERRY_HALF = 0.6;
const FERRY_DASH_M = 14;

const TIMBER = 0xc9_b5_9a;
const PILE = 0xb5_ac_9f;
const HULL = 0x9c_a3_ae; // a soft slate, not a dark hull
const PONTOON_DECK = 0xe4_de_d2;
const HUT = 0xec_e7_df; // the buildings' clay
const HUT_ROOF = 0xa9_b0_bb;
const GROYNE_STONE = 0xb7_b0_a4;
const RAILING = 0xbd_be_c7;
const WAKE = 0xf2_f6_f7;

interface Parts {
  deck: Mesh3;
  gangway: Mesh3;
  groyne: Mesh3;
  hull: Mesh3;
  hut: Mesh3;
  pontoonDeck: Mesh3;
  posts: Matrix4[];
  railing: Mesh3;
  piles: Matrix4[];
  roof: Mesh3;
}

function outline(f: RiversideFeature): Point2[] | null {
  if (f.geometry.type !== "Polygon") {
    return null;
  }
  const ring = f.geometry.coordinates[0];
  return ring && ring.length >= 4 ? ring : null;
}

/** A vertical column (a pile, a post) as an instance matrix of a unit
 *  cylinder or box centred on the origin. */
function column(x: number, z: number, y0: number, y1: number): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, (y0 + y1) / 2, z),
    new Quaternion(),
    new Vector3(1, Math.max(y1 - y0, 0.01), 1)
  );
}

function centroid(ring: Ring2): { x: number; z: number } {
  return { x: ring.cx, z: ring.cz };
}

function addPier(
  parts: Parts,
  coords: Point2[],
  deck: number,
  ctx: RiversideContext
): void {
  const ring = ringToWorld(coords, ctx.offset);
  addFootprint(
    parts.deck,
    ring,
    ring.pts.map(() => deck),
    PIER_DEPTH
  );
  const c = centroid(ring);
  const wet = (ex: number, ey: number) => {
    const g = ctx.heightAt(ex, ey);
    return g !== null && g < deck - 0.6 ? g : null;
  };
  for (const [ex, ey] of subdividePolyline(coords, PILE_EVERY_M).slice(0, -1)) {
    const g = wet(ex, ey);
    if (g === null) {
      continue;
    }
    const w = epsgToWorld(ex, ey, ctx.offset);
    const dx = c.x - w.x;
    const dz = c.z - w.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = Math.min(PILE_INSET / d, 0.5);
    parts.piles.push(
      column(w.x + dx * k, w.z + dz * k, g - 0.8, deck - PIER_DEPTH)
    );
  }
  // The railing runs along the edges over the water, not across the
  // landward end where the pier meets the bank.
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    if (wet((ax + bx) / 2, (ay + by) / 2) === null) {
      continue;
    }
    const pts = subdividePolyline(
      [
        [ax, ay],
        [bx, by],
      ],
      POST_EVERY_M
    ).map(([ex, ey]) => {
      const w = epsgToWorld(ex, ey, ctx.offset);
      return { x: w.x, y: deck + RAIL_H, z: w.z };
    });
    addRibbon(parts.railing, pts, 0, 0.035, 0.06);
    for (const p of pts) {
      parts.posts.push(column(p.x, p.z, deck, deck + RAIL_H));
    }
  }
}

/** The drawn water's level under a pontoon: the lowest ground the water
 *  sheet lies on there (the bank, where the hull reaches it, is higher). */
function waterLevel(coords: Point2[], ctx: RiversideContext): number | null {
  let level = Number.POSITIVE_INFINITY;
  for (const [x, y] of subdividePolyline(coords, 2)) {
    const g = ctx.heightAt(x, y);
    if (g !== null) {
      level = Math.min(level, g);
    }
  }
  return Number.isFinite(level) ? level : null;
}

/** An axis-aligned-in-its-own-frame box: centre (x, z), half sizes along
 *  the direction (ux, uz) and across it, from y0 to y1. */
function addBox(
  acc: Mesh3,
  at: { x: number; z: number },
  dir: { x: number; z: number },
  half: [number, number],
  y: [number, number]
): void {
  const [ha, hb] = half;
  const [y0, y1] = y;
  const ax = dir.x * ha;
  const az = dir.z * ha;
  const bx = -dir.z * hb;
  const bz = dir.x * hb;
  const corner = (
    sa: number,
    sb: number,
    yy: number
  ): [number, number, number] => [
    at.x + sa * ax + sb * bx,
    yy,
    at.z + sa * az + sb * bz,
  ];
  const sides: [number, number, number, number][] = [
    [1, -1, 1, 1],
    [1, 1, -1, 1],
    [-1, 1, -1, -1],
    [-1, -1, 1, -1],
  ];
  for (const [sa0, sb0, sa1, sb1] of sides) {
    const mx = (sa0 + sa1) / 2;
    const mb = (sb0 + sb1) / 2;
    const n: [number, number, number] = [
      mx * dir.x - mb * dir.z,
      0,
      mx * dir.z + mb * dir.x,
    ];
    quad(
      acc,
      corner(sa0, sb0, y0),
      corner(sa1, sb1, y0),
      corner(sa1, sb1, y1),
      corner(sa0, sb0, y1),
      n
    );
  }
  quad(
    acc,
    corner(-1, -1, y1),
    corner(1, -1, y1),
    corner(1, 1, y1),
    corner(-1, 1, y1),
    [0, 1, 0]
  );
}

/** The long axis of a ring (its two farthest vertices), as a unit vector. */
function longDir(ring: Ring2): { x: number; z: number } {
  let best = -1;
  let dir = { x: 1, z: 0 };
  for (let i = 0; i < ring.pts.length; i++) {
    for (let j = i + 1; j < ring.pts.length; j++) {
      const dx = ring.pts[j].x - ring.pts[i].x;
      const dz = ring.pts[j].z - ring.pts[i].z;
      const d = dx * dx + dz * dz;
      if (d > best) {
        best = d;
        dir = { x: dx / Math.sqrt(d), z: dz / Math.sqrt(d) };
      }
    }
  }
  return dir;
}

function addGangway(
  parts: Parts,
  ring: Ring2,
  deckY: number,
  bank: Point2,
  ctx: RiversideContext
): void {
  const gb = ctx.heightAt(bank[0], bank[1]);
  if (gb === null) {
    return;
  }
  const b = epsgToWorld(bank[0], bank[1], ctx.offset);
  let near = ring.pts[0];
  for (const p of ring.pts) {
    if (
      Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(near.x - b.x, near.z - b.z)
    ) {
      near = p;
    }
  }
  const run: Pt[] = [
    { x: near.x, y: deckY, z: near.z },
    { x: b.x, y: gb + 0.05, z: b.z },
  ];
  addRibbon(parts.gangway, run, 0, GANGWAY_HALF, 0.12);
  for (const side of [-1, 1]) {
    addRibbon(
      parts.railing,
      run.map((p) => ({ ...p, y: p.y + 0.9 })),
      side * GANGWAY_HALF,
      0.03,
      0.05
    );
  }
}

function addPontoon(
  parts: Parts,
  f: RiversideFeature,
  coords: Point2[],
  ctx: RiversideContext
): void {
  const water = waterLevel(coords, ctx);
  if (water === null) {
    return;
  }
  const ring = ringToWorld(coords, ctx.offset);
  const deckY = water + PONTOON_FREEBOARD;
  addFootprint(
    parts.hull,
    ring,
    ring.pts.map(() => water + HULL_TOP),
    HULL_TOP + HULL_DRAFT
  );
  addFootprint(
    parts.pontoonDeck,
    ring,
    ring.pts.map(() => deckY),
    PONTOON_FREEBOARD - HULL_TOP
  );
  const dir = longDir(ring);
  if ((f.properties?.len ?? 0) > HUT_FROM_M) {
    addBox(parts.hut, centroid(ring), dir, [1.6, 1.1], [deckY, deckY + 2.3]);
    addBox(
      parts.roof,
      centroid(ring),
      dir,
      [1.85, 1.35],
      [deckY + 2.3, deckY + 2.42]
    );
  }
  const bank = f.properties?.bank;
  if (bank) {
    addGangway(parts, ring, deckY, bank, ctx);
  }
}

/** A low stone ridge along the groyne: crest over the ground, flanks
 *  running down into it. */
function addGroyne(
  parts: Parts,
  coords: Point2[],
  ctx: RiversideContext
): void {
  const pts: Pt[] = [];
  for (const [ex, ey] of subdividePolyline(coords, 2)) {
    const g = ctx.heightAt(ex, ey);
    if (g !== null) {
      const w = epsgToWorld(ex, ey, ctx.offset);
      pts.push({ x: w.x, y: g + GROYNE_CREST, z: w.z });
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const t = Math.hypot(tx, tz) || 1;
    const nx = -tz / t;
    const nz = tx / t;
    const drop = GROYNE_CREST * 2;
    // the flank's normal: out and up in the ratio of its slope
    const up = GROYNE_HALF / Math.hypot(GROYNE_HALF, drop);
    const out = drop / Math.hypot(GROYNE_HALF, drop);
    for (const side of [-1, 1]) {
      const ox = nx * side * GROYNE_HALF;
      const oz = nz * side * GROYNE_HALF;
      quad(
        parts.groyne,
        [a.x, a.y, a.z],
        [b.x, b.y, b.z],
        [b.x + ox, b.y - drop, b.z + oz],
        [a.x + ox, a.y - drop, a.z + oz],
        [nx * side * out, up, nz * side * out]
      );
    }
  }
}

/** The dashed wake: a flat ribbon on the water, dashes from the arc
 *  length, faded in only from the air. */
function ferryMesh(lines: Point2[][], ctx: RiversideContext): Mesh | null {
  const pos: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  for (const coords of lines) {
    let s = 0;
    let prev: Point2 | null = null;
    let prevOk = false;
    const dense = subdividePolyline(coords, 2);
    for (let i = 0; i < dense.length; i++) {
      const [ex, ey] = dense[i];
      if (prev) {
        s += Math.hypot(ex - prev[0], ey - prev[1]);
      }
      prev = dense[i];
      const g = ctx.heightAt(ex, ey);
      if (g === null) {
        // No ground here (off every loaded tile): no vertex either — one at
        // height 0 would stretch the bounding sphere down to sea level.
        prevOk = false;
        continue;
      }
      const next = dense[Math.min(i + 1, dense.length - 1)];
      const last = dense[Math.max(i - 1, 0)];
      const tx = next[0] - last[0];
      const ty = next[1] - last[1];
      const t = Math.hypot(tx, ty) || 1;
      // across the route, in projected coordinates
      const ax = (-ty / t) * FERRY_HALF;
      const ay = (tx / t) * FERRY_HALF;
      const y = g + 0.06;
      const base = pos.length / 3;
      for (const side of [-1, 1]) {
        const w = epsgToWorld(ex + ax * side, ey + ay * side, ctx.offset);
        pos.push(w.x, y, w.z);
        along.push(s);
      }
      if (prevOk) {
        index.push(base - 2, base, base - 1, base - 1, base, base + 1);
      }
      prevOk = true;
    }
  }
  if (index.length === 0) {
    return null;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("wakeAlong", new Float32BufferAttribute(along, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const material = new MeshBasicMaterial({
    color: new Color(WAKE),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const { heightFog } = ctx;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, MAP_OVERLAY_UNIFORMS);
    sh.vertexShader = `attribute float wakeAlong;
varying float vWakeAlong;
${sh.vertexShader.replace(
  "#include <begin_vertex>",
  "#include <begin_vertex>\n\tvWakeAlong = wakeAlong;"
)}`;
    sh.fragmentShader = `varying float vWakeAlong;
${MAP_FADE_GLSL}
${sh.fragmentShader.replace(
  "#include <color_fragment>",
  `#include <color_fragment>
	float wakeDash = 1.0 - smoothstep( 0.5, 0.56, fract( vWakeAlong / ${FERRY_DASH_M.toFixed(1)} ) );
	diffuseColor.a *= 0.55 * wakeDash * mapFade();`
)}`;
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  const mesh = new Mesh(geo, material);
  mesh.name = "riverside-ferry";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 3; // over the water sheet
  return mesh;
}

function instancedColumns(
  mats: Matrix4[],
  unit: BufferGeometry,
  color: number,
  name: string,
  ctx: RiversideContext
): InstancedMesh | null {
  if (mats.length === 0) {
    unit.dispose();
    return null;
  }
  const material = new MeshStandardMaterial({
    color: new Color(color),
    roughness: 0.9,
  });
  const { heightFog } = ctx;
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  const mesh = new InstancedMesh(unit, material, mats.length);
  for (let i = 0; i < mats.length; i++) {
    mesh.setMatrixAt(i, mats[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

/** One tile's landing stages, groynes and ferry lines. Empty input yields
 *  an empty group; freed with the tile (disposeObject3D). */
export function buildRiverside(
  features: RiversideFeature[],
  ctx: RiversideContext
): Group {
  const group = new Group();
  group.name = "riverside";
  const parts: Parts = {
    deck: mesh3(),
    gangway: mesh3(),
    groyne: mesh3(),
    hull: mesh3(),
    hut: mesh3(),
    pontoonDeck: mesh3(),
    posts: [],
    railing: mesh3(),
    piles: [],
    roof: mesh3(),
  };
  const ferries: Point2[][] = [];
  for (const f of features) {
    const k = f.properties?.k;
    const ring = outline(f);
    if (k === "pier" && ring && Number.isFinite(f.properties?.deck)) {
      addPier(parts, ring, f.properties?.deck ?? 0, ctx);
    } else if (k === "pontoon" && ring) {
      addPontoon(parts, f, ring, ctx);
    } else if (k === "groyne" && f.geometry.type === "LineString") {
      addGroyne(parts, f.geometry.coordinates, ctx);
    } else if (k === "ferry" && f.geometry.type === "LineString") {
      ferries.push(f.geometry.coordinates);
    }
  }
  const { heightFog } = ctx;
  const solid: [Mesh3, number, string][] = [
    [parts.deck, TIMBER, "riverside-pier"],
    [parts.hull, HULL, "riverside-pontoon"],
    [parts.pontoonDeck, PONTOON_DECK, "riverside-pontoon"],
    [parts.hut, HUT, "riverside-hut"],
    [parts.roof, HUT_ROOF, "riverside-hut"],
    [parts.gangway, TIMBER, "riverside-gangway"],
    [parts.railing, RAILING, "riverside-railing"],
    [parts.groyne, GROYNE_STONE, "riverside-groyne"],
  ];
  for (const [acc, color, name] of solid) {
    const mesh = meshFrom(acc, color, heightFog, { cast: true });
    if (mesh) {
      mesh.name = name;
      group.add(mesh);
    }
  }
  const pileUnit = new CylinderGeometry(0.14, 0.14, 1, 8);
  const postUnit = new BoxGeometry(0.06, 1, 0.06);
  for (const mesh of [
    instancedColumns(parts.piles, pileUnit, PILE, "riverside-piles", ctx),
    instancedColumns(parts.posts, postUnit, RAILING, "riverside-posts", ctx),
    ferryMesh(ferries, ctx),
  ]) {
    if (mesh) {
      group.add(mesh);
    }
  }
  return group;
}
