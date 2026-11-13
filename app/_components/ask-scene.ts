/**
 * *Frag die Stadt*'s scene tools, bound to this viewer (ADR 0056): what
 * the model may read of the view and do to it — the pose, the time, the
 * picture style, the data layers, a glide. Each change goes through the
 * same stores the HUD uses, so the panel's controls show it.
 */
import { useMemo } from "react";
import type { RefObject } from "react";
import type { TimeChange } from "@/lib/city/ask-tools";
import { SITE_ZONE, zonedTime } from "@/lib/city/bike-counts";
import { cardCredits } from "@/lib/city/card-lines";
import { activeDataLayers, siteDataLayers } from "@/lib/city/data-layers";
import { inquiryCard } from "@/lib/city/inquiry";
import type { Inquiry } from "@/lib/city/inquiry";
import type { LookState } from "@/lib/city/look-state";
import { siteHoldsPoint } from "@/lib/city/geolocation";
import type { LandmarkFactsIndex } from "@/lib/city/landmark-facts";
import { METHODS } from "@/lib/city/methods";
import { RENDER_STYLE_BY_ID } from "@/lib/city/render-style";
import type { RenderStyle } from "@/lib/city/render-style";
import type { Site } from "@/lib/city/site";
import type { AskScene } from "./ask-scene-tools";
import type { CityWalkHandle, ScenePace } from "./scene-client";
import { untilAborted } from "./fetch-optional";
import { loadLandmarkFacts } from "./landmark-facts-load";
import { sleep, visibleMs } from "./net-gate";
import type { SceneTime } from "./scene-time";

const WHEN = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: SITE_ZONE,
});

const CITY_CLOCK = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: SITE_ZONE,
});

/** The calendar date (YYYY-MM-DD) and time of day (HH:MM) an instant reads
 *  on the city's clock. */
function cityClock(at: Date): { datum: string; uhrzeit: string } {
  const part = Object.fromEntries(
    CITY_CLOCK.formatToParts(at).map((p) => [p.type, p.value])
  );
  return {
    datum: `${part.year}-${part.month}-${part.day}`,
    uhrzeit: `${part.hour}:${part.minute}`,
  };
}

/**
 * The instant `now` becomes under a change, in the city's clock, whichever
 * clock the visitor's device keeps: the sun stands over the city. What the
 * change leaves out stays as the city's clock reads it now; 24:00 is the
 * day's last minute, not the next day.
 */
export function instantAt(now: Date, change: TimeChange): Date {
  const clock = cityClock(now);
  const [y, mo, d] = (change.datum ?? clock.datum).split("-").map(Number);
  const asked = change.uhrzeit === "24:00" ? "23:59" : change.uhrzeit;
  const [h, mi] = (asked ?? clock.uhrzeit).split(":").map(Number);
  return zonedTime([y, mo, d, h, mi, 0], SITE_ZONE);
}

/** How long `was_ist_da` waits for a glide to land at most (visible ms):
 *  a 3.8 s glide moves by at most 0.05 s a frame, so a phone at 5 fps
 *  needs about 15 s. */
const LAND_MAX_MS = 20_000;
/** A glide started while it waited (another tool, a tap) is waited for
 *  too, this many times at most. */
const LAND_ROUNDS = 3;
/** How long a hidden page may hold a wait beyond its visible limit (ms). */
const HIDDEN_GRACE_MS = 10_000;
/** How often it looks whether the glide has landed (ms). */
const LAND_POLL_MS = 100;
/** How long the stream takes to notice a new view (ms, a few frames). */
const STREAM_NOTICE_MS = 250;
/** How long it then waits for the tiles there at most (ms): a hit on
 *  something already loaded behind a tile still to come would be wrong. */
const STREAM_WAIT_MS = 4000;
/** A miss after a glide, asked again while the tiles there stream in. */
const MISS_RETRIES = 6;
const MISS_RETRY_MS = 500;

/** Polls `holds` until it is false, `gone` holds or `maxMs` of visible
 *  time passed (by the clock, not by turns); whether it ended. */
async function waitWhile(
  holds: () => boolean,
  gone: () => boolean,
  maxMs: number,
  signal?: AbortSignal
): Promise<boolean> {
  // the visible clock: a hidden page draws no frames, so no glide moves;
  // and a wall clock past it, so a locked phone does not hold the answer
  const end = visibleMs() + maxMs;
  const wallEnd = performance.now() + maxMs + HIDDEN_GRACE_MS;
  while (!gone() && holds()) {
    if (visibleMs() >= end || performance.now() >= wallEnd) {
      return false;
    }
    await sleep(LAND_POLL_MS, signal);
  }
  return true;
}

/**
 * Whether the view has landed: no glide (the pose's, Modell's centring)
 * and no dolly zoom under way, by the scene's own state, so at any frame
 * rate (the live mode's easing is no glide: a walker's view is asked as it
 * stands); then, for a while, the tiles there. False when the glide
 * outlasted the wait.
 */
async function landed(
  h: CityWalkHandle,
  gone: () => boolean,
  signal?: AbortSignal
): Promise<boolean> {
  if (!(await waitWhile(h.viewMoving, gone, LAND_MAX_MS, signal))) {
    return false;
  }
  // the stream hears of the new view a frame or two later: until then
  // it may still say it is settled
  await sleep(STREAM_NOTICE_MS, signal);
  await waitWhile(h.streamBusy, gone, STREAM_WAIT_MS, signal);
  return true;
}

/** `landed`, again while a glide started during the wait; whether the
 *  view stands. */
