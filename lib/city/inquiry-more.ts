/**
 * The cards of the things that came to the inquiry after the buildings,
 * the register's trees, monuments and bridges (plan 052 phase 4e): every
 * other tree the scene draws (the surface model's crowns, the laser scan's,
 * the Basis-DLM's tree rows), the hedges, the street lamps, the street
 * furniture and playgrounds, the tram stops and the landing stages on the
 * river. Each says what its data knows and no more — most of it is OSM's
 * position and kind — and quotes its source. No THREE, no DOM.
 */
import {
  type CardCredits,
  factLines,
  firstText,
  type InquiryCard,
  metres,
  mapillarySource,
  osmSource,
  positionKey,
  sourceLine,
  stated,
  whole,
} from "./card-lines";
import type {
  FurnitureFeature,
  FurnitureKind,
  LampHeightSource,
  LowVegSource,
  RiversideFeature,
} from "./features";
import type { Stated } from "./methods";
import type { SiteProvenance } from "./provenance";

/** A tree the scene draws that no register names: a crown the surface
 *  model (DOM1) or the laser scan measured, or a tree of a Basis-DLM row. */
export interface CanopyInquiry {
  /** drawn as the cone (an evergreen that is not a pine): outlined as one */
  cone?: boolean;
  /** the crown's measured diameter (m; the laser scan's) */
  crown?: number;
  /** an evergreen, and what told it: the forest's kind (a needle forest)
   *  or the leaf-off orthophoto (green in a mixed forest) */
  evergreen?: "forest" | "photo";
  /** the measured height (m; DOM1 − DGM1 or the laser scan) */
  height?: number;
  kind: "canopy";
  position: [number, number];
  source: "dom" | "lsc" | "row";
  tile: string;
}

/** A hedge: OSM's line at its laser-scan height, or a Basis-DLM row. */
export interface HedgeInquiry {
  height?: number;
  kind: "hedge";
  /** its length on the tile (m) */
  length: number;
  position: [number, number];
  source: LowVegSource | "dlm";
  tile: string;
  width?: number;
}

/** A street lamp (OSM, or Mapillary's: `src`). */
export interface LampInquiry {
  /** a tall mast's head on an arm over the carriageway
   *  (pipeline/bake/lamp_heights.py `arm_of`) */
  arm?: boolean;
  /** the post's height (m) where DOM1 measured it, and how: its street's
   *  median, or its kind of street's (pipeline/bake/lamp_heights.py); a
   *  wall lantern's assumed head height (pipeline/bake/lamps.py WALL_H) */
  height?: number;
  heightFrom?: LampHeightSource;
  /** hung on a wire across the street (pipeline/bake/lamps.py) */
  hung?: boolean;
  kind: "lamp";
  position: [number, number];
  src?: "mly";
  tile: string;
  /** on its bracket, where OSM puts it on a wall: out of a building's
   *  facade, or — no building near — out of a mapped wall */
  wall?: "facade" | "wall";
}

/** A piece of street furniture or a playground (OSM). */
export interface FurnitureInquiry {
  kind: "furniture";
  position: [number, number];
  properties: NonNullable<FurnitureFeature["properties"]>;
  tile: string;
}

/** A tram stop (OSM): its name. */
export interface StopInquiry {
  kind: "stop";
  name: string;
  position: [number, number];
  tile: string;
}

/** A landing stage or pontoon on the river (OSM). */
export interface LandingInquiry {
  kind: "landing";
  position: [number, number];
  properties: NonNullable<RiversideFeature["properties"]>;
  tile: string;
}

export type MoreInquiry =
  | CanopyInquiry
  | FurnitureInquiry
  | HedgeInquiry
  | LampInquiry
  | LandingInquiry
  | StopInquiry;

const DOM_LABEL = "Digitales Oberflächenmodell DOM1";

/** A vegetation row's or a forest's source: the Basis-DLM's, or where the
 *  provider has none (Hamburg, Berlin: landcover_osm.py) OSM's hedges, tree
 *  rows and woods. */
