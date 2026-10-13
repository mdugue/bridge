import { Color, type Group, MeshStandardNodeMaterial } from "three/webgpu";
import type { FurnitureFeature, TramFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { LANDCOVER_CLASSES, MEADOW_CLASS } from "@/lib/city/landcover";
import type { LineNode } from "@/lib/city/line-nodes";
import { buildFurniture } from "./furniture-layer";
import { instancePosition } from "./instancing";
import type { LineLook } from "./line-looks";
import { COLORS, plainMaterial } from "./rail-layer";
import { sceneMaterial } from "./three-utils";
import { TRAM_INK, wireMaterial } from "./wire-ribbons";

/**
 * Trams (pipeline/bake/tram.py, OSM, ODbL): the tracks in their bed, the
 * span decks, the overhead line and the masts are baked into the fine
 * terrain glTF (lib/city/tram-mesh.ts, scripts/bake-lines.ts, ADR 0029);
 * this gives those nodes their looks (`TRAM_LOOKS`) and stands the stops'
 * signs, which the fine terrain's extras carry with the inquiry's data.
 *
 * - Tracks: rail heads in a soft lavender-grey a shade under the road's;
 *   a lawn's strip in the ground's own meadow, ballast in the rail
 *   layer's.
 * - Overhead line: light and faint on purpose — a soft slate at under
 *   two-thirds opacity, like a pencil line on the watercolour, not ink
 *   (wire-ribbons.ts). Wires never cast (the shadow map stays as it was);
 *   only the masts do.
 * - Masts: a pale green-grey pole each.
 * - Stops: the bus stop's "H" sign (furniture-layer.ts, plan 030) on the
 *   platform of each tram stop the bake found one for.
 */

const MAST_COLOR = 0xb7_bc_b4; // pale green-grey
/** rail heads: the road's lavender-grey (200, 200, 206), a shade deeper */
const TRAM_RAIL = 0xa9_aa_b4;
/** the lawn under a *Rasengleis*: the ground's own meadow colour */
const MEADOW = (() => {
  const [r, g, b] = LANDCOVER_CLASSES.find((k) => k.id === MEADOW_CLASS)
    ?.srgb ?? [197, 211, 170];
  return (r << 16) | (g << 8) | b;
})();

/** The masts' material (the instanced one as it was: it draws a merged
 *  mesh as it is, instancing.ts `instancePosition`). */
function mastMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("tram-mast", () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(MAST_COLOR),
      roughness: 0.7,
      metalness: 0.2,
    });
    m.positionNode = instancePosition();
    return m;
  });
}

/** The baked trams' nodes (lib/city/tram-mesh.ts), as the layer drew
 *  them: their material and whether they cast. */
export const TRAM_LOOKS = {
  "tram-rails": {
    material: () =>
      plainMaterial(TRAM_RAIL, { offsetUnits: -1, roughness: 0.9 }),
    cast: false,
  },
  "tram-street-rails": {
    material: () =>
      plainMaterial(TRAM_RAIL, { offsetUnits: -2, roughness: 0.9 }),
    cast: false,
  },
  "tram-grass": {
    material: () => plainMaterial(MEADOW, { offsetUnits: -1, roughness: 0.9 }),
    cast: false,
  },
  "tram-ballast": {
    material: () =>
      plainMaterial(COLORS.ballast, { offsetUnits: -1, roughness: 0.9 }),
    cast: false,
  },
  "tram-span-top": {
    material: () => plainMaterial(COLORS.deckRoad),
    cast: true,
  },
  "tram-span-stone": {
    material: () => plainMaterial(COLORS.deckStone),
    cast: true,
  },
  "tram-masts": { material: mastMaterial, cast: true },
  "tram-wires": {
    material: () => wireMaterial(TRAM_INK),
    cast: false,
    receive: false,
  },
} as const satisfies Record<Extract<LineNode, `tram-${string}`>, LineLook>;

/** The tram stops' signs (the fine terrain's extras carry the stops): the
 *  furniture layer's stop model and instancing. Null when there is none. */
export function buildTramStops(
  stops: readonly TramFeature[],
  ctx: GroundContext
): Group | null {
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
  group.name = "tram";
  return group;
}
