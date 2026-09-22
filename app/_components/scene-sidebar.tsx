"use client";

import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  Building2Icon,
  CalendarIcon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  CloudFogIcon,
  CopyIcon,
  FootprintsIcon,
  FullscreenIcon,
  HammerIcon,
  HousePlusIcon,
  type LucideIcon,
  PlaneIcon,
  SparklesIcon,
  StarIcon,
  TreesIcon,
  XIcon,
} from "lucide-react";
import type {
  CSSProperties,
  Dispatch,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { getTimes } from "suncalc";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type FocusMode,
  LOOK_CONTROLS,
  type LookGroup,
  lookPatch,
  type LookValues,
} from "@/lib/city/look-controls";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { CameraState, PlayerPose } from "@/lib/city/pose";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import type { CityWalkHandle, CityWalkStats } from "./create-app";
import type { MovementMode } from "./fps-movement";
import { Minimap } from "./minimap";
import { CONTROL_HINTS, TOUCH_HINTS } from "./control-hints";
import { type SceneTabId, SceneTabPanel, SceneTabs } from "./scene-tabs";
import type { SunState } from "./sun-rig";
import { SCENIC_VIEWS } from "./viewpoints";

/**
 * The scene sidebar, structured by what you came to do rather than by which
 * uniform a slider writes to:
 *
 *  - **Erkunden** — where you are and where you can go: minimap, walk/fly,
 *    the scenic vantages, the keys. Everything a first visit needs.
 *  - **Szene** — what the scene looks like right now: sun and time, then the
 *    look groups, each collapsed until asked for.
 *  - **Erweitert** — the tools, the snapshot codec and the counters.
 *
 * It is the shadcn Sidebar in its `floating` variant: the scene stays
 * full-bleed underneath and the panel sits over it as a rounded card, which is
 * what the design asks for. (`inset` is the variant that insets the *main*
 * content instead — this viewer has no SidebarInset to inset.)
 */

const SECTION_LABEL =
  "font-semibold text-[11px] uppercase leading-none tracking-widest text-muted-foreground";

const LOOK_GROUPS: {
  group: LookGroup;
  icon: LucideIcon;
  note: string;
  title: string;
}[] = [
  {
    group: "atmosphere",
    icon: CloudFogIcon,
    note: "Nebel & Tiefe",
    title: "Atmosphäre",
  },
  {
    group: "buildings",
    icon: Building2Icon,
    note: "Farbe & Kanten",
    title: "Gebäude",
  },
  {
    group: "vegetation",
    icon: TreesIcon,
    note: "Kronen & Wiesen",
    title: "Vegetation",
  },
  {
    group: "rendering",
    icon: SparklesIcon,
    note: "Tiefenschärfe & Korn",
    title: "Rendering",
  },
];

