/**
 * Time-of-day color palette for fog and hemisphere light, interpolated by
 * sun altitude. Pure (no THREE) — the sun rig feeds the hex values into
 * three.js Colors. The physical sky dome handles the visible sky itself;
 * this palette keeps fog and fill light in tune with it.
 */

import { clamp01 } from "@/lib/math";

export interface AtmospherePalette {
  /** scene fog (and far-haze) color */
  fog: string;
  /** hemisphere light ground tint */
  hemiGround: string;
  /** hemisphere light sky tint */
  hemiSky: string;
}

interface Stop extends AtmospherePalette {
  /** sun altitude in degrees */
  alt: number;
}

/** Sorted by altitude: deep night -> horizon glow -> day. */
const STOPS: Stop[] = [
  { alt: -18, fog: "#0a0e18", hemiSky: "#16203a", hemiGround: "#0b0d11" },
  { alt: -4, fog: "#2a3050", hemiSky: "#3a4a74", hemiGround: "#23242a" },
  { alt: 1, fog: "#e2b489", hemiSky: "#8497bb", hemiGround: "#54493c" },
  { alt: 12, fog: "#dadfe7", hemiSky: "#b5cbdf", hemiGround: "#5a6350" },
  { alt: 60, fog: "#dfe7ee", hemiSky: "#c8dbeb", hemiGround: "#616b55" },
];

function channel(hex: string, i: number): number {
  return Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

/** Linear RGB-hex interpolation, t clamped to [0, 1]. */
export function lerpHexColor(a: string, b: string, t: number): string {
  const k = clamp01(t);
  let out = "#";
  for (let i = 0; i < 3; i++) {
    const v = Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * k);
    out += v.toString(16).padStart(2, "0");
  }
  return out;
}

/** Palette for a given sun altitude (degrees), clamped at the outer stops. */
export function atmosphereAt(altitudeDeg: number): AtmospherePalette {
  const first = STOPS[0];
  if (altitudeDeg <= first.alt) {
    return {
      fog: first.fog,
      hemiSky: first.hemiSky,
      hemiGround: first.hemiGround,
    };
  }
  for (let i = 1; i < STOPS.length; i++) {
    const hi = STOPS[i];
    if (altitudeDeg <= hi.alt) {
      const lo = STOPS[i - 1];
      const t = (altitudeDeg - lo.alt) / (hi.alt - lo.alt);
      return {
        fog: lerpHexColor(lo.fog, hi.fog, t),
        hemiSky: lerpHexColor(lo.hemiSky, hi.hemiSky, t),
        hemiGround: lerpHexColor(lo.hemiGround, hi.hemiGround, t),
      };
    }
  }
  const last = STOPS.at(-1) as Stop;
  return { fog: last.fog, hemiSky: last.hemiSky, hemiGround: last.hemiGround };
}

/** Fog range at zero atmosphere (barely any haze). */
const FOG_CLEAR = { near: 1200, far: 4000 };
/** Fog range at full atmosphere (thick haze right in front of you). */
const FOG_DENSE = { near: 40, far: 450 };

/**
 * Fog near/far for an "atmosphere" amount t in [0, 1]. Interpolates
 * exponentially — perceptually, haze density needs the range to shrink
 * multiplicatively, otherwise nothing changes until the very top of the
 * slider.
 */
export function fogRangeFor(t: number): { far: number; near: number } {
  const k = clamp01(t);
  return {
    near: FOG_CLEAR.near * (FOG_DENSE.near / FOG_CLEAR.near) ** k,
    far: FOG_CLEAR.far * (FOG_DENSE.far / FOG_CLEAR.far) ** k,
  };
}
