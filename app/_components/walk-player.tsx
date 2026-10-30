"use client";

import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  FootprintsIcon,
  MessageCircleQuestionIcon,
  RouteIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react";
import { Newsreader } from "next/font/google";
import { useEffect, useState } from "react";
import {
  isWalkBundle,
  stopNotes,
  type Walk,
  type WalkFact,
  type WalkStop,
} from "@/lib/city/walks";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "cn";
import { useSpeech } from "./ask-voice";
import { useSceneStatus } from "./scene-status";

/**
 * Erzählte Spaziergänge in the viewer (lib/city/walks.ts, ADR 0055): the
 * Erkunden panel's list, and the card that tells a stop while the scene
 * shows it. The narration is Claude's and says so on every stop; each
 * claim it rests on links its source.
 */

/** The walk's book face: a told story reads as print, not as a HUD. Not
 *  preloaded: the file comes with the first walk card, not with the page
 *  (self-hosted by the build, no request to Google). */
const story = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  preload: false,
});

const SECTION_LABEL =
  "font-semibold text-[11px] uppercase leading-none tracking-widest text-muted-foreground";

/** One fetch per URL for the page's life (the file is content-hashed). */
const bundles = new Map<string, Promise<Walk[]>>();

function loadWalks(url: string): Promise<Walk[]> {
  let pending = bundles.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((json) => (isWalkBundle(json) ? json.walks : []))
      .catch(() => {
        bundles.delete(url);
        return [];
      });
    bundles.set(url, pending);
  }
  return pending;
}

/** The site's walks, once the tileset has named them; [] until then. */
export function useWalks(): Walk[] {
  const url = useSceneStatus("site")?.walksUrl ?? null;
  const [walks, setWalks] = useState<{ url: string; walks: Walk[] } | null>(
    null
  );
  useEffect(() => {
    if (!url) {
      return;
    }
    let live = true;
    void loadWalks(url).then((got) => {
      if (live) {
        setWalks({ url, walks: got });
      }
    });
    return () => {
      live = false;
    };
  }, [url]);
  return walks?.url === url ? walks.walks : [];
}

