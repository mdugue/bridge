"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTrail, offerAsCrash, type Trail } from "@/lib/city/crash-trail";
import { crashReportsOn } from "./crash-reports";
import {
  dismissPreviousTrail,
  pageStillOpen,
  previousTrail,
} from "./crash-trail";
import { recentlyRecovered } from "./gpu-recovery";

/**
 * The previous page's crash trail (crash-trail.ts), offered as text to
 * copy: shown when that page died while in use — unless it reloaded itself
 * to recover a lost GPU, or this page follows a recovery and the record never
 * reached a first frame (offerAsCrash, gpu-recovery.ts) — or always with
 * `?trail=1`; and not a page still open in another tab, whose record only
 * looks ended (crash-trail.ts `pageStillOpen`). Where the build reports
 * crashes (crash-reports.ts), the card says the report already went out.
 * Mounted on the client only (the viewer has no server render), so local
 * storage is readable in the initializer.
 */
interface Offer {
  trail: Trail;
  /** offered as a crash (and reported as one) */
  crashed: boolean;
  /** `?trail=1`: shown whatever it was */
  always: boolean;
}

function initialOffer(): Offer | null {
  const previous = previousTrail();
  if (!previous) {
    return null;
  }
  const crashed = offerAsCrash(previous, recentlyRecovered());
  const always = new URLSearchParams(location.search).get("trail") === "1";
  return always || crashed ? { trail: previous, crashed, always } : null;
}

export function CrashReport() {
  const [offer, setOffer] = useState(initialOffer);
  const [reported] = useState(crashReportsOn);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!offer?.crashed) {
      return;
    }
    let mounted = true;
    void pageStillOpen(offer.trail).then((open) => {
      if (open && mounted) {
        setOffer(offer.always ? { ...offer, crashed: false } : null);
      }
    });
    return () => {
      mounted = false;
    };
  }, [offer]);
  if (!offer) {
    return null;
  }
  const { trail, crashed } = offer;
  const text = formatTrail(trail);
  const close = () => {
    dismissPreviousTrail();
    setOffer(null);
  };
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false)
    );
  };
  return (
    <section
      aria-label="Absturzbericht"
      className="absolute inset-x-4 top-4 z-50 mx-auto flex max-w-lg flex-col gap-2 rounded-lg border bg-background/95 p-3 text-sm shadow-lg"
    >
      <p className="font-medium">
        {crashed
          ? "Die letzte Sitzung wurde unerwartet beendet."
          : "Bericht der letzten Sitzung"}
      </p>
      <p className="text-muted-foreground text-xs">
        {reported && crashed ? (
          <>
            Ein Bericht ohne Standort ist schon automatisch unterwegs — er
            hilft, den Absturz zu finden. Du kannst ihn hier auch kopieren.{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href="/datenschutz#fehlerberichte"
              rel="noopener"
              target="_blank"
            >
              Was er enthält und wie du die Berichte ausschaltest
            </a>
          </>
        ) : (
          "Kopiere den Bericht und schick ihn weiter — er hilft, den Absturz zu finden."
        )}
      </p>
      <Textarea
        className="h-40 font-mono text-[10px] leading-tight"
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        value={text}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={close} size="sm" variant="ghost">
          Schließen
        </Button>
        <Button onClick={copy} size="sm">
          {copied ? "Kopiert" : "Kopieren"}
        </Button>
      </div>
    </section>
  );
}
