/**
 * The first questions *Frag die Stadt* offers (plan 081): four, drawn
 * anew each time the card opens, from the moment — the landmark ahead or
 * nearby, the scene's hour, the season and the day, what the city has
 * (a river with gauges and whether its floods reached the camera, data
 * layers) — and from a pool of curious and playful ones. Every question
 * is one the tools can answer where it is offered; the Prüfstand
 * (ask-qa.ts) asks them all and says which to keep.
 */

import { floodSurface, type River } from "./scenario";

/** A landmark as the tileset lists it (site CRS). */
export interface StarterLandmark {
  name: string;
  x: number;
  y: number;
}

/** The river as the draw reads it: its highest flood, and how deep that
 *  flood stood over the ground where the camera is. */
export interface StarterRiver {
  name: string;
  /** the highest flood's id (a year) */
  event: string;
  /** the water over the ground at the camera in that flood (m; below
   *  zero the ground stood dry), null where the ground is not loaded */
  depth: number | null;
}

/** The river as the draw reads it at `at`, given the ground there
 *  (m a.s.l., null where none is loaded). */
export function starterRiver(
  river: River | null,
  epsg: number,
  at: { x: number; y: number } | null,
  ground: number | null
): StarterRiver | null {
  if (!river || river.events.length === 0) {
    return null;
  }
  const top = river.events.reduce((a, b) => (b.cm > a.cm ? b : a));
  const depth =
    at && ground !== null
      ? floodSurface(river, epsg, top.cm)(at.x, at.y) - ground
      : null;
  return {
    name: river.name,
    event: top.id,
    depth: depth !== null && Number.isFinite(depth) ? depth : null,
  };
}

/** What the draw reads of the moment. */
export interface StarterContext {
  /** the camera (site CRS) and its heading (degrees, clockwise from north) */
  at: { x: number; y: number; headingDeg: number } | null;
  /** the scene's time */
  now: Date;
  landmarks: readonly StarterLandmark[];
  /** the site's river, where it has gauges (ADR 0058; German rivers
   *  with gauges here are feminine: die Elbe) */
  river: StarterRiver | null;
  /** the data layers the site has */
  layers: readonly string[];
}

/** How far ahead a landmark may stand off the view's centre (degrees). */
const AHEAD_DEG = 25;
/** How far a landmark ahead may be (m). */
const AHEAD_M = 1500;
/** How far a nearby landmark may be (m). */
const NEAR_M = 800;
/** The questions a set holds. */
export const STARTERS = 4;

type Case = "nom" | "dat";
type Gender = "f" | "m" | "n";

/** The gender a landmark's name most likely has, by its last word's
 *  ending; null where it cannot be told (then no article is used). */
export function genderOf(name: string): Gender | null {
  const word = (name.split(/[\s-]/).at(-1) ?? "").toLowerCase();
  const ends = (list: readonly string[]) => list.some((e) => word.endsWith(e));
  if (
    ends([
      "kirche",
      "oper",
      "brücke",
      "burg",
      "halle",
      "galerie",
      "akademie",
      "kapelle",
      "bibliothek",
      "schule",
      "universität",
      "kathedrale",
      "synagoge",
      "moschee",
      "börse",
      "mühle",
      "terrasse",
      "villa",
      "bastei",
      "festung",
      "kaserne",
      "station",
      "ruine",
      "säule",
      "fabrik",
    ])
  ) {
    return "f";
  }
  if (
    ends([
      "schloss",
      "haus",
      "palais",
      "theater",
      "museum",
      "denkmal",
      "tor",
      "gebäude",
      "hotel",
      "zentrum",
      "stadion",
      "kino",
      "werk",
      "amt",
      "gericht",
      "ministerium",
      "kloster",
      "stift",
      "münster",
      "schlösschen",
      "center",
    ])
  ) {
    return "n";
  }
  if (
    ends([
      "turm",
      "dom",
      "zwinger",
      "palast",
      "bahnhof",
      "garten",
      "platz",
      "markt",
      "hof",
      "bau",
      "brunnen",
      "tempel",
      "pavillon",
      "speicher",
      "bunker",
    ])
  ) {
    return "m";
  }
  return null;
}

const ARTICLE: Record<Case, Record<Gender, string>> = {
  nom: { f: "die", m: "der", n: "das" },
  dat: { f: "der", m: "dem", n: "dem" },
};

/** "die Frauenkirche", "dem Zwinger" — or the name in quotes where its
 *  gender cannot be told. */
export function withArticle(name: string, c: Case): string {
  const g = genderOf(name);
  return g ? `${ARTICLE[c][g]} ${name}` : `„${name}“`;
}

