/**
 * The inquiry card's "Daten" section (plan 052), its second half: what the
 * thing as drawn is made of — the datasets that gave it its form, its
 * colour, its place and its light, each with what it gave, its edition and
 * its credit, and what the viewer worked out itself. The facts the card
 * states are quoted by the card's own source lines (`InquiryCard.sources`),
 * the section's first half. The card loads this module when the section is first
 * opened (a dynamic import, its own chunk), so the boot carries none of
 * it. Facts per object are what the object carries (its property-table
 * flags, the feature's properties); what holds for every thing of a kind
 * says so ("wo …"), never claiming a source an object did not use. No
 * THREE, no DOM.
 */
import {
  hasObjectFlag,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_LANDMARK,
  OBJECT_FLAG_METAL,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_SCAN,
} from "./city-mesh";
import { germanDates } from "./card-lines";
import type { BuildingInquiry, Inquiry } from "./inquiry";
import type {
  BridgeInquiry,
  MonumentInquiry,
  TreeInquiry,
} from "./inquiry-features";
import type { CanopyInquiry, MoreInquiry } from "./inquiry-more";
import type { BikeInquiry, TrafficInquiry } from "./inquiry-traffic";
import { isMeasuredRoof, type ObjectFacts } from "./object-facts";
import {
  type OsmProduct,
  parseLod2Stand,
  type SiteProvenance,
  type SourceKey,
} from "./provenance";
import type { Provider } from "./site";

/** One dataset behind the asked thing. */
export interface LineageEntry {
  /** what the viewer took from it for this thing, in reading order */
  used: string[];
  /** the dataset, as the card names it */
  source: string;
  /** its edition for this thing's tile ("" when none is known) */
  stand: string;
  /** its credit line ("" for the viewer's own work) */
  credit: string;
  /** where a person finds the dataset (or this thing in it) */
  url?: string;
  /** how the viewer came by it: read as published, measured from it in
   *  the bake, or worked out in the viewer */
  how: "gelesen" | "gemessen" | "berechnet";
}

/** What the lineage needs of the site beyond the manifest. */
export interface LineageSite {
  provider: Pick<Provider, "credit" | "portal" | "products">;
}

const OSM_URL = "https://www.openstreetmap.org/copyright";
const WIKIDATA_URL = "https://www.wikidata.org/wiki/";

const FALLBACK: Record<SourceKey, string> = {
  lod2: "3D-Stadtmodell LoD2",
  lsc: "Laserscan",
  dgm: "Digitales Geländemodell DGM1",
  dom: "Digitales Oberflächenmodell DOM1",
  dop: "Digitales Orthophoto",
  dlm: "Basis-DLM",
  osm: "OpenStreetMap",
  trees: "Stadtbaumkataster",
  wikidata: "Wikidata",
};

/** The surveying office's own products (its credit, its portal). */
const OFFICIAL: ReadonlySet<SourceKey> = new Set([
  "lod2",
  "lsc",
  "dgm",
  "dom",
  "dop",
  "dlm",
]);

/** What a source gave, a line per item; a falsy item is left out. */
type Said = readonly (string | false | null | undefined | 0)[];

const spoken = (used: Said): string[] =>
  used.filter((u): u is string => typeof u === "string" && u !== "");

/** Builds the entries for one thing on one tile. */
class Lineage {
  readonly entries: LineageEntry[] = [];

  constructor(
    readonly provenance: SiteProvenance | null,
    private readonly site: LineageSite,
    private readonly tile: string
  ) {}

  /** A source of the site's provider or the manifest's, with its edition
   *  for the tile (or `stand` when given). A "dlm" source on a site whose
   *  provider has no Basis-DLM (Hamburg, Berlin) is OSM's, which stands in
   *  for it there (landcover_osm.py, rail_osm.py): `standIn` names the OSM
   *  product it came from. */
  source(
    key: SourceKey,
    used: Said,
    how: LineageEntry["how"],
    opts: {
      stand?: string;
      url?: string;
      osm?: OsmProduct;
      standIn?: OsmProduct;
    } = {}
  ): void {
    if (key === "dlm" && !this.site.provider.products.dlm) {
      this.source("osm", used, how, { ...opts, osm: opts.standIn });
      return;
    }
    const said = spoken(used);
    if (said.length > 0) {
      this.entries.push({
        source: this.provenance?.sources[key]?.label ?? FALLBACK[key],
        used: said,
        stand: germanDates(opts.stand ?? this.standOf(key, opts.osm)),
        credit: this.creditOf(key),
        url: opts.url ?? this.urlOf(key),
        how,
      });
    }
  }