function rowSource(
  what: string,
  provenance: SiteProvenance | null,
  credits: CardCredits
): Stated[] {
  return stated(
    "taken",
    credits.dlm
      ? sourceLine(provenance, "dlm", [what], {
          label: "Basis-DLM",
          credit: credits.provider,
        })
      : osmSource(provenance, [what], "trees")
  );
}

/** A thing's one source: Mapillary's detection in street photos, or OSM's
 *  mapped point. */
function pointSource(
  what: string,
  mapillary: boolean,
  provenance: SiteProvenance | null
): Stated[] {
  return mapillary
    ? stated("detected", mapillarySource([what]))
    : stated("taken", osmSource(provenance, [what], "trees"));
}

/** A tree the scene draws without a register's name. */
/** What a canopy card says for its species: DOP saw a crown, no register
 *  names it. */
export const UNKNOWN_SPECIES = "nicht bekannt";

export function canopyCard(
  t: CanopyInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const facts = factLines([
    ["Höhe", t.height ? `${metres(t.height)}, gemessen` : ""],
    ["Krone", t.crown ? `Ø ${metres(t.crown)}, gemessen` : ""],
    ["Laub", t.evergreen ? "Nadelbaum, immergrün" : ""],
    ["Art", UNKNOWN_SPECIES],
  ]);
  const leaf = {
    forest: rowSource("Nadelwald", provenance, credits),
    photo: stated(
      "detected",
      sourceLine(provenance, "dop", ["grün im laubfreien Luftbild"], {
        label: "Digitales Orthophoto",
        credit: credits.provider,
      })
    ),
  };
  // a line carries the least certain of what it gives: the place of a
  // crown is detected (canopy.py, lowveg.py), its height then computed
  const sources = {
    dom: stated(
      "detected",
      sourceLine(provenance, "dom", ["Lage und Höhe der Krone"], {
        label: DOM_LABEL,
        credit: credits.provider,
      })
    ),
    lsc: stated(
      "detected",
      sourceLine(provenance, "lsc", ["Lage, Höhe und Krone"], {
        label: "Laserscan",
        credit: credits.provider,
      })
    ),
    row: rowSource("Baumreihe", provenance, credits),
  };
  const found = {
    dom: "Eine Krone, im Oberflächenmodell erkannt",
    lsc: "Eine Krone, im Laserscan erkannt",
    row: "Die Bäume einer Reihe stehen in festem Abstand, wie gezeichnet",
  };
  return {
    kicker: t.source === "row" ? "Baum einer Baumreihe" : "Baum",
    title: "Baum",
    address: found[t.source],
    facts,
    id: positionKey(t.position),
    idLabel: "Lage",
    sources: [...sources[t.source], ...(t.evergreen ? leaf[t.evergreen] : [])],
  };
}

/** Which survey measured a hedge's height, by its source: the laser scan
 *  or the surface model DOM1 (lowveg.py); none for the others. */
const HEDGE_MEASURED: Partial<Record<HedgeInquiry["source"], "dom" | "lsc">> = {
  "osm+lsc": "lsc",
  "osm+dom": "dom",
  lsc: "lsc",
};

/** A hedge's source lines: the Basis-DLM's row, the laser scan's own
 *  find, or OSM's line with the survey that measured its height. */
function hedgeSources(
  h: HedgeInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): Stated[] {
  if (h.source === "dlm") {
    return rowSource("Hecke", provenance, credits);
  }
  const scan = { label: "Laserscan", credit: credits.provider };
  if (h.source === "lsc") {
    return stated(
      "detected",
      sourceLine(provenance, "lsc", ["Verlauf und Höhe der Hecke"], scan)
    );
  }
  const by = HEDGE_MEASURED[h.source];
  const dom = { label: DOM_LABEL, credit: credits.provider };
  return [
    ...stated("taken", osmSource(provenance, ["Hecke"], "trees")),
    ...stated(
      "computed",
      by
        ? sourceLine(
            provenance,
            by,
            ["Höhe gemessen"],
            by === "lsc" ? scan : dom
          )
        : ""
    ),
  ];
}

