"use client";

import {
  CrosshairIcon,
  FileUpIcon,
  MountainIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { type DragEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type DesignPlacement,
  type DesignUnit,
  isDesignUnit,
  type PlacementSource,
} from "@/lib/city/design-placement";
import { cn } from "cn";
import type { DesignControls } from "./create-app";
import type { DesignStatus } from "./design-layer";
import { useSceneStatus } from "./scene-status";

const SECTION_LABEL =
  "font-semibold text-[11px] uppercase leading-none tracking-widest text-muted-foreground";

/** What the files a planner may pick end in: the glTF, a .gltf's
 *  resources, a placement file. */
const ACCEPT = [
  ".glb,.gltf,.bin,.ifc,.obj,.mtl,.3dm,.png,.jpg,.jpeg,.webp,.json",
  // landscape plans
  ".dxf,.shp,.shx,.dbf,.prj,.cpg,.gpkg,.xml,.landxml",
].join(",");

const SOURCE_TEXT: Record<PlacementSource, string> = {
  file: "Lage und Höhen aus der Datei (UTM, NHN).",
  "file-plan": "Lage aus der Datei, aufs Gelände gesetzt (Höhen relativ).",
  "placement-file": "Lage aus der Lagedatei.",
  here: "Die Datei nennt keine Lage: vor dir abgesetzt.",
  manual: "Von Hand platziert.",
};

const MB = 1024 * 1024;

/** The units the panel offers, as a planner says them. */
const UNITS: readonly [DesignUnit, string][] = [
  ["m", "m"],
  ["cm", "cm"],
  ["mm", "mm"],
  ["in", "Zoll"],
  ["ft", "Fuß"],
];

function sizeLabel([w, d, h]: [number, number, number]): string {
  const m = (v: number) =>
    v.toLocaleString("de-DE", { maximumFractionDigits: v < 10 ? 1 : 0 });
  return `${m(w)} × ${m(d)} m, ${m(h)} m hoch`;
}

function weightLabel(status: DesignStatus): string {
  const triangles = status.triangles.toLocaleString("de-DE");
  const mb = Math.max(1, Math.round(status.bytes / MB));
  return `${triangles} Dreiecke · ${mb} MB`;
}

/** A number typed in, taken on Enter or when the field is left. */
function NumberField({
  id,
  label,
  onCommit,
  step,
  unit,
  value,
}: {
  id: string;
  label: string;
  onCommit: (value: number) => void;
  step: number;
  unit: string;
  value: number;
}) {
  const shown = value.toFixed(step < 1 ? 2 : 0);
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    const v = Number((text ?? shown).replace(",", "."));
    if (text !== null && Number.isFinite(v)) {
      onCommit(v);
    }
    setText(null);
  };
  return (
    <Field className="gap-1">
      <FieldLabel className="font-medium text-[11px]" htmlFor={id}>
        {label} <span className="text-muted-foreground">({unit})</span>
      </FieldLabel>
      <Input
        className="font-mono tabular-nums"
        id={id}
        inputMode="decimal"
        onBlur={commit}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
          }
        }}
        step={step}
        value={text ?? shown}
      />
    </Field>
  );
}

