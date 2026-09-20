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
import type { FootprintPoly } from "@/lib/city/minimap";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  type CameraState,
  type CityWalkHandle,
  type CityWalkStats,
  createCityWalkApp,
  DEFAULT_ATMOSPHERE,
  type PlayerPose,
  type TileSrc,
} from "./create-app";
import type { MovementMode } from "./fps-movement";
import { DEFAULT_HEIGHT_FOG } from "./height-fog";
import { Minimap } from "./minimap";
import { updatePocDebug } from "./poc-debug";
import {
  DEFAULT_CONTACT_SHADOWS,
  DEFAULT_DEPTH_GRADING,
  DEFAULT_DOF,
  DEFAULT_FOCUS_DISTANCE,
  DEFAULT_FOCUS_MODE,
  DEFAULT_PAPER_GRAIN,
  type FocusMode,
} from "./post-stack";
import type { SunState } from "./sun-rig";
import { DEFAULT_MEADOW_NDVI } from "./terrain-layer";
import {
  DEFAULT_TREE_LEAF_BRIGHT,
  DEFAULT_TREE_LEAF_FLUTTER,
  DEFAULT_TREE_MULTITUFT,
  DEFAULT_TREE_SHIMMER,
  DEFAULT_TREE_TRANSLUCENCY,
} from "./vegetation-layer";
import { SCENIC_VIEWS } from "./viewpoints";
import { VirtualJoystick } from "./virtual-joystick";
import {
  DEFAULT_BUILDING_BANDS,
  DEFAULT_BUILDING_DUSK_GLOW,
  DEFAULT_BUILDING_EAVE,
  DEFAULT_BUILDING_GROUND_SHADE,
  DEFAULT_BUILDING_RIM,
  DEFAULT_BUILDING_ROOF_TINT,
  DEFAULT_BUILDING_ROOF_VIBRANCE,
  DEFAULT_BUILDING_ROUGHNESS,
  DEFAULT_BUILDING_TINT,
  DEFAULT_CLAY_TRANSPARENCY,
} from "./visual-style";
import { DEFAULT_WATER_MIST } from "./water-layer";

interface Props {
  /** Neighbouring tiles rendered around the primary one for context */
  extraTiles?: TileSrc[];
  /** Optional glTF/GLB to insert; falls back to a marker box */
  insertedModelUrl?: string;
  /** The spawn tile's URLs (see lib/city/tile.ts) */
  primary: TileSrc;
}

type Status =
  | { phase: "loading"; message: string }
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

const SNAPSHOT_VERSION = 1;

/**
 * A fully reproducible capture of the view: camera pose + sun instant + every
 * look slider. Round-trips through JSON so a shot can be copied, pasted back,
 * or dropped into a prompt / QA harness to recreate the exact frame.
 */
