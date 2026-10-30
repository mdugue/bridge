/**
 * OSM-Lücken (docs/routines.md): what the twin's own data says OpenStreetMap
 * lacks, as tasks a mapper can take on — never an edit. Read from the
 * Stadtwissen (lib/city/stadtwissen.ts), which joins each LoD2 Building to
 * its OSM outline:
 *
 * - **Wahrzeichen ohne Namen** — a Wikidata landmark the bake matched to
 *   LoD2 Buildings, none of whose OSM outlines carries a name (a bridge
 *   is no building outline: left out).
 * - **Geschosse fehlen** — a named or addressed building at least
 *   MIN_LEVELS_HEIGHT_M tall whose outline has no `building:levels` (the
 *   viewer's storeys and windows then guess, ADR 0049); not a landmark's
 *   part, a church, a hall or a tower, whose storeys mean little.
 * - **Denkmal ohne Namen und Adresse** — a listed building (`heritage`)
 *   OSM neither names nor addresses.
 *
 * Each task is a point (WGS84) with what to check and links to the map
 * and the editor; the highest first, so a short list is the best one.
 * Pure: the script (`scripts/osm-gaps.ts`) reads the files and writes.
 */
import { utmToLatLng } from "./crs";
import type {
  StadtwissenIndex,
  WissenBuilding,
  WissenLandmark,
  WissenTile,
} from "./stadtwissen";

/** A building this tall without storeys is worth a mapper's look (m). */
export const MIN_LEVELS_HEIGHT_M = 8;

/** An official use whose storeys mean little (a nave, a hall, a tower). */
const NO_STOREYS_USE = /kirche|kapelle|turm|halle|bahnhof|stadion/i;
/** A name that says the same: it ends so ("Kreuzkirche", "Hausmannsturm"). */
const NO_STOREYS_NAME = /(kirche|kapelle|dom|turm|halle|bahnhof|stadion)$/i;

/** What Wikidata calls a structure OSM draws as no building outline. */
const NOT_A_BUILDING = /brücke|bridge|viadukt|steg\b/i;
/** A name that says so where Wikidata says nothing ("Albertbrücke"). */
const BRIDGE_NAME = /brücke$/i;

export type GapKind =
  | "wahrzeichen-ohne-name"
  | "geschosse-fehlen"
  | "denkmal-ohne-name";

export const GAP_KINDS: Record<
  GapKind,
  { title: string; instruction: string }
> = {
  "wahrzeichen-ohne-name": {
    title: "Wahrzeichen ohne Namen in OSM",
    instruction:
      "Das Gebäude ist ein Wahrzeichen mit Wikidata-Eintrag, aber sein OSM-Umriss trägt keinen Namen. Prüfen und name=* sowie wikidata=* am Gebäude ergänzen.",
  },
  "geschosse-fehlen": {
    title: "Geschosszahl fehlt",
    instruction:
      "Das Gebäude ist laut amtlichem 3D-Modell hoch, sein OSM-Umriss nennt aber keine Geschosse. Vor Ort oder aus Straßenfotos zählen und building:levels=* (und ggf. roof:levels=*) ergänzen.",
  },
  "denkmal-ohne-name": {
    title: "Baudenkmal ohne Namen und Adresse",
    instruction:
      "Das Gebäude ist in OSM als Denkmal markiert, hat aber weder Namen noch Adresse. Prüfen und addr:*, ggf. name=* ergänzen.",
  },
};

export interface GapTask {
  kind: GapKind;
  /** the LoD2 Building (or the landmark's Wikidata id) */
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** what ranks it: a landmark's articles, a building's height */
  weight: number;
}

function at(epsg: number, x: number, y: number) {
  const p = utmToLatLng(epsg, x, y);
  return p
    ? { lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lng * 1e6) / 1e6 }
    : null;
}

/** An AdV use that says nothing (ALKIS's "not to be specified"). */
const NO_USE = /nicht zu spezifizieren/i;

const describe = (b: WissenBuilding) =>
  b.name ??
  b.addr ??
  (b.use && !NO_USE.test(b.use)
    ? `${b.use} (ohne Namen)`
    : "Gebäude ohne Namen");

/** A landmark that is a bridge, not a building outline. */
function isBridge(lm: WissenLandmark): boolean {
  const kinds = (lm.facts?.claims.P31 ?? []).map((v) => v.v);
  return kinds.length > 0
    ? kinds.some((k) => NOT_A_BUILDING.test(k))
    : BRIDGE_NAME.test(lm.name);
}

