"use client";

import { ARRIVAL_PARAM, arrivalOf, placementOf } from "@/lib/city/geolocation";
import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import {
  LocateFixedIcon,
  NavigationIcon,
  PlaneIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type RefObject,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import {
  loadPercent,
  type LoadStageState,
  loadStageStates,
  type SkippedStages,
  type StageFractions,
} from "@/lib/city/load-stages";
import type { Inquiry } from "@/lib/city/inquiry";
import type { BikeCounter } from "@/lib/city/bike-counts";
import { dataLayersOf } from "@/lib/city/data-layers";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import type { Landmark } from "@/lib/city/landmarks";
import { createLookState } from "@/lib/city/look-state";
import type { FootprintPoly, MapTile } from "@/lib/city/minimap";
import type { PlayerPose } from "@/lib/city/pose";
import {
  decodeLook,
  encodeSnapshot,
  parseSnapshot,
  snapshotInstant,
} from "@/lib/city/snapshot";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { AltitudeStick } from "./altitude-stick";
import { ControlHintBar } from "./control-hints";
import { CrashReport } from "./crash-report";
import { startCrashTrail } from "./crash-trail";
import { recoverFromGpuLoss, takeRecoverySnapshot } from "./gpu-recovery";
import { VEIL_HOLD_MS } from "./handover";
import {
  type CityWalkHandle,
  type CityWalkStats,
  createCityWalkApp,
} from "./create-app";
import type { MovementMode } from "./fps-movement";
import { LoadScreen } from "./load-screen";
import { type HudTool, HudToolbar } from "./hud-toolbar";
import { InquiryCard } from "./inquiry-card";
import { useLiveMode } from "./live-mode";
import {
  LocateMessage,
  type Say,
  useHudMessage,
  useLocateMe,
} from "./locate-button";
import { LocateOffsiteDialog } from "./locate-offsite-dialog";
import { updatePocDebug } from "./poc-debug";
import type { SceneBudget } from "./scene-profile";
import { overlook, type ViewpointGeometry } from "@/lib/city/site";
import {
  BikeCountList,
  TrafficHourLine,
  TramStatusLine,
} from "./data-layers-panel";
import type { TramCarsStatus } from "./tram-cars";
import type { TrafficHourStatus } from "@/lib/city/traffic-hours";
import { SceneSidebar } from "./scene-sidebar";
import { SoundGlyph, useSoundscape } from "./soundscape-toggle";
import type { SceneTabId } from "./scene-tabs";
import { StreamPill } from "./stream-pill";
import { readStoredStyle, writeStoredStyle } from "./style-memory";
import { INITIAL_MINUTES, useSceneTime } from "./scene-time";
import { useSite } from "./site-context";
import { VirtualJoystick } from "./virtual-joystick";
import { missingPrerequisite } from "./gpu-support";

interface Props {
  /** The render budget the page was opened with (see scene-profile.ts) */
  budget: SceneBudget;
  /** the tileset the scene streams (lib/city/tileset.ts) */
  tilesetUrl: string;
}

/**
 * Two phases, one handover. `loading` is the full-bleed Laden screen; `running`
 * is the live scene with the streaming pill. Nothing animates between them —
 * the loading screen is frosted glass that the city arrives behind and that is
 * then removed in a single frame. See handover.ts.
 */
type Status =
  | { phase: "error"; message: string }
  | { phase: "loading" }
  | { phase: "running" };

// Evaluated once in the browser (the component is loaded with ssr: false).
const INITIAL_DATE = new Date();

/** A little air after the veil is gone before the heavy work resumes. */
const STREAM_SETTLE_MS = 250;

/** Floating button that opens the sidebar; hidden while it is open. */
function SettingsToggle() {
  const { toggleSidebar, state, isMobile, openMobile } = useSidebar();
  const open = isMobile ? openMobile : state === "expanded";
  if (open) {
    return null;
  }
  return (
    <Button
      aria-label="Szeneneinstellungen"
      className="absolute top-4 right-4 z-20 size-9 rounded-full border-0 bg-hud/85 text-hud-foreground shadow-lg backdrop-blur-lg hover:bg-hud/95"
      onClick={toggleSidebar}
      size="icon"
      variant="secondary"
    >
      <SlidersHorizontalIcon />
    </Button>
  );
}

/**
 * The tools the floating toolbar offers here: "take me to where I am"
 * wherever the browser can locate the player (locate-button.tsx), live mode
 * while a compass is reporting (live-mode.ts), and on a touch screen walk/
 * fly, the F key's stand-in.
 */
function sceneTools({
  coarse,
  live,
  locate,
  mode,
  onToggleMode,
}: {
  coarse: boolean;
  live: ReturnType<typeof useLiveMode>;
  locate: ReturnType<typeof useLocateMe>;
  mode: MovementMode;
  onToggleMode: () => void;
}): HudTool[] {
  const tools: HudTool[] = [];
  if (locate.available) {
    tools.push({
      id: "locate",
      label: "Standort",
      icon: LocateFixedIcon,
      busy: locate.locating,
      onClick: locate.locate,
      title: "Zu meinem Standort springen, Blick in Telefonrichtung",
    });
  }
  if (live.available) {
    tools.push({
      id: "live",
      label: "Live",
      icon: NavigationIcon,
      pressed: live.on,
      onClick: live.toggle,
      title:
        "Live: Blick und Position folgen dir und deinem Telefon — ziehen oder gehen beendet es",
    });
  }
  if (coarse) {
    tools.push({
      id: "fly",
      label: "Fliegen",
      icon: PlaneIcon,
      pressed: mode === "fly",
      onClick: onToggleMode,
      title: "Zwischen Gehen und Fliegen wechseln",
    });
  }
  return tools;
}

/**
 * The overlays that belong to the scene, not to the panel: the key hints, the
 * joystick and, opposite it, the toolbar (sceneTools) with — in fly mode —
 * the altitude stick above it. All of it
 * steps aside while the inquiry sheet covers the bottom (touch) and while
 * the sidebar is open — on a phone the sidebar is a sheet,
 * so a joystick left mounted underneath would be a dead control the player
 * can still see.
 */
function SceneOverlays({
  coarse,
  covered,
  live,
  locate,
  mode,
  onClimb,
  onMove,
  onToggleMode,
}: {
  coarse: boolean;
  /** the inquiry sheet covers the bottom of the screen (touch) */
  covered: boolean;
  live: ReturnType<typeof useLiveMode>;
  locate: ReturnType<typeof useLocateMe>;
  mode: MovementMode;
  onClimb: (v: number) => void;
  onMove: (x: number, y: number) => void;
  onToggleMode: () => void;
}) {
  const { state, isMobile, openMobile } = useSidebar();
  if (covered || (isMobile ? openMobile : state === "expanded")) {
    return null;
  }
  const flying = mode === "fly";
  return (
    <>
      <ControlHintBar coarse={coarse} />
      {/* Clear of the hint bar even when it wraps to two rows on a phone. */}
      <div className="absolute bottom-24 left-5">
        <VirtualJoystick onChange={onMove} />
      </div>
      {/* Bottom-anchored with the toolbar last, so it stays put when fly
          mode brings the altitude stick in above it. */}
      <div className="absolute right-5 bottom-24 flex flex-col items-center gap-3">
        {flying && <AltitudeStick onChange={onClimb} />}
        <HudToolbar
          tools={sceneTools({ coarse, live, locate, mode, onToggleMode })}
        />
      </div>
    </>
  );
}

/**
 * The off-site dialog, wired to the scene and the sidebar: a vantage flies
 * there, "Auf der Karte wählen" opens the sidebar on the minimap.
 */
function OffsiteDialog({
  handleRef,
  locate,
  onTab,
}: {
  handleRef: RefObject<CityWalkHandle | null>;
  locate: ReturnType<typeof useLocateMe>;
  onTab: (tab: SceneTabId) => void;
}) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  return (
    <LocateOffsiteDialog
      offsite={locate.offsite}
      onClose={locate.dismissOffsite}
      onShowMap={() => {
        onTab("erkunden");
        if (isMobile) {
          setOpenMobile(true);
        } else {
          setOpen(true);
        }
      }}
      onTravel={(view) => handleRef.current?.flyToViewpoint(view)}
    />
  );
}

