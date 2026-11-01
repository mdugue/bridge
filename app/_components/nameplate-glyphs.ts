/**
 * The nameplate's lettering as geometry (nameplate-layer.ts): each letter
 * of its title and lines rasterised once in the page's own web font, turned
 * into a signed distance field (lib/city/sdf.ts) and packed into a one-byte
 * atlas holding only the letters this plate shows (≤ 0.5 MB, 512 × 1024 R8,
 * freed with the plate); then one quad per letter, set with the canvas's
 * own advances (its kerning) and the style's tracking, in the plate's own
 * units — one title capital high. The comic's caption box is three quads
 * under the text (its shadow, its edge, its fill), and the whole block
 * leans by its tilt.
 */
import type { NameplateText } from "@/lib/city/nameplate";
import {
  NAMEPLATE_FACE_VARS,
  type NameplateFace,
  type NameplateSetting,
  type NameplateType,
  linesSize,
} from "@/lib/city/nameplate-type";
import { signedDistanceField } from "@/lib/city/sdf";

/** Raster sizes (px) the letters are drawn at: large enough that the
 *  field stays sharp at a sign's largest, small enough for one atlas. */
const TITLE_PX = 64;
const LINES_PX = 40;
/** The field's reach (px) — also each letter's margin in the atlas. */
export const FIELD_RADIUS = 8;

/** How finely the letters are rasterised: the title's and the lines' size
 *  (px) and the field's reach (px), in proportion. A phone's plates are at
 *  most 48 CSS px high: ~0.4 of the bytes there (ADR 0047). */
export interface PlateResolution {
  linesPx: number;
  radius: number;
  titlePx: number;
}
export const DESKTOP_RESOLUTION: PlateResolution = {
  titlePx: TITLE_PX,
  linesPx: LINES_PX,
  radius: FIELD_RADIUS,
};
export const PHONE_RESOLUTION: PlateResolution = {
  titlePx: 40,
  linesPx: 26,
  radius: 5,
};
const ATLAS_WIDTH = 512;
const ATLAS_MAX_HEIGHT = 1024;
/** The gap between the title's baseline area and the lines, the lines'
 *  leading, in their own capitals. */
const TITLE_GAP = 0.55;
const LINE_LEADING = 1.75;
/** Room under the last baseline for descenders, over the title for
 *  accents, in title caps. */
const FOOT = 0.32;
const HEAD = 0.3;

/** What a vertex is painted with: the title's ink, the lines', the box's
 *  fill, edge and shadow. */
export const PAINT = {
  title: 0,
  lines: 1,
  boxFill: 2,
  boxEdge: 3,
  shadow: 4,
} as const;
export type Paint = (typeof PAINT)[keyof typeof PAINT];

/** A quad's kind, the third component of its `uvk`: a letter (its field),
 *  a solid (its uv antialiases the edges), a disc. */
export const KIND = { glyph: 0, solid: 1, disc: 2 } as const;

export type Align = "left" | "center" | "right";

/** A plate's letters rasterised once for its text and type: the field
 *  atlas and each line's glyphs, laid out by `layPlate` for any alignment
 *  without rasterising again. */
export interface PlateRaster {
  /** the field atlas (R8) */
  atlas: { data: Uint8Array; height: number; width: number };
  lineCap: number;
  lines: SetLine[];
  title: SetLine;
  type: NameplateType;
}

export interface PlateGeometry {
  /** the block's size in title caps (the box's included) */
  block: { height: number; width: number };
  index: Uint16Array;
  /** per vertex: what paints it (`PAINT`) */
  paint: Uint8Array;
  /** per vertex x, y, 0 in title caps, the block's lower left at 0 */
  positions: Float32Array;
  /** per vertex u, v and the kind */
  uvk: Float32Array;
}

/** The family a face's CSS variable names (set by app/[site]/page.tsx),
 *  read off the page; the system's serif or sans where it is missing. */
export function faceFamily(face: NameplateFace, from: Element): string {
  const value = getComputedStyle(from)
    .getPropertyValue(NAMEPLATE_FACE_VARS[face])
    .trim();
  if (value) {
    return value;
  }
  return face === "serif" || face === "serifCaps" ? "serif" : "sans-serif";
}

const fontOf = (s: NameplateSetting, px: number, from: Element) =>
  `${s.weight} ${px}px ${faceFamily(s.face, from)}`;

/** Whether the type's faces are loaded already for `text` (the letters
 *  set now are their own, not a fallback's; a face comes in parts by
 *  script, Latin Extended for a Polish or Czech name). */
export function facesReady(
  type: NameplateType,
  from: Element,
  text: string
): boolean {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return true;
  }
  return [
    fontOf(type.title, TITLE_PX, from),
    fontOf(type.lines, LINES_PX, from),
  ].every((f) => document.fonts.check(f, text));
}

/** Loads the faces a type sets (the browser fetches a face on first use:
 *  the page only declares them). */
