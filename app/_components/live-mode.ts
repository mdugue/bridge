import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gridConvergenceDeg } from "@/lib/city/crs";
import { normalizeDeg, placementOf } from "@/lib/city/geolocation";
import { currentSite } from "@/sites";
import type { CityWalkHandle } from "./create-app";
import {
  orientationNeedsPermission,
  requestOrientationPermission,
  subscribeAim,
} from "./device-orientation";
import type { Say } from "./locate-button";
import { describePlacement, formatDistance, watchFix } from "./locate-me";

/** No reading for this long (ms): the compass is gone, hide the toggle. */
const STALE_MS = 5000;
/** After the permission: how long a first reading may take (ms). */
const FIRST_READING_MS = 2500;

/**
 * Live mode: the city as a window you hold up to it. The view turns and
 * tilts with the phone (the compass), and the camera moves along with the
 * player's GPS position — on foot or, in fly mode, at its altitude, so live
 * and flying combine into a drone that follows you — both eased in camera-pose.ts, so a fix's scatter
 * or a compass's jitter glides instead of jumping. Any manual look or move
 * hands the camera back (the scene reports it through `ended`) — except
 * climbing and sinking, which only change the altitude live mode keeps.
 *
 * Offered only while it can work: once a compass reading has actually
 * arrived (Chrome sends them unasked — a laptop sends none, so the toggle
 * never shows there), or on a touch device whose browser asks first (iOS),
 * until that is refused or no reading follows it. Without a usable GPS
 * fix (refused, off the site) the view still follows; the line says so.
 * While live, a stale compass keeps the last aim rather than ending the
 * mode: a phone lying still may simply stop reporting changes.
 */
export function useLiveMode(
  handleRef: RefObject<CityWalkHandle | null>,
  say: Say,
  coarse: boolean,
  latLng: { lat: number; lng: number } | null
) {
  const [live, setLive] = useState(false);
  const [refused, setRefused] = useState(false);
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  const lastReadingAt = useRef(0);
  const stopWatch = useRef<(() => void) | null>(null);
  /** the "no compass after FIRST_READING_MS" check, cleared with the mode */
  const firstReading = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** false once the HUD unmounts: a permission answer after that is moot */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Compass bearings are true; the scene's are grid. The meridian
  // convergence barely changes across a site, so it is taken once.
  const convergence = useMemo(
    () =>
      latLng
        ? (gridConvergenceDeg(currentSite().epsg, latLng.lat, latLng.lng) ?? 0)
        : 0,
    [latLng]
  );

  /** Drops the GPS watch and marks the mode off (the scene is told apart). */
  const release = useCallback(() => {
    onRef.current = false;
    setOn(false);
    stopWatch.current?.();
    stopWatch.current = null;
    if (firstReading.current !== null) {
      clearTimeout(firstReading.current);
      firstReading.current = null;
    }
  }, []);
  useEffect(() => release, [release]);

  const stop = useCallback(() => {
    release();
    handleRef.current?.setFollowAim(null);
    handleRef.current?.setFollowPosition(null);
  }, [handleRef, release]);

  useEffect(() => {
    const off = subscribeAim((aim) => {
      lastReadingAt.current = performance.now();
      setLive(true);
      if (onRef.current) {
        handleRef.current?.setFollowAim({
          headingDeg: normalizeDeg(aim.headingDeg + convergence),
          pitchDeg: aim.pitchDeg,
        });
      }
    });
    const tick = setInterval(() => {
      const idle = performance.now() - lastReadingAt.current;
      if (!onRef.current && idle > STALE_MS) {
        setLive(false);
      }
    }, 1000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, [convergence, handleRef]);

  /** Follows the GPS; the first fix (or trouble) is what the line reports. */
  const followPosition = useCallback(() => {
    let first = true;
    let wasOutside = false;
    stopWatch.current = watchFix(
      (fix) => {
        const h = handleRef.current;
        if (!(h && onRef.current)) {
          return;
        }
        const site = currentSite();
        const placement = placementOf(fix, site.epsg, h.terrainBounds);
        if (placement.kind === "inside") {
          h.setFollowPosition({ x: placement.epsgX, y: placement.epsgY });
          if (first || wasOutside) {
            say(
              `Live: Position und Blick folgen dir (±${formatDistance(fix.accuracy)})`
            );
          }
          wasOutside = false;
        } else if (first || !wasOutside) {
          say(
            `${describePlacement(placement, site.label)} — nur der Blick folgt`
          );
          wasOutside = true;
        }
        first = false;
      },
      () => say("Standort nicht verfügbar — nur der Blick folgt")
    );
  }, [handleRef, say]);

  const start = useCallback(() => {
    onRef.current = true;
    setOn(true);
    say("Live: Blick folgt dem Telefon, Position wird gesucht …", true);
    followPosition();
  }, [followPosition, say]);

  const toggle = useCallback(() => {
    if (onRef.current) {
      stop();
      say("Live beendet");
      return;
    }
    if (live) {
      start();
      return;
    }
    // iOS: asked from inside the click, the only place it may be asked.
    requestOrientationPermission()
      .then((granted) => {
        if (!mounted.current) {
          return;
        }
        if (!granted) {
          setRefused(true);
          say("Kompass-Zugriff verweigert");
          return;
        }
        start();
        firstReading.current = setTimeout(() => {
          firstReading.current = null;
          if (lastReadingAt.current === 0) {
            stop();
            setRefused(true);
            say("Kein Kompass verfügbar");
          }
        }, FIRST_READING_MS);
      })
      .catch(() => undefined);
  }, [live, say, start, stop]);

  /** The scene ended it: the player looked around or walked by hand. */
  const ended = useCallback(() => {
    if (onRef.current) {
      release();
      say("Live beendet — du steuerst wieder selbst");
    }
  }, [release, say]);

  const available =
    live || on || (coarse && orientationNeedsPermission() && !refused);
  return { available, ended, on, toggle };
}
