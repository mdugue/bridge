"use client";

import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Inquiry,
  type InquiryCard as InquiryCardModel,
  inquiryCard,
} from "@/lib/city/inquiry";
import { isSiteProvenance, type SiteProvenance } from "@/lib/city/provenance";
import { isTextEntry } from "./keyboard-controls";

/** One fetch per manifest URL for the page's life (the file is
 *  content-hashed and immutable, ADR 0007). */
const provenanceFetches = new Map<string, Promise<SiteProvenance | null>>();

function fetchProvenance(url: string): Promise<SiteProvenance | null> {
  let pending = provenanceFetches.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : null))
      .then((json) => (isSiteProvenance(json) ? json : null))
      .catch(() => null);
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
 * The paper card of the "Befragen" mode (ADR 0035): what the data says
 * about the building someone asked, on demand only — the scene itself
 * carries no text (plan 032's lettering was removed for that reason). A
 * non-modal landmark, not a dialog: the city stays live behind it, and the
 * next tap asks the next building. Esc or the × closes it and clears the
 * pencil mark in the scene.
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
    return <InquirySheet card={card} onClose={onClose} />;
  }
  return (
    <aside
      aria-labelledby="inquiry-title"
      className="absolute top-4 left-4 z-20 w-[min(22rem,calc(100%-2rem))] rounded-sm border border-paper-rule bg-paper/95 p-4 text-paper-ink shadow-[0_10px_30px_-12px_rgba(40,30,20,0.55)] backdrop-blur-sm"
      data-testid="inquiry-card"
      data-variant="card"
    >
      <CardHeader card={card} onClose={onClose} />
      <CardDetails card={card} />
    </aside>
  );
}

/** Pixels a swipe must travel to count (and not be a tap). */
const SWIPE_PX = 24;

/**
 * The card as a bottom sheet, for thumbs: folded, it shows what the thing
 * is and where (the building stays in view above it); a swipe up — or a
 * tap on the grip — unfolds the facts, the id and the sources; a swipe
 * down folds it, and closes it once folded. The scene's joystick and
 * toolbar step aside while it is open (city-walk.tsx).
 */
function InquirySheet({
  card,
  onClose,
}: {
  card: InquiryCardModel;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const start = useRef<number | null>(null);
  // A swipe that ends on the grip must not also count as its click.
  const swiped = useRef(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    start.current = e.clientY;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const from = start.current;
    start.current = null;
    if (from === null) {
      return;
    }
    const dy = e.clientY - from;
    swiped.current = Math.abs(dy) > SWIPE_PX;
    if (dy < -SWIPE_PX) {
      setOpen(true);
    } else if (dy > SWIPE_PX) {
      if (open) {
        setOpen(false);
      } else {
        onClose();
      }
    }
  };
  return (
    <aside
      aria-labelledby="inquiry-title"
      className="absolute inset-x-0 bottom-0 z-30 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-paper-rule bg-paper/95 px-4 pt-1 pb-[max(env(safe-area-inset-bottom),1rem)] text-paper-ink shadow-[0_-10px_30px_-12px_rgba(40,30,20,0.55)] backdrop-blur-sm"
      data-testid="inquiry-card"
      data-variant="sheet"
    >
      <div
        className="touch-none"
        onPointerCancel={() => {
          start.current = null;
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <button
          aria-expanded={open}
          aria-label={open ? "Angaben einklappen" : "Angaben zeigen"}
          className="mx-auto flex h-6 w-16 items-center justify-center"
          onClick={() => {
            if (swiped.current) {
              swiped.current = false;
              return;
            }
            setOpen((o) => !o);
          }}
          type="button"
        >
          <span className="block h-1 w-10 rounded-full bg-paper-rule" />
        </button>
        <CardHeader card={card} onClose={onClose} />
        {!open && (card.facts.length > 0 || card.sources.length > 0) && (
          <p className="mt-1 text-[11px] text-paper-muted">
            Nach oben wischen: Angaben und Quellen
          </p>
        )}
      </div>
      {open && <CardDetails card={card} />}
    </aside>
  );
}

/** What the thing is: the kicker, the title, the address, and ×. */
function CardHeader({
  card,
  onClose,
}: {
  card: InquiryCardModel;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium tracking-[0.14em] text-paper-muted uppercase">
          {card.kicker}
        </p>
        <h2
          aria-live="polite"
          className="font-heading text-lg leading-tight text-balance"
          id="inquiry-title"
        >
          {card.title}
        </h2>
        {card.address && (
          <p className="mt-0.5 text-[13px] text-paper-ink/80">{card.address}</p>
        )}
      </div>
      <button
        aria-label="Karte schließen"
        className="-mt-1 -mr-1 rounded-full p-1.5 text-paper-muted hover:bg-paper-rule/60 hover:text-paper-ink"
        onClick={onClose}
        title="Schließen (Esc)"
        type="button"
      >
        <XIcon className="size-4" />
      </button>
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
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-dashed border-paper-rule pt-3 text-[13px]">
          {card.facts.map((fact) => (
            <div className="contents" key={fact.label}>
              <dt className="text-paper-muted">{fact.label}</dt>
              <dd className="tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-dashed border-paper-rule pt-2 text-[11px] text-paper-muted">
        <span>Kennung</span>
        <code className="min-w-0 flex-1 truncate font-mono text-paper-ink/80 select-all">
          {card.id}
        </code>
        <button
          aria-label="Kennung kopieren"
          className="rounded p-1 hover:bg-paper-rule/60 hover:text-paper-ink"
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

      <ul className="mt-2 space-y-1 text-[10.5px] leading-snug text-paper-muted">
        {card.sources.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}

/** The mode's quiet reminder while no card is open. */
export function InquiryHint({ coarse }: { coarse: boolean }) {
  return (
    <output
      aria-live="polite"
      className="pointer-events-none absolute top-4 left-4 z-20 rounded-full bg-paper/90 px-3 py-1 text-[12px] text-paper-ink shadow"
    >
      {coarse
        ? "Befragen: ein Gebäude antippen"
        : "Befragen: auf ein Gebäude klicken"}
    </output>
  );
}
