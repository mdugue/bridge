"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTrail, offerAsCrash, type Trail } from "@/lib/city/crash-trail";
import { crashReportsOn } from "./crash-reports";
import { dismissPreviousTrail, previousTrail } from "./crash-trail";
import { recentlyRecovered } from "./gpu-recovery";

/**
 * The previous page's crash trail (crash-trail.ts), offered as text to
 * copy: shown when that page died while in use — unless it reloaded itself
 * to recover a lost GPU, or this page follows a recovery and the record never
 * reached a first frame (offerAsCrash, gpu-recovery.ts) — or always with
 * `?trail=1`. Where the build reports crashes (crash-reports.ts), the card
 * says the report already went out. Mounted on the client only (the viewer
 * has no server render), so local storage is readable in the initializer.
 */
function initialTrail(): Trail | null {
  const previous = previousTrail();
  const always = new URLSearchParams(location.search).get("trail") === "1";
  return always || offerAsCrash(previous, recentlyRecovered())
    ? previous
    : null;
}

export function CrashReport() {
  const [trail, setTrail] = useState(initialTrail);
  const [reported] = useState(crashReportsOn);
  const [copied, setCopied] = useState(false);
  if (!trail) {
    return null;
  }
  const text = formatTrail(trail);
  const close = () => {
    dismissPreviousTrail();
    setTrail(null);
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
        {trail.state === "running"
          ? "Die letzte Sitzung wurde unerwartet beendet."
          : "Bericht der letzten Sitzung"}
      </p>
      <p className="text-muted-foreground text-xs">
        {reported && trail.state === "running"
          ? "Ein Bericht ohne Standort ist schon automatisch unterwegs — er hilft, den Absturz zu finden. Du kannst ihn hier auch kopieren."
          : "Kopiere den Bericht und schick ihn weiter — er hilft, den Absturz zu finden."}
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
