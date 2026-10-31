import { expect, test } from "bun:test";
import {
  DEFAULT_RENDER_STYLE,
  isRenderStyle,
  nextRenderStyle,
  RENDER_STYLE_BY_ID,
  RENDER_STYLES,
  styleInstant,
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

test("every other style runs the pass and draws ink", () => {
  for (const def of RENDER_STYLES.filter((d) => d.id !== "pastel")) {
    expect(def.shaderMode).toBeGreaterThan(0);
    // the Schwarzplan's ink is the white hairline that parts two blocks
    expect(def.inkWeight).toBeGreaterThan(0);
  }
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

test("a style with its own light draws at its own instant, in the asked year", () => {
  const asked = new Date(Date.UTC(2027, 0, 3, 22, 15));
  expect(styleInstant(RENDER_STYLE_BY_ID.pastel, asked)).toBe(asked);
  // (the year is the UTC one, like the instant: New Year's Eve in UTC is
  // already New Year in Germany)
  const eve = new Date(Date.UTC(2027, 11, 31, 23, 30));
  for (const def of RENDER_STYLES) {
    const light = def.ownLight;
    if (!light) {
      continue;
    }
    expect(styleInstant(def, eve).getUTCFullYear()).toBe(2027);
    const own = styleInstant(def, asked);
    expect(own.getUTCFullYear()).toBe(2027);
    expect(own.getUTCMonth()).toBe(light.month);
    expect(own.getUTCDate()).toBe(light.day);
    expect(own.getUTCHours() * 60 + own.getUTCMinutes()).toBe(light.minutes);
  }
  // Sin City's masses are cut from the sun: its instant is a day's
  expect(RENDER_STYLE_BY_ID.sincity.ownLight).not.toBeNull();
  expect(RENDER_STYLE_BY_ID.figure.ownLight).not.toBeNull();
});
