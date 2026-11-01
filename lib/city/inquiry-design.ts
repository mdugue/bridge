/**
 * A planner's design asked (ADR 0042, 0054): the card for one of its parts
 * — an IFC element with its type, name and GlobalId, a landscape plan's
 * surface by its class, a glTF's or an OBJ's object by its name — and the
 * design's place. Everything on it comes from the file the planner picked
 * and the placement they gave it: no city data, so no city source line.
 * No THREE, no DOM.
 */

import {
  type CardFact,
  factLines,
  firstText,
  type InquiryCard,
  metres,
  positionKey,
  stated,
  whole,
} from "./card-lines";
import type { DesignPlacement, PlacementSource } from "./design-placement";
import type { Method } from "./methods";

/** What the file says of one part of the design. */
export interface DesignPartInfo {
  /** its own name (an IFC element's Name, a glTF node's, an OBJ object's) */
  name: string | null;
  /** what it is: an IFC entity (`IfcWall`), a plan's class word */
  type: string | null;
  /** the key it is found by in the planner's model (an IFC GlobalId) */
  id: string | null;
  /** its material's name in the file */
  material: string | null;
}

export interface DesignInquiry {
  kind: "design";
  /** the design's file */
  file: string;
  part: DesignPartInfo;
  /** the part's index among the design's (its key) */
  partIndex: number;
  placement: DesignPlacement;
  source: PlacementSource;
  triangles: number;
  /** where it was asked (EPSG) */
  position: [number, number];
}

/** IFC entities by the word a planner says for them. */
const IFC_WORDS: Readonly<Record<string, string>> = {
  IFCBEAM: "Träger",
  IFCBUILDINGELEMENTPROXY: "Bauteil",
  IFCCHIMNEY: "Schornstein",
  IFCCOLUMN: "Stütze",
  IFCCOVERING: "Bekleidung",
  IFCCURTAINWALL: "Vorhangfassade",
  IFCDOOR: "Tür",
  IFCFLOWTERMINAL: "Haustechnik",
  IFCFOOTING: "Fundament",
  IFCFURNISHINGELEMENT: "Ausstattung",
  IFCFURNITURE: "Möbel",
  IFCGEOGRAPHICELEMENT: "Geländeelement",
  IFCMEMBER: "Stab",
  IFCPILE: "Pfahl",
  IFCPLATE: "Platte",
  IFCRAILING: "Geländer",
  IFCRAMP: "Rampe",
  IFCRAMPFLIGHT: "Rampenlauf",
  IFCROOF: "Dach",
  IFCSHADINGDEVICE: "Sonnenschutz",
  IFCSITE: "Grundstück",
  IFCSLAB: "Decke oder Bodenplatte",
  IFCSTAIR: "Treppe",
  IFCSTAIRFLIGHT: "Treppenlauf",
  IFCWALL: "Wand",
  IFCWALLSTANDARDCASE: "Wand",
  IFCWINDOW: "Fenster",
};

/** The word for an IFC entity (`IfcWallStandardCase` → Wand), or null for
 *  a type that is not an IFC entity's name. */
export function ifcTypeWord(type: string | null): string | null {
  // web-ifc names them in the schema's case (IfcWallStandardCase)
  const key = type?.toUpperCase();
  if (!key?.startsWith("IFC")) {
    return null;
  }
  return IFC_WORDS[key] ?? "Bauteil";
}

/** Where the design's place came from, as the card says it, and how
 *  (the *Detailansicht* says the same, lib/city/lineage.ts). */
export const PLACED: Readonly<Record<PlacementSource, [string, Method]>> = {
  file: ["aus den Landeskoordinaten der Datei", "taken"],
  "file-plan": ["Lage aus der Datei, auf das Gelände gesetzt", "detected"],
  "placement-file": ["aus der Lagedatei", "taken"],
  here: ["vor dem Standort abgesetzt", "assumed"],
  manual: ["von Hand gesetzt", "taken"],
};

const coordinate = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

/** "45° im Uhrzeigersinn", "" unturned. */
function turnLine(degrees: number): string {
  const d = (((Math.round(degrees * 10) / 10) % 360) + 360) % 360;
  return d === 0 ? "" : `${coordinate.format(d)}° im Uhrzeigersinn`;
}

/** The card for a part of the loaded design. */
export function designCard(d: DesignInquiry): InquiryCard {
  const { part, placement } = d;
  const word = ifcTypeWord(part.type);
  const what = word ?? part.type;
  const [placed, method] = PLACED[d.source];
  const facts: CardFact[] = factLines([
    ["Bauteil", word && part.type ? `${word} (${part.type})` : ""],
    ["Fläche", word ? "" : (part.type ?? "")],
    ["Material", part.material ?? ""],
    ["Datei", d.file],
    ["Rechtswert", `${coordinate.format(placement.east)} m`],
    ["Hochwert", `${coordinate.format(placement.north)} m`],
    ["Unterkante", `${metres(placement.base)} ü. NHN`],
    ["Drehung", turnLine(placement.rotation)],
    ["Platziert", placed, method],
    ["Dreiecke", whole.format(d.triangles)],
  ]);
  return {
    kicker: "Entwurf",
    title: firstText(part.name, what, d.file),
    address: "",
    facts,
    id: part.id ?? positionKey(d.position),
    idLabel: part.id ? "IFC-GlobalId" : "Lage",
    sources: stated(
      "taken",
      `${d.file}: deine Datei, nur auf diesem Gerät gelesen`
    ),
  };
}
