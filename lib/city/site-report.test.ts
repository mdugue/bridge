import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HAMBURG } from "../../sites/hamburg";
import { LEIPZIG } from "../../sites/leipzig";
import {
  DLM_LAYERS,
  siteReport,
  siteSummary,
  tileReport,
  walkViewpointIssue,
} from "./site-report";

const TILE = "33316_5690_2_sn";

test("nothing on disk: fetch first, and every required file is missing", () => {
  const r = tileReport(LEIPZIG, TILE, () => false);
  expect(r.next).toBe("fetch");
  expect(r.missing).toContain(
    "data/leipzig/dgm/dgm1_33316_5690_2_sn_tiff/dgm1_33316_5690_2_sn.tif"
  );
  expect(r.missing).toContain("data/leipzig/dlm/landcover_33316_5690_2_sn.png");
});

test("fetched but not baked: bake next", () => {
  const r = tileReport(
    LEIPZIG,
    TILE,
    (p) => p.startsWith("data/_raw/sn/") || !p.includes("/dlm/")
  );
  expect(r.next).toBe("bake");
  expect(r.missing.every((p) => p.includes("/dlm/"))).toBe(true);
});

test("a tile that builds is ready even without the raw downloads", () => {
  const r = tileReport(LEIPZIG, TILE, (p) => !p.startsWith("data/_raw/"));
  expect(r.next).toBe("ready");
});

test("everything there: ready, nothing absent", () => {
  expect(siteReport(LEIPZIG, () => true).every((r) => r.next === "ready")).toBe(
    true
  );
});

test("a provider without an open DLM says so", () => {
  expect(siteSummary(HAMBURG).join("\n")).toContain(
    "land cover from OpenStreetMap"
  );
  expect(siteSummary(LEIPZIG).join("\n")).toContain("the Basis-DLM");
});

test("the DLM layer list is the pipeline's", () => {
  const python = readFileSync("pipeline/bake/common.py", "utf8");
  const block = python.match(/DLM_LAYERS = \(([^)]*)\)/u)?.[1] ?? "";
  const layers = [...block.matchAll(/"(\w+)"/gu)].map((m) => m[1]);
  expect(layers).toEqual([...DLM_LAYERS]);
});

test("a walk viewpoint in a footprint or on water is flagged", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const land = () => 4;
  expect(walkViewpointIssue({ x: 5, y: 5 }, [square], land, 8)).toBe(
    "inside a building"
  );
  expect(walkViewpointIssue({ x: 15, y: 5 }, [square], land, 8)).toBeNull();
  expect(walkViewpointIssue({ x: 15, y: 5 }, [], () => 8, 8)).toBe("on water");
});
