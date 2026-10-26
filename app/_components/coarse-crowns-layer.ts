import {
  type BufferGeometry,
  Color,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
} from "three/webgpu";
import {
  type CoarseCrown,
  type CoarseForm,
  coarseForm,
  COARSE_TREE_WIDEN,
} from "@/lib/city/coarse-crowns";
import type { RecenterOffset } from "@/lib/city/ground-clamp";
import { pineBase } from "@/lib/city/tree-inventory";
import { bucketByCell, hash } from "@/lib/city/tree-placement";
import {
  boxOf,
  buildConeGeo,
  buildPineGeo,
  COARSE_CONE_PROFILE,
  CONE_SEGMENTS,
  type CrownBox,
} from "./conifer-crown";
import type { CrownSeasonKey, SeasonalCrowns } from "./crown-season";
import { seasonCrowns } from "./crown-season";
import { Instances } from "./instancing";
import { finished, inRuns, type Steps } from "@/lib/city/build-steps";
import { inventoryColor, registerCrownMatrix } from "./tree-inventory-layer";
import {
  applySeasons,
  buildCrownGeo,
  crownColor,
  crownFrame,
  genericSeasonKey,
  padCrownSphere,
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
 * left without trees. One set per vegetation chunk and form — the lobed
 * crown, the cone for its conifers and the pine's crown for its pines
 * (`coarseForm`) —, on the scene's
 * crown materials (sceneCrowns): the wind and the look reach them as every
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

/** One crown's matrix: the fine level's, wider — a canopy crown between
 *  its base and its top (`crownFrame`), a pine's high on its stem
 *  (`pineBase`). */
function crownMatrix(c: CoarseCrown, ground: number, out: Matrix4): Matrix4 {
  if (c.kind === "register") {
    const ext = { ...c.ext, crownWidth: c.ext.crownWidth * W };
    return out.copy(
      registerCrownMatrix({ ext, ground, rot: c.rot, x: c.x, z: c.z })
    );
  }
  const base = coarseForm(c) === "pine" ? pineBase(c) : c.base;
  const { lift, scale } = crownFrame({ ...c, y: ground, base });
  return out.compose(
    new Vector3(c.x, ground + lift, c.z),
    new Quaternion().setFromAxisAngle(Y_AXIS, c.rot),
    new Vector3((c.w ?? c.s) * W, scale, (c.w ?? c.s) * W)
  );
}

/** One crown's colour, as the fine level paints it. */
function paintCrown(c: CoarseCrown, ground: number, col: Color): void {
  const v = hash(c.x * 0.3 + c.z * 0.7) - 0.5;
  if (c.kind === "canopy") {
    crownColor(
      col,
      {
        x: c.x,
        y: ground,
        z: c.z,
        rot: c.rot,
        s: c.s,
        w: c.w,
        ndvi: c.ndvi,
        ...(c.evergreen ? { evergreen: true } : {}),
      },
      v
    );
    return;
  }
  inventoryColor(
    col,
    {
      colour: c.colour === "copper" ? 1 : c.colour === "golden" ? 2 : 0,
      genus: c.genus,
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
    return genericSeasonKey(c.x, c.z, c.evergreen);
  }
  return {
    genus: c.genus,
    evergreen: c.colour === "evergreen",
    jitter: c.jitter,
  };
}

/** The box of the lobed crown at its full detail: measured once for the
 *  page, not built and freed again on every coarse tile with a conifer. */
let fineCrownBox: CrownBox | null = null;

/**
 * The coarse level's cone: one skirt, inside the box of the lobed crown
 * the fine level fits its trees to (buildCrownGeo at its full detail), so
 * a coarse conifer stands where and as its fine cone does.
 */
function coarseCone(): BufferGeometry {
  if (!fineCrownBox) {
    const fine = buildCrownGeo();
    fineCrownBox = boxOf(fine);
    fine.dispose();
  }
  return padCrownSphere(
    buildConeGeo(fineCrownBox, CONE_SEGMENTS.coarse, COARSE_CONE_PROFILE)
  );
}

/** A coarse tile's crowns as a vegetation control (no tiers to pick: the
 *  coarse level is far, or small, wherever it shows). */
export function buildCoarseCrowns(
  crowns: readonly CoarseCrown[],
  ctx: CoarseCrownContext
): VegetationControl {
  return finished(coarseCrownSteps(crowns, ctx));
}

/** Crowns stood per step (build-steps.ts). */
const STAND_RUN = 512;

/** `buildCoarseCrowns` in steps: per run of crowns, per cell
 *  (build-steps.ts). */
export function* coarseCrownSteps(
  crowns: readonly CoarseCrown[],
  ctx: CoarseCrownContext
): Steps<VegetationControl> {
  const group = new Group();
  group.name = "coarse-crowns";
  const mats = sceneCrowns(ctx.sunDirection);
  // The far tier's lobed crown one subdivision coarser — a few pixels
  // across wherever the coarse level shows —, and the conifers' cone of one
  // skirt; each the tile's own: freeing a set frees the geometry it views.
  const geo = buildCrownGeo(0);
  const forms: Partial<Record<CoarseForm, BufferGeometry>> = { broad: geo };
  const geoOf = (form: CoarseForm): BufferGeometry => {
    forms[form] ??=
      form === "pine" ? padCrownSphere(buildPineGeo(geo)) : coarseCone();
    return forms[form];
  };
  const { cx, cy } = ctx.offset;
  const standing = yield* inRuns(crowns, STAND_RUN, (run) =>
    run.flatMap((c) => {
      const ground = ctx.heightAt(c.x + cx, cy - c.z);
      return ground === null ? [] : [{ ...c, ground }];
    })
  );
  const seasons: SeasonalCrowns[] = [];
  const m = new Matrix4();
  const col = new Color();
  const cells = bucketByCell(standing).flatMap((cell) =>
    (["broad", "cone", "pine"] as const).flatMap((form) => {
      const list = cell.filter((c) => coarseForm(c) === form);
      return list.length > 0 ? [{ list, form }] : [];
    })
  );
  for (const { list: cell, form } of cells) {
    const set = new Instances(geoOf(form), mats.leafy, cell.length);
    set.castShadow = true;
    set.receiveShadow = true;
    // a cone or a pine keeps its form in a styled frame, as on the fine
    // level
    if (form === "broad") {
      set.userData.styleCrown = "far";
    }
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
    yield;
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
