"use client";

import { ImageDownIcon } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MIN_FREE_TILT,
  MODEL_PRESET_BY_ID,
  MODEL_PRESETS,
  MODEL_SCALES,
  type ModelPresetId,
  presetGlyph,
  scaleLabel,
} from "@/lib/city/model-view";
import { cn } from "cn";
import type { ModelHud } from "./model-rig";

/** A step of the series is "the" scale within this share of it. */
const ON_STEP = 0.02;

/** The Militärperspektive's heights: true, or shortened to two thirds. */
const SHEARS = [
  { k: 1, label: "Höhen × 1" },
  { k: 2 / 3, label: "Höhen × ⅔" },
] as const;

/** Its two classic turns: 30°/60° and 45°/45° to the sheet's edges. */
const MILITARY_TURNS = [
  { deg: 30, label: "30° / 60°" },
  { deg: 45, label: "45° / 45°" },
] as const;

const SECTION_LABEL =
  "font-semibold text-[11px] uppercase leading-none tracking-widest text-muted-foreground";

const CHIP =
  "h-6 rounded-full px-2 font-mono text-[10px] tabular-nums text-muted-foreground data-pressed:border-ring data-pressed:bg-background data-pressed:text-foreground data-pressed:ring-1 data-pressed:ring-ring";

/** A card's glyph: a cube as the view draws it (lib/city/model-view.ts). */
function PresetGlyph({ id }: { id: ModelPresetId }) {
  const lines = presetGlyph(id);
  return (
    <svg
      aria-hidden
      className="size-7 overflow-visible"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={0.09}
      viewBox="-1.15 -1.15 2.3 2.3"
    >
      {id === "section" && (
        <rect
          fill="currentColor"
          height={2}
          opacity={0.85}
          width={1}
          x={-1}
          y={-1}
        />
      )}
      {lines.map(([x1, y1, x2, y2], i) => (
        <line
          // the twelve edges are fixed and never reorder
          key={i}
          x1={x1}
          x2={x2}
          y1={y1}
          y2={y2}
        />
      ))}
    </svg>
  );
}

/** What a view's lengths mean, under the cards. */
function presetNote(view: ModelHud): string {
  switch (view.preset) {
    case "iso":
      return "Längen entlang der drei Achsen × 0,816 — die Maßstabsleiste misst parallel zum Bild";
    case "bird":
      return "Die Maßstabsleiste misst parallel zum Bild, waagerecht";
    case "military":
      return "Der Grundriss ist unverzerrt; Höhen stehen senkrecht darüber";
    case "plan":
      return "Senkrecht von oben: jede Länge im Plan im Maßstab";
    case "elevation":
      return "Was vor der Bildmitte steht, ist weggeschnitten";
    case "section":
      return "Schnitt durch die Bildmitte: Schnittflächen gefüllt, das Gelände als Profil";
    default:
      return "";
  }
}

/** The line under the Ausschnitt's switch. */
function cutOutHint(view: ModelHud): string {
  if (view.cutOutPending) {
    return "Wird vorbereitet …";
  }
  if (view.cutOutFailed) {
    return "Der Ausschnitt ließ sich nicht vorbereiten";
  }
  return "Nur die Bildmitte, wie aus der Stadt geschnitten";
}

/**
 * Modell's *Projektion* section (plan 055): the views as cards, each with
 * the cube it draws; the scale as a readout and the series to step to; the
 * Vogelschau's tilt and the Militärperspektive's heights and turns. The
 * scale is "bei 96 dpi", the CSS pixel; the export (Bild speichern) prints
 * its own at 300 dpi.
 */
