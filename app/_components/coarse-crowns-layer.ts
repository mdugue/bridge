import {
  Color,
  Group,
  Matrix4,
  type Object3D,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { CoarseCrown } from "@/lib/city/coarse-crowns";
import type { RecenterOffset } from "@/lib/city/ground-clamp";
import { bucketByCell, hash } from "@/lib/city/tree-placement";
import type { CrownSeasonKey, SeasonalCrowns } from "./crown-season";
import { seasonCrowns } from "./crown-season";
import { Instances } from "./instancing";
import { compileRepresentatives, estimateGeometryBytes } from "./three-utils";
import { inventoryColor, registerCrownMatrix } from "./tree-inventory-layer";
import {
  applySeasons,
  buildCrownGeo,
  crownColor,
  genericSeasonKey,
  sceneCrowns,
  type SceneCrowns,
  type VegetationControl,
} from "./vegetation-layer";

/**
 * The crowns a small-scale Modell picture keeps on the coarse terrain
 * level (lib/city/coarse-crowns.ts). The fine level carries the trees and
 * gives way at 2.5 m/px; past it a plan still shows its trees, generalized
 * — so the coarse level draws the very crowns the fine level shows at the
 * floor of Modell's selection, where it stood them, in its colours and
 * season. They are fetched and built only once Modell thins the trees
 * (a share below 1): on foot and in the air nothing loads; then they are
 * compiled hanging where they will hang, and shown while the share stays
 * below 1. The crown materials and their uniforms are the scene's
 * (sceneCrowns), so the selection, the spread, the wind and the look reach
 * them as every other crown.
 */
export interface CoarseCrownContext {
  /** compiles an object's shaders before it shows (PostStack.compile) */
  compile: (object: Object3D) => Promise<void>;
  /** the coarse ground the crowns stand on (EPSG) */
  heightAt: (x: number, y: number) => number | null;
  offset: RecenterOffset;
  /** content landed: the stream redraws its shadows and its census */
  onChange: () => void;
  /** the current day of the year (lib/city/tree-season.ts) */
  season: () => number;
  sunDirection?: Vector3;
}

const Y_AXIS = new Vector3(0, 1, 0);
const position = new Vector3();
const turn = new Quaternion();
const scale = new Vector3();

/** One crown's matrix, as the fine level's far tier writes it. */
function crownMatrix(c: CoarseCrown, ground: number, out: Matrix4): Matrix4 {
  if (c.kind === "register") {
    return out.copy(
      registerCrownMatrix({ ext: c.ext, ground, rot: c.rot, x: c.x, z: c.z })
    );
  }
  return out.compose(
    position.set(c.x, ground, c.z),
    turn.setFromAxisAngle(Y_AXIS, c.rot),
    scale.set(c.s * c.widen, c.s, c.s * c.widen)
  );
}

/** One crown's colour, as the fine level paints it. */
function paintCrown(c: CoarseCrown, ground: number, col: Color): void {
  const v = hash(c.x * 0.3 + c.z * 0.7) - 0.5;
  if (c.kind === "canopy") {
    crownColor(
      col,
      { x: c.x, y: ground, z: c.z, rot: c.rot, s: c.s, ndvi: c.ndvi },
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

/** The crowns, one set per vegetation chunk (each culls on its own). */
function buildSets(
  crowns: CoarseCrown[],
  ctx: CoarseCrownContext,
  mats: SceneCrowns
): { meshes: Instances[]; seasons: SeasonalCrowns[] } {
  // The far tier's lobed crown one subdivision coarser — a few pixels
  // across at the scales it shows. The tile's own: freeing a set frees
  // the geometry it views.
  const geo = buildCrownGeo(0);
  const { cx, cy } = ctx.offset;
  const standing = crowns.flatMap((c) => {
    const ground = ctx.heightAt(c.x + cx, cy - c.z);
    return ground === null ? [] : [{ ...c, ground }];
  });
  const meshes: Instances[] = [];
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
    meshes.push(set);
    seasons.push(
      seasonCrowns({ mid: set, rich: set }, cell.map(seasonKey), mats)
    );
  }
  return { meshes, seasons };
}

/**
 * A coarse tile's crowns as a vegetation control: an empty group until
 * Modell first thins the trees, then `load`'s crowns, built and compiled.
 */
export function buildCoarseCrowns(
  load: (signal: AbortSignal) => Promise<CoarseCrown[]>,
  ctx: CoarseCrownContext
): VegetationControl {
  const group = new Group();
  group.name = "coarse-crowns";
  group.visible = false;
  const mats = sceneCrowns(ctx.sunDirection);
  const u = mats.uniforms;
  const aborter = new AbortController();
  let seasons: SeasonalCrowns[] = [];
  let started = false;
  let disposed = false;
  let bytes = 0;

  const start = async (): Promise<void> => {
    const crowns = await load(aborter.signal);
    if (disposed || crowns.length === 0) {
      return;
    }
    const built = buildSets(crowns, ctx, mats);
    applySeasons(built.seasons, ctx.season());
    // hanging where they will hang, hidden until compiled
    for (const mesh of built.meshes) {
      mesh.visible = false;
    }
    group.add(...built.meshes);
    await Promise.all(
      compileRepresentatives(built.meshes).map((o) => ctx.compile(o))
    );
    if (disposed) {
      // the dressing went while these compiled, and freed them with its
      // parts (they hung in the group by then)
      return;
    }
    seasons = built.seasons;
    bytes = estimateGeometryBytes(group);
    // whatever day it became meanwhile
    applySeasons(seasons, ctx.season());
    for (const mesh of built.meshes) {
      mesh.visible = true;
    }
    ctx.onChange();
  };

  return {
    group,
    chunks: [],
    // the crown uniforms are the scene's: the look reaches these through
    // whichever control wrote it
    applyLook: () => undefined,
    multiTuft: () => false,
    setTime: (seconds) => {
      u.time.value = seconds;
    },
    setTreeShare: (share) => {
      u.treeShare.value = share;
      group.visible = share < 1;
      if (share < 1 && !started) {
        started = true;
        start().catch(() => {
          // a tile whose crowns fail stays bare, never the stream stuck
        });
      }
    },
    setSeason: (day) => applySeasons(seasons, day),
    updateLod: () => false,
    lateBytes: () => bytes,
    dispose: () => {
      // what hangs in the group goes with the dressing's parts; a load in
      // flight stops here
      disposed = true;
      aborter.abort();
    },
  };
}
