"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * The graphics failed for good: the render stopped and the page did not
 * reload by itself (gpu-recovery.ts — the lightest safety level, its caps
 * reached, or storage it could not use). What happened in a sentence, two
 * ways on — a page a safety level lighter where the player stood
 * ("Leichter weiter", lib/city/gpu-safety.ts) or a plain reload — and the
 * browser's own words folded away, for a report. Over the frozen canvas,
 * which no longer answers.
 */
export function GpuFailureCard({
  detail,
  onLighter,
  onReload,
}: {
  /** the browser's own message (WebKit's, three's) */
  detail: string;
  onLighter: () => void;
  onReload: () => void;
}) {
  // Both reload the page: one press is enough.
  const [leaving, setLeaving] = useState(false);
  const leave = (then: () => void) => () => {
    setLeaving(true);
    then();
  };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/40 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-sm shadow-lg" role="alert">
        <CardHeader>
          <CardTitle>Die Grafik ist ausgefallen</CardTitle>
          <CardDescription>
            Dein Gerät hat dem Browser den Grafikspeicher entzogen – für die
            Stadt in dieser Ansicht war nicht genug frei. „Leichter weiter“ lädt
            sie mit weniger Details neu, dort, wo du gerade warst.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Collapsible>
            <CollapsibleTrigger className="group/details flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
              Details
              <ChevronDownIcon className="size-3 transition-transform group-aria-expanded/details:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-2 wrap-break-word font-mono text-[11px] text-muted-foreground leading-snug">
                {detail}
              </p>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            disabled={leaving}
            onClick={leave(onReload)}
            size="sm"
            variant="ghost"
          >
            Neu laden
          </Button>
          <Button disabled={leaving} onClick={leave(onLighter)} size="sm">
            Leichter weiter
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