/** A template with the place filled in. */
type Template = (place: string) => string;

// Every question is one the tools can answer from where it is offered:
// the facts in Stadtwissen (no building's age, no floodlights, no
// counts), a lookup or two, a change of the view.
const AHEAD: readonly Template[] = [
  (p) => `Was ist ${withArticle(p, "nom")} dort vorn?`,
  (p) => `Wer hat ${withArticle(p, "nom")} gebaut?`,
  (p) => `Wie alt ist ${withArticle(p, "nom")} vor mir?`,
  (p) => `Was ist das Kurioseste an ${withArticle(p, "dat")}?`,
];
const NEAR: readonly Template[] = [
  (p) => `Erzähl mir etwas Überraschendes zu ${withArticle(p, "dat")}.`,
  (p) => `Wie hoch ist ${withArticle(p, "nom")} eigentlich?`,
  (p) => `Zeig mir ${withArticle(p, "nom")} von oben.`,
  (p) => `Wonach ist ${withArticle(p, "nom")} benannt?`,
];
const NO_PLACE = [
  "Was steht hier vor mir?",
  "Welche Häuser hier stehen unter Denkmalschutz?",
  "Welche Denkmäler stehen hier um die Ecke?",
  "Wo kann man hier einkaufen oder essen?",
];

const HOURS: Record<"morning" | "day" | "evening" | "night", string[]> = {
  morning: ["Wie sieht dieser Platz im Morgenlicht aus?"],
  day: [
    "Zeig mir den Schattenwurf hier am späten Nachmittag.",
    "Wie sieht es hier bei Sonnenuntergang aus?",
  ],
  evening: [
    "Zeig mir die Stadt in der blauen Stunde.",
    "Wie sieht es hier bei Nacht aus?",
  ],
  night: [
    "Zeig mir den Sonnenaufgang von hier.",
    "Wie sieht dieser Platz am Mittag aus?",
  ],
};

/** The hour's kind, by the scene's local hour. */
function hourKind(now: Date): keyof typeof HOURS {
  const h = now.getHours();
  if (h >= 5 && h < 10) {
    return "morning";
  }
  if (h >= 10 && h < 17) {
    return "day";
  }
  return h >= 17 && h < 22 ? "evening" : "night";
}

/** A question for the day or the season; a special day wins. */
function seasonQuestions(now: Date): string[] {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  if ((m === 12 && d >= 18) || (m === 1 && d <= 2)) {
    return [
      "Wie lang ist der Schatten hier am kürzesten Tag?",
      "Zeig mir den Platz am 21. Dezember um 15 Uhr.",
    ];
  }
  if (m === 6 && d >= 14 && d <= 28) {
    return ["Wie steht die Sonne hier zur Sommersonnenwende?"];
  }
  if (m === 12) {
    return ["Zeig mir diesen Platz an einem Dezembernachmittag."];
  }
  if (m >= 9 && m <= 11) {
    return ["Zeig mir diesen Ort im Herbstlicht."];
  }
  if (m >= 3 && m <= 5) {
    return ["Wie sieht es hier im Frühling am Morgen aus?"];
  }
  if (m >= 6 && m <= 8) {
    return ["Zeig mir die Schatten hier an einem Sommermittag."];
  }
  return ["Wie lang sind die Schatten hier im Winter mittags?"];
}

/** How far above the highest flood the ground may stand for "here" to
 *  be a flood question still (m): a bank, a street behind the wall. */
const FLOOD_HERE_M = 1;

function cityQuestions(ctx: StarterContext): string[] {
  const out: string[] = [];
  const river = ctx.river;
  if (river) {
    // "here" only where that flood reached, or nearly: on a hill the
    // question has no answer but "dry"
    const wet = river.depth !== null && river.depth > -FLOOD_HERE_M;
    out.push(
      ...(wet
        ? [
            `Wie hoch stand die ${river.name} ${river.event} hier?`,
            `Stünde dieser Platz bei einem Hochwasser wie ${river.event} unter Wasser?`,
          ]
        : [
            `Welche Häuser stünden bei einem Hochwasser wie ${river.event} unter Wasser?`,
            `Zeig mir das Hochwasser von ${river.event}.`,
          ])
    );
  }
  if (ctx.layers.includes("tramLayer")) {
    out.push("Zeig mir die Straßenbahnen.");
  }
  if (ctx.layers.includes("trafficLayer")) {
    out.push("Zeig mir den Autoverkehr hier.");
  }
  if (ctx.layers.includes("bikeLayer")) {
    out.push("Zeig mir den Radverkehr.");
  }
  return out;
}

