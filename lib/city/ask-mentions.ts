/**
 * Where an answer of *Frag die Stadt* names a place it showed (ADR 0056):
 * the text split into plain runs and mentions, so the card can make each
 * mention a link that flies there. A place is found by its name or by its
 * name without the city's ("Residenzschloss Dresden" → "Residenzschloss");
 * each place is linked once, where the answer first names it (`linked`
 * carries that across an answer's paragraphs).
 */

/** A run of an answer's text: plain, or a mention of `places[place]`. */
export type MentionRun = { text: string } | { text: string; place: number };

/**
 * A place's name as a reader says it: without what Wikidata adds to tell
 * it apart — a subtitle after a dash ("Kügelgenhaus – Museum der
 * Dresdner Romantik"), the place in brackets ("Pöppelmannbrücke
 * (Grimma)") or after a comma ("Frauenkirche, München") — and without
 * the city's name at its end ("Residenzschloss Dresden").
 */
export function placeLabel(name: string, city: string): string {
  const bare = name
    .trim()
    .replace(/\s+[–—-]\s.*$/, "")
    .replace(/\s*\([^)]*\)$/, "")
    .replace(/,\s[^,]*$/, "");
  const c = city.trim().toLowerCase();
  const words = bare.split(/\s+/);
  return c !== "" && words.length > 1 && words.at(-1)?.toLowerCase() === c
    ? words.slice(0, -1).join(" ")
    : bare;
}

/** A German adjective's case endings. */
const DECLINED = /(?:e|es|er|en|em)$/;
/**
 * An adjective that opens a name, its stem and ending: one in -isch
 * ("Katholische"), a common one ("Altes", "Neue", "Großer"), or one made
 * from a place ("Neustädter", "Hamburger": a stem of five letters or more,
 * so "Kaiser" or "Bürger" are none).
 */
const ADJECTIVE =
  /^(?:[A-ZÄÖÜ][a-zäöüß]*isch|Alt|Neu|Groß|Klein|Golden|Rot|Weiß|Blau|Grün|Schwarz|Hoh|Ober|Unter|Heilig|Breit|Lang|Schön)(?:e|es|er|en)$|^[A-ZÄÖÜ][a-zäöüß]{4,}er$/;
/** The shortest noun that stands for the whole name ("Hofkirche"). */
const NOUN_MIN = 7;
/** Words that open a noun phrase without saying which one. */
const DETERMINER =
  /^(?:d(?:ie|er|as|en|em|es)|dies(?:e|er|es|en|em)|jen(?:e|er|es|en|em)|k?ein(?:e|er|es|en|em)?|(?:mein|dein|sein|ihr|unser|euer)(?:e|er|es|en|em)?|welch(?:e|er|es|en|em))$/i;

/** A name's adjective without its ending, compared across its forms
 *  ("Alte", "Altes", "Alten" → "alt"). */
function stemOf(word: string): string {
  return word.toLowerCase().replace(DECLINED, "");
}

interface Alias {
  text: string;
  /** a noun standing for the name: the stem of the adjective it drops */
  stem?: string;
}

/** The noun a two-word name may be called by and its adjective's stem
 *  ("Katholische Hofkirche" → Hofkirche, katholisch; `as written`:
 *  Katholisch), or null. */
function nounOf(
  label: string
): { noun: string; stem: string; written: string } | null {
  const words = label.split(/\s+/);
  const [adjective = "", noun = ""] = words;
  return words.length === 2 &&
    ADJECTIVE.test(adjective) &&
    noun.length >= NOUN_MIN
    ? {
        noun,
        stem: stemOf(adjective),
        written: adjective.replace(DECLINED, ""),
      }
    : null;
}

/** The ways the text may name a place, the longest first: its name, as a
 *  reader says it, with its adjective declined ("der Katholischen
 *  Hofkirche"), and its noun alone ("diese Hofkirche") — unless another
 *  place answers to that noun too (the Altes and the Neues Rathaus). */
function aliasesOf(name: string, city: string, shared: Set<string>): Alias[] {
  const out: Alias[] = [{ text: name.trim() }];
  const label = placeLabel(name, city);
  if (label !== out[0].text) {
    out.push({ text: label });
  }
  const own = nounOf(label);
  if (own) {
    // the adjective declined as the sentence needs ("am Alten Rathaus")
    for (const ending of ["e", "es", "er", "en", "em"]) {
      const text = `${own.written}${ending} ${own.noun}`;
      if (out.every((a) => a.text !== text)) {
        out.push({ text });
      }
    }
    if (!shared.has(own.noun.toLowerCase())) {
      out.push({ text: own.noun, stem: own.stem });
    }
  }
  // too short to be a name in running text
  return out.filter((a) => a.text.length >= 4);
}

