"use client";

import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import {
  type ElementType,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  type Inquiry,
  type InquiryCard as InquiryCardModel,
  inquiryCard,
} from "@/lib/city/inquiry";
import type { TreeFactsFile } from "@/lib/city/features";
import { type TreeFacts, treeFactsAt } from "@/lib/city/inquiry-features";
import { isSiteProvenance, type SiteProvenance } from "@/lib/city/provenance";
import type { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cardCredits } from "@/lib/city/card-lines";
import { InquiryData } from "./inquiry-data";
import { isTextEntry } from "./keyboard-controls";
import { useSite } from "./site-context";

type DrawerSnapPoint = DrawerPrimitive.Root.SnapPoint;

/**
 * One fetch per URL for the page's life (the files are content-hashed and
 * immutable, ADR 0007); a failed one is not kept, so the next card tries
 * again.
 */
function cachedFetch<T>(
  cache: Map<string, Promise<T | null>>,
  url: string,
  accept: (json: unknown) => json is T
): Promise<T | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((json) => (accept(json) ? json : null))
      .catch(() => null)
      .then((value) => {
        if (!value) {
          cache.delete(url);
        }
        return value;
      });
    cache.set(url, pending);
  }
  return pending;
}

/** A file fetched when a card first needs it, never at boot. */
function useFetched<T>(
  cache: Map<string, Promise<T | null>>,
  url: string | null | undefined,
  accept: (json: unknown) => json is T
): T | null {
  const [loaded, setLoaded] = useState<{ url: string; value: T | null } | null>(
    null
  );
  useEffect(() => {
    if (!url) {
      return;
    }
    let live = true;
    void cachedFetch(cache, url, accept).then((value) => {
      if (live) {
        setLoaded({ url, value });
      }
    });
    return () => {
      live = false;
    };
  }, [cache, url, accept]);
  return url && loaded?.url === url ? loaded.value : null;
}

const provenanceFetches = new Map<string, Promise<SiteProvenance | null>>();
const treeFactsFetches = new Map<string, Promise<TreeFactsFile | null>>();

const isTreeFacts = (json: unknown): json is TreeFactsFile =>
  typeof json === "object" &&
  json !== null &&
  Array.isArray((json as Partial<TreeFactsFile>).known) &&
  Array.isArray((json as Partial<TreeFactsFile>).names);

/**
 * The provenance manifest, fetched when the first card opens and kept for
 * the session. A failed fetch leaves the card without editions; each
 * source line still names its source and licence.
 */
function useProvenance(url: string | null): SiteProvenance | null {
  return useFetched(provenanceFetches, url, isSiteProvenance);
}

/** A tree's row of its tile's facts file (fetched with the question), or
 *  null for anything else and until it has arrived. */
function useTreeFacts(inquiry: Inquiry): TreeFacts | null {
  const tree = inquiry.kind === "tree" ? inquiry : null;
  const file = useFetched(treeFactsFetches, tree?.factsUrl, isTreeFacts);
  return tree && file ? treeFactsAt(file, tree.index) : null;
}

/**
 * The card of the "Befragen" mode (ADR 0042): what the data says
 * about the building someone asked, on demand only — the scene itself
 * carries no text (plan 032's lettering was removed for that reason). A
 * non-modal landmark, not a dialog: the city stays live behind it, and the
 * next click asks the next building. Esc or the × closes it and clears
 * the mark in the scene (the hatch, the outline). It looks like the HUD's other cards (the
 * shadcn Card's surface, ring and a shadow): sober, so the scene keeps the
 * colour.
 */