/** Hands the placement file to the browser to save. */
function savePlacement(text: string, design: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${design.replace(/\.(glb|gltf)$/i, "")}.lage.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The sidebar's *Entwurf* (ADR 0054): a planner's glTF loaded into the
 * city on this device, where its coordinates put it or in front of the
 * player, then moved, turned, lifted, shown in white or its own colours,
 * with the buildings it replaces stepped aside. The placement can be kept
 * as a small file beside the design and loaded with it next time.
 */
export function DesignPanel({
  controls,
  ready,
}: {
  controls: () => DesignControls | null;
  ready: boolean;
}) {
  const status = useSceneStatus("design");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ids = useId();

  const take = async (files: File[]) => {
    const c = controls();
    if (!c || !ready || files.length === 0) {
      return;
    }
    setError(null);
    const onlyPlacement = files.every((f) => /\.json$/i.test(f.name));
    if (onlyPlacement && status) {
      setError(c.applyPlacementFile(await files[0].text()));
      return;
    }
    setBusy(true);
    try {
      await c.load(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const place = (patch: Partial<DesignPlacement>) =>
    controls()?.setPlacement(patch);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take([...e.dataTransfer.files]);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t px-4 pt-3 pb-3.5",
        over && "bg-accent/40"
      )}
      onDragLeave={() => setOver(false)}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDrop={onDrop}
    >
      <span className={SECTION_LABEL}>Entwurf</span>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Eigenen Entwurf als glTF (.glb), IFC, OBJ oder Rhino (.3dm) in die Stadt
        laden, auch hierher ziehen. Die Datei bleibt auf diesem Gerät.
      </p>
      <input
        accept={ACCEPT}
        className="hidden"
        multiple
        onChange={(e) => {
          void take([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
        ref={input}
        type="file"
      />
      <Button
        disabled={!ready || busy}
        onClick={() => input.current?.click()}
        size="sm"
        type="button"
        variant={status ? "outline" : "default"}
      >
        <FileUpIcon data-icon="inline-start" />
        {busy ? "Lädt …" : status ? "Andere Datei laden" : "Datei wählen"}
      </Button>
      {error && (
        <p className="text-[11px] text-destructive leading-snug" role="alert">
          {error}
        </p>
      )}
      {status && (
        <DesignControlsView
          controls={controls}
          ids={ids}
          place={place}
          status={status}
        />
      )}
    </div>
  );
}

function DesignControlsView({
  controls,
  ids,
  place,
  status,
}: {
  controls: () => DesignControls | null;
  ids: string;
  place: (patch: Partial<DesignPlacement>) => void;
  status: DesignStatus;
}) {
  const p = status.placement;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="truncate font-medium text-xs">{status.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {weightLabel(status)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {sizeLabel(status.size)}
        </span>
        <span className="text-[11px] text-muted-foreground leading-snug">
          {SOURCE_TEXT[status.source]}
        </span>
        {status.note && (
          <span className="text-[11px] text-muted-foreground leading-snug">
            {status.note}
          </span>
        )}
        {status.scaleHint && (
          <span className="text-[11px] text-amber-700 leading-snug dark:text-amber-400">
            {status.scaleHint}
          </span>
        )}
        {status.texturesDropped && (
          <span className="text-[11px] text-muted-foreground leading-snug">
            Die Texturen passen nicht ins Speicherbudget dieses Geräts und
            bleiben weg.
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          onClick={() => controls()?.placeHere()}
          size="sm"
          type="button"
          variant="outline"
        >
          <CrosshairIcon data-icon="inline-start" />
          Hierher holen
        </Button>
        <Button
          onClick={() => controls()?.setOnGround()}
          size="sm"
          type="button"
          variant="outline"
        >
          <MountainIcon data-icon="inline-start" />
          Aufs Gelände
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          id={`${ids}-east`}
          label="Ost"
          onCommit={(east) => place({ east })}
          step={0.5}
          unit="m"
          value={p.east}
        />
        <NumberField
          id={`${ids}-north`}
          label="Nord"
          onCommit={(north) => place({ north })}
          step={0.5}
          unit="m"
          value={p.north}
        />
        <NumberField
          id={`${ids}-base`}
          label="Höhe"
          onCommit={(base) => place({ base })}
          step={0.1}
          unit="m NHN"
          value={p.base}
        />
        <NumberField
          id={`${ids}-rotation`}
          label="Drehung"
          onCommit={(rotation) => place({ rotation })}
          step={1}
          unit="°"
          value={p.rotation}
        />
      </div>
      <ScaleControls controls={controls} ids={ids} status={status} />
      <Slider
        aria-label="Drehung"
        max={180}
        min={-180}
        onValueChange={(value) =>
          place({ rotation: Number(Array.isArray(value) ? value[0] : value) })
        }
        step={1}
        value={[p.rotation]}
      />
      <Field orientation="horizontal">
        <FieldLabel className="font-medium text-xs" htmlFor={`${ids}-replace`}>
          Bestand im Umriss ausblenden
          {status.replaceExisting && status.hidden > 0 && (
            <span className="text-muted-foreground"> ({status.hidden})</span>
          )}
        </FieldLabel>
        <Switch
          checked={status.replaceExisting}
          id={`${ids}-replace`}
          onCheckedChange={(on) => controls()?.setReplaceExisting(on)}
          size="sm"
        />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel className="font-medium text-xs" htmlFor={`${ids}-colours`}>
          Farben der Datei
        </FieldLabel>
        <Switch
          checked={status.fileColours}
          disabled={!status.hasLooks}
          id={`${ids}-colours`}
          onCheckedChange={(on) => void controls()?.setFileColours(on)}
          size="sm"
        />
      </Field>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          onClick={() => {
            const text = controls()?.placementText();
            if (text) {
              savePlacement(text, status.name);
            }
          }}
          size="sm"
          title="Die Lage als kleine Datei sichern: beim nächsten Mal mit dem Entwurf zusammen laden"
          type="button"
          variant="outline"
        >
          <SaveIcon data-icon="inline-start" />
          Lage sichern
        </Button>
        <Button
          onClick={() => controls()?.remove()}
          size="sm"
          type="button"
          variant="outline"
        >
          <Trash2Icon data-icon="inline-start" />
          Entfernen
        </Button>
      </div>
    </div>
  );
}

/**
 * The unit the file is read in and a factor on it: OBJ has no unit, and
 * many exports come in centimetres or millimetres; a model at 1:100 or a
 * game asset takes a factor. It scales about the design's foot.
 */
function ScaleControls({
  controls,
  ids,
  status,
}: {
  controls: () => DesignControls | null;
  ids: string;
  status: DesignStatus;
}) {
  const { scale } = status;
  return (
    <div className="flex flex-col gap-1">
      <span
        className="font-medium text-[11px]"
        id={`${ids}-unit`}
        title="Die Einheit, in der die Datei gezeichnet ist"
      >
        Maßstab{" "}
        <span className="text-muted-foreground">(Einheit der Datei)</span>
      </span>
      <ToggleGroup
        aria-labelledby={`${ids}-unit`}
        onValueChange={(value: string[]) => {
          const [unit] = value;
          if (isDesignUnit(unit)) {
            controls()?.setScale({ ...scale, unit });
          }
        }}
        size="sm"
        spacing={1}
        value={[scale.unit]}
        variant="outline"
      >
        {UNITS.map(([unit, label]) => (
          <ToggleGroupItem
            className="px-2 data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
            key={unit}
            value={unit}
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <NumberField
        id={`${ids}-factor`}
        label="Faktor"
        onCommit={(factor) => controls()?.setScale({ ...scale, factor })}
        step={0.01}
        unit="×"
        value={scale.factor}
      />
    </div>
  );
}