async function standing(
  h: CityWalkHandle,
  gone: () => boolean,
  signal?: AbortSignal
): Promise<boolean> {
  for (let round = 0; round < LAND_ROUNDS; round += 1) {
    if (!(await landed(h, gone, signal))) {
      return false;
    }
    if (gone() || !h.viewMoving()) {
      return true;
    }
  }
  return false;
}

const MOVING = {
  gefunden: false,
  hinweis: "Die Ansicht ist noch unterwegs. Frag gleich noch einmal.",
};

/** Why the picture does not follow the time, where the style keeps its own
 *  light: said on either tool, for they come in either order. */
function ownLightNote(style: RenderStyle): { hinweis?: string } {
  const own = RENDER_STYLE_BY_ID[style].ownLight;
  return own ? { hinweis: own.note } : {};
}

const LOADING = { gefunden: false, hinweis: "Die Szene lädt noch." };

export function useAskScene(
  handleRef: RefObject<CityWalkHandle | null>,
  look: LookState,
  time: SceneTime,
  site: Site,
  pace: ScenePace
): AskScene {
  const { current, setInstant } = time;
  return useMemo(() => {
    const offered = new Set(siteDataLayers(site.dataLayers).map((d) => d.key));
    const credits = cardCredits(site);
    // the glide an answer started, while it flies: a flight that lands, is
    // cancelled or is replaced by another reports 1 (camera-flight.ts)
    const glides: { answer: object | null } = { answer: null };
    return {
      from: () => {
        const c = handleRef.current?.getCameraState();
        return c ? { x: c.epsg.x, y: c.epsg.y } : null;
      },
      where: () => {
        const h = handleRef.current;
        if (!h) {
          return { fehler: "Die Szene lädt noch." };
        }
        const c = h.getCameraState();
        const values = look.get();
        return {
          x: Math.round(c.epsg.x),
          y: Math.round(c.epsg.y),
          hoehe_ue_nn: Math.round(c.pos.y),
          blick_grad: Math.round(c.headingDeg),
          neigung_grad: Math.round(c.pitchDeg),
          modus: h.getViewMode(),
          zeit: WHEN.format(current()),
          stil: values.style,
          ebenen: activeDataLayers(values).map((d) => d.key),
        };
      },
      look: async (signal) => {
        const h = handleRef.current;
        if (!h) {
          return LOADING;
        }
        // a scene remounted while this waited (a GPU loss) is not asked
        // through the old one's handle
        const gone = () => handleRef.current !== h;
        // the mirror is a frame stale: a glide `show` just told the scene
        // reads as moving only once the scene has answered it (ADR 0061);
        // a scene torn down meanwhile is caught by `gone` below
        await h.sync().catch(() => null);
        // where a glide lands, not on its way
        const there = await standing(h, gone, signal);
        if (gone()) {
          return LOADING;
        }
        if (!there) {
          return MOVING;
        }
        // at the view's subject (Modell's pivot), and once the tiles
        // there have come: a miss is asked again — never mid-glide
        let asked: Inquiry | null = await h.inquireAt(h.focusNdc());
        for (let i = 0; !asked && i < MISS_RETRIES; i += 1) {
          await sleep(MISS_RETRY_MS, signal);
          const still = !h.viewMoving() || (await standing(h, gone, signal));
          if (gone()) {
            return LOADING;
          }
          if (!still) {
            return MOVING;
          }
          asked = await h.inquireAt(h.focusNdc());
        }
        if (!asked) {
          return {
            gefunden: false,
            hinweis:
              "Wohin die Ansicht zeigt, steht nichts, was das Modell kennt.",
          };
        }
        // the card the viewer opens for it, as words for the model — without
        // the site's per-tile survey record (provenance.json) and a tree's
        // own facts file, which the visible card fetches: the model gets
        // the layers' credits, the card beside it the full sources
        // a landmark's facts, as the card beside it shows them
        const url =
          asked.kind === "building" ? asked.landmarkFactsUrl : undefined;
        const landmarks: LandmarkFactsIndex | null = url
          ? await untilAborted(loadLandmarkFacts(url), signal)
          : null;
        const card = inquiryCard(asked, null, credits, null, landmarks);
        return {
          gefunden: true,
          art: card.kicker,
          name: card.title,
          ...(card.address ? { adresse: card.address } : {}),
          ...(card.id ? { [card.idLabel || "kennung"]: card.id } : {}),
          // a list, not an object: two facts may share a label; an
          // inferred value says so, as the card's badge does
          fakten: card.facts.map((f) => ({
            [f.label]: f.value,
            ...(f.method ? { ermittelt: METHODS[f.method].label } : {}),
          })),
          quellen: card.sources.map((s) => s.text),
        };
      },
      setListening: (on) => pace.setListening(on),
      haltAnswerGlide: () => {
        // only the answer's own glide: one the visitor started since goes on
        if (glides.answer) {
          glides.answer = null;
          handleRef.current?.stopGlide();
        }
      },
      show: (view) => {
        const h = handleRef.current;
        if (!h) {
          return false;
        }
        const mine = {};
        glides.answer = mine;
        h.flyToViewpoint(view, {
          onProgress: (t) => {
            if (t >= 1 && glides.answer === mine) {
              glides.answer = null;
            }
          },
        });
        return true;
      },
      within: (x, y) => siteHoldsPoint(site, x, y),
      setTime: (change) => {
        const at = instantAt(current(), change);
        setInstant(at);
        return { zeit: WHEN.format(at), ...ownLightNote(look.get().style) };
      },
      setStyle: (style) => {
        look.set({ style });
        return ownLightNote(style);
      },
      setLayer: (key, on) => {
        if (!offered.has(key)) {
          return false;
        }
        look.set({ [key]: on });
        return true;
      },
    } satisfies AskScene;
  }, [handleRef, look, current, setInstant, site, pace]);
}
