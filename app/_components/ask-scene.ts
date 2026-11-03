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
import { inquiryCard } from "@/lib/city/inquiry";
import type { LookState } from "@/lib/city/look-state";
import { siteHoldsPoint } from "@/lib/city/geolocation";
import { METHODS } from "@/lib/city/methods";
import type { Site } from "@/lib/city/site";
import type { AskScene } from "./ask-scene-tools";
import type { CityWalkHandle } from "./create-app";
import { loadLandmarkFacts } from "./landmark-facts-load";
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
const GLIDE_WAIT_MS = 8000;
/** Modell's centring glide (CENTRE_S) and a frame to spare (ms). */
const MODELL_CENTRE_MS = 700;
/** A miss after a glide, asked again while the tiles there stream in. */
const MISS_RETRIES = 6;
const MISS_RETRY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Resolves once `done` holds, or after `maxMs`. */
async function until(done: () => boolean, maxMs: number): Promise<void> {
  for (let waited = 0; !done() && waited < maxMs; waited += 100) {
    await sleep(100);
  }
}

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
    // Modell's centring glide (no getter for it): over when this is
    const glide = { centred: Promise.resolve() };
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
          return { gefunden: false, hinweis: "Die Szene lädt noch." };
        }
        // where a glide lands, not on its way — any glide, at any frame rate
        await glide.centred;
        await until(() => h.getGlideTarget() === null, GLIDE_WAIT_MS);
        // and once the tiles there have come: a miss is asked again
        let asked = h.inquireAt();
        for (let i = 0; !asked && i < MISS_RETRIES; i++) {
          await sleep(MISS_RETRY_MS);
          asked = h.inquireAt();
        }
        if (!asked) {
          return {
            gefunden: false,
            hinweis: "In der Bildmitte steht nichts, was das Modell kennt.",
          };
        }
        // the card the viewer opens for it, as words for the model — without
        // the site's per-tile survey record (provenance.json) and a tree's
        // own facts file, which the visible card fetches: the model gets
        // the layers' credits, the card beside it the full sources
        // a landmark's facts, as the card beside it shows them
        const url =
          asked.kind === "building" ? asked.landmarkFactsUrl : undefined;
        const landmarks = url ? await loadLandmarkFacts(url) : null;
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
      show: (view) => {
        const h = handleRef.current;
        if (!h) {
          return false;
        }
        // 0 s: Modell centres on it, gliding for CENTRE_S (model-rig.ts)
        if (h.flyToViewpoint(view) === 0) {
          glide.centred = sleep(MODELL_CENTRE_MS);
        }
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
