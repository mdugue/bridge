"use client";

import { format } from "date-fns";
import {
  Building2Icon,
  CalendarIcon,
  CameraIcon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  CloudFogIcon,
  CopyIcon,
  FootprintsIcon,
  FullscreenIcon,
  Gamepad2Icon,
  HammerIcon,
  HousePlusIcon,
  type LucideIcon,
  PlaneIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SunIcon,
  TreesIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import {
  clampPct,
  LOOK_BY_KEY,
  LOOK_CONTROLS,
  type LookGroup,
  type LookKey,
  type LookPct,
  type LookTarget,
} from "@/lib/city/look-controls";
import type { FootprintPoly } from "@/lib/city/minimap";
import {
  parseSnapshot,
  SNAPSHOT_VERSION,
  type Snapshot,
  type SnapshotLook,
} from "@/lib/city/snapshot";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  type CityWalkHandle,
  type CityWalkStats,
  createCityWalkApp,
  type PlayerPose,
  type TileSrc,
} from "./create-app";
import type { MovementMode } from "./fps-movement";
import { DEFAULT_LOOK_PCT } from "./look-defaults";
import { Minimap } from "./minimap";
import { updatePocDebug } from "./poc-debug";
import {
  DEFAULT_DOF,
  DEFAULT_FOCUS_DISTANCE,
  DEFAULT_FOCUS_MODE,
  type FocusMode,
} from "./post-stack";
import type { SceneBudget } from "./scene-profile";
import type { SunState } from "./sun-rig";
import { DEFAULT_TREE_MULTITUFT } from "./vegetation-layer";
import { SCENIC_VIEWS } from "./viewpoints";
import { VirtualJoystick } from "./virtual-joystick";
import { hasWebGl2 } from "./webgl-support";

interface Props {
  /** The render budget the page was opened with (see scene-profile.ts) */
  budget: SceneBudget;
  /** Neighbouring tiles rendered around the primary one for context */
  extraTiles?: TileSrc[];
  /** Optional glTF/GLB to insert; falls back to a marker box */
  insertedModelUrl?: string;
  /** The spawn tile's URLs (see lib/city/tile.ts) */
  primary: TileSrc;
}

type Status =
  | { phase: "loading"; message: string }
  /** the primary tile is on screen and walkable; the rest streams in */
  | { phase: "streaming"; message: string | null }
  | { phase: "ready" }
  | { phase: "error"; message: string };

// Evaluated once in the browser (the component is loaded with ssr: false).
const INITIAL_DATE = new Date();
const INITIAL_MINUTES = 14 * 60;
const MINUTES_STEP = 1;
const LAST_MINUTE = 24 * 60 - MINUTES_STEP;

/** Local-time instant from a calendar day + minutes-of-day slider. */
function composeDate(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
}

