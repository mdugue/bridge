import { Color, Group, Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { type CoarseCrown, COARSE_TREE_WIDEN } from "@/lib/city/coarse-crowns";
import type { RecenterOffset } from "@/lib/city/ground-clamp";
import { bucketByCell, hash } from "@/lib/city/tree-placement";
import type { CrownSeasonKey, SeasonalCrowns } from "./crown-season";
import { seasonCrowns } from "./crown-season";
import { Instances } from "./instancing";
import { inventoryColor, registerCrownMatrix } from "./tree-inventory-layer";
import {
  applySeasons,
  buildCrownGeo,
  crownColor,
  genericSeasonKey,
  sceneCrowns,
  type VegetationControl,
} from "./vegetation-layer";

/**
 * The coarse terrain level's trees (lib/city/coarse-crowns.ts): a third of
 * the fine level's trees, where the fine level stands them, in its colours
 * and season, their crowns COARSE_TREE_WIDEN wider. Built with the coarse
 * level's dressing and shown with it — whenever the tile renderer shows
 * the coarse level, in the distance on foot and in the air, in Modell
 * wherever the fine level is not loaded — so no scale and no device is
 * left without trees. One set per vegetation chunk, on the scene's crown
 * materials (sceneCrowns): the wind and the look reach them as every
 * other crown, and they need no build of their own.
 */
export interface CoarseCrownContext {
  /** the coarse ground the crowns stand on (EPSG) */
  heightAt: (x: number, y: number) => number | null;
  offset: RecenterOffset;
  sunDirection?: Vector3;
}

const Y_AXIS = new Vector3(0, 1, 0);
const W = COARSE_TREE_WIDEN;

/** One crown's matrix: the fine level's, wider. */
function crownMatrix(c: CoarseCrown, ground: number, out: Matrix4): Matrix4 {
  if (c.kind === "register") {
    const ext = { ...c.ext, crownWidth: c.ext.crownWidth * W };
    return out.copy(
      registerCrownMatrix({ ext, ground, rot: c.rot, x: c.x, z: c.z })
    );
  }
  return out.compose(
    new Vector3(c.x, ground, c.z),
    new Quaternion().setFromAxisAngle(Y_AXIS, c.rot),
    new Vector3((c.w ?? c.s) * W, c.s, (c.w ?? c.s) * W)
  );
}

/** One crown's colour, as the fine level paints it. */
function paintCrown(c: CoarseCrown, ground: number, col: Color): void {
  const v = hash(c.x * 0.3 + c.z * 0.7) - 0.5;
  if (c.kind === "canopy") {
    crownColor(
      col,
      { x: c.x, y: ground, z: c.z, rot: c.rot, s: c.s, w: c.w, ndvi: c.ndvi },
      v
    );
    return;
  }
  inventoryColor(
    col,
    {
      colour: c.colour === "copper" ? 1 : c.colour === "golden" ? 2 : 0,
      ground,
      leaf: c.colour === "evergreen" ? "e" : "d",
      ndvi: c.ndvi,
      x: c.x,
      z: c.z,
    },
    v
  );
}

function seasonKey(c: CoarseCrown): CrownSeasonKey {
  if (c.kind === "canopy") {
    return genericSeasonKey(c.x, c.z);
  }
  return {
    genus: c.genus,
    evergreen: c.colour === "evergreen",
    jitter: c.jitter,
  };
}

/** A coarse tile's crowns as a vegetation control (no tiers to pick: the
 *  coarse level is far, or small, wherever it shows). */
export function buildCoarseCrowns(
  crowns: readonly CoarseCrown[],
  ctx: CoarseCrownContext
): VegetationControl {
  const group = new Group();
  group.name = "coarse-crowns";
  const mats = sceneCrowns(ctx.sunDirection);
  // The far tier's lobed crown one subdivision coarser — a few pixels
  // across wherever the coarse level shows. The tile's own: freeing a set
  // frees the geometry it views.
  const geo = buildCrownGeo(0);
  const { cx, cy } = ctx.offset;
  const standing = crowns.flatMap((c) => {
    const ground = ctx.heightAt(c.x + cx, cy - c.z);
    return ground === null ? [] : [{ ...c, ground }];
  });
  const seasons: SeasonalCrowns[] = [];
  const m = new Matrix4();
  const col = new Color();
  for (const cell of bucketByCell(standing)) {
    const set = new Instances(geo, mats.leafy, cell.length);
    set.castShadow = true;
    set.receiveShadow = true;
    set.userData.styleCrown = "far";
    cell.forEach((c, i) => {
      set.setMatrixAt(i, crownMatrix(c, c.ground, m));
      paintCrown(c, c.ground, col);
      set.setColorAt(i, col);
    });
    set.instanceMatrix.needsUpdate = true;
    set.computeBoundingSphere();
    group.add(set);
    seasons.push(
      seasonCrowns({ mid: set, rich: set }, cell.map(seasonKey), mats)
    );
  }
  const u = mats.uniforms;
  return {
    group,
    chunks: [],
    // the crown uniforms are the scene's: the look reaches these through
    // whichever control writes it
    applyLook: () => undefined,
    multiTuft: () => false,
    setTime: (seconds) => {
      u.time.value = seconds;
    },
    setSeason: (day) => applySeasons(seasons, day),
    updateLod: () => false,
  };
}
