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
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  isWalkBundle,
  CLOSER_LABEL,
  stopNotes,
  stopSpeech,
  type Walk,
  type WalkFact,
  type WalkPhoto,
  type WalkStop,
} from "@/lib/city/walks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "cn";
import { useSpeech } from "./ask-voice";
import { useSceneStatus } from "./scene-status";
import { VoicePicker } from "./voice-picker";

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
        Mit deinem eigenen KI-Schlüssel (Anthropic, OpenAI, Google, OpenRouter,
        Vercel).
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
      <p className="flow-root text-[15.5px] leading-[1.62] text-foreground/90 text-pretty first-letter:float-left first-letter:mt-[0.06em] first-letter:mr-1.5 first-letter:font-medium first-letter:text-[3.1em] first-letter:leading-[0.82] first-letter:text-primary">
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
            {CLOSER_LABEL}
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

/** Commons' credit, as a reader can follow it: the author, the licence,
 *  the file's page. */
function PhotoCredit({ photo }: { photo: WalkPhoto }) {
  return (
    <a
      className="hover:text-foreground hover:underline"
      href={photo.page}
      rel="noreferrer"
      target="_blank"
      title={`${photo.file} auf Wikimedia Commons`}
    >
      Foto: {photo.author} · {photo.licence} · Wikimedia Commons
    </a>
  );
}

/**
 * The stop's photograph, above its story: what the model cannot draw (a
 * gilded rider, a relief, a room). Served by the site itself (ADR 0043:
 * no request to Wikimedia from the visitor's browser), with its credit.
 */
function StopPhoto({
  base,
  coarse,
  photo,
  title,
}: {
  base: string | null;
  coarse: boolean;
  photo: WalkPhoto;
  title: string;
}) {
  if (!(base && photo.src)) {
    return null;
  }
  return (
    <figure className="m-0 shrink-0" data-testid="walk-photo">
      {/* a small published WebP: not resized again (unoptimized) */}
      <Image
        // the story points at the photo: never a decorative one
        alt={photo.caption ?? `Foto: ${title}`}
        className={cn(
          "block w-full bg-muted object-cover",
          coarse ? "max-h-32" : "max-h-56"
        )}
        height={photo.h}
        loading="lazy"
        src={new URL(photo.src, base).href}
        unoptimized
        width={photo.w}
      />
      <figcaption className="flex flex-col gap-0.5 px-6 pt-2 font-sans text-[10px] text-muted-foreground leading-snug">
        {photo.caption && (
          <span className="text-[11.5px] text-foreground/75">
            {photo.caption}
          </span>
        )}
        <PhotoCredit photo={photo} />
      </figcaption>
    </figure>
  );
}

/** Where in the walk (one dot a stop) and the stop's title. */
function StopHeading({ index, walk }: { index: number; walk: Walk }) {
  const stop = walk.stops[index];
  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-2.5 text-[10px] font-medium tracking-[0.16em] text-primary uppercase">
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
                  ? "w-3.5 bg-primary"
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
          "mt-2 text-[1.7rem] font-medium italic leading-[1.1] tracking-[-0.012em] text-balance"
        )}
      >
        {stop.title}
      </h2>
    </div>
  );
}

/** The way on: back, fold the text away (a phone), on or the end. */
function WalkFooter({
  coarse,
  folded,
  index,
  last,
  onClose,
  onFold,
  onIndex,
}: {
  coarse: boolean;
  folded: boolean;
  index: number;
  last: boolean;
  onClose: () => void;
  onFold: () => void;
  onIndex: (index: number) => void;
}) {
  return (
    <CardFooter className="gap-2 border-t px-5 py-3">
      <Button
        disabled={index === 0}
        onClick={() => onIndex(index - 1)}
        size="lg"
        variant="ghost"
      >
        <ChevronLeftIcon /> Zurück
      </Button>
      {coarse && (
        <button
          className="text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2"
          onClick={onFold}
          type="button"
        >
          {folded ? "Text zeigen" : "Text einklappen"}
        </button>
      )}
      <span className="flex-1" />
      <Button
        className="px-3.5"
        data-testid="walk-next"
        onClick={() => (last ? onClose() : onIndex(index + 1))}
        size="lg"
      >
        {last ? "Ende" : "Weiter"} <ChevronRightIcon />
      </Button>
    </CardFooter>
  );
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
  const walksUrl = useSceneStatus("site")?.walksUrl ?? null;
  const stop = walk.stops[index];
  const notes = stop ? stopNotes(stop, today) : [];
  const said = stop && reading ? stopSpeech(stop, notes) : "";
  useEffect(() => {
    if (said) {
      speech.speak(said);
      // a new stop, or reading switched off, cuts this one off
      return speech.stop;
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
        "pointer-events-auto absolute z-30 flex flex-col",
        coarse
          ? "top-3 right-16 left-3 max-h-[52dvh]"
          : "bottom-6 left-5 max-h-[min(44rem,calc(100%-3rem))] w-[min(28rem,calc(100%-2.5rem))] lg:w-[30rem]"
      )}
      data-testid="walk-card"
    >
      <Card className="min-h-0 flex-1 gap-0 rounded-2xl bg-background/95 py-0 shadow-xl ring-foreground/[0.07] backdrop-blur-lg">
        {stop.photo && !(coarse && folded) && (
          <StopPhoto
            base={walksUrl}
            coarse={coarse}
            key={`photo:${walk.id}/${stop.id}`}
            photo={stop.photo}
            title={stop.title}
          />
        )}
        <CardHeader className="flex items-start gap-3 px-6 pt-5 pb-1">
          <StopHeading index={index} walk={walk} />
          <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-0.5">
            {speech.supported && (
              <Button
                aria-label="Vorlesen"
                aria-pressed={reading}
                className="rounded-full text-muted-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary"
                data-testid="walk-read"
                onClick={() => setReading((r) => !r)}
                size="icon-lg"
                title={
                  reading ? "Nicht mehr vorlesen" : "Vorlesen, schon im Flug"
                }
                variant="ghost"
              >
                {reading ? <Volume2Icon /> : <VolumeXIcon />}
              </Button>
            )}
            <Button
              aria-label="Spaziergang beenden"
              className="rounded-full text-muted-foreground"
              onClick={onClose}
              size="icon-lg"
              title="Spaziergang beenden"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </div>
        </CardHeader>
        {reading && (
          <div className="px-6 pt-1">
            <VoicePicker speech={speech} />
          </div>
        )}
        {!(coarse && folded) && (
          <CardContent
            className={cn(
              story.className,
              "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-3 pb-2"
            )}
            key={`${walk.id}/${stop.id}`}
          >
            <StopBody notes={notes} stop={stop} />
            <p className="mt-4 pb-2 font-sans text-[10.5px] text-muted-foreground leading-snug">
              <FootprintsIcon aria-hidden className="mr-1 inline size-3" />
              Erzählt von {walk.by} (KI), {walk.written}. Die Erzählung ist
              generiert; die Angaben stehen unter „Belege“ mit ihrer Quelle.
            </p>
          </CardContent>
        )}
        <WalkFooter
          coarse={coarse}
          folded={folded}
          index={index}
          last={last}
          onClose={onClose}
          onFold={() => setFolded((f) => !f)}
          onIndex={onIndex}
        />
      </Card>
    </section>
  );
}