interface Snapshot {
  camera: CameraState;
  /** ISO instant driving the sun position */
  date: string;
  look: {
    bandsPct?: number;
    contactPct: number;
    dof: boolean;
    duskGlowPct?: number;
    eavePct?: number;
    focusDistanceM?: number;
    focusMode?: FocusMode;
    fogPct: number;
    gradingPct: number;
    grainPct: number;
    groundShadePct?: number;
    heightFogPct?: number;
    leafBrightPct?: number;
    leafFlutterPct?: number;
    meadowNdviPct?: number;
    multiTuft?: boolean;
    rimPct?: number;
    roofTintPct?: number;
    roofVibrancePct?: number;
    roughnessPct?: number;
    shimmerPct?: number;
    tintPct?: number;
    translucencyPct?: number;
    transparencyPct: number;
    waterMistPct?: number;
  };
  v: number;
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
  bands: number;
  coarse: boolean;
  contact: number;
  copySnapshot: () => void;
  day: Date;
  dof: boolean;
  duskGlow: number;
  eave: number;
  focusDistance: number;
  focusMode: FocusMode;
  fogAmount: number;
  grading: number;
  grain: number;
  groundShade: number;
  handleRef: RefObject<CityWalkHandle | null>;
  heightFog: number;
  insertBuilding: () => void;
  leafBright: number;
  leafFlutter: number;
  meadowNdvi: number;
  minutes: number;
  mode: MovementMode;
  multiTuft: boolean;
  rim: number;
  roofTint: number;
  roofVibrance: number;
  roughness: number;
  setBands: Dispatch<SetStateAction<number>>;
  setContact: Dispatch<SetStateAction<number>>;
  setDof: Dispatch<SetStateAction<boolean>>;
  setDuskGlow: Dispatch<SetStateAction<number>>;
  setEave: Dispatch<SetStateAction<number>>;
  setFocusDistance: Dispatch<SetStateAction<number>>;
  setFocusMode: Dispatch<SetStateAction<FocusMode>>;
  setFogAmount: Dispatch<SetStateAction<number>>;
  setGrading: Dispatch<SetStateAction<number>>;
  setGrain: Dispatch<SetStateAction<number>>;
  setGroundShade: Dispatch<SetStateAction<number>>;
  setHeightFog: Dispatch<SetStateAction<number>>;
  setLeafBright: Dispatch<SetStateAction<number>>;
  setLeafFlutter: Dispatch<SetStateAction<number>>;
  setMeadowNdvi: Dispatch<SetStateAction<number>>;
  setMultiTuft: Dispatch<SetStateAction<boolean>>;
  setRim: Dispatch<SetStateAction<number>>;
  setRoofTint: Dispatch<SetStateAction<number>>;
  setRoofVibrance: Dispatch<SetStateAction<number>>;
  setRoughness: Dispatch<SetStateAction<number>>;
  setShimmer: Dispatch<SetStateAction<number>>;
  setSnapshotText: Dispatch<SetStateAction<string>>;
  setTint: Dispatch<SetStateAction<number>>;
  setTranslucency: Dispatch<SetStateAction<number>>;
  setTransparency: Dispatch<SetStateAction<number>>;
  setWaterMist: Dispatch<SetStateAction<number>>;
  shimmer: number;
  snapshotMsg: string | null;
  snapshotText: string;
  sun: SunState | null;
  tint: number;
  translucency: number;
  transparency: number;
  updateSun: (day: Date, minutes: number) => void;
  waterMist: number;
}

/**
 * The full control surface, grouped into collapsible sections. Shared verbatim
 * between the desktop sidebar and the mobile bottom drawer — kept top-level so
 * its many branches don't push the host component past the complexity cap.
 */
