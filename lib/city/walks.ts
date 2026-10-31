/**
 * Erzählte Spaziergänge: a walk is a sequence of stops, each a view (where
 * the eye stands, what it looks at, at which hour, in which picture style),
 * a narration and the facts it rests on with their sources. Walks are
 * written ahead — by Claude, from the Stadtwissen (lib/city/stadtwissen.ts)
 * and the sources each fact names — committed as
 * `data/<site>/walks/<id>.json`, checked by `walks.test.ts` and published
 * by `prepare-data.ts` as one `walks.json`; the viewer plays them
 * (`app/_components/walk-player.tsx`). The narration is marked as written
 * by Claude wherever it shows; the facts carry their sources (ADR 0042,
 * ADR 0055). No THREE, no DOM.
 */
import { isRenderStyle, type RenderStyle } from "./render-style";
import type { MovementMode, ViewpointGeometry } from "./site";
import type { CameraStateJson } from "./snapshot";

/** The published bundle under `public/data/<site>/`. */
export const WALKS_FILE = "walks.json";
/** Where a site's walks are written, relative to its data folder. */
export const WALKS_DIR = "walks";

/** What the tileset's `extras` add for the walks. Kept here, not in
 *  tileset.ts's `TilesetExtras`: that module is in every ground's bake key
 *  (bake-entries.ts `GROUND`), and the walks re-bake nothing. */
export interface WalksExtras {
  /** the site's walks, relative to the tileset; absent where it has none */
  walks?: string;
}

/** A claim a stop makes, and where it can be checked. */
export interface WalkFact {
  /** one sentence, as the stop tells it */
  claim: string;
  /** an https URL, or `stadtwissen:<id>` (a Building's gml:id or a Q-id) */
  source: string;
}

/** A paragraph a stop adds on and around certain days of the year. */
export interface WalkDay {
  /** first day, "MM-DD" */
  from: string;
  /** last day, "MM-DD" (may wrap past the year's end) */
  to: string;
  text: string;
}

export type Season = "autumn" | "spring" | "summer" | "winter";

/**
 * A photograph of what the stop is about, from Wikimedia Commons: what
 * the model cannot draw (a gilded rider, a carved portal) is seen here.
 * The author names `file`; `bun scripts/walks.ts <site> photos` fetches
 * a small copy into `walks/photos/` (the site serves it itself: no
 * request to Wikimedia from the visitor's browser) and writes the credit
 * Commons gives. `src` is the published copy's name, set by the build.
 */
export interface WalkPhoto {
  /** the photographer as Commons credits them */
  author: string;
  /** what the photo shows, where the text needs it said */
  caption?: string;
  /** the Commons file name ("Dresden Goldener Reiter.jpg") */
  file: string;
  /** the copy's size (px) */
  h: number;
  /** its licence's short name ("CC BY-SA 4.0", "Public domain") */
  licence: string;
  /** the licence's text, where it has one */
  licenceUrl?: string;
  /** the file's page on Commons */
  page: string;
  /** the published copy, beside walks.json (set by prepare-data) */
  src?: string;
  w: number;
}

/** Where a stop's photo lies in the site's walks folder. */
export const walkPhotoFile = (walk: string, stop: string): string =>
  `photos/${walk}--${stop}.webp`;

export interface WalkStop {
  /** what the eye looks at: site CRS x, y and the height (m a.s.l.) */
  at: [number, number, number];
  /** a paragraph for this time of year */
  seasons?: Partial<Record<Season, string>>;
  /** a closer look: the detail to find in the picture */
  closer?: string;
  /** paragraphs for certain days of the year */
  days?: WalkDay[];
  facts: WalkFact[];
  /** lens (degrees, vertical); 60 when absent */
  fov?: number;
  /** where the eye stands: site CRS x, y and metres above the ground there */
  from: [number, number, number];
  /**
   * The ground under `from` (m a.s.l., the DGM1): the stop's pitch is
   * reckoned from it. Written by `bun scripts/walks.ts <site> ground`,
   * checked against the DGM by walks.test.ts.
   */
  ground: number;
  /** the hour of the visitor's day to show it at (today's date) */
  hour: number;
  id: string;
  /** walk (on the ground) or fly; walk when the eye is below 3 m */
  mode?: MovementMode;
  /** the Stadtwissen entries it is about (Q-ids, Building ids) */
  refs?: string[];
  /** the photo the card shows above the text */
  photo?: WalkPhoto;
  /** the picture style for this stop; Pastell when absent */
  style?: RenderStyle;
  /** the narration, written by Claude */
  text: string;
  title: string;
}