/** The Erkunden panel's section: one row per walk. Nothing without walks. */
export function WalksList({
  disabled,
  onStart,
}: {
  disabled: boolean;
  onStart: (walk: Walk) => void;
}) {
  const walks = useWalks();
  const { isMobile, setOpenMobile } = useSidebar();
  if (walks.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Spaziergänge"
      className="flex flex-col gap-1.5 border-t px-4 pt-3 pb-3.5"
    >
      <span className={SECTION_LABEL}>Spaziergänge</span>
      <ul className="-mx-2 flex flex-col">
        {walks.map((walk) => (
          <li key={walk.id}>
            <button
              className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              data-walk={walk.id}
              disabled={disabled}
              onClick={() => {
                onStart(walk);
                // on a phone the panel is a sheet over the view: out of the way
                if (isMobile) {
                  setOpenMobile(false);
                }
              }}
              type="button"
            >
              <span className="flex items-center gap-2.5 text-xs">
                <RouteIcon
                  aria-hidden
                  className="size-3.5 shrink-0 opacity-60"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {walk.title}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {walk.stops.length} Stationen · {walk.minutes} min
                </span>
              </span>
              <span className="line-clamp-2 pl-6 text-[11px] text-muted-foreground leading-snug">
                {walk.teaser}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Erzählt von Claude (KI), jede Angabe mit ihrer Quelle.
      </p>
    </section>
  );
}

/**
 * The Erkunden panel's way into *Frag die Stadt* (ask-city.tsx, ADR 0056),
 * beside the written walks: the same city, asked instead of told.
 */
export function AskEntry({
  disabled,
  onAsk,
}: {
  disabled: boolean;
  onAsk: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <section
      aria-label="Frag die Stadt"
      className="flex flex-col gap-1.5 border-t px-4 pt-3 pb-3.5"
    >
      <span className={SECTION_LABEL}>Frag die Stadt</span>
      <button
        className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        data-testid="ask-open"
        disabled={disabled}
        onClick={() => {
          onAsk();
          if (isMobile) {
            setOpenMobile(false);
          }
        }}
        type="button"
      >
        <MessageCircleQuestionIcon
          aria-hidden
          className="size-3.5 shrink-0 opacity-60"
        />
        <span className="min-w-0 flex-1">
          Fragen stellen, die Antwort zeigt den Ort
        </span>
      </button>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Mit deinem eigenen KI-Schlüssel (Anthropic, OpenAI, OpenRouter, Vercel).
      </p>
    </section>
  );
}

/** A source as a reader can follow it: a link, or the twin's own id. */
function SourceLink({ source }: { source: string }) {
  if (source.startsWith("stadtwissen:")) {
    const id = source.slice("stadtwissen:".length);
    if (/^Q\d+$/.test(id)) {
      return (
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={`https://www.wikidata.org/wiki/${id}`}
          rel="noreferrer"
          target="_blank"
        >
          Wikidata {id}
        </a>
      );
    }
    return <span>Stadtmodell · {id}</span>;
  }
  let label = source;
  try {
    const url = new URL(source);
    const page = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    label = `${url.hostname.replace(/^www\./, "")}${page ? ` · ${page.replace(/_/g, " ")}` : ""}`;
  } catch {
    // shown as written
  }
  return (
    <a
      className="break-words underline underline-offset-2 hover:text-foreground"
      href={source}
      rel="noreferrer"
      target="_blank"
    >
      {label}
    </a>
  );
}

function Facts({ facts }: { facts: WalkFact[] }) {
  return (
    <details className="group mt-3 border-t pt-2 text-[12px]">
      <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
        Belege ({facts.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {facts.map((fact) => (
          <li className="leading-snug" key={fact.claim}>
            <span className="text-foreground/90">{fact.claim}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              <SourceLink source={fact.source} />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** What the stop says: its narration, today's notes, the closer look. */
function StopBody({ notes, stop }: { notes: string[]; stop: WalkStop }) {
  return (
    <>
      <p className="text-[15.5px] leading-[1.62] text-foreground/90 text-pretty first-letter:float-left first-letter:mt-[0.06em] first-letter:mr-1.5 first-letter:font-medium first-letter:text-[3.1em] first-letter:leading-[0.82] first-letter:text-primary">
        {stop.text}
      </p>
      {notes.map((note) => (
        <p
          className="mt-3 flex gap-2 text-[14.5px] italic leading-snug text-foreground/85"
          key={note}
        >
          <CalendarDaysIcon
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-primary not-italic"
          />
          {note}
        </p>
      ))}
      {stop.closer && (
        <aside className="mt-3.5 rounded-lg bg-primary/[0.06] px-3 py-2.5">
          <span className="flex items-center gap-1.5 font-sans text-[10px] font-medium tracking-[0.14em] text-primary uppercase">
            <EyeIcon aria-hidden className="size-3" />
            Genauer hingesehen
          </span>
          <p className="mt-1 text-[14.5px] leading-snug text-foreground/90">
            {stop.closer}
          </p>
        </aside>
      )}
      <div className="font-sans">
        <Facts facts={stop.facts} />
      </div>
    </>
  );
}

/** What the voice reads at a stop: its title, its story, today's notes
 *  and the closer look — the sources stay on the card. */
export function stopSpeech(stop: WalkStop, notes: readonly string[]): string {
  return [
    `${stop.title}.`,
    stop.text,
    ...notes,
    stop.closer ? `Genauer hingesehen: ${stop.closer}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The card of a walk under way: where in the walk, the stop's story, and
 * the way on. On a touch screen it sits at the top and folds its text
 * away, so the view it describes stays in sight.
 */
export function WalkCard({
  coarse,
  index,
  onClose,
  onIndex,
  walk,
}: {
  coarse: boolean;
  index: number;
  onClose: () => void;
  onIndex: (index: number) => void;
  walk: Walk;
}) {
  const [folded, setFolded] = useState(false);
  // the visitor's day: the notes for today and the season
  const [today] = useState(() => new Date());
  // read aloud: each stop from the start of its glide (the browser's own
  // voice, ADR 0057); a closed card stops talking
  const speech = useSpeech();
  const [reading, setReading] = useState(false);
  const { isMobile, openMobile } = useSidebar();
  const stop = walk.stops[index];
  const notes = stop ? stopNotes(stop, today) : [];
  const said = stop && reading ? stopSpeech(stop, notes) : "";
  useEffect(() => {
    if (said) {
      speech.speak(said);
    } else {
      speech.stop();
    }
  }, [said, speech]);
  // the phone's panel sheet covers the scene, and the card with it
  if (!stop || (isMobile && openMobile)) {
    return null;
  }
  const last = index === walk.stops.length - 1;
  return (
    <section
      aria-label={`Spaziergang: ${walk.title}`}
      className={cn(
        "pointer-events-auto absolute z-30 flex flex-col rounded-xl bg-background/95 shadow-xl backdrop-blur-lg",
        coarse
          ? "top-3 right-16 left-3 max-h-[45dvh]"
          : "bottom-6 left-4 max-h-[min(36rem,calc(100%-3rem))] w-[min(24rem,calc(100%-2rem))] lg:w-[26rem]"
      )}
      data-testid="walk-card"
    >
      <header className="flex items-start gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[10px] font-medium tracking-[0.14em] text-primary uppercase">
            <span className="truncate">{walk.title}</span>
            {/* where in the walk: one dot a stop */}
            <span className="sr-only">
              Station {index + 1} von {walk.stops.length}
            </span>
            <span aria-hidden className="flex shrink-0 items-center gap-1">
              {walk.stops.map((s, i) => (
                <span
                  className={cn(
                    "block h-1 rounded-full transition-all",
                    i === index
                      ? "w-3 bg-primary"
                      : i < index
                        ? "w-1 bg-primary/60"
                        : "w-1 bg-foreground/15"
                  )}
                  key={s.id}
                />
              ))}
            </span>
          </p>
          <h2
            aria-live="polite"
            className={cn(
              story.className,
              "mt-1 text-[1.45rem] font-medium italic leading-[1.12] tracking-[-0.01em] text-balance"
            )}
          >
            {stop.title}
          </h2>
        </div>
        {speech.supported && (
          <button
            aria-label="Vorlesen"
            aria-pressed={reading}
            className="-mt-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary"
            data-testid="walk-read"
            onClick={() => setReading((r) => !r)}
            title={reading ? "Nicht mehr vorlesen" : "Vorlesen, schon im Flug"}
            type="button"
          >
            {reading ? (
              <Volume2Icon className="size-4" />
            ) : (
              <VolumeXIcon className="size-4" />
            )}
          </button>
        )}
        <button
          aria-label="Spaziergang beenden"
          className="-mt-1 -mr-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          title="Spaziergang beenden"
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </header>
      {!(coarse && folded) && (
        <div
          className={cn(
            story.className,
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2"
          )}
          key={`${walk.id}/${stop.id}`}
        >
          <StopBody notes={notes} stop={stop} />
          <p className="mt-3 pb-1 font-sans text-[10px] text-muted-foreground leading-snug">
            <FootprintsIcon aria-hidden className="mr-1 inline size-3" />
            Erzählt von {walk.by} (KI), {walk.written}. Die Erzählung ist
            generiert; die Angaben stehen unter „Belege“ mit ihrer Quelle.
          </p>
        </div>
      )}
      <footer className="flex items-center gap-2 border-t px-3 py-2">
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          disabled={index === 0}
          onClick={() => onIndex(index - 1)}
          type="button"
        >
          <ChevronLeftIcon className="size-3.5" /> Zurück
        </button>
        {coarse && (
          <button
            className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2"
            onClick={() => setFolded((f) => !f)}
            type="button"
          >
            {folded ? "Text zeigen" : "Text einklappen"}
          </button>
        )}
        <span className="flex-1" />
        <button
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground text-xs hover:bg-primary/90"
          data-testid="walk-next"
          onClick={() => (last ? onClose() : onIndex(index + 1))}
          type="button"
        >
          {last ? "Ende" : "Weiter"} <ChevronRightIcon className="size-3.5" />
        </button>
      </footer>
    </section>
  );
}
