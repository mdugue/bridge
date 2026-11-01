/**
 * The Prüfstand of *Frag die Stadt* (ADR 0056): every first question the
 * card could offer (`starterPool`), asked at the places that matter —
 * before the city's most notable landmarks, spread over the city, at
 * every kind of hour, and once where no landmark is near — of every model
 * the visitor's key reaches, and each answer judged by a thorough model:
 * does the question fit the place, do the data answer it, is the answer
 * right, and should the question stay, change or go. Pure: the route
 * (`app/api/frag/pruefen/route.ts`) plans and runs a case with it, the
 * card's panel (`app/_components/ask-qa.tsx`) sums the results up
 * (`ask-qa-report.ts`).
 */
import { z } from "zod";
import type { AskVisitor } from "./ask-city";
import { hitOf, type Knowledge, nearKnowledge } from "./ask-knowledge";
import {
  type StarterKind,
  starterPool,
  starterRiver,
  withArticle,
} from "./ask-starters";
import { riverOf } from "./scenario";

/** Where a case is asked: a pose before a landmark, or one far from any. */
export interface QaPlace {
  /** what the place is called in the report */
  name: string;
  x: number;
  y: number;
  /** the view's heading (degrees, clockwise from north) */
  heading: number;
  /** the ground there (m a.s.l.), where the twin knows it */
  ground: number | null;
  /** the landmark the view looks at (Wikidata id), if any */
  ahead: string | null;
}

/** One question at one place, at one hour. */
export interface QaCase {
  id: string;
  kind: StarterKind;
  /** the question as the card offers it */
  question: string;
  /** the same with the place's name taken out: what the report sums by */
  template: string;
  place: QaPlace;
  /** the scene's time the question is asked at (ISO) */
  at: string;
}

/** How far a pose stands before its landmark (m): back from a tall one. */
function standOff(h: number): number {
  return Math.min(Math.max(h * 1.6, 90), 260);
}

/** How far apart two landmark places are at least (m). */
const SPREAD_M = 600;
/** How far a place without a landmark is from every one at least (m): the
 *  starters' NEAR_M, so none counts as near. */
const ALONE_M = 800;
/** The hours the places are asked at, in turn: morning, day, evening,
 *  night (the starters' hour kinds). */
const HOURS = [8, 13, 19, 23];
/** How many places ask the questions that do not name the place. */
const FREE_PLACES = 2;

/**
 * The places of a run: the most notable landmarks (most Wikipedia
 * articles), each at least SPREAD_M from the others, seen from the south
 * at a distance that fits their height — and, where the city has one,
 * the building farthest from any landmark, for the questions of a place
 * without one.
 */
export function qaPlaces(k: Knowledge, count: number): QaPlace[] {
  const sorted = [...k.index.landmarks].sort((a, b) => b.links - a.links);
  const picked: typeof sorted = [];
  for (const lm of sorted) {
    if (picked.length >= Math.max(count - 1, 1)) {
      break;
    }
    if (picked.every((p) => Math.hypot(p.x - lm.x, p.y - lm.y) >= SPREAD_M)) {
      picked.push(lm);
    }
  }
  const places: QaPlace[] = picked.map((lm) => ({
    name: `vor ${lm.name}`,
    x: Math.round(lm.x),
    y: Math.round(lm.y - standOff(lm.h)),
    heading: 0,
    ground: lm.z ?? null,
    ahead: lm.id,
  }));
  const lonely = loneliestBuilding(k);
  if (lonely && places.length < count) {
    places.push({
      name: lonely.name ?? lonely.addr ?? "abseits",
      x: Math.round(lonely.x),
      y: Math.round(lonely.y - 30),
      heading: 0,
      ground: lonely.z,
      ahead: null,
    });
  }
  return places;
}

/** The named or addressed building farthest from every landmark, if it
 *  stands ALONE_M off them (sampled: every one is not needed). */
function loneliestBuilding(k: Knowledge) {
  const step = Math.max(1, Math.floor(k.buildings.length / 4000));
  let best: { b: Knowledge["buildings"][number]; d: number } | null = null;
  for (let i = 0; i < k.buildings.length; i += step) {
    const b = k.buildings[i];
    if (b.name === undefined && b.addr === undefined) {
      continue;
    }
    let d = Number.POSITIVE_INFINITY;
    for (const lm of k.index.landmarks) {
      d = Math.min(d, Math.hypot(lm.x - b.x, lm.y - b.y));
    }
    if (d >= ALONE_M && (!best || d > best.d)) {
      best = { b, d };
    }
  }
  return best?.b ?? null;
}

/** `question` with the landmark's name, in either case, as `{ort}`. */
function templateOf(question: string, name: string | null): string {
  if (!name) {
    return question;
  }
  return [withArticle(name, "nom"), withArticle(name, "dat"), name].reduce(
    (q, form) => q.split(form).join("{ort}"),
    question
  );
}

