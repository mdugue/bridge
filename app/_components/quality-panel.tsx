"use client";

import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_SAFETY, type SafetyStanding } from "@/lib/city/gpu-safety";
import { currentSafetyStanding } from "./gpu-safety";
import {
  pixelRatioFor,
  type SceneBudget,
  shadowMapSizeFor,
  tileCacheBytesFor,
} from "./scene-profile";

const SECTION_LABEL =
  "font-semibold text-[11px] uppercase leading-none tracking-widest text-muted-foreground";

const MB = 1024 * 1024;

/** A tile cache's bound in words: "1,6 GB", "296 MB". */
function bytesLabel(bytes: number): string {
  return bytes >= 1024 * MB
    ? `${(bytes / (1024 * MB)).toLocaleString("de-DE", { maximumFractionDigits: 1 })} GB`
    : `${Math.round(bytes / MB)} MB`;
}

function levelLabel(level: number): string {
  return level === 0
    ? "Volle Qualität"
    : `Sparstufe ${level} von ${MAX_SAFETY}`;
}

/** "am Mi., 15. Okt. um 14:20" */
function whenLabel(ms: number): string {
  const at = new Date(ms);
  const day = at.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = at.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `am ${day} um ${time}`;
}

/** What the panel says under the numbers, by where the device stands. */
function standingNote({ fallsAt, level, next, pinned }: SafetyStanding) {
  if (pinned) {
    return `Für diese Seite in der Adresse festgelegt (?safety=${level}).`;
  }
  const lines: string[] = [
    level > 0
      ? "Die Grafik ist auf diesem Gerät zuletzt ausgefallen, darum zeichnet die Seite sparsamer."
      : "Fällt die Grafik aus, zeichnet die Seite auf diesem Gerät eine Stufe sparsamer weiter.",
  ];
  if (next !== level) {
    lines.push(`Beim nächsten Laden: ${levelLabel(next)}.`);
  }
  if (fallsAt !== null && next > 0) {
    const to = next === 1 ? "volle Qualität" : `Stufe ${next - 1}`;
    lines.push(`Sinkt ${whenLabel(fallsAt)} von selbst auf ${to}.`);
  }
  return lines.join(" ");
}

/**
 * The sidebar's *Qualität*: the safety level this page runs at
 * (lib/city/gpu-safety.ts: raised a level each time the graphics ran out
 * of memory, falling by one every three days), what that level means here
 * (the pixel ratio, the shadow map, the tile cache: scene-profile.ts) and
 * the way back to full detail. A level is the budget a page is built with,
 * so going back is a new page — `onReset` stores level 0 and, when this
 * page runs lighter, reloads where the player stands (city-walk.tsx); it
 * is false when the browser would not store it. A page whose address sets
 * the level (`?safety=N`) offers no reset: the address would win.
 */
export function QualityPanel({
  budget,
  onReset,
}: {
  budget: SceneBudget;
  onReset: () => boolean;
}) {
  // Read when the tab opens: another tab may have raised it meanwhile.
  const [standing, setStanding] = useState(() =>
    currentSafetyStanding(budget.safety)
  );
  const [state, setState] = useState<"idle" | "leaving" | "failed">("idle");
  const { level, next, pinned } = standing;
  const resettable = !pinned && (level > 0 || next > 0);
  const reset = () => {
    if (!onReset()) {
      setState("failed");
      return;
    }
    if (level > 0) {
      setState("leaving");
      return;
    }
    // Only the next page was lighter: nothing here to rebuild.
    setStanding(currentSafetyStanding(budget.safety));
  };
  const ratio = pixelRatioFor(
    budget.profile,
    budget.tier,
    window.devicePixelRatio,
    budget.safety
  );
  const shadow = shadowMapSizeFor(budget.profile, budget.tier, budget.safety);
  const cache = tileCacheBytesFor(budget.tier, budget.safety).max;
  const note = standingNote(standing);
  return (
    <section
      aria-label="Qualität"
      className="flex flex-col gap-2 border-t px-4 pt-3 pb-3.5"
    >
      <div className="flex items-center justify-between">
        <span className={SECTION_LABEL}>Qualität</span>
        {resettable && (
          <Button
            disabled={state === "leaving"}
            onClick={reset}
            size="xs"
            title="Lädt die Seite mit allen Details neu, dort, wo du gerade bist. Fällt die Grafik wieder aus, geht es wieder eine Stufe leichter weiter."
            type="button"
            variant="outline"
          >
            <RotateCcwIcon data-icon="inline-start" />
            Volle Qualität
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
        <span>Stufe</span>
        <span className="font-medium text-foreground" data-safety={level}>
          {levelLabel(level)}
        </span>
        <span>Gerät</span>
        <span>{budget.tier === "mobile" ? "Telefon/Tablet" : "Desktop"}</span>
        <span>Auflösung</span>
        <span className="font-mono tabular-nums">
          {ratio.toLocaleString("de-DE", { maximumFractionDigits: 2 })}×
        </span>
        <span>Schattenkarte</span>
        <span className="font-mono tabular-nums">{shadow}²</span>
        <span>Kachelspeicher</span>
        <span className="font-mono tabular-nums">bis {bytesLabel(cache)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{note}</p>
      {state === "leaving" && (
        <p className="text-[11px] text-muted-foreground">Lädt neu …</p>
      )}
      {state === "failed" && (
        <p className="text-[11px] text-destructive leading-snug">
          Der Browser lässt die Seite nichts speichern – die Stufe bleibt.
        </p>
      )}
    </section>
  );
}
