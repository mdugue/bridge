import {
  Color,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import {
  attribute,
  float,
  fract,
  materialOpacity,
  smoothstep,
} from "three/tsl";
import type { LineNode } from "@/lib/city/line-nodes";
import { instancePosition } from "./instancing";
import type { LineLook } from "./line-looks";
import { mapFadeNode } from "./map-overlay";
import { plainMaterial } from "./rail-layer";
import type { F } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * The Elbe's landing stages, groynes and ferry lines (plan 031;
 * pipeline/bake/riverside.py, OSM, ODbL), baked into the fine terrain glTF
 * (lib/city/riverside-mesh.ts, scripts/bake-lines.ts, ADR 0029): this
 * gives those nodes their looks (`RIVERSIDE_LOOKS`) — timber piers on
 * piles, slate pontoon hulls under pale decks, the clay huts, the stone
 * groynes, and the ferry's faint dashed wake, a map element shown only
 * from the air (map-overlay.ts), never casting.
 */

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

/**
 * The wake's ink, one for the scene: unlit, fogged, never writing depth,
 * pulled in front of the water sheet. Its alpha is a dash every
 * `FERRY_DASH_M` along the route (the `wakeAlong` arc length, soft at the
 * dash's trailing end) at a faint 0.55, times the map fade — nothing on
 * foot, full from the air.
 */
function wakeMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("riverside-wake", () => {
    const m = new MeshBasicNodeMaterial({
      color: new Color(WAKE),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const along = attribute("wakeAlong", "float") as F;
    const dash = float(1).sub(
      smoothstep(0.5, 0.56, fract(along.div(FERRY_DASH_M)))
    );
    m.opacityNode = materialOpacity.mul(0.55).mul(dash).mul(mapFadeNode());
    return m;
  });
}

/** The piles' and posts' material (the instanced one as it was: it draws
 *  a merged mesh as it is, instancing.ts `instancePosition`). */
function columnMaterial(color: number): MeshStandardNodeMaterial {
  return sceneMaterial(`riverside-column:${color.toString(16)}`, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(color),
      roughness: 0.9,
    });
    m.positionNode = instancePosition();
    return m;
  });
}

/** A solid riverside part: the plain lit material of its colour, cast. */
const solid = (color: number): LineLook => ({
  material: () => plainMaterial(color),
  cast: true,
});

/** The baked riverside's nodes (lib/city/riverside-mesh.ts), as the layer
 *  drew them: their material and whether they cast. */
export const RIVERSIDE_LOOKS = {
  "riverside-pier": solid(TIMBER),
  "riverside-hull": solid(HULL),
  "riverside-pontoon-deck": solid(PONTOON_DECK),
  "riverside-hut": solid(HUT),
  "riverside-roof": solid(HUT_ROOF),
  "riverside-gangway": solid(TIMBER),
  "riverside-railing": solid(RAILING),
  "riverside-groyne": solid(GROYNE_STONE),
  "riverside-piles": { material: () => columnMaterial(PILE), cast: true },
  "riverside-posts": { material: () => columnMaterial(RAILING), cast: true },
  "riverside-ferry": {
    material: wakeMaterial,
    cast: false,
    receive: false,
    // over the water sheet
    renderOrder: 3,
  },
} as const satisfies Record<Extract<LineNode, `riverside-${string}`>, LineLook>;
