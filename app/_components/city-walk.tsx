"use client";

import { arrivalOf, placementOf } from "@/lib/city/geolocation";
import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import {
  BoxIcon,
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
import type { Inquiry, InquiryAlong } from "@/lib/city/inquiry";
import type { BikeCounter } from "@/lib/city/bike-counts";
import { dataLayersOf } from "@/lib/city/data-layers";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import type { Landmark } from "@/lib/city/landmarks";
import { createLookState } from "@/lib/city/look-state";
import type { FootprintPoly, MapTile } from "@/lib/city/minimap";
import type { CameraState, PlayerPose } from "@/lib/city/pose";
import {
  decodeLook,
  encodeSnapshot,
  parseSnapshot,
  type Snapshot,
  snapshotInstant,
} from "@/lib/city/snapshot";
import { restoresLook } from "@/lib/city/gpu-safety";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { AltitudeStick } from "./altitude-stick";
import { BootError, layerErrorText } from "./boot-error";
import { ControlHintBar } from "./control-hints";
import { CrashReport } from "./crash-report";
import { startCrashReports } from "./crash-reports";
import { type CrashTrail, startCrashTrail } from "./crash-trail";
import { GpuFailureCard } from "./gpu-failure-card";
import {
  peekRecoverySnapshot,
  recoverFromGpuLoss,
  recoverOnRequest,
  takeRecoverySnapshot,
} from "./gpu-recovery";
import { raiseSafety } from "./gpu-safety";
import { VEIL_HOLD_MS } from "./handover";
import type { CityWalkHandle, CityWalkStats, SiteInfo } from "./create-app";
import { LoadScreen } from "./load-screen";
import { type HudTool, HudToolbar } from "./hud-toolbar";
import type { ExportContext } from "./image-export";
import { InquiryCard } from "./inquiry-card";
import { InquiryStrip, InquiryTapRing } from "./inquiry-strip";
import { useLiveMode } from "./live-mode";
import {
  LocateMessage,
  type Say,
  useHudMessage,
  useLocateMe,
} from "./locate-button";
import { LocateOffsiteDialog } from "./locate-offsite-dialog";
import { ModelInstruments } from "./model-instruments";
import type { ModelHud, ViewMode } from "./model-rig";
import { updatePocDebug } from "./poc-debug";
import { postProfileFor, type SceneBudget } from "./scene-profile";
import {
  overlook,
  spawnViewpoint,
  type ViewpointGeometry,
} from "@/lib/city/site";
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
  /**
   * The data manifest could not be read (city-walk-client.tsx): the boot
   * error says why and tries again.
   */
  manifestError?: { message: string; retry: () => void };
  /**
   * the tileset the scene streams (lib/city/tileset.ts); null while the
   * data manifest that names it is still on its way — the HUD is up
   * already, the scene waits for it
   */
  tilesetUrl: string | null;
}

/**
 * Where the scene starts when a place was picked before it was up: a
 * vantage (a place, a spot on the map) or a snapshot's camera, and what to
 * call it on the loading screen. Null: the spawn.
 */
interface StartPick {
  camera?: CameraState;
  label: string;
  view?: ViewpointGeometry;
}

/** The three.js half of the viewer, loaded beside the HUD (create-app.ts). */
const loadScene = () => import("./create-app");

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

/**
 * What stopped the boot, for its card: the scene's own failure (tried
 * again by a reload — not without a GPU, where that cannot help), or the
 * data manifest that never came (city-walk-client.tsx tries again). Null
 * while nothing has.
 */
function bootFailureOf(
  status: Status,
  supported: boolean,
  manifestError: Props["manifestError"]
): { message: string; onRetry?: () => void } | null {
  if (status.phase === "error") {
    return {
      message: status.message,
      onRetry: supported ? () => location.reload() : undefined,
    };
  }
  return manifestError
    ? { message: manifestError.message, onRetry: manifestError.retry }
    : null;
}

// Evaluated once in the browser (the component is loaded with ssr: false).
const INITIAL_DATE = new Date();

/** A little air after the veil is gone before the heavy work resumes. */
const STREAM_SETTLE_MS = 250;

/** Whether the mouse is locked to the scene (immersive mode). iOS Safari
 *  has no Pointer Lock: its `pointerLockElement` is undefined, not null. */