/**
 * A landmark none of whose OSM outlines is named. Its buildings are those
 * the directory ties to it (`wd`, across tiles — its `objects` are often
 * BuildingParts, which the directory folds into their root) and its
 * `objects` the directory lists.
 */
function namelessLandmark(
  lm: WissenLandmark,
  byWd: ReadonlyMap<string, WissenBuilding[]>,
  byId: ReadonlyMap<string, WissenBuilding>
): boolean {
  if (isBridge(lm)) {
    return false;
  }
  const parts = [
    ...(byWd.get(lm.id) ?? []),
    ...lm.objects.flatMap((id) => byId.get(id) ?? []),
  ];
  return parts.length > 0 && parts.every((b) => b.name === undefined);
}

/** A building's own gap, if it has one. */
function buildingGap(b: WissenBuilding): GapKind | null {
  const known = b.name !== undefined || b.addr !== undefined;
  if (b.wd !== undefined) {
    // a landmark's part: its landmark is the task
    return null;
  }
  if (b.heritage && !known) {
    return "denkmal-ohne-name";
  }
  const storeysMatter =
    !NO_STOREYS_USE.test(b.use ?? "") && !NO_STOREYS_NAME.test(b.name ?? "");
  return known &&
    b.levels === undefined &&
    (b.h ?? 0) >= MIN_LEVELS_HEIGHT_M &&
    storeysMatter
    ? "geschosse-fehlen"
    : null;
}

/** Every gap the Stadtwissen shows, highest first within each kind. */
export function osmGaps(
  index: StadtwissenIndex,
  tiles: readonly WissenTile[]
): GapTask[] {
  // a building on a tile seam is in both tiles' directories: once here
  const byId = new Map(tiles.flatMap((t) => t.buildings).map((b) => [b.id, b]));
  const buildings = [...byId.values()];
  const byWd = new Map<string, WissenBuilding[]>();
  for (const b of buildings) {
    if (b.wd !== undefined) {
      byWd.set(b.wd, [...(byWd.get(b.wd) ?? []), b]);
    }
  }
  const tasks: GapTask[] = [];
  const push = (task: Omit<GapTask, "lat" | "lon">, x: number, y: number) => {
    const p = at(index.epsg, x, y);
    if (p) {
      tasks.push({ ...task, ...p });
    }
  };
  for (const lm of index.landmarks.filter((l) =>
    namelessLandmark(l, byWd, byId)
  )) {
    push(
      {
        kind: "wahrzeichen-ohne-name",
        id: lm.id,
        label: lm.name,
        weight: lm.links,
      },
      lm.x,
      lm.y
    );
  }
  for (const b of buildings) {
    const kind = buildingGap(b);
    if (kind) {
      push({ kind, id: b.id, label: describe(b), weight: b.h ?? 0 }, b.x, b.y);
    }
  }
  return tasks.sort(
    (a, b) => a.kind.localeCompare(b.kind) || b.weight - a.weight
  );
}

/** The OSM map and the iD editor at a task. */
export function osmLinks(task: Pick<GapTask, "lat" | "lon">): {
  karte: string;
  editor: string;
} {
  const map = `map=19/${task.lat}/${task.lon}`;
  return {
    karte: `https://www.openstreetmap.org/#${map}`,
    editor: `https://www.openstreetmap.org/edit?editor=id#${map}`,
  };
}

/**
 * One kind's tasks as GeoJSON, one Point per task with its instruction —
 * the shape MapRoulette takes for a challenge.
 */
export function gapsGeoJson(kind: GapKind, tasks: readonly GapTask[]) {
  return {
    type: "FeatureCollection" as const,
    features: tasks
      .filter((t) => t.kind === kind)
      .map((t) => ({
        type: "Feature" as const,
        id: t.id,
        geometry: { type: "Point" as const, coordinates: [t.lon, t.lat] },
        properties: {
          name: t.label,
          kennung: t.id,
          aufgabe: GAP_KINDS[kind].instruction,
          ...osmLinks(t),
          quelle:
            "Stadtmodell city walk: amtliches LoD2 (Höhe) und OpenStreetMap-Umrisse (Name, Adresse, Geschosse)",
        },
      })),
  };
}