export interface Walk {
  /** who wrote the narration (shown on every stop) */
  by: string;
  id: string;
  /** about how long the walk takes to read and look, minutes */
  minutes: number;
  stops: WalkStop[];
  /** one sentence: what the walk is about */
  teaser: string;
  title: string;
  /** when it was written, YYYY-MM-DD */
  written: string;
}

/** What the viewer loads: the site's walks in their order. */
export interface WalkBundle {
  site: string;
  walks: Walk[];
}

const DEG = 180 / Math.PI;
/** The eye height up to which a stop stands on the ground. */
const WALK_EYE_MAX = 3;

/** The stop's view as a glide target. */
export function stopView(stop: WalkStop): ViewpointGeometry {
  const [fx, fy, above] = stop.from;
  const [ax, ay, az] = stop.at;
  const dx = ax - fx;
  const dy = ay - fy;
  const run = Math.hypot(dx, dy);
  const heading = (Math.atan2(dx, dy) * DEG + 360) % 360;
  const pitch = Math.atan2(az - (stop.ground + above), Math.max(run, 1)) * DEG;
  return {
    epsg: { x: fx, y: fy },
    aboveGround: above,
    headingDeg: Math.round(heading * 10) / 10,
    pitchDeg: Math.round(pitch * 10) / 10,
    fov: stop.fov ?? 60,
    mode: stop.mode ?? (above <= WALK_EYE_MAX ? "walk" : "fly"),
  };
}

/**
 * The stop as a camera state (snapshot.ts), put in place at once: the
 * player jumps with it out of Modell, where a glide cannot go, and the
 * shot plates start from it. World = (x − cx, z, −(y − cy)).
 */
export function stopCamera(
  stop: WalkStop,
  offset: { cx: number; cy: number }
): CameraStateJson {
  const view = stopView(stop);
  const [fx, fy, above] = stop.from;
  return {
    epsg: { x: fx, y: fy },
    pos: { x: fx - offset.cx, y: stop.ground + above, z: -(fy - offset.cy) },
    headingDeg: view.headingDeg,
    pitchDeg: view.pitchDeg,
    fov: view.fov,
    mode: view.mode,
  };
}

/** The stop's hour on the visitor's day (local time). */
export function stopDate(stop: WalkStop, today: Date): Date {
  const minutes = Math.round(stop.hour * 60);
  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    Math.floor(minutes / 60),
    minutes % 60
  );
}

/** The meteorological season of a date (Northern Hemisphere). */
export function seasonOf(date: Date): Season {
  const m = date.getMonth();
  if (m < 2 || m === 11) {
    return "winter";
  }
  if (m < 5) {
    return "spring";
  }
  return m < 8 ? "summer" : "autumn";
}

const monthDay = (date: Date) =>
  `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Whether "MM-DD" `day` lies in [from, to], the span wrapping past 12-31. */
export function inDaySpan(day: string, from: string, to: string): boolean {
  return from <= to ? day >= from && day <= to : day >= from || day <= to;
}

/** The paragraphs a stop adds today: its days' first, then its season's. */
export function stopNotes(stop: WalkStop, today: Date): string[] {
  const md = monthDay(today);
  const days = (stop.days ?? [])
    .filter((d) => inDaySpan(md, d.from, d.to))
    .map((d) => d.text);
  const season = stop.seasons?.[seasonOf(today)];
  return season ? [...days, season] : days;
}

/** The closer look's label, on the card and in the voice. */
export const CLOSER_LABEL = "Genauer hingesehen";

/** What the voice reads at a stop: its title, its story, today's notes
 *  and the closer look — the sources stay on the card. */
export function stopSpeech(stop: WalkStop, notes: readonly string[]): string {
  return [
    `${stop.title}.`,
    stop.text,
    ...notes,
    stop.closer ? `${CLOSER_LABEL}: ${stop.closer}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// --- checks ----------------------------------------------------------------------

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SOURCE = /^(https:\/\/\S+|stadtwissen:\S+)$/;
/** The longest narration a stop shows: a phone screen, not an essay. */
export const STOP_TEXT_MAX = 560;

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Where the stop stands, looks and when: the view's own numbers. */
function viewProblems(stop: WalkStop): string[] {
  const out: string[] = [];
  if (!(stop.from?.length === 3 && stop.from.every(finite))) {
    out.push("from must be [x, y, above]");
  }
  if (!(stop.at?.length === 3 && stop.at.every(finite))) {
    out.push("at must be [x, y, z]");
  }
  if (!finite(stop.ground)) {
    out.push("ground is missing (bun scripts/walks.ts <site> ground)");
  }
  if (!(finite(stop.hour) && stop.hour >= 0 && stop.hour < 24)) {
    out.push("hour must be within the day");
  }
  if (stop.style !== undefined && !isRenderStyle(stop.style)) {
    out.push(`style ${String(stop.style)} is not a picture style`);
  }
  if ("model" in stop) {
    // a walk is seen, not drawn: Modell's jump broke the glide between stops
    out.push("model is not a walk's view (a steep aerial shows a plan)");
  }
  return out;
}