/** A hedge. */
export function hedgeCard(
  h: HedgeInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  const measured = HEDGE_MEASURED[h.source] !== undefined;
  const facts = factLines([
    [
      "Höhe",
      h.height ? `${metres(h.height)}${measured ? ", gemessen" : ""}` : "",
      measured ? undefined : "assumed",
    ],
    ["Breite", h.width ? metres(h.width) : ""],
    ["Länge", h.length > 0 ? metres(h.length) : ""],
  ]);
  const sources = hedgeSources(h, provenance, credits);
  return {
    kicker: "Hecke",
    title: "Hecke",
    address: "",
    facts,
    id: positionKey(h.position),
    idLabel: "Lage",
    sources,
  };
}

/** A lantern on a facade: OSM says where it hangs, its height is assumed. */
function wallLampCard(
  l: LampInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  return {
    kicker: "Straßenbeleuchtung",
    title: "Wandleuchte",
    address: "",
    facts: factLines([
      ["Aufhängung", l.wall === "wall" ? "an der Mauer" : "an der Fassade"],
      ["Höhe", l.height ? `${metres(l.height)}, angenommen` : "", "assumed"],
    ]),
    id: positionKey(l.position),
    idLabel: "Lage",
    sources: pointSource("Laterne", l.src === "mly", provenance),
  };
}

/** A street lamp. */
export function lampCard(
  l: LampInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  if (l.wall) {
    return wallLampCard(l, provenance);
  }
  const measured = !l.hung && l.height !== undefined && l.heightFrom;
  const along = {
    street: "wie an den Laternen der Straße gemessen",
    class: "wie an den Laternen dieser Art Straße gemessen",
  };
  return {
    kicker: "Straßenbeleuchtung",
    title: l.hung ? "Hängeleuchte" : "Straßenlaterne",
    address: "",
    facts: factLines(
      l.hung
        ? [
            ["Aufhängung", "Querseil über der Straße", "computed"],
            ["Höhe", "7 m, angenommen", "assumed"],
          ]
        : [
            measured
              ? [
                  "Mast",
                  `${metres(l.height ?? 0)}, ${along[measured]}`,
                  "computed",
                ]
              : ["Mast", "5 m, angenommen", "assumed"],
            ["Ausleger", l.arm ? "zur Fahrbahn, angenommen" : "", "assumed"],
          ]
    ),
    id: positionKey(l.position),
    idLabel: "Lage",
    sources: [
      ...pointSource("Laterne", l.src === "mly", provenance),
      ...(measured
        ? stated(
            "computed",
            sourceLine(provenance, "dom", ["Höhe der Masten"], {
              label: DOM_LABEL,
              credit: credits.provider,
            })
          )
        : []),
    ],
  };
}

/** Each kind of furniture in words: what it is, and its group. */
const FURNITURE: Record<FurnitureKind, [string, string]> = {
  bench: ["Bank", "Stadtmobiliar"],
  bike: ["Fahrradbügel", "Stadtmobiliar"],
  bin: ["Papierkorb", "Stadtmobiliar"],
  bollard: ["Poller", "Stadtmobiliar"],
  clock: ["Uhr", "Stadtmobiliar"],
  column: ["Litfaßsäule", "Stadtmobiliar"],
  hydrant: ["Hydrant", "Feuerwehr"],
  hydrantsign: ["Hydrantenschild", "Feuerwehr"],
  pedsignal: ["Fußgängerampel", "Verkehr"],
  picnic: ["Picknicktisch", "Stadtmobiliar"],
  postbox: ["Briefkasten", "Post"],
  shelter: ["Wartehäuschen", "Haltestelle"],
  signal: ["Ampel", "Verkehr"],
  stop: ["Haltestellenschild", "Haltestelle"],
  wallclock: ["Uhr an der Fassade", "Stadtmobiliar"],
  water: ["Trinkbrunnen", "Wasser"],
  climb: ["Klettergerüst", "Spielplatz"],
  playground: ["Spielplatz", "Spielplatz"],
  playhouse: ["Spielhaus", "Spielplatz"],
  roundabout: ["Karussell", "Spielplatz"],
  sandpit: ["Sandkasten", "Spielplatz"],
  seesaw: ["Wippe", "Spielplatz"],
  slide: ["Rutsche", "Spielplatz"],
  springy: ["Federwippe", "Spielplatz"],
  swing: ["Schaukel", "Spielplatz"],
};

