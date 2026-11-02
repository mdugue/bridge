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

/** Another object rises this many times the main mass's eave height
 *  over the mass's base to be a tower it stands under (a house's ridge
 *  rarely reaches 1.7 eave heights; a church's tower many). */
const TOWER_OVER_EAVE = 1.75;

/** An object's top (m, the data frame's height): its measured height,
 *  else its eave, over its base; null where its base is unknown (no
 *  geometry of its own: the bake's base is then 0, not a height). */
const topOf = (o: InquiryObject): number | null =>
  o.baseZ === undefined || o.baseZ === 0
    ? null
    : o.baseZ + (o.facts.height > 0 ? o.facts.height : o.eaveH);

/** A building's main eave: its largest object's (the main mass, not a
 *  tower or a dome's drum), over that object's own base, where another of
 *  its objects rises well over that eave (a tower, a dome); null where
 *  nothing does (a house's own roof: its letters stand on the top), where
 *  none states an eave or base, or for anything else. The mass's own
 *  height is not asked: a root's or an ensemble lead's spans its tree. */
export function nameplateEave(
  inquiry: Inquiry
): { baseZ: number; eaveH: number } | null {
  if (inquiry.kind !== "building") {
    return null;
  }
  let mass: InquiryObject | null = null;
  let area = -1;
  // a building asked without its tree is its picked object alone
  // (mergedFacts reads it the same way)
  const all = inquiry.tree.length > 0 ? inquiry.tree : [inquiry.picked];
  for (const o of all) {
    const a = o.facts.area > 0 ? o.facts.area : 0;
    if (o.eaveH > 0 && topOf(o) !== null && a > area) {
      mass = o;
      area = a;
    }
  }
  if (mass?.baseZ === undefined) {
    return null;
  }
  const { baseZ, eaveH } = mass;
  const over = baseZ + TOWER_OVER_EAVE * eaveH;
  const tower = all.some((o) => o !== mass && (topOf(o) ?? 0) >= over);
  return tower ? { baseZ, eaveH } : null;
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
