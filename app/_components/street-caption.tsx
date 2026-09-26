"use client";

import { type RefObject, useEffect, useState } from "react";
import type { PlayerPose } from "@/lib/city/pose";
import type { CityWalkHandle } from "./create-app";
import type { MovementMode } from "./fps-movement";

/**
 * On foot, the name of the street the walker is on (plan 032): the nearest
 * named way within 25 m of the pose stream (10 Hz), looked up over the
 * loaded tiles' named ways. Hidden in fly mode (the lettering on the ground
 * takes over there, and no lookup runs) and in immersive mode (the pointer
 * is locked, nothing of the HUD should talk). Announced politely, and only
 * when it changes. It flows in the HUD's top-centre column (city-walk.tsx),
 * under the streaming pill and above a stream error.
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
  const flying = mode === "fly";

  useEffect(() => {
    if (flying) {
      return;
    }
    return subscribePose((pose) => {
      const next =
        handleRef.current?.streetNameAt(pose.epsgX, pose.epsgY) ?? null;
      setName((prev) => (prev === next ? prev : next));
    });
  }, [flying, handleRef, subscribePose]);

  useEffect(() => {
    const onChange = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  if (flying || locked || !name) {
    return null;
  }
  return (
    <output
      aria-live="polite"
      className="max-w-full truncate rounded-full bg-hud/70 px-3 py-1 text-[12px] font-medium text-hud-foreground shadow-sm backdrop-blur-lg"
      data-testid="street-caption"
    >
      {name}
    </output>
  );
}
