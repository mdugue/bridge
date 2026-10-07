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
  factLines,
  firstText,
  GEOSN_CREDIT,
  type InquiryCard,
  metres,
  osmSource,
  positionKey,
  sourceLine,
  whole,
} from "./card-lines";
import type {
  FurnitureFeature,
  FurnitureKind,
  LowVegSource,
  RiversideFeature,
} from "./features";
import type { SiteProvenance } from "./provenance";

/** A tree the scene draws that no register names: a crown the surface
 *  model (DOM1) or the laser scan measured, or a tree of a Basis-DLM row. */
export interface CanopyInquiry {
  /** the crown's measured diameter (m; the laser scan's) */
  crown?: number;
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

/** A street lamp (OSM). */
export interface LampInquiry {
  kind: "lamp";
  position: [number, number];
  tile: string;
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

const DOM = {
  label: "Digitales Oberflächenmodell DOM1",
  credit: GEOSN_CREDIT,
};

/** A tree the scene draws without a register's name. */
export function canopyCard(
  t: CanopyInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const facts = factLines([
    ["Höhe", t.height ? `${metres(t.height)}, gemessen` : ""],
    ["Krone", t.crown ? `Ø ${metres(t.crown)}, gemessen` : ""],
    ["Art", "nicht bekannt"],
  ]);
  const sources = {
    dom: sourceLine(provenance, "dom", ["Lage und Höhe der Krone"], DOM),
    lsc: sourceLine(provenance, "lsc", ["Lage, Höhe und Krone"], {
      label: "Laserscan",
      credit: GEOSN_CREDIT,
    }),
    row: sourceLine(provenance, "dlm", ["Baumreihe"], {
      label: "Basis-DLM",
      credit: GEOSN_CREDIT,
    }),
  };
  return {
    kicker: t.source === "row" ? "Baum einer Baumreihe" : "Baum",
    title: "Baum",
    address:
      t.source === "row"
        ? "Die Bäume einer Reihe stehen in festem Abstand, wie gezeichnet"
        : "Eine Krone, die die Befliegung gemessen hat",
    facts,
    id: positionKey(t.position),
    idLabel: "Lage",
    sources: [sources[t.source]],
  };
}

/** A hedge. */
export function hedgeCard(
  h: HedgeInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  const measured = h.source === "osm+lsc";
  const facts = factLines([
    [
      "Höhe",
      h.height ? `${metres(h.height)}${measured ? ", gemessen" : ""}` : "",
    ],
    ["Breite", h.width ? metres(h.width) : ""],
    ["Länge", h.length > 0 ? metres(h.length) : ""],
  ]);
  const sources =
    h.source === "dlm"
      ? [
          sourceLine(provenance, "dlm", ["Hecke"], {
            label: "Basis-DLM",
            credit: GEOSN_CREDIT,
          }),
        ]
      : [
          osmSource(provenance, ["Hecke"], "trees"),
          measured
            ? sourceLine(provenance, "lsc", ["Höhe gemessen"], {
                label: "Laserscan",
                credit: GEOSN_CREDIT,
              })
            : "",
        ].filter(Boolean);
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

/** A street lamp. */
export function lampCard(
  l: LampInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  return {
    kicker: "Straßenbeleuchtung",
    title: "Straßenlaterne",
    address: "",
    facts: factLines([["Mast", "5 m, angenommen"]]),
    id: positionKey(l.position),
    idLabel: "Lage",
    sources: [osmSource(provenance, ["Laterne"], "trees")],
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
    ["Ausrichtung", p.k === "bench" || p.k === "shelter" ? facing(p.a) : ""],
  ]);
  return {
    kicker,
    title,
    address: "",
    facts,
    id: positionKey(f.position),
    idLabel: "Lage",
    sources: [osmSource(provenance, [title], "trees")],
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
    sources: [osmSource(provenance, ["Name", "Lage"], "trees")],
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
    sources: [osmSource(provenance, [title], "trees")],
  };
}

/** The card of any of these. */
export function moreCard(
  inquiry: MoreInquiry,
  provenance: SiteProvenance | null
): InquiryCard {
  switch (inquiry.kind) {
    case "canopy":
      return canopyCard(inquiry, provenance);
    case "hedge":
      return hedgeCard(inquiry, provenance);
    case "lamp":
      return lampCard(inquiry, provenance);
    case "furniture":
      return furnitureCard(inquiry, provenance);
    case "stop":
      return stopCard(inquiry, provenance);
    case "landing":
      return landingCard(inquiry, provenance);
  }
}
