"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { isNetworkMessage } from "@/lib/city/fetch-retry";

/**
 * The viewer could not start (city-walk.tsx), or its manifest never came
 * (city-walk-client.tsx): what happened in German — a network cause in
 * plain words, the browser's own text ("Load failed") under *Details* —
 * and a way to try again without hunting for the reload button (none where
 * trying again cannot help: a browser without WebGPU or WebGL2).
 */
export function BootError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const network = isNetworkMessage(message);
  return (
    <Alert className="absolute inset-x-8 top-8" variant="destructive">
      <AlertTitle>Der Stadt-Viewer konnte nicht starten</AlertTitle>
      <AlertDescription className="wrap-break-word">
        {network ? (
          <>
            <p>
              Keine Verbindung zum Server. Prüfe die Internetverbindung und
              versuche es noch einmal.
            </p>
            <details>
              <summary className="cursor-pointer">Details</summary>
              <code className="text-[10px]">{message}</code>
            </details>
          </>
        ) : (
          <p>{message}</p>
        )}
        {onRetry && (
          <Button
            className="mt-2 justify-self-start"
            onClick={onRetry}
            size="sm"
            variant="outline"
          >
            Erneut versuchen
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** The HUD's line for a layer that failed after the first frame: a network
 *  cause in plain words (its tile is asked for again, tile-retry.ts). */
export function layerErrorText(message: string): string {
  return isNetworkMessage(message)
    ? "Keine Verbindung zum Server — ein Teil der Stadt fehlt, neuer Versuch folgt."
    : `Eine Schicht konnte nicht geladen werden: ${message}`;
}
