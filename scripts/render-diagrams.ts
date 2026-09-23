/**
 * Renders every Mermaid block under docs/ to a committed SVG in docs/diagrams/,
 * for the /wissen pages to inline (ADR 0021).
 *
 *   bun run docs:diagrams            render what is missing, prune what is stale
 *   bun run docs:diagrams --force    render everything again
 *
 * Mermaid needs a browser: it lays a diagram out by measuring its text. So this
 * runs the real Mermaid in a headless Chrome through Bun.WebView (Bun ≥ 1.4),
 * with the page's own font loaded, and themes it with sentinel colours that
 * are swapped for CSS variables afterwards (lib/docs/diagrams.ts). Chrome and
 * not WebKit on purpose: the measurement decides the layout, and one engine
 * everywhere keeps the committed files from churning between machines.
 *
 * It does not run in `bun run build` – the build machine has no Chrome – and
 * it does not need to: the freshness test in lib/docs/diagrams.test.ts fails
 * the moment a diagram changes without its SVG.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import {
  authoredColors,
  DIAGRAM_DIR,
  diagramKey,
  mermaidBlocks,
  INHERITED,
  mermaidThemeVariables,
  strayPaint,
  themeSvg,
} from "../lib/docs/diagrams";
import { docFiles } from "../lib/docs/files";

const ROOT = path.join(import.meta.dir, "..");
const OUT = path.join(ROOT, DIAGRAM_DIR);
const FONT = "Inter Variable";
const force = process.argv.includes("--force");

const CHROME_ARGV = [
  "--disable-background-networking",
  "--disable-sync",
  "--hide-scrollbars",
  // Containers restrict user namespaces, and /dev/shm is small; the page is
  // our own localhost server.
  "--no-sandbox",
  "--disable-dev-shm-usage",
];

function chromePath(): string | undefined {
  const explicit = process.env.CHROME ?? process.env.BUN_CHROME_PATH;
  if (explicit) {
    return explicit;
  }
  for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
    if (Bun.which(name)) {
      return undefined; // on PATH: Bun finds it itself
    }
  }
  const fallback = "/opt/pw-browsers/chromium";
  return existsSync(fallback) ? fallback : undefined;
}

const HOST = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="/font/index.css">
<style>body { margin: 0; background: #fff; color: ${INHERITED}; font-family: "${FONT}"; }</style>
<script type="module">
  import mermaid from "/mermaid/mermaid.esm.min.mjs";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: ${JSON.stringify(mermaidThemeVariables(`"${FONT}", sans-serif`))},
    // Mermaid 12 wraps node text at 120px by default; GitHub's renderer
    // reads closer to this.
    flowchart: { useMaxWidth: false, htmlLabels: true, padding: 12, wrappingWidth: 220 },
    sequence: { useMaxWidth: false },
  });
  await document.fonts.load('15px "${FONT}"');
  await document.fonts.load('bold 15px "${FONT}"');
  await document.fonts.load('italic 15px "${FONT}"');
  // Renders, then reads back what every element really paints.
  const PAINT = ["fill", "stroke", "color", "background-color"];
  window.renderDiagram = async (id, source) => {
    const { svg } = await mermaid.render(id, source);
    document.body.innerHTML = svg;
    const all = [...document.body.querySelectorAll("*")];
    // <defs> holds every marker Mermaid might need; only the referenced ones paint.
    const used = new Set();
    for (const el of all) {
      const style = getComputedStyle(el);
      for (const prop of ["marker-start", "marker-mid", "marker-end"]) {
        const ref = style.getPropertyValue(prop).match(/#([^")]+)/);
        if (ref) used.add(ref[1]);
      }
    }
    const painted = new Set();
    for (const el of all) {
      const marker = el.closest("marker");
      if (el.closest("defs") && !(marker && used.has(marker.id))) continue;
      const style = getComputedStyle(el);
      for (const prop of PAINT) painted.add(style.getPropertyValue(prop));
    }
    return { svg, painted: [...painted] };
  };
  window.ready = true;
</script></head><body></body></html>`;

function serve() {
  const mermaidDir = path.join(ROOT, "node_modules/mermaid/dist");
  const fontDir = path.join(ROOT, "node_modules/@fontsource-variable/inter");
  return Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/") {
        return new Response(HOST, { headers: { "content-type": "text/html" } });
      }
      const [, root, ...rest] = pathname.split("/");
      const base =
        root === "mermaid" ? mermaidDir : root === "font" ? fontDir : null;
      const file = base ? Bun.file(path.join(base, ...rest)) : null;
      return file ? new Response(file) : new Response(null, { status: 404 });
    },
  });
}

interface Job {
  key: string;
  source: string;
  from: string;
}

function collect(): Job[] {
  const jobs = new Map<string, Job>();
  for (const rel of docFiles(path.join(ROOT, "docs"))) {
    const text = readFileSync(path.join(ROOT, rel), "utf8");
    for (const source of mermaidBlocks(text)) {
      const key = diagramKey(source);
      if (!jobs.has(key)) {
        jobs.set(key, { key, source, from: rel });
      }
    }
  }
  return [...jobs.values()];
}

async function main() {
  const jobs = collect();
  mkdirSync(OUT, { recursive: true });
  const wanted = new Set(jobs.map((j) => `${j.key}.svg`));
  for (const file of readdirSync(OUT)) {
    if (file.endsWith(".svg") && !wanted.has(file)) {
      rmSync(path.join(OUT, file));
      console.log(`pruned  ${file}`);
    }
  }
  const todo = jobs.filter(
    (j) => force || !existsSync(path.join(OUT, `${j.key}.svg`))
  );
  if (todo.length === 0) {
    console.log(`${jobs.length} diagrams, all current`);
    return;
  }

  const server = serve();
  const chrome = chromePath();
  const view = new Bun.WebView({
    backend: {
      type: "chrome",
      url: false,
      ...(chrome ? { path: chrome } : {}),
      argv: CHROME_ARGV,
      stderr: process.env.DEBUG_CHROME ? "inherit" : "ignore",
    },
    width: 1600,
    height: 1200,
  });
  let failed = 0;
  try {
    await view.navigate(`http://localhost:${server.port}/`);
    for (
      let i = 0;
      i < 100 && !(await view.evaluate<boolean>("window.ready === true"));
      i++
    ) {
      await Bun.sleep(100);
    }
    for (const job of todo) {
      const { svg: raw, painted } = await view.evaluate<{
        svg: string;
        painted: string[];
      }>(
        `window.renderDiagram(${JSON.stringify(`d-${job.key}`)}, ${JSON.stringify(job.source)})`
      );
      if (process.env.DUMP_RAW) {
        await Bun.write(path.join(process.env.DUMP_RAW, `${job.key}.svg`), raw);
      }
      const stray = strayPaint(painted, authoredColors(job.source));
      if (stray.length > 0) {
        failed++;
        console.error(
          `FAILED  ${job.from}: colours outside the theme: ${stray.join(" ")}`
        );
        continue;
      }
      const svg = themeSvg(raw, `"${FONT}", sans-serif`);
      await Bun.write(path.join(OUT, `${job.key}.svg`), `${svg}\n`);
      console.log(`wrote   ${job.key}.svg  (${job.from})`);
    }
  } finally {
    view.close();
    await server.stop(true);
  }
  if (failed > 0) {
    process.exit(1);
  }
}

await main();
