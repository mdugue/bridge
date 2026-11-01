/**
 * What the nameplate — the lettering the scene sets at the thing asked
 * (app/_components/nameplate-layer.ts) — says: a landmark's name large with
 * its facts under it, a named building, bridge or monument by its name, an
 * ordinary house by its address, small. Taken from the inquiry card's
 * model, so the lettering never says what the card does not. No THREE, no
 * DOM.
 */
import type { InquiryCard } from "./card-lines";
import { OBJECT_FLAG_LANDMARK } from "./city-mesh";
import { cardHeight, type Inquiry } from "./inquiry";
import {
  factBuildings,
  factLines,
  type LandmarkFactsEntry,
} from "./landmark-facts";
import { NO_FACT } from "./object-facts";

/** How much the plate says, and how large: a landmark's name and facts,
 *  a name with one small line, an address alone. */
export type NameplateRank = "landmark" | "named" | "address";

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

/**
 * The plate for an inquiry and its card; null where it would say nothing
 * worth setting in the city (a tree, a lamp, a counted street, a house
 * without an address).
 */
export function nameplateText(
  inquiry: Inquiry,
  card: InquiryCard,
  facts: LandmarkFactsEntry | null = null
): NameplateText | null {
  if (inquiry.kind === "building") {
    return buildingPlate(inquiry, card, facts);
  }
  if (inquiry.kind === "bridge" || inquiry.kind === "monument") {
    return inquiry.properties.name
      ? { rank: "named", title: inquiry.properties.name, lines: [card.kicker] }
      : null;
  }
  return null;
}