/**
 * Every case of a run: at each place every question of its pool that
 * names the place (`ort`) or reads its ground (`stadt`), each place at
 * another kind of hour; the others (`zeit`, `frei`) only at the first
 * FREE_PLACES places.
 */
export function qaCases(
  k: Knowledge,
  site: { epsg: number; id: string; layerKeys: readonly string[] },
  places: readonly QaPlace[],
  today: Date
): QaCase[] {
  const river = riverOf(site.id);
  const landmarks = k.index.landmarks.map((lm) => ({
    name: lm.name,
    x: lm.x,
    y: lm.y,
  }));
  const out: QaCase[] = [];
  places.forEach((place, i) => {
    const now = new Date(today);
    now.setHours(HOURS[i % HOURS.length], 0, 0, 0);
    const name = place.ahead ? (hitOf(k, place.ahead)?.name ?? null) : null;
    const pool = starterPool({
      at: { x: place.x, y: place.y, headingDeg: place.heading },
      now,
      landmarks,
      river: starterRiver(river, site.epsg, place, place.ground),
      layers: site.layerKeys,
    });
    for (const c of pool) {
      if (i >= FREE_PLACES && (c.kind === "zeit" || c.kind === "frei")) {
        continue;
      }
      out.push({
        id: `${i}-${out.length}`,
        kind: c.kind,
        question: c.question,
        template: templateOf(c.question, name),
        place,
        at: now.toISOString(),
      });
    }
  });
  return out;
}

const WHEN = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

/** The visitor a case asks as: on foot at its place, in Pastell. */
export function qaVisitor(c: QaCase): AskVisitor {
  return {
    x: c.place.x,
    y: c.place.y,
    ...(c.place.ground === null
      ? {}
      : { hoehe_ue_nn: Math.round(c.place.ground + 1.6) }),
    blick_grad: c.place.heading,
    neigung_grad: 0,
    modus: "walk",
    zeit: WHEN.format(new Date(c.at)),
    stil: "pastel",
    ebenen: [],
  };
}

/** What `was_ist_da` finds at a case's place, from the twin: the
 *  landmark it looks at, else the nearest named building ahead. */
export function qaLook(k: Knowledge, place: QaPlace): Record<string, unknown> {
  const hit = place.ahead ? hitOf(k, place.ahead) : null;
  if (hit) {
    return { gefunden: true, ...hit };
  }
  const rad = (place.heading * Math.PI) / 180;
  const [near] = nearKnowledge(
    k,
    place.x + Math.sin(rad) * 40,
    place.y + Math.cos(rad) * 40,
    40
  );
  return near
    ? { gefunden: true, ...near }
    : {
        gefunden: false,
        hinweis: "In der Bildmitte steht nichts, was das Modell kennt.",
      };
}

// --- one answer, as the route records it ------------------------------------------

/** A tool the answer called: its name, input and (shortened) result. */
export interface QaCall {
  name: string;
  input: unknown;
  result?: string;
}

/** One answer of one model to one case. */
export interface QaAnswer {
  calls: QaCall[];
  /** a provider's error, scrubbed, if the answer broke off */
  error?: string;
  /** from the request to the first word of the answer (ms), if any */
  firstTextMs: number | null;
  text: string;
  totalMs: number;
  /** the model turns it took */
  turns: number;
}

/** The most of a tool's result the judge reads (characters). */
const RESULT_CHARS = 1500;

type Chunk = { type: string } & Record<string, unknown>;

/** A chunk's field as text: a string as it is, anything else empty. */
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Builds a `QaAnswer` from the stream's chunks as they come. */
export function answerRecorder() {
  const answer: QaAnswer = {
    calls: [],
    firstTextMs: null,
    text: "",
    totalMs: 0,
    turns: 0,
  };
  const turns = new Set<string>();
  const byId = new Map<string, QaCall>();
  const args = new Map<string, string>();
  /** a tool call's chunks: its start, its arguments, its end, its result */
  const toolChunk = (chunk: Chunk) => {
    const id = str(chunk.toolCallId);
    const call = byId.get(id);
    if (chunk.type === "TOOL_CALL_START") {
      turns.add(str(chunk.parentMessageId) || id);
      const started: QaCall = {
        name: str(chunk.toolCallName) || str(chunk.toolName),
        input: {},
      };
      byId.set(id, started);
      answer.calls.push(started);
    } else if (chunk.type === "TOOL_CALL_ARGS") {
      args.set(id, (args.get(id) ?? "") + str(chunk.delta));
    } else if (chunk.type === "TOOL_CALL_END" && call) {
      call.input = chunk.input ?? parsed(args.get(id));
    } else if (chunk.type === "TOOL_CALL_RESULT" && call) {
      const raw =
        typeof chunk.content === "string"
          ? chunk.content
          : JSON.stringify(chunk.content);
      call.result = raw.slice(0, RESULT_CHARS);
    }
  };
  const take = (raw: { type: string }, ms: number) => {
    const chunk = raw as Chunk;
    if (chunk.type === "TEXT_MESSAGE_START") {
      turns.add(str(chunk.messageId));
    } else if (chunk.type === "TEXT_MESSAGE_CONTENT") {
      const delta = str(chunk.delta);
      if (delta.trim() !== "") {
        answer.firstTextMs ??= ms;
      }
      answer.text += delta;
    } else if (chunk.type.startsWith("TOOL_CALL_")) {
      toolChunk(chunk);
    } else if (chunk.type === "RUN_ERROR") {
      answer.error = str(chunk.message) || "Fehler";
    }
    answer.totalMs = ms;
    answer.turns = turns.size;
  };
  return { answer, take };
}

