/**
 * Street names: how a label is laid on the ground and packed into its
 * tile's atlas (app/_components/name-layer.ts draws them from
 * pipeline/bake/names.py), and which named way the walker stands on (the
 * HUD caption). No THREE, no DOM.
 */
import type { NameClass } from "./features";
import type { Point2 } from "./polyline";

/** Letter height on the ground (m) by class. */
export const LETTER_M: Record<NameClass, number> = {
  main: 6,
  minor: 4,
  bridge: 5,
  square: 6,
};

/** The caption names the nearest way within this distance (m). */
export const CAPTION_RADIUS_M = 25;

/** One label's place in the atlas (px). */
export interface AtlasSlot {
  h: number;
  w: number;
  x: number;
  y: number;
}

/**
 * Shelf-packs label boxes (`widths` px, all `rowHeight` tall) into rows of
 * at most `maxWidth`: each label in input order goes on the current row,
 * or opens the next. Returns the slots and the height used; a label wider
 * than a row is clipped to it.
 */
export function packAtlas(
  widths: number[],
  rowHeight: number,
  maxWidth: number
): { height: number; slots: AtlasSlot[] } {
  const slots: AtlasSlot[] = [];
  let x = 0;
  let y = 0;
  for (const raw of widths) {
    const w = Math.min(Math.ceil(raw), maxWidth);
    if (x > 0 && x + w > maxWidth) {
      x = 0;
      y += rowHeight;
    }
    slots.push({ x, y, w, h: rowHeight });
    x += w;
  }
  return { slots, height: slots.length > 0 ? y + rowHeight : 0 };
}

function lengths(line: Point2[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    out.push(
      out[i - 1] +
        Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
    );
  }
  return out;
}

function pointAt(line: Point2[], acc: number[], s: number): Point2 {
  for (let i = 1; i < line.length; i++) {
    if (s <= acc[i] || i === line.length - 1) {
      const span = acc[i] - acc[i - 1];
      const t =
        span > 0 ? Math.min(Math.max((s - acc[i - 1]) / span, 0), 1) : 0;
      return [
        line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
        line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
      ];
    }
  }
  return line[0];
}

/**
 * The stretch of a label's line its lettering covers: `length` metres
 * centred on the line's middle, sampled every `step` metres, running west
 * to east so the text reads left to right (a line drawn westward is
 * turned round). `s` is each sample's distance from the text's start.
 */
export function labelPath(
  line: Point2[],
  length: number,
  step: number
): { pts: Point2[]; s: number[] } {
  if (line.length < 2) {
    return { pts: [], s: [] };
  }
  const first = line[0];
  const last = line.at(-1) ?? first;
  const path = last[0] < first[0] ? [...line].reverse() : line;
  const acc = lengths(path);
  const total = acc.at(-1) ?? 0;
  const len = Math.min(length, total);
  const s0 = (total - len) / 2;
  const n = Math.max(Math.ceil(len / step), 1);
  const pts: Point2[] = [];
  const s: number[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (len * i) / n;
    pts.push(pointAt(path, acc, s0 + d));
    s.push(d);
  }
  return { pts, s };
}

/** Distance from a point to a segment. */
function toSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t =
    l2 > 0
      ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0), 1)
      : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/** A named line the caption looks up. */
export interface NamedWay {
  line: Point2[];
  name: string;
}

/** The name of the nearest way within `radius` of (x, y), or null. */
export function nearestName(
  ways: Iterable<NamedWay>,
  x: number,
  y: number,
  radius = CAPTION_RADIUS_M
): string | null {
  let best: string | null = null;
  let bestD = radius;
  const p: Point2 = [x, y];
  for (const way of ways) {
    for (let i = 1; i < way.line.length; i++) {
      const a = way.line[i - 1];
      const b = way.line[i];
      // cheap reject on the segment's box
      if (
        Math.min(a[0], b[0]) - bestD > x ||
        Math.max(a[0], b[0]) + bestD < x ||
        Math.min(a[1], b[1]) - bestD > y ||
        Math.max(a[1], b[1]) + bestD < y
      ) {
        continue;
      }
      const d = toSegment(p, a, b);
      if (d <= bestD) {
        bestD = d;
        best = way.name;
      }
    }
  }
  return best;
}
