/**
 * The inquiry card's "Darstellung" for a building (plan 052, the Daten
 * section): every value that decides how the asked building is drawn —
 * its storeys, its facade's material and colour, its windows, plinth and
 * cornices, doors, dormers and shopfronts, its roof's form and colour,
 * its light at dusk, its landmark — each with the source it came from,
 * how the viewer came by it (lib/city/methods.ts) and a link to the
 * source where one leads to the thing (the OSM objects at the place, the
 * street photos there, the Wikidata item). The values are what the bake
 * wrote: the object table's style columns (`ObjectLook`) and its record
 * of why (`drawn`, lib/city/drawn-facts.ts) — never recomputed here, so
 * the card says what the clay draws. No THREE, no DOM.
 */
import { BUILDING_FUNCTION } from "./adv-codes";
import { metres, whole } from "./card-lines";
import {
  hasObjectFlag,
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_GROUNDED,
  OBJECT_FLAG_LANDMARK,
  OBJECT_FLAG_METAL,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_FLAG_OWN_FACADE,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_DOOR,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_PLINTH,
  OBJECT_SOURCE_SHOPFRONT,
  type Rgb,
} from "./city-mesh";
import { utmToLatLng } from "./crs";
import { type DrawnFacts, decodeDrawn } from "./drawn-facts";
import { FACADE_UNIT } from "./facade-reading";
import {
  type BuildingInquiry,
  type InquiryObject,
  type ObjectLook,
  roofLabel,
} from "./inquiry";
import type { Method } from "./methods";
import { isMeasuredRoof, NO_FACT } from "./object-facts";
import type { SourceKey } from "./provenance";
import { unpackStyle, type WindowType, windowType } from "./windows";

/** Where a drawn value came from: a dataset of the manifest, the street
 *  photos, or the viewer itself. */
export type DrawnSource = SourceKey | "mapillary" | "viewer";

/** One drawn value. */
export interface DrawnRow {
  label: string;
  value: string;
  /** a colour (CSS) shown before the value */
  swatch?: string;
  method: Method;
  source: DrawnSource;
  /** what of the source: the tag, the rule ("building:material") */
  detail?: string;
  /** where the source shows this thing */
  url?: string;
}

export interface DrawnGroup {
  title: string;
  rows: DrawnRow[];
}

/** The card's short names of the sources (the list under the rows names
 *  each in full, with its edition and credit). */
export const DRAWN_SOURCE_NAME: Record<DrawnSource, string> = {
  lod2: "3D-Stadtmodell LoD2",
  lsc: "Laserscan",
  dgm: "Geländemodell DGM1",
  dom: "Oberflächenmodell DOM1",
  dop: "Orthophoto",
  dlm: "Basis-DLM",
  osm: "OpenStreetMap",
  trees: "Stadtbaumkataster",
  wikidata: "Wikidata",
  mapillary: "Mapillary",
  viewer: "Im Viewer",
};

const MATERIAL: Record<string, string> = {
  brick: "Ziegel",
  concrete: "Beton",
  glass: "Glas",
  metal: "Metall",
  plaster: "Putz",
  stone: "Naturstein",
  wood: "Holz",
};

const TYPE: Record<WindowType, string> = {
  tall: "Stadthaus mit hohen Geschossen",
  storey: "Mehrfamilienhaus",
  house: "kleines Haus",
  block: "Block mit Flachdach",
  low: "Flachbau",
  palace: "Schloss, Museum oder Amtsgebäude",
};

