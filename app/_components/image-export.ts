/**
 * *Bild speichern* and the *Verschattungsstudie* (plan 055, ADR 0044): the
 * captured frame (create-app.ts `captureImage`) with a legend strip drawn
 * under it — scale bar, north arrow, the view and its printed scale, the
 * instant, the sources' credits (dl-de/by-2-0 asks for the source with the
 * picture) — and the download. The strip is drawn into the file, never
 * into the scene (ADR 0042). The pure half is lib/city/image-export.ts.
 */
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  exportFileName,
  PRINT_DPI,
  printScaleOf,
  STUDY_DATES,
  STUDY_HOURS,
  studyPanels,
} from "@/lib/city/image-export";
import {
  MODEL_PRESET_BY_ID,
  northArrowDeg,
  scaleBarFor,
  scaleLabel,
} from "@/lib/city/model-view";
import { RENDER_STYLE_BY_ID, type RenderStyle } from "@/lib/city/render-style";
import { type Site, siteAttribution } from "@/lib/city/site";
import type { CapturedImage, CityWalkHandle } from "./create-app";
import type { ModelHud } from "./model-rig";

/** What the legend says besides the picture. */
export interface ExportContext {
  site: Site;
  /** the scene's instant */
  date: Date;
  /** Modell's view, or null for a perspective frame */
  model: ModelHud | null;
  style: RenderStyle;
}

const PAPER = "#ffffff";
const INK = "#1d1f24";
const MUTED = "#5b606b";
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Splits text into lines no wider than `width` in the context's font. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

