import type { Camera, Raycaster } from "three";
import type { Inquiry, InquiryObject } from "@/lib/city/inquiry";
import { type CityLayer, pickCityObject } from "./city-layer";

/**
 * The scene side of the "Befragen" mode (ADR 0035): asks the city what
 * stands under a screen point and marks it. Only buildings answer — a
 * click whose ray meets the ground first asks nothing, so a building behind
 * a hill cannot be picked through it. The mark (the clay's pencil hatch) is
 * the whole building tree, the same set demolish would take; it stays until
 * the next question or `clear`, and is dropped with the tile if the tile
 * unloads. The HUD owns the card; this module owns only the scene state.
 */
export interface InquiryProbe {
  /** asks at a screen point (NDC; the crosshair when omitted) */
  ask: (ndc?: { x: number; y: number }) => Inquiry | null;
  /** removes the mark */
  clear: () => void;
}

export function createInquiryProbe(deps: {
  camera: Camera;
  /** the city layers on screen now */
  cities: () => readonly CityLayer[];
  /** distance along the pick ray to the ground, or null within `far` */
  groundAlong: (raycaster: Raycaster, far: number) => number | null;
}): InquiryProbe {
  let marked: CityLayer | null = null;

  const clear = () => {
    // A tile that unloaded took its texture with it: never touch it again.
    if (marked && deps.cities().includes(marked)) {
      marked.mark(new Set());
    }
    marked = null;
  };

  const ask = (ndc?: { x: number; y: number }): Inquiry | null => {
    clear();
    const picked = pickCityObject(deps.camera, deps.cities(), ndc);
    if (!picked) {
      return null;
    }
    const ground = deps.groundAlong(picked.raycaster, picked.distance);
    if (ground !== null && ground < picked.distance) {
      return null;
    }
    const { layer, objectIndex } = picked;
    const { table } = layer;
    const tree: number[] = [];
    for (let i = 0; i < table.count; i++) {
      if (table.root[i] === table.root[objectIndex] && layer.alive[i] === 1) {
        tree.push(i);
      }
    }
    layer.mark(new Set(tree));
    marked = layer;
    const object = (i: number): InquiryObject => ({
      objectIndex: i,
      building: table.building[i] === 1,
      eaveH: table.eaveH[i],
      flags: table.flags[i],
      source: table.source[i],
      facts: layer.facts(i),
    });
    return {
      tile: layer.tile,
      picked: object(objectIndex),
      tree: tree.map(object),
    };
  };

  return { ask, clear };
}