/** The nouns more than one place may be called by, or that are a word of
 *  another place's name ("Rathaus" with the Altes and the Neues Rathaus,
 *  "Bahnhof" beside the "Bahnhof Mitte"). */
function sharedNouns(
  places: readonly { name: string }[],
  city: string
): Set<string> {
  const labels = places.map((p) => placeLabel(p.name, city));
  const words = labels.map(
    (l) => new Set(l.toLowerCase().split(/\s+/).filter(Boolean))
  );
  const shared = new Set<string>();
  labels.forEach((label, i) => {
    const noun = nounOf(label)?.noun.toLowerCase();
    if (noun && words.some((w, j) => j !== i && w.has(noun))) {
      shared.add(noun);
    }
  });
  return shared;
}

const WORD = /[\p{L}\p{N}]/u;
/** A German case ending after a name: "des Zwingers", "Residenzschlosses". */
const ENDING = /^(?:es|en|ns|s|n)?(?![\p{L}\p{N}])/u;

/** The word before `at` in `text`, if only spaces part them. */
const WORD_BEFORE = /([\p{L}]+)\s+$/u;
/** A capitalised word right after (a name goes on: "Bahnhof Mitte"). */
const NAME_AFTER = /^\s+\p{Lu}/u;

/**
 * Whether a noun alias at `at`…`end` stands for its place: the adjective
 * before it, if any, is the place's own ("das Alte Rathaus" is not the
 * Neues Rathaus), and no capitalised word carries the name on ("vom
 * Bahnhof Mitte" is not the Neustädter Bahnhof).
 */
function nounFits(text: string, at: number, end: number, stem: string) {
  if (NAME_AFTER.test(text.slice(end))) {
    return false;
  }
  const before = WORD_BEFORE.exec(text.slice(0, at))?.[1];
  if (!before || DETERMINER.test(before)) {
    return true;
  }
  // an adjective a name opens with in front ("Alte", "alten"): the name's
  // own; any other word ("prächtigen") says nothing against it
  const named = ADJECTIVE.test(before[0].toUpperCase() + before.slice(1));
  return !named || stemOf(before) === stem;
}

/** Where `alias` first stands in `text` as a whole word (a case ending
 *  allowed) and, for a noun, fits (`nounFits`): its start and end, or
 *  null. */
function findWord(
  text: string,
  alias: Alias
): { at: number; end: number } | null {
  // a letter whose lower case is longer ("İ") would shift every index:
  // then only the name as written is found
  const folds = text.toLowerCase().length === text.length;
  const lower = folds ? text.toLowerCase() : text;
  const a = folds ? alias.text.toLowerCase() : alias.text;
  for (let i = lower.indexOf(a); i >= 0; i = lower.indexOf(a, i + 1)) {
    const ending = ENDING.exec(text.slice(i + a.length));
    // a name inside a longer word ("Domplatz" for "Dom") is not it
    if ((i === 0 || !WORD.test(text[i - 1])) && ending) {
      const end = i + a.length + ending[0].length;
      if (alias.stem === undefined || nounFits(text, i, end, alias.stem)) {
        return { at: i, end };
      }
    }
  }
  return null;
}

/** `text` split into runs, each place's first mention its own; the places
 *  in `linked` are linked already, and those linked here join them. */
export function mentionRuns(
  text: string,
  places: readonly { name: string }[],
  city: string,
  linked: Set<number> = new Set()
): MentionRun[] {
  const hits: { at: number; end: number; place: number }[] = [];
  const shared = sharedNouns(places, city);
  places.forEach((p, place) => {
    if (linked.has(place)) {
      return;
    }
    // where the text first names it, by whichever of its names
    let first: { at: number; end: number } | null = null;
    for (const alias of aliasesOf(p.name, city, shared)) {
      const hit = findWord(text, alias);
      if (hit && (first === null || hit.at < first.at)) {
        first = hit;
      }
    }
    if (first) {
      hits.push({ ...first, place });
    }
  });
  hits.sort((a, b) => a.at - b.at || b.end - a.end);
  const runs: MentionRun[] = [];
  let pos = 0;
  for (const h of hits) {
    // one place's name inside another's mention stays text
    if (h.at < pos) {
      continue;
    }
    if (h.at > pos) {
      runs.push({ text: text.slice(pos, h.at) });
    }
    runs.push({ text: text.slice(h.at, h.end), place: h.place });
    linked.add(h.place);
    pos = h.end;
  }
  if (pos < text.length) {
    runs.push({ text: text.slice(pos) });
  }
  return runs;
}
