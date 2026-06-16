"use client";

import { format } from "date-fns";
import {
  CalendarIcon,
  CameraIcon,
  ClipboardPasteIcon,
  CopyIcon,
  FullscreenIcon,
  HammerIcon,
  HousePlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  DEFAULT_CITY_STYLE,
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
import {
  DEFAULT_TREE_MULTITUFT,
  DEFAULT_TREE_SHIMMER,
  DEFAULT_TREE_TRANSLUCENCY,
} from "./vegetation-layer";
import { VirtualJoystick } from "./virtual-joystick";
import {
  type CityStyleId,
  DEFAULT_BUILDING_BANDS,
  DEFAULT_BUILDING_DUSK_GLOW,
  DEFAULT_BUILDING_EAVE,
  DEFAULT_BUILDING_GROUND_SHADE,
  DEFAULT_BUILDING_RIM,
  DEFAULT_BUILDING_ROOF_TINT,
  DEFAULT_BUILDING_ROUGHNESS,
  DEFAULT_BUILDING_TINT,
  DEFAULT_CLAY_TRANSPARENCY,
  DEFAULT_GHOST_TRANSPARENCY,
} from "./visual-style";
import { DEFAULT_WATER_MIST } from "./water-layer";

interface Props {
  /** URL of the CityJSON tile, served from /public */
  citySrc: string;
  /** URL of the DGM GeoTIFF */
  demSrc: string;
  /** URL of the .tfw sidecar (georef fallback) */
  demTfwSrc?: string;
  /** Neighbouring tiles rendered around the primary one for context */
  extraTiles?: TileSrc[];
  /** Optional glTF/GLB to insert; falls back to a marker box */
  insertedModelUrl?: string;
  /** Optional OSM street-lamp GeoJSON (ODbL) for the primary tile */
  lampsSrc?: string;
  /** Optional ATKIS land-cover splatmap (PNG) for per-surface terrain tinting */
  landcoverSrc?: string;
  /** Optional ATKIS veg04 GeoJSON for hedges + tree rows */
  vegetationSrc?: string;
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

const STYLE_LABELS: Record<CityStyleId, string> = {
  standard: "Standard",
  ghost: "Ghost",
  clay: "Clay",
};

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
    multiTuft?: boolean;
    rimPct?: number;
    roofTintPct?: number;
    roughnessPct?: number;
    shimmerPct?: number;
    style: CityStyleId;
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
        <Field>
          <FieldLabel htmlFor="focus-distance">
            Focus distance · {distance} m
          </FieldLabel>
          <Slider
            id="focus-distance"
            max={3000}
            min={1}
            onValueChange={(value) => {
              onDistance(Number(Array.isArray(value) ? value[0] : value));
            }}
            step={5}
            value={[distance]}
          />
        </Field>
      )}
    </>
  );
}

