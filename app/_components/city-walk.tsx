"use client";

import { format } from "date-fns";
import {
  CalendarIcon,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import type { FootprintRect } from "@/lib/city/minimap";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  type CityWalkHandle,
  type CityWalkStats,
  createCityWalkApp,
  DEFAULT_ATMOSPHERE,
  DEFAULT_CITY_STYLE,
  type PlayerPose,
} from "./create-app";
import type { MovementMode } from "./fps-movement";
import { Minimap } from "./minimap";
import { updatePocDebug } from "./poc-debug";
import {
  DEFAULT_CONTACT_SHADOWS,
  DEFAULT_DEPTH_GRADING,
  DEFAULT_DOF,
  DEFAULT_PAPER_GRAIN,
} from "./post-stack";
import type { SunState } from "./sun-rig";
import { VirtualJoystick } from "./virtual-joystick";
import {
  type CityStyleId,
  DEFAULT_CLAY_TRANSPARENCY,
  DEFAULT_EDGE_OPACITY,
  DEFAULT_GHOST_TRANSPARENCY,
  DEFAULT_TOON_BANDS,
} from "./visual-style";

interface Props {
  /** URL of the CityJSON tile, served from /public */
  citySrc: string;
  /** URL of the DGM GeoTIFF */
  demSrc: string;
  /** URL of the .tfw sidecar (georef fallback) */
  demTfwSrc?: string;
  /** Optional glTF/GLB to insert; falls back to a marker box */
  insertedModelUrl?: string;
}

type Status =
  | { phase: "loading"; message: string }
  | { phase: "ready" }
  | { phase: "error"; message: string };

// Evaluated once in the browser (the component is loaded with ssr: false).
const INITIAL_DATE = new Date();
const INITIAL_MINUTES = 14 * 60;
const MINUTES_STEP = 5;
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

export default function CityWalk({
  citySrc,
  demSrc,
  demTfwSrc,
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
  const [edges, setEdges] = useState(Math.round(DEFAULT_EDGE_OPACITY * 100));
  const [toonBands, setToonBands] = useState(DEFAULT_TOON_BANDS);
  const [contact, setContact] = useState(
    Math.round(DEFAULT_CONTACT_SHADOWS * 100)
  );
  const [grain, setGrain] = useState(Math.round(DEFAULT_PAPER_GRAIN * 100));
  const [mode, setMode] = useState<MovementMode>("walk");
  const [footprints, setFootprints] = useState<FootprintRect[]>([]);
  const [bounds, setBounds] = useState<TerrainBounds | null>(null);

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
        updatePocDebug({
          offset: h.offset,
          flyTo: h.flyTo,
          demolishAtCrosshair: h.demolishAtCrosshair,
          getPose: h.getPose,
          teleportTo: h.teleportTo,
          setStyle: h.setStyle,
          setDepthOfField: h.setDepthOfField,
          setAtmosphere: h.setAtmosphere,
          setDepthGrading: h.setDepthGrading,
          setBuildingTransparency: h.setBuildingTransparency,
          setToonBands: h.setToonBands,
          setEdges: h.setEdges,
          setContactShadows: h.setContactShadows,
          setPaperGrain: h.setPaperGrain,
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
  }, [citySrc, demSrc, demTfwSrc, insertedModelUrl]);

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
          step={5}
          value={[transparency[style]]}
        />
        <FieldDescription>
          {style === "ghost"
            ? "Frosted glass — the backdrop shows through blurred"
            : "Plain see-through"}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="ink-edges">Ink edges · {edges}%</FieldLabel>
        <Slider
          disabled={style === "standard"}
          id="ink-edges"
          max={100}
          min={0}
          onValueChange={(value) => {
            const next = Number(Array.isArray(value) ? value[0] : value);
            setEdges(next);
            handleRef.current?.setEdges(next / 100);
          }}
          step={5}
          value={[edges]}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="toon-bands">Toon shading</FieldLabel>
        <ToggleGroup
          className="w-full"
          id="toon-bands"
          onValueChange={(value: string[]) => {
            const next = value[0];
            if (next !== undefined) {
              const bands = Number(next);
              setToonBands(bands);
              handleRef.current?.setToonBands(bands);
            }
          }}
          value={[String(toonBands)]}
          variant="outline"
        >
          {[0, 3, 4, 6].map((bands) => (
            <ToggleGroupItem
              className="flex-1"
              key={bands}
              value={String(bands)}
            >
              {bands === 0 ? "Off" : `${bands}`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>Gradient-mapped light bands</FieldDescription>
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
          step={5}
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
          step={5}
          value={[grain]}
        />
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
          step={5}
          value={[fogAmount]}
        />
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
          step={5}
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

          {!coarse && (
            <Card className="pointer-events-none absolute top-3 left-3 max-w-xs gap-0 py-3">
              <CardContent className="flex flex-col gap-2 px-4 text-xs leading-5">
                <p>
                  Click the view to capture the mouse · <Kbd>WASD</Kbd> move ·{" "}
                  <Kbd>Shift</Kbd> sprint · <Kbd>F</Kbd> walk/fly ·{" "}
                  <Kbd>Space</Kbd>/<Kbd>Shift</Kbd> up/down in fly mode ·{" "}
                  <Kbd>R</Kbd> demolish under crosshair · <Kbd>B</Kbd> insert
                  building · <Kbd>Esc</Kbd> release
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

          {coarse && (
            <>
              <div className="absolute bottom-8 left-5">
                <VirtualJoystick
                  onChange={(x, y) => handleRef.current?.setMoveInput(x, y)}
                />
              </div>
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
            </>
          )}

          {bounds && (
            <div
              className={
                coarse ? "absolute top-16 right-3" : "absolute right-3 bottom-3"
              }
            >
              <Minimap
                bounds={bounds}
                footprints={footprints}
                onTeleport={(x, y) => handleRef.current?.teleportTo(x, y)}
                size={coarse ? 120 : 192}
                subscribePose={subscribePose}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