const CURIOUS = [
  "Welches Gebäude hier in der Nähe ist das höchste?",
  "Welche Kirche hat den höchsten Turm?",
  "Welches Denkmal hier ist am seltsamsten?",
];
const PLAY = [
  "Zeig mir das Ganze als Comic.",
  "Was würde ein 80 m hoher Turm hier beschatten?",
  "Zeig mir die Stadt wie ein Architekturmodell.",
  "Wie sähe dieser Ort als Film noir aus?",
];

/** Distance and bearing (degrees from north) from `a` to `b`. */
function towards(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { d: number; bearing: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    d: Math.hypot(dx, dy),
    bearing: (Math.atan2(dx, dy) * 180) / Math.PI,
  };
}

/** The smallest angle between two headings (degrees). */
function offBy(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** The landmark the view looks at, and the nearest one. */
export function placesAround(ctx: Pick<StarterContext, "at" | "landmarks">): {
  ahead: StarterLandmark | null;
  near: StarterLandmark | null;
} {
  const at = ctx.at;
  if (!at) {
    return { ahead: null, near: null };
  }
  let ahead: { lm: StarterLandmark; score: number } | null = null;
  let near: { lm: StarterLandmark; d: number } | null = null;
  for (const lm of ctx.landmarks) {
    const { d, bearing } = towards(at, lm);
    const off = offBy(bearing, at.headingDeg);
    if (d <= AHEAD_M && d > 15 && off <= AHEAD_DEG) {
      // nearer and more central wins
      const score = d * (1 + off / AHEAD_DEG);
      if (!ahead || score < ahead.score) {
        ahead = { lm, score };
      }
    }
    if (d <= NEAR_M && (!near || d < near.d)) {
      near = { lm, d };
    }
  }
  return { ahead: ahead?.lm ?? null, near: near?.lm ?? null };
}

/** One of `list`, by `random` (in [0, 1)). */
function one<T>(list: readonly T[], random: () => number): T | undefined {
  return list.length > 0
    ? list[Math.min(list.length - 1, Math.floor(random() * list.length))]
    : undefined;
}

/** Which slot of a set a question fills. */
export type StarterKind = "ort" | "zeit" | "stadt" | "frei";

/** A question the moment can offer, and its slot. */
export interface StarterCandidate {
  kind: StarterKind;
  question: string;
}

/**
 * Every question the draw could offer in `ctx`, by slot: the place's
 * (the landmark ahead, else the nearest, else the neighbourhood), the
 * hour's and the season's, the city's, and the free ones. The draw takes
 * from it; the Prüfstand (ask-qa.ts) asks all of them.
 */
export function starterPool(ctx: StarterContext): StarterCandidate[] {
  const { ahead, near } = placesAround(ctx);
  const place = ahead
    ? AHEAD.map((t) => t(ahead.name))
    : near
      ? NEAR.map((t) => t(near.name))
      : NO_PLACE;
  const time = [...HOURS[hourKind(ctx.now)], ...seasonQuestions(ctx.now)];
  return [
    ...place.map((question) => ({ kind: "ort" as const, question })),
    ...time.map((question) => ({ kind: "zeit" as const, question })),
    ...cityQuestions(ctx).map((question) => ({
      kind: "stadt" as const,
      question,
    })),
    ...[...CURIOUS, ...PLAY].map((question) => ({
      kind: "frei" as const,
      question,
    })),
  ];
}

/**
 * Four first questions for the moment: one of the place's, one of the
 * hour's or the season's (as likely either), one of the city's where the
 * site has one, and the rest free — no two the same.
 */
export function starterQuestions(
  ctx: StarterContext,
  random: () => number = Math.random
): string[] {
  const pool = starterPool(ctx);
  const of = (kind: StarterKind) =>
    pool.filter((c) => c.kind === kind).map((c) => c.question);
  const hours = HOURS[hourKind(ctx.now)];
  const times = of("zeit");
  const time =
    random() < 0.5
      ? one(hours, random)
      : one(times.slice(hours.length), random);
  const out = [one(of("ort"), random), time, one(of("stadt"), random)].filter(
    (q): q is string => q !== undefined
  );
  const rest = of("frei");
  while (out.length < STARTERS && rest.length > 0) {
    const i = Math.min(rest.length - 1, Math.floor(random() * rest.length));
    const [q] = rest.splice(i, 1);
    if (!out.includes(q)) {
      out.push(q);
    }
  }
  return out;
}
