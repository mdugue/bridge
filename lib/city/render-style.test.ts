import { expect, test } from "bun:test";
import {
  DEFAULT_RENDER_STYLE,
  isRenderStyle,
  nextRenderStyle,
  RENDER_STYLE_BY_ID,
  RENDER_STYLES,
} from "./render-style";

test("every style has a unique id and a unique shader mode", () => {
  const ids = RENDER_STYLES.map((def) => def.id);
  const modes = RENDER_STYLES.map((def) => def.shaderMode);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(modes).size).toBe(modes.length);
  for (const def of RENDER_STYLES) {
    expect(RENDER_STYLE_BY_ID[def.id]).toBe(def);
  }
});

test("the default style is the pastel one, and it costs no pass", () => {
  const pastel = RENDER_STYLE_BY_ID[DEFAULT_RENDER_STYLE];
  expect(pastel.id).toBe("pastel");
  // Mode 0 switches the stylize pass off (post-stack.ts) — the default look
  // must render exactly as before the styles existed.
  expect(pastel.shaderMode).toBe(0);
  expect(pastel.inkWeight).toBe(0);
  expect(pastel.gradingWeight).toBe(1);
  expect(pastel.grainWeight).toBe(1);
  expect(pastel.grainAnimated).toBe(false);
  expect(pastel.allowDof).toBe(true);
  expect(pastel.paperScene).toBeNull();
  expect(pastel.vignette).toEqual({ offset: 0.28, darkness: 0.5 });
});

test("every other style runs the pass; all but the Schwarzplan draw ink", () => {
  for (const def of RENDER_STYLES.filter((d) => d.id !== "pastel")) {
    expect(def.shaderMode).toBeGreaterThan(0);
    // the Schwarzplan's figure is the drawing: black on white, no lines
    expect(def.inkWeight > 0).toBe(def.id !== "figure");
  }
});

test("the styled scene dressing: Comic's and Papier's crowns, noir's lamp cones", () => {
  expect(
    RENDER_STYLES.filter((def) => def.crowns).map((def) => [def.id, def.crowns])
  ).toEqual([
    ["comic", "comic"],
    ["paper", "paper"],
    ["line", "paper"],
  ]);
  expect(
    RENDER_STYLES.filter((def) => def.lampCones).map((def) => def.id)
  ).toEqual(["noir"]);
  expect(RENDER_STYLE_BY_ID.pastel.crowns).toBeNull();
  expect(RENDER_STYLE_BY_ID.pastel.lampCones).toBe(false);
});

test("Papier, Strich and the Schwarzplan swap the scene's materials", () => {
  expect(
    RENDER_STYLES.filter((def) => def.paperScene).map((def) => [
      def.id,
      def.paperScene,
    ])
  ).toEqual([
    ["paper", "paper"],
    ["line", "line"],
    ["figure", "figure"],
  ]);
});

test("the monochrome styles take the colour grade out", () => {
  expect(RENDER_STYLE_BY_ID.noir.gradingWeight).toBe(0);
  expect(RENDER_STYLE_BY_ID.sincity.gradingWeight).toBe(0);
});

test("the planner styles draw a clean sheet: no grade, no vignette, no blur", () => {
  for (const id of ["line", "figure"] as const) {
    const def = RENDER_STYLE_BY_ID[id];
    expect(def.gradingWeight).toBe(0);
    expect(def.vignette.darkness).toBe(0);
    expect(def.allowDof).toBe(false);
  }
});

test("V cycles through every style in picker order and wraps", () => {
  const seen = [DEFAULT_RENDER_STYLE];
  for (let i = 1; i < RENDER_STYLES.length; i++) {
    seen.push(nextRenderStyle(seen[i - 1] ?? DEFAULT_RENDER_STYLE));
  }
  expect(seen).toEqual(RENDER_STYLES.map((def) => def.id));
  const last = seen.at(-1) ?? DEFAULT_RENDER_STYLE;
  expect(nextRenderStyle(last)).toBe(DEFAULT_RENDER_STYLE);
});

test("isRenderStyle accepts the ids only", () => {
  expect(isRenderStyle("comic")).toBe(true);
  expect(isRenderStyle("Comic")).toBe(false);
  expect(isRenderStyle("ghost")).toBe(false);
  expect(isRenderStyle(3)).toBe(false);
  expect(isRenderStyle(undefined)).toBe(false);
});