function formatMinutes(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** True for a real instant — suncalc returns an Invalid Date at the poles
 *  and on days the sun never rises or sets. */
function isRealDate(date: Date | null | undefined): date is Date {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

/** A sunrise/sunset label, or an em dash when there is no such moment. */
function sunTimeLabel(arrow: string, date: Date | null | undefined): string {
  return isRealDate(date)
    ? `${arrow} ${formatMinutes(minutesOfDay(date))}`
    : `${arrow} –`;
}

/** A labelled 0–100(+) percent slider that writes straight to the look store. */
function PctSlider({
  description,
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
      <FieldLabel className="justify-between font-medium text-xs" htmlFor={id}>
        {label}
        <span className="font-mono font-normal text-[11px] text-muted-foreground tabular-nums">
          {value} {unit}
        </span>
      </FieldLabel>
      <Slider
        id={id}
        max={max}
        min={min}
        onValueChange={(v) => onChange(Number(Array.isArray(v) ? v[0] : v))}
        step={step}
        value={[value]}
      />
      {description ? (
        <FieldDescription className="text-[11px] leading-snug">
          {description}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/** Every percent slider of one look group, rendered from LOOK_CONTROLS. */
function LookSliders({
  group,
  look,
  onLook,
}: {
  group: LookGroup;
  look: LookValues;
  onLook: (patch: Partial<LookValues>) => void;
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
          onChange={(n) => onLook(lookPatch(def.key, n / 100))}
          value={Math.round(look[def.key] * 100)}
        />
      ))}
    </>
  );
}

/** DoF focus controls (mode toggle + manual distance); null when DoF is off. */
function FocusControls({
  distance,
  enabled,
  mode,
  onDistance,
  onMode,
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
        <FieldLabel className="font-medium text-xs" htmlFor="focus-mode">
          Fokus
        </FieldLabel>
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
            Automatisch
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="manual">
            Manuell
          </ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription className="text-[11px] leading-snug">
          {mode === "auto"
            ? "Scharf auf das, was unter dem Fadenkreuz liegt"
            : "Feste Fokusdistanz — als Ring auf der Minikarte"}
        </FieldDescription>
      </Field>
      {mode === "manual" && (
        <PctSlider
          id="focus-distance"
          label="Fokusdistanz"
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

/** One collapsed look group in the Szene tab. */
function LookGroupRow({
  children,
  icon: Icon,
  note,
  title,
}: {
  children: ReactNode;
  icon: LucideIcon;
  note: string;
  title: string;
}) {
  return (
    <Collapsible>
      {/* base-ui's trigger already renders a <button>; naming it here keeps
          the group readable to a screen reader, whose users get no chevron. */}
      <CollapsibleTrigger
        aria-label={`${title} — Regler ein- und ausklappen`}
        className="group/look -mx-2 flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-accent"
      >
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="flex-1 font-medium text-xs">{title}</span>
        <span className="text-[11px] text-muted-foreground">{note}</span>
        <ChevronDownIcon className="size-3 opacity-35 transition-transform group-aria-expanded/look:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FieldGroup className="gap-3 py-2 pb-3.5 pl-6">{children}</FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The minimap card: click to teleport, the blue dot is you. */
function MinimapCard({
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
  // The minimap paints into a fixed-size canvas, so it needs a pixel count
  // rather than a CSS width: measure the card and hand it the result.
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
    <div className="px-3 pb-3">
      <div
        className="relative overflow-hidden rounded-lg ring-1 ring-sidebar-border"
        ref={ref}
      >
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
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-sm bg-background/85 px-1.5 py-0.5 font-medium font-mono text-[10px] text-muted-foreground leading-none">
          Klick = teleportieren
        </span>
      </div>
    </div>
  );
}

/** The scenic vantages, plus the view you saved yourself this session. */
function Viewpoints({
  onRemember,
  onRestore,
  onTravel,
  remembered,
}: {
  onRemember: () => void;
  onRestore: () => void;
  onTravel: (id: string) => void;
  remembered: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-3 pt-1 pb-3.5">
      <span className={`${SECTION_LABEL} px-1`}>Aussichtspunkte</span>
      <div className="grid grid-cols-2 gap-2">
        {SCENIC_VIEWS.map((view) => (
          <button
            className="flex min-h-16.5 flex-col gap-2 rounded-lg border bg-background p-2.5 text-left hover:border-ring"
            key={view.id}
            onClick={() => onTravel(view.id)}
            title={view.description}
            type="button"
          >
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground leading-none">
              {view.mode === "fly" ? (
                <PlaneIcon className="size-3" />
              ) : (
                <FootprintsIcon className="size-3" />
              )}
              {view.mode === "fly" ? "Flug" : "zu Fuß"}
            </span>
            <span className="font-medium text-xs leading-tight">
              {view.label}
            </span>
          </button>
        ))}
        <button
          className="flex min-h-16.5 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-2.5 text-[11px] text-muted-foreground leading-tight hover:border-ring hover:text-foreground"
          onClick={remembered ? onRestore : onRemember}
          title={
            remembered
              ? "Zur gemerkten Sicht zurückspringen"
              : "Die aktuelle Kameraposition für diese Sitzung merken"
          }
          type="button"
        >
          <StarIcon className="size-3.5" />
          {remembered ? "Gemerkte Sicht" : "Aktuelle Sicht merken"}
        </button>
      </div>
    </div>
  );
}

/**
 * The key/action table — the full list the floating bar only shows the first
 * four of. Touch devices get the gestures instead: a phone has no W A S D.
 */
function ControlTable({ coarse }: { coarse: boolean }) {
  return (
    <div className="flex flex-col gap-2 border-t px-4 pt-3 pb-3.5">
      <span className={SECTION_LABEL}>Steuerung</span>
      <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2.5 gap-y-2 text-xs">
        {(coarse ? TOUCH_HINTS : CONTROL_HINTS).map((hint) => (
          <Fragment key={hint.key}>
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center whitespace-nowrap rounded-sm border bg-muted px-1.5 font-medium text-[10px] text-muted-foreground leading-none">
              {hint.key}
            </span>
            <span className="whitespace-nowrap text-muted-foreground">
              {hint.action}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Sun and time: the date, the minute, and where the sun stands because of it. */
function SunControls({
  day,
  latLng,
  minutes,
  sun,
  updateSun,
}: {
  day: Date;
  latLng: { lat: number; lng: number } | null;
  minutes: number;
  sun: SunState | null;
  updateSun: (day: Date, minutes: number) => void;
}) {
  const times = latLng ? getTimes(day, latLng.lat, latLng.lng) : null;
  const sunrise = times?.sunrise;
  const sunset = times?.sunset;
  // The track is the day itself: night at both ends, the warm band anchored to
  // this date's real sunrise and sunset rather than to fixed hours.
  const at = (date: Date | null | undefined, fallback: number) =>
    isRealDate(date) ? minutesOfDay(date) / (24 * 60) : fallback;
  const rise = at(sunrise, 0.29);
  const set = at(sunset, 0.8);
  const gradient =
    "linear-gradient(90deg,#2a3050 0%," +
    `#4a4a78 ${(rise - 0.03) * 100}%,#f0c79a ${(rise + 0.02) * 100}%,` +
    `#dfe7ee 50%,#f0c79a ${(set - 0.02) * 100}%,#4a4a78 ${(set + 0.03) * 100}%,` +
    "#2a3050 100%)";
  return (
    <div className="flex flex-col gap-2.5 px-4 pt-1 pb-3.5">
      <div className="flex items-center justify-between">
        <span className={SECTION_LABEL}>Sonne &amp; Zeit</span>
        <span className="text-[11px] text-muted-foreground">
          {sun
            ? `Sonnenhöhe ${sun.altitudeDeg.toFixed(0)}°${sun.aboveHorizon ? "" : " · unter dem Horizont"}`
            : "Sonnenstand unbekannt"}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                className="h-7.5 justify-start font-normal text-xs"
                id="sun-date"
                size="sm"
                variant="outline"
              />
            }
          >
            <CalendarIcon data-icon="inline-start" />
            {format(day, "d. MMMM yyyy", { locale: de })}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              onSelect={(d) => d && updateSun(d, minutes)}
              selected={day}
            />
          </PopoverContent>
        </Popover>
        <span className="flex h-7.5 items-center rounded-lg border px-2.5 font-medium font-mono text-xs tabular-nums">
          {formatMinutes(minutes)}
        </span>
      </div>
      <Slider
        aria-label="Tageszeit"
        className="[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-[image:var(--sun-gradient)]"
        id="sun-time"
        max={24 * 60 - 1}
        min={0}
        onValueChange={(value) =>
          updateSun(day, Number(Array.isArray(value) ? value[0] : value))
        }
        step={1}
        style={{ "--sun-gradient": gradient } as CSSProperties}
        value={[minutes]}
      />
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground leading-none">
        <span>0:00</span>
        <span>{sunTimeLabel("↑", sunrise)}</span>
        <span>12:00</span>
        <span>{sunTimeLabel("↓", sunset)}</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

/** A tool row: icon, what it does, and the key that also does it. */
function ToolButton({
  hint,
  icon: Icon,
  label,
  onClick,
}: {
  hint: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex min-h-8.5 items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5 text-left font-medium text-xs hover:border-ring"
      onClick={onClick}
      type="button"
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="flex-1 text-pretty leading-snug">{label}</span>
      <span className="inline-flex h-4.5 shrink-0 items-center rounded-sm bg-muted px-1.5 font-medium text-[10px] text-muted-foreground leading-none">
        {hint}
      </span>
    </button>
  );
}

export interface SceneSidebarProps {
  applySnapshot: () => void;
  bounds: TerrainBounds | null;
  coarse: boolean;
  copySnapshot: () => void;
  day: Date;
  footprints: FootprintPoly[];
  fps: number | null;
  handleRef: RefObject<CityWalkHandle | null>;
  insertBuilding: () => void;
  landcoverTiles: { bounds: TerrainBounds; src: string }[];
  latLng: { lat: number; lng: number } | null;
  look: LookValues;
  minutes: number;
  mode: MovementMode;
  onLook: (patch: Partial<LookValues>) => void;
  onTab: (tab: SceneTabId) => void;
  onTeleport: (epsgX: number, epsgY: number) => void;
  rememberedView: CameraState | null;
  resetLook: () => void;
  setRememberedView: (state: CameraState | null) => void;
  setSnapshotText: Dispatch<SetStateAction<string>>;
  snapshotMsg: string | null;
  snapshotText: string;
  stats: CityWalkStats | null;
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
  sun: SunState | null;
  tab: SceneTabId;
  updateSun: (day: Date, minutes: number) => void;
}

export function SceneSidebar(props: SceneSidebarProps) {
  const { toggleSidebar } = useSidebar();
  const { handleRef, look, onLook } = props;
  return (
    <Sidebar
      className="p-3 [&>[data-slot=sidebar-inner]]:rounded-xl [&>[data-slot=sidebar-inner]]:shadow-xl"
      collapsible="offcanvas"
      side="right"
      variant="floating"
    >
      <SidebarHeader className="flex-row items-center justify-between gap-2 py-3 pr-2 pl-4">
        <span className="font-semibold text-sm">Dresden · Altstadt</span>
        <Button
          aria-label="Seitenleiste schließen"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </SidebarHeader>

      <SidebarContent className="overflow-hidden">
        <SceneTabs onValueChange={props.onTab} value={props.tab}>
          <SceneTabPanel value="erkunden">
            {props.bounds && (
              <MinimapCard
                bounds={props.bounds}
                focusRingM={
                  look.dof && look.focusMode === "manual"
                    ? look.focusDistanceM
                    : null
                }
                footprints={props.footprints}
                landcoverTiles={props.landcoverTiles}
                onTeleport={props.onTeleport}
                subscribePose={props.subscribePose}
              />
            )}
            <div className="px-3 pb-3">
              <ToggleGroup
                className="grid w-full grid-cols-2 rounded-lg border p-0.75"
                onValueChange={(value: string[]) => {
                  const next = value[0] as MovementMode | undefined;
                  if (next) {
                    handleRef.current?.setMovementMode(next);
                  }
                }}
                size="sm"
                value={[props.mode]}
              >
                <ToggleGroupItem
                  className="h-7 data-pressed:bg-foreground data-pressed:text-background"
                  value="walk"
                >
                  <FootprintsIcon data-icon="inline-start" />
                  Gehen
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="h-7 data-pressed:bg-foreground data-pressed:text-background"
                  value="fly"
                >
                  <PlaneIcon data-icon="inline-start" />
                  Fliegen
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Viewpoints
              onRemember={() => {
                const state = handleRef.current?.getCameraState();
                if (state) {
                  props.setRememberedView(state);
                }
              }}
              onRestore={() => {
                if (props.rememberedView) {
                  handleRef.current?.applyCameraState(props.rememberedView);
                }
              }}
              onTravel={(id) => {
                const view = SCENIC_VIEWS.find((v) => v.id === id);
                if (view) {
                  handleRef.current?.flyToViewpoint(view);
                }
              }}
              remembered={props.rememberedView !== null}
            />
            <ControlTable coarse={props.coarse} />
          </SceneTabPanel>

          <SceneTabPanel value="szene">
            <SunControls
              day={props.day}
              latLng={props.latLng}
              minutes={props.minutes}
              sun={props.sun}
              updateSun={props.updateSun}
            />
            <div className="flex flex-col gap-0.5 border-t px-4 pt-3 pb-3.5">
              <div className="flex items-center justify-between pb-1.5">
                <span className={SECTION_LABEL}>Darstellung</span>
                <button
                  className="text-[11px] text-primary hover:underline"
                  onClick={props.resetLook}
                  type="button"
                >
                  Zurücksetzen
                </button>
              </div>
              {LOOK_GROUPS.map(({ group, icon, note, title }) => (
                <LookGroupRow icon={icon} key={group} note={note} title={title}>
                  <LookSliders group={group} look={look} onLook={onLook} />
                  {group === "vegetation" && (
                    <Field orientation="horizontal">
                      <FieldLabel
                        className="font-medium text-xs"
                        htmlFor="tree-multituft"
                      >
                        Multi-Tuft-Kronen (nah)
                      </FieldLabel>
                      <Switch
                        checked={look.multiTuft}
                        id="tree-multituft"
                        onCheckedChange={(checked) =>
                          onLook({ multiTuft: checked })
                        }
                        size="sm"
                      />
                    </Field>
                  )}
                  {group === "rendering" && (
                    <>
                      <Field orientation="horizontal">
                        <FieldLabel
                          className="font-medium text-xs"
                          htmlFor="depth-of-field"
                        >
                          Tiefenschärfe
                        </FieldLabel>
                        <Switch
                          checked={look.dof}
                          id="depth-of-field"
                          onCheckedChange={(checked) =>
                            onLook({ dof: checked })
                          }
                          size="sm"
                        />
                      </Field>
                      <FocusControls
                        distance={look.focusDistanceM}
                        enabled={look.dof}
                        mode={look.focusMode}
                        onDistance={(m) => onLook({ focusDistanceM: m })}
                        onMode={(m) => onLook({ focusMode: m })}
                      />
                    </>
                  )}
                </LookGroupRow>
              ))}
            </div>
          </SceneTabPanel>

          <SceneTabPanel value="erweitert">
            <div className="flex flex-col gap-2 px-4 pt-1 pb-3.5">
              <span className={SECTION_LABEL}>Werkzeuge</span>
              <div className="flex flex-col gap-1.5">
                <ToolButton
                  hint="B"
                  icon={HousePlusIcon}
                  label="Gebäude einsetzen"
                  onClick={props.insertBuilding}
                />
                <ToolButton
                  hint="R"
                  icon={HammerIcon}
                  label="Gebäude unter dem Fadenkreuz abreißen"
                  onClick={() => handleRef.current?.demolishAtCrosshair()}
                />
                {!props.coarse && (
                  <ToolButton
                    hint="Esc beendet"
                    icon={FullscreenIcon}
                    label="Immersiver Modus"
                    onClick={() => handleRef.current?.enterImmersive()}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t px-4 pt-3 pb-3.5">
              <div className="flex items-center justify-between">
                <span className={SECTION_LABEL}>Snapshot</span>
                <span className="text-[11px] text-muted-foreground">
                  Position, Zeit &amp; Look als JSON
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button onClick={props.copySnapshot} size="sm" type="button">
                  <CopyIcon data-icon="inline-start" />
                  Kopieren
                </Button>
                <Button
                  onClick={props.applySnapshot}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ClipboardPasteIcon data-icon="inline-start" />
                  Anwenden
                </Button>
              </div>
              <Textarea
                className="font-mono text-[10px] leading-snug"
                id="snapshot"
                onChange={(e) => props.setSnapshotText(e.target.value)}
                placeholder="Snapshot-JSON hier einfügen und „Anwenden“ drücken."
                rows={5}
                spellCheck={false}
                value={props.snapshotText}
              />
              {props.snapshotMsg && (
                <span className="text-[11px] text-muted-foreground">
                  {props.snapshotMsg}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t px-4 pt-3 pb-3.5">
              <span className={SECTION_LABEL}>Statistik</span>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
                <span>Gebäude</span>
                <span className="font-mono tabular-nums">
                  {props.stats?.buildingCount.toLocaleString("de-DE") ?? "–"}
                </span>
                <span>Geländepunkte</span>
                <span className="font-mono tabular-nums">
                  {props.stats?.terrainVertexCount.toLocaleString("de-DE") ??
                    "–"}
                </span>
                <span>GPU-Speicher</span>
                <span className="font-mono tabular-nums">
                  {props.stats ? `≈ ${props.stats.gpuMegabytes} MB` : "–"}
                </span>
                <span>Bildrate</span>
                <span className="font-mono tabular-nums">
                  {props.fps === null ? "–" : `${Math.round(props.fps)} fps`}
                </span>
              </div>
            </div>
          </SceneTabPanel>
        </SceneTabs>
      </SidebarContent>

      <SidebarFooter className="border-t px-4 pt-2.5 pb-3 text-[10px] text-muted-foreground leading-snug">
        <p>
          Offene Geodaten Sachsen · Lampen, Mauern, Bahnsteige und Brücken ©
          OpenStreetMap-Mitwirkende (ODbL)
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