function usePointerLocked(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("pointerlockchange", onChange);
      return () => document.removeEventListener("pointerlockchange", onChange);
    },
    () => document.pointerLockElement != null,
    () => false
  );
}

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
      className="absolute top-4 right-4 z-40 size-9 rounded-full border-0 bg-hud/85 text-hud-foreground shadow-lg backdrop-blur-lg hover:bg-hud/95"
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
 * while a compass is reporting (live-mode.ts), on a touch screen walk/
 * fly, the F key's stand-in, and everywhere Modell (plan 055), the M key's.
 */
function sceneTools({
  coarse,
  live,
  locate,
  mode,
  onToggleMode,
  onToggleModel,
}: {
  coarse: boolean;
  live: ReturnType<typeof useLiveMode>;
  locate: ReturnType<typeof useLocateMe>;
  mode: ViewMode;
  onToggleMode: () => void;
  onToggleModel: () => void;
}): HudTool[] {
  const tools: HudTool[] = [];
  if (locate.available && mode !== "model") {
    tools.push({
      id: "locate",
      label: "Standort",
      icon: LocateFixedIcon,
      busy: locate.locating,
      onClick: locate.locate,
      title: "Zu meinem Standort springen, Blick in Telefonrichtung",
    });
  }
  if (live.available && mode !== "model") {
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
  tools.push({
    id: "model",
    label: "Modell",
    icon: BoxIcon,
    pressed: mode === "model",
    onClick: onToggleModel,
    title:
      "Modell: die Stadt in Parallelprojektion — Isometrie, Lageplan, Ansicht (M)",
  });
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
  modelView,
  onClimb,
  onMove,
  onNorth,
  onToggleMode,
  onToggleModel,
  onTurn,
}: {
  coarse: boolean;
  /** the inquiry sheet covers the bottom of the screen (touch) */
  covered: boolean;
  live: ReturnType<typeof useLiveMode>;
  locate: ReturnType<typeof useLocateMe>;
  mode: ViewMode;
  /** Modell's view, while it is shown (plan 055) */
  modelView: ModelHud | null;
  onClimb: (v: number) => void;
  onMove: (x: number, y: number) => void;
  onNorth: () => void;
  onToggleMode: () => void;
  onToggleModel: () => void;
  onTurn: (deg: number) => void;
}) {
  const { state, isMobile, openMobile } = useSidebar();
  const model = mode === "model";
  if (covered || (isMobile && openMobile)) {
    return null;
  }
  // On a desktop the open panel floats at the right: Modell's instruments
  // (bottom left) are its legend and stay; the walker's controls step
  // aside as before.
  if (!isMobile && state === "expanded") {
    return model && modelView ? (
      <div className="absolute bottom-6 left-5">
        <ModelInstruments onNorth={onNorth} onTurn={onTurn} view={modelView} />
      </div>
    ) : null;
  }
  const flying = mode === "fly";
  return (
    <>
      {/* keyed: Modell's bar is its own, dismissed on its own */}
      <ControlHintBar coarse={coarse} key={mode} model={model} />
      {/* Clear of the hint bar even when it wraps to two rows on a phone.
          In Modell the joystick's place holds the instruments: the scale
          bar and the north arrow between the two quarter turns. */}
      <div className="absolute bottom-24 left-5">
        {model ? (
          modelView && (
            <ModelInstruments
              onNorth={onNorth}
              onTurn={onTurn}
              view={modelView}
            />
          )
        ) : (
          <VirtualJoystick onChange={onMove} />
        )}
      </div>
      {/* Bottom-anchored with the toolbar last, so it stays put when fly
          mode brings the altitude stick in above it. */}
      <div className="absolute right-5 bottom-24 flex flex-col items-center gap-3">
        {flying && <AltitudeStick onChange={onClimb} />}
        <HudToolbar
          tools={sceneTools({
            coarse,
            live,
            locate,
            mode,
            onToggleMode,
            onToggleModel,
          })}
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
 * player stands (`#at=lat,lng`, lib/city/geolocation.ts `arrivalHref` — the
 * fragment: never sent to the server, not kept by the trail): put them
 * there, on foot, and drop the fragment so a reload starts at the site's
 * spawn again.
 */
function arriveAt(h: CityWalkHandle, site: Site, say: Say): void {
  const at = arrivalOf(location.hash);
  if (!at) {
    return;
  }
  const url = new URL(location.href);
  url.hash = "";
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

/** The camera stands on the vantage (within a few metres of it). */
function standsAt(h: CityWalkHandle, view: ViewpointGeometry): boolean {
  const { epsg } = h.getCameraState();
  return Math.hypot(epsg.x - view.epsg.x, epsg.y - view.epsg.y) < 5;
}

/**
 * The loading screen inside the shell: the panel is open over it on a
 * desktop, so its text keeps clear of the panel, and a place picked there
 * is named — the scene starts at it.
 */
function ShellLoadScreen(props: {
  destination?: string;
  handedOver: boolean;
  percent: number;
  stages: LoadStageState[];
}) {
  const { isMobile, state } = useSidebar();
  return (
    <LoadScreen {...props} besidePanel={!isMobile && state === "expanded"} />
  );
}

export default function CityWalk({ budget, manifestError, tilesetUrl }: Props) {
  const site = useSite();
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CityWalkHandle | null>(null);
  const applySceneTime = useCallback(
    (date: Date, preview?: boolean) => handleRef.current?.setSun(date, preview),
    []
  );
  const poseListeners = useRef<Set<(pose: PlayerPose) => void>>(new Set());
  const coarse = useCoarsePointer();
  const immersive = usePointerLocked();
  const [aimingCentre, setAimingCentre] = useState(false);
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
  // The picture style starts as the viewer last left it (style-memory.ts) —
  // from safety level 2 in the default one (lib/city/gpu-safety.ts).
  const [look] = useState(() =>
    createLookState({
      ...LOOK_DEFAULTS,
      style:
        (restoresLook(budget.safety) ? readStoredStyle() : null) ??
        LOOK_DEFAULTS.style,
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
  const [mode, setMode] = useState<ViewMode>("walk");
  // Modell's view while it is shown (plan 055): scale, turn, the instruments.
  const [modelView, setModelView] = useState<ModelHud | null>(null);
  // Befragen (ADR 0042): what was asked last, while its card is open.
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  // everything the question's ray met (the strip beside the tap)
  const [along, setAlong] = useState<InquiryAlong | null>(null);
  const [provenanceUrl, setProvenanceUrl] = useState<string | null>(null);
  const closeInquiry = useCallback(() => {
    handleRef.current?.clearInquiry();
    setInquiry(null);
    setAlong(null);
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
  // through a ref, as it does live mode. The time and the look go back
  // before the boot, so the scene starts with them; the camera goes to the
  // boot itself (`initialCamera`), Modell after its first frame. From
  // safety level 2 neither the picture style nor Modell come back.
  const recovery = useRef<{
    capture: () => string | null;
    prepare: (snapshot: Snapshot) => void;
  } | null>(null);
  useEffect(() => {
    recovery.current = {
      capture: () => {
        const h = handleRef.current;
        return h
          ? JSON.stringify(
              encodeSnapshot(look.get(), h.getCameraState(), time.current())
            )
          : null;
      },
      prepare: (snapshot) => {
        time.setInstant(snapshotInstant(snapshot));
        const patch = decodeLook(snapshot.look);
        if (!restoresLook(budget.safety)) {
          delete patch.style;
        }
        look.set(patch);
      },
    };
  });
  // The render stopped and the page did not recover by itself: the
  // browser's words, for the failure card (gpu-failure-card.tsx).
  const [gpuFailure, setGpuFailure] = useState<string | null>(null);
  /**
   * The card's buttons: a level lighter where the player stood, or not —
   * a raise on top of what the page itself raised (no `by`), so that
   * *Leichter weiter* is lighter than *Neu laden*.
   */
  const reloadAfterFailure = (lighter: boolean) => {
    if (lighter) {
      recoverOnRequest(
        recovery.current?.capture() ?? null,
        budget.safety,
        (from) => raiseSafety(from)
      );
    }
    const released = handleRef.current?.releaseGpu() ?? Promise.resolve();
    void released.then(() => location.reload());
  };
  const [landcoverTiles, setLandcoverTiles] = useState<MapTile[]>([]);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [fps, setFps] = useState<number | null>(null);
  const [snapshotText, setSnapshotText] = useState("");
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<SceneTabId>("erkunden");
  const [rememberedView, setRememberedView] =
    useState<ViewpointGeometry | null>(null);
  // A place picked while the scene loads: the boot starts over there.
  const [start, setStart] = useState<StartPick | null>(null);
  /**
   * Somewhere to go, from the panel: a glide once the scene is up, before
   * that the place the scene starts at — a boot already under way is
   * dropped and starts again there, so the page loads that place's tile
   * first instead of the spawn's and then the way to it. After a failed
   * boot that is trying again, from there; without a GPU the scene never
   * boots (the panel's travel is off then).
   */
  const goTo = (pick: StartPick) => {
    const h = handleRef.current;
    if (h) {
      if (pick.camera) {
        h.applyCameraState(pick.camera);
      } else if (pick.view) {
        h.flyToViewpoint(pick.view);
      }
      return;
    }
    if (!supported) {
      return;
    }
    setStatus({ phase: "loading" });
    setProgress({ fractions: {}, skipped: {} });
    setStart(pick);
  };
  /** The site as the tileset describes it (create-app.ts `onSiteInfo`). */
  const applySiteInfo = useCallback((info: SiteInfo) => {
    setBounds(info.terrainBounds);
    setProvenanceUrl(info.provenanceUrl);
    setLatLng(info.latLng);
    setLandcoverTiles(info.landcoverTiles);
    setLandmarks(info.landmarks);
  }, []);

  // This page's crash trail, from before the renderer exists: a page the
  // browser kills leaves its last steps for the next load (crash-trail.ts),
  // which reports them where the build has a DSN (crash-reports.ts). One
  // per mount, not per boot: a place picked while loading boots the scene
  // again, which the trail notes — it is still the same page, and the
  // error tracker hears of one session (ADR 0043), not one per pick.
  const trailRef = useRef<CrashTrail | null>(null);
  const pageTrail = useCallback(() => {
    trailRef.current ??= startCrashTrail(startCrashReports() ?? undefined);
    return trailRef.current;
  }, []);
  useEffect(
    () => () => {
      trailRef.current?.end();
      trailRef.current = null;
    },
    []
  );
  // The last boot, settled: running, or failed or aborted and torn down. A
  // boot waits for the one before it, so picks in quick succession never
  // hold two renderers (two GPU devices) at once — and a boot aborted
  // while it waited never creates one.
  const lastBoot = useRef<Promise<void>>(Promise.resolve());

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
    // renderer, no handle, nothing to clean up. Without the tileset's name
    // (the manifest is still on its way) the HUD is up and the scene waits.
    if (!supported || tilesetUrl === null) {
      return;
    }
    let cancelled = false;
    // The render stopped for good (onFatal): its message stays.
    let fatal = false;
    let handle: CityWalkHandle | null = null;
    let veilTimer: ReturnType<typeof setTimeout> | undefined;
    let streamFallback: ReturnType<typeof setTimeout> | undefined;
    const beginStreaming = () => handleRef.current?.startStreaming();
    const aborter = new AbortController();
    const trail = pageTrail();
    if (start) {
      // (not which: the reports carry no position, ADR 0043)
      trail.note("boot restarted", "a place picked while loading");
    }
    // Back where the player stood before the GPU was lost (gpu-recovery.ts):
    // read now, taken once the scene is up — a boot that StrictMode aborts
    // leaves it for the next.
    const text = peekRecoverySnapshot();
    const parsed = text ? parseSnapshot(text) : null;
    const restored = parsed?.ok ? parsed.snapshot : null;
    // A place picked in the panel meanwhile wins over the recovered one,
    // and the time and look the player set are theirs.
    if (restored && !start) {
      recovery.current?.prepare(restored);
    }

    let settled = () => {};
    const previous = lastBoot.current;
    lastBoot.current = new Promise((resolve) => {
      settled = resolve;
    });
    previous
      .then(loadScene)
      .then(({ createCityWalkApp }) => {
        if (aborter.signal.aborted) {
          throw new DOMException("CityWalk startup aborted", "AbortError");
        }
        return createCityWalkApp({
          container,
          budget,
          look,
          site,
          tilesetUrl,
          initialCamera: start ? start.camera : restored?.camera,
          initialView: start?.view,
          initialDate: timeNow(),
          onSiteInfo: (info) => {
            if (!cancelled) {
              startTransition(() => applySiteInfo(info));
            }
          },
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
                skipped: isSkipped
                  ? { ...prev.skipped, [id]: true }
                  : prev.skipped,
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
          // A loss raises the level as this page's (`by`): after its own
          // memory emergency the same incident, renewed rather than raised
          // again (gpu-safety.ts).
          onGpuLost: (how) =>
            !cancelled &&
            recoverFromGpuLoss(
              how,
              recovery.current?.capture() ?? null,
              budget.safety,
              (from) => raiseSafety(from, { by: trail.startedAt })
            )
              ? () => location.reload()
              : null,
          onError: (message) => {
            // After a fatal one the render has stopped: a tile still in flight
            // failing must not add a layer's hole under the failure card.
            if (cancelled || fatal) {
              return;
            }
            // One tile (or one tile's dressing) failed after the first frame: it
            // leaves a hole, and the rest keeps streaming — the stages still
            // finish on their own (a failed tile counts as done), so they are
            // not settled here. A failure before the first frame rejects the
            // boot instead.
            setStreamError(layerErrorText(message));
          },
          onErrorCleared: () => {
            // the tile it named came back (a fatal message stays)
            if (!(cancelled || fatal)) {
              setStreamError(null);
            }
          },
          onFatal: (message) => {
            if (!cancelled) {
              fatal = true;
              setGpuFailure(message);
            }
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
          onModelView: (view) => {
            if (!cancelled) {
              // At the pose tick's rate, read by the instruments and the panel.
              startTransition(() => setModelView(view));
            }
          },
          onInquiry: (asked, met) => {
            if (!cancelled) {
              setInquiry(asked);
              setAlong(met);
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
        });
      })
      .then((h) => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        handleRef.current = h;
        trail.note("first frame");
        if (start) {
          // Not back where the GPU was lost: the player chose a place.
          if (restored) {
            takeRecoverySnapshot();
          }
          // The boot stood on the camera's spot; Modell only now. A place
          // off every tile the boot streams (the lite profile's spawn tile
          // alone) is glided to from the spawn.
          if (start.camera) {
            h.applyCameraState(start.camera);
          } else if (start.view && !standsAt(h, start.view)) {
            h.flyToViewpoint(start.view);
          }
        } else if (restored) {
          // The scene booted there; Modell (where the safety level keeps
          // it) and a place off every tile only now.
          takeRecoverySnapshot();
          h.applyCameraState(
            restoresLook(budget.safety)
              ? restored.camera
              : { ...restored.camera, model: undefined }
          );
          trail.note("recovered", "after a lost GPU");
        } else {
          arriveAt(h, site, sayHud);
        }
        syncTime();
        setFootprints(h.getFootprints());
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
          // A place that failed the boot is not tried again on the next
          // load: the recovery's snapshot goes with this boot.
          takeRecoverySnapshot();
          trail.note(
            "boot failed",
            err instanceof Error ? err.message : String(err)
          );
          setStatus({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(settled);

    return () => {
      cancelled = true;
      aborter.abort();
      // The card belongs to the scene that marked its building: a route
      // kept hidden (and shown again) boots a new scene without that mark.
      setInquiry(null);
      setAlong(null);
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
  }, [
    budget,
    look,
    site,
    start,
    tilesetUrl,
    supported,
    timeNow,
    syncTime,
    sayHud,
    applySiteInfo,
    pageTrail,
  ]);

  const copySnapshot = () => {
    const h = handleRef.current;
    if (!h) {
      return;
    }
    const snap = encodeSnapshot(look.get(), h.getCameraState(), time.current());
    const text = JSON.stringify(snap, null, 2);
    setSnapshotText(text);
    navigator.clipboard?.writeText(text).then(
      () => setSnapshotMsg("In die Zwischenablage kopiert"),
      () => setSnapshotMsg("Kopieren fehlgeschlagen — Text manuell auswählen")
    );
  };

  const applySnapshot = () => {
    // Validate every field before anything is applied: a trimmed or
    // hand-edited snapshot names what is wrong instead of yielding a NaN
    // camera and "Snapshot applied".
    const parsed = parseSnapshot(snapshotText);
    if (!parsed.ok) {
      setSnapshotMsg(parsed.reason);
      return;
    }
    const snap = parsed.snapshot;
    const loading = handleRef.current === null;
    goTo({ camera: snap.camera, label: "Snapshot" });
    // The minute the sliders can show (see snapshotInstant), for the sun and
    // the two time controls alike.
    time.setInstant(snapshotInstant(snap));
    look.set(decodeLook(snap.look));
    setSnapshotMsg(
      loading
        ? "Snapshot gewählt — die Szene startet dort"
        : "Snapshot angewendet"
    );
  };

  // Bild speichern and the Verschattungsstudie (plan 055): one at a time.
  // While one renders (a tile a frame) a veil covers the canvas, which
  // shows the picture's pieces as they are taken.
  const exporting = useRef(false);
  const [exportVeil, setExportVeil] = useState(false);
  const runExport = (
    what: (h: CityWalkHandle, info: ExportContext) => Promise<void>,
    busy: string,
    done: string
  ) => {
    const h = handleRef.current;
    if (!h || exporting.current) {
      return;
    }
    exporting.current = true;
    setExportVeil(true);
    hud.say(busy, true);
    what(h, {
      site,
      date: time.current(),
      model: h.getModelHud(),
      style: look.get().style,
    })
      .then(
        () => hud.say(done),
        (err: unknown) =>
          hud.say(
            `Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`
          )
      )
      .finally(() => {
        exporting.current = false;
        setExportVeil(false);
      });
  };
  // (image-export.ts is the scene's: loaded with it, not with the HUD)
  const exportImage = () =>
    runExport(
      (h, info) =>
        import("./image-export").then(({ saveImage }) => saveImage(h, info)),
      "Bild wird gerendert …",
      "Bild gespeichert"
    );
  const exportStudy = () =>
    runExport(
      (h, info) =>
        import("./image-export").then(({ saveShadowStudy }) =>
          saveShadowStudy(h, info, (n, total) =>
            hud.say(`Verschattungsstudie: Bild ${n} von ${total} …`, true)
          )
        ),
      "Verschattungsstudie wird gerendert …",
      "Verschattungsstudie gespeichert"
    );

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
  const failure = bootFailureOf(status, supported, manifestError);

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
          building (ADR 0042), it must not also mark the HUD's text. Its own
          stacking context (isolate): the loading screen covers the scene,
          never the panel, which is open while the city loads. The cards
          that stop the page (a failed boot, a lost GPU, the crash report)
          stand outside it, over the panel too. */}
      <div className="absolute inset-0 isolate overflow-hidden bg-[image:var(--hud-scrim)] select-none [-webkit-touch-callout:none]">
        <div className="absolute inset-0" ref={mountRef} />

        {/* Not over a failure: its card is what there is to read, and to
            click (it tries again). */}
        {veilUp && failure === null && (
          <ShellLoadScreen
            destination={start?.label}
            handedOver={status.phase === "running"}
            percent={percent}
            stages={stages}
          />
        )}

        <SettingsToggle />

        {exportVeil && (
          <div
            aria-hidden
            className="absolute inset-0 z-10 bg-background/80 backdrop-blur-md"
            data-testid="export-veil"
          />
        )}

        {booted && (
          <>
            {/* No dot in the middle: the pointer aims (I and R act under
                it). Only immersive mode, which hides the pointer, marks
                the centre it aims at instead, and so does the panel's
                demolish button while it is pointed at or focused — it acts
                at the centre. Never on Modell's sheet. */}
            {(immersive || aimingCentre) && mode !== "model" && (
              <div
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
              />
            )}

            {/* The loading screen, at pill size. It retires itself once the
                last layer has landed and it has been readable for a moment. */}
            <StreamPill busy={streamingMore} stages={stages} />

            {streamError && (
              <output
                aria-live="polite"
                className="pointer-events-none absolute top-15 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-destructive/90 px-3 py-1 text-[11px] text-white"
              >
                {streamError}
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
              <InquiryPanel
                along={along}
                coarse={coarse}
                inquiry={inquiry}
                onClose={closeInquiry}
                onPreview={(i) => handleRef.current?.previewCandidate(i)}
                onSelect={(i) => handleRef.current?.selectCandidate(i)}
                provenanceUrl={provenanceUrl}
              />
            )}
            <SceneOverlays
              coarse={coarse}
              covered={coarse && inquiry !== null}
              live={live}
              locate={locate}
              mode={mode}
              modelView={modelView}
              onClimb={(v) => handleRef.current?.setClimbInput(v)}
              onMove={(x, y) => handleRef.current?.setMoveInput(x, y)}
              onNorth={() => handleRef.current?.turnModelTo(0)}
              onToggleMode={() =>
                handleRef.current?.setMovementMode(
                  mode === "fly" ? "walk" : "fly"
                )
              }
              onToggleModel={() => handleRef.current?.toggleModel()}
              onTurn={(deg) => handleRef.current?.turnModel(deg)}
            />
          </>
        )}
      </div>

      <CrashReport />

      {gpuFailure !== null && (
        <GpuFailureCard
          detail={gpuFailure}
          onLighter={() => reloadAfterFailure(true)}
          onReload={() => reloadAfterFailure(false)}
        />
      )}

      {failure && (
        <BootError message={failure.message} onRetry={failure.onRetry} />
      )}

      <SceneSidebar
        dataLayerDetail={{
          bikeLayer: (
            <BikeCountList
              counters={bikeCounters}
              onFly={(c) =>
                goTo({
                  label: c.name,
                  view: overlook(c, {
                    altitude: 45,
                    description: c.where,
                    headingDeg: 0,
                    id: c.id,
                    label: c.name,
                    pitchDeg: -30,
                  }),
                })
              }
            />
          ),
          trafficLayer: <TrafficHourLine status={trafficHour} />,
          tramLayer: <TramStatusLine status={tramStatus} />,
        }}
        applySnapshot={applySnapshot}
        bounds={bounds}
        canTravel={supported}
        coarse={coarse}
        onAimCentre={setAimingCentre}
        copySnapshot={copySnapshot}
        day={time.day}
        footprints={footprints}
        fps={fps}
        handleRef={handleRef}
        landcoverTiles={landcoverTiles}
        landmarks={landmarks}
        latLng={latLng}
        lensBlur={postProfileFor(budget.tier).dof}
        look={lookValues}
        minutes={time.minutes}
        mode={mode}
        modelView={modelView}
        onLook={look.set}
        onDefaultTime={() => time.set(time.day, INITIAL_MINUTES)}
        onExport={exportImage}
        onStudy={exportStudy}
        onTab={setTab}
        onTeleport={(x, y) => {
          const h = handleRef.current;
          if (h) {
            h.glideToSpot(x, y);
            return;
          }
          // On foot there, looking the way the spawn looks.
          const { fov, headingDeg } = spawnViewpoint(site);
          goTo({
            label: "Punkt auf der Karte",
            view: {
              aboveGround: EYE_HEIGHT,
              epsg: { x, y },
              fov,
              headingDeg,
              mode: "walk",
              pitchDeg: 0,
            },
          });
        }}
        onTravel={(view, label) =>
          goTo({ label: label ?? "Gemerkte Ansicht", view })
        }
        previewSun={time.preview}
        ready={booted}
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
    </SidebarProvider>
  );
}

/**
 * The asked thing's card and what else the ray met: on a desktop one
 * column at the left, the card over the list; on a touch screen the sheet
 * with the chips above it. The tap's ring either way.
 */
function InquiryPanel({
  along,
  coarse,
  inquiry,
  onClose,
  onPreview,
  onSelect,
  provenanceUrl,
}: {
  along: InquiryAlong | null;
  coarse: boolean;
  inquiry: Inquiry;
  onClose: () => void;
  onPreview: (index: number | null) => void;
  onSelect: (index: number) => void;
  provenanceUrl: string | null;
}) {
  const strip = along && (
    <InquiryStrip
      along={along}
      onPreview={onPreview}
      onSelect={onSelect}
      sheet={coarse}
    />
  );
  const card = (
    <InquiryCard
      inquiry={inquiry}
      onClose={onClose}
      provenanceUrl={provenanceUrl}
      sheet={coarse}
    />
  );
  return (
    <>
      {along && <InquiryTapRing along={along} />}
      {coarse ? (
        <>
          {strip}
          {card}
        </>
      ) : (
        <div className="pointer-events-none absolute inset-y-4 left-4 z-20 flex w-[min(22rem,calc(100%-2rem))] flex-col items-stretch gap-2">
          {card}
          {strip}
        </div>
      )}
    </>
  );
}
