/**
 * Mapillary's lamps and bins (pipeline/bake/mapillary.py) as the lamp and
 * furniture layers read them: the bake keeps them in their own file (CC
 * BY-SA, apart from OSM's ODbL files), the dressing stands them with OSM's,
 * each marked `src: "mly"` so its card names Mapillary. No THREE, no DOM.
 */

import type {
  FurnitureFeature,
  LampFeature,
  MapillaryFeature,
} from "./features";

/** The lamps and the furniture (bins) among Mapillary's objects. */
export function mapillaryParts(features: readonly MapillaryFeature[]): {
  furniture: FurnitureFeature[];
  lamps: LampFeature[];
} {
  const lamps: LampFeature[] = [];
  const furniture: FurnitureFeature[] = [];
  for (const f of features) {
    const kind = f.properties?.k;
    if (kind === "lamp") {
      lamps.push({ geometry: f.geometry, properties: { src: "mly" } });
    } else if (kind === "bin") {
      furniture.push({
        geometry: f.geometry,
        properties: { k: "bin", src: "mly" },
      });
    }
  }
  return { lamps, furniture };
}
