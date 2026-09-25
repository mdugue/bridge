"use client";

import { LoaderCircleIcon, LocateFixedIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import { placementOf } from "@/lib/city/geolocation";
import { EYE_HEIGHT } from "@/lib/city/pose";
import { currentSite } from "@/sites";
import type { CityWalkHandle } from "./create-app";
import {
  canLocate,
  describeFailure,
  describePlacement,
  locateMe,
} from "./locate-me";

/** How long the result line stays up (ms). */
const MESSAGE_MS = 5000;

/** Shows a one-line HUD message; `sticky` keeps it until the next one. */
export type Say = (text: string, sticky?: boolean) => void;

/**
 * The one result line the location controls share. Lives in CityWalk, not
 * in a button, so an answer still shows when the overlays step aside for the
 * sidebar mid-fix.
 */
export function useHudMessage(): { message: string | null; say: Say } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = useCallback<Say>((text, sticky = false) => {
    clearTimeout(timer.current);
    setMessage(text);
    if (!sticky) {
      timer.current = setTimeout(() => setMessage(null), MESSAGE_MS);
    }
  }, []);
  return { message, say };
}

/**
 * "Locate me": finds the player in the real world and drops them there,
 * standing on the ground and facing the way the phone points. `say` reports
 * how it went — how precise the fix is, or how far off the site the player
 * stands.
 */
export function useLocateMe(
  handleRef: RefObject<CityWalkHandle | null>,
  say: Say
) {
  const [available] = useState(canLocate);
  const [locating, setLocating] = useState(false);

  const locate = useCallback(() => {
    if (locating) {
      return;
    }
    setLocating(true);
    say("Standort wird bestimmt …", true);
    // Called synchronously from the click: locateMe asks for the compass
    // before its first await, while the gesture still counts (iOS).
    locateMe()
      .then((fix) => {
        const h = handleRef.current;
        if (!h) {
          return;
        }
        const site = currentSite();
        const placement = placementOf(fix, site.epsg, h.terrainBounds);
        if (placement.kind === "inside") {
          const now = h.getCameraState();
          h.placeAt({
            epsg: { x: placement.epsgX, y: placement.epsgY },
            aboveGround: EYE_HEIGHT,
            headingDeg: placement.headingDeg ?? now.headingDeg,
            pitchDeg: 0,
            fov: now.fov,
            mode: "walk",
          });
        }
        say(describePlacement(placement, site.label));
      })
      .catch((err: unknown) => say(describeFailure(err)))
      .finally(() => setLocating(false));
  }, [handleRef, locating, say]);

  return { available, locate, locating };
}

/** The round floating button, a sibling of the walk/fly toggle. */
export function LocateButton({
  locating,
  onClick,
}: {
  locating: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-busy={locating}
      aria-label="Zu meinem Standort"
      className={cn(
        "flex size-11 items-center justify-center rounded-full border border-white/30 bg-hud/85 text-hud-foreground shadow-lg backdrop-blur-lg",
        locating && "opacity-80"
      )}
      onClick={onClick}
      title="Zu meinem Standort — Blick in die Richtung, in die das Telefon zeigt"
      type="button"
    >
      {locating ? (
        <LoaderCircleIcon className="size-5 animate-spin" />
      ) : (
        <LocateFixedIcon className="size-5" />
      )}
    </button>
  );
}

/** The one-line result under the top edge. */
export function LocateMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <output
      aria-live="polite"
      className="pointer-events-none absolute top-24 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-hud/90 px-3 py-1 text-center text-[11px] text-hud-foreground shadow-lg backdrop-blur-lg"
    >
      {message}
    </output>
  );
}
