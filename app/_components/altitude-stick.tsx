"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Track height in px; the thumb travels within track/2 − thumb/2. */
const TRACK_PX = 132;
const WIDTH_PX = 48;
const THUMB_PX = 40;
const TRAVEL_PX = (TRACK_PX - THUMB_PX) / 2;

interface AltitudeStickProps {
  /** normalized climb input in [-1, 1]: + climbs, − sinks */
  onChange: (v: number) => void;
}

/**
 * The one-axis sibling of the joystick, for fly mode on a touch screen:
 * push the thumb up to climb, down to sink, release and it springs back to
 * hover. Proportional, like the stick, so a small push is a slow drift.
 * Pointer capture keeps the gesture alive when the finger leaves the track.
 */
export function AltitudeStick({ onChange }: AltitudeStickProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  // Unmounted mid-push (the mode flipped to walk, the sidebar opened): the
  // release never arrives, so let go here or the climb would stick.
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => () => latest.current(0), []);

  const moveThumb = (clientY: number) => {
    const track = trackRef.current;
    if (!track) {
      return;
    }
    const rect = track.getBoundingClientRect();
    const dy = Math.min(
      Math.max(clientY - (rect.top + rect.height / 2), -TRAVEL_PX),
      TRAVEL_PX
    );
    setOffset(dy);
    // Screen up = climb.
    onChange(-dy / TRAVEL_PX);
  };

  const release = () => {
    pointerId.current = null;
    setOffset(0);
    onChange(0);
  };

  return (
    <div
      aria-hidden
      className="relative flex touch-none select-none flex-col items-center justify-between rounded-full border border-white/30 bg-black/25 py-1 text-white/70 backdrop-blur-sm"
      data-testid="altitude-stick"
      onPointerCancel={release}
      onPointerDown={(e) => {
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveThumb(e.clientY);
      }}
      onPointerMove={(e) => {
        if (pointerId.current === e.pointerId) {
          moveThumb(e.clientY);
        }
      }}
      onPointerUp={release}
      ref={trackRef}
      style={{ width: WIDTH_PX, height: TRACK_PX }}
    >
      <ChevronUpIcon className="size-4" />
      <ChevronDownIcon className="size-4" />
      <div
        className="absolute top-1/2 left-1/2 rounded-full border border-white/40 bg-white/70 shadow-md"
        style={{
          width: THUMB_PX,
          height: THUMB_PX,
          transform: `translate(-50%, calc(-50% + ${offset}px))`,
        }}
      />
    </div>
  );
}
