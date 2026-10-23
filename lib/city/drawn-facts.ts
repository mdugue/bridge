/**
 * How the bake drew one building, and from what: the decisions behind its
 * walls, roof, storeys and windows that the object table's style columns
 * carry only as their outcome (a colour, a storey height, a window
 * spec). The building bake records them per object as one code column
 * of the glTF's property table, `drawn` (scripts/bake-city-mesh.ts), next
 * to the facts (lib/city/object-facts.ts); the inquiry card reads them
 * when someone asks, to say which value came from which source
 * (lib/city/drawn-lines.ts). The code is a short `key=value;…` text: an
 * ENUM column keeps each distinct text once per tile. No THREE, no DOM.
 */
import type { RoofColourSource, WallColourSource } from "./building-tint";
import type { NoWindows, WindowSource } from "./windows";

export interface DrawnFacts {
  /** OSM's `building:colour` as mapped (`#rrggbb`) */
  colour?: string;
  /** the walls the neighbourhood is mapped as (OSM, `context`, or the
   *  tile's), where they decided the palette */
  context?: "brick" | "render";
  /** OSM's `building:material`, normalised (osm_buildings.py) */
  material?: string;
  /** the height is OSM's (its `height` or storeys), not the surface
   *  model's: a building LoD2 lacks that the model was flown before
   *  (pipeline/bake/structures.py) */
  height?: "osm";
  /** the material is Wikidata's (a landmark's), where OSM names none */
  materialFrom?: "wikidata";
  /** why the facade is its own: its use (ALKIS), a hall's storeys (OSM),
   *  a listed public building whose storeys OSM does not count, or its
   *  building's, whose storey count does not fit the part */
  own?: "hall" | "listed" | "part" | "use";
  /** where the roof's colour came from */
  roof?: RoofColourSource;
  /** OSM's `roof:colour` as mapped */
  roofColour?: string;
  /** where the storey height came from: OSM's count, the photos, the
   *  storeys of the mapped buildings around it, or the estimate from the
   *  height */
  storey?: "height" | "neighbours" | "osm" | "photos";
  /** where the wall colour came from */
  wall?: WallColourSource;
  /** the Wikidata item of the landmark the object belongs to */
  wikidata?: string;
  /** where the window rhythm came from (`tree`: another part's photos) */
  windows?: WindowSource;
  /** why there are none */
  noWindows?: NoWindows;
}

const KEYS = [
  "wall",
  "colour",
  "material",
  "materialFrom",
  "context",
  "roof",
  "roofColour",
  "storey",
  "windows",
  "noWindows",
  "own",
  "wikidata",
  "height",
] as const satisfies readonly (keyof DrawnFacts)[];

/** The column's text for one object ("" when nothing is known). */
export function encodeDrawn(d: DrawnFacts | undefined): string {
  if (!d) {
    return "";
  }
  return KEYS.flatMap((k) => (d[k] ? [`${k}=${d[k]}`] : [])).join(";");
}

/** One object's decisions from the column's text (unknown keys dropped). */
export function decodeDrawn(text: string): DrawnFacts {
  const out: Partial<Record<keyof DrawnFacts, string>> = {};
  for (const pair of text.split(";")) {
    const at = pair.indexOf("=");
    const key = pair.slice(0, at);
    const known = KEYS.find((k) => k === key);
    if (at > 0 && known) {
      out[known] = pair.slice(at + 1);
    }
  }
  // reason: the values are the bake's own codes (encodeDrawn)
  return out as DrawnFacts;
}