export async function loadFaces(
  type: NameplateType,
  from: Element,
  text: string
): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return;
  }
  await Promise.all(
    [
      fontOf(type.title, TITLE_PX, from),
      fontOf(type.lines, LINES_PX, from),
    ].map((f) => document.fonts.load(f, text).catch(() => []))
  );
}

interface Glyph {
  /** its place in the atlas (px) */
  ax: number;
  ay: number;
  /** its bitmap's size with the margin (px) */
  bw: number;
  bh: number;
  /** from the pen and the baseline to the bitmap's left and top (px) */
  left: number;
  top: number;
  field: Uint8Array;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function context(width: number, height: number): Ctx | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", { willReadFrequently: true });
}

/** One letter's field, drawn in `font`. */
function rasterise(ctx: Ctx, font: string, ch: string, r: number): Glyph {
  ctx.font = font;
  const m = ctx.measureText(ch);
  const left = Math.ceil(m.actualBoundingBoxLeft);
  const right = Math.ceil(m.actualBoundingBoxRight);
  const asc = Math.ceil(m.actualBoundingBoxAscent);
  const desc = Math.ceil(m.actualBoundingBoxDescent);
  const bw = Math.max(left + right, 1) + 2 * r;
  const bh = Math.max(asc + desc, 1) + 2 * r;
  ctx.clearRect(0, 0, bw, bh);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(ch, r + left, r + asc);
  const rgba = ctx.getImageData(0, 0, bw, bh).data;
  const alpha = new Uint8Array(bw * bh);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = rgba[i * 4 + 3];
  }
  return {
    ax: 0,
    ay: 0,
    bw,
    bh,
    left: -left - r,
    top: asc + r,
    field: signedDistanceField(alpha, bw, bh, r),
  };
}

interface SetLine {
  /** px from the line's start to each letter's pen */
  pens: number[];
  glyphs: Glyph[];
  /** the line's capital height (px), its width (px) */
  cap: number;
  width: number;
  /** px to plate units */
  scale: number;
  paint: Paint;
}

function setLine(
  ctx: Ctx,
  text: string,
  setting: NameplateSetting,
  px: number,
  radius: number,
  from: Element,
  cache: Map<string, Glyph>,
  paint: Paint
): SetLine {
  const font = fontOf(setting, px, from);
  ctx.font = font;
  const shown = setting.upper ? text.toLocaleUpperCase("de-DE") : text;
  // reason: plate text is names and years; code points are what canvas measures
  // oxlint-disable-next-line no-misused-spread
  const chars = [...shown];
  const tracking = setting.tracking * px;
  const pens: number[] = [];
  const glyphs: Glyph[] = [];
  let prefix = "";
  for (const [i, ch] of chars.entries()) {
    // the pen where the letter starts with its kern to the one before:
    // the run through it, less its own advance
    prefix += ch;
    pens.push(
      ctx.measureText(prefix).width - ctx.measureText(ch).width + i * tracking
    );
    const key = `${font}\u0000${ch}`;
    let g = cache.get(key);
    if (!g) {
      g = rasterise(ctx, font, ch, radius);
      cache.set(key, g);
      ctx.font = font;
    }
    glyphs.push(g);
  }
  const width =
    ctx.measureText(shown).width + Math.max(chars.length - 1, 0) * tracking;
  const cap = ctx.measureText("H").actualBoundingBoxAscent || px * 0.7;
  return { pens, glyphs, cap, width, scale: 1, paint };
}

/** Shelf-packs the glyphs into the atlas; false when they do not fit. */
function pack(glyphs: Glyph[]): { height: number } | null {
  let x = 0;
  let y = 0;
  let row = 0;
  for (const g of [...glyphs].sort((a, b) => b.bh - a.bh)) {
    if (x + g.bw > ATLAS_WIDTH) {
      x = 0;
      y += row;
      row = 0;
    }
    g.ax = x;
    g.ay = y;
    x += g.bw;
    row = Math.max(row, g.bh);
  }
  const used = y + row;
  if (used > ATLAS_MAX_HEIGHT) {
    return null;
  }
  let height = 64;
  while (height < used) {
    height *= 2;
  }
  return { height };
}

