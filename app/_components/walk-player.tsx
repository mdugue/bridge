"use client";

import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  FootprintsIcon,
  Maximize2Icon,
  RouteIcon,
  XIcon,
} from "lucide-react";
import { Newsreader } from "next/font/google";
import Image from "next/image";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  isWalkBundle,
  CLOSER_LABEL,
  photoIsTall,
  photoPosition,
  stopNotes,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "cn";
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

/** What the stop says: its narration, today's notes, the closer look.
 *  A tall photo stands beside it, the text flowing round it. */
function StopBody({
  aside,
  notes,
  stop,
}: {
  aside: ReactNode;
  notes: string[];
  stop: WalkStop;
}) {
  return (
    <>
      {aside}
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
        <aside className="mt-3.5 flow-root rounded-lg bg-primary/[0.06] px-3 py-2.5">
          <span className="flex items-center gap-1.5 font-sans text-[10px] font-medium tracking-[0.14em] text-primary uppercase">
            <EyeIcon aria-hidden className="size-3" />
            {CLOSER_LABEL}
          </span>
          <p className="mt-1 text-[14.5px] leading-snug text-foreground/90">
            {stop.closer}
          </p>
        </aside>
      )}
      <div className="clear-both font-sans">
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

/** The photo whole, over the scene: the card crops it, this does not. */
function PhotoView({
  onOpenChange,
  open,
  photo,
  src,
  title,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  photo: WalkPhoto;
  /** the published copy's URL */
  src: string;
  title: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="w-auto max-w-[min(calc(100vw-2rem),64rem)] gap-0 overflow-hidden bg-black p-0 text-white ring-white/10 sm:max-w-[min(calc(100vw-2rem),64rem)]"
        data-testid="walk-photo-view"
      >
        {/* the published copy at its own size: not resized again */}
        <Image
          alt={photo.caption ?? `Foto: ${title}`}
          className="mx-auto block h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full object-contain"
          height={photo.h}
          src={src}
          unoptimized
          width={photo.w}
        />
        <div className="flex flex-col gap-0.5 px-4 py-2.5 font-sans">
          <DialogTitle className="text-[13px] font-normal text-white/95">
            {photo.caption ?? title}
          </DialogTitle>
          <DialogDescription className="text-[10.5px] text-white/65">
            <PhotoCredit photo={photo} />
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The photo's button: a click shows it whole; the corner says so. */
function PhotoButton({
  children,
  className,
  coarse,
  onOpen,
}: {
  children: ReactNode;
  className?: string;
  coarse: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      aria-label="Foto groß zeigen"
      className={cn(
        "group/photo relative block w-full cursor-zoom-in overflow-hidden focus-visible:outline-2 focus-visible:outline-primary",
        className
      )}
      onClick={onOpen}
      type="button"
    >
      {children}
      <span
        aria-hidden
        className={cn(
          "absolute top-2 right-2 rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm transition-opacity",
          coarse
            ? "opacity-80"
            : "opacity-0 group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100"
        )}
      >
        <Maximize2Icon className="size-3.5" />
      </span>
    </button>
  );
}

/** Whether a stop's photo stands beside its story (`photoIsTall`), not
 *  over it: on a phone's narrow card the story would be left a sliver. */
function besideStory(photo: WalkPhoto | undefined, coarse: boolean) {
  return photo !== undefined && !coarse && photoIsTall(photo);
}

/**
 * The stop's photograph: what the model cannot draw (a gilded rider, a
 * relief, a room). A wide one spans the card above the story at its own
 * proportion, cut only past a height and then round its `focus`, its
 * caption and credit laid on its lower edge; a tall one stands beside the
 * story, which flows round it (`besideStory`). A click shows it whole.
 * Served by the site itself (ADR 0043: no request to Wikimedia from the
 * visitor's browser), with its credit.
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
  const [open, setOpen] = useState(false);
  if (!(base && photo.src)) {
    return null;
  }
  const tall = besideStory(photo, coarse);
  const src = new URL(photo.src, base).href;
  const image = (
    // a small published WebP: not resized again (unoptimized)
    <Image
      // the story points at the photo: never a decorative one
      alt={photo.caption ?? `Foto: ${title}`}
      className={cn(
        "block h-auto w-full bg-muted object-cover",
        tall
          ? "max-h-[20rem] rounded-lg"
          : coarse
            ? "max-h-32"
            : "max-h-[17rem]"
      )}
      height={photo.h}
      loading="lazy"
      src={src}
      style={{ objectPosition: photoPosition(photo) }}
      unoptimized
      width={photo.w}
    />
  );
  const view = (
    <PhotoView
      onOpenChange={setOpen}
      open={open}
      photo={photo}
      src={src}
      title={title}
    />
  );
  if (tall) {
    return (
      <figure
        className="float-right m-0 mt-1 mb-2 ml-4 w-[42%]"
        data-testid="walk-photo"
      >
        <PhotoButton
          className="rounded-lg"
          coarse={coarse}
          onOpen={() => setOpen(true)}
        >
          {image}
        </PhotoButton>
        <figcaption className="mt-1.5 flex flex-col gap-0.5 font-sans text-[10px] text-muted-foreground leading-snug">
          {photo.caption && (
            <span className="text-[11.5px] text-foreground/75">
              {photo.caption}
            </span>
          )}
          <PhotoCredit photo={photo} />
        </figcaption>
        {view}
      </figure>
    );
  }
  return (
    <figure className="relative m-0 shrink-0" data-testid="walk-photo">
      <PhotoButton coarse={coarse} onOpen={() => setOpen(true)}>
        {image}
      </PhotoButton>
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-linear-to-t from-black/70 via-black/35 to-transparent px-6 pt-10 pb-2 font-sans text-[10px] text-white/75 leading-snug [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]">
        {photo.caption && (
          <span className="text-[12px] text-white/95">{photo.caption}</span>
        )}
        <span className="pointer-events-auto self-start">
          <PhotoCredit photo={photo} />
        </span>
      </figcaption>
      {view}
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

/** How far (px) a drag on a phone's sheet handle must go to fold or
 *  unfold it; less is a tap, which toggles. */
const SHEET_DRAG_PX = 24;

/**
 * A phone's walk card is a sheet at the bottom with two heights: low, the
 * title and the way on, the scene above it free; high, the story too. Its
 * handle folds and unfolds it, by a tap or a drag up or down.
 */
function SheetHandle({
  folded,
  onFold,
}: {
  folded: boolean;
  onFold: (folded: boolean) => void;
}) {
  const [from, setFrom] = useState<number | null>(null);
  return (
    <button
      aria-expanded={!folded}
      aria-label={folded ? "Text zeigen" : "Text einklappen"}
      className="flex w-full shrink-0 touch-none justify-center pt-2 pb-1"
      data-testid="walk-sheet-handle"
      onPointerCancel={() => setFrom(null)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFrom(e.clientY);
      }}
      onPointerUp={(e) => {
        const dy = from === null ? 0 : e.clientY - from;
        setFrom(null);
        onFold(Math.abs(dy) < SHEET_DRAG_PX ? !folded : dy > 0);
      }}
      type="button"
    >
      <span aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/20" />
    </button>
  );
}

/** The way on: back, on or the end. */
function WalkFooter({
  index,
  last,
  onClose,
  onIndex,
}: {
  index: number;
  last: boolean;
  onClose: () => void;
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
  // a phone's sheet starts low: the title and the way on, the scene above
  const [folded, setFolded] = useState(coarse);
  // the visitor's day: the notes for today and the season
  const [today] = useState(() => new Date());
  const { isMobile, openMobile } = useSidebar();
  const walksUrl = useSceneStatus("site")?.walksUrl ?? null;
  const stop = walk.stops[index];
  const notes = useMemo(
    () => (stop ? stopNotes(stop, today) : []),
    [stop, today]
  );
  // the phone's panel sheet covers the scene, and the card with it
  if (!stop || (isMobile && openMobile)) {
    return null;
  }
  const last = index === walk.stops.length - 1;
  const beside = besideStory(stop.photo, coarse);
  return (
    <section
      aria-label={`Spaziergang: ${walk.title}`}
      className={cn(
        "pointer-events-auto absolute z-30 flex flex-col",
        coarse
          ? "inset-x-0 bottom-0 max-h-[62dvh]"
          : "bottom-6 left-5 max-h-[min(44rem,calc(100%-3rem))] w-[min(28rem,calc(100%-2.5rem))] lg:w-[30rem]"
      )}
      data-folded={coarse && folded ? "" : undefined}
      data-testid="walk-card"
    >
      <Card
        className={cn(
          "min-h-0 flex-1 gap-0 bg-background/95 py-0 shadow-xl ring-foreground/[0.07] backdrop-blur-lg",
          coarse
            ? "rounded-t-2xl rounded-b-none pb-[env(safe-area-inset-bottom)]"
            : "rounded-2xl"
        )}
      >
        {coarse && <SheetHandle folded={folded} onFold={setFolded} />}
        {stop.photo && !beside && !(coarse && folded) && (
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
        {coarse && folded && (
          <p className="px-6 pt-1 font-sans text-[10.5px] text-muted-foreground">
            Erzählt von {walk.by} (KI)
          </p>
        )}
        {!(coarse && folded) && (
          <CardContent
            className={cn(
              story.className,
              "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-3 pb-2"
            )}
            key={`${walk.id}/${stop.id}`}
          >
            <StopBody
              aside={
                stop.photo && beside ? (
                  <StopPhoto
                    base={walksUrl}
                    coarse={coarse}
                    photo={stop.photo}
                    title={stop.title}
                  />
                ) : null
              }
              notes={notes}
              stop={stop}
            />
            <p className="mt-4 pb-2 font-sans text-[10.5px] text-muted-foreground leading-snug">
              <FootprintsIcon aria-hidden className="mr-1 inline size-3" />
              Erzählt von {walk.by} (KI), {walk.written}. Die Erzählung ist
              generiert; die Angaben stehen unter „Belege“ mit ihrer Quelle.
            </p>
          </CardContent>
        )}
        <WalkFooter
          index={index}
          last={last}
          onClose={onClose}
          onIndex={onIndex}
        />
      </Card>
    </section>
  );
}
