/**
 * A tile's OSM facts with its landmarks folded in (Wikidata's notable
 * buildings, pipeline/bake/landmarks.py): the tile bake and the windows
 * report build their table so. No THREE.
 */
import type { OsmBuildingLut } from "./city-mesh";
import type { LandmarkFile } from "./landmarks-file";

/**
 * The OSM facts per object with the tile's landmarks folded in: each of a
 * landmark's objects is marked, and takes the wall material Wikidata names
 * where OSM names none.
 */
export function withLandmarks(
  lut: OsmBuildingLut | undefined,
  file: LandmarkFile | undefined
): OsmBuildingLut | undefined {
  if (!file?.landmarks.length) {
    return lut;
  }
  const out: OsmBuildingLut = { ...lut };
  for (const lm of file.landmarks) {
    for (const id of lm.objects) {
      const own = out[id];
      out[id] = {
        ...own,
        landmark: 1,
        wikidata: lm.id,
        material: own?.material ?? lm.material,
        ...(!own?.material && lm.material
          ? { materialFrom: "wikidata" as const }
          : {}),
      };
    }
  }
  return out;
}
