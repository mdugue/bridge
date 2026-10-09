"use client";

import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  BoxIcon,
  Building2Icon,
  CalendarIcon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  CloudFogIcon,
  CoffeeIcon,
  CopyIcon,
  FootprintsIcon,
  FullscreenIcon,
  HammerIcon,
  ImageDownIcon,
  type LucideIcon,
  PlaneIcon,
  SparklesIcon,
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
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getTimes } from "suncalc";
import { Button } from "@/components/ui/button";
import { SUPPORT_URL } from "@/lib/brand";
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
import { type DataLayerKey, siteDataLayers } from "@/lib/city/data-layers";
import { STUDY_DATES, STUDY_HOURS } from "@/lib/city/image-export";
import type { Landmark } from "@/lib/city/landmarks";
import { sitePlaces } from "@/lib/city/places";
import type { FootprintPoly, MapTile } from "@/lib/city/minimap";
import {
  RENDER_STYLE_BY_ID,
  RENDER_STYLES,
  type RenderStyle,
} from "@/lib/city/render-style";
import type { PlayerPose } from "@/lib/city/pose";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { cn } from "cn";
import type { CityWalkHandle, CityWalkStats } from "./create-app";
import { DataLayersPanel } from "./data-layers-panel";
import { Minimap } from "./minimap";
import { PlacesList } from "./places-list";
import { hintsFor } from "./control-hints";
import { LegalLinks } from "./legal-links";
import type { ModelHud, ViewMode } from "./model-rig";
import { ProjectionPanel } from "./projection-panel";
import type { SoundscapeControl } from "./soundscape-toggle";
import { type SceneTabId, SceneTabPanel, SceneTabs } from "./scene-tabs";
import type { SunState } from "./sun-rig";
import {
  siteAttribution,
  siteCredit,
  type ViewpointGeometry,
} from "@/lib/city/site";
import { useSite } from "./site-context";

/**
 * The scene sidebar, structured by what you came to do rather than by which
 * uniform a slider writes to:
 *
 *  - **Erkunden** — where you are and where you can go: the minimap, the
 *    view mode (walk, fly, Modell — with Modell's *Projektion* right under
 *    it), the places (vantages and landmarks as one list, the first few
 *    shown), the data layers (traffic, bikes, trams), the keys (folded).
 *    Everything a first visit needs.
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
            ? "Scharf auf das, was in der Bildmitte liegt"
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

/**
 * The lens blur's switch and its focus. Not shown where the device builds
 * no lens blur (a phone, scene-profile.ts `PostProfile.dof`): the look
 * keeps its value, and a snapshot taken there still carries it.
 */
function DepthOfFieldControls({
  look,
  onLook,
}: {
  look: LookValues;
  onLook: (patch: Partial<LookValues>) => void;
}) {
  return (
    <>
      <Field orientation="horizontal">
        <FieldLabel className="font-medium text-xs" htmlFor="depth-of-field">
          Tiefenschärfe
        </FieldLabel>
        <Switch
          checked={look.dof}
          id="depth-of-field"
          onCheckedChange={(checked) => onLook({ dof: checked })}
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
  );
}

/**
 * The picture style: five swatch cards, exactly one pressed — the same
 * single-value ToggleGroup as walk/fly and the focus mode, so the keyboard
 * moves through it the same way.
 */