export default function CityWalk({
  citySrc,
  demSrc,
  demTfwSrc,
  landcoverSrc,
  vegetationSrc,
  lampsSrc,
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
  const [style, setStyle] = useState<CityStyleId>(DEFAULT_CITY_STYLE);
  const [dof, setDof] = useState(DEFAULT_DOF);
  const [focusMode, setFocusMode] = useState<FocusMode>(DEFAULT_FOCUS_MODE);
  const [focusDistance, setFocusDistance] = useState(DEFAULT_FOCUS_DISTANCE);
  const [fogAmount, setFogAmount] = useState(
    Math.round(DEFAULT_ATMOSPHERE * 100)
  );
  const [grading, setGrading] = useState(
    Math.round(DEFAULT_DEPTH_GRADING * 100)
  );
  const [transparency, setTransparency] = useState<Record<CityStyleId, number>>(
    {
      standard: 0,
      ghost: Math.round(DEFAULT_GHOST_TRANSPARENCY * 100),
      clay: Math.round(DEFAULT_CLAY_TRANSPARENCY * 100),
    }
  );
  const [contact, setContact] = useState(
    Math.round(DEFAULT_CONTACT_SHADOWS * 100)
  );
  const [grain, setGrain] = useState(Math.round(DEFAULT_PAPER_GRAIN * 100));
  const [heightFog, setHeightFog] = useState(
    Math.round(DEFAULT_HEIGHT_FOG * 100)
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
  const [multiTuft, setMultiTuft] = useState(DEFAULT_TREE_MULTITUFT);
  const [mode, setMode] = useState<MovementMode>("walk");
  const [footprints, setFootprints] = useState<FootprintPoly[]>([]);
  const [bounds, setBounds] = useState<TerrainBounds | null>(null);
  const [landcoverTiles, setLandcoverTiles] = useState<
    { bounds: TerrainBounds; src: string }[]
  >([]);
  const [fps, setFps] = useState<number | null>(null);
  /** Minimap edge length in CSS px; user-adjustable. */
  const [minimapSize, setMinimapSize] = useState(coarse ? 120 : 192);
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
      citySrc,
      demSrc,
      demTfwSrc,
      landcoverSrc,
      vegetationSrc,
      lampsSrc,
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
        updatePocDebug({ ready: true, ...s });
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
          offset: h.offset,
          flyTo: h.flyTo,
          demolishAtCrosshair: h.demolishAtCrosshair,
          getPose: h.getPose,
          getCameraState: h.getCameraState,
          getRenderInfo: h.getRenderInfo,
          getFocusDebug: h.getFocusDebug,
          applyCameraState: h.applyCameraState,
          teleportTo: h.teleportTo,
          setStyle: h.setStyle,
          setDepthOfField: h.setDepthOfField,
          setFocusMode: h.setFocusMode,
          setFocusDistance: h.setFocusDistance,
          setAtmosphere: h.setAtmosphere,
          setDepthGrading: h.setDepthGrading,
          setBuildingTransparency: h.setBuildingTransparency,
          setContactShadows: h.setContactShadows,
          setPaperGrain: h.setPaperGrain,
          setHeightFog: h.setHeightFog,
          setWaterMist: h.setWaterMist,
          setBuildingGroundShade: h.setBuildingGroundShade,
          setBuildingBands: h.setBuildingBands,
          setBuildingRim: h.setBuildingRim,
          setBuildingTint: h.setBuildingTint,
          setBuildingRoofTint: h.setBuildingRoofTint,
          setBuildingEave: h.setBuildingEave,
          setBuildingDuskGlow: h.setBuildingDuskGlow,
          setBuildingRoughness: h.setBuildingRoughness,
          setTreeShimmer: h.setTreeShimmer,
          setTreeTranslucency: h.setTreeTranslucency,
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
  }, [
    citySrc,
    demSrc,
    demTfwSrc,
    landcoverSrc,
    vegetationSrc,
    lampsSrc,
    extraTiles,
    insertedModelUrl,
  ]);

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
        style,
        transparencyPct: transparency[style],
        fogPct: fogAmount,
        gradingPct: grading,
        contactPct: contact,
        grainPct: grain,
        heightFogPct: heightFog,
        waterMistPct: waterMist,
        dof,
        focusMode,
        focusDistanceM: focusDistance,
        groundShadePct: groundShade,
        bandsPct: bands,
        rimPct: rim,
        tintPct: tint,
        roofTintPct: roofTint,
        eavePct: eave,
        duskGlowPct: duskGlow,
        roughnessPct: roughness,
        shimmerPct: shimmer,
        translucencyPct: translucency,
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
      [look.waterMistPct, setWaterMist, h.setWaterMist],
      [look.groundShadePct, setGroundShade, h.setBuildingGroundShade],
      [look.bandsPct, setBands, h.setBuildingBands],
      [look.rimPct, setRim, h.setBuildingRim],
      [look.tintPct, setTint, h.setBuildingTint],
      [look.roofTintPct, setRoofTint, h.setBuildingRoofTint],
      [look.eavePct, setEave, h.setBuildingEave],
      [look.duskGlowPct, setDuskGlow, h.setBuildingDuskGlow],
      [look.roughnessPct, setRoughness, h.setBuildingRoughness],
      [look.shimmerPct, setShimmer, h.setTreeShimmer],
      [look.translucencyPct, setTranslucency, h.setTreeTranslucency],
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
    setStyle(look.style);
    h.setStyle(look.style);
    setTransparency((prev) => ({
      ...prev,
      [look.style]: look.transparencyPct,
    }));
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
    if (!snap.camera) {
      setSnapshotMsg("Snapshot missing camera");
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

  // Shared between the desktop card and the mobile bottom drawer.
  const controlsFields = (
    <FieldGroup className="gap-4">
      <Field>
        <FieldLabel htmlFor="sun-date">Date</FieldLabel>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                className="w-full justify-start font-normal"
                id="sun-date"
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

      <FieldSeparator />

      <Field>
        <FieldLabel htmlFor="city-style">Building style</FieldLabel>
        <ToggleGroup
          className="w-full"
          id="city-style"
          onValueChange={(value: string[]) => {
            const next = value[0] as CityStyleId | undefined;
            if (next) {
              setStyle(next);
              handleRef.current?.setStyle(next);
            }
          }}
          value={[style]}
          variant="outline"
        >
          {(Object.keys(STYLE_LABELS) as CityStyleId[]).map((id) => (
            <ToggleGroupItem className="flex-1" key={id} value={id}>
              {STYLE_LABELS[id]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="building-transparency">
          Transparency · {transparency[style]}%
        </FieldLabel>
        <Slider
          disabled={style === "standard"}
          id="building-transparency"
          max={90}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setTransparency((prev) => ({ ...prev, [style]: next }));
            handleRef.current?.setBuildingTransparency(next / 100);
          }}
          step={1}
          value={[transparency[style]]}
        />
        <FieldDescription>
          {style === "ghost"
            ? "Frosted glass — the backdrop shows through blurred"
            : "Plain see-through"}
        </FieldDescription>
      </Field>

      <FieldSeparator />

      <Field>
        <FieldLabel htmlFor="contact-shadows">
          Contact shadows · {contact}%
        </FieldLabel>
        <Slider
          id="contact-shadows"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setContact(next);
            handleRef.current?.setContactShadows(next / 100);
          }}
          step={1}
          value={[contact]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="paper-grain">Paper grain · {grain}%</FieldLabel>
        <Slider
          id="paper-grain"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setGrain(next);
            handleRef.current?.setPaperGrain(next / 100);
          }}
          step={1}
          value={[grain]}
        />
      </Field>

      <FieldSeparator />

      <Field>
        <FieldLabel htmlFor="building-ground-shade">
          Boden-Verlauf · {groundShade}%
        </FieldLabel>
        <Slider
          id="building-ground-shade"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setGroundShade(next);
            handleRef.current?.setBuildingGroundShade(next / 100);
          }}
          step={1}
          value={[groundShade]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="building-bands">Höhenlinien · {bands}%</FieldLabel>
        <Slider
          id="building-bands"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setBands(next);
            handleRef.current?.setBuildingBands(next / 100);
          }}
          step={1}
          value={[bands]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="building-rim">Streiflicht · {rim}%</FieldLabel>
        <Slider
          id="building-rim"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setRim(next);
            handleRef.current?.setBuildingRim(next / 100);
          }}
          step={1}
          value={[rim]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="building-tint">Farbvariation · {tint}%</FieldLabel>
        <Slider
          id="building-tint"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setTint(next);
            handleRef.current?.setBuildingTint(next / 100);
          }}
          step={1}
          value={[tint]}
        />
        <FieldDescription>
          Per-building clay tint from use &amp; height, blended into the base
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="building-roof-tint">
          Dachfarbe · {roofTint}%
        </FieldLabel>
        <Slider
          id="building-roof-tint"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setRoofTint(next);
            handleRef.current?.setBuildingRoofTint(next / 100);
          }}
          step={1}
          value={[roofTint]}
        />
        <FieldDescription>
          Terracotta or slate per roof, from roofType &amp; pitch
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="building-eave">Traufkante · {eave}%</FieldLabel>
        <Slider
          id="building-eave"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setEave(next);
            handleRef.current?.setBuildingEave(next / 100);
          }}
          step={1}
          value={[eave]}
        />
        <FieldDescription>
          Soft cornice line where wall meets roof
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="building-dusk-glow">
          Abendlicht · {duskGlow}%
        </FieldLabel>
        <Slider
          id="building-dusk-glow"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setDuskGlow(next);
            handleRef.current?.setBuildingDuskGlow(next / 100);
          }}
          step={1}
          value={[duskGlow]}
        />
        <FieldDescription>
          Warm interior glow on civic/commercial buildings at dusk
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="building-roughness">
          Materialstreuung · {roughness}%
        </FieldLabel>
        <Slider
          id="building-roughness"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setRoughness(next);
            handleRef.current?.setBuildingRoughness(next / 100);
          }}
          step={1}
          value={[roughness]}
        />
        <FieldDescription>
          Subtle per-building matte/sheen variation
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="tree-shimmer">
          Gegenlicht-Schimmer · {shimmer}%
        </FieldLabel>
        <Slider
          id="tree-shimmer"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setShimmer(next);
            handleRef.current?.setTreeShimmer(next / 100);
          }}
          step={1}
          value={[shimmer]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="tree-translucency">
          Blattdurchscheinen · {translucency}%
        </FieldLabel>
        <Slider
          id="tree-translucency"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setTranslucency(next);
            handleRef.current?.setTreeTranslucency(next / 100);
          }}
          step={1}
          value={[translucency]}
        />
        <FieldDescription>
          Backlit glow on near/large crowns (shadow-gated)
        </FieldDescription>
      </Field>

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
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="minimap-size">Minimap size</FieldLabel>
        <ToggleGroup
          className="w-full"
          id="minimap-size"
          onValueChange={(value: string[]) => {
            const next = value[0];
            if (next) {
              setMinimapSize(Number(next));
            }
          }}
          value={[String(minimapSize)]}
          variant="outline"
        >
          {[
            ["S", 120],
            ["M", 192],
            ["L", 280],
          ].map(([label, px]) => (
            <ToggleGroupItem className="flex-1" key={px} value={String(px)}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field orientation="horizontal">
        <FieldLabel htmlFor="depth-of-field">Depth of field</FieldLabel>
        <Switch
          checked={dof}
          id="depth-of-field"
          onCheckedChange={(checked) => {
            setDof(checked);
            handleRef.current?.setDepthOfField(checked);
          }}
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

      <Field>
        <FieldLabel htmlFor="atmosphere">Fog · {fogAmount}%</FieldLabel>
        <Slider
          id="atmosphere"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setFogAmount(next);
            handleRef.current?.setAtmosphere(next / 100);
          }}
          step={1}
          value={[fogAmount]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="height-fog">Talnebel · {heightFog}%</FieldLabel>
        <Slider
          id="height-fog"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setHeightFog(next);
            handleRef.current?.setHeightFog(next / 100);
          }}
          step={1}
          value={[heightFog]}
        />
        <FieldDescription>
          Haze pooling along the valley floor / the Elbe
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="water-mist">Flussnebel · {waterMist}%</FieldLabel>
        <Slider
          id="water-mist"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setWaterMist(next);
            handleRef.current?.setWaterMist(next / 100);
          }}
          step={1}
          value={[waterMist]}
        />
        <FieldDescription>Drifting mist over the river</FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="depth-grading">
          Depth color · warm near, cool far · {grading}%
        </FieldLabel>
        <Slider
          id="depth-grading"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setGrading(next);
            handleRef.current?.setDepthGrading(next / 100);
          }}
          step={1}
          value={[grading]}
        />
      </Field>

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
        />
      </Field>

      <Button onClick={insertBuilding} variant="secondary">
        <HousePlusIcon data-icon="inline-start" />
        {coarse ? "Insert building" : "Insert building (B)"}
      </Button>

      {!coarse && (
        <Button
          onClick={() => handleRef.current?.enterImmersive()}
          variant="outline"
        >
          <FullscreenIcon data-icon="inline-start" />
          Immersive mode · Esc exits
        </Button>
      )}

      <FieldSeparator />

      <Field>
        <FieldLabel htmlFor="snapshot">
          <CameraIcon data-icon="inline-start" />
          Snapshot
        </FieldLabel>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={copySnapshot}
            type="button"
            variant="secondary"
          >
            <CopyIcon data-icon="inline-start" />
            Copy
          </Button>
          <Button
            className="flex-1"
            onClick={applySnapshot}
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
          rows={5}
          spellCheck={false}
          value={snapshotText}
        />
        <FieldDescription>
          {snapshotMsg ??
            "Reproducible capture — share or replay an exact view."}
        </FieldDescription>
      </Field>

      <FieldSeparator />

      <p className="text-[10px] text-muted-foreground leading-snug">
        Lamp positions © OpenStreetMap contributors (ODbL).
      </p>
    </FieldGroup>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-900">
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
          <AlertDescription className="break-words">
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

          {!coarse && (
            <Card className="pointer-events-none absolute top-3 left-3 max-w-xs gap-0 py-3">
              <CardContent className="flex flex-col gap-2 px-4 text-xs leading-5">
                <p>
                  Drag the view to look around · <Kbd>WASD</Kbd> or joystick to
                  move · double-click the ground to travel · scroll to zoom ·{" "}
                  <Kbd>Shift</Kbd> sprint · <Kbd>F</Kbd> walk/fly ·{" "}
                  <Kbd>Space</Kbd>/<Kbd>Shift</Kbd> up/down in fly mode ·{" "}
                  <Kbd>R</Kbd> demolish under crosshair · <Kbd>B</Kbd> insert
                  building · Immersive mode locks the mouse (<Kbd>Esc</Kbd>{" "}
                  exits)
                </p>
                {stats && (
                  <p className="text-muted-foreground">
                    {stats.buildingCount} buildings ·{" "}
                    {stats.terrainVertexCount.toLocaleString()} terrain vertices
                    · {mode === "walk" ? "walking" : "flying"}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {coarse ? (
            <Drawer>
              <DrawerTrigger asChild>
                <Button
                  aria-label="Scene settings"
                  className="absolute top-3 right-3 shadow-md"
                  size="icon"
                  variant="secondary"
                >
                  <SlidersHorizontalIcon />
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Scene settings</DrawerTitle>
                  <DrawerDescription>
                    Drag to look around · joystick to walk · double-tap the
                    ground to travel there · pinch to zoom
                  </DrawerDescription>
                </DrawerHeader>
                <div className="overflow-y-auto px-4 pb-8">
                  {controlsFields}
                </div>
              </DrawerContent>
            </Drawer>
          ) : (
            <Card className="absolute top-3 right-3 max-h-[calc(100dvh-1.5rem)] w-72 gap-0 overflow-y-auto py-4">
              <CardContent className="px-4">{controlsFields}</CardContent>
            </Card>
          )}

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

          {bounds && (
            <div
              className={
                coarse ? "absolute top-16 right-3" : "absolute right-3 bottom-3"
              }
            >
              <Minimap
                bounds={bounds}
                focusRingM={focusRingMeters(dof, focusMode, focusDistance)}
                footprints={footprints}
                landcoverTiles={landcoverTiles}
                onTeleport={(x, y) => handleRef.current?.teleportTo(x, y)}
                size={minimapSize}
                subscribePose={subscribePose}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
