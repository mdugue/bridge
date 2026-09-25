"use client";

import { CompassIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import { gridConvergenceDeg } from "@/lib/city/crs";
import { normalizeDeg } from "@/lib/city/geolocation";
import { currentSite } from "@/sites";
import type { CityWalkHandle } from "./create-app";
import {
  orientationNeedsPermission,
  requestOrientationPermission,
  subscribeAim,
} from "./device-orientation";
import type { Say } from "./locate-button";

/** No reading for this long (ms): the compass is gone, hide the toggle. */
const STALE_MS = 5000;
/** After the permission: how long a first reading may take (ms). */
const FIRST_READING_MS = 2500;

/**
 * "The view follows the phone": an opt-in mode in which the camera turns
 * and tilts with the phone, a window into the city you hold up to it.
 *
 * Offered only while it can work: once a compass reading has actually
 * arrived (Chrome sends them unasked — a laptop sends none, so the toggle
 * never shows there), or on a touch device whose browser asks first (iOS),
 * until that is refused or no reading follows it. While following, a stale
 * compass keeps the last aim rather than ending the mode: a phone lying
 * still may simply stop reporting changes.
 */
export function useFollowPhone(
  handleRef: RefObject<CityWalkHandle | null>,
  say: Say,
  coarse: boolean,
  latLng: { lat: number; lng: number } | null
) {
  const [live, setLive] = useState(false);
  const [refused, setRefused] = useState(false);
  const [following, setFollowing] = useState(false);
  const followingRef = useRef(false);
  const lastReadingAt = useRef(0);
  // Compass bearings are true; the scene's are grid. The meridian
  // convergence barely changes across a site, so it is taken once.
  const convergence = useMemo(
    () =>
      latLng
        ? (gridConvergenceDeg(currentSite().epsg, latLng.lat, latLng.lng) ?? 0)
        : 0,
    [latLng]
  );

  const setMode = useCallback(
    (on: boolean) => {
      followingRef.current = on;
      setFollowing(on);
      if (!on) {
        handleRef.current?.setFollowAim(null);
      }
    },
    [handleRef]
  );

  useEffect(() => {
    const off = subscribeAim((aim) => {
      lastReadingAt.current = performance.now();
      setLive(true);
      if (followingRef.current) {
        handleRef.current?.setFollowAim({
          headingDeg: normalizeDeg(aim.headingDeg + convergence),
          pitchDeg: aim.pitchDeg,
        });
      }
    });
    const tick = setInterval(() => {
      const idle = performance.now() - lastReadingAt.current;
      if (!followingRef.current && idle > STALE_MS) {
        setLive(false);
      }
    }, 1000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, [convergence, handleRef]);

  const start = useCallback(() => {
    setMode(true);
    say("Der Blick folgt jetzt dem Telefon — Ziehen beendet es");
  }, [say, setMode]);

  const toggle = useCallback(() => {
    if (followingRef.current) {
      setMode(false);
      return;
    }
    if (live) {
      start();
      return;
    }
    // iOS: asked from inside the click, the only place it may be asked.
    requestOrientationPermission()
      .then((granted) => {
        if (!granted) {
          setRefused(true);
          say("Kompass-Zugriff verweigert");
          return;
        }
        start();
        setTimeout(() => {
          if (lastReadingAt.current === 0) {
            setMode(false);
            setRefused(true);
            say("Kein Kompass verfügbar");
          }
        }, FIRST_READING_MS);
      })
      .catch(() => undefined);
  }, [live, say, setMode, start]);

  /** The scene ended it: the player looked around by hand. */
  const ended = useCallback(() => {
    followingRef.current = false;
    setFollowing(false);
  }, []);

  const available =
    live || following || (coarse && orientationNeedsPermission() && !refused);
  return { available, ended, following, toggle };
}

/** The round toggle, a sibling of the locate button. */
export function FollowPhoneButton({
  following,
  onClick,
}: {
  following: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Blick folgt dem Telefon"
      aria-pressed={following}
      className={cn(
        "flex size-11 items-center justify-center rounded-full border shadow-lg backdrop-blur-lg",
        following
          ? "border-white/60 bg-white/85 text-black"
          : "border-white/30 bg-hud/85 text-hud-foreground"
      )}
      onClick={onClick}
      title="Blick folgt dem Telefon — ziehen beendet es"
      type="button"
    >
      <CompassIcon className="size-5" />
    </button>
  );
}
