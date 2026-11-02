/**
 * What the nameplate — the lettering the scene sets at the thing asked
 * (app/_components/nameplate-layer.ts) — says: a landmark's name large with
 * its facts under it, a named building, bridge or monument by its name, an
 * ordinary house by its address, small; a tree, a lamp, a bench, a stop by
 * what the card calls it, with one line under it. Taken from the inquiry card's
 * model, so the lettering never says what the card does not. No THREE, no
 * DOM.
 */
import type { InquiryCard } from "./card-lines";
import { OBJECT_FLAG_LANDMARK } from "./city-mesh";
import { cardHeight, type Inquiry } from "./inquiry";
import { UNKNOWN_SPECIES } from "./inquiry-more";
import {
  factBuildings,
  factLines,
  type LandmarkFactsEntry,
} from "./landmark-facts";
import { NO_FACT } from "./object-facts";

/** How much the plate says, and how large: a landmark's name and facts,
 *  a name with one small line, an address alone, a thing of the street
 *  (a tree, a lamp, a bench) with one small line. */
export type NameplateRank = "landmark" | "named" | "address" | "object";

export interface NameplateText {
  /** the small lines under the title (none, one or two) */
  lines: string[];
  rank: NameplateRank;
  title: string;
}

/** Whether a building inquiry is (part of) a landmark. */
export function isLandmarkInquiry(inquiry: Inquiry): boolean {
  return (
    inquiry.kind === "building" &&
    inquiry.tree.some((o) => (o.flags & OBJECT_FLAG_LANDMARK) !== 0)
  );
}

/** The Buildings a building inquiry spans (its ensemble's), for the
 *  landmark facts; none for anything else. */
export function inquiryBuildings(inquiry: Inquiry): string[] {
  if (inquiry.kind !== "building") {
    return [];
  }
  return factBuildings(inquiry.tree);
}

function buildingPlate(
  inquiry: Extract<Inquiry, { kind: "building" }>,
  card: InquiryCard,
  facts: LandmarkFactsEntry | null
): NameplateText | null {
  const named = inquiry.tree.some((o) => o.facts.name !== "");
  if (isLandmarkInquiry(inquiry) && named) {
    // the card's height where Wikidata has none
    const height = cardHeight(inquiry);
    return {
      rank: "landmark",
      title: card.title,
      lines: factLines(facts, height === NO_FACT ? undefined : height),
    };
  }
  if (named) {
    return {
      rank: "named",
      title: card.title,
      lines: card.address ? [card.address] : [],
    };
  }
  return card.address
    ? { rank: "address", title: card.address, lines: [] }
    : null;
}

/** The things of the street the plate names: trees, lamps, furniture,
 *  stops, landing stages, hedges (inquiry-more.ts, inquiry-features.ts). */
const STREET_THINGS = new Set<Inquiry["kind"]>([
  "tree",
  "canopy",
  "hedge",
  "lamp",
  "furniture",
  "stop",
  "landing",
  "monument",
]);

/** A thing's one small line: its species where the title is the German
 *  name, else its kind where that is not the title, else its first fact. */
function thingLine(card: InquiryCard): string {
  const species = card.facts.find((f) => f.label === "Art");
  if (species && species.value && species.value !== UNKNOWN_SPECIES) {
    return species.value;
  }
  if (card.kicker && card.kicker !== card.title) {
    return card.kicker;
  }
  const first = card.facts[0];
  return first ? `${first.label} ${first.value}` : "";
}

/**
 * The plate for an inquiry and its card; null where it would say nothing
 * worth setting in the city (a counted street, a design of one's own, an
 * unnamed bridge, a house without an address).
 */
export function nameplateText(
  inquiry: Inquiry,
  card: InquiryCard,
  facts: LandmarkFactsEntry | null = null
): NameplateText | null {
  if (inquiry.kind === "building") {
    return buildingPlate(inquiry, card, facts);
  }
  if (
    (inquiry.kind === "bridge" || inquiry.kind === "monument") &&
    inquiry.properties.name
  ) {
    return {
      rank: "named",
      title: inquiry.properties.name,
      lines: [card.kicker],
    };
  }
  if (STREET_THINGS.has(inquiry.kind) && card.title) {
    const line = thingLine(card);
    return { rank: "object", title: card.title, lines: line ? [line] : [] };
  }
  return null;
}
