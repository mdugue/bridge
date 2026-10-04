/**
 * A city's landmarks (pipeline/bake/landmarks.py: Wikidata's notable
 * buildings and structures, matched to the LoD2 objects that draw them):
 * the per-tile file the build reads, the site-wide list the tileset
 * carries for the HUD, and the vantage the HUD glides to. No THREE, no DOM.
 */
import { overlook, type ViewpointGeometry } from "./site";

/** One landmark as the bake writes it (`landmarks_<tile>.json`). */
export interface LandmarkEntry {
  /** drawn height above `z` (m), the LoD2 objects' top */
  h?: number;
  /** Wikidata's height (m), when it has one */
  height?: number;
  /** Wikidata item id (Q…) */
  id: string;
  /** Wikipedia articles about it: how notable it is */
  links: number;
  /** a wall material (glass, brick, …) Wikidata names for it */
  material?: string;
  name: string;
  /** the LoD2 CityObject ids that are the landmark */
  objects: string[];
  /** where Wikidata places it, in the site's projected CRS */
  x: number;
  y: number;
  /** the ground under its objects (m) */
  z?: number;
}

export interface LandmarkFile {
  attribution?: string;
  landmarks: LandmarkEntry[];
}

/** A landmark as the tileset carries it for the HUD. */
export interface Landmark {
  /** the less notable landmarks housed in its building (their names) */
  also?: string[];
  /** its height above ground (m) */
  h: number;
  id: string;
  links: number;
  name: string;
  x: number;
  y: number;
}

/** How many landmarks the HUD lists: the site's most notable. */
export const SITE_LANDMARKS = 12;
/** A landmark without a known height is framed as if it had this one. */
const DEFAULT_HEIGHT_M = 25;

/**
 * The site's landmarks from its tiles' files: one per Wikidata item (a
 * landmark on a seam is in one file only, the bake owns it by its point),
 * the most notable first, and one per building drawn — an institution
 * housed in a more notable landmark's building (the Rüstkammer in the
 * Residenzschloss, the Galerie Neue Meister in the Albertinum) shares its
 * LoD2 objects and is that landmark on the map. Its height is the taller
 * of what is drawn and what Wikidata says (a spire the LoD2 cut short
 * still frames right).
 */
export function siteLandmarks(
  files: readonly LandmarkFile[],
  limit: number = SITE_LANDMARKS
): Landmark[] {
  const byId = new Map<string, LandmarkEntry>();
  for (const file of files) {
    for (const e of file.landmarks) {
      if (!byId.has(e.id)) {
        byId.set(e.id, e);
      }
    }
  }
  /** which kept landmark draws a LoD2 object */
  const drawn = new Map<string, Landmark>();
  const out: Landmark[] = [];
  const ranked = [...byId.values()].sort(
    (a, b) => b.links - a.links || a.name.localeCompare(b.name)
  );
  for (const e of ranked) {
    // past the limit only to name what the kept ones house
    const host = e.objects.map((o) => drawn.get(o)).find((l) => l);
    if (host) {
      host.also = [...(host.also ?? []), e.name];
      continue;
    }
    if (out.length >= limit) {
      continue;
    }
    const lm: Landmark = {
      h: Math.max(e.h ?? 0, e.height ?? 0) || DEFAULT_HEIGHT_M,
      id: e.id,
      links: e.links,
      name: e.name,
      x: e.x,
      y: e.y,
    };
    for (const o of e.objects) {
      drawn.set(o, lm);
    }
    out.push(lm);
  }
  return out;
}

/** The side a vantage looks from: from the south-south-west (the sun's
 *  side for most of the day), so the landmark is seen lit. */
const LOOK_TOWARD_DEG = 25;
/** How steeply it looks down (degrees below the horizon). */
const LOOK_DOWN_DEG = -22;

/**
 * An aerial vantage on a landmark, framed like the sites' authored
 * overlooks (`overlook`): from the south-south-west, a little above its
 * top — the camera rises with the landmark (60–300 m, 50 m over its top)
 * and stands back so its foot sits under the crosshair, the whole of it
 * in frame.
 */
export function landmarkVantage(lm: Landmark): ViewpointGeometry {
  const { aboveGround, epsg, fov, headingDeg, mode, pitchDeg } = overlook(lm, {
    altitude: Math.min(Math.max(lm.h + 50, 60), 300),
    description: lm.name,
    fov: 55,
    headingDeg: LOOK_TOWARD_DEG,
    id: lm.id,
    label: lm.name,
    pitchDeg: LOOK_DOWN_DEG,
  });
  return { aboveGround, epsg, fov, headingDeg, mode, pitchDeg };
}
