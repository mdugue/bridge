/**
 * The crash trail's pure core (the browser side is
 * app/_components/crash-trail.ts). A page the browser kills — iOS ends a
 * tab that holds too much memory, a GPU process that dies takes the page
 * with it — runs no handler on the way out, so the viewer keeps a small
 * record of itself in local storage as it goes: what it runs on, a ring of
 * events (boot stages, style switches, errors, a lost device) and a ring
 * of heartbeats (frames, memory, what is loaded). A record that never
 * reached a clean end on the next load is the trace of a crash, and the
 * HUD offers it as text to copy. No THREE, no DOM.
 */

/** Bumped when the stored shape changes; older records are dropped. */
export const TRAIL_VERSION = 1;
/** How many events and heartbeats a record keeps (the newest). */
export const TRAIL_EVENTS = 40;
export const TRAIL_BEATS = 12;

export interface TrailEvent {
  /** seconds since the record started */
  t: number;
  kind: string;
  detail?: string;
}

export interface TrailBeat {
  /** seconds since the record started */
  t: number;
  frames: number;
  /** frames rendered per second since the previous beat */
  fps: number;
  /** the scene's GPU estimate (geometry, textures, shadow map), MB */
  gpuMB: number;
  calls: number;
  triangles: number;
  /** the JS heap, MB (Chromium only) */
  heapMB?: number;
  /** loaded building tiles and built dressings */
  cities: number;
  dressings: number;
  style: string;
  /** walk or fly, and the camera's height above the ground (m) */
  mode: string;
  heightM: number;
}

/**
 * How a record ended: "running" is how every record starts and what a
 * killed page leaves behind; "hidden" is a page that went to the
 * background (a kill there is the system reclaiming it, not a crash in
 * use); "clean" is a page that left normally.
 */
export type TrailEnd = "running" | "hidden" | "clean";

export interface Trail {
  v: typeof TRAIL_VERSION;
  startedAt: string;
  url: string;
  userAgent: string;
  /** "WebGPU", "WebGL2" or "?" before the renderer is up */
  backend: string;
  /** CSS size × devicePixelRatio, and the renderer's pixel ratio */
  screen: string;
  pixelRatio?: number;
  /** the device memory the browser reports (GB, Chromium only) */
  deviceMemoryGB?: number;
  state: TrailEnd;
  events: TrailEvent[];
  beats: TrailBeat[];
}

export type TrailSetup = Pick<
  Trail,
  "startedAt" | "url" | "userAgent" | "screen" | "deviceMemoryGB"
>;

export function createTrail(setup: TrailSetup): Trail {
  return {
    v: TRAIL_VERSION,
    backend: "?",
    state: "running",
    events: [],
    beats: [],
    ...setup,
  };
}

/** Appends to a ring: the newest `limit` entries stay. */
function pushRing<T>(ring: T[], entry: T, limit: number): void {
  ring.push(entry);
  if (ring.length > limit) {
    ring.splice(0, ring.length - limit);
  }
}

export function pushEvent(trail: Trail, event: TrailEvent): void {
  pushRing(trail.events, event, TRAIL_EVENTS);
}

export function pushBeat(trail: Trail, beat: TrailBeat): void {
  pushRing(trail.beats, beat, TRAIL_BEATS);
}

/** A stored record, or null for anything that is not one of this version. */
export function parseTrail(raw: string | null): Trail | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<Trail> | null;
    if (
      value?.v !== TRAIL_VERSION ||
      !Array.isArray(value.events) ||
      !Array.isArray(value.beats)
    ) {
      return null;
    }
    return value as Trail;
  } catch {
    return null;
  }
}

/** Whether a record is the trace of a page that died while in use. */
export function endedInCrash(trail: Trail | null): trail is Trail {
  return trail?.state === "running";
}

const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** One heartbeat as a line of the report (and of the console). */
export function formatBeat(b: TrailBeat): string {
  const heap = b.heapMB === undefined ? "" : ` heap ${round(b.heapMB)}MB`;
  return (
    `${round(b.t, 1)}s  f${b.frames} ${round(b.fps)}fps  gpu ${round(b.gpuMB)}MB${heap}` +
    `  ${b.calls}dc ${round(b.triangles / 1000)}k▲  tiles ${b.cities}/${b.dressings}` +
    `  ${b.style} ${b.mode} ${round(b.heightM)}m`
  );
}

/** One event as a line of the report (and of the console). */
export function formatEvent(e: TrailEvent): string {
  return `${round(e.t, 1)}s  ${e.kind}${e.detail ? `  ${e.detail}` : ""}`;
}

/** The record as the plain text the HUD offers to copy. */
export function formatTrail(trail: Trail): string {
  const lines = [
    `crash trail v${trail.v} · ${trail.state}`,
    `start ${trail.startedAt}`,
    `url ${trail.url}`,
    `ua ${trail.userAgent}`,
    `backend ${trail.backend} · screen ${trail.screen}` +
      (trail.pixelRatio === undefined ? "" : ` · pr ${trail.pixelRatio}`) +
      (trail.deviceMemoryGB === undefined
        ? ""
        : ` · mem ${trail.deviceMemoryGB}GB`),
    "",
    "events:",
    ...trail.events.map(formatEvent),
    "",
    "beats:",
    ...trail.beats.map(formatBeat),
  ];
  return lines.join("\n");
}
