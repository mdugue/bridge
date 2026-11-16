import { Color, Group } from "three/webgpu";
import type { BufferGeometry, Vector3 } from "three/webgpu";
import { COARSE_TREE_WIDEN } from "@/lib/city/coarse-crowns";
import type { Stand } from "@/lib/city/stand-record";
import { pineBase } from "@/lib/city/tree-inventory";
import type { InventoryTree } from "@/lib/city/tree-inventory";
import { bucketByCell, hash } from "@/lib/city/tree-placement";
import type { Placement } from "@/lib/city/tree-placement";
import { placementRecords, registerCrownStand } from "@/lib/city/tree-stands";
import {
  boxOf,
  buildConeGeo,
  buildPineGeo,
  COARSE_CONE_PROFILE,
  CONE_SEGMENTS,
} from "./conifer-crown";
import type { CrownBox } from "./conifer-crown";
import type { CrownSeasonKey, SeasonalCrowns } from "./crown-season";
import { seasonCrowns } from "./crown-season";
import { Instances, standTable } from "./instancing";
import { finished } from "@/lib/city/build-steps";
import type { Steps } from "@/lib/city/build-steps";
import { broadCrownFit, inventoryColor } from "./tree-inventory-layer";
import {
  applySeasons,
  buildCrownGeo,
  canopyForm,
  crownColor,
  genericSeasonKey,
  padCrownSphere,
  sceneCrowns,
} from "./vegetation-layer";
import type { CanopyForm, VegetationControl } from "./vegetation-layer";

/**
 * The coarse terrain level's trees (lib/city/coarse-crowns.ts): a third of
 * the tile's trees, where the fine level stands them, in its colours and
 * season, their crowns COARSE_TREE_WIDEN wider. Built with the coarse
 * level's dressing and shown with it — whenever the tile renderer shows
 * the coarse level, in the distance on foot and in the air, in Modell
 * wherever the fine level is not loaded — so no scale and no device is
 * left without trees. They come placed (the level's dressing file,
 * lib/city/tree-table.ts: each on the fine level's ground, which the
 * build read): the layer reads no ground and writes no matrix. One set per
 * vegetation chunk and form — the lobed crown, the cone for its conifers
 * and the pine's crown for its pines —, each a table of stand records
 * (lib/city/tree-stands.ts), on the scene's crown materials
 * (sceneCrowns): the wind and the look reach them as every other crown,
 * and they need no build of their own.
 */
export interface CoarseCrownContext {
  sunDirection?: Vector3;
}

/** The coarse level's third of a tile's trees. */
export interface CoarseTrees {
  /** the register's, each drawn as the lobed crown, the cone or a pine's */
  register: readonly InventoryTree[];
  /** the canopy's, the scan's and the rows' */
  trees: readonly Placement[];
}

const W = COARSE_TREE_WIDEN;

/** One crown to draw: its chunk's place, its form, its summer colour and
 *  how it follows the year, and what its record is written from — a
 *  canopy tree's placement, or a register tree's record. */
interface Crown {
  colour: Color;
  form: CanopyForm;
  placed?: Placement;
  season: CrownSeasonKey;
  stand?: Stand;
  x: number;
  z: number;
}

/** A canopy tree's crown, as the fine level's far tier draws it, wider: a
 *  pine's high on its stem (`pineBase`). */
function canopyCrown(p: Placement): Crown {
  const form = canopyForm(p);
  const colour = new Color();
  crownColor(colour, p, hash(p.x * 0.3 + p.z * 0.7) - 0.5);
  return {
    x: p.x,
    z: p.z,
    form,
    placed: form === "pine" ? { ...p, base: pineBase(p) } : p,
    colour,
    season: genericSeasonKey(p.x, p.z, p.evergreen),
  };
}

/** A register tree's crown: the lobed crown's box fitted to it whatever
 *  its silhouette, wider; a conifer's as the cone, a pine's as the pine's. */
function registerCrown(t: InventoryTree): Crown {
  const colour = new Color();
  // (its age leans the fine level's crown alone)
  inventoryColor(
    colour,
    { ...t, age: undefined },
    hash(t.x * 0.3 + t.z * 0.7) - 0.5
  );
  let form: CanopyForm = "broad";
  if (t.shape === "cone" || t.shape === "pine") {
    form = t.shape;
  }
  return {
    x: t.x,
    z: t.z,
    form,
    stand: registerCrownStand(t, broadCrownFit(), W),
    colour,
    season: {
      genus: t.genus,
      // (a copper or golden cultivar follows its genus's year)
      evergreen: t.leaf === "e" && t.colour === 0,
      jitter: t.jitter,
    },
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
  trees: CoarseTrees,
  ctx: CoarseCrownContext
): VegetationControl {
  return finished(coarseCrownSteps(trees, ctx));
}

/** `buildCoarseCrowns` in steps: per cell (build-steps.ts).
 *  @yields {void} after each cell */
export function* coarseCrownSteps(
  trees: CoarseTrees,
  ctx: CoarseCrownContext
): Steps<VegetationControl> {
  const group = new Group();
  group.name = "coarse-crowns";
  const mats = sceneCrowns(ctx.sunDirection);
  // The far tier's lobed crown one subdivision coarser — a few pixels
  // across wherever the coarse level shows —, and the conifers' cone of one
  // skirt; each the tile's own: freeing a set frees the geometry it views.
  const geo = buildCrownGeo(0);
  const forms: Partial<Record<CanopyForm, BufferGeometry>> = { broad: geo };
  const geoOf = (form: CanopyForm): BufferGeometry => {
    forms[form] ??=
      form === "pine" ? padCrownSphere(buildPineGeo(geo)) : coarseCone();
    return forms[form];
  };
  const crowns = [
    ...trees.trees.map(canopyCrown),
    ...trees.register.map(registerCrown),
  ];
  yield;
  const seasons: SeasonalCrowns[] = [];
  for (const cell of bucketByCell(crowns)) {
    for (const form of ["broad", "cone", "pine"] as const) {
      const list = cell.filter((c) => c.form === form);
      if (list.length === 0) {
        continue;
      }
      // the canopy's crowns, then the register's: one table, in the
      // order the colours and the season keys go
      const canopy = list.filter((c) => c.placed);
      const surveyed = list.filter((c) => c.stand);
      const ordered = [...canopy, ...surveyed];
      const { origin, words } = placementRecords(
        canopy.flatMap((c) => (c.placed ? [c.placed] : [])),
        W,
        surveyed.flatMap((c) => (c.stand ? [c.stand] : []))
      );
      const set = Instances.ofStands(
        geoOf(form),
        mats.leafy,
        standTable(words, origin)
      );
      set.castShadow = true;
      set.receiveShadow = true;
      // a cone or a pine keeps its form in a styled frame, as on the fine
      // level
      if (form === "broad") {
        set.userData.styleCrown = "far";
      }
      for (const [i, c] of ordered.entries()) {
        set.setColorAt(i, c.colour);
      }
      set.computeBoundingSphere();
      group.add(set);
      seasons.push(
        seasonCrowns(
          { mid: set, rich: set },
          ordered.map((c) => c.season),
          mats
        )
      );
    }
    yield;
  }
  return {
    group,
    chunks: [],
    setSeason: (day) => applySeasons(seasons, day),
  };
}