/** A piece of furniture's name, as the card and the strip say it. */
export function furnitureName(k: FurnitureKind): string {
  return FURNITURE[k]?.[0] ?? "Stadtmobiliar";
}

/** A bearing in words: "nach Südwesten". */
function facing(a: number | undefined): string {
  if (a === undefined || !Number.isFinite(a)) {
    return "";
  }
  const names = [
    "Norden",
    "Nordosten",
    "Osten",
    "Südosten",
    "Süden",
    "Südwesten",
    "Westen",
    "Nordwesten",
  ];
  return `nach ${names[Math.round((((a % 360) + 360) % 360) / 45) % 8]}`;
}

/** A piece of street furniture or a playground. */
export function furnitureCard(
  f: FurnitureInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const p = f.properties;
  const [title, kicker] = FURNITURE[p.k] ?? ["Stadtmobiliar", "Stadtmobiliar"];
  const facts = factLines([
    ["Länge", p.l ? metres(p.l) : ""],
    ["Lehne", p.k === "bench" && p.back === false ? "ohne" : ""],
    ["Bügel", p.n && p.n > 1 ? whole.format(p.n) : ""],
    ["Höhe", p.h ? metres(p.h) : ""],
    ["Material", p.metal ? "Metall" : ""],
    ["Beleuchtet", p.lit ? "ja" : ""],
    ["Ausleger", p.arm ? "über die Fahrbahn" : ""],
    ["Ausrichtung", p.k === "bench" || p.k === "shelter" ? facing(p.a) : ""],
  ]);
  return {
    kicker,
    title,
    address: "",
    facts,
    id: positionKey(f.position),
    idLabel: "Lage",
    // a playground's piece OSM does not map: found in the surface model
    sources:
      p.src === "dom"
        ? stated(
            "computed",
            sourceLine(provenance, "dom", ["Lage und Höhe gemessen"], {
              label: DOM_LABEL,
              credit: "",
            })
          )
        : pointSource(title, p.src === "mly", provenance),
  };
}

/** A tram stop. */
export function stopCard(
  s: StopInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  return {
    kicker: "Straßenbahnhaltestelle",
    title: s.name || "Haltestelle",
    address: "",
    facts: [],
    id: positionKey(s.position),
    idLabel: "Lage",
    sources: stated("taken", osmSource(provenance, ["Name", "Lage"], "trees")),
  };
}

const LANDING: Record<string, string> = {
  pier: "Anlegestelle",
  pontoon: "Ponton",
  groyne: "Buhne",
  ferry: "Fähre",
};

/** A landing stage or pontoon. */
export function landingCard(
  l: LandingInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const p = l.properties;
  const title = LANDING[p.k] ?? "Anleger";
  return {
    kicker: "Am Fluss",
    title: firstText(p.name, title),
    address: p.name ? title : "",
    facts: factLines([["Länge", p.len ? metres(p.len) : ""]]),
    id: positionKey(l.position),
    idLabel: "Lage",
    sources: stated("taken", osmSource(provenance, [title], "trees")),
  };
}

/** The card of any of these. */
export function moreCard(
  inquiry: MoreInquiry,
  provenance: SiteProvenance | null,
  credits: CardCredits
): InquiryCard {
  switch (inquiry.kind) {
    case "canopy":
      return canopyCard(inquiry, provenance, credits);
    case "hedge":
      return hedgeCard(inquiry, provenance, credits);
    case "lamp":
      return lampCard(inquiry, provenance, credits);
    case "furniture":
      return furnitureCard(inquiry, provenance);
    case "stop":
      return stopCard(inquiry, provenance);
    case "landing":
      return landingCard(inquiry, provenance);
  }
}
