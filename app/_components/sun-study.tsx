"use client";

/**
 * The sun study's card (plan 054 phase 2, the spike behind `?studie=`):
 * its recipe as chips (season, hours, playgrounds or benches, a circle),
 * the places ranked by their share of shade, and how it was computed.
 * It loads its inputs (sun-study-data.ts), ranks the places in slices
 * between frames (lib/city/sun-study.ts), hands the result to the scene's
 * hatch (study-marks.ts) and writes the recipe into the link. Its own
 * chunk: a visitor without `?studie=` loads none of it.
 */
import { SunIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { giveBack } from "@/lib/city/build-steps";
import { utmToLatLng } from "@/lib/city/crs";
import type { Site } from "@/lib/city/site";
import type { StudyMark } from "./study-marks-geometry";
import {
  DEFAULT_RECIPE,
  parseRecipe,
  PERIODS,
  recipeText,
  recipeTitle,
  placeView,
  shadePlace,
  SUBJECTS,
  sunSamples,
} from "@/lib/city/sun-study";
import type {
  PeriodId,
  PlaceShade,
  SubjectId,
  SunStudyRecipe,
  HorizonRaster,
} from "@/lib/city/sun-study";
import type { AskScene } from "./ask-scene-tools";
import { isAbortError } from "./fetch-optional";
import { loadStudyInputs } from "./sun-study-data";
import type { NamedPlace } from "./sun-study-data";

/**
 * The sun study's card (plan 054 phase 2, the spike of 2026-11-03), open
 * with `?studie=1` or a recipe (`?studie=sommer_11-17_spielplatz_1000m_…`):
 * the question, its recipe as chips, the places ranked by their share of
 * shade with its spread, the method and what it cost. A row glides there
 * at the period's middle day and hour; the places lie hatched in the scene
 * (study-marks.ts). The recipe stays in the link; nothing is stored.
 */

interface Props {
  coarse: boolean;
  site: Site;
  scene: AskScene;
  /** the scene's hatch, null before the scene */
  marks: () => {
    show: (marks: readonly StudyMark[]) => Promise<void>;
    clear: () => void;
  } | null;
  initial: SunStudyRecipe;
  onClose: () => void;
}

type Ranked = PlaceShade & { label: string; rings: NamedPlace["rings"] };

interface Done {
  places: Ranked[];
  samples: number;
  points: number;
  tiles: number;
  crowns: number;
  loadMs: number;
  computeMs: number;
  bytes: number;
}

type Status =
  | { phase: "waiting" }
  | { phase: "loading" }
  | { phase: "computing"; done: number; total: number }
  | { phase: "done"; result: Done }
  | { phase: "failed"; message: string };

const HOURS: [number, number, string][] = [
  [8, 11, "8–11"],
  [11, 17, "11–17"],
  [17, 20, "17–20"],
  [6, 21, "6–21"],
];
const RADII = [500, 1000, 2000];
/** The day the scene shows a place on, per period (month, day). */
const MIDDLE: Record<PeriodId, [number, number]> = {
  fruehling: [4, 15],
  sommer: [7, 15],
  herbst: [10, 15],
  jahr: [6, 21],
};

/** A number as two digits ("09"). */
const two = (n: number) => String(n).padStart(2, "0");

/** The link with this recipe in `?studie=`, or without it. */
function writeRecipe(recipe: SunStudyRecipe | null): void {
  const url = new URL(window.location.href);
  if (recipe) {
    url.searchParams.set("studie", recipeText(recipe));
  } else {
    url.searchParams.delete("studie");
  }
  window.history.replaceState(window.history.state, "", url);
}

/** Ranks every place, a few milliseconds at a time. */
async function rank(
  site: Site,
  recipe: SunStudyRecipe & { x: number; y: number },
  signal: AbortSignal,
  onStatus: (s: Status) => void
): Promise<Done> {
  const t0 = performance.now();
  const inputs = await loadStudyInputs(site, recipe, recipe, signal);
  const t1 = performance.now();
  const latLng =
    utmToLatLng(site.provider.epsg, recipe.x, recipe.y) ?? site.fallbackLatLng;
  const study = sunSamples(
    recipe,
    latLng.lat,
    latLng.lng,
    new Date().getFullYear()
  );
  const horizonAt = (x: number, y: number): HorizonRaster | null =>
    inputs.horizon.find(
      (r) =>
        x >= r.minX && x < r.minX + r.size && y <= r.maxY && y > r.maxY - r.size
    ) ?? null;
  const places: Ranked[] = [];
  let slice = performance.now();
  let computeMs = 0;
  for (const place of inputs.places) {
    signal.throwIfAborted();
    const started = performance.now();
    const shade = shadePlace(
      place,
      study.samples,
      study,
      horizonAt,
      inputs.crowns
    );
    computeMs += performance.now() - started;
    places.push({ ...shade, label: place.label, rings: place.rings });
    if (performance.now() - slice > 8) {
      onStatus({
        phase: "computing",
        done: places.length,
        total: inputs.places.length,
      });
      await giveBack();
      slice = performance.now();
    }
  }
  places.sort((a, b) => b.shade - a.shade);
  return {
    places,
    samples: study.samples.length,
    points: places.reduce((s, p) => s + p.points, 0),
    tiles: inputs.tiles,
    crowns: inputs.crowns.length,
    loadMs: t1 - t0,
    computeMs,
    bytes: inputs.bytes,
  };
}

/** The recipe centred where the camera stands, when it names no centre. */
function centred(recipe: SunStudyRecipe, scene: AskScene): SunStudyRecipe {
  if (recipe.x !== undefined && recipe.y !== undefined) {
    return recipe;
  }
  const here = scene.from();
  return here
    ? { ...recipe, x: Math.round(here.x), y: Math.round(here.y) }
    : recipe;
}

/** Retry for a centre while the camera is not there yet (ms). */
const CENTRE_RETRY_MS = 1000;

/** Runs the study whenever its recipe changes; its status. Only the
 *  recipe's text starts a run: the scene's object changes with the hour
 *  and the look (useAskScene), and a pick sets the hour. */
function useStudy(
  recipe: SunStudyRecipe,
  site: Site,
  scene: AskScene,
  setRecipe: (r: SunStudyRecipe) => void
): Status {
  // what the last run said, for the recipe it ran
  const [outcome, setOutcome] = useState<{
    key: string;
    status: Status;
  } | null>(null);
  const sceneRef = useRef(scene);
  useEffect(() => {
    sceneRef.current = scene;
  });
  const key = recipeText(recipe);
  useEffect(() => {
    const ran = parseRecipe(key) ?? DEFAULT_RECIPE;
    const { x, y } = ran;
    if (x === undefined || y === undefined) {
      // no camera yet: ask the scene until it has one
      const timer = setInterval(() => {
        const next = centred(ran, sceneRef.current);
        if (next !== ran) {
          setRecipe(next);
        }
      }, CENTRE_RETRY_MS);
      return () => clearInterval(timer);
    }
    writeRecipe(ran);
    const abort = new AbortController();
    const report = (status: Status) => setOutcome({ key, status });
    const run = async () => {
      try {
        const result = await rank(site, { ...ran, x, y }, abort.signal, report);
        report({ phase: "done", result });
      } catch (error) {
        if (!isAbortError(error) && !abort.signal.aborted) {
          report({
            phase: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    void run();
    return () => abort.abort();
  }, [key, setRecipe, site]);
  if (outcome?.key === key) {
    return outcome.status;
  }
  return recipe.x === undefined ? { phase: "waiting" } : { phase: "loading" };
}

const Chips = <T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <span className="w-14 text-[11px] text-muted-foreground">{label}</span>
    <ToggleGroup
      aria-label={label}
      onValueChange={(v: string[]) => {
        const hit = options.find(([o]) => String(o) === v[0]);
        if (hit) {
          onChange(hit[0]);
        }
      }}
      size="sm"
      spacing={1}
      value={[String(value)]}
      variant="outline"
    >
      {options.map(([o, text]) => (
        <ToggleGroupItem
          className="px-2 text-[12px] data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
          key={String(o)}
          value={String(o)}
        >
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  </div>
);

const RecipeChips = ({
  recipe,
  onChange,
  onHere,
}: {
  recipe: SunStudyRecipe;
  onChange: (r: SunStudyRecipe) => void;
  onHere: () => void;
}) => {
  const hours = HOURS.find(([f, t]) => f === recipe.from && t === recipe.to);
  return (
    <div className="flex flex-col gap-1.5 px-4 pb-2">
      <Chips
        label="Zeitraum"
        onChange={(period) => onChange({ ...recipe, period })}
        options={Object.entries(PERIODS).map(
          ([id, p]) =>
            [id as PeriodId, id === "jahr" ? "Jahr" : p.label] as [
              PeriodId,
              string,
            ]
        )}
        value={recipe.period}
      />
      <Chips
        label="Uhrzeit"
        onChange={(h) => {
          const [from, to] = h.split("-").map(Number);
          onChange({ ...recipe, from, to });
        }}
        options={HOURS.map(
          ([f, t, text]) => [`${f}-${t}`, text] as [string, string]
        )}
        value={
          hours ? `${hours[0]}-${hours[1]}` : `${recipe.from}-${recipe.to}`
        }
      />
      <Chips
        label="Was"
        onChange={(what) => onChange({ ...recipe, what })}
        options={Object.entries(SUBJECTS).map(
          ([id, s]) => [id as SubjectId, s.many] as [SubjectId, string]
        )}
        value={recipe.what}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Chips
          label="Umkreis"
          onChange={(radius) => onChange({ ...recipe, radius })}
          options={RADII.map(
            (r) =>
              [r, r < 1000 ? `${r} m` : `${r / 1000} km`] as [number, string]
          )}
          value={recipe.radius}
        />
        <button
          className="rounded-md px-2 py-1 text-[12px] text-primary underline-offset-2 hover:underline"
          data-testid="study-here"
          onClick={onHere}
          type="button"
        >
          hier rechnen
        </button>
      </div>
    </div>
  );
};

const pct = (v: number) => `${Math.round(v * 100)} %`;

const Ranking = ({
  places,
  onPick,
}: {
  places: Ranked[];
  onPick: (p: Ranked) => void;
}) => {
  if (places.length === 0) {
    return (
      <p className="px-4 py-3 text-[13px] text-muted-foreground">
        Im Umkreis liegt nichts davon. Ein größerer Umkreis oder ein anderer
        Ort?
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-0.5 px-2" data-testid="study-ranking">
      {places.map((p, i) => (
        <li key={p.id}>
          <button
            className="grid w-full grid-cols-[1.5rem_1fr_5.5rem] items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => onPick(p)}
            title={`${p.points} Punkte · ${p.sunHours.toFixed(1)} h direkte Sonne am Tag`}
            type="button"
          >
            <span className="text-[12px] font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px]">{p.label}</span>
              <span className="block text-[11px] text-muted-foreground tabular-nums">
                {pct(p.shade)} Schatten ({pct(p.low)}–{pct(p.high)})
                {p.area > 0 ? ` · ${Math.round(p.area)} m²` : ""}
              </span>
            </span>
            <span className="h-2.5 rounded-sm border border-foreground/60 bg-background">
              <span
                className="block h-full rounded-sm bg-[repeating-linear-gradient(135deg,#3f4fb8_0_2px,transparent_2px_5px)]"
                style={{ width: `${Math.round(p.shade * 100)}%` }}
              />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
};

const Method = ({
  recipe,
  result,
}: {
  recipe: SunStudyRecipe;
  result: Done | null;
}) => {
  const p = PERIODS[recipe.period];
  return (
    <footer className="flex flex-col gap-1 border-t px-4 pt-2 pb-3 text-[11px] leading-snug text-muted-foreground">
      <p>
        Anteil der Zeit zwischen {recipe.from} und {recipe.to} Uhr, in der die
        Sonne scheint und der Ort im Schatten liegt; {p.span}, ein Tag pro
        Woche, alle 20 Minuten, auf Kinderaugenhöhe. In Klammern die Spanne über
        den Ort. Gebäude und Gelände aus dem gebackenen Horizont (8 m), Bäume
        als Kronen aus Baumkataster und Laserscan, im Laub 15 % Licht
        durchlassend. Nicht drin: Sonnensegel, Spielgeräte, Mauern näher als 8
        m.
      </p>
      {result && (
        <p className="tabular-nums" data-testid="study-cost">
          {result.places.length} Orte · {result.points} Punkte ·{" "}
          {result.samples} Sonnenstände · {result.crowns} Kronen aus{" "}
          {result.tiles} Kacheln · geladen in{" "}
          {(result.loadMs / 1000).toFixed(1)} s, gerechnet in{" "}
          {(result.computeMs / 1000).toFixed(2)} s · beim Rechnen gehalten etwa{" "}
          {Math.round(result.bytes / 1e6)} MB, danach nur die Ergebnisse
        </p>
      )}
    </footer>
  );
};

/** What the card says while it has no ranking, or null. */
function statusText(status: Status): string | null {
  if (status.phase === "waiting") {
    return "Warte auf die Szene …";
  }
  if (status.phase === "loading") {
    return "Lade Horizont, Bäume und Orte …";
  }
  if (status.phase === "computing") {
    return `Rechne … ${status.done} von ${status.total}`;
  }
  if (status.phase === "failed") {
    return `Das ging schief: ${status.message}`;
  }
  return null;
}

const StatusLine = ({ status }: { status: Status }) => {
  const text = statusText(status);
  return text ? (
    <p
      className="px-4 py-3 text-[13px] text-muted-foreground"
      data-testid="study-status"
    >
      {text}
    </p>
  ) : null;
};

const SunStudyCard = ({
  coarse,
  site,
  scene,
  marks,
  initial,
  onClose,
}: Props) => {
  const [recipe, setRecipe] = useState(() => centred(initial, scene));
  const status = useStudy(recipe, site, scene, setRecipe);
  const result = status.phase === "done" ? status.result : null;
  // the hatch shows this result only: none while another loads or failed
  useEffect(() => {
    if (!result) {
      marks()?.clear();
      return;
    }
    void marks()?.show(
      result.places.map((p) => ({
        rings: p.rings,
        x: p.x,
        y: p.y,
        shade: p.shade,
      }))
    );
  }, [marks, result]);
  useEffect(() => () => marks()?.clear(), [marks]);
  const change = (next: SunStudyRecipe) => setRecipe(next);
  const here = () => {
    const at = scene.from();
    if (at) {
      setRecipe({ ...recipe, x: Math.round(at.x), y: Math.round(at.y) });
    }
  };
  const pick = (p: Ranked) => {
    const [month, day] = MIDDLE[recipe.period];
    const year = new Date().getFullYear();
    // the window's middle, on the period's middle day
    const mid = ((recipe.from + recipe.to) / 2) * 60;
    scene.setTime({
      datum: `${year}-${two(month)}-${two(day)}`,
      uhrzeit: `${two(Math.floor(mid / 60))}:${two(mid % 60)}`,
    });
    scene.show(placeView(p, scene.from()));
  };
  return (
    <section
      aria-label="Sonnenstudie"
      className={cn(
        "pointer-events-auto absolute z-30 flex flex-col rounded-xl bg-background/95 shadow-xl backdrop-blur-lg",
        coarse
          ? "right-3 bottom-3 left-3 max-h-[55dvh]"
          : "bottom-6 left-4 max-h-[calc(100%-3rem)] w-[min(26rem,calc(100%-2rem))]"
      )}
      data-testid="study-card"
    >
      <header className="flex items-start gap-2 px-4 pt-3 pb-2">
        <SunIcon className="mt-0.5 size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium tracking-[0.14em] text-primary uppercase">
            Studie · Versuch
          </p>
          <h2 className="font-heading text-base leading-tight">
            {recipeTitle(recipe)}
          </h2>
        </div>
        <button
          aria-label="Studie schließen"
          className="-mr-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => {
            writeRecipe(null);
            onClose();
          }}
          title="Schließen"
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </header>
      <RecipeChips onChange={change} onHere={here} recipe={recipe} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StatusLine status={status} />
        {result && <Ranking onPick={pick} places={result.places} />}
      </div>
      <Method recipe={recipe} result={result} />
    </section>
  );
};

export default SunStudyCard;
