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

/** A German adjective before a noun ("Katholische", "Altes", "Hamburger"). */
const ADJECTIVE = /^[A-ZÄÖÜ][a-zäöüß]+(?:e|es|er|en)$/;
/** The shortest noun that stands for the whole name ("Hofkirche"). */
const NOUN_MIN = 7;

/** The ways the text may name a place, the longest first: its name, as a
 *  reader says it, and its noun where an adjective comes before it
 *  ("diese Hofkirche" for the Katholische Hofkirche). */
function aliasesOf(name: string, city: string): string[] {
  const out = [name.trim()];
  const label = placeLabel(name, city);
  if (label !== out[0]) {
    out.push(label);
  }
  const words = label.split(/\s+/);
  const noun = words[1] ?? "";
  if (
    words.length === 2 &&
    ADJECTIVE.test(words[0]) &&
    noun.length >= NOUN_MIN
  ) {
    out.push(noun);
  }
  // too short to be a name in running text
  return out.filter((a) => a.length >= 4);
}

const WORD = /[\p{L}\p{N}]/u;
/** A German case ending after a name: "des Zwingers", "Residenzschlosses". */
const ENDING = /^(?:es|en|ns|s|n)?(?![\p{L}\p{N}])/u;

/** Where `alias` first stands in `text` as a whole word (a case ending
 *  allowed): its start and end, or null. */
function findWord(
  text: string,
  alias: string
): { at: number; end: number } | null {
  // a letter whose lower case is longer ("İ") would shift every index:
  // then only the name as written is found
  const folds = text.toLowerCase().length === text.length;
  const lower = folds ? text.toLowerCase() : text;
  const a = folds ? alias.toLowerCase() : alias;
  for (let i = lower.indexOf(a); i >= 0; i = lower.indexOf(a, i + 1)) {
    const end = ENDING.exec(text.slice(i + a.length));
    // a name inside a longer word ("Domplatz" for "Dom") is not it
    if ((i === 0 || !WORD.test(text[i - 1])) && end) {
      return { at: i, end: i + a.length + end[0].length };
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
  places.forEach((p, place) => {
    if (linked.has(place)) {
      return;
    }
    for (const alias of aliasesOf(p.name, city)) {
      const hit = findWord(text, alias);
      if (hit) {
        hits.push({ ...hit, place });
        return;
      }
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
