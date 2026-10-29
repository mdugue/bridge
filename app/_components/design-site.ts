import { DataTexture, FloatType, NearestFilter, RGFormat } from "three/webgpu";
import {
  clamp,
  Fn,
  If,
  ivec2,
  mix,
  min,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  positionLocal,
  positionWorld,
  step,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { SiteMask } from "@/lib/city/design-cover";
import type { RecenterOffset } from "@/lib/city/ground-clamp";
import type { F, V2, V3 } from "./shader-chunks";

/**
 * Where a planner's design stands (ADR 0054): what the city keeps under it
 * goes. The design's site — every triangle of it laid flat, its ground
 * plate too, with the lowest height it reaches in each cell
 * (design-cover.ts `designMasks`) — is one small raster the scene's
 * shaders read in their vertex stage:
 *
 * - every instanced set (`instancePosition`: trees, hedges, lamps,
 *   furniture, monuments, …) folds an instance standing in it into its
 *   foot, drawn as nothing and casting nothing;
 * - the ground and what is baked into it (terrain, walls, kerbs, stairs,
 *   fences) is pressed down to just under the design there — a sloping
 *   plate's slope, a house's lowest floor —, so no hump, wall or step
 *   comes through it; the tiles under it also cut what a triangle
 *   reaching out of the site lifts through it (`groundKeptUnderDesign`).
 *
 * One set of uniforms for the site, read behind a uniform branch: without
 * a design the vertex stages pay one comparison. The raster is made when
 * the first design is loaded (a 1×1 stand-in until then) and kept at most
 * `SITE_SIDE` cells a side.
 */

/** The most cells the site's raster has along either axis. */
export const SITE_SIDE = 512;
/** How far under the design's floor the ground goes (m). */
export const SITE_UNDER_M = 0.05;

const standIn = new DataTexture(new Float32Array(2), 1, 1, RGFormat, FloatType);
standIn.needsUpdate = true;

const site = {
  on: uniform(0),
  /** scene x of the raster's first column, scene z of its first row's
   *  south edge (rows run north, scene z south) */
  x0: uniform(0),
  z0: uniform(0),
  cell: uniform(1),
  cols: uniform(1),
  rows: uniform(1),
  raster: texture(standIn),
};
let raster: DataTexture | null = null;

/** The raster's flags: a cell the design reaches, and one whose eight
 *  neighbours it reaches too (the site's core, where the ground is cut). */
const EDGE = 0.5;
const CORE = 1;

/** The site's texel at scene (x, z): (the design's lowest height there,
 *  its flag; 0 off the site) — inside a `Fn`: it declares a variable. The
 *  point is taken into a variable before the branch: what it is built of
 *  is then built where its users are, not only when the branch runs. */
function siteTexel(xz: V2): V2 {
  const at = xz.toVar();
  const texel = vec2(0, 0).toVar();
  If(site.on.greaterThan(0.5), () => {
    const c = at.x.sub(site.x0).div(site.cell).floor();
    const r = site.z0.sub(at.y).div(site.cell).floor();
    const inBox = step(0, c)
      .mul(step(0, r))
      .mul(step(c, site.cols.sub(1)))
      .mul(step(r, site.rows.sub(1)));
    const read = textureLoad(
      site.raster,
      ivec2(
        clamp(c, 0, site.cols.sub(1)).toInt(),
        clamp(r, 0, site.rows.sub(1)).toInt()
      )
    );
    texel.assign(vec2(read.r, read.g.mul(inBox)));
  });
  return texel;
}

/** 1 where scene (x, z) lies in the design's site — in its core with
 *  `core` — else 0. */
export function inDesignSite(xz: V2, core = false): F {
  return step(core ? 0.75 : 0.25, siteTexel(xz).y);
}

/** An instance's vertex (`placed`, the set's frame) folded into its foot
 *  (`origin`) where that foot stands in the design's site. */
export function outOfDesignSite(placed: V3, origin: V3): V3 {
  const foot = modelWorldMatrix.mul(vec4(origin, 1)).xyz;
  return mix(placed, origin, inDesignSite(foot.xz));
}

/** The ground's vertex pressed under the design where it reaches (its
 *  lowest height there; the mesh's own frame in, and out: a quantised
 *  glTF's too) — one node for every ground material. */
export const groundUnderDesign = Fn(() => {
  const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz.toVar();
  const texel = siteTexel(world.xz);
  const pressed = min(world.y, texel.x.sub(SITE_UNDER_M));
  const y = mix(world.y, pressed, step(0.25, texel.y));
  return modelWorldMatrixInverse.mul(vec4(vec3(world.x, y, world.z), 1)).xyz;
})() as unknown as V3;

/**
 * The ground's fragments to keep: none in the site's core above the
 * design there — where a triangle reaching out of the site lifts the
 * ground through the design's plate between its vertices. A `maskNode`
 * (a discard) costs the ground its early depth test, so only the tiles
 * under a design carry it (`cutsGround`).
 */
export const groundKeptUnderDesign = Fn(() => {
  const texel = siteTexel(positionWorld.xz);
  const above = step(texel.x.sub(SITE_UNDER_M / 2), positionWorld.y);
  return step(0.75, texel.y).mul(above).lessThan(0.5);
})();

/** The projected box of the design's site, or null (none loaded). */
let siteBox: [number, number, number, number] | null = null;

/** Whether a ground tile (its projected bounds) lies under the design's
 *  site and so must cut its ground there. */
export function cutsGround(bounds: readonly number[]): boolean {
  return (
    siteBox !== null &&
    bounds[0] < siteBox[2] &&
    bounds[2] > siteBox[0] &&
    bounds[1] < siteBox[3] &&
    bounds[3] > siteBox[1]
  );
}

/** What the site's raster holds on the GPU while a design is loaded
 *  (bytes): two float32 per cell — the design's lifts it from the tile
 *  cache with its own (design-layer.ts). */
export const SITE_BYTES = SITE_SIDE * SITE_SIDE * 8;

/** Sets the design's site, or clears it (`null`). */
export function setDesignSite(
  mask: SiteMask | null,
  offset: RecenterOffset
): void {
  if (!mask || mask.cols > SITE_SIDE || mask.rows > SITE_SIDE) {
    site.on.value = 0;
    siteBox = null;
    return;
  }
  if (!raster) {
    raster = new DataTexture(
      new Float32Array(SITE_SIDE * SITE_SIDE * 2),
      SITE_SIDE,
      SITE_SIDE,
      RGFormat,
      FloatType
    );
    raster.magFilter = NearestFilter;
    raster.minFilter = NearestFilter;
    site.raster.value = raster;
  }
  const data = raster.image.data as Float32Array;
  data.fill(0);
  const at = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < mask.cols && r < mask.rows
      ? mask.cells[r * mask.cols + c]
      : 0;
  for (let r = 0; r < mask.rows; r++) {
    for (let c = 0; c < mask.cols; c++) {
      if (at(c, r) === 1) {
        let core = true;
        for (let dr = -1; dr <= 1 && core; dr++) {
          for (let dc = -1; dc <= 1 && core; dc++) {
            core = at(c + dc, r + dr) === 1;
          }
        }
        const i = (r * SITE_SIDE + c) * 2;
        data[i] = mask.floors[r * mask.cols + c];
        data[i + 1] = core ? CORE : EDGE;
      }
    }
  }
  raster.needsUpdate = true;
  site.x0.value = mask.x0 - offset.cx;
  site.z0.value = offset.cy - mask.y0;
  site.cell.value = mask.cell;
  site.cols.value = mask.cols;
  site.rows.value = mask.rows;
  site.on.value = 1;
  siteBox = [
    mask.x0,
    mask.y0,
    mask.x0 + mask.cols * mask.cell,
    mask.y0 + mask.rows * mask.cell,
  ];
}

/** Lets the site's raster go (the design left): the stand-in again. */
export function releaseDesignSite(): void {
  site.on.value = 0;
  siteBox = null;
  if (raster) {
    site.raster.value = standIn;
    raster.dispose();
    raster = null;
  }
}
