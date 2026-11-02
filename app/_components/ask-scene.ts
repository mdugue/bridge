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
import { clockMinutes } from "@/lib/city/ask-shown";
import { starterRiver } from "@/lib/city/ask-starters";
import { inquiryCard } from "@/lib/city/inquiry";
import type { LookState } from "@/lib/city/look-state";
import { riverOf } from "@/lib/city/scenario";
import { sunDirectionEnu } from "@/lib/city/sun";
import type { Site } from "@/lib/city/site";
import type { AskScene } from "./ask-scene-tools";
import type { CityWalkHandle } from "./create-app";
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
  return new Date(y, m - 1, d, 0, clockMinutes(hour));
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
      look: () => {
        const asked = handleRef.current?.inquireAt();
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
        const card = inquiryCard(asked, null, credits);
        return {
          gefunden: true,
          art: card.kicker,
          name: card.title,
          ...(card.address ? { adresse: card.address } : {}),
          ...(card.id ? { [card.idLabel || "kennung"]: card.id } : {}),
          fakten: Object.fromEntries(card.facts.map((f) => [f.label, f.value])),
          quellen: card.sources.map((s) => s.text),
        };
      },
      moment: () => {
        const h = handleRef.current;
        const c = h?.getCameraState();
        return {
          at: c ? { x: c.epsg.x, y: c.epsg.y, headingDeg: c.headingDeg } : null,
          now: current(),
          landmarks: h?.landmarks ?? [],
          // whether the river's highest flood reached the ground here
          river: starterRiver(
            riverOf(site.id),
            site.provider.epsg,
            c ? c.epsg : null,
            c && h ? h.groundAt(c.epsg.x, c.epsg.y) : null
          ),
          layers: [...offered],
        };
      },
      setListening: (on) => pace.setListening(on),
      river: riverOf(site.id),
      setFlood: (cm) => handleRef.current?.setFlood(cm),
      setVolume: (volume) => handleRef.current?.setVolume(volume) ?? false,
      show: (view) => handleRef.current?.flyToViewpoint(view),
      select: (places) => handleRef.current?.pickPlaces(places),
      frame: () => {
        const h = handleRef.current;
        const sun = h
          ? sunDirectionEnu(current(), h.latLng.lat, h.latLng.lng)
          : null;
        return {
          aspect: h
            ? h.viewAspect()
            : window.innerWidth / Math.max(window.innerHeight, 1),
          sun: sun && sun.up > 0 ? { east: sun.east, north: sun.north } : null,
          ...(h ? { sightHit: h.sightHit, groundAt: h.groundAt } : {}),
        };
      },
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
