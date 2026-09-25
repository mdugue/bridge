"use client";

import { type RefObject, useEffect, useState } from "react";
import type { PlayerPose } from "@/lib/city/pose";
import type { CityWalkHandle } from "./create-app";
import type { MovementMode } from "./fps-movement";

/**
 * On foot, the name of the street the walker is on (plan 032): the nearest
 * named way within 25 m of the pose stream (10 Hz), looked up over the
 * loaded tiles' named ways. Hidden in fly mode (the lettering on the ground
 * takes over there) and in immersive mode (the pointer is locked, nothing
 * of the HUD should talk). Announced politely, and only when it changes.
 */
export function StreetCaption({
  handleRef,
  mode,
  subscribePose,
}: {
  handleRef: RefObject<CityWalkHandle | null>;
  mode: MovementMode;
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(
    () =>
      subscribePose((pose) => {
        const next =
          handleRef.current?.streetNameAt(pose.epsgX, pose.epsgY) ?? null;
        setName((prev) => (prev === next ? prev : next));
      }),
    [handleRef, subscribePose]
  );

  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  if (mode === "fly" || locked || !name) {
    return null;
  }
  return (
    <output
      aria-live="polite"
      className="pointer-events-none absolute top-13 left-1/2 z-10 max-w-[calc(100%-2rem)] -translate-x-1/2 truncate rounded-full bg-hud/70 px-3 py-1 text-[12px] font-medium text-hud-foreground shadow-sm backdrop-blur-lg"
      data-testid="street-caption"
    >
      {name}
    </output>
  );
}