  /** The source's edition: the OSM product's, else the tile's, else the
   *  site-wide one. */
  private standOf(key: SourceKey, osm: OsmProduct | undefined): string {
    const info = this.provenance?.sources[key];
    const own = osm
      ? info?.stands?.[osm]
      : this.provenance?.tiles[this.tile]?.[key];
    return own ?? info?.stand ?? "";
  }

  private creditOf(key: SourceKey): string {
    const info = this.provenance?.sources[key];
    if (key === "osm") {
      return `${info?.credit ?? "© OpenStreetMap-Mitwirkende"}, ${info?.licence ?? "ODbL"}`;
    }
    return info?.credit ?? (OFFICIAL.has(key) ? this.site.provider.credit : "");
  }

  private urlOf(key: SourceKey): string | undefined {
    if (key === "osm") {
      return OSM_URL;
    }
    return OFFICIAL.has(key) ? this.site.provider.portal : undefined;
  }

  /** A source outside the manifest (a data layer's feed). */
  other(entry: LineageEntry): void {
    if (entry.used.length > 0) {
      this.entries.push(entry);
    }
  }

  /** What the viewer works out itself, from no dataset of its own. */
  viewer(used: Said): void {
    const said = spoken(used);
    if (said.length > 0) {
      this.entries.push({
        source: "Im Viewer berechnet",
        used: said,
        stand: "",
        credit: "",
        how: "berechnet",
      });
    }
  }
}

/** Everything behind one inquiry, the datasets first, the viewer last. */
export function lineage(
  inquiry: Inquiry,
  provenance: SiteProvenance | null,
  site: LineageSite
): LineageEntry[] {
  const l = new Lineage(
    provenance,
    site,
    "tile" in inquiry ? inquiry.tile : ""
  );
  switch (inquiry.kind) {
    case "building":
      buildingLineage(l, inquiry, site);
      break;
    case "tree":
      treeLineage(l, inquiry, site);
      break;
    case "monument":
      monumentLineage(l, inquiry);
      break;
    case "bridge":
      bridgeLineage(l, inquiry, site);
      break;
    case "traffic":
      trafficLineage(l, inquiry);
      break;
    case "bikes":
      bikeLineage(l, inquiry);
      break;
    case "canopy":
    case "furniture":
    case "hedge":
    case "lamp":
    case "landing":
    case "stop":
      moreLineage(l, inquiry, site);
  }
  return l.entries;
}

/** The LoD2 edition as the card's line says it: "Modell 2024". */
function lod2Stand(provenance: SiteProvenance | null, tile: string): string {
  const stand = provenance?.tiles[tile]?.lod2;
  return stand ? `Modell ${parseLod2Stand(stand).model}` : "";
}

function buildingLineage(
  l: Lineage,
  b: BuildingInquiry,
  site: LineageSite
): void {
  const all = b.tree.length > 0 ? b.tree : [b.picked];
  const facts = all.map((o) => o.facts);
  const flags = all.reduce((sum, o) => sum | o.flags, 0);
  const has = (bit: number) => hasObjectFlag(flags, bit);
  const source = b.picked.source;
  const lod2 = source !== OBJECT_SOURCE_SCAN && source !== OBJECT_SOURCE_GAP;
  if (source === OBJECT_SOURCE_SCAN) {
    l.source(
      "lsc",
      ["Grundriss und Höhe: ein Kleinbau, den das Stadtmodell nicht kennt"],
      "gemessen"
    );
  } else if (source === OBJECT_SOURCE_GAP) {
    l.source("osm", ["was hier steht und sein Umriss"], "gelesen", {
      osm: "buildings",
    });
    l.source("dom", ["seine Höhe über Gelände und Stadtmodell"], "gemessen");
  } else {
    lod2Lineage(l, b, facts);
  }
  l.source(
    "osm",
    [
      (has(OBJECT_FLAG_GLASS) || has(OBJECT_FLAG_METAL)) &&
        "Glas oder Metall der Fassade",
      has(OBJECT_FLAG_SHOP) && "Schaufenster im Erdgeschoss",
      lod2 &&
        "Fassadenfarbe, wo kartiert; sonst Ziegel oder Putz wie in der Nachbarschaft",
    ],
    "gelesen",
    { osm: "buildings" }
  );
  l.source(
    "wikidata",
    [has(OBJECT_FLAG_LANDMARK) && "eines der Wahrzeichen der Stadt"],
    "gelesen"
  );
  l.source(
    "dop",
    [
      site.provider.products.dop !== null &&
        lod2 &&
        "Dachfarbe, wo das Luftbild sie zeigt",
    ],
    "gemessen"
  );
  l.source(
    "dgm",
    ["Himmelslicht und Horizont, mit dem Stadtmodell berechnet"],
    "berechnet"
  );
  l.viewer([
    "Tönung je Gebäude, fest gestreut, wo nichts kartiert ist",
    lod2 && "Geschossbänder und Fassadenstruktur",
    "Licht und Schatten zur Uhrzeit der Szene",
  ]);
}