export function ProjectionPanel({
  onCutOut,
  onExport,
  onPreset,
  onScale,
  onShear,
  onTilt,
  onTurnTo,
  view,
}: {
  onCutOut: (on: boolean) => void;
  onExport: () => void;
  onPreset: (preset: ModelPresetId) => void;
  onScale: (denominator: number) => void;
  onShear: (k: number) => void;
  onTilt: (deg: number) => void;
  onTurnTo: (deg: number) => void;
  view: ModelHud;
}) {
  const onStep = MODEL_SCALES.find(
    (s) => Math.abs(view.scale - s) / s < ON_STEP
  );
  const militaryTurn = MILITARY_TURNS.find(
    (t) => Math.abs((((view.turnDeg - t.deg) % 90) + 90) % 90) < 1
  );
  return (
    <div
      className="flex flex-col gap-2.5 border-t px-4 pt-3 pb-3.5"
      data-testid="projection-panel"
    >
      <div className="flex items-center justify-between">
        <span className={SECTION_LABEL}>Projektion</span>
        <span
          className="font-medium font-mono text-xs tabular-nums"
          data-testid="model-scale"
          title="Der Maßstab bei 96 dpi (ein CSS-Pixel = 0,26 mm)"
        >
          {scaleLabel(view.scale)}
        </span>
      </div>
      <ToggleGroup
        aria-label="Projektion"
        className="grid w-full grid-cols-3 gap-1.5"
        onValueChange={(value: string[]) => {
          const next = value[0] as ModelPresetId | undefined;
          if (next) {
            onPreset(next);
          }
        }}
        size="sm"
        spacing={1}
        value={[view.preset]}
        variant="outline"
      >
        {MODEL_PRESETS.map((preset) => (
          <ToggleGroupItem
            className="h-auto flex-col gap-1.5 rounded-lg p-1.5 pt-2 pb-2 text-[11px] text-muted-foreground leading-none data-pressed:border-ring data-pressed:bg-background data-pressed:text-foreground data-pressed:ring-1 data-pressed:ring-ring"
            data-preset={preset.id}
            key={preset.id}
            title={preset.description}
            value={preset.id}
          >
            <PresetGlyph id={preset.id} />
            {preset.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="text-[11px] text-muted-foreground leading-snug">
        {presetNote(view)}
      </span>
      {MODEL_PRESET_BY_ID[view.preset].freeTilt && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs">
            <span className="font-medium">Neigung</span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {Math.round(view.tiltDeg)}°
            </span>
          </div>
          <Slider
            aria-label="Neigung"
            max={90}
            min={MIN_FREE_TILT}
            onValueChange={(value) =>
              onTilt(Number(Array.isArray(value) ? value[0] : value))
            }
            step={1}
            value={[view.tiltDeg]}
          />
        </div>
      )}
      {view.preset === "military" && (
        <div className="flex flex-col gap-1.5">
          <ToggleGroup
            aria-label="Höhen"
            className="grid w-full grid-cols-2 gap-1"
            onValueChange={(value: string[]) => {
              const k = Number(value[0]);
              if (k) {
                onShear(k);
              }
            }}
            size="sm"
            spacing={1}
            value={[
              String(
                SHEARS.find((s) => Math.abs(s.k - view.shear) < 0.01)?.k ?? ""
              ),
            ]}
            variant="outline"
          >
            {SHEARS.map((s) => (
              <ToggleGroupItem
                className={CHIP}
                key={s.label}
                value={String(s.k)}
              >
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            aria-label="Winkel zur Blattkante"
            className="grid w-full grid-cols-2 gap-1"
            onValueChange={(value: string[]) => {
              const deg = Number(value[0]);
              if (deg) {
                // the nearest turn of that kind, so the city does not spin
                const base = Math.floor(view.turnDeg / 90) * 90;
                onTurnTo(base + deg);
              }
            }}
            size="sm"
            spacing={1}
            value={militaryTurn ? [String(militaryTurn.deg)] : []}
            variant="outline"
          >
            {MILITARY_TURNS.map((t) => (
              <ToggleGroupItem
                className={CHIP}
                key={t.deg}
                value={String(t.deg)}
              >
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <ToggleGroup
          aria-label="Maßstab"
          className="flex flex-wrap gap-1"
          onValueChange={(value: string[]) => {
            const next = Number(value[0]);
            if (next) {
              onScale(next);
            }
          }}
          size="sm"
          spacing={1}
          value={onStep ? [String(onStep)] : []}
          variant="outline"
        >
          {MODEL_SCALES.map((s) => (
            <ToggleGroupItem
              className={cn(CHIP, "flex-1")}
              data-scale={s}
              key={s}
              value={String(s)}
            >
              {scaleLabel(s).replace(" : ", ":")}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-[10px] text-muted-foreground leading-snug">
          bei 96 dpi · dazwischen frei mit dem Rad
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <Field orientation="horizontal">
          <FieldLabel className="font-medium text-xs" htmlFor="model-cut-out">
            Ausschnitt mit Sockel
          </FieldLabel>
          <Switch
            checked={view.cutOut}
            id="model-cut-out"
            onCheckedChange={onCutOut}
            size="sm"
          />
        </Field>
        <span className="text-[10px] text-muted-foreground leading-snug">
          {cutOutHint(view)}
          {(view.cutOutFailed || (view.cutOut && !view.cutOutPending)) && (
            <>
              {" · "}
              <button
                className="text-primary hover:underline"
                onClick={() => onCutOut(true)}
                type="button"
              >
                {view.cutOutFailed ? "noch einmal versuchen" : "neu setzen"}
              </button>
            </>
          )}
        </span>
      </div>
      <button
        className="flex min-h-8.5 items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5 text-left font-medium text-xs hover:border-ring"
        data-testid="export-image"
        onClick={onExport}
        type="button"
      >
        <ImageDownIcon className="size-3.5 shrink-0 opacity-70" />
        <span className="flex-1 leading-snug">
          Bild speichern — mit Maßstab, Nordpfeil und Quellen
        </span>
      </button>
    </div>
  );
}
