"use client";

import {
  ChevronRightIcon,
  FootprintsIcon,
  MapIcon,
  PlaneIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Viewpoint } from "@/lib/city/site";
import { useSite } from "./site-context";
import { describeOffsite, type Offsite } from "./locate-me";

/**
 * "Standort" found the player, but off the tiles. Rather than a line that
 * says so and fades, a dialog that says so and offers the way on: the site's
 * vantages, one tap each, or the minimap to pick a spot.
 *
 * A site has many vantages (Dresden 17), so they are one-line rows in a list
 * that scrolls on its own between a fixed header and footer: on a phone the
 * two ways out never leave the screen, however long the list.
 */
export function LocateOffsiteDialog({
  offsite,
  onClose,
  onShowMap,
  onTravel,
}: {
  offsite: Offsite | null;
  onClose: () => void;
  /** opens the sidebar on the minimap */
  onShowMap: () => void;
  onTravel: (view: Viewpoint) => void;
}) {
  const site = useSite();
  // The last placement is kept while the dialog animates out, so the text
  // doesn't blank mid-fade (state set during render, React's own pattern).
  const [shown, setShown] = useState(offsite);
  if (offsite !== null && offsite !== shown) {
    setShown(offsite);
  }
  const words = shown ? describeOffsite(shown, site.label) : null;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={offsite !== null}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>{words?.title}</DialogTitle>
          <DialogDescription>{words?.body}</DialogDescription>
        </DialogHeader>
        <ul
          aria-label="Aussichtspunkte"
          className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain border-y px-2 py-1 sm:max-h-96"
        >
          {site.viewpoints.map((view) => (
            <li key={view.id}>
              <button
                className="group/view flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => {
                  onClose();
                  onTravel(view);
                }}
                title={view.description}
                type="button"
              >
                {view.mode === "fly" ? (
                  <PlaneIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                ) : (
                  <FootprintsIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1 py-1.5 font-medium text-xs leading-tight hyphens-auto">
                  {view.label}
                </span>
                <span className="sr-only">
                  {view.mode === "fly" ? "aus der Luft" : "auf Augenhöhe"}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground/60 group-hover/view:text-foreground"
                />
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter className="shrink-0">
          <Button
            onClick={() => {
              onClose();
              onShowMap();
            }}
            variant="outline"
          >
            <MapIcon aria-hidden data-icon="inline-start" />
            Auf der Karte wählen
          </Button>
          <Button onClick={onClose}>Hier bleiben</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