export function InquiryCard({
  inquiry,
  onClose,
  provenanceUrl,
  sheet = false,
}: {
  inquiry: Inquiry;
  onClose: () => void;
  provenanceUrl: string | null;
  /** a bottom sheet (touch screens) instead of the card top left */
  sheet?: boolean;
}) {
  const provenance = useProvenance(provenanceUrl);
  const treeFacts = useTreeFacts(inquiry);
  const site = useSite();
  const credits = useMemo(() => cardCredits(site), [site]);
  const card = useMemo(
    () => inquiryCard(inquiry, provenance, credits, treeFacts),
    [inquiry, provenance, credits, treeFacts]
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTextEntry(e.target)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (sheet) {
    // One sheet per question: a new one asked while the last slides away
    // opens a fresh sheet, never the closing one (whose close would drop
    // the new question).
    return (
      <InquirySheet
        card={card}
        inquiry={inquiry}
        key={inquiryKey(inquiry)}
        onClose={onClose}
        provenance={provenance}
      />
    );
  }
  return (
    <aside
      aria-labelledby="inquiry-title"
      className="pointer-events-auto flex min-h-0 shrink flex-col rounded-lg bg-card text-card-foreground shadow-lg ring-1 ring-foreground/10 select-text"
      data-testid="inquiry-card"
      data-variant="card"
    >
      <div className="shrink-0 px-4 pt-4">
        <CardHeader card={card} onClose={onClose} />
      </div>
      {/* the head stays; facts and Daten scroll below it, the wheel there
          scrolls the card, not the scene */}
      <div
        className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4"
        data-inquiry-scroll
      >
        <CardDetails card={card} inquiry={inquiry} provenance={provenance} />
      </div>
    </aside>
  );
}

/** Each question its own key (an Inquiry is a new object per ask). */
const inquiryKeys = new WeakMap<Inquiry, number>();
let nextInquiryKey = 0;
function inquiryKey(inquiry: Inquiry): number {
  let key = inquiryKeys.get(inquiry);
  if (key === undefined) {
    key = nextInquiryKey++;
    inquiryKeys.set(inquiry, key);
  }
  return key;
}

/** Folded: what and where; unfolded: three quarters of the screen. */
const SHEET_SNAP_POINTS: DrawerSnapPoint[] = ["8.25rem", 0.75];

/** How long a sheet waits for its measured fold before it slides in
 *  anyway (frames). */
const SHEET_ENTRANCE_FRAMES = 30;

/**
 * Holds a sheet below the screen until the drawer knows where its fold
 * is. Base UI measures the popup only after its first frame and draws it
 * fully unfolded meanwhile (the fold's offset falls back to 0), so a sheet
 * opened in place flashed up to three quarters of the screen and slid
 * down from there. Ready once the fold's offset is set and a frame has
 * shown the sheet closed — the slide then starts at the bottom edge.
 */
function useSheetEntrance(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let frames = 0;
    let measured = false;
    let id = requestAnimationFrame(function wait() {
      frames++;
      if (measured || frames >= SHEET_ENTRANCE_FRAMES) {
        setReady(true);
        return;
      }
      const offset = ref.current?.style.getPropertyValue(
        "--drawer-snap-point-offset"
      );
      measured = Number.parseFloat(offset ?? "") > 0;
      id = requestAnimationFrame(wait);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return [ref, ready];
}

/**
 * The card as a bottom sheet for thumbs — the shadcn Drawer (Base UI),
 * non-modal so the city stays live behind it and the next long press asks
 * the next building. Folded, it shows what the thing is and where (the
 * building stays in view above it); a swipe up — or "Angaben und Quellen"
 * — unfolds the facts, the id and the sources; a swipe down folds it, and
 * closes it from the fold. The scene's joystick and toolbar step aside
 * while it is open (city-walk.tsx).
 */
function InquirySheet({
  card,
  inquiry,
  onClose,
  provenance,
}: {
  card: InquiryCardModel;
  inquiry: Inquiry;
  onClose: () => void;
  provenance: SiteProvenance | null;
}) {
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState<DrawerSnapPoint | null>(
    SHEET_SNAP_POINTS[0]
  );
  const unfolded = snap === SHEET_SNAP_POINTS[1];
  const [popup, entered] = useSheetEntrance();
  return (
    <Drawer
      disablePointerDismissal
      modal={false}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
      onSnapPointChange={setSnap}
      open={open}
      showSwipeHandle
      snapPoint={snap}
      snapPoints={SHEET_SNAP_POINTS}
    >
      <DrawerContent
        // closed, unanimated, until the fold is measured (useSheetEntrance)
        className="not-data-[sheet-entered]:transform-(--closed-transform) not-data-[sheet-entered]:duration-0"
        data-sheet-entered={entered ? "" : undefined}
        data-testid="inquiry-card"
        data-variant="sheet"
        ref={popup}
      >
        {/* The popup is the whole screen tall and unfolds to three
            quarters of it: the scroll ends where the screen does, or the
            last quarter of the Daten scrolled out of reach below it. */}
        <div
          data-inquiry-scroll
          className="flex max-h-[calc(75dvh-1.75rem)] min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-1 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <CardHeader
            card={card}
            closeSlot={<SheetClose />}
            titleAs={DrawerTitle}
          />
          <button
            aria-expanded={unfolded}
            className="mt-1 self-start text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2"
            onClick={() => setSnap(SHEET_SNAP_POINTS[unfolded ? 0 : 1] ?? null)}
            type="button"
          >
            {unfolded ? "Angaben einklappen" : "Angaben und Quellen"}
          </button>
          <CardDetails card={card} inquiry={inquiry} provenance={provenance} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** The sheet's ×: the drawer's own close, so it slides away first. */
function SheetClose() {
  return (
    <DrawerClose
      aria-label="Karte schließen"
      className="-mt-1 -mr-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Schließen"
    >
      <XIcon className="size-4" />
    </DrawerClose>
  );
}

/** What the thing is: the kicker, the title, the address, and ×. */
function CardHeader({
  card,
  closeSlot,
  onClose,
  titleAs: Title = "h2",
}: {
  card: InquiryCardModel;
  /** the close control, when the container brings its own */
  closeSlot?: ReactNode;
  onClose?: () => void;
  /** the title element (the drawer's own title in the sheet) */
  titleAs?: ElementType;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {card.kicker}
        </p>
        <Title
          aria-live="polite"
          className="font-heading text-lg leading-tight font-normal text-balance text-foreground"
          id="inquiry-title"
        >
          {card.title}
        </Title>
        {card.address && (
          <p className="mt-0.5 text-[13px] text-foreground/80">
            {card.address}
          </p>
        )}
      </div>
      {closeSlot ?? (
        <button
          aria-label="Karte schließen"
          className="-mt-1 -mr-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          title="Schließen (Esc)"
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

/** The facts, the id to copy and, folded, the data behind them. */
function CardDetails({
  card,
  inquiry,
  provenance,
}: {
  card: InquiryCardModel;
  inquiry: Inquiry;
  provenance: SiteProvenance | null;
}) {
  // Which id was copied: a new building's card starts uncopied.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copied = copiedId === card.id;
  const copy = () => {
    navigator.clipboard?.writeText(card.id).then(
      () => setCopiedId(card.id),
      () => undefined
    );
  };
  return (
    <>
      {card.facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border pt-3 text-[13px]">
          {card.facts.map((fact) => (
            <div className="contents" key={fact.label}>
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span>{card.idLabel}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-foreground/80 select-all">
          {card.id}
        </code>
        <button
          aria-label={`${card.idLabel} kopieren`}
          className="rounded p-1 hover:bg-muted hover:text-foreground"
          onClick={copy}
          title={`${card.idLabel} kopieren`}
          type="button"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
      </div>

      <InquiryData
        inquiry={inquiry}
        provenance={provenance}
        sources={card.sources}
      />
    </>
  );
}
