"use client";

import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Inquiry } from "@/lib/city/inquiry";
import type { LineageEntry } from "@/lib/city/lineage";
import type { Stated } from "@/lib/city/methods";
import type { SiteProvenance } from "@/lib/city/provenance";
import { MethodBadge, MethodLegend } from "./method-badge";
import { useSite } from "./site-context";

type LineageModule = typeof import("@/lib/city/lineage");

/** The module, loaded once for the page when a card's section is first
 *  wanted (its own chunk: the boot carries none of it). */
let lineageModule: Promise<LineageModule> | null = null;
function loadLineage(): Promise<LineageModule> {
  lineageModule ??= import("@/lib/city/lineage").catch((error: unknown) => {
    // a failed chunk is not kept: the next opening tries again
    lineageModule = null;
    throw error;
  });
  return lineageModule;
}

/** The lineage module once `wanted`, null until it has arrived. */
function useLineage(wanted: boolean): LineageModule | null {
  const [mod, setMod] = useState<LineageModule | null>(null);
  useEffect(() => {
    if (!wanted || mod) {
      return;
    }
    let live = true;
    loadLineage().then(
      (m) => {
        if (live) {
          setMod(m);
        }
      },
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [wanted, mod]);
  return mod;
}

/**
 * The card's "Daten" section (plan 052): folded by default, so the card
 * leads with what the thing is. Unfolded, every dataset the viewer used
 * for it: first where the card's facts come from (`sources`, the card's
 * own lines), then what the thing as drawn is made of — what each dataset
 * gave its form, colour, place and light, with its edition, its credit and
 * where to find it, and what the viewer worked out itself
 * (lib/city/lineage.ts, loaded on the first unfolding or as the pointer
 * nears the toggle). Every line carries the badge of how the viewer came
 * by it (lib/city/methods.ts), the legend folded at the end.
 */
export function InquiryData({
  inquiry,
  provenance,
  sources,
}: {
  inquiry: Inquiry;
  provenance: SiteProvenance | null;
  /** the card's source lines: where each fact it states comes from */
  sources: readonly Stated[];
}) {
  const site = useSite();
  const [open, setOpen] = useState(false);
  const [near, setNear] = useState(false);
  const mod = useLineage(open || near);
  const root = useRef<HTMLDivElement | null>(null);
  // Opened, the section scrolls up into the card's own scroll (never an
  // ancestor's: scrollIntoView would also shift the sheet's popup).
  useEffect(() => {
    const el = root.current;
    const scroller = el?.closest<HTMLElement>("[data-inquiry-scroll]");
    if (!(open && el && scroller)) {
      return;
    }
    // once the panel has grown: before, there is nothing to scroll to
    const id = window.setTimeout(() => {
      const top =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollBy({ top: Math.max(top - 8, 0), behavior: "smooth" });
    }, 250);
    return () => window.clearTimeout(id);
  }, [open]);
  const entries = useMemo(
    () => mod?.lineage(inquiry, provenance, site) ?? null,
    [mod, inquiry, provenance, site]
  );
  return (
    <Collapsible
      className="mt-3 border-t border-border pt-2"
      onOpenChange={setOpen}
      open={open}
      ref={root}
    >
      <CollapsibleTrigger
        className="group/data flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
        data-testid="inquiry-data-toggle"
        onFocus={() => setNear(true)}
        onPointerEnter={() => setNear(true)}
      >
        <span className="font-medium tracking-[0.08em] uppercase">Daten</span>
        <span className="flex-1 truncate">Quellen und Herkunft</span>
        <ChevronDownIcon className="size-3.5 transition-transform group-aria-expanded/data:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent data-testid="inquiry-data">
        {sources.length > 0 && (
          <>
            <SectionHead>Angaben</SectionHead>
            <ul className="space-y-1 text-[10.5px] leading-snug text-muted-foreground">
              {sources.map((line) => (
                <li className="flex items-start gap-2" key={line.text}>
                  <span className="min-w-0 flex-1">{line.text}</span>
                  <MethodBadge method={line.method} />
                </li>
              ))}
            </ul>
          </>
        )}
        <SectionHead>Darstellung</SectionHead>
        {entries ? (
          <ol className="space-y-2.5">
            {entries.map((e, i) => (
              <LineageRow entry={e} key={`${i}:${e.source}`} />
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-muted-foreground">lädt …</p>
        )}
        <details className="group/legend mt-3 border-t border-border pt-2">
          <summary className="cursor-pointer list-none text-[10.5px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Was die Abzeichen bedeuten
            <ChevronDownIcon className="ml-1 inline size-3 transition-transform group-open/legend:rotate-180" />
          </summary>
          <div className="mt-2">
            <MethodLegend />
            <a
              className="mt-2 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground decoration-dotted underline-offset-2 hover:text-foreground hover:underline"
              href="/wissen/de/methods"
              rel="noreferrer"
              target="_blank"
            >
              Mehr dazu im Wissensbereich
              <ExternalLinkIcon className="size-2.5 opacity-60" />
            </a>
          </div>
        </details>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SectionHead({ children }: { children: string }) {
  return (
    <p className="mt-3 mb-1.5 text-[9.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function LineageRow({ entry }: { entry: LineageEntry }) {
  const meta = [entry.stand ? `Stand ${entry.stand}` : "", entry.credit]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="text-[11.5px] leading-snug">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 font-medium text-foreground">
          {entry.url ? (
            <a
              className="inline-flex items-baseline gap-1 decoration-dotted underline-offset-2 hover:underline"
              href={entry.url}
              rel="noreferrer"
              target="_blank"
            >
              {entry.source}
              <ExternalLinkIcon className="size-2.5 shrink-0 self-center opacity-60" />
            </a>
          ) : (
            entry.source
          )}
        </span>
      </div>
      <ul className="mt-0.5 space-y-0.5 text-foreground/80">
        {entry.used.map((u) => (
          <li className="flex items-start gap-1.5" key={u.text}>
            <span aria-hidden className="text-muted-foreground">
              –
            </span>
            <span className="min-w-0 flex-1">{u.text}</span>
            <MethodBadge className="mt-px" method={u.method} />
          </li>
        ))}
      </ul>
      {meta && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{meta}</p>
      )}
    </li>
  );
}
