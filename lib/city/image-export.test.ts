import { describe, expect, test } from "bun:test";
import {
  exportFileName,
  exportScale,
  exportTiles,
  printScaleOf,
  studyPanels,
} from "./image-export";

describe("exportTiles", () => {
  test("a picture the size of the view is one tile", () => {
    expect(exportTiles(800, 600, 800, 600)).toEqual([
      {
        offsetX: 0,
        offsetY: 0,
        srcX: 0,
        srcY: 0,
        dstX: 0,
        dstY: 0,
        w: 800,
        h: 600,
      },
    ]);
  });

  test("the kept rectangles cover the picture once", () => {
    const fullW = 2400;
    const fullH = 1800;
    const tiles = exportTiles(fullW, fullH, 800, 600, 32);
    const covered = new Uint8Array(fullW * fullH);
    for (const t of tiles) {
      expect(t.srcX + t.w).toBeLessThanOrEqual(800);
      expect(t.srcY + t.h).toBeLessThanOrEqual(600);
      // the kept part lies where the view offset put it
      expect(t.offsetX + t.srcX).toBe(t.dstX);
      expect(t.offsetY + t.srcY).toBe(t.dstY);
      for (let y = 0; y < fullH; y += 50) {
        for (let x = 0; x < fullW; x += 50) {
          const inside =
            x >= t.dstX && x < t.dstX + t.w && y >= t.dstY && y < t.dstY + t.h;
          covered[y * fullW + x] += inside ? 1 : 0;
        }
      }
    }
    for (let y = 0; y < fullH; y += 50) {
      for (let x = 0; x < fullW; x += 50) {
        expect(covered[y * fullW + x]).toBe(1);
      }
    }
  });
});

describe("exportScale", () => {
  const hd = 1280 * 720;
  test("a parallel view is rendered up to the tier's density", () => {
    expect(exportScale(1, "desktop", true, hd)).toBe(3);
    expect(exportScale(2, "desktop", true, hd)).toBe(1.5);
    expect(exportScale(2, "mobile", true, hd)).toBe(1);
    expect(exportScale(3, "mobile", true, hd)).toBe(1);
  });

  test("within the caps: four times the canvas, 25 million pixels", () => {
    // the lite profile's half pixel ratio would ask for six
    expect(exportScale(0.5, "desktop", true, 500 * 350)).toBe(4);
    const big = 3840 * 2160;
    const s = exportScale(1, "desktop", true, big);
    expect(s * s * big).toBeCloseTo(25_000_000, -3);
  });

  test("a perspective frame is taken as it is", () => {
    expect(exportScale(1, "desktop", false, hd)).toBe(1);
  });
});

test("printScaleOf: a metre per pixel at 300 dpi is 1 : 11 811", () => {
  expect(Math.round(printScaleOf(1))).toBe(11_811);
});

test("exportFileName", () => {
  expect(
    exportFileName("dresden", "Isometrie", new Date(2026, 5, 21, 15, 0))
  ).toBe("dresden-isometrie-2026-06-21-1500.png");
  expect(
    exportFileName(
      "muenchen",
      "Verschattung (Militär)",
      new Date(2026, 2, 1, 9, 5)
    )
  ).toBe("muenchen-verschattung-militaer-2026-03-01-0905.png");
});

test("studyPanels: a row per date, a column per hour", () => {
  const panels = studyPanels(2026);
  expect(panels).toHaveLength(12);
  expect(panels[0]).toEqual({ row: 0, col: 0, date: new Date(2026, 2, 21, 9) });
  expect(panels[11]).toEqual({
    row: 2,
    col: 3,
    date: new Date(2026, 11, 21, 18),
  });
});
