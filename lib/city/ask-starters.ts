/**
 * The first questions *Frag die Stadt* offers (plan 081): four, drawn
 * anew each time the card opens, from the moment — the landmark ahead or
 * nearby, the scene's hour, the season and the day, what the city has
 * (a river with gauges, data layers) — and from a pool of curious and
 * playful ones. Every question is one the tools can answer.
 */

/** A landmark as the tileset lists it (site CRS). */
export interface StarterLandmark {
  name: string;
  x: number;
  y: number;
}

/** What the draw reads of the moment. */
export interface StarterContext {
  /** the camera (site CRS) and its heading (degrees, clockwise from north) */
  at: { x: number; y: number; headingDeg: number } | null;
  /** the scene's time */
  now: Date;
  landmarks: readonly StarterLandmark[];
  /** the name of the site's river, where it has one with gauges
   *  (ADR 0058; German rivers with gauges here are feminine: die Elbe) */
  river: string | null;
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
  "Zeig mir die ältesten Häuser hier in der Nähe.",
  "Welche Denkmäler stehen hier um die Ecke?",
];

const HOURS: Record<"morning" | "day" | "evening" | "night", string[]> = {
  morning: [
    "Wie sieht dieser Platz im Morgenlicht aus?",
    "Wo fällt hier am Morgen die erste Sonne hin?",
  ],
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
    "Welche Gebäude sind nachts angestrahlt?",
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
      "Wie kurz ist der Schatten hier am kürzesten Tag?",
      "Zeig mir den Platz am 21. Dezember um 15 Uhr.",
    ];
  }
  if (m === 6 && d >= 14 && d <= 28) {
    return ["Wie steht die Sonne hier zur Sommersonnenwende?"];
  }
  if (m === 12) {
    return ["Wo standen hier früher Weihnachtsmärkte?"];
  }
  if (m >= 9 && m <= 11) {
    return [
      "Zeig mir diesen Ort im Herbstlicht.",
      "Welche Bäume färben sich hier zuerst?",
    ];
  }
  if (m >= 3 && m <= 5) {
    return ["Wie sieht es hier im Frühling am Morgen aus?"];
  }
  if (m >= 6 && m <= 8) {
    return ["Wo findet man hier im Sommer Schatten?"];
  }
  return ["Wie lang sind die Schatten hier im Winter mittags?"];
}

function cityQuestions(ctx: StarterContext): string[] {
  const out: string[] = [];
  if (ctx.river) {
    out.push(
      `Wie hoch stand die ${ctx.river} 2002 hier?`,
      "Welche Häuser stünden bei einem Jahrhunderthochwasser unter Wasser?"
    );
  }
  if (ctx.layers.includes("tramLayer")) {
    out.push("Wo fahren gerade Straßenbahnen?");
  }
  if (ctx.layers.includes("trafficLayer")) {
    out.push("Wo ist hier am meisten Verkehr?");
  }
  if (ctx.layers.includes("bikeLayer")) {
    out.push("Wie viele Räder sind heute hier gezählt worden?");
  }
  return out;
}

const CURIOUS = [
  "Welches ist das höchste Gebäude der Stadt?",
  "Zeig mir das älteste Gebäude der Stadt.",
  "Welches Denkmal hier ist am seltsamsten?",
  "Welche Gebäude sind nach einer Frau benannt?",
  "Welche Kirche hat den höchsten Turm?",
  "Wo steht das kleinste Denkmal der Stadt?",
  "Welches Wahrzeichen wurde am häufigsten umgebaut?",
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

/**
 * Four first questions for the moment: a place question (the landmark
 * ahead, else the nearest, else the neighbourhood), a time question (the
 * hour or the season), a city question where the site has one, and the
 * rest curious or playful — no two the same.
 */
export function starterQuestions(
  ctx: StarterContext,
  random: () => number = Math.random
): string[] {
  const { ahead, near } = placesAround(ctx);
  const place = ahead
    ? one(AHEAD, random)?.(ahead.name)
    : near
      ? one(NEAR, random)?.(near.name)
      : one(NO_PLACE, random);
  const time =
    random() < 0.5
      ? one(HOURS[hourKind(ctx.now)], random)
      : one(seasonQuestions(ctx.now), random);
  const city = one(cityQuestions(ctx), random);
  const out = [place, time, city].filter((q): q is string => q !== undefined);
  const rest = [...CURIOUS, ...PLAY];
  while (out.length < STARTERS && rest.length > 0) {
    const i = Math.min(rest.length - 1, Math.floor(random() * rest.length));
    const [q] = rest.splice(i, 1);
    if (!out.includes(q)) {
      out.push(q);
    }
  }
  return out;
}
