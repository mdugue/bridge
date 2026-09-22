"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import {
  addTransitionType,
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
  LOAD_STAGES,
  loadPercent,
  type LoadStageState,
  loadStageStates,
  type SkippedStages,
  type StageFractions,
} from "@/lib/city/load-stages";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { createLookState } from "@/lib/city/look-state";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { CameraState, PlayerPose } from "@/lib/city/pose";
import {
  decodeLook,
  encodeSnapshot,
  parseSnapshot,
  snapshotInstant,
} from "@/lib/city/snapshot";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import type { TileUrls } from "@/lib/city/tile";
import { ControlHintBar } from "./control-hints";
import { HANDOVER_TYPE } from "./handover";
import {
  type CityWalkHandle,
  type CityWalkStats,
  createCityWalkApp,
} from "./create-app";
import type { MovementMode } from "./fps-movement";
import { LoadScreen } from "./load-screen";
import { updatePocDebug } from "./poc-debug";
import type { SceneBudget } from "./scene-profile";
import { SceneSidebar } from "./scene-sidebar";
import type { SceneTabId } from "./scene-tabs";
import { StreamPill } from "./stream-pill";
import type { SunState } from "./sun-rig";
import { VirtualJoystick } from "./virtual-joystick";
import { hasWebGl2 } from "./webgl-support";

interface Props {
  /** The render budget the page was opened with (see scene-profile.ts) */
  budget: SceneBudget;
  /** Neighbouring tiles rendered around the primary one for context */
  extraTiles?: TileUrls[];
  /** Optional glTF/GLB to insert; falls back to a marker box */
  insertedModelUrl?: string;
  /** The spawn tile's URLs (see lib/city/tile.ts) */
  primary: TileUrls;
}

/**
 * Two phases, one handover. `loading` is the full-bleed Laden screen; `running`
 * is the live scene with the streaming pill. The flip happens in a React
 * transition so the two can morph into each other — see handover.ts.
 */
type Status =
  | { phase: "error"; message: string }
  | { phase: "loading" }
  | { phase: "running" };

// Evaluated once in the browser (the component is loaded with ssr: false).
const INITIAL_DATE = new Date();
const INITIAL_MINUTES = 14 * 60;

/**
 * How long the handover may stay pending before it is taken urgently, without
 * the morph. A React transition is interruptible and yields to the browser, so
 * on a device whose frames cost hundreds of milliseconds — which is exactly
 * what the first frames of this scene cost — it can sit unrendered for
 * seconds. The loading screen would then cover a scene that is ready to walk
 * in, which is the one thing this redesign must never do. The animation is the
 * part that is allowed to be dropped, not the first frame.
 */
const HANDOVER_FALLBACK_MS = 1500;

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

export default function CityWalk({
  budget,
  primary,
  extraTiles,
  insertedModelUrl,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CityWalkHandle | null>(null);
  const poseListeners = useRef<Set<(pose: PlayerPose) => void>>(new Set());
  const coarse = useCoarsePointer();

  // Probed once, before the renderer is created: three's raw "Error creating
  // WebGL context" is replaced by a sentence naming the one prerequisite.
  const [webGl2] = useState(hasWebGl2);
  const [status, setStatus] = useState<Status>(() =>
    webGl2
      ? { phase: "loading" }
      : {
          phase: "error",
          message:
            "Dieser Viewer braucht WebGL2, das dieser Browser oder dieses Gerät " +
            "nicht bereitstellt. Bitte einen aktuellen Desktop- oder Mobil-Browser " +
            "mit aktivierter Hardwarebeschleunigung verwenden.",
        }
  );
  // What the scene has reported per load stage (lib/city/load-stages.ts): the
  // loading screen, the handover and the pill all read this. One piece of
  // state, not two, because a streaming failure has to settle both at once.
  const [progress, setProgress] = useState<{
    fractions: StageFractions;
    skipped: SkippedStages;
  }>({ fractions: {}, skipped: {} });
  const [streamError, setStreamError] = useState<string | null>(null);
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
  const [rememberedView, setRememberedView] = useState<CameraState | null>(
    null
  );

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
    if (!webGl2) {
      return;
    }
    let cancelled = false;
    let handle: CityWalkHandle | null = null;
    let handoverFallback: ReturnType<typeof setTimeout> | undefined;
    const aborter = new AbortController();

    createCityWalkApp({
      container,
      budget,
      look,
      primary,
      extraTiles,
      insertedModelUrl,
      initialDate: composeDate(INITIAL_DATE, INITIAL_MINUTES),
      signal: aborter.signal,
      onStage: ({ id, fraction, skipped: isSkipped }) => {
        if (cancelled) {
          return;
        }
        // Deliberately NOT an urgent update. These arrive many times a
        // second while a tile streams, and urgent work at that rate starves
        // the one transition that matters — the handover below, which lands
        // ten seconds late without this. handover.ts scopes the morph to its
        // own transition type so these updates animate nothing.
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
      onError: (message) => {
        if (cancelled) {
          return;
        }
        setStreamError(message);
        // loadRest threw: whatever had not landed is not coming. Settle those
        // stages, or the pill would claim forever that a layer is loading and
        // never reach the state where it unmounts.
        setProgress((prev) => {
          const settled = { ...prev.skipped };
          for (const stage of LOAD_STAGES) {
            if ((prev.fractions[stage.id] ?? 0) < 1) {
              settled[stage.id] = true;
            }
          }
          return { ...prev, skipped: settled };
        });
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
        // The frame where the loading screen becomes the pill. Tagged, so
        // that the shared-element morph runs for this update and for no
        // other one (see handover.ts).
        startTransition(() => {
          addTransitionType(HANDOVER_TYPE);
          setStatus({ phase: "running" });
        });
        handoverFallback = setTimeout(() => {
          // Still pending: take it urgently and lose the morph.
          setStatus((prev) =>
            prev.phase === "loading" ? { phase: "running" } : prev
          );
        }, HANDOVER_FALLBACK_MS);
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
      clearTimeout(handoverFallback);
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
  }, [budget, look, primary, extraTiles, insertedModelUrl, webGl2]);

  const updateSun = (nextDay: Date, nextMinutes: number) => {
    setDay(nextDay);
    setMinutes(nextMinutes);
    const state = handleRef.current?.setSun(composeDate(nextDay, nextMinutes));
    if (state) {
      setSun(state);
    }
  };

  const insertBuilding = () => {
    handleRef.current?.insertBuilding().catch(() => {
      // glTF failure is non-fatal; the box fallback can't fail
    });
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
  const everythingLoaded = stages.every((stage) => stage.done);

  return (
    <SidebarProvider
      className="relative h-full overflow-hidden"
      defaultOpen={false}
      style={{ "--sidebar-width": "21.25rem" } as CSSProperties}
    >
      {/* Scene is full-bleed and never resized by the sidebar (which overlays
          it), so toggling the panel can't flash the WebGL canvas. */}
      <div className="absolute inset-0 overflow-hidden bg-[image:var(--hud-scrim)]">
        <div className="absolute inset-0" ref={mountRef} />

        {status.phase === "loading" && (
          <LoadScreen percent={percent} stages={stages} />
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

            {/* The loading screen, at pill size — until the last layer lands. */}
            {!everythingLoaded && <StreamPill stages={stages} />}

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
          insertBuilding={insertBuilding}
          landcoverTiles={landcoverTiles}
          latLng={latLng}
          look={lookValues}
          minutes={minutes}
          mode={mode}
          onLook={look.set}
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