const decimal = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A linear-RGB colour as CSS hex (sRGB). */
export function cssColour([r, g, b]: Rgb): string {
  const channel = (c: number) => {
    const v = c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** The links to a place: OSM's objects there, the street photos there. */
interface Places {
  osm?: string;
  photos?: string;
}

function placesAt(at: [number, number] | undefined, epsg?: number): Places {
  const ll = at && epsg ? utmToLatLng(epsg, at[0], at[1]) : null;
  if (!ll) {
    return {};
  }
  const lat = ll.lat.toFixed(6);
  const lng = ll.lng.toFixed(6);
  return {
    osm: `https://www.openstreetmap.org/query?lat=${lat}&lon=${lng}#map=19/${lat}/${lng}`,
    photos: `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=19`,
  };
}

/** The object whose look the card describes: the picked one if it is a
 *  LoD2 object, else (a door, a shopfront, a dormer, a plinth: they copy
 *  their host's row) the tree's LoD2 object that carries windows, or its
 *  first. */
function describedObject(b: BuildingInquiry): InquiryObject {
  const lod2 = (o: InquiryObject) => o.source === OBJECT_SOURCE_LOD2;
  if (lod2(b.picked)) {
    return b.picked;
  }
  return (
    b.tree.find((o) => lod2(o) && (o.look?.windows.axis ?? 0) > 0) ??
    b.tree.find(lod2) ??
    b.picked
  );
}

/** A Gebäudefunktion's words, or "". */
const functionWords = (code: string) =>
  code ? (BUILDING_FUNCTION[code] ?? "") : "";

/** Builds the rows. */
class Rows {
  readonly groups: DrawnGroup[] = [];
  private current: DrawnRow[] = [];

  group(title: string): void {
    this.current = [];
    this.groups.push({ title, rows: this.current });
  }

  row(r: DrawnRow | null | false): void {
    if (r) {
      this.current.push(r);
    }
  }

  /** The groups with rows. */
  done(): DrawnGroup[] {
    return this.groups.filter((g) => g.rows.length > 0);
  }
}

/**
 * The drawn values of the asked building: the object the question met
 * (`describedObject`) for its walls, storeys and windows, the whole tree
 * for the parts on its walls and roof. `epsg` is the site's CRS, for the
 * links to the place. Empty for a building the scene gave no look (a
 * tile baked before the look reached the card).
 */
export function drawnGroups(b: BuildingInquiry, epsg?: number): DrawnGroup[] {
  const o = describedObject(b);
  const look = o.look;
  // a scan's building or a gap filler has no LoD2 row to read
  if (!look || o.source !== OBJECT_SOURCE_LOD2) {
    return [];
  }
  const d = decodeDrawn(o.facts.drawn);
  const places = placesAt(b.at, epsg);
  const all = b.tree.length > 0 ? b.tree : [b.picked];
  const has = (source: number) => all.some((x) => x.source === source);
  const rows = new Rows();

  rows.group("Form");
  rows.row(heightRow(o, all.length > 1));
  rows.row({
    label: "Traufe",
    value: metres(o.eaveH),
    method: "computed",
    source: "lod2",
    detail: "unterster Punkt der Dachflächen",
  });
  rows.row(roofFormRow(o));
  rows.row(storeyRow(o, look, d, places));

  rows.group("Fassade");
  rows.row(materialRow(o, d, places));
  rows.row(wallColourRow(o, look, d, places));
  rows.row(windowsRow(o, look, d, places));
  rows.row(plinthRow(o, has(OBJECT_SOURCE_PLINTH), d));
  rows.row(
    has(OBJECT_SOURCE_DOOR) && {
      label: "Haustüren",
      value: "gezeichnet",
      method: "taken",
      source: "osm",
      detail: "Eingänge (entrance=*)",
      url: places.osm,
    }
  );
  rows.row(shopRow(o, has(OBJECT_SOURCE_SHOPFRONT), places));
  rows.row(readingRow(o, places));

  rows.group("Dach");
  rows.row(roofColourRow(look, d, places));
  rows.row(
    has(OBJECT_SOURCE_DORMER) && {
      label: "Gauben",
      value: "gezeichnet",
      method: "detected",
      source: "dom",
      detail: "über dem Dach des Stadtmodells gemessen",
    }
  );

  rows.group("Licht und Rang");
  rows.row({
    label: "Abendlicht",
    value: look.glow ? "warm erleuchtet" : "dunkel",
    method: "taken",
    source: "lod2",
    detail: functionWords(o.facts.function)
      ? `Nutzung: ${functionWords(o.facts.function)}`
      : "keine Nutzung angegeben",
  });
  rows.row(
    d.wikidata
      ? {
          label: "Wahrzeichen",
          value: d.wikidata,
          method: "detected",
          source: "wikidata",
          detail: "dem Stadtmodell zugeordnet",
          url: `https://www.wikidata.org/wiki/${d.wikidata}`,
        }
      : null
  );
  rows.row({
    label: "Himmelslicht",
    value: "Horizont und offener Himmel",
    method: "computed",
    source: "dgm",
    detail: "mit dem Stadtmodell berechnet",
  });
  rows.row({
    label: "Licht, Schatten",
    value: "zur Uhrzeit der Szene",
    method: "computed",
    source: "viewer",
    detail: "Sonnenstand am Ort",
  });
  return rows.done();
}

/** The described object's own height: a part's runs from its own foot
 *  (the Frauenkirche's lantern stands 40 m up), so it says so. */
function heightRow(o: InquiryObject, part: boolean): DrawnRow | null {
  if (o.facts.height === NO_FACT) {
    return null;
  }
  const rebuilt = isMeasuredRoof(o.facts.roofType);
  return {
    label: part ? "Höhe des Teils" : "Höhe",
    value: metres(o.facts.height),
    method: rebuilt ? "detected" : "taken",
    source: rebuilt ? "dom" : "lod2",
    detail: rebuilt ? "Dach neu gemessen" : "measuredHeight",
  };
}

function roofFormRow(o: InquiryObject): DrawnRow | null {
  const code = o.facts.roofType;
  const value = roofLabel(code, o.facts.roofPitch);
  if (!value) {
    return null;
  }
  return isMeasuredRoof(code)
    ? {
        label: "Dachform",
        value,
        method: "detected",
        source: "dom",
        detail: "das Stadtmodell verfehlt dieses Dach",
      }
    : {
        label: "Dachform",
        value,
        method: "taken",
        source: "lod2",
        detail: "roofType, Dachneigung",
      };
}

function storeyRow(
  o: InquiryObject,
  look: ObjectLook,
  d: DrawnFacts,
  places: Places
): DrawnRow | null {
  if (!(look.storeyH > 0 && o.eaveH > 0)) {
    return null;
  }
  // an own facade draws no storey lines (#170)
  if (d.own) {
    return {
      label: "Geschosse",
      value: "keine Geschosslinien",
      ...ownFacadeWhy(o, d, places),
    };
  }
  const n = Math.max(1, Math.round(o.eaveH / look.storeyH));
  const value = `${whole.format(n)} × ${metres(look.storeyH)}`;
  const from =
    d.storey ?? (o.facts.levels === NO_FACT ? "height" : ("osm" as const));
  switch (from) {
    case "osm":
      return {
        label: "Geschosse",
        value,
        method: "taken",
        source: "osm",
        detail:
          o.facts.levels === NO_FACT
            ? "building:levels"
            : `building:levels = ${whole.format(o.facts.levels)}`,
        url: places.osm,
      };
    case "photos":
      return {
        label: "Geschosse",
        value,
        method: "detected",
        source: "mapillary",
        detail: "Geschosshöhe in Straßenfotos gemessen",
        url: places.photos,
      };
    case "height":
      return {
        label: "Geschosse",
        value,
        method: "assumed",
        source: "viewer",
        ...unusedLevels(o, places),
      };
  }
}

/** Why a storey count OSM maps was not drawn: its storeys would be
 *  lower or higher than a storey can be (`countsStoreys`). */
function unusedLevels(
  o: InquiryObject,
  places: Places
): Pick<DrawnRow, "detail" | "url"> {
  if (o.facts.levels === NO_FACT || o.facts.levels < 1) {
    return { detail: "aus der Höhe geschätzt" };
  }
  const each = metres(o.eaveH / o.facts.levels);
  return {
    detail: `aus der Höhe geschätzt: building:levels = ${whole.format(o.facts.levels)} ergäbe ${each} je Geschoss, außerhalb von 2,4 bis 5,5 m`,
    url: places.osm,
  };
}

function materialRow(
  o: InquiryObject,
  d: DrawnFacts,
  places: Places
): DrawnRow {
  if (d.material) {
    const wikidata = d.materialFrom === "wikidata";
    return {
      label: "Material",
      value: MATERIAL[d.material] ?? d.material,
      method: "taken",
      source: wikidata ? "wikidata" : "osm",
      detail: wikidata ? "Material (P186)" : "building:material",
      url: wikidata
        ? d.wikidata && `https://www.wikidata.org/wiki/${d.wikidata}`
        : places.osm,
    };
  }
  if (hasObjectFlag(o.flags, OBJECT_FLAG_GLASS)) {
    return {
      label: "Material",
      value: "Glas",
      method: "taken",
      source: "osm",
      detail: "building:material",
      url: places.osm,
    };
  }
  return d.wall === "brick"
    ? {
        label: "Material",
        value: "Ziegel, wie die Nachbarschaft",
        method: "assumed",
        source: "osm",
        detail: "Wände der Häuser ringsum",
      }
    : {
        label: "Material",
        value: "Putz",
        method: "assumed",
        source: "viewer",
        detail: "nichts kartiert: die Vorgabe",
      };
}

function wallColourRow(
  o: InquiryObject,
  look: ObjectLook,
  d: DrawnFacts,
  places: Places
): DrawnRow {
  const swatch = cssColour(look.tint);
  const base = { label: "Wandfarbe", value: swatch, swatch };
  if (d.wall === "osm") {
    return {
      ...base,
      method: "computed",
      source: "osm",
      detail: `building:colour = ${d.colour ?? "?"}, aufgehellt`,
      url: places.osm,
    };
  }
  const use = functionWords(o.facts.function);
  const detail =
    d.wall === "material"
      ? `Palette für ${MATERIAL[d.material ?? ""] ?? "das Material"}, je Haus gestreut`
      : d.wall === "brick"
        ? "Ziegelpalette der Nachbarschaft, je Haus gestreut"
        : `Palette nach Nutzung${use ? ` (${use})` : ""}, je Haus gestreut`;
  return { ...base, method: "assumed", source: "viewer", detail };
}

/** What the windows look like, in words. */
function windowValue(look: ObjectLook): string {
  const { axis, w, h, style } = look.windows;
  const s = unpackStyle(style);
  return [
    `Achsen ${metres(axis)}, Fenster ${decimal.format(w)} × ${decimal.format(h)} m`,
    s.frame ? "Faschen" : "",
    s.lintel ? "Verdachungen" : "",
    s.loose ? "lockeres Raster" : "",
    s.noGround ? "keine im Erdgeschoss" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function windowsRow(
  o: InquiryObject,
  look: ObjectLook,
  d: DrawnFacts,
  places: Places
): DrawnRow {
  if (look.windows.axis > 0) {
    return windowsFrom(o, look, d, places);
  }
  const base = { label: "Fenster", value: "keine" };
  const use = functionWords(o.facts.function);
  switch (d.noWindows) {
    case "facade":
      return { ...base, ...ownFacadeWhy(o, d, places) };
    case "low":
      return {
        ...base,
        method: "computed",
        source: "lod2",
        detail: "weniger als 3,2 m Wand",
      };
    case "use":
      return {
        ...base,
        method: "taken",
        source: "lod2",
        detail: `Nutzung ohne Fenster${use ? `: ${use}` : ""}`,
      };
    case "small":
      return {
        ...base,
        method: "computed",
        source: "viewer",
        detail: "kein Fenster passt ins Geschoss",
      };
    case "beyond":
    case undefined:
      return {
        ...base,
        method: "assumed",
        source: "viewer",
        detail: "keine Angabe im Kachelstand",
      };
  }
}

/** Why a landmark without a reason of its own keeps its facade: Wikidata
 *  named it, or (a tile baked before the drawn facts) only the flag says
 *  so. */
function landmarkWhy(
  o: InquiryObject,
  d: DrawnFacts
): Pick<DrawnRow, "detail" | "method" | "source" | "url"> {
  if (d.wikidata) {
    return {
      method: "detected",
      source: "wikidata",
      detail: "Wahrzeichen: eigene Fassade",
      url: `https://www.wikidata.org/wiki/${d.wikidata}`,
    };
  }
  return o.facts.drawn
    ? {
        method: "assumed",
        source: "viewer",
        detail: "Wahrzeichen: eigene Fassade",
      }
    : {
        method: "taken",
        source: "lod2",
        detail: "eigene Fassade",
      };
}

/** Why a facade is its own (no windows, no town house's dressing). */
function ownFacadeWhy(
  o: InquiryObject,
  d: DrawnFacts,
  places: Places
): Pick<DrawnRow, "detail" | "method" | "source" | "url"> {
  const use = functionWords(o.facts.function);
  if (d.own === "use") {
    return {
      method: "taken",
      source: "lod2",
      detail: `eigene Fassade: ${use || "monumentale Nutzung"}`,
    };
  }
  if (!d.own && hasObjectFlag(o.flags, OBJECT_FLAG_LANDMARK)) {
    return landmarkWhy(o, d);
  }
  if (d.own === "listed") {
    return {
      method: "assumed",
      source: "osm",
      detail: `Baudenkmal (${use || "öffentlich"}) ohne Geschosszahl: eigene Fassade`,
      url: places.osm,
    };
  }
  if (d.own === "part") {
    return {
      method: "computed",
      source: "osm",
      detail:
        "die Geschosszahl des Gebäudes passt nicht zu diesem Teil: Fassade des Gebäudes",
      url: places.osm,
    };
  }
  if (d.own === "hall") {
    return {
      method: "computed",
      source: "osm",
      detail: "Geschosse über 5,5 m hoch: eine Halle",
      url: places.osm,
    };
  }
  if (hasObjectFlag(o.flags, OBJECT_FLAG_GLASS)) {
    return {
      method: "taken",
      source: "osm",
      detail: "Glasfassade (building:material)",
      url: places.osm,
    };
  }
  if (hasObjectFlag(o.flags, OBJECT_FLAG_METAL)) {
    return {
      method: "taken",
      source: "osm",
      detail: "Metallfassade (building:material)",
      url: places.osm,
    };
  }
  return {
    method: "taken",
    source: "osm",
    detail: hasObjectFlag(o.flags, OBJECT_FLAG_OWN_COLOUR)
      ? "eigene Farbe"
      : "eigene Fassade",
    url: places.osm,
  };
}

function windowsFrom(
  o: InquiryObject,
  look: ObjectLook,
  d: DrawnFacts,
  places: Places
): DrawnRow {
  const base = { label: "Fenster", value: windowValue(look) };
  const style = unpackStyle(look.windows.style);
  const from =
    d.windows ?? (style.measured ? "measured" : style.near ? "near" : "type");
  switch (from) {
    case "measured":
      return {
        ...base,
        method: "detected",
        source: "mapillary",
        detail: "an den eigenen Wänden in Straßenfotos gemessen",
        url: places.photos,
      };
    case "tree":
      return {
        ...base,
        method: "detected",
        source: "mapillary",
        detail: "an einem anderen Teil des Gebäudes gemessen",
        url: places.photos,
      };
    case "near":
      return {
        ...base,
        method: "assumed",
        source: "mapillary",
        detail: "vom nächsten gemessenen Haus gleicher Art (bis 150 m)",
      };
    case "none":
    case "type": {
      // a facade of its own carries windows only as a palace's
      const type = hasObjectFlag(o.flags, OBJECT_FLAG_OWN_FACADE)
        ? "palace"
        : windowType(
            hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF),
            o.eaveH,
            look.storeyH
          );
      return {
        ...base,
        method: "assumed",
        source: "viewer",
        detail: `nichts gemessen: wie ein ${TYPE[type]}`,
      };
    }
  }
}

function plinthRow(
  o: InquiryObject,
  modelled: boolean,
  d: DrawnFacts
): DrawnRow | null {
  if (modelled) {
    return {
      label: "Sockel, Gesimse",
      value: "modelliert",
      method: "computed",
      source: "dgm",
      detail: "an der Straßenseite, mit dem Stadtmodell",
    };
  }
  if (!hasObjectFlag(o.flags, OBJECT_FLAG_GROUNDED)) {
    return null;
  }
  if (d.own) {
    return {
      label: "Sockel, Gesimse",
      value: "keine",
      method: "taken",
      source: "lod2",
      detail: "eigene Fassade",
    };
  }
  if (hasObjectFlag(o.flags, OBJECT_FLAG_LANDMARK)) {
    return { label: "Sockel, Gesimse", value: "keine", ...landmarkWhy(o, d) };
  }
  if (hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF)) {
    return {
      label: "Sockel, Gesimse",
      value: "keine",
      method: "computed",
      source: "lod2",
      detail: "Flachdach: ein Bau der Nachkriegszeit",
    };
  }
  return {
    label: "Sockel, Gesimse",
    value: "Sockel gemalt",
    method: "assumed",
    source: "viewer",
    detail: "keine Straßenseite gefunden",
  };
}

function shopRow(
  o: InquiryObject,
  fronts: boolean,
  places: Places
): DrawnRow | null {
  if (fronts) {
    return {
      label: "Schaufenster",
      value: "modelliert",
      method: "detected",
      source: "mapillary",
      detail: "in Straßenfotos erkannt, Vordächer im DOM1",
      url: places.photos,
    };
  }
  if (hasObjectFlag(o.flags, OBJECT_FLAG_SHOP)) {
    return {
      label: "Laden im Erdgeschoss",
      value: "dunklere Zone",
      method: "detected",
      source: "osm",
      detail: "Laden oder Lokal dem Grundriss zugeordnet",
      url: places.osm,
    };
  }
  return null;
}

const GRADE = ["", "wenig", "mittel", "viel"] as const;

/** What the street photos read on the facade (lib/city/facade-reading.ts,
 *  the flags' bits above the OSM ones). */
function readingRow(o: InquiryObject, places: Places): DrawnRow | null {
  const code = Math.floor(o.flags / FACADE_UNIT);
  const busy = code % 4;
  const dark = Math.floor(code / 4) % 4;
  if (busy === 0 && dark === 0) {
    return null;
  }
  return {
    label: "Fassadenbild",
    value: [
      busy ? `Gliederung ${GRADE[busy]}` : "",
      dark ? `dunkler: ${GRADE[dark]}` : "",
    ]
      .filter(Boolean)
      .join(", "),
    method: "detected",
    source: "mapillary",
    detail: "in Straßenfotos gelesen",
    url: places.photos,
  };
}

function roofColourRow(
  look: ObjectLook,
  d: DrawnFacts,
  places: Places
): DrawnRow {
  const swatch = cssColour(look.roof);
  const base = { label: "Dachfarbe", value: swatch, swatch };
  switch (d.roof) {
    case "dop":
      return {
        ...base,
        method: "computed",
        source: "dop",
        detail: "Median der Dachfläche im Luftbild",
      };
    case "osm":
      return {
        ...base,
        method: "computed",
        source: "osm",
        detail: `roof:colour = ${d.roofColour ?? "?"}`,
        url: places.osm,
      };
    case "palette":
    case undefined:
      return {
        ...base,
        method: "assumed",
        source: "viewer",
        detail: "Ziegel- oder Schieferpalette nach Dachform",
      };
  }
}
