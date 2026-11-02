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
import { OBJECT_FLAG_LANDMARK, OBJECT_SOURCE_LOD2 } from "./city-mesh";
import { cardHeight, type Inquiry, type InquiryObject } from "./inquiry";
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

/** A tower's eave stands this many times the carrying eave's height (each
 *  over its own base) or more: a church's tower or a dome's drum over its
 *  nave, not a house's second roof part or a wing up the slope. */
const TOWER_OVER_EAVE = 1.75;
/** The carrying object's footprint at least this share of the largest
 *  one's (a root's or an ensemble lead's is its whole tree's): a nave,
 *  not a sacristy or an annex. */
const MASS_AREA_SHARE = 0.25;

/** Whether an object weighs in: a LoD2 object (the surface model's
 *  additions copy their host's facts) with an eave and a base of its own
 *  (base 0 is a Building drawn by its parts alone, not a height). */
const ownMass = (o: InquiryObject): o is InquiryObject & { baseZ: number } =>
  o.source === OBJECT_SOURCE_LOD2 &&
  o.eaveH > 0 &&
  o.baseZ !== undefined &&
  o.baseZ !== 0;

/** What a building's rooftop letters stand on under its tower: the highest
 *  eave (over its object's own base) that lies clearly under the tallest
 *  one, of an object with a large footprint (the nave under the tower, a
 *  church's body under its dome); null where none does (a house's own
 *  roof: its letters stand on the top), where none states an eave and a
 *  base, or for anything else. Heights are each object's own over its own
 *  base, so a building straddling two tiles or a slope compares like with
 *  like. */
export function nameplateEave(
  inquiry: Inquiry
): { baseZ: number; eaveH: number } | null {
  if (inquiry.kind !== "building") {
    return null;
  }
  // a building asked without its tree is its picked object alone
  // (mergedFacts reads it the same way)
  const all = (
    inquiry.tree.length > 0 ? inquiry.tree : [inquiry.picked]
  ).filter(ownMass);
  let tallest = 0;
  let largest = 0;
  for (const o of all) {
    tallest = Math.max(tallest, o.eaveH);
    largest = Math.max(largest, o.facts.area);
  }
  let mass: (typeof all)[number] | null = null;
  for (const o of all) {
    if (
      o.eaveH * TOWER_OVER_EAVE <= tallest &&
      o.facts.area >= MASS_AREA_SHARE * largest &&
      (mass === null ||
        o.eaveH > mass.eaveH ||
        (o.eaveH === mass.eaveH && o.facts.area > mass.facts.area))
    ) {
      mass = o;
    }
  }
  return mass ? { baseZ: mass.baseZ, eaveH: mass.eaveH } : null;
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

/** A title longer than this (characters) breaks over lines; a line holds
 *  about this many, never fewer than its longest word. */
const TITLE_WRAP = { after: 24, line: 22 } as const;

/**
 * A title's lines on the plate: one where it is short; a long one broken
 * between words into lines of about the same length (the fewest lines of
 * `TITLE_WRAP.line`), a joined name (`A / B`, an ensemble's) first at
 * its slash, each part on lines of its own.
 */
export function titleLines(title: string): string[] {
  const t = title.trim();
  if (t.length <= TITLE_WRAP.after) {
    return [t];
  }
  const parts = t
    .split(/\s+\/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length > 1) {
    return parts.flatMap((p) => balanced(p));
  }
  return balanced(t);
}

/** Words into the fewest lines of about `TITLE_WRAP.line`, as even as
 *  they go: the narrowest width that still fits that many lines. */
function balanced(text: string): string[] {
  const words = text.split(/\s+/);
  if (text.length <= TITLE_WRAP.after || words.length < 2) {
    return [text];
  }
  const longest = Math.max(...words.map((w) => w.length));
  const count = Math.max(
    Math.ceil(text.length / TITLE_WRAP.line),
    Math.min(2, words.length)
  );
  for (let width = longest; width <= text.length; width++) {
    const lines = greedy(words, width);
    if (lines.length <= count) {
      return lines;
    }
  }
  return [text];
}

/** Words filled into lines of at most `width` characters. */
function greedy(words: string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line === "") {
      line = w;
    } else if (line.length + 1 + w.length <= width) {
      line = `${line} ${w}`;
    } else {
      lines.push(line);
      line = w;
    }
  }
  lines.push(line);
  return lines;
}