/** A LoD2 building's own lines: the model, and the surface model where
 *  it rebuilt a roof the model missed (ADR 0036). */
function lod2Lineage(
  l: Lineage,
  b: BuildingInquiry,
  facts: readonly ObjectFacts[]
): void {
  const rebuilt = facts.some((f) => isMeasuredRoof(f.roofType));
  l.source(
    "lod2",
    [
      "Grundriss, Wände und Dach",
      "Höhe und Traufe",
      !rebuilt && facts.some((f) => f.roofType) && "Dachform und -neigung",
      facts.some((f) => f.function) && "Nutzung: das Licht am Abend",
    ],
    "gelesen",
    { stand: lod2Stand(l.provenance, b.tile) }
  );
  l.source(
    "dom",
    [rebuilt && "das Dach, neu gemessen, wo das Stadtmodell es verfehlt"],
    "gemessen"
  );
}

function treeLineage(l: Lineage, t: TreeInquiry, site: LineageSite): void {
  const drawn = [
    "Standort",
    "Höhe und Krone (wo nicht gemessen: aus der Statistik der Kachel)",
    "Gattung: Wuchsform, Austrieb, Herbstfarbe und Laubfall",
  ];
  if (t.orchard) {
    // an orchard's tree: OSM's orchard, at the orchard's default size
    l.source("osm", ["Standort (Obstwiese)"], "gelesen", { osm: "trees" });
    l.source("dgm", ["der Boden, auf dem er steht"], "gelesen");
    l.viewer([
      "Höhe und Krone: die Vorgabe der Obstwiese",
      "die Krone aus Grundformen",
      "Wind und Licht zur Uhrzeit der Szene",
    ]);
    return;
  }
  if (t.osm) {
    l.source("osm", drawn, "gelesen", { osm: "trees" });
  } else {
    l.source("trees", drawn, "gelesen");
  }
  l.source("dgm", ["der Boden, auf dem er steht"], "gelesen");
  l.source(
    "dop",
    [
      site.provider.products.dop !== null &&
        "Laubfarbe aus dem Vegetationsindex",
    ],
    "gemessen"
  );
  l.viewer([
    "die Krone aus Grundformen je Gattung",
    "Wind und Licht zur Uhrzeit der Szene",
  ]);
}

function monumentLineage(l: Lineage, m: MonumentInquiry): void {
  const p = m.properties;
  const fromDlm = p.source === "dlm" || p.source === "dlm+osm";
  const fromOsm = p.source === "osm" || p.source === "dlm+osm";
  const measured = (p.relief?.dm.length ?? 0) > 0;
  l.source(
    "dlm",
    [
      fromDlm && "Standort und Art",
      fromDlm && !measured && "die Form der Markierung",
    ],
    "gelesen"
  );
  l.source(
    "osm",
    [fromOsm && "das Becken", fromOsm && p.style && "das Wasserspiel"],
    "gelesen",
    { osm: "fountains" }
  );
  l.source(
    "dom",
    [measured && "die Form, gemessen als Oberfläche über dem Gelände"],
    "gemessen"
  );
  l.source("dgm", ["der Boden"], "gelesen");
}