/** What the stop says and what it rests on. */
function textProblems(stop: WalkStop): string[] {
  const out: string[] = [];
  if (!(stop.title && stop.text)) {
    out.push("title and text are required");
  } else if (stop.text.length > STOP_TEXT_MAX) {
    out.push(
      `text is ${stop.text.length} characters (at most ${STOP_TEXT_MAX})`
    );
  }
  if (stop.facts.length === 0) {
    out.push("a stop rests on at least one fact");
  }
  for (const f of stop.facts) {
    if (!SOURCE.test(f.source)) {
      out.push(`fact "${f.claim.slice(0, 40)}…" has no checkable source`);
    }
  }
  for (const d of stop.days ?? []) {
    if (!(MD.test(d.from) && MD.test(d.to))) {
      out.push(`days ${d.from}–${d.to} must be MM-DD`);
    }
  }
  out.push(...photoProblems(stop), ...lookProblems(stop));
  return out;
}

/** "Schau …", "Sieh …": a sentence that sends the eye somewhere. */
const LOOK = /(?:^|[.!?:;]\s+)(?:Schau|Sieh|Achte|Zoom|Zähl|Such)(?:e|t)?\b/;

/**
 * The model draws masses, not details: a statue is a generic figure, a
 * relief or an inscription is not there at all. A sentence that sends the
 * eye to look therefore points at the photo (docs/walks.md).
 */
function lookProblems(stop: WalkStop): string[] {
  const told = [stop.text, stop.closer ?? ""].flatMap((t) =>
    t.split(/(?<=[.!?])\s+/)
  );
  return told
    .filter((s) => LOOK.test(s) && !(stop.photo && /\b(?:Foto|Bild)\b/.test(s)))
    .map((s) => `"${s.slice(0, 40)}…" points at what the model may not show`);
}

/** Whether a stop's photo carries the credit it is shown with. */
export function photoCredited(p: NonNullable<WalkStop["photo"]>): boolean {
  return Boolean(p.author && p.licence && p.page.startsWith("https://"));
}

/** A photo carries its credit, or it is not shown. */
function photoProblems(stop: WalkStop): string[] {
  const p = stop.photo;
  if (!p) {
    return [];
  }
  if (!photoCredited(p)) {
    return [
      `photo ${p.file} has no credit (bun scripts/walks.ts <site> photos)`,
    ];
  }
  return finite(p.w) && finite(p.h) ? [] : [`photo ${p.file} has no size`];
}

function stopProblems(stop: WalkStop, where: string): string[] {
  return [...viewProblems(stop), ...textProblems(stop)].map(
    (p) => `${where}: ${p}`
  );
}

/** Everything wrong with a walk (empty when it is fine). */
export function walkProblems(walk: Walk): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9-]+$/.test(walk.id)) {
    out.push(`${walk.id}: id must be kebab-case`);
  }
  if (!walk.title || !walk.teaser || !walk.by) {
    out.push(`${walk.id}: title, teaser and by are required`);
  }
  if (walk.stops.length < 2) {
    out.push(`${walk.id}: a walk has at least two stops`);
  }
  const ids = new Set<string>();
  walk.stops.forEach((stop, i) => {
    if (ids.has(stop.id)) {
      out.push(`${walk.id}: stop id ${stop.id} twice`);
    }
    ids.add(stop.id);
    out.push(...stopProblems(stop, `${walk.id} #${i + 1} ${stop.id}`));
  });
  return out;
}

/**
 * The published bundle: the site's walks in file order, each checked —
 * a walk with a problem fails the build instead of shipping a broken stop.
 */
export function walkBundle(site: string, walks: Walk[]): WalkBundle {
  const problems = walks.flatMap(walkProblems);
  if (problems.length > 0) {
    throw new Error(`${site} walks:\n${problems.join("\n")}`);
  }
  return { site, walks };
}

/** Whether a fetched value is a walk bundle the player can show. */
export function isWalkBundle(value: unknown): value is WalkBundle {
  const v = value as Partial<WalkBundle> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.site === "string" &&
    Array.isArray(v.walks) &&
    v.walks.every((w) => Array.isArray(w?.stops) && typeof w.title === "string")
  );
}
