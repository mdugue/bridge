/**
 * The tram layer's measures and the overhead line's geometry
 * (app/_components/tram-layer.ts draws it from pipeline/bake/tram.py's
 * tracks and supports). No THREE, no DOM.
 */
import type { TramBed } from "./features";

/** Dresden's own track gauge (m; OSM `gauge=1450` on every track). */
export const TRAM_GAUGE = 1.45;
/** Contact wire above the rail top (m). */
export const CONTACT_WIRE_M = 5.6;
/** Sag of the contact wire midway between two supports ~30 m apart (m). */
export const WIRE_SAG_M = 0.15;
/** The span a support nominally holds (m): longer gaps (no mapped support)
 *  are split into spans no longer than this, shorter ones sag less. */
export const NOMINAL_SPAN_M = 30;
/** Where a span wire is fixed above the ground (m): a mast's head, a wall
 *  rosette. */
export const SPAN_ANCHOR_M = { mast: 7.0, rosette: 6.5 } as const;
/** Sag of a span wire across the street at its middle (m). */
export const SPAN_SAG_M = 0.3;
/** A span wire passes at least this far above the contact wires it holds. */
export const SPAN_CLEARANCE_M = 0.5;
/** A catenary mast (m). */
export const MAST_HEIGHT_M = 7.5;

/** Rail top above the ground (m) by bed: grooved rail flush with the road,
 *  a lawn and ballast lift it. */
export const RAIL_TOP_M: Record<TramBed, number> = {
  street: 0.02,
  grass: 0.15,
  ballast: 0.25,
};
/** Rail top above a bridge deck (m): the decks are paved. */
export const RAIL_TOP_ON_DECK_M = 0.02;

/**
 * The stations (m along a track of `length`) the contact wire is held at:
 * both ends (a seam cut or the track's end — so the wire meets its
 * neighbour at the same height), every mapped support in between, and
 * where supports are further apart than a nominal span, evenly spaced
 * virtual ones (the masts OSM does not map still exist).
 */
export function wireStations(length: number, supports: number[]): number[] {
  const inner = supports
    .filter((d) => d > 0 && d < length)
    .sort((a, b) => a - b);
  const fixed = [0, ...inner, length];
  const out: number[] = [0];
  for (let i = 1; i < fixed.length; i++) {
    const a = fixed[i - 1];
    const b = fixed[i];
    if (b - a <= 0) {
      continue;
    }
    const n = Math.ceil((b - a) / NOMINAL_SPAN_M - 1e-9);
    for (let k = 1; k <= n; k++) {
      out.push(a + ((b - a) * k) / n);
    }
  }
  return out;
}

/** How far the contact wire hangs below its support height at distance d
 *  along the track: a parabola between two stations, scaled down for spans
 *  shorter than the nominal one. */
export function wireDrop(stations: number[], d: number): number {
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1];
    const b = stations[i];
    if (d <= b) {
      const span = b - a;
      if (span <= 0) {
        return 0;
      }
      const t = Math.min(Math.max((d - a) / span, 0), 1);
      return WIRE_SAG_M * Math.min(span / NOMINAL_SPAN_M, 1) * 4 * t * (1 - t);
    }
  }
  return 0;
}

/** A span wire's height at fraction t between anchors at heights ha, hb. */
export function spanHeight(ha: number, hb: number, t: number): number {
  return ha + (hb - ha) * t - SPAN_SAG_M * 4 * t * (1 - t);
}

/**
 * How much to raise both anchors of a span so it clears every contact wire
 * it holds: `crossings` are (t along the span, contact-wire height there).
 */
export function spanLift(
  ha: number,
  hb: number,
  crossings: { h: number; t: number }[]
): number {
  let lift = 0;
  for (const { t, h } of crossings) {
    lift = Math.max(lift, h + SPAN_CLEARANCE_M - spanHeight(ha, hb, t));
  }
  return lift;
}