function bridgeLineage(l: Lineage, b: BridgeInquiry, site: LineageSite): void {
  const p = b.properties;
  l.source(
    "dlm",
    ["der Umriss des Decks", "die Art: Straße, Weg oder Bahn"],
    "gelesen",
    { standIn: "bridges" }
  );
  l.source(
    "dom",
    [
      site.provider.products.dom && "die Höhe der Fahrbahn",
      (p.ribs?.length ?? 0) > 0 && "das Tragwerk über dem Deck",
    ],
    "gemessen"
  );
  l.source(
    "dgm",
    ["Widerlager, Rampen und Pfeiler", "das Wasser unter der Fahrrinne"],
    "gelesen"
  );
  l.source(
    "wikidata",
    [p.wikidata && p.structure && "die Bauart des Tragwerks"],
    "gelesen",
    { url: p.wikidata ? `${WIKIDATA_URL}${p.wikidata}` : undefined }
  );
  l.source(
    "osm",
    [
      !p.wikidata && p.structure && "die Bauart des Tragwerks",
      p.clearance && "die Durchfahrtshöhe: wie tief das Deck ist",
    ],
    "gelesen",
    { osm: "bridges" }
  );
}

function trafficLineage(l: Lineage, t: TrafficInquiry): void {
  l.other({
    source: "Verkehrszählung",
    used: ["wie breit die Bänder je Richtung fließen"],
    stand: "",
    credit: t.credit ?? "",
    how: "gelesen",
  });
  l.source("dgm", ["ihr Verlauf über dem Gelände"], "gelesen");
  l.viewer(["der Verkehr zur Stunde der Szene (typischer Tagesgang)"]);
}

function bikeLineage(l: Lineage, b: BikeInquiry): void {
  l.other({
    source: "Fahrradzählstelle, live",
    used: ["wie hoch die Säulen je Richtung stehen"],
    stand: "",
    credit: b.credit ?? "",
    how: "gelesen",
  });
  l.source("dgm", ["der Boden"], "gelesen");
}

/** Where each OSM thing was read, and what the viewer gave it. */
const OSM_THINGS: Record<
  Exclude<MoreInquiry["kind"], "canopy" | "hedge">,
  [string, string]
> = {
  lamp: ["Standort", "der Mast, die Leuchte und ihr Licht bei Nacht"],
  furniture: ["Standort, Art und was OSM zur Form sagt", "die Form je Art"],
  stop: ["Standort und Name", "das Haltestellenschild"],
  landing: ["der Umriss und die Art", "Steg, Ponton und Höhe am Wasser"],
};

function moreLineage(l: Lineage, m: MoreInquiry, site: LineageSite): void {
  switch (m.kind) {
    case "canopy":
      canopyLineage(l, m, site);
      return;
    case "hedge":
      l.source("dlm", [m.source === "dlm" && "Verlauf"], "gelesen", {
        standIn: "trees",
      });
      l.source("osm", [m.source !== "dlm" && "Verlauf"], "gelesen", {
        osm: "trees",
      });
      l.source("lsc", [m.source === "osm+lsc" && "Höhe"], "gemessen");
      l.source("dgm", ["der Boden"], "gelesen");
      l.viewer([m.source !== "osm+lsc" && "Höhe und Breite, angenommen"]);
      return;
    case "furniture":
    case "lamp":
    case "landing":
    case "stop": {
      const [read, drawn] = OSM_THINGS[m.kind];
      l.source("osm", [read], "gelesen", { osm: "trees" });
      l.source("dgm", ["der Boden"], "gelesen");
      l.viewer([drawn]);
    }
  }
}

function canopyLineage(l: Lineage, c: CanopyInquiry, site: LineageSite): void {
  l.source(
    "dom",
    [c.source === "dom" && "Standort und Höhe der Krone"],
    "gemessen"
  );
  l.source(
    "lsc",
    [c.source === "lsc" && "Standort, Höhe und Krone"],
    "gemessen"
  );
  l.source(
    "dlm",
    [c.source === "row" && "die Baumreihe, auf der er steht"],
    "gelesen",
    { standIn: "trees" }
  );
  l.source("dgm", ["der Boden, auf dem er steht"], "gelesen");
  l.source(
    "dop",
    [
      site.provider.products.dop !== null &&
        "Laubfarbe aus dem Vegetationsindex",
    ],
    "gemessen"
  );
  l.viewer([
    "die Krone als Grundform, ohne Gattung",
    c.source === "row" && "ein Baum alle 9 m entlang der Reihe",
  ]);
}