function StylePicker({
  onStyle,
  style,
}: {
  onStyle: (style: RenderStyle) => void;
  style: RenderStyle;
}) {
  return (
    <div className="flex flex-col gap-2 pb-2">
      <ToggleGroup
        aria-label="Bildstil"
        className="grid w-full grid-cols-3 gap-1.5"
        id="render-style"
        onValueChange={(value: string[]) => {
          const next = value[0] as RenderStyle | undefined;
          if (next) {
            onStyle(next);
          }
        }}
        size="sm"
        spacing={1}
        value={[style]}
        variant="outline"
      >
        {RENDER_STYLES.map((def) => (
          <ToggleGroupItem
            className="h-auto flex-col gap-1.5 rounded-lg p-1.5 pb-2 text-[11px] text-muted-foreground leading-none data-pressed:border-ring data-pressed:bg-background data-pressed:text-foreground data-pressed:ring-1 data-pressed:ring-ring"
            data-style={def.id}
            key={def.id}
            title={def.description}
            value={def.id}
          >
            <span
              aria-hidden
              className="h-7 w-full rounded-md ring-1 ring-black/10 ring-inset"
              style={{
                background: `linear-gradient(135deg, ${def.swatch[0]} 0 55%, ${def.swatch[1]} 55% 100%)`,
              }}
            />
            {def.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="text-[11px] text-muted-foreground leading-snug">
        {RENDER_STYLE_BY_ID[style].description}
        <span className="hidden [@media(pointer:fine)]:inline"> · Taste V</span>
      </span>
    </div>
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
  landcoverTiles: MapTile[];
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

/**
 * The key/action table — the full list the floating bar only shows the first
 * four of, folded away until asked for: the bar already teaches the first
 * steps. Touch devices get the gestures instead: a phone has no W A S D.
 */
function ControlTable({ coarse, model }: { coarse: boolean; model: boolean }) {
  return (
    <Collapsible className="border-t px-4 pt-1.5 pb-2">
      <CollapsibleTrigger
        aria-label="Steuerung — ein- und ausklappen"
        className="group/keys -mx-2 flex h-9 w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"
      >
        <span className={cn(SECTION_LABEL, "flex-1")}>Steuerung</span>
        <ChevronDownIcon className="size-3 opacity-35 transition-transform group-aria-expanded/keys:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* One key/action pair per row: two side by side ran out of the
            sidebar on desktop and the phone sheet alike. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 pt-1 pb-1.5 text-xs">
          {hintsFor(coarse, model).map((hint) => (
            <Fragment key={hint.key}>
              <span className="inline-flex h-5 min-w-5 items-center justify-center whitespace-nowrap rounded-sm border bg-muted px-1.5 font-medium text-[10px] text-muted-foreground leading-none">
                {hint.key}
              </span>
              <span className="text-pretty text-muted-foreground leading-tight">
                {hint.action}
              </span>
            </Fragment>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Walk, fly or Modell: one segmented control under the map, and Modell's
 * *Projektion* right beneath it while it is on — the mode and what it
 * offers stay together instead of ending up under the list of places.
 */
function ViewModeSwitch({
  disabled,
  mode,
  onMode,
}: {
  /** the scene is still loading: there is no camera to switch yet */
  disabled: boolean;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Ansicht"
      className="grid w-full grid-cols-3 gap-0.75 rounded-lg bg-muted p-0.75"
      disabled={disabled}
      onValueChange={(value: string[]) => {
        const next = value[0] as ViewMode | undefined;
        if (next) {
          onMode(next);
        }
      }}
      size="sm"
      value={[mode]}
    >
      <ToggleGroupItem className={MODE_ITEM} value="walk">
        <FootprintsIcon data-icon="inline-start" />
        Gehen
      </ToggleGroupItem>
      <ToggleGroupItem className={MODE_ITEM} value="fly">
        <PlaneIcon data-icon="inline-start" />
        Fliegen
      </ToggleGroupItem>
      <ToggleGroupItem
        className={MODE_ITEM}
        title="Die Stadt in Parallelprojektion, wie Städtebauer sie zeichnen (M)"
        value="model"
      >
        <BoxIcon data-icon="inline-start" />
        Modell
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

const MODE_ITEM =
  "h-7 text-muted-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm";

const STUDY_CHIP =
  "h-6 rounded-full px-2 font-mono text-[10px] tabular-nums text-muted-foreground data-pressed:border-ring data-pressed:bg-background data-pressed:text-foreground data-pressed:ring-1 data-pressed:ring-ring";

/**
 * The shadow study's instants (plan 055): the equinox and the solstices
 * of the shown year, and four hours — one click each, and the whole grid
 * as one sheet.
 */
function ShadowStudy({
  day,
  minutes,
  onStudy,
  ready,
  updateSun,
}: {
  day: Date;
  minutes: number;
  onStudy: () => void;
  /** the scene is up: there is a picture to save */
  ready: boolean;
  updateSun: (day: Date, minutes: number) => void;
}) {
  const dateKey = (d: { month: number; day: number }) => `${d.month}-${d.day}`;
  const today = STUDY_DATES.find(
    (d) => d.month === day.getMonth() && d.day === day.getDate()
  );
  return (
    <div className="flex flex-col gap-1.5" data-testid="shadow-study">
      <span className="font-medium text-xs">Verschattungsstudie</span>
      <ToggleGroup
        aria-label="Stichtag"
        className="grid w-full grid-cols-3 gap-1"
        onValueChange={(value: string[]) => {
          const d = STUDY_DATES.find((s) => dateKey(s) === value[0]);
          if (d) {
            updateSun(new Date(day.getFullYear(), d.month, d.day), minutes);
          }
        }}
        size="sm"
        spacing={1}
        value={today ? [dateKey(today)] : []}
        variant="outline"
      >
        {STUDY_DATES.map((d) => (
          <ToggleGroupItem
            className={STUDY_CHIP}
            key={dateKey(d)}
            title={d.label}
            value={dateKey(d)}
          >
            {`${d.day}.${d.month + 1}.`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        aria-label="Uhrzeit"
        className="grid w-full grid-cols-4 gap-1"
        onValueChange={(value: string[]) => {
          const hour = Number(value[0]);
          if (hour) {
            updateSun(day, hour * 60);
          }
        }}
        size="sm"
        spacing={1}
        value={minutes % 60 === 0 ? [String(minutes / 60)] : []}
        variant="outline"
      >
        {STUDY_HOURS.map((hour) => (
          <ToggleGroupItem
            className={STUDY_CHIP}
            key={hour}
            value={String(hour)}
          >
            {`${hour}:00`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <button
        className="flex min-h-8 items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5 text-left font-medium text-xs hover:border-ring disabled:pointer-events-none disabled:opacity-50"
        data-testid="export-study"
        disabled={!ready}
        onClick={onStudy}
        title="Dieselbe Ansicht um 9, 12, 15 und 18 Uhr am 21. März, 21. Juni und 21. Dezember — als ein Blatt"
        type="button"
      >
        <ImageDownIcon className="size-3.5 shrink-0 opacity-70" />
        <span className="flex-1 leading-snug">
          Als Blatt speichern (3 Tage × 4 Uhrzeiten)
        </span>
      </button>
    </div>
  );
}

/** Sun and time: the date, the minute, and where the sun stands because of it. */
function SunControls({
  day,
  latLng,
  minutes,
  onDefaultTime,
  onStudy,
  ready,
  sun,
  updateSun,
}: {
  day: Date;
  latLng: { lat: number; lng: number } | null;
  minutes: number;
  onDefaultTime: () => void;
  onStudy: () => void;
  ready: boolean;
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
        {/* Same affordance as Darstellung's reset, one section down. */}
        <button
          className="text-[11px] text-primary hover:underline"
          onClick={onDefaultTime}
          title="Zurück auf 14:00 — die Tageszeit, mit der die Szene startet und auf die ihr Licht abgestimmt ist"
          type="button"
        >
          Standardzeit
        </button>
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
      <span className="text-[11px] text-muted-foreground">
        {sun
          ? `Sonnenhöhe ${sun.altitudeDeg.toFixed(0)}°${sun.aboveHorizon ? "" : " · unter dem Horizont"}`
          : "Sonnenstand unbekannt"}
      </span>
      <ShadowStudy
        day={day}
        minutes={minutes}
        onStudy={onStudy}
        ready={ready}
        updateSun={updateSun}
      />
    </div>
  );
}

/** A tool row: icon, what it does, and the key that also does it. */
function ToolButton({
  disabled = false,
  hint,
  icon: Icon,
  label,
  onClick,
  onAim,
}: {
  disabled?: boolean;
  hint: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** told while the button is pointed at or focused, and when it no longer is */
  onAim?: (aiming: boolean) => void;
}) {
  // A panel that closes (the phone's sheet) unmounts the button without a
  // blur or a pointer leave.
  useEffect(() => () => onAim?.(false), [onAim]);
  return (
    <button
      className="flex min-h-8.5 items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5 text-left font-medium text-xs hover:border-ring disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      onBlur={() => onAim?.(false)}
      onClick={onClick}
      onFocus={() => onAim?.(true)}
      onPointerEnter={() => onAim?.(true)}
      onPointerLeave={() => onAim?.(false)}
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
  /**
   * The centre-aimed tool is pointed at or focused: the HUD marks the
   * middle it will act on, which no dot marks otherwise.
   */
  onAimCentre: (aiming: boolean) => void;
  /** what a data layer that is on says in words (the bike counts) */
  dataLayerDetail?: Partial<Record<DataLayerKey, ReactNode>>;
  day: Date;
  footprints: FootprintPoly[];
  fps: number | null;
  handleRef: RefObject<CityWalkHandle | null>;
  landcoverTiles: MapTile[];
  /** the site's landmarks (Wikidata), most notable first */
  landmarks: Landmark[];
  latLng: { lat: number; lng: number } | null;
  /**
   * Whether the scene has a lens blur — the budget it was built with
   * (scene-profile.ts `postProfileFor`), not the pointer as it is now: a
   * keyboard detached after the boot leaves the blur on, and its switch.
   */
  lensBlur: boolean;
  look: LookValues;
  minutes: number;
  mode: ViewMode;
  /** Modell's view while it is shown (plan 055) */
  modelView: ModelHud | null;
  onDefaultTime: () => void;
  /** Bild speichern: the picture with its legend (image-export.ts) */
  onExport: () => void;
  /** the Verschattungsstudie sheet (image-export.ts) */
  onStudy: () => void;
  onLook: (patch: Partial<LookValues>) => void;
  onTab: (tab: SceneTabId) => void;
  onTeleport: (epsgX: number, epsgY: number) => void;
  /** to a vantage (and its name): a glide, or while the scene loads,
   *  where it starts */
  onTravel: (view: ViewpointGeometry, label?: string) => void;
  /**
   * The scene can start (the browser has a GPU it draws with): without
   * one a place, or a snapshot, has nowhere to go.
   */
  canTravel: boolean;
  /**
   * The scene is up. Before that the panel is already open — places, the
   * map, the sun and the look can be chosen while the city loads — but
   * what needs a camera (Modell, the tools, the pictures) waits.
   */
  ready: boolean;
  rememberedView: ViewpointGeometry | null;
  resetLook: () => void;
  setRememberedView: (view: ViewpointGeometry | null) => void;
  setSnapshotText: Dispatch<SetStateAction<string>>;
  snapshotMsg: string | null;
  snapshotText: string;
  /** the hidden soundscape's switch (plan 035) */
  sound: SoundscapeControl;
  stats: CityWalkStats | null;
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
  sun: SunState | null;
  tab: SceneTabId;
  updateSun: (day: Date, minutes: number) => void;
}

export function SceneSidebar(props: SceneSidebarProps) {
  const { toggleSidebar } = useSidebar();
  const { handleRef, lensBlur, look, onLook } = props;
  const site = useSite();
  const places = useMemo(
    () => sitePlaces(site.viewpoints, props.landmarks, site.name),
    [site, props.landmarks]
  );
  return (
    <Sidebar
      className="p-3 [&>[data-slot=sidebar-inner]]:rounded-xl [&>[data-slot=sidebar-inner]]:shadow-xl"
      collapsible="offcanvas"
      side="right"
      variant="floating"
    >
      <SidebarHeader className="flex-row items-center justify-between gap-2 py-3 pr-2 pl-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-sm">{site.label}</span>
          <Link
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            href="/"
          >
            Andere Stadt wählen
          </Link>
        </div>
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
                  lensBlur && look.dof && look.focusMode === "manual"
                    ? look.focusDistanceM
                    : null
                }
                footprints={props.footprints}
                landcoverTiles={props.landcoverTiles}
                onTeleport={props.onTeleport}
                subscribePose={props.subscribePose}
              />
            )}
            <div className="px-3 pb-3.5">
              <ViewModeSwitch
                disabled={!props.ready}
                mode={props.mode}
                onMode={(next) => handleRef.current?.setViewMode(next)}
              />
            </div>
            {props.mode === "model" && props.modelView && (
              <ProjectionPanel
                onCutOut={(on) => handleRef.current?.setCutOut(on)}
                onExport={props.onExport}
                onPreset={(p) => handleRef.current?.setModelPreset(p)}
                onScale={(d) => handleRef.current?.setModelScale(d)}
                onShear={(k) => handleRef.current?.setModelShear(k)}
                onTilt={(deg) => handleRef.current?.setModelTilt(deg)}
                onTurnTo={(deg) => handleRef.current?.turnModelTo(deg)}
                view={props.modelView}
              />
            )}
            <PlacesList
              canRemember={props.ready}
              canTravel={props.canTravel}
              onForget={() => props.setRememberedView(null)}
              onRemember={() => {
                const here = handleRef.current?.captureViewpoint();
                if (here) {
                  props.setRememberedView(here);
                }
              }}
              onRestore={() => {
                if (props.rememberedView) {
                  props.onTravel(props.rememberedView);
                }
              }}
              onTravel={(place) => props.onTravel(place.view, place.label)}
              places={places}
              remembered={props.rememberedView !== null}
              showKeys={!props.coarse}
            />
            {siteDataLayers(site.dataLayers).length > 0 && (
              <div className="flex flex-col gap-2 border-t px-4 pt-3 pb-3.5">
                <span className={SECTION_LABEL}>Verkehrsdaten</span>
                <DataLayersPanel
                  detail={props.dataLayerDetail}
                  look={look}
                  onLook={onLook}
                  rows={siteDataLayers(site.dataLayers)}
                />
              </div>
            )}
            <ControlTable
              coarse={props.coarse}
              model={props.mode === "model"}
            />
          </SceneTabPanel>

          <SceneTabPanel value="szene">
            <SunControls
              day={props.day}
              onDefaultTime={props.onDefaultTime}
              onStudy={props.onStudy}
              latLng={props.latLng}
              minutes={props.minutes}
              ready={props.ready}
              sun={props.sun}
              updateSun={props.updateSun}
            />
            <div className="flex flex-col gap-0.5 border-t px-4 pt-3 pb-3.5">
              <div className="flex items-center justify-between pb-1.5">
                <span className={SECTION_LABEL}>Darstellung</span>
                <button
                  className="text-[11px] text-primary hover:underline"
                  onClick={props.resetLook}
                  title="Alle Regler zurück auf ihren Startwert — der Bildstil bleibt"
                  type="button"
                >
                  Zurücksetzen
                </button>
              </div>
              <StylePicker
                onStyle={(next) => onLook({ style: next })}
                style={look.style}
              />
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
                  {group === "rendering" && lensBlur && (
                    <DepthOfFieldControls look={look} onLook={onLook} />
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
                  disabled={!props.ready}
                  hint="R"
                  icon={HammerIcon}
                  label="Gebäude in der Bildmitte abreißen — mit R unter dem Mauszeiger"
                  onAim={props.onAimCentre}
                  onClick={() => handleRef.current?.demolishAtCrosshair()}
                />
                <ToolButton
                  disabled={!props.ready}
                  hint="PNG"
                  icon={ImageDownIcon}
                  label="Bild speichern — mit Quellen, im Modell mit Maßstab und Nordpfeil"
                  onClick={props.onExport}
                />
                {!props.coarse && (
                  <ToolButton
                    disabled={!props.ready}
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
                <Button
                  disabled={!props.ready}
                  onClick={props.copySnapshot}
                  size="sm"
                  type="button"
                >
                  <CopyIcon data-icon="inline-start" />
                  Kopieren
                </Button>
                <Button
                  disabled={!props.canTravel}
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

            {/* The one visible trace of the soundscape (plan 035), quiet and
                last: touch screens have no L key. */}
            <div className="border-t px-4 pt-2.5 pb-3">
              <Field orientation="horizontal">
                <FieldLabel
                  className="font-normal text-[11px] text-muted-foreground"
                  htmlFor="soundscape"
                >
                  Klang (experimentell)
                </FieldLabel>
                <Switch
                  checked={props.sound.on}
                  // (it starts once the city is up: before, a switch that
                  // stayed off would say nothing)
                  disabled={!(props.sound.on || props.sound.ready)}
                  id="soundscape"
                  onCheckedChange={props.sound.toggle}
                  size="sm"
                />
              </Field>
            </div>
          </SceneTabPanel>
        </SceneTabs>
      </SidebarContent>

      <SidebarFooter className="border-t px-4 pt-2 pb-3 text-[10px] text-muted-foreground leading-snug">
        <SourcesFooter />
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * The footer folds its licence lines away: they ran to six lines and took
 * that much from the tabs above. The short credit stays visible (every
 * licensor and licence named once), the full lines and the way to /wissen
 * open on demand, above the row so the trigger does not move.
 */
function SourcesFooter() {
  const site = useSite();
  return (
    <Collapsible>
      <CollapsibleContent>
        <ul className="flex flex-col gap-1 pb-2">
          {siteAttribution(site).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Link
          className="mb-2 inline-block underline underline-offset-2 hover:text-foreground"
          href="/wissen"
        >
          Wissen: Datenquellen und wie die Stadt entsteht
        </Link>
      </CollapsibleContent>
      <div className="flex items-center gap-3">
        <CollapsibleTrigger className="group/sources flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground">
          <span className="min-w-0 flex-1">
            {/* a licence id like "(dl-de/by-2-0)" breaks only before it */}
            {siteCredit(site)
              .split(/(\([^)]*\))/)
              .map((part, i) =>
                i % 2 === 1 ? (
                  <span className="whitespace-nowrap" key={part}>
                    {part}
                  </span>
                ) : (
                  part
                )
              )}
          </span>
          <span className="sr-only">Quellen und Lizenzen</span>
          <ChevronDownIcon
            aria-hidden
            className="size-3 shrink-0 rotate-180 opacity-50 transition-transform group-aria-expanded/sources:rotate-0"
          />
        </CollapsibleTrigger>
        {/* The one call to action in the footer, so it is a button, not a
            second muted link. A plain link to Ko-fi, not its widget:
            nothing loads from there until it is clicked. */}
        <Button
          nativeButton={false}
          render={
            <a
              aria-label="Unterstützen – auf Ko-fi, öffnet in neuem Tab"
              href={SUPPORT_URL}
              rel="noopener noreferrer"
              target="_blank"
              title="Auf Ko-fi unterstützen"
            />
          }
          size="sm"
          variant="outline"
        >
          <CoffeeIcon aria-hidden data-icon="inline-start" />
          Unterstützen
        </Button>
      </div>
      <LegalLinks className="pt-1.5" newTab />
    </Collapsible>
  );
}