function parsed(raw: string | undefined): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return raw;
  }
}

// --- the judge ---------------------------------------------------------------------

/** What the judge says of one answer to one case. */
export const QA_VERDICT = z.object({
  ort_passt: z
    .number()
    .int()
    .min(0)
    .max(2)
    .describe("passt die Frage zu Ort und Zeit, an dem sie angeboten wird"),
  daten_reichen: z
    .number()
    .int()
    .min(0)
    .max(2)
    .describe("liefern die Werkzeuge, was die Antwort braucht"),
  antwort: z
    .number()
    .int()
    .min(0)
    .max(2)
    .describe("ist die Antwort richtig, belegt, knapp und zeigt den Ort"),
  erfunden: z
    .boolean()
    .describe(
      "behauptet die Antwort etwas, das nicht in den Werkzeugergebnissen steht und nicht als allgemeines Wissen gekennzeichnet ist"
    ),
  urteil: z.enum(["behalten", "anpassen", "ersetzen"]),
  vorschlag: z
    .string()
    .max(90)
    .describe(
      "bei anpassen oder ersetzen: die bessere Frage, höchstens 70 Zeichen, sonst leer"
    ),
  begruendung: z.string().max(300).describe("ein Satz"),
});

export type QaVerdict = z.infer<typeof QA_VERDICT>;

/** The judge's standing instructions. */
export const QA_JUDGE_PROMPT = [
  "Du prüfst die Startfragen von „Frag die Stadt“, einem KI-Stadtführer in einem digitalen 3D-Stadtmodell aus offenen Geodaten. Bevor ein Besucher selbst etwas fragt, bietet die Karte ihm vier Fragen zum Antippen an; sie sollen zum Ort, zur Uhrzeit und zu dem passen, was das Stadtmodell weiß, und sie sollen neugierig machen.",
  "Was das Stadtmodell weiß: zu Wahrzeichen Wikidatas Aussagen (Architekt, Baustil, Entstehung, Ereignisse, benannt nach …) und Höhe; zu Gebäuden Name, Adresse, Nutzung, Höhe, Dachform, Geschosse, Denkmalschutz, ob ein Laden darin ist — kein Baujahr; zu Denkmalen Name, Art, Material; Hochwasser und Schattenwurf als Modellrechnung. Was es tun kann: die Ansicht hinfliegen, Uhrzeit und Datum stellen (Sonne, Schatten, Nacht), den Bildstil wechseln, Datenebenen zeigen.",
  "Du bekommst eine Frage, den Ort, an dem sie angeboten wurde, die Werkzeuge, die das Modell aufgerufen hat, mit ihren Ergebnissen, und die Antwort. Sei streng: Eine Frage, die das Modell nur aus allgemeinem Wissen, nur ungefähr oder gar nicht beantworten kann, oder die an diesem Ort oder zu dieser Zeit keinen Sinn ergibt, wird angepasst oder ersetzt — mit einem konkreten Vorschlag, der dieselbe Neugier weckt und sich aus den Daten beantworten lässt. Eine gute Frage mit einer schwachen Antwort bleibt; sag dann in der Begründung, was an der Antwort fehlte.",
].join("\n\n");

/** The judge's message for one answer. */
export function judgeMessage(c: QaCase, a: QaAnswer): string {
  const calls = a.calls
    .map(
      (call) =>
        `- ${call.name}(${JSON.stringify(call.input)}) → ${call.result ?? "(kein Ergebnis)"}`
    )
    .join("\n");
  return [
    `Frage: „${c.question}“ (Art: ${c.kind})`,
    `Ort: ${c.place.name} (x ${c.place.x}, y ${c.place.y}, Blick ${c.place.heading}°), Szenenzeit ${WHEN.format(new Date(c.at))}`,
    `Werkzeuge:\n${calls || "- keine"}`,
    `Antwort (${a.turns} Modellschritte, ${Math.round(a.totalMs / 100) / 10} s):\n${a.text.trim() || "(kein Text)"}`,
    ...(a.error ? [`Fehler: ${a.error}`] : []),
  ].join("\n\n");
}
