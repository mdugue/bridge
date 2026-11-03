/**
 * *Frag die Stadt*'s scene tools, bound to this viewer (ADR 0056): what
 * the model may read of the view and do to it — the pose, the time, the
 * picture style, the data layers, a glide. Each change goes through the
 * same stores the HUD uses, so the panel's controls show it.
 */
import { type RefObject, useMemo } from "react";
import { cardCredits } from "@/lib/city/card-lines";
import { activeDataLayers, siteDataLayers } from "@/lib/city/data-layers";
import type { FramePace } from "@/lib/city/frame-pace";
import { type Inquiry, inquiryCard } from "@/lib/city/inquiry";
import type { LookState } from "@/lib/city/look-state";
import { siteHoldsPoint } from "@/lib/city/geolocation";
import type { LandmarkFactsIndex } from "@/lib/city/landmark-facts";
import { METHODS } from "@/lib/city/methods";
import type { Site } from "@/lib/city/site";
import type { AskScene } from "./ask-scene-tools";
import type { CityWalkHandle } from "./create-app";
import { isAbortError } from "./fetch-optional";
import { loadLandmarkFacts } from "./landmark-facts-load";
import { sleep } from "./net-gate";
import type { SceneTime } from "./scene-time";

const WHEN = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "full",
  timeStyle: "short",
});

/** `hour` of `date` (YYYY-MM-DD) or of `day`, in the visitor's clock. */
export function instantAt(hour: number, day: Date, date?: string): Date {
  const [y, m, d] = date
    ? date.split("-").map(Number)
    : [day.getFullYear(), day.getMonth() + 1, day.getDate()];
  const minutes = Math.round(Math.min(Math.max(hour, 0), 24) * 60);
  return new Date(y, m - 1, d, 0, Math.min(minutes, 24 * 60 - 1));
}

/** How long `was_ist_da` waits for a glide to land at most (ms). */
const LAND_MAX_MS = 8000;
/** How often it looks whether the glide has landed (ms). */
const LAND_POLL_MS = 100;
/** How long it then waits for the tiles there at most (ms): a hit on
 *  something already loaded behind a tile still to come would be wrong. */
const STREAM_WAIT_MS = 4000;
/** A miss after a glide, asked again while the tiles there stream in. */
const MISS_RETRIES = 6;
const MISS_RETRY_MS = 500;

/** Polls `holds` until it is false, `gone` holds or `maxMs` passed (by
 *  the clock, not by turns, which a hidden page slows); whether it ended. */
async function waitWhile(
  holds: () => boolean,
  gone: () => boolean,
  maxMs: number,
  signal: AbortSignal
): Promise<boolean> {
  const end = performance.now() + maxMs;
  while (!gone() && holds()) {
    if (performance.now() >= end) {
      return false;
    }
    await sleep(LAND_POLL_MS, signal);
  }
  return true;
}

/**
 * Whether the view has landed: no glide (the pose's, Modell's centring)
 * and no dolly zoom under way, by the scene's own state, so at any frame
 * rate and with the live mode's easing; then, for a while, the tiles
 * there. False when the glide outlasted the wait.
 */
async function landed(
  h: CityWalkHandle,
  gone: () => boolean,
  signal: AbortSignal
): Promise<boolean> {
  if (!(await waitWhile(h.viewMoving, gone, LAND_MAX_MS, signal))) {
    return false;
  }
  await waitWhile(h.streamBusy, gone, STREAM_WAIT_MS, signal);
  return true;
}

/** Rejects when `signal` aborts (it never resolves). */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("aborted", "AbortError")),
      { once: true }
    );
  });
}

const LOADING = { gefunden: false, hinweis: "Die Szene lädt noch." };

const CANCELLED = {
  gefunden: false,
  hinweis: "Die Frage wurde abgebrochen.",
};

export function useAskScene(
  handleRef: RefObject<CityWalkHandle | null>,
  look: LookState,
  time: SceneTime,
  site: Site,
  pace: FramePace
): AskScene {
  const { current, setInstant } = time;
  return useMemo(() => {
    const offered = new Set(siteDataLayers(site.dataLayers).map((d) => d.key));
    const credits = cardCredits(site);
    // was_ist_da's waits: a stopped or closed conversation ends them
    const looks = { stop: new AbortController() };
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
      look: async () => {
        const h = handleRef.current;
        if (!h) {
          return LOADING;
        }
        // a scene remounted while this waited (a GPU loss) is not asked
        // through the old one's handle
        const gone = () => handleRef.current !== h;
        const signal = looks.stop.signal;
        let asked: Inquiry | null = null;
        try {
          // where a glide lands, not on its way
          const there = await landed(h, gone, signal);
          if (gone()) {
            return LOADING;
          }
          if (!there) {
            return {
              gefunden: false,
              hinweis:
                "Die Ansicht ist noch unterwegs. Frag gleich noch einmal.",
            };
          }
          // at the view's subject (Modell's pivot), and once the tiles
          // there have come: a miss is asked again
          asked = h.inquireAt(h.focusNdc());
          for (let i = 0; !asked && i < MISS_RETRIES; i++) {
            await sleep(MISS_RETRY_MS, signal);
            if (gone()) {
              return LOADING;
            }
            asked = h.inquireAt(h.focusNdc());
          }
        } catch (error) {
          if (isAbortError(error)) {
            return CANCELLED;
          }
          throw error;
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
        let landmarks: LandmarkFactsIndex | null = null;
        if (url) {
          try {
            landmarks = await Promise.race([
              loadLandmarkFacts(url),
              aborted(signal),
            ]);
          } catch (error) {
            if (isAbortError(error)) {
              return CANCELLED;
            }
            throw error;
          }
        }
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
      abandon: () => {
        looks.stop.abort();
        looks.stop = new AbortController();
      },
      show: (view) => {
        const h = handleRef.current;
        if (!h) {
          return false;
        }
        h.flyToViewpoint(view);
        return true;
      },
      within: (x, y) => siteHoldsPoint(site, x, y),
      setTime: (hour, date) => {
        const at = instantAt(hour, current(), date);
        setInstant(at);
        return WHEN.format(at);
      },
      setStyle: (style) => look.set({ style }),
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
