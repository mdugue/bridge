/**
 * *Bild speichern* (plan 055, ADR 0044): the pure half of the export. A
 * picture larger than the canvas is rendered as overlapping tiles of the
 * canvas's size — a parallel camera's view offset slides the frustum, so
 * no tile costs more GPU memory than a frame — and each tile's margin is
 * cut away again, where the screen-space passes (contact shadows, ink,
 * SMAA) see the frame's edge. The printed scale is the picture's own:
 * metres per image pixel at 300 dpi. No DOM; the canvas work is
 * app/_components/image-export.ts.
 */

/** Image px each side of a tile that is rendered and thrown away. */
export const TILE_MARGIN_PX = 32;

/** The print resolution the legend states the scale for. */
export const PRINT_DPI = 300;

/** Image px per CSS px the export aims at, by device tier. */
export const EXPORT_DENSITY = { desktop: 3, mobile: 2 } as const;

/** One tile: where its view sits in the full picture, and what it keeps. */
export interface ExportTile {
  /** the view offset (image px, may be negative at the edges) */
  offsetX: number;
  offsetY: number;
  /** the kept rectangle: from (srcX, srcY) in the tile to (dstX, dstY) */
  srcX: number;
  srcY: number;
  dstX: number;
  dstY: number;
  w: number;
  h: number;
}

/**
 * The tiles that cover a `fullW` × `fullH` picture with views of
 * `viewW` × `viewH`, each keeping all but `margin` px around it. One tile,
 * margin-free, when the picture is the view.
 */
export function exportTiles(
  fullW: number,
  fullH: number,
  viewW: number,
  viewH: number,
  margin = TILE_MARGIN_PX
): ExportTile[] {
  if (fullW <= viewW && fullH <= viewH) {
    return [
      {
        offsetX: 0,
        offsetY: 0,
        srcX: 0,
        srcY: 0,
        dstX: 0,
        dstY: 0,
        w: fullW,
        h: fullH,
      },
    ];
  }
  const m = Math.max(
    0,
    Math.min(margin, Math.floor(Math.min(viewW, viewH) / 4))
  );
  const stepX = viewW - 2 * m;
  const stepY = viewH - 2 * m;
  const tiles: ExportTile[] = [];
  for (let dstY = 0; dstY < fullH; dstY += stepY) {
    for (let dstX = 0; dstX < fullW; dstX += stepX) {
      tiles.push({
        offsetX: dstX - m,
        offsetY: dstY - m,
        srcX: m,
        srcY: m,
        dstX,
        dstY,
        w: Math.min(stepX, fullW - dstX),
        h: Math.min(stepY, fullH - dstY),
      });
    }
  }
  return tiles;
}

/** The picture is never more than this many times the canvas... */
export const EXPORT_MAX_SCALE = 4;
/** ...nor more than this many pixels (a PNG of ~25 MP, a 2D canvas of 100 MB). */
export const EXPORT_MAX_PIXELS = 25_000_000;

/**
 * How much larger than the canvas the picture is rendered: the tier's
 * density over the canvas's own pixel ratio, never below 1, within the
 * caps above. Only a parallel view is tiled — a perspective frame's
 * vignette and depth of field belong to the whole frame.
 */
export function exportScale(
  pixelRatio: number,
  tier: keyof typeof EXPORT_DENSITY,
  parallel: boolean,
  canvasPixels: number
): number {
  if (!parallel) {
    return 1;
  }
  const wanted = EXPORT_DENSITY[tier] / Math.max(pixelRatio, 0.25);
  const fits = Math.sqrt(EXPORT_MAX_PIXELS / Math.max(canvasPixels, 1));
  return Math.max(1, Math.min(wanted, EXPORT_MAX_SCALE, fits));
}

/** The scale denominator of a picture printed at `dpi`. */
export function printScaleOf(
  metresPerImagePx: number,
  dpi = PRINT_DPI
): number {
  return metresPerImagePx / (0.0254 / dpi);
}

/** "dresden-isometrie-2026-06-21-1500.png" */
export function exportFileName(
  siteId: string,
  what: string,
  date: Date
): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const slug = what
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}`;
  return `${siteId}-${slug}-${day}-${time}.png`;
}

// --- the shadow study ------------------------------------------------------

/** The study's dates: the equinox and the two solstices (month, day). */
export const STUDY_DATES = [
  { month: 2, day: 21, label: "21. März" },
  { month: 5, day: 21, label: "21. Juni" },
  { month: 11, day: 21, label: "21. Dezember" },
] as const;

/** The study's hours (local time). */
export const STUDY_HOURS = [9, 12, 15, 18] as const;

/** One panel of a study sheet: its instant and its place in the grid. */
export interface StudyPanel {
  row: number;
  col: number;
  date: Date;
}

/** The sheet: a row per date of `year`, a column per hour. */
export function studyPanels(
  year: number,
  dates: readonly { month: number; day: number }[] = STUDY_DATES,
  hours: readonly number[] = STUDY_HOURS
): StudyPanel[] {
  return dates.flatMap((d, row) =>
    hours.map((hour, col) => ({
      row,
      col,
      date: new Date(year, d.month, d.day, hour, 0),
    }))
  );
}
