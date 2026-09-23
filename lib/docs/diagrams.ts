import { createHash } from "node:crypto";

/**
 * The docs' Mermaid diagrams, rendered once by `bun run docs:diagrams`
 * (scripts/render-diagrams.ts, a real Mermaid in Chrome) and committed as SVG
 * under this directory, one file per diagram, named after its source. The
 * /wissen pages inline them; nothing Mermaid reaches the browser.
 */
export const DIAGRAM_DIR = "docs/diagrams";

/**
 * Bumped whenever the render changes without the source changing – the
 * Mermaid config, the theme table below, the font – so every key moves and
 * the freshness test asks for a re-render.
 */
export const RENDER_VERSION = 3;

const FENCE = /^```mermaid[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*$/gmu;

/** Every Mermaid block of a Markdown file, in order, as written. */
export function mermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(FENCE)].map((m) => m[1] ?? "");
}

/** The file a diagram's SVG is stored under: its source, hashed. */
export function diagramKey(source: string): string {
  const normalised = source.replace(/[^\S\n]+$/gmu, "").trim();
  return createHash("sha256")
    .update(`${RENDER_VERSION}\n${normalised}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Mermaid derives its palette from real colours, so it cannot be handed CSS
 * variables. It is handed these sentinels instead, and the renderer swaps
 * each one for its variable afterwards: the committed SVG carries no colour
 * of its own and follows the page's tokens (app/wissen/wissen.css), dark
 * mode included, without a re-render.
 */
export const DIAGRAM_COLORS = {
  background: "#fe0101",
  node: "#fe0102",
  nodeBorder: "#fe0103",
  text: "#fe0104",
  line: "#fe0105",
  cluster: "#fe0106",
  clusterBorder: "#fe0107",
  labelBackground: "#fe0108",
  note: "#fe0109",
  noteBorder: "#fe010a",
} as const;

export type DiagramColor = keyof typeof DIAGRAM_COLORS;

/** The CSS custom property each sentinel becomes. */
export const diagramVar = (name: DiagramColor): string =>
  `--diagram-${name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`;

/** Mermaid's `themeVariables`, every one it reads pinned to a sentinel. */
export function mermaidThemeVariables(fontFamily: string) {
  const c = DIAGRAM_COLORS;
  return {
    fontFamily,
    fontSize: "15px",
    darkMode: false,
    background: c.background,
    // flowchart
    primaryColor: c.node,
    primaryBorderColor: c.nodeBorder,
    primaryTextColor: c.text,
    secondaryColor: c.cluster,
    secondaryBorderColor: c.clusterBorder,
    secondaryTextColor: c.text,
    tertiaryColor: c.cluster,
    tertiaryBorderColor: c.clusterBorder,
    tertiaryTextColor: c.text,
    mainBkg: c.node,
    nodeBorder: c.nodeBorder,
    nodeTextColor: c.text,
    textColor: c.text,
    titleColor: c.text,
    lineColor: c.line,
    arrowheadColor: c.line,
    clusterBkg: c.cluster,
    clusterBorder: c.clusterBorder,
    edgeLabelBackground: c.labelBackground,
    // sequence
    actorBkg: c.node,
    actorBorder: c.nodeBorder,
    actorTextColor: c.text,
    actorLineColor: c.line,
    signalColor: c.line,
    signalTextColor: c.text,
    labelBoxBkgColor: c.node,
    labelBoxBorderColor: c.nodeBorder,
    labelTextColor: c.text,
    loopTextColor: c.text,
    noteBkgColor: c.note,
    noteBorderColor: c.noteBorder,
    noteTextColor: c.text,
    activationBkgColor: c.cluster,
    activationBorderColor: c.nodeBorder,
    sequenceNumberColor: c.background,
  };
}

/** A colour as Chrome's computed style spells it: `rgb(r, g, b)`. */
export function rgbOf(hex: string): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const [r, g, b] = [0, 2, 4].map((i) =>
    Number.parseInt(full.slice(i, i + 2), 16)
  );
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Turns Mermaid's output into the committed file: sentinels become CSS
 * variables (also where Mermaid gave one an alpha), the measured font
 * becomes the page's font variable.
 */
export function themeSvg(svg: string, measuredFont: string): string {
  let out = svg;
  for (const [name, hex] of Object.entries(DIAGRAM_COLORS)) {
    const cssVar = `var(${diagramVar(name as DiagramColor)})`;
    const [r, g, b] = rgbOf(hex).slice(4, -1).split(", ");
    out = out
      .replace(new RegExp(hex, "giu"), cssVar)
      .replace(
        new RegExp(
          `rgba?\\(\\s*${r},\\s*${g},\\s*${b}(?:,\\s*([\\d.]+))?\\s*\\)`,
          "gu"
        ),
        (_, alpha: string | undefined) =>
          alpha === undefined || alpha === "1"
            ? cssVar
            : `color-mix(in srgb, ${cssVar} ${Math.round(Number(alpha) * 100)}%, transparent)`
      );
  }
  // Mermaid respells the family in places ("A", b / "A",b / &quot;A&quot;).
  const family = measuredFont.replace(/^["']|["'].*$/gu, "");
  const spelled = new RegExp(
    `(?:"|'|&quot;)${family}(?:"|'|&quot;)\\s*,\\s*sans-serif`,
    "gu"
  );
  return out.replace(spelled, "var(--font-sans)");
}

/**
 * The colours a rendered diagram actually paints (Chrome's computed fill,
 * stroke, text and background of every element) that come from neither the
 * theme nor the diagram's own `classDef`s. Mermaid's stylesheet carries
 * constants for looks we do not use; only what is painted counts.
 */
export function strayPaint(
  painted: readonly string[],
  authored: readonly string[]
): string[] {
  const ok = new Set([
    ...Object.values(DIAGRAM_COLORS).map(rgbOf),
    ...authored.map(rgbOf),
    INHERITED,
  ]);
  const opaque = (c: string) =>
    c.replace(/^rgba\((\d+), (\d+), (\d+), [\d.]+\)$/u, "rgb($1, $2, $3)");
  return [...new Set(painted)].filter(
    (c) =>
      !(ok.has(opaque(c)) || c === "none" || /^rgba\([^)]*,\s*0\)$/u.test(c))
  );
}

/**
 * The host page's text colour: a label that paints it inherits the page's
 * foreground wherever the SVG is inlined, which is what it should do.
 */
export const INHERITED = "rgb(1, 2, 3)";

/** Colours a diagram names itself (`classDef`, `style`), which stay as written. */
export function authoredColors(source: string): string[] {
  return [...source.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/giu)].map((m) =>
    m[0].toLowerCase()
  );
}
