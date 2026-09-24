"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import {
  type CSSProperties,
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
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { createLookState } from "@/lib/city/look-state";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { PlayerPose } from "@/lib/city/pose";
import {
  decodeLook,
  encodeSnapshot,
  parseSnapshot,
  snapshotInstant,
} from "@/lib/city/snapshot";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { ControlHintBar } from "./control-hints";
import { VEIL_HOLD_MS } from "./handover";
import {
  type CityWalkHandle,
  type CityWalkStats,
  createCityWalkApp,
} from "./create-app";
import type { MovementMode } from "./fps-movement";
import { LoadScreen } from "./load-screen";
import { updatePocDebug } from "./poc-debug";
import type { SceneBudget } from "./scene-profile";
import type { ViewpointGeometry } from "@/lib/city/site";
import { SceneSidebar } from "./scene-sidebar";
import type { SceneTabId } from "./scene-tabs";
import { StreamPill } from "./stream-pill";
import type { SunState } from "./sun-rig";
import { VirtualJoystick } from "./virtual-joystick";
import { missingPrerequisite } from "./webgl-support";

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
const INITIAL_MINUTES = 14 * 60;

/** A little air after the veil is gone before the heavy work resumes. */
const STREAM_SETTLE_MS = 250;

/** Local-time instant from a calendar day + minutes-of-day slider. */
function composeDate(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
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
 * The overlays that belong to the scene, not to the panel: the key hints and
 * the joystick. Both step aside while the sidebar is open — on a phone the
 * sidebar is a sheet, so a joystick left mounted underneath would be a dead
 * control the player can still see.
 */
function SceneOverlays({
  coarse,
  onMove,
}: {
  coarse: boolean;
  onMove: (x: number, y: number) => void;
}) {
  const { state, isMobile, openMobile } = useSidebar();
  if (isMobile ? openMobile : state === "expanded") {
    return null;
  }
  return (
    <>
      <ControlHintBar coarse={coarse} />
      {/* Clear of the hint bar even when it wraps to two rows on a phone. */}
      <div className="absolute bottom-24 left-5">
        <VirtualJoystick onChange={onMove} />
      </div>
    </>
  );
}

export default function CityWalk({ budget, tilesetUrl }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CityWalkHandle | null>(null);
  const poseListeners = useRef<Set<(pose: PlayerPose) => void>>(new Set());
  const coarse = useCoarsePointer();

  // Probed once, before the renderer is created: three's raw "Error creating
  // WebGL context" (or a tile's bare ReferenceError) is replaced by a
  // sentence naming the missing prerequisite.
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
  const [sun, setSun] = useState<SunState | null>(null);
  const [day, setDay] = useState(INITIAL_DATE);
  const [minutes, setMinutes] = useState(INITIAL_MINUTES);
  // The look store outlives the scene: a remount (StrictMode, a tile switch)
  // boots the new instance from it, so sliders and scene never disagree.
  const [look] = useState(createLookState);
  const lookValues = useSyncExternalStore(look.subscribe, look.get, look.get);
  const [mode, setMode] = useState<MovementMode>("walk");
  const [footprints, setFootprints] = useState<FootprintPoly[]>([]);
  const [bounds, setBounds] = useState<TerrainBounds | null>(null);
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [landcoverTiles, setLandcoverTiles] = useState<
    { bounds: TerrainBounds; src: string }[]
  >([]);
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
    // The WebGL2 preflight already failed (see the status initializer): no
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

    createCityWalkApp({
      container,
      budget,
      look,
      tilesetUrl,
      initialDate: composeDate(INITIAL_DATE, INITIAL_MINUTES),
      signal: aborter.signal,
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
      onFps: (value) => {
        if (!cancelled) {
          // Twice a second, read only in the Erweitert tab's counters.
          startTransition(() => setFps(value));
        }
      },
      onModeChange: (m) => {
        if (!cancelled) {
          setMode(m);
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
        setSun(h.setSun(composeDate(INITIAL_DATE, INITIAL_MINUTES)));
        setFootprints(h.getFootprints());
        setBounds(h.terrainBounds);
        setLatLng(h.latLng);
        setLandcoverTiles(h.landcoverTiles);
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
          setStatus({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
      aborter.abort();
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
  }, [budget, look, tilesetUrl, supported]);

  const updateSun = (nextDay: Date, nextMinutes: number) => {
    setDay(nextDay);
    setMinutes(nextMinutes);
    const state = handleRef.current?.setSun(composeDate(nextDay, nextMinutes));
    if (state) {
      setSun(state);
    }
  };

  const copySnapshot = () => {
    const h = handleRef.current;
    if (!h) {
      return;
    }
    const snap = encodeSnapshot(
      look.get(),
      h.getCameraState(),
      composeDate(day, minutes)
    );
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
    const date = snapshotInstant(snap);
    const nextDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    updateSun(nextDay, date.getHours() * 60 + date.getMinutes());
    look.set(decodeLook(snap.look));
    setSnapshotMsg("Snapshot angewendet");
  };

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
          it), so toggling the panel can't flash the WebGL canvas. */}
      <div className="absolute inset-0 overflow-hidden bg-[image:var(--hud-scrim)]">
        <div className="absolute inset-0" ref={mountRef} />

        {veilUp && (
          <LoadScreen
            handedOver={status.phase === "running"}
            percent={percent}
            stages={stages}
          />
        )}

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
              className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            />

            {/* The loading screen, at pill size. It retires itself once the
                last layer has landed and it has been readable for a moment. */}
            <StreamPill busy={streamingMore} stages={stages} />

            {streamError && (
              <output
                aria-live="polite"
                className="pointer-events-none absolute top-15 left-1/2 -translate-x-1/2 rounded-full bg-destructive/90 px-3 py-1 text-[11px] text-white"
              >
                Eine Schicht konnte nicht geladen werden: {streamError}
              </output>
            )}

            <SettingsToggle />
            <SceneOverlays
              coarse={coarse}
              onMove={(x, y) => handleRef.current?.setMoveInput(x, y)}
            />
          </>
        )}
      </div>

      {booted && (
        <SceneSidebar
          applySnapshot={applySnapshot}
          bounds={bounds}
          coarse={coarse}
          copySnapshot={copySnapshot}
          day={day}
          footprints={footprints}
          fps={fps}
          handleRef={handleRef}
          landcoverTiles={landcoverTiles}
          latLng={latLng}
          look={lookValues}
          minutes={minutes}
          mode={mode}
          onLook={look.set}
          onDefaultTime={() => updateSun(day, INITIAL_MINUTES)}
          onTab={setTab}
          onTeleport={(x, y) => handleRef.current?.teleportTo(x, y)}
          rememberedView={rememberedView}
          resetLook={() => look.set(LOOK_DEFAULTS)}
          setRememberedView={setRememberedView}
          setSnapshotText={setSnapshotText}
          snapshotMsg={snapshotMsg}
          snapshotText={snapshotText}
          stats={stats}
          subscribePose={subscribePose}
          sun={sun}
          tab={tab}
          updateSun={updateSun}
        />
      )}
    </SidebarProvider>
  );
}
