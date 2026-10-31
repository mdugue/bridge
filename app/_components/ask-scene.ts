/**
 * *Frag die Stadt*'s scene tools, bound to this viewer (ADR 0056): what
 * the model may read of the view and do to it — the pose, the time, the
 * picture style, the data layers, a glide. Each change goes through the
 * same stores the HUD uses, so the panel's controls show it.
 */
import { type RefObject, useMemo } from "react";
import { activeDataLayers, siteDataLayers } from "@/lib/city/data-layers";
import type { LookState } from "@/lib/city/look-state";
import type { Site } from "@/lib/city/site";
import type { AskScene } from "./ask-city";
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
  const minutes = Math.round(Math.min(Math.max(hour, 0), 24) * 60);
  return new Date(y, m - 1, d, 0, Math.min(minutes, 24 * 60 - 1));
}

export function useAskScene(
  handleRef: RefObject<CityWalkHandle | null>,
  look: LookState,
  time: SceneTime,
  site: Site
): AskScene {
  const { current, setInstant } = time;
  return useMemo(() => {
    const offered = new Set(siteDataLayers(site.dataLayers).map((d) => d.key));
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
      show: (view) => handleRef.current?.flyToViewpoint(view),
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
  }, [handleRef, look, current, setInstant, site]);
}
