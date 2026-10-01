"use client";

import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import {
  type ElementType,
  type ReactNode,
  useEffect,
  useMemo,
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
import { isSiteProvenance, type SiteProvenance } from "@/lib/city/provenance";
import type { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { isTextEntry } from "./keyboard-controls";

type DrawerSnapPoint = DrawerPrimitive.Root.SnapPoint;

/** One fetch per manifest URL for the page's life (the file is
 *  content-hashed and immutable, ADR 0007). */
const provenanceFetches = new Map<string, Promise<SiteProvenance | null>>();

function fetchProvenance(url: string): Promise<SiteProvenance | null> {
  let pending = provenanceFetches.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((json) => (isSiteProvenance(json) ? json : null))
      .catch(() => null)
      .then((provenance) => {
        // A failed fetch is not kept: the next card tries again.
        if (!provenance) {
          provenanceFetches.delete(url);
        }
        return provenance;
      });
    provenanceFetches.set(url, pending);
  }
  return pending;
}

/**
 * The provenance manifest, fetched when the first card opens — never at
 * boot — and kept for the session. A failed fetch leaves the card without
 * editions; each source line still names its source and licence.
 */
function useProvenance(url: string | null): SiteProvenance | null {
  const [loaded, setLoaded] = useState<{
    provenance: SiteProvenance | null;
    url: string;
  } | null>(null);
  useEffect(() => {
    if (!url) {
      return;
    }
    let live = true;
    void fetchProvenance(url).then((provenance) => {
      if (live) {
        setLoaded({ url, provenance });
      }
    });
    return () => {
      live = false;
    };
  }, [url]);
  return loaded?.url === url ? loaded.provenance : null;
}

/**
 * The card of the "Befragen" mode (ADR 0040): what the data says
 * about the building someone asked, on demand only — the scene itself
 * carries no text (plan 032's lettering was removed for that reason). A
 * non-modal landmark, not a dialog: the city stays live behind it, and the
 * next click asks the next building. Esc or the × closes it and clears
 * the pencil mark in the scene. It looks like the HUD's other cards (the
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
  const card = useMemo(
    () => inquiryCard(inquiry, provenance),
    [inquiry, provenance]
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
      <InquirySheet card={card} key={inquiryKey(inquiry)} onClose={onClose} />
    );
  }
  return (
    <aside
      aria-labelledby="inquiry-title"
      className="absolute top-4 left-4 z-20 w-[min(22rem,calc(100%-2rem))] rounded-lg bg-card p-4 text-card-foreground shadow-lg ring-1 ring-foreground/10 select-text"
      data-testid="inquiry-card"
      data-variant="card"
    >
      <CardHeader card={card} onClose={onClose} />
      <CardDetails card={card} />
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
  onClose,
}: {
  card: InquiryCardModel;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState<DrawerSnapPoint | null>(
    SHEET_SNAP_POINTS[0]
  );
  const unfolded = snap === SHEET_SNAP_POINTS[1];
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
      <DrawerContent data-testid="inquiry-card" data-variant="sheet">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-1 pb-[max(env(safe-area-inset-bottom),1rem)]">
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
          <CardDetails card={card} />
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

/** The facts, the id to copy and the source lines. */
function CardDetails({ card }: { card: InquiryCardModel }) {
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
        <span>Kennung</span>
        <code className="min-w-0 flex-1 truncate font-mono text-foreground/80 select-all">
          {card.id}
        </code>
        <button
          aria-label="Kennung kopieren"
          className="rounded p-1 hover:bg-muted hover:text-foreground"
          onClick={copy}
          title="Kennung kopieren"
          type="button"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
      </div>

      <ul className="mt-2 space-y-1 text-[10.5px] leading-snug text-muted-foreground">
        {card.sources.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}