class Builder {
  positions: number[] = [];
  uvk: number[] = [];
  paint: number[] = [];
  index: number[] = [];
  quad(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    uv: [number, number, number, number],
    kind: number,
    paint: Paint
  ) {
    const base = this.positions.length / 3;
    this.positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
    const [u0, v0, u1, v1] = uv;
    this.uvk.push(u0, v0, kind, u1, v0, kind, u1, v1, kind, u0, v1, kind);
    this.paint.push(paint, paint, paint, paint);
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/**
 * The plate's letters for its text in a type; null where the page cannot
 * draw letters (no canvas) or they do not fit the atlas.
 */
export function rasterPlate(
  text: NameplateText,
  type: NameplateType,
  from: Element,
  res: PlateResolution = DESKTOP_RESOLUTION
): PlateRaster | null {
  const ctx = context(256, 256);
  if (!ctx) {
    return null;
  }
  const cache = new Map<string, Glyph>();
  const title = setLine(
    ctx,
    text.title,
    type.title,
    res.titlePx,
    res.radius,
    from,
    cache,
    PAINT.title
  );
  const lines = text.lines.map((l) =>
    setLine(
      ctx,
      l,
      type.lines,
      res.linesPx,
      res.radius,
      from,
      cache,
      PAINT.lines
    )
  );
  // plate units: one title capital
  title.scale = 1 / title.cap;
  const lineCap = linesSize(type, text.rank);
  for (const l of lines) {
    l.scale = lineCap / l.cap;
  }
  const glyphs = [...cache.values()];
  const packed = pack(glyphs);
  if (!packed) {
    return null;
  }
  const atlas = new Uint8Array(ATLAS_WIDTH * packed.height);
  for (const g of glyphs) {
    for (let row = 0; row < g.bh; row++) {
      atlas.set(
        g.field.subarray(row * g.bw, (row + 1) * g.bw),
        (g.ay + row) * ATLAS_WIDTH + g.ax
      );
    }
    // in the atlas now: the layout reads the glyph's metrics only
    g.field = new Uint8Array(0);
  }
  return {
    atlas: { data: atlas, width: ATLAS_WIDTH, height: packed.height },
    lineCap,
    lines,
    title,
    type,
  };
}

/**
 * The plate's geometry, aligned within its block: with its small lines,
 * or the title alone (from far).
 */
export function layPlate(
  raster: PlateRaster,
  align: Align,
  withLines: boolean
): PlateGeometry {
  const { title, lineCap, type } = raster;
  const lines = withLines ? raster.lines : [];
  const atlasHeight = raster.atlas.height;
  // baselines from the foot up: the last line first
  const baselines: number[] = [];
  let y = FOOT * (lines.length > 0 ? lineCap : 1);
  for (let i = lines.length - 1; i >= 0; i--) {
    baselines[i] = y;
    y += LINE_LEADING * lineCap;
  }
  const titleBase =
    lines.length > 0 ? y - LINE_LEADING * lineCap + lineCap + TITLE_GAP : y;
  const height = titleBase + 1 + HEAD;
  const widthOf = (l: SetLine) => l.width * l.scale;
  const width = Math.max(widthOf(title), ...lines.map(widthOf));
  const b = new Builder();
  const box = type.box;
  const pad = box?.pad ?? 0;
  if (box) {
    const x0 = -pad;
    const y0 = -pad * 0.6;
    const x1 = width + pad;
    const y1 = height + pad * 0.4;
    const edge = 0.09;
    const solid: [number, number, number, number] = [0, 0, 1, 1];
    b.quad(
      x0 - edge + box.shadow,
      y0 - edge - box.shadow,
      x1 + edge + box.shadow,
      y1 + edge - box.shadow,
      solid,
      KIND.solid,
      PAINT.shadow
    );
    b.quad(
      x0 - edge,
      y0 - edge,
      x1 + edge,
      y1 + edge,
      solid,
      KIND.solid,
      PAINT.boxEdge
    );
    b.quad(x0, y0, x1, y1, solid, KIND.solid, PAINT.boxFill);
  }
  const place = (l: SetLine, baseline: number) => {
    const w = widthOf(l);
    const start =
      align === "left" ? 0 : align === "right" ? width - w : (width - w) / 2;
    for (const [i, g] of l.glyphs.entries()) {
      const x0 = start + (l.pens[i] + g.left) * l.scale;
      const y1 = baseline + g.top * l.scale;
      b.quad(
        x0,
        y1 - g.bh * l.scale,
        x0 + g.bw * l.scale,
        y1,
        [
          g.ax / ATLAS_WIDTH,
          (g.ay + g.bh) / atlasHeight,
          (g.ax + g.bw) / ATLAS_WIDTH,
          g.ay / atlasHeight,
        ],
        KIND.glyph,
        l.paint
      );
    }
  };
  place(title, titleBase);
  for (const [i, l] of lines.entries()) {
    place(l, baselines[i]);
  }
  const positions = new Float32Array(b.positions);
  if (box && box.tilt !== 0) {
    // the block leans round its middle
    const a = (box.tilt * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - cx;
      const dy = positions[i + 1] - cy;
      positions[i] = cx + dx * Math.cos(a) - dy * Math.sin(a);
      positions[i + 1] = cy + dx * Math.sin(a) + dy * Math.cos(a);
    }
  }
  if (pad > 0) {
    // the block's lower left at 0, the box included
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += pad;
      positions[i + 1] += pad * 0.6;
    }
  }
  return {
    block: { width: width + 2 * pad, height: height + pad },
    index: new Uint16Array(b.index),
    paint: new Uint8Array(b.paint),
    positions,
    uvk: new Float32Array(b.uvk),
  };
}
