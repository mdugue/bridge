"use client";

import { useState, useSyncExternalStore } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type ReportsState,
  reportsState,
  setReportsDeclined,
} from "./report-choice";

/**
 * The privacy page's switch for the crash reports (report-choice.ts): on
 * unless this browser said no. Where the build reports nothing, or the
 * browser sends Global Privacy Control, it says so instead. Local storage
 * is the browser's, so the state is known only once mounted; another tab
 * that changes it is heard through the `storage` event.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const unknown = (): ReportsState | null => null;

const NOTES: Record<ReportsState, string> = {
  "no-dsn":
    "In dieser Installation sind keine Fehlerberichte eingerichtet – es wird nichts gesendet.",
  gpc: "Dein Browser sendet Global Privacy Control – aus ihm wird nichts gesendet.",
  on: "Eingeschaltet. Ausschalten gilt sofort, auch für schon geöffnete Tabs.",
  declined: "Ausgeschaltet – aus diesem Browser wird nichts gesendet.",
};

export function ReportsChoice() {
  const state = useSyncExternalStore(subscribe, reportsState, unknown);
  const [unsaved, setUnsaved] = useState(false);
  if (state === null) {
    return null;
  }
  const choosable = state === "on" || state === "declined";
  const choose = (on: boolean) => {
    setUnsaved(!setReportsDeclined(!on));
    for (const listener of listeners) {
      listener();
    }
  };
  return (
    <div className="not-typeset my-6 flex flex-col gap-2 rounded-lg border bg-background p-4 text-sm">
      {choosable ? (
        <div className="flex items-center justify-between gap-4">
          <Label className="text-sm" htmlFor="reports-choice">
            Fehlerberichte aus diesem Browser senden
          </Label>
          <Switch
            checked={state === "on"}
            id="reports-choice"
            onCheckedChange={choose}
          />
        </div>
      ) : null}
      <output className="block text-muted-foreground">
        {unsaved
          ? "Dein Browser speichert nichts für diese Seite – die Wahl lässt sich nicht merken. Ein Browser, der Global Privacy Control sendet, schaltet die Berichte ebenfalls aus."
          : NOTES[state]}
      </output>
    </div>
  );
}