/** The north arrow, centred at (x, y), `r` its radius. */
function drawNorthArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  deg: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 0.06;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate((deg * Math.PI) / 180);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.82);
  ctx.lineTo(r * 0.32, r * 0.5);
  ctx.lineTo(0, r * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.82);
  ctx.lineTo(-r * 0.32, r * 0.5);
  ctx.lineTo(0, r * 0.28);
  ctx.closePath();
  ctx.stroke();
  ctx.font = `600 ${r * 0.5}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", 0, -r * 0.86);
  ctx.restore();
}

/** The scale bar, its left end at (x, y) (the bar's top edge). */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  metresPerPx: number,
  maxPx: number,
  unit: number
): void {
  const bar = scaleBarFor(metresPerPx, maxPx);
  const h = 6 * unit;
  const q = bar.px / 4;
  ctx.lineWidth = Math.max(1, unit);
  ctx.strokeStyle = INK;
  const segments: [number, number, string][] = [
    [0, q, INK],
    [q, q, PAPER],
    [2 * q, 2 * q, INK],
  ];
  for (const [from, w, fill] of segments) {
    ctx.fillStyle = fill;
    ctx.fillRect(x + from, y, w, h);
    ctx.strokeRect(x + from, y, w, h);
  }
  ctx.fillStyle = INK;
  ctx.font = `${10 * unit}px ${FONT}`;
  ctx.textBaseline = "top";
  const labelY = y + h + 3 * unit;
  ctx.textAlign = "left";
  ctx.fillText(bar.labels[0], x, labelY);
  ctx.textAlign = "center";
  ctx.fillText(bar.labels[1], x + bar.px / 2, labelY);
  ctx.textAlign = "right";
  ctx.fillText(bar.labels[2], x + bar.px, labelY);
}

/** The legend's middle lines: what, how, when. */
function legendLines(
  info: ExportContext,
  metresPerImagePx: number | null,
  heading: string | null
): string[] {
  const style = RENDER_STYLE_BY_ID[info.style].label;
  const view = info.model
    ? `${MODEL_PRESET_BY_ID[info.model.preset].label} · ${style}`
    : `Perspektive · ${style}`;
  const scale =
    metresPerImagePx === null
      ? null
      : `${scaleLabel(printScaleOf(metresPerImagePx))} bei ${PRINT_DPI} dpi`;
  return [
    info.site.label,
    scale ? `${view} · ${scale}` : view,
    heading ?? format(info.date, "d. MMMM yyyy · HH:mm 'Uhr'", { locale: de }),
  ];
}

/**
 * The legend strip under a picture `width` px wide; `unit` image px per
 * CSS px. Returns its height; draws it when given a y.
 */
function legend(
  ctx: CanvasRenderingContext2D,
  width: number,
  unit: number,
  info: ExportContext,
  metresPerImagePx: number | null,
  heading: string | null,
  y: number | null
): number {
  const pad = 14 * unit;
  const creditW = Math.min(width * 0.42, 420 * unit);
  ctx.font = `${9 * unit}px ${FONT}`;
  const credits = siteAttribution(info.site).flatMap((line) =>
    wrap(ctx, line, creditW)
  );
  const creditH = credits.length * 12 * unit;
  const height = Math.max(70 * unit, creditH + 2 * pad);
  if (y === null) {
    return height;
  }
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, y, width, height);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, unit);
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5 * unit);
  ctx.lineTo(width, y + 0.5 * unit);
  ctx.stroke();
  let x = pad;
  if (info.model && metresPerImagePx !== null) {
    const r = 20 * unit;
    drawNorthArrow(ctx, x + r, y + height / 2, r, northArrowDeg(info.model));
    x += 2 * r + pad;
    drawScaleBar(
      ctx,
      x,
      y + height / 2 - 8 * unit,
      metresPerImagePx,
      160 * unit,
      unit
    );
    x += 160 * unit + pad;
  }
  const lines = legendLines(info, metresPerImagePx, heading);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? INK : MUTED;
    ctx.font = `${i === 0 ? 600 : 400} ${(i === 0 ? 12 : 10) * unit}px ${FONT}`;
    ctx.fillText(
      line,
      x,
      y + pad + i * 15 * unit,
      width - x - creditW - 2 * pad
    );
  });
  ctx.fillStyle = MUTED;
  ctx.font = `${9 * unit}px ${FONT}`;
  ctx.textAlign = "right";
  credits.forEach((line, i) => {
    ctx.fillText(line, width - pad, y + pad + i * 12 * unit);
  });
  return height;
}

/** A picture with its legend strip under it. */
function withLegend(
  image: CapturedImage,
  info: ExportContext
): HTMLCanvasElement {
  const { canvas } = image;
  const unit = Math.max(1, image.imagePxPerCssPx);
  const mpp = info.model
    ? info.model.metresPerPixel / image.imagePxPerCssPx
    : null;
  const out = document.createElement("canvas");
  const probe = out.getContext("2d");
  if (!probe) {
    throw new Error("2D canvas unsupported");
  }
  const strip = legend(probe, canvas.width, unit, info, mpp, null, null);
  out.width = canvas.width;
  out.height = canvas.height + Math.ceil(strip);
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas unsupported");
  }
  ctx.drawImage(canvas, 0, 0);
  legend(ctx, canvas.width, unit, info, mpp, null, canvas.height);
  return out;
}

/** Hands the canvas to the browser as a PNG download. */
function download(canvas: HTMLCanvasElement, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Das Bild ließ sich nicht kodieren"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // after the click has handed the file over
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      resolve();
    }, "image/png");
  });
}

/** The name of the view, for a file. */
function viewName(info: ExportContext): string {
  return info.model
    ? MODEL_PRESET_BY_ID[info.model.preset].label
    : "Perspektive";
}

/** Bild speichern: the next frame, its legend, the download. */
export async function saveImage(
  h: CityWalkHandle,
  info: ExportContext
): Promise<void> {
  const image = await h.captureImage();
  await download(
    withLegend(image, info),
    exportFileName(info.site.id, viewName(info), info.date)
  );
}

/** The sheet is no wider than this (image px). */
const SHEET_MAX_W = 6000;

/**
 * The Verschattungsstudie: the same view at 9, 12, 15 and 18 Uhr on
 * 21 March, 21 June and 21 December of the scene's year, one sheet (a row
 * per date). The scene's own instant is put back afterwards.
 */
export async function saveShadowStudy(
  h: CityWalkHandle,
  info: ExportContext,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const panels = studyPanels(info.date.getFullYear());
  const cols = STUDY_HOURS.length;
  const rows = STUDY_DATES.length;
  let sheet: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let f = 1;
  let unit = 1;
  let labelW = 0;
  let labelH = 0;
  let first: CapturedImage | null = null;
  try {
    for (const [i, panel] of panels.entries()) {
      h.setSun(panel.date);
      const image = await h.captureImage();
      if (!sheet) {
        first = image;
        f = Math.min(1, SHEET_MAX_W / (cols * image.canvas.width));
        unit = Math.max(1, image.imagePxPerCssPx * f * 1.5);
        labelW = 96 * unit;
        labelH = 24 * unit;
        sheet = document.createElement("canvas");
        sheet.width = Math.round(labelW + cols * image.canvas.width * f);
        sheet.height = Math.round(labelH + rows * image.canvas.height * f);
        ctx = sheet.getContext("2d");
        if (!ctx) {
          throw new Error("2D canvas unsupported");
        }
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, sheet.width, sheet.height);
      }
      const w = image.canvas.width * f;
      const hgt = image.canvas.height * f;
      ctx?.drawImage(
        image.canvas,
        labelW + panel.col * w,
        labelH + panel.row * hgt,
        w,
        hgt
      );
      onProgress?.(i + 1, panels.length);
    }
  } finally {
    h.setSun(info.date);
  }
  if (!(sheet && ctx && first)) {
    return;
  }
  const w = first.canvas.width * f;
  const hgt = first.canvas.height * f;
  ctx.fillStyle = INK;
  ctx.font = `600 ${11 * unit}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  STUDY_HOURS.forEach((hour, col) => {
    ctx.fillText(`${hour}:00 Uhr`, labelW + (col + 0.5) * w, labelH / 2);
  });
  ctx.textAlign = "left";
  STUDY_DATES.forEach((d, row) => {
    ctx.fillText(d.label, 8 * unit, labelH + (row + 0.5) * hgt);
  });
  // the panels' hairlines
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 2 * unit;
  for (let c = 1; c < cols; c++) {
    ctx.beginPath();
    ctx.moveTo(labelW + c * w, labelH);
    ctx.lineTo(labelW + c * w, sheet.height);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(labelW, labelH + r * hgt);
    ctx.lineTo(sheet.width, labelH + r * hgt);
    ctx.stroke();
  }
  const mpp = info.model
    ? info.model.metresPerPixel / (first.imagePxPerCssPx * f)
    : null;
  const heading = `Verschattungsstudie ${info.date.getFullYear()} · Ortszeit`;
  const strip = legend(ctx, sheet.width, unit, info, mpp, heading, null);
  const out = document.createElement("canvas");
  out.width = sheet.width;
  out.height = sheet.height + Math.ceil(strip);
  const octx = out.getContext("2d");
  if (!octx) {
    throw new Error("2D canvas unsupported");
  }
  octx.drawImage(sheet, 0, 0);
  legend(octx, sheet.width, unit, info, mpp, heading, sheet.height);
  await download(
    out,
    exportFileName(info.site.id, `Verschattung ${viewName(info)}`, info.date)
  );
}
