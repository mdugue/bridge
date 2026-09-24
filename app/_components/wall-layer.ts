import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import type { WallFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { subdividePolyline } from "@/lib/city/polyline";
import { type StepSnap, smoothSnaps, snapToStep } from "@/lib/city/wall-snap";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * Retaining / city walls from OSM (`scripts/extract-walls.sh`). Monumental walls
 * like the Brühlsche Terrasse are no vertical face in any elevation product —
 * the laser ground steps within ~0.75 m, the native DGM1 within ~1.7 m, and the
 * 1024² heightfield smears that into a ~3 m bank — and a wall is not a
 * CityJSON building, so it "goes missing". OSM has it as tagged lines with
 * heights; this renders those as vertical sandstone ribbons sitting on the DGM1
 * ground (base draped via the cross-tile `heightAt`, top = base + the OSM
 * height). Built ONCE for the whole tile block; authored Y-up → added to `scene`.
 * Non-fatal: missing/empty inputs yield an empty group.
 */

export interface WallContext extends GroundContext {
  heightFog?: HeightFogUniforms;
  /**
   * TIN ground (every tile of the block): nothing was burned to the OSM
   * line, so an
   * earth-retaining wall snaps to the step the terrain measures instead
   * (lib/city/wall-snap.ts) — face at the ramp's foot, a coping cap back to
   * its crest. Walls with no measurable step keep the old placement.
   */
  snapToStep?: boolean;
}

/** OSM kinds that hold back earth (the ones the conflation also reshapes). */
const RETAINING_KINDS = new Set(["retaining_wall", "city_wall", "embankment"]);

const SAMPLE_M = 2.5; // densify polylines to this spacing (m)
const PERP_M = 9; // perpendicular probe distance to find the low/high side (m)
// The terrain is now CONFLATED to step at the wall line (terrain-conflate.ts),
// so the wall no longer has to escape a smooth ramp — it just nudges a touch onto
// the low side to skin the step's face instead of z-fighting it.
const OFFSET_M = 1.5; // stand the wall this far onto the low side (m)
const MIN_H = 1.2; // skip kerb-height garden walls (m)
const MAX_H = 14; // clamp tall tags (m)
const WALL_COLOR = 0xc9_bd_a4; // warm sandstone

/** A densified wall vertex with its world XZ and the base/top elevations;
 *  a snapped column also carries where its coping cap ends (`bx`, `bz`). */
interface WallCol {
  base: number;
  bx?: number;
  bz?: number;
  top: number;
  wx: number;
  wz: number;
}

/** How far in front of the measured ramp foot the snapped face stands (m):
 *  the ramp's foot wanders between the 1 m grid points the TIN kept, and a
 *  straight face between two columns must stay in front of all of it. */
const FACE_MARGIN_M = 0.5;

/** The column at a (smoothed) measured step: face just in front of the
 *  ramp's foot, cap back to its crest. */
function snappedColumn(
  ex: number,
  ey: number,
  px: number,
  py: number,
  h: number,
  step: StepSnap,
  ctx: WallContext
): WallCol {
  const faceAt = step.foot - step.up * FACE_MARGIN_M;
  const face = epsgToWorld(ex + px * faceAt, ey + py * faceAt, ctx.offset);
  const back = epsgToWorld(
    ex + px * step.crest,
    ey + py * step.crest,
    ctx.offset
  );
  const base = Math.max(step.hi - MAX_H, Math.min(step.lo, step.hi - h)) - 0.4;
  return {
    wx: face.x,
    wz: face.z,
    bx: back.x,
    bz: back.z,
    base,
    top: step.hi,
  };
}

/** Base/top elevation for one wall vertex: top = the high side, base dropped to
 *  the low side or the tagged height, whichever is lower (clamped). */
function columnAt(
  ex: number,
  ey: number,
  px: number,
  py: number,
  h: number,
  ctx: WallContext
): WallCol | null {
  const g = ctx.heightAt(ex, ey);
  if (g === null) {
    return null; // off-tile / NoData — break the ribbon here
  }
  const gP = ctx.heightAt(ex + px * PERP_M, ey + py * PERP_M) ?? g;
  const gN = ctx.heightAt(ex - px * PERP_M, ey - py * PERP_M) ?? g;
  const top = Math.max(g, gP, gN); // the high shelf (now a real conflated step)
  const lowShelf = Math.min(gP, gN); // the low shelf on the far/river side
  // Stand the wall just onto the low side so its face skins the terrain step.
  const towardP = gP <= gN;
  const ox = towardP ? px : -px;
  const oy = towardP ? py : -py;
  const sx = ex + ox * OFFSET_M;
  const sy = ey + oy * OFFSET_M;
  // base = the low shelf, dropped further to span the OSM height when the step is
  // shallower than the tag; clamped to MAX_H + a small dip below ground.
  const base = Math.max(top - MAX_H, Math.min(lowShelf, top - h)) - 0.4;
  const w = epsgToWorld(sx, sy, ctx.offset);
  return { wx: w.x, wz: w.z, base, top };
}

/** Pushes the two triangles of a vertical quad between two columns. */
function pushQuad(pos: number[], nrm: number[], a: WallCol, b: WallCol): void {
  let nx = -(b.wz - a.wz);
  let nz = b.wx - a.wx;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl;
  nz /= nl;
  // a.base, b.base, b.top, a.top  → two tris (DoubleSide, so winding is free)
  const v = [
    a.wx,
    a.base,
    a.wz,
    b.wx,
    b.base,
    b.wz,
    b.wx,
    b.top,
    b.wz,
    a.wx,
    a.base,
    a.wz,
    b.wx,
    b.top,
    b.wz,
    a.wx,
    a.top,
    a.wz,
  ];
  pos.push(...v);
  for (let i = 0; i < 6; i++) {
    nrm.push(nx, 0, nz);
  }
}

/** The coping cap between two snapped columns: a flat strip at the top from
 *  the face back to the crest, hiding the ramp the face stands in front of. */
function pushCap(pos: number[], nrm: number[], a: WallCol, b: WallCol): void {
  if (a.bx === undefined && b.bx === undefined) {
    return;
  }
  const abx = a.bx ?? a.wx;
  const abz = a.bz ?? a.wz;
  const bbx = b.bx ?? b.wx;
  const bbz = b.bz ?? b.wz;
  pos.push(
    a.wx,
    a.top,
    a.wz,
    b.wx,
    b.top,
    b.wz,
    bbx,
    b.top,
    bbz,
    a.wx,
    a.top,
    a.wz,
    bbx,
    b.top,
    bbz,
    abx,
    a.top,
    abz
  );
  for (let i = 0; i < 6; i++) {
    nrm.push(0, 1, 0);
  }
}

/**
 * One wall's columns, every SAMPLE_M along its line. With `snapToStep`, an
 * earth-retaining wall first snaps every vertex to the measured step and
 * smooths the snaps along the wall (lib/city/wall-snap.ts); vertices that
 * find no agreed step fall back to the OSM-line placement.
 */
function wallColumns(f: WallFeature, ctx: WallContext): (WallCol | null)[] {
  const h = Math.max(0.5, f.properties?.h ?? 2);
  const snap =
    ctx.snapToStep === true && RETAINING_KINDS.has(f.properties?.kind ?? "");
  const pts = subdividePolyline(f.geometry.coordinates, SAMPLE_M);
  const perps = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    return [-ty / tl, tx / tl] as const;
  });
  const steps = snap
    ? smoothSnaps(
        pts.map((p, i) =>
          snapToStep(ctx.heightAt, p[0], p[1], perps[i][0], perps[i][1])
        )
      )
    : [];
  return pts.map((p, i) => {
    const [px, py] = perps[i];
    const step = steps[i];
    return step
      ? snappedColumn(p[0], p[1], px, py, h, step, ctx)
      : columnAt(p[0], p[1], px, py, h, ctx);
  });
}

function buildWallGeometry(
  features: WallFeature[],
  ctx: WallContext
): BufferGeometry | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const cols = wallColumns(f, ctx);
    for (let i = 0; i < cols.length - 1; i++) {
      const c0 = cols[i];
      const c1 = cols[i + 1];
      if (!(c0 && c1)) {
        continue;
      }
      if (c0.top - c0.base < MIN_H && c1.top - c1.base < MIN_H) {
        continue;
      }
      pushQuad(pos, nrm, c0, c1);
      pushCap(pos, nrm, c0, c1);
    }
  }
  if (pos.length === 0) {
    return null;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Builds every tile's walls (the features each tile fetched once, shared with
 * its terrain conflation) as one ribbon mesh; freed with the scene.
 */
export function buildWalls(features: WallFeature[], ctx: WallContext): Group {
  const group = new Group();
  group.name = "walls";

  const material = new MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  });
  const heightFog = ctx.heightFog;
  if (heightFog) {
    material.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }

  const geo = features.length > 0 ? buildWallGeometry(features, ctx) : null;
  if (geo) {
    const mesh = new Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