/**
 * The page was opened from another city's off-site dialog with where the
 * player stands (`?at=lat,lng`, lib/city/geolocation.ts `arrivalHref`):
 * put them there, on foot, and drop the parameter so a reload starts at the
 * site's spawn again.
 */
function arriveAt(h: CityWalkHandle, site: Site, say: Say): void {
  const at = arrivalOf(location.search);
  if (!at) {
    return;
  }
  const url = new URL(location.href);
  url.searchParams.delete(ARRIVAL_PARAM);
  history.replaceState(history.state, "", url);
  const placement = placementOf(
    { ...at, accuracy: 0, headingDeg: null },
    site.provider.epsg,
    h.terrainBounds
  );
  if (placement.kind !== "inside") {
    return;
  }
  const now = h.getCameraState();
  h.placeAt({
    epsg: { x: placement.epsgX, y: placement.epsgY },
    aboveGround: EYE_HEIGHT,
    headingDeg: now.headingDeg,
    pitchDeg: 0,
    fov: now.fov,
    mode: "walk",
  });
  say(`Willkommen in ${site.name} — du stehst, wo du bist`);
}

export default function CityWalk({ budget, tilesetUrl }: Props) {
  const site = useSite();
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CityWalkHandle | null>(null);
  const applySceneTime = useCallback(
    (date: Date) => handleRef.current?.setSun(date),
    []
  );
  const poseListeners = useRef<Set<(pose: PlayerPose) => void>>(new Set());
  const coarse = useCoarsePointer();
  const hud = useHudMessage();
  const sayHud = hud.say;
  const locate = useLocateMe(handleRef, hud);

  // Probed once, before the renderer is created: three's raw backend error
  // (or a tile's bare ReferenceError) is replaced by a sentence naming the
  // missing prerequisite.
  const [missing] = useState(missingPrerequisite);
  const supported = missing === null;
  const [status, setStatus] = useState<Status>(() =>
    missing === null
      ? { phase: "loading" }
      : { phase: "error", message: missing }
  );
  // What the scene has reported per load stage (lib/city/load-stages.ts): the
  // loading screen, the handover and the pill all read this. One piece of
  // state, not two, because a streaming failure has to settle both at once.
  const [progress, setProgress] = useState<{
    fractions: StageFractions;
    skipped: SkippedStages;
  }>({ fractions: {}, skipped: {} });
  const [streamError, setStreamError] = useState<string | null>(null);
  // After the first full load: tiles or their details streaming in (flights).
  const [streamingMore, setStreamingMore] = useState(false);
  // Kept past the handover: the city arrives behind the frosted screen, which
  // is only then removed (handover.ts).
  const [veilUp, setVeilUp] = useState(true);
  const [stats, setStats] = useState<CityWalkStats | null>(null);
  // The live bicycle counts while their data layer is on (data-overlays.ts).
  const [bikeCounters, setBikeCounters] = useState<BikeCounter[]>([]);
  // The timetable trams' day and count while their layer is on.
  const [tramStatus, setTramStatus] = useState<TramCarsStatus | null>(null);
  const [trafficHour, setTrafficHour] = useState<TrafficHourStatus | null>(
    null
  );
  const time = useSceneTime(applySceneTime, INITIAL_DATE);
  const { current: timeNow, sync: syncTime } = time;
  // The look store outlives the scene: a remount (StrictMode, a tile switch)
  // boots the new instance from it, so sliders and scene never disagree.
  // The picture style starts as the viewer last left it (style-memory.ts).
  const [look] = useState(() =>
    createLookState({
      ...LOOK_DEFAULTS,
      style: readStoredStyle() ?? LOOK_DEFAULTS.style,
    })
  );
  const lookValues = useSyncExternalStore(look.subscribe, look.get, look.get);
  useEffect(() => {
    let remembered = look.get().style;
    return look.subscribe((values) => {
      if (values.style !== remembered) {
        remembered = values.style;
        writeStoredStyle(values.style);
      }
    });
  }, [look]);
  const [mode, setMode] = useState<MovementMode>("walk");
  // Befragen (ADR 0042): what was asked last, while its card is open.
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [provenanceUrl, setProvenanceUrl] = useState<string | null>(null);
  const closeInquiry = useCallback(() => {
    handleRef.current?.clearInquiry();
    setInquiry(null);
  }, []);
  const [footprints, setFootprints] = useState<FootprintPoly[]>([]);
  const [bounds, setBounds] = useState<TerrainBounds | null>(null);
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const live = useLiveMode(handleRef, hud.say, coarse, latLng);
  // The scene reports a manual look or move that ended live mode; the boot
  // effect below must not re-run for it, so it reads the hook through a ref.
  const liveEnded = useRef(live.ended);
  useEffect(() => {
    liveEnded.current = live.ended;
  }, [live.ended]);
  // What a lost GPU keeps for the next page and puts back there
  // (gpu-recovery.ts): the boot effect reads this render's time and look
  // through a ref, as it does live mode.
  const recovery = useRef<{
    capture: () => string | null;
    restore: (h: CityWalkHandle, text: string) => void;
  } | null>(null);
  useEffect(() => {
    recovery.current = {
      capture: () => {
        const h = handleRef.current;
        return h
          ? JSON.stringify(
              encodeSnapshot(look.get(), h.getCameraState(), time.date)
            )
          : null;
      },
      restore: (h, text) => {
        const parsed = parseSnapshot(text);
        if (!parsed.ok) {
          return;
        }
        h.applyCameraState(parsed.snapshot.camera);
        time.setInstant(snapshotInstant(parsed.snapshot));
        look.set(decodeLook(parsed.snapshot.look));
      },
    };
  });
  const [landcoverTiles, setLandcoverTiles] = useState<MapTile[]>([]);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [fps, setFps] = useState<number | null>(null);
  const [snapshotText, setSnapshotText] = useState("");
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<SceneTabId>("erkunden");
  const [rememberedView, setRememberedView] =
    useState<ViewpointGeometry | null>(null);

  const subscribePose = useCallback((cb: (pose: PlayerPose) => void) => {
    poseListeners.current.add(cb);
    return () => {
      poseListeners.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }
    // The GPU preflight already failed (see the status initializer): no
    // renderer, no handle, nothing to clean up.
    if (!supported) {
      return;
    }
    let cancelled = false;
    let handle: CityWalkHandle | null = null;
    let veilTimer: ReturnType<typeof setTimeout> | undefined;
    let streamFallback: ReturnType<typeof setTimeout> | undefined;
    const beginStreaming = () => handleRef.current?.startStreaming();
    const aborter = new AbortController();
    // This page's crash trail, from before the renderer exists: a page the
    // browser kills leaves its last steps for the next load (crash-trail.ts).
    const trail = startCrashTrail();

    createCityWalkApp({
      container,
      budget,
      look,
      site,
      tilesetUrl,
      initialDate: timeNow(),
      signal: aborter.signal,
      trail,
      onStage: ({ id, fraction, skipped: isSkipped }) => {
        if (cancelled) {
          return;
        }
        // Deliberately NOT an urgent update. These arrive many times a second
        // while a tile streams, and urgent work at that rate starves whatever
        // else React has queued — including, when it was still a transition,
        // the handover itself, which landed ten seconds late without this.
        startTransition(() => {
          setProgress((prev) => ({
            fractions: { ...prev.fractions, [id]: fraction },
            skipped: isSkipped ? { ...prev.skipped, [id]: true } : prev.skipped,
          }));
        });
      },
      onLoaded: () => {
        if (!cancelled) {
          updatePocDebug({ ready: true });
        }
      },
      onBusy: (isBusy) => {
        if (!cancelled) {
          startTransition(() => setStreamingMore(isBusy));
        }
      },
      onGpuLost: () =>
        !cancelled && recoverFromGpuLoss(recovery.current?.capture() ?? null),
      onError: (message) => {
        if (cancelled) {
          return;
        }
        // One tile (or one tile's dressing) failed after the first frame: it
        // leaves a hole, and the rest keeps streaming — the stages still
        // finish on their own (a failed tile counts as done), so they are
        // not settled here. A failure before the first frame rejects the
        // boot instead.
        setStreamError(message);
      },
      onStats: (s) => {
        if (cancelled) {
          return;
        }
        updatePocDebug({ stats: s });
        const h = handleRef.current;
        startTransition(() => {
          setStats(s);
          if (h) {
            setFootprints(h.getFootprints());
          }
        });
      },
      onTramStatus: (status) => {
        if (!cancelled) {
          startTransition(() => setTramStatus(status));
        }
      },
      onTrafficHour: (status) => {
        if (!cancelled) {
          startTransition(() => setTrafficHour(status));
        }
      },
      onBikeCounts: (counters) => {
        if (!cancelled) {
          startTransition(() => setBikeCounters(counters));
        }
      },
      onFps: (value) => {
        if (!cancelled) {
          // Twice a second, read only in the Erweitert tab's counters.
          startTransition(() => setFps(value));
        }
      },
      onFollowEnd: () => {
        if (!cancelled) {
          liveEnded.current();
        }
      },
      onModeChange: (m) => {
        if (!cancelled) {
          setMode(m);
        }
      },
      onInquiry: (asked) => {
        if (!cancelled) {
          setInquiry(asked);
        }
      },
      onPose: (pose) => {
        if (cancelled) {
          return;
        }
        for (const cb of poseListeners.current) {
          cb(pose);
        }
      },
    })
      .then((h) => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        handleRef.current = h;
        trail.note("first frame");
        // Back where the player stood before the GPU was lost (gpu-recovery.ts).
        const recovered = takeRecoverySnapshot();
        if (recovered) {
          recovery.current?.restore(h, recovered);
          trail.note("recovered", "after a lost GPU");
        } else {
          arriveAt(h, site, sayHud);
        }
        syncTime();
        setFootprints(h.getFootprints());
        setBounds(h.terrainBounds);
        setProvenanceUrl(h.provenanceUrl);
        setLatLng(h.latLng);
        setLandcoverTiles(h.landcoverTiles);
        setLandmarks(h.landmarks);
        updatePocDebug({ handle: h, look, firstFrame: true });
        // The frame the scene goes live in. The loading screen stays up and
        // stops taking input: the city is now rendering behind its glass, and
        // the player can already look around through it.
        setStatus({ phase: "running" });
        // Then the glass is removed, in one frame, with nothing in between.
        veilTimer = setTimeout(() => setVeilUp(false), VEIL_HOLD_MS);
        // The dressing (vegetation, lamps, rails, walls) and the terrain BVHs wait until
        // then: each is a long synchronous task, and the frames while the city
        // is arriving — and the first ones the player actually steers — are
        // the worst possible place for them (see create-app's startStreaming).
        streamFallback = setTimeout(
          beginStreaming,
          VEIL_HOLD_MS + STREAM_SETTLE_MS
        );
      })
      .catch((err: unknown) => {
        // Aborted = StrictMode remount / navigation away, not a failure.
        const aborted =
          err instanceof DOMException && err.name === "AbortError";
        if (!(cancelled || aborted)) {
          trail.note(
            "boot failed",
            err instanceof Error ? err.message : String(err)
          );
          setStatus({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
      aborter.abort();
      trail.end();
      // The card belongs to the scene that marked its building: a route
      // kept hidden (and shown again) boots a new scene without that mark.
      setInquiry(null);
      clearTimeout(veilTimer);
      clearTimeout(streamFallback);
      handleRef.current = null;
      handle?.dispose();
      // The hook must not keep a disposed scene callable (or alive): the
      // next boot republishes.
      updatePocDebug({
        firstFrame: false,
        ready: false,
        handle: undefined,
        look: undefined,
      });
    };
  }, [budget, look, site, tilesetUrl, supported, timeNow, syncTime, sayHud]);

  const copySnapshot = () => {
    const h = handleRef.current;
    if (!h) {
      return;
    }
    const snap = encodeSnapshot(look.get(), h.getCameraState(), time.date);
    const text = JSON.stringify(snap, null, 2);
    setSnapshotText(text);
    navigator.clipboard?.writeText(text).then(
      () => setSnapshotMsg("In die Zwischenablage kopiert"),
      () => setSnapshotMsg("Kopieren fehlgeschlagen — Text manuell auswählen")
    );
  };

  const applySnapshot = () => {
    const h = handleRef.current;
    if (!h) {
      return;
    }
    // Validate every field before anything is applied: a trimmed or
    // hand-edited snapshot names what is wrong instead of yielding a NaN
    // camera and "Snapshot applied".
    const parsed = parseSnapshot(snapshotText);
    if (!parsed.ok) {
      setSnapshotMsg(parsed.reason);
      return;
    }
    const snap = parsed.snapshot;
    h.applyCameraState(snap.camera);
    // The minute the sliders can show (see snapshotInstant), for the sun and
    // the two time controls alike.
    time.setInstant(snapshotInstant(snap));
    look.set(decodeLook(snap.look));
    setSnapshotMsg("Snapshot angewendet");
  };

  // The hidden soundscape (plan 035): off until L or the Erweitert switch.
  const sound = useSoundscape({
    date: time.date,
    handleRef,
    nightFactor: time.sun?.nightFactor ?? 0,
    ready: status.phase === "running" && !veilUp,
    subscribePose,
  });

  const stages: LoadStageState[] = loadStageStates(
    progress.fractions,
    progress.skipped
  );
  const percent = loadPercent(progress.fractions, progress.skipped);
  const booted = status.phase === "running";

  return (
    <SidebarProvider
      className="relative h-full overflow-hidden"
      // Open on a desktop, where there is room beside the scene, and closed on
      // a touch device, where the panel would cover the view it describes.
      defaultOpen={!coarse}
      style={{ "--sidebar-width": "21.25rem" } as CSSProperties}
    >
      {/* Scene is full-bleed and never resized by the sidebar (which overlays
          it), so toggling the panel can't flash the canvas. */}
      {/* No text selection or callout over the scene: a long press asks a
          building (ADR 0042), it must not also mark the HUD's text. */}
      <div className="absolute inset-0 overflow-hidden bg-[image:var(--hud-scrim)] select-none [-webkit-touch-callout:none]">
        <div className="absolute inset-0" ref={mountRef} />

        {veilUp && (
          <LoadScreen
            handedOver={status.phase === "running"}
            percent={percent}
            stages={stages}
          />
        )}

        <CrashReport />

        {status.phase === "error" && (
          <Alert className="absolute inset-x-8 top-8" variant="destructive">
            <AlertTitle>Der Stadt-Viewer konnte nicht starten</AlertTitle>
            <AlertDescription className="wrap-break-word">
              {status.message}
            </AlertDescription>
          </Alert>
        )}

        {booted && (
          <>
            {/* crosshair */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            />

            {/* The loading screen, at pill size. It retires itself once the
                last layer has landed and it has been readable for a moment. */}
            <StreamPill busy={streamingMore} stages={stages} />

            {streamError && (
              <output
                aria-live="polite"
                className="pointer-events-none absolute top-15 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-destructive/90 px-3 py-1 text-[11px] text-white"
              >
                Eine Schicht konnte nicht geladen werden: {streamError}
              </output>
            )}

            <LocateMessage message={hud.message} />
            <OffsiteDialog
              handleRef={handleRef}
              locate={locate}
              onTab={setTab}
            />

            {sound.on && <SoundGlyph onClick={sound.toggle} />}
            {inquiry && (
              <InquiryCard
                inquiry={inquiry}
                onClose={closeInquiry}
                provenanceUrl={provenanceUrl}
                sheet={coarse}
              />
            )}
            <SettingsToggle />
            <SceneOverlays
              coarse={coarse}
              covered={coarse && inquiry !== null}
              live={live}
              locate={locate}
              mode={mode}
              onClimb={(v) => handleRef.current?.setClimbInput(v)}
              onMove={(x, y) => handleRef.current?.setMoveInput(x, y)}
              onToggleMode={() =>
                handleRef.current?.setMovementMode(
                  mode === "fly" ? "walk" : "fly"
                )
              }
            />
          </>
        )}
      </div>

      {booted && (
        <SceneSidebar
          dataLayerDetail={{
            bikeLayer: (
              <BikeCountList
                counters={bikeCounters}
                onFly={(c) =>
                  handleRef.current?.flyToViewpoint(
                    overlook(c, {
                      altitude: 45,
                      description: c.where,
                      headingDeg: 0,
                      id: c.id,
                      label: c.name,
                      pitchDeg: -30,
                    })
                  )
                }
              />
            ),
            trafficLayer: <TrafficHourLine status={trafficHour} />,
            tramLayer: <TramStatusLine status={tramStatus} />,
          }}
          applySnapshot={applySnapshot}
          bounds={bounds}
          coarse={coarse}
          copySnapshot={copySnapshot}
          day={time.day}
          footprints={footprints}
          fps={fps}
          handleRef={handleRef}
          landcoverTiles={landcoverTiles}
          landmarks={landmarks}
          latLng={latLng}
          look={lookValues}
          minutes={time.minutes}
          mode={mode}
          onLook={look.set}
          onDefaultTime={() => time.set(time.day, INITIAL_MINUTES)}
          onTab={setTab}
          onTeleport={(x, y) => handleRef.current?.glideToSpot(x, y)}
          rememberedView={rememberedView}
          // The sliders go back to their defaults; the picture style and
          // the data layers are choices of their own, and stay.
          resetLook={() =>
            look.set({
              ...LOOK_DEFAULTS,
              ...dataLayersOf(look.get()),
              style: look.get().style,
            })
          }
          setRememberedView={setRememberedView}
          setSnapshotText={setSnapshotText}
          snapshotMsg={snapshotMsg}
          snapshotText={snapshotText}
          sound={sound}
          stats={stats}
          subscribePose={subscribePose}
          sun={time.sun}
          tab={tab}
          updateSun={time.set}
        />
      )}
    </SidebarProvider>
  );
}
