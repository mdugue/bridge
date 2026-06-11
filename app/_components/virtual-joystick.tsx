"use client";

import { useRef, useState } from "react";

/** Base diameter in px; the thumb travels within base/2 - thumb/2. */
const BASE_PX = 112;
const THUMB_PX = 48;
const TRAVEL_PX = (BASE_PX - THUMB_PX) / 2;

interface VirtualJoystickProps {
  /** normalized input: x = strafe right, y = forward, both in [-1, 1] */
  onChange: (x: number, y: number) => void;
}

/**
 * Mobile-FPS-style movement stick: drag the thumb to walk, release to stop.
 * Uses pointer capture so the gesture survives leaving the base circle.
 */
export function VirtualJoystick({ onChange }: VirtualJoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });

  const moveThumb = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) {
      return;
    }
    const rect = base.getBoundingClientRect();
    let dx = clientX - (rect.left + rect.width / 2);
    let dy = clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > TRAVEL_PX) {
      dx = (dx / len) * TRAVEL_PX;
      dy = (dy / len) * TRAVEL_PX;
    }
    setThumb({ x: dx, y: dy });
    // Screen up = forward (+y).
    onChange(dx / TRAVEL_PX, -dy / TRAVEL_PX);
  };

  const release = () => {
    pointerId.current = null;
    setThumb({ x: 0, y: 0 });
    onChange(0, 0);
  };

  return (
    <div
      aria-hidden
      className="relative touch-none select-none rounded-full border border-white/30 bg-black/25 backdrop-blur-sm"
      data-testid="joystick"
      onPointerCancel={release}
      onPointerDown={(e) => {
        pointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        moveThumb(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (pointerId.current === e.pointerId) {
          moveThumb(e.clientX, e.clientY);
        }
      }}
      onPointerUp={release}
      ref={baseRef}
      style={{ width: BASE_PX, height: BASE_PX }}
    >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-white/70 shadow-md"
        style={{
          width: THUMB_PX,
          height: THUMB_PX,
          transform: `translate(calc(-50% + ${thumb.x}px), calc(-50% + ${thumb.y}px))`,
        }}
      />
    </div>
  );
}