function SceneControls({
  applySnapshot,
  bands,
  coarse,
  contact,
  copySnapshot,
  day,
  dof,
  duskGlow,
  eave,
  focusDistance,
  focusMode,
  fogAmount,
  grading,
  grain,
  groundShade,
  handleRef,
  heightFog,
  insertBuilding,
  leafBright,
  leafFlutter,
  meadowNdvi,
  minutes,
  mode,
  multiTuft,
  rim,
  roofTint,
  roofVibrance,
  roughness,
  setBands,
  setContact,
  setDof,
  setDuskGlow,
  setEave,
  setFocusDistance,
  setFocusMode,
  setFogAmount,
  setGrading,
  setGrain,
  setGroundShade,
  setHeightFog,
  setLeafBright,
  setLeafFlutter,
  setMeadowNdvi,
  setMultiTuft,
  setRim,
  setRoofTint,
  setRoofVibrance,
  setRoughness,
  setShimmer,
  setSnapshotText,
  setTint,
  setTransparency,
  setTranslucency,
  setWaterMist,
  shimmer,
  snapshotMsg,
  snapshotText,
  sun,
  tint,
  translucency,
  transparency,
  updateSun,
  waterMist,
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
        <PctSlider
          id="atmosphere"
          label="Fog"
          onChange={(n) => {
            setFogAmount(n);
            handleRef.current?.setAtmosphere(n / 100);
          }}
          value={fogAmount}
        />
        <PctSlider
          description="Haze pooling along the valley floor / the Elbe"
          id="height-fog"
          label="Talnebel"
          onChange={(n) => {
            setHeightFog(n);
            handleRef.current?.setHeightFog(n / 100);
          }}
          value={heightFog}
        />
        <PctSlider
          description="Drifting mist over the river"
          id="water-mist"
          label="Flussnebel"
          onChange={(n) => {
            setWaterMist(n);
            handleRef.current?.setWaterMist(n / 100);
          }}
          value={waterMist}
        />
        <PctSlider
          id="depth-grading"
          label="Depth color · warm near, cool far"
          onChange={(n) => {
            setGrading(n);
            handleRef.current?.setDepthGrading(n / 100);
          }}
          value={grading}
        />
      </ControlGroup>

      <ControlGroup icon={Building2Icon} title="Buildings">
        <PctSlider
          description="Plain see-through"
          id="building-transparency"
          label="Transparency"
          max={90}
          onChange={(n) => {
            setTransparency(n);
            handleRef.current?.setBuildingTransparency(n / 100);
          }}
          value={transparency}
        />

        <PctSlider
          id="building-ground-shade"
          label="Boden-Verlauf"
          onChange={(n) => {
            setGroundShade(n);
            handleRef.current?.setBuildingGroundShade(n / 100);
          }}
          value={groundShade}
        />
        <PctSlider
          id="building-bands"
          label="Höhenlinien"
          onChange={(n) => {
            setBands(n);
            handleRef.current?.setBuildingBands(n / 100);
          }}
          value={bands}
        />
        <PctSlider
          id="building-rim"
          label="Streiflicht"
          onChange={(n) => {
            setRim(n);
            handleRef.current?.setBuildingRim(n / 100);
          }}
          value={rim}
        />
        <PctSlider
          description="Per-building clay tint from use & height, blended into the base"
          id="building-tint"
          label="Farbvariation"
          onChange={(n) => {
            setTint(n);
            handleRef.current?.setBuildingTint(n / 100);
          }}
          value={tint}
        />
        <PctSlider
          description="Terracotta or slate per roof, from roofType & pitch"
          id="building-roof-tint"
          label="Dachfarbe"
          onChange={(n) => {
            setRoofTint(n);
            handleRef.current?.setBuildingRoofTint(n / 100);
          }}
          value={roofTint}
        />
        <PctSlider
          description="Lift roof colour vividness, keeping each roof's true hue — copper-green, terracotta & slate alike (0 = raw aerial)"
          id="building-roof-vibrance"
          label="Dachsättigung"
          onChange={(n) => {
            setRoofVibrance(n);
            handleRef.current?.setBuildingRoofVibrance(n / 100);
          }}
          value={roofVibrance}
        />
        <PctSlider
          description="Soft cornice line where wall meets roof"
          id="building-eave"
          label="Traufkante"
          onChange={(n) => {
            setEave(n);
            handleRef.current?.setBuildingEave(n / 100);
          }}
          value={eave}
        />
        <PctSlider
          description="Warm interior glow on civic/commercial buildings at dusk"
          id="building-dusk-glow"
          label="Abendlicht"
          onChange={(n) => {
            setDuskGlow(n);
            handleRef.current?.setBuildingDuskGlow(n / 100);
          }}
          value={duskGlow}
        />
        <PctSlider
          description="Subtle per-building matte/sheen variation"
          id="building-roughness"
          label="Materialstreuung"
          onChange={(n) => {
            setRoughness(n);
            handleRef.current?.setBuildingRoughness(n / 100);
          }}
          value={roughness}
        />
      </ControlGroup>

      <ControlGroup icon={TreesIcon} title="Vegetation">
        <PctSlider
          description="Tint meadows lush-green↔dry from the DOP infrared (NDVI)"
          id="meadow-ndvi"
          label="Wiesenfärbung"
          onChange={(n) => {
            setMeadowNdvi(n);
            handleRef.current?.setMeadowNdvi(n / 100);
          }}
          value={meadowNdvi}
        />
        <PctSlider
          id="tree-shimmer"
          label="Gegenlicht-Schimmer"
          onChange={(n) => {
            setShimmer(n);
            handleRef.current?.setTreeShimmer(n / 100);
          }}
          value={shimmer}
        />
        <PctSlider
          description="Backlit glow on near/large crowns (shadow-gated)"
          id="tree-translucency"
          label="Blattdurchscheinen"
          onChange={(n) => {
            setTranslucency(n);
            handleRef.current?.setTreeTranslucency(n / 100);
          }}
          value={translucency}
        />
        <PctSlider
          description="(A) Windböen lassen Blätter ihre helle Unterseite zeigen — Farbe flimmert über sonnige Kronen. 0 = nur (B) sichtbar."
          id="tree-leaf-flutter"
          label="Blattflimmern"
          onChange={(n) => {
            setLeafFlutter(n);
            handleRef.current?.setTreeLeafFlutter(n / 100);
          }}
          value={leafFlutter}
        />
        <PctSlider
          description="(B) Krone hellt auf, wenn sie sich in die Böe neigt (an die Wiege-Bewegung gekoppelt). 0 = nur (A) sichtbar."
          id="tree-leaf-bright"
          label="Windhelligkeit"
          onChange={(n) => {
            setLeafBright(n);
            handleRef.current?.setTreeLeafBright(n / 100);
          }}
          value={leafBright}
        />
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
        <PctSlider
          id="contact-shadows"
          label="Contact shadows"
          onChange={(n) => {
            setContact(n);
            handleRef.current?.setContactShadows(n / 100);
          }}
          value={contact}
        />
        <PctSlider
          id="paper-grain"
          label="Paper grain"
          onChange={(n) => {
            setGrain(n);
            handleRef.current?.setPaperGrain(n / 100);
          }}
          value={grain}
        />
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
  primary,
  extraTiles,
  insertedModelUrl,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CityWalkHandle | null>(null);
  const poseListeners = useRef<Set<(pose: PlayerPose) => void>>(new Set());
  const coarse = useCoarsePointer();

  const [status, setStatus] = useState<Status>({
    phase: "loading",
    message: "Starting renderer…",
  });
  const [stats, setStats] = useState<CityWalkStats | null>(null);
  const [sun, setSun] = useState<SunState | null>(null);
  const [day, setDay] = useState(INITIAL_DATE);
  const [minutes, setMinutes] = useState(INITIAL_MINUTES);
  const [dof, setDof] = useState(DEFAULT_DOF);
  const [focusMode, setFocusMode] = useState<FocusMode>(DEFAULT_FOCUS_MODE);
  const [focusDistance, setFocusDistance] = useState(DEFAULT_FOCUS_DISTANCE);
  const [fogAmount, setFogAmount] = useState(
    Math.round(DEFAULT_ATMOSPHERE * 100)
  );
  const [grading, setGrading] = useState(
    Math.round(DEFAULT_DEPTH_GRADING * 100)
  );
  const [transparency, setTransparency] = useState(
    Math.round(DEFAULT_CLAY_TRANSPARENCY * 100)
  );
  const [contact, setContact] = useState(
    Math.round(DEFAULT_CONTACT_SHADOWS * 100)
  );
  const [grain, setGrain] = useState(Math.round(DEFAULT_PAPER_GRAIN * 100));
  const [heightFog, setHeightFog] = useState(
    Math.round(DEFAULT_HEIGHT_FOG * 100)
  );
  const [meadowNdvi, setMeadowNdvi] = useState(
    Math.round(DEFAULT_MEADOW_NDVI * 100)
  );
  const [waterMist, setWaterMist] = useState(
    Math.round(DEFAULT_WATER_MIST * 100)
  );
  const [groundShade, setGroundShade] = useState(
    Math.round(DEFAULT_BUILDING_GROUND_SHADE * 100)
  );
  const [bands, setBands] = useState(Math.round(DEFAULT_BUILDING_BANDS * 100));
  const [rim, setRim] = useState(Math.round(DEFAULT_BUILDING_RIM * 100));
  const [tint, setTint] = useState(Math.round(DEFAULT_BUILDING_TINT * 100));
  const [roofTint, setRoofTint] = useState(
    Math.round(DEFAULT_BUILDING_ROOF_TINT * 100)
  );
  const [roofVibrance, setRoofVibrance] = useState(
    Math.round(DEFAULT_BUILDING_ROOF_VIBRANCE * 100)
  );
  const [eave, setEave] = useState(Math.round(DEFAULT_BUILDING_EAVE * 100));
  const [duskGlow, setDuskGlow] = useState(
    Math.round(DEFAULT_BUILDING_DUSK_GLOW * 100)
  );
  const [roughness, setRoughness] = useState(
    Math.round(DEFAULT_BUILDING_ROUGHNESS * 100)
  );
  const [shimmer, setShimmer] = useState(
    Math.round(DEFAULT_TREE_SHIMMER * 100)
  );
  const [translucency, setTranslucency] = useState(
    Math.round(DEFAULT_TREE_TRANSLUCENCY * 100)
  );
  const [leafFlutter, setLeafFlutter] = useState(
    Math.round(DEFAULT_TREE_LEAF_FLUTTER * 100)
  );
  const [leafBright, setLeafBright] = useState(
    Math.round(DEFAULT_TREE_LEAF_BRIGHT * 100)
  );
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
    let cancelled = false;
    let handle: CityWalkHandle | null = null;
    const aborter = new AbortController();

    createCityWalkApp({
      container,
      primary,
      extraTiles,
      insertedModelUrl,
      initialDate: composeDate(INITIAL_DATE, INITIAL_MINUTES),
      signal: aborter.signal,
      onProgress: (message) => {
        if (!cancelled) {
          setStatus({ phase: "loading", message });
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
        setSun(h.setSun(composeDate(INITIAL_DATE, INITIAL_MINUTES)));
        setFootprints(h.getFootprints());
        setBounds(h.terrainBounds);
        setLandcoverTiles(h.landcoverTiles);
        updatePocDebug({
          ready: true,
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
          setAtmosphere: h.setAtmosphere,
          setDepthGrading: h.setDepthGrading,
          setBuildingTransparency: h.setBuildingTransparency,
          setContactShadows: h.setContactShadows,
          setPaperGrain: h.setPaperGrain,
          setHeightFog: h.setHeightFog,
          setMeadowNdvi: h.setMeadowNdvi,
          setWaterMist: h.setWaterMist,
          setBuildingGroundShade: h.setBuildingGroundShade,
          setBuildingBands: h.setBuildingBands,
          setBuildingRim: h.setBuildingRim,
          setBuildingTint: h.setBuildingTint,
          setBuildingRoofTint: h.setBuildingRoofTint,
          setBuildingRoofVibrance: h.setBuildingRoofVibrance,
          setBuildingEave: h.setBuildingEave,
          setBuildingDuskGlow: h.setBuildingDuskGlow,
          setBuildingRoughness: h.setBuildingRoughness,
          setTreeShimmer: h.setTreeShimmer,
          setTreeTranslucency: h.setTreeTranslucency,
          setTreeLeafFlutter: h.setTreeLeafFlutter,
          setTreeLeafBright: h.setTreeLeafBright,
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
        setStatus({ phase: "ready" });
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
  }, [primary, extraTiles, insertedModelUrl]);

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
    const snap: Snapshot = {
      v: SNAPSHOT_VERSION,
      camera: h.getCameraState(),
      date: composeDate(day, minutes).toISOString(),
      look: {
        transparencyPct: transparency,
        fogPct: fogAmount,
        gradingPct: grading,
        contactPct: contact,
        grainPct: grain,
        heightFogPct: heightFog,
        meadowNdviPct: meadowNdvi,
        waterMistPct: waterMist,
        dof,
        focusMode,
        focusDistanceM: focusDistance,
        groundShadePct: groundShade,
        bandsPct: bands,
        rimPct: rim,
        tintPct: tint,
        roofTintPct: roofTint,
        roofVibrancePct: roofVibrance,
        eavePct: eave,
        duskGlowPct: duskGlow,
        roughnessPct: roughness,
        shimmerPct: shimmer,
        translucencyPct: translucency,
        leafFlutterPct: leafFlutter,
        leafBrightPct: leafBright,
        multiTuft,
      },
    };
    const text = JSON.stringify(snap, null, 2);
    setSnapshotText(text);
    navigator.clipboard?.writeText(text).then(
      () => setSnapshotMsg("Copied to clipboard"),
      () => setSnapshotMsg("Copy failed — select the text manually")
    );
  };

  // Optional (newer) look fields — split out so each apply fn stays under the
  // complexity cap; legacy v1 snapshots simply omit them.
  const applyOptionalLook = (h: CityWalkHandle, look: Snapshot["look"]) => {
    // Percent sliders share a shape (set React state + push 0..1 to the handle),
    // so table-drive them — one branch keeps this under the complexity cap.
    const pctFields: [
      number | undefined,
      (pct: number) => void,
      (n: number) => void,
    ][] = [
      [look.heightFogPct, setHeightFog, h.setHeightFog],
      [look.meadowNdviPct, setMeadowNdvi, h.setMeadowNdvi],
      [look.waterMistPct, setWaterMist, h.setWaterMist],
      [look.groundShadePct, setGroundShade, h.setBuildingGroundShade],
      [look.bandsPct, setBands, h.setBuildingBands],
      [look.rimPct, setRim, h.setBuildingRim],
      [look.tintPct, setTint, h.setBuildingTint],
      [look.roofTintPct, setRoofTint, h.setBuildingRoofTint],
      [look.roofVibrancePct, setRoofVibrance, h.setBuildingRoofVibrance],
      [look.eavePct, setEave, h.setBuildingEave],
      [look.duskGlowPct, setDuskGlow, h.setBuildingDuskGlow],
      [look.roughnessPct, setRoughness, h.setBuildingRoughness],
      [look.shimmerPct, setShimmer, h.setTreeShimmer],
      [look.translucencyPct, setTranslucency, h.setTreeTranslucency],
      [look.leafFlutterPct, setLeafFlutter, h.setTreeLeafFlutter],
      [look.leafBrightPct, setLeafBright, h.setTreeLeafBright],
    ];
    for (const [value, setUi, apply] of pctFields) {
      if (value !== undefined) {
        setUi(value);
        apply(value / 100);
      }
    }
    if (look.focusMode !== undefined) {
      setFocusMode(look.focusMode);
      h.setFocusMode(look.focusMode);
    }
    if (look.focusDistanceM !== undefined) {
      setFocusDistance(look.focusDistanceM);
      h.setFocusDistance(look.focusDistanceM);
    }
    if (look.multiTuft !== undefined) {
      setMultiTuft(look.multiTuft);
      h.setTreeMultiTuft(look.multiTuft);
    }
  };

  const applyLook = (h: CityWalkHandle, look: Snapshot["look"]) => {
    setTransparency(look.transparencyPct);
    h.setBuildingTransparency(look.transparencyPct / 100);
    setFogAmount(look.fogPct);
    h.setAtmosphere(look.fogPct / 100);
    setGrading(look.gradingPct);
    h.setDepthGrading(look.gradingPct / 100);
    setContact(look.contactPct);
    h.setContactShadows(look.contactPct / 100);
    setGrain(look.grainPct);
    h.setPaperGrain(look.grainPct / 100);
    setDof(look.dof);
    h.setDepthOfField(look.dof);
    applyOptionalLook(h, look);
  };

  const applySnapshot = () => {
    const h = handleRef.current;
    if (!h) {
      return;
    }
    let snap: Snapshot;
    try {
      snap = JSON.parse(snapshotText) as Snapshot;
    } catch {
      setSnapshotMsg("Invalid snapshot JSON");
      return;
    }
    // Guard the shape, not just presence: a parseable-but-malformed snapshot
    // (e.g. {"camera":{}}) would otherwise throw deep inside applyCameraState
    // and leave the camera half-applied with no feedback.
    if (!snap.camera?.pos || typeof snap.camera.pos.x !== "number") {
      setSnapshotMsg("Snapshot missing or malformed camera");
      return;
    }
    h.applyCameraState(snap.camera);
    const date = new Date(snap.date);
    if (!Number.isNaN(date.getTime())) {
      const nextDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      const nextMinutes = date.getHours() * 60 + date.getMinutes();
      setDay(nextDay);
      setMinutes(nextMinutes);
      setSun(h.setSun(date));
    }
    if (snap.look) {
      applyLook(h, snap.look);
    }
    setSnapshotMsg("Snapshot applied");
  };

  // Shared between the desktop sidebar and the mobile bottom drawer.
  const controlsFields = (
    <SceneControls
      applySnapshot={applySnapshot}
      bands={bands}
      coarse={coarse}
      contact={contact}
      copySnapshot={copySnapshot}
      day={day}
      dof={dof}
      duskGlow={duskGlow}
      eave={eave}
      focusDistance={focusDistance}
      focusMode={focusMode}
      fogAmount={fogAmount}
      grading={grading}
      grain={grain}
      groundShade={groundShade}
      handleRef={handleRef}
      heightFog={heightFog}
      insertBuilding={insertBuilding}
      leafBright={leafBright}
      leafFlutter={leafFlutter}
      meadowNdvi={meadowNdvi}
      minutes={minutes}
      mode={mode}
      multiTuft={multiTuft}
      rim={rim}
      roofTint={roofTint}
      roofVibrance={roofVibrance}
      roughness={roughness}
      setBands={setBands}
      setContact={setContact}
      setDof={setDof}
      setDuskGlow={setDuskGlow}
      setEave={setEave}
      setFocusDistance={setFocusDistance}
      setFocusMode={setFocusMode}
      setFogAmount={setFogAmount}
      setGrading={setGrading}
      setGrain={setGrain}
      setGroundShade={setGroundShade}
      setHeightFog={setHeightFog}
      setLeafBright={setLeafBright}
      setLeafFlutter={setLeafFlutter}
      setMeadowNdvi={setMeadowNdvi}
      setMultiTuft={setMultiTuft}
      setRim={setRim}
      setRoofTint={setRoofTint}
      setRoofVibrance={setRoofVibrance}
      setRoughness={setRoughness}
      setShimmer={setShimmer}
      setSnapshotText={setSnapshotText}
      setTint={setTint}
      setTranslucency={setTranslucency}
      setTransparency={setTransparency}
      setWaterMist={setWaterMist}
      shimmer={shimmer}
      snapshotMsg={snapshotMsg}
      snapshotText={snapshotText}
      sun={sun}
      tint={tint}
      translucency={translucency}
      transparency={transparency}
      updateSun={updateSun}
      waterMist={waterMist}
    />
  );

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

        {status.phase === "ready" && (
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

      {status.phase === "ready" && (
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
                {stats.terrainVertexCount.toLocaleString()} terrain vertices ·{" "}
                {mode === "walk" ? "walking" : "flying"}
              </p>
            )}
            <p className="text-[10px]">
              Lamp positions © OpenStreetMap contributors (ODbL).
            </p>
          </SidebarFooter>
        </Sidebar>
      )}
    </SidebarProvider>
  );
}