function formatMinutes(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** Manual DoF focus ring radius (m) for the minimap, or null when not shown. */
function focusRingMeters(
  dofOn: boolean,
  mode: FocusMode,
  distance: number
): number | null {
  return dofOn && mode === "manual" ? distance : null;
}

/** A labelled 0–100(+) slider that mirrors its value into the scene handle. */
function PctSlider({
  description,
  disabled = false,
  id,
  label,
  max = 100,
  min = 0,
  onChange,
  step = 1,
  unit = "%",
  value,
}: {
  description?: ReactNode;
  disabled?: boolean;
  id: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  unit?: string;
  value: number;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label} · {value}
        {unit}
      </FieldLabel>
      <Slider
        disabled={disabled}
        id={id}
        max={max}
        min={min}
        onValueChange={(v) => onChange(Number(Array.isArray(v) ? v[0] : v))}
        step={step}
        value={[value]}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

/** The percent sliders of one control group, rendered from LOOK_CONTROLS. */
function LookSliders({
  group,
  look,
  onLook,
}: {
  group: LookGroup;
  look: LookPct;
  onLook: (key: LookKey, value: number) => void;
}) {
  return (
    <>
      {LOOK_CONTROLS.filter((def) => def.group === group).map((def) => (
        <PctSlider
          description={def.description}
          id={def.id}
          key={def.key}
          label={def.label}
          max={def.max}
          onChange={(n) => onLook(def.key, n)}
          value={look[def.key]}
        />
      ))}
    </>
  );
}

/** A collapsible, titled section of related controls inside the sidebar. */
function ControlGroup({
  children,
  defaultOpen = true,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Collapsible
      className="border-sidebar-border/50 border-b"
      defaultOpen={defaultOpen}
    >
      <SidebarGroup className="py-1">
        <SidebarGroupLabel
          className="group/trigger gap-2"
          render={<CollapsibleTrigger />}
        >
          <Icon />
          {title}
          <ChevronDownIcon className="ml-auto transition-transform group-aria-expanded/trigger:rotate-180" />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <FieldGroup className="gap-3 pb-2">{children}</FieldGroup>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/** The minimap, sized to fill the sidebar's content width (kept square). */
function SidebarMinimap({
  bounds,
  focusRingM,
  footprints,
  landcoverTiles,
  onTeleport,
  subscribePose,
}: {
  bounds: TerrainBounds;
  focusRingM: number | null;
  footprints: FootprintPoly[];
  landcoverTiles: { bounds: TerrainBounds; src: string }[];
  onTeleport: (epsgX: number, epsgY: number) => void;
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => setSize(Math.round(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="px-2 pt-2" ref={ref}>
      {size > 0 && (
        <Minimap
          bounds={bounds}
          focusRingM={focusRingM}
          footprints={footprints}
          landcoverTiles={landcoverTiles}
          onTeleport={onTeleport}
          size={size}
          subscribePose={subscribePose}
        />
      )}
    </div>
  );
}

/** Floating button that opens the settings sidebar; hidden while it's open. */
function SettingsToggle() {
  const { toggleSidebar, state, isMobile, openMobile } = useSidebar();
  const open = isMobile ? openMobile : state === "expanded";
  if (open) {
    return null;
  }
  return (
    <Button
      aria-label="Scene settings"
      className="absolute top-3 right-3 z-20 shadow-md"
      onClick={toggleSidebar}
      size="icon"
      variant="secondary"
    >
      <SlidersHorizontalIcon />
    </Button>
  );
}

/** DoF focus controls (mode toggle + manual distance slider); null when DoF off. */
function FocusControls({
  enabled,
  mode,
  distance,
  onMode,
  onDistance,
}: {
  distance: number;
  enabled: boolean;
  mode: FocusMode;
  onDistance: (meters: number) => void;
  onMode: (mode: FocusMode) => void;
}) {
  if (!enabled) {
    return null;
  }
  return (
    <>
      <Field>
        <FieldLabel htmlFor="focus-mode">Focus</FieldLabel>
        <ToggleGroup
          className="w-full"
          id="focus-mode"
          onValueChange={(value: string[]) => {
            const next = value[0] as FocusMode | undefined;
            if (next) {
              onMode(next);
            }
          }}
          size="sm"
          value={[mode]}
          variant="outline"
        >
          <ToggleGroupItem className="flex-1" value="auto">
            Auto
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="manual">
            Manual
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>
          {mode === "auto"
            ? "Focuses on whatever the crosshair is over"
            : "Fixed focus distance — shown as a ring on the minimap"}
        </FieldDescription>
      </Field>
      {mode === "manual" && (
        <PctSlider
          id="focus-distance"
          label="Focus distance"
          max={3000}
          min={1}
          onChange={onDistance}
          step={5}
          unit=" m"
          value={distance}
        />
      )}
    </>
  );
}

/**
 * Quick-jump buttons that glide the camera to curated Dresden vantages. The
 * mode icon previews where you land: a plane for the aerial flights, footprints
 * for the ones that set you down on the ground.
 */
function ScenicViews({
  handleRef,
}: {
  handleRef: RefObject<CityWalkHandle | null>;
}) {
  return (
    <Field>
      <FieldLabel>Scenic views</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        {SCENIC_VIEWS.map((view) => (
          <Button
            className="justify-start"
            key={view.id}
            onClick={() => handleRef.current?.flyToViewpoint(view)}
            size="sm"
            title={view.description}
            type="button"
            variant="secondary"
          >
            {view.mode === "fly" ? (
              <PlaneIcon data-icon="inline-start" />
            ) : (
              <FootprintsIcon data-icon="inline-start" />
            )}
            <span className="truncate">{view.label}</span>
          </Button>
        ))}
      </div>
      <FieldDescription>
        Glide the camera to a curated vantage — the icon shows whether you
        arrive flying or on foot.
      </FieldDescription>
    </Field>
  );
}

interface SceneControlsProps {
  applySnapshot: () => void;
  coarse: boolean;
  copySnapshot: () => void;
  day: Date;
  dof: boolean;
  focusDistance: number;
  focusMode: FocusMode;
  handleRef: RefObject<CityWalkHandle | null>;
  insertBuilding: () => void;
  look: LookPct;
  minutes: number;
  mode: MovementMode;
  multiTuft: boolean;
  onLook: (key: LookKey, value: number) => void;
  setDof: Dispatch<SetStateAction<boolean>>;
  setFocusDistance: Dispatch<SetStateAction<number>>;
  setFocusMode: Dispatch<SetStateAction<FocusMode>>;
  setMultiTuft: Dispatch<SetStateAction<boolean>>;
  setSnapshotText: Dispatch<SetStateAction<string>>;
  snapshotMsg: string | null;
  snapshotText: string;
  sun: SunState | null;
  updateSun: (day: Date, minutes: number) => void;
}

/**
 * The full control surface, grouped into collapsible sections. Shared verbatim
 * between the desktop sidebar and the mobile bottom drawer — kept top-level so
 * its many branches don't push the host component past the complexity cap.
 * The percent sliders come from LOOK_CONTROLS (lib/city/look-controls.ts).
 */
function SceneControls({
  applySnapshot,
  coarse,
  copySnapshot,
  day,
  dof,
  focusDistance,
  focusMode,
  handleRef,
  insertBuilding,
  look,
  minutes,
  mode,
  multiTuft,
  onLook,
  setDof,
  setFocusDistance,
  setFocusMode,
  setMultiTuft,
  setSnapshotText,
  snapshotMsg,
  snapshotText,
  sun,
  updateSun,
}: SceneControlsProps) {
  return (
    <>
      <ControlGroup icon={SunIcon} title="Sun & time">
        <Field>
          <FieldLabel htmlFor="sun-date">Date</FieldLabel>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  className="w-full justify-start font-normal"
                  id="sun-date"
                  size="sm"
                  variant="outline"
                />
              }
            >
              <CalendarIcon data-icon="inline-start" />
              {format(day, "PPP")}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                onSelect={(d) => d && updateSun(d, minutes)}
                selected={day}
              />
            </PopoverContent>
          </Popover>
        </Field>

        <Field>
          <FieldLabel htmlFor="sun-time">
            Time of day · {formatMinutes(minutes)}
          </FieldLabel>
          <Slider
            id="sun-time"
            max={LAST_MINUTE}
            min={0}
            onValueChange={(value) =>
              updateSun(day, Number(Array.isArray(value) ? value[0] : value))
            }
            step={MINUTES_STEP}
            value={[minutes]}
          />
          <FieldDescription>
            {sun
              ? `Sun altitude ${sun.altitudeDeg.toFixed(1)}°${
                  sun.aboveHorizon ? "" : " — below horizon (night)"
                }`
              : "Sun position unknown"}
          </FieldDescription>
        </Field>
      </ControlGroup>

      <ControlGroup icon={CloudFogIcon} title="Atmosphere">
        <LookSliders group="atmosphere" look={look} onLook={onLook} />
      </ControlGroup>

      <ControlGroup icon={Building2Icon} title="Buildings">
        <LookSliders group="buildings" look={look} onLook={onLook} />
      </ControlGroup>

      <ControlGroup icon={TreesIcon} title="Vegetation">
        <LookSliders group="vegetation" look={look} onLook={onLook} />
        <Field orientation="horizontal">
          <FieldLabel htmlFor="tree-multituft">
            Multi-Tuft-Kronen (nah)
          </FieldLabel>
          <Switch
            checked={multiTuft}
            id="tree-multituft"
            onCheckedChange={(checked) => {
              setMultiTuft(checked);
              handleRef.current?.setTreeMultiTuft(checked);
            }}
            size="sm"
          />
        </Field>
      </ControlGroup>

      <ControlGroup icon={SparklesIcon} title="Rendering">
        <LookSliders group="rendering" look={look} onLook={onLook} />
        <Field orientation="horizontal">
          <FieldLabel htmlFor="depth-of-field">Depth of field</FieldLabel>
          <Switch
            checked={dof}
            id="depth-of-field"
            onCheckedChange={(checked) => {
              setDof(checked);
              handleRef.current?.setDepthOfField(checked);
            }}
            size="sm"
          />
        </Field>
        <FocusControls
          distance={focusDistance}
          enabled={dof}
          mode={focusMode}
          onDistance={(m) => {
            setFocusDistance(m);
            handleRef.current?.setFocusDistance(m);
          }}
          onMode={(m) => {
            setFocusMode(m);
            handleRef.current?.setFocusMode(m);
          }}
        />
      </ControlGroup>

      <ControlGroup icon={Gamepad2Icon} title="Scene">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="fly-mode">
            {coarse ? "Fly mode" : "Fly mode (F)"}
          </FieldLabel>
          <Switch
            checked={mode === "fly"}
            id="fly-mode"
            onCheckedChange={(checked) =>
              handleRef.current?.setMovementMode(checked ? "fly" : "walk")
            }
            size="sm"
          />
        </Field>

        <Button onClick={insertBuilding} size="sm" variant="secondary">
          <HousePlusIcon data-icon="inline-start" />
          {coarse ? "Insert building" : "Insert building (B)"}
        </Button>

        {!coarse && (
          <Button
            onClick={() => handleRef.current?.enterImmersive()}
            size="sm"
            variant="outline"
          >
            <FullscreenIcon data-icon="inline-start" />
            Immersive mode · Esc exits
          </Button>
        )}
      </ControlGroup>

      <ControlGroup icon={CameraIcon} title="Snapshot">
        <ScenicViews handleRef={handleRef} />
        <Field>
          <FieldLabel htmlFor="snapshot">Snapshot JSON</FieldLabel>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={copySnapshot}
              size="sm"
              type="button"
              variant="secondary"
            >
              <CopyIcon data-icon="inline-start" />
              Copy
            </Button>
            <Button
              className="flex-1"
              onClick={applySnapshot}
              size="sm"
              type="button"
              variant="outline"
            >
              <ClipboardPasteIcon data-icon="inline-start" />
              Apply
            </Button>
          </div>
          <Textarea
            className="font-mono text-[10px] leading-snug"
            id="snapshot"
            onChange={(e) => setSnapshotText(e.target.value)}
            placeholder="Copy captures position, time & look as JSON. Paste one here and Apply to restore it."
            rows={4}
            spellCheck={false}
            value={snapshotText}
          />
          <FieldDescription>
            {snapshotMsg ??
              "Reproducible capture — share or replay an exact view."}
          </FieldDescription>
        </Field>
      </ControlGroup>
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
      ? { phase: "loading", message: "Starting renderer…" }
      : {
          phase: "error",
          message:
            "This viewer needs WebGL2, which this browser or device does not provide. " +
            "Try a current desktop or mobile browser with hardware acceleration enabled.",
        }
  );
  const [stats, setStats] = useState<CityWalkStats | null>(null);
  const [sun, setSun] = useState<SunState | null>(null);
  const [day, setDay] = useState(INITIAL_DATE);
  const [minutes, setMinutes] = useState(INITIAL_MINUTES);
  const [dof, setDof] = useState(DEFAULT_DOF);
  const [focusMode, setFocusMode] = useState<FocusMode>(DEFAULT_FOCUS_MODE);
  const [focusDistance, setFocusDistance] = useState(DEFAULT_FOCUS_DISTANCE);
  const [look, setLook] = useState<LookPct>(DEFAULT_LOOK_PCT);
  const [multiTuft, setMultiTuft] = useState(DEFAULT_TREE_MULTITUFT);
  const [mode, setMode] = useState<MovementMode>("walk");
  const [footprints, setFootprints] = useState<FootprintPoly[]>([]);
  const [bounds, setBounds] = useState<TerrainBounds | null>(null);
  const [landcoverTiles, setLandcoverTiles] = useState<
    { bounds: TerrainBounds; src: string }[]
  >([]);
  const [fps, setFps] = useState<number | null>(null);
  const [snapshotText, setSnapshotText] = useState("");
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);

  // The boot effect seeds a fresh handle from the HUD's current look state.
  // It reads that state through a ref (synced here — refs must not be written
  // during render) so a slider change never re-runs the effect and reboots
  // the renderer. With the single-mount lifecycle the seed equals the
  // defaults; its value is the future tile-switch / model-URL case.
  const hudLookRef = useRef({ look, dof, focusMode, focusDistance, multiTuft });
  useEffect(() => {
    hudLookRef.current = { look, dof, focusMode, focusDistance, multiTuft };
  }, [look, dof, focusMode, focusDistance, multiTuft]);

  /** Slider change: clamp, store the percent, push 0..1 to the scene. */
  const setLookValue = (key: LookKey, value: number) => {
    const def = LOOK_BY_KEY[key];
    const v = clampPct(def, value);
    setLook((prev) => (prev[key] === v ? prev : { ...prev, [key]: v }));
    handleRef.current?.[def.setter](v / 100);
  };

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
    // True once the first frame is up: later progress messages belong to the
    // streaming chip, not the blocking overlay.
    let booted = false;
    const aborter = new AbortController();

    createCityWalkApp({
      container,
      budget,
      primary,
      extraTiles,
      insertedModelUrl,
      initialDate: composeDate(INITIAL_DATE, INITIAL_MINUTES),
      signal: aborter.signal,
      onProgress: (message) => {
        if (!cancelled) {
          setStatus(
            booted
              ? { phase: "streaming", message }
              : { phase: "loading", message }
          );
        }
      },
      onLoaded: () => {
        if (!cancelled) {
          updatePocDebug({ ready: true });
          setStatus({ phase: "ready" });
        }
      },
      onError: (message) => {
        if (!cancelled) {
          setStatus({
            phase: "streaming",
            message: `Failed to load: ${message}`,
          });
        }
      },
      onStats: (s) => {
        if (cancelled) {
          return;
        }
        setStats(s);
        updatePocDebug(s);
        const h = handleRef.current;
        if (h) {
          setFootprints(h.getFootprints());
        }
      },
      onFps: (value) => {
        if (!cancelled) {
          setFps(value);
        }
      },
      onModeChange: (m) => {
        if (!cancelled) {
          setMode(m);
        }
      },
      onPose: (pose) => {
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
        booted = true;
        // A remounted handle boots at the scene defaults; push the HUD's
        // current state so sliders and scene never disagree.
        const hud = hudLookRef.current;
        for (const def of LOOK_CONTROLS) {
          h[def.setter](hud.look[def.key] / 100);
        }
        h.setDepthOfField(hud.dof);
        h.setFocusMode(hud.focusMode);
        h.setFocusDistance(hud.focusDistance);
        h.setTreeMultiTuft(hud.multiTuft);
        setSun(h.setSun(composeDate(INITIAL_DATE, INITIAL_MINUTES)));
        setFootprints(h.getFootprints());
        setBounds(h.terrainBounds);
        setLandcoverTiles(h.landcoverTiles);
        const lookSetters: Partial<LookTarget> = {};
        for (const def of LOOK_CONTROLS) {
          lookSetters[def.setter] = h[def.setter];
        }
        updatePocDebug({
          ...lookSetters,
          firstFrame: true,
          offset: h.offset,
          terrainBounds: h.terrainBounds,
          flyTo: h.flyTo,
          flyToViewpoint: h.flyToViewpoint,
          demolishAtCrosshair: h.demolishAtCrosshair,
          getPose: h.getPose,
          getCameraState: h.getCameraState,
          getRenderInfo: h.getRenderInfo,
          getFocusDebug: h.getFocusDebug,
          applyCameraState: h.applyCameraState,
          teleportTo: h.teleportTo,
          setDepthOfField: h.setDepthOfField,
          setFocusMode: h.setFocusMode,
          setFocusDistance: h.setFocusDistance,
          setTreeMultiTuft: h.setTreeMultiTuft,
          insertBuilding: () => {
            h.insertBuilding().catch(() => {
              // glTF failure is non-fatal; the box fallback can't fail
            });
          },
          setSunIso: (iso) => {
            h.setSun(new Date(iso));
          },
        });
        setStatus({ phase: "streaming", message: null });
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
      handleRef.current = null;
      handle?.dispose();
    };
  }, [budget, primary, extraTiles, insertedModelUrl, webGl2]);

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
    const lookJson: SnapshotLook = {
      dof,
      focusMode,
      focusDistanceM: focusDistance,
      multiTuft,
    };
    for (const def of LOOK_CONTROLS) {
      lookJson[def.snapshotKey] = look[def.key];
    }
    const snap: Snapshot = {
      v: SNAPSHOT_VERSION,
      camera: h.getCameraState(),
      date: composeDate(day, minutes).toISOString(),
      look: lookJson,
    };
    const text = JSON.stringify(snap, null, 2);
    setSnapshotText(text);
    navigator.clipboard?.writeText(text).then(
      () => setSnapshotMsg("Copied to clipboard"),
      () => setSnapshotMsg("Copy failed — select the text manually")
    );
  };

  /** Percent controls of a snapshot: clamp, store and push each present key. */
  const applyLookPct = (h: CityWalkHandle, lookJson: SnapshotLook) => {
    const next = { ...look };
    for (const def of LOOK_CONTROLS) {
      const raw = lookJson[def.snapshotKey];
      if (typeof raw === "number") {
        next[def.key] = clampPct(def, raw);
        h[def.setter](next[def.key] / 100);
      }
    }
    setLook(next);
  };

  /** The non-percent look fields (each optional: older snapshots omit them). */
  const applyLookFlags = (h: CityWalkHandle, lookJson: SnapshotLook) => {
    if (lookJson.dof !== undefined) {
      setDof(lookJson.dof);
      h.setDepthOfField(lookJson.dof);
    }
    if (lookJson.focusMode !== undefined) {
      setFocusMode(lookJson.focusMode);
      h.setFocusMode(lookJson.focusMode);
    }
    if (lookJson.focusDistanceM !== undefined) {
      setFocusDistance(lookJson.focusDistanceM);
      h.setFocusDistance(lookJson.focusDistanceM);
    }
    if (lookJson.multiTuft !== undefined) {
      setMultiTuft(lookJson.multiTuft);
      h.setTreeMultiTuft(lookJson.multiTuft);
    }
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
    const date = new Date(snap.date);
    const nextDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    setDay(nextDay);
    setMinutes(date.getHours() * 60 + date.getMinutes());
    setSun(h.setSun(date));
    if (snap.look) {
      applyLookPct(h, snap.look);
      applyLookFlags(h, snap.look);
    }
    setSnapshotMsg("Snapshot applied");
  };

  // Shared between the desktop sidebar and the mobile bottom drawer.
  const controlsFields = (
    <SceneControls
      applySnapshot={applySnapshot}
      coarse={coarse}
      copySnapshot={copySnapshot}
      day={day}
      dof={dof}
      focusDistance={focusDistance}
      focusMode={focusMode}
      handleRef={handleRef}
      insertBuilding={insertBuilding}
      look={look}
      minutes={minutes}
      mode={mode}
      multiTuft={multiTuft}
      onLook={setLookValue}
      setDof={setDof}
      setFocusDistance={setFocusDistance}
      setFocusMode={setFocusMode}
      setMultiTuft={setMultiTuft}
      setSnapshotText={setSnapshotText}
      snapshotMsg={snapshotMsg}
      snapshotText={snapshotText}
      sun={sun}
      updateSun={updateSun}
    />
  );

  const booted = status.phase === "streaming" || status.phase === "ready";

  return (
    <SidebarProvider
      className="relative h-full overflow-hidden"
      style={{ "--sidebar-width": "20rem" } as CSSProperties}
    >
      {/* Scene is full-bleed and never resized by the sidebar (which overlays
          it), so toggling the panel can't flash the WebGL canvas. */}
      <div className="absolute inset-0 overflow-hidden bg-slate-900">
        <div className="absolute inset-0" ref={mountRef} />

        {status.phase === "loading" && (
          <output
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center gap-3 bg-slate-900/70 text-lg text-white"
          >
            <Spinner />
            {status.message}
          </output>
        )}

        {status.phase === "error" && (
          <Alert className="absolute inset-x-8 top-8" variant="destructive">
            <AlertTitle>Failed to start the city viewer</AlertTitle>
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

            {/* FPS readout — always visible */}
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/55 px-2 py-0.5 font-mono text-[11px] text-white tabular-nums">
              {fps === null ? "–" : Math.round(fps)} FPS
            </div>

            {/* Streaming chip: the scene is usable while the rest loads. */}
            {status.phase === "streaming" && status.message && (
              <output
                aria-live="polite"
                className="pointer-events-none absolute top-9 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/55 px-2.5 py-0.5 text-[11px] text-white"
              >
                <Spinner className="size-3" />
                {status.message}
              </output>
            )}

            <SettingsToggle />

            <div className="absolute bottom-8 left-5">
              <VirtualJoystick
                onChange={(x, y) => handleRef.current?.setMoveInput(x, y)}
              />
            </div>

            {coarse && (
              <div className="absolute right-3 bottom-8 flex flex-col gap-2">
                <Button
                  onClick={() => handleRef.current?.demolishAtCrosshair()}
                  size="sm"
                  variant="secondary"
                >
                  <HammerIcon data-icon="inline-start" />
                  Demolish
                </Button>
                <Button onClick={insertBuilding} size="sm" variant="secondary">
                  <HousePlusIcon data-icon="inline-start" />
                  Insert
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {booted && (
        <Sidebar collapsible="offcanvas" side="right">
          <SidebarHeader>
            <div className="flex items-center justify-between pl-1">
              <span className="font-medium text-sm">Scene settings</span>
              <SidebarTrigger />
            </div>
          </SidebarHeader>
          <SidebarContent>
            {bounds && (
              <SidebarMinimap
                bounds={bounds}
                focusRingM={focusRingMeters(dof, focusMode, focusDistance)}
                footprints={footprints}
                landcoverTiles={landcoverTiles}
                onTeleport={(x, y) => handleRef.current?.teleportTo(x, y)}
                subscribePose={subscribePose}
              />
            )}
            {controlsFields}
          </SidebarContent>
          <SidebarSeparator />
          <SidebarFooter className="gap-1.5 text-muted-foreground text-xs leading-snug">
            <p>
              {coarse ? (
                "Drag to look around · joystick to walk · double-tap the ground to travel · pinch to zoom"
              ) : (
                <>
                  Drag to look around · <Kbd>WASD</Kbd> move · double-click
                  ground to travel · scroll to zoom · <Kbd>Shift</Kbd> sprint ·{" "}
                  <Kbd>F</Kbd> walk/fly · <Kbd>Space</Kbd>/<Kbd>Shift</Kbd>{" "}
                  up/down · <Kbd>R</Kbd> demolish · <Kbd>B</Kbd> insert ·{" "}
                  <Kbd>Esc</Kbd> exits immersive
                </>
              )}
            </p>
            {stats && (
              <p>
                {stats.buildingCount} buildings ·{" "}
                {stats.terrainVertexCount.toLocaleString()} terrain vertices · ≈{" "}
                {stats.gpuMegabytes} MB GPU ·{" "}
                {mode === "walk" ? "walking" : "flying"}
              </p>
            )}
            <p className="text-[10px]">
              Street lamps, retaining walls, station platforms and bridge
              structure © OpenStreetMap contributors (ODbL).
            </p>
          </SidebarFooter>
        </Sidebar>
      )}
    </SidebarProvider>
  );
}
