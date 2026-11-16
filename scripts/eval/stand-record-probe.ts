/**
 * Plan 090, phase 0: what three's public API does with a compact instance
 * record, asked of the installed three in a headless Chromium (WebGPU on
 * SwiftShader, as the e2e draws). Bundles scripts/eval/stand-probe-page.ts,
 * serves it on localhost (WebGPU wants a secure context), and prints the
 * page's answer as JSON: stands drawn from records against the same
 * stands drawn from matrices, the WGSL type each kind of attribute
 * arrives as, vertex buffers and inter-stage variables per variant, the
 * rails' segments against their triangles.
 *
 *   bun scripts/eval/stand-record-probe.ts [--out file.json]
 */
import { writeFileSync } from "node:fs";
import nodePath from "node:path";
import { chromium } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { SWIFTSHADER_WEBGPU } from "../../e2e/swiftshader-webgpu";
import { tileIds } from "../../lib/city/tile";
import { REFERENCE_SITE, siteById } from "../../sites";
import { publishedFiles } from "../ledger";

const ROOT = nodePath.join(import.meta.dir, "../..");

async function main(): Promise<void> {
  const built = await Bun.build({
    entrypoints: [nodePath.join(import.meta.dir, "stand-probe-page.ts")],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    tsconfig: nodePath.join(ROOT, "tsconfig.json"),
  });
  if (!built.success) {
    throw new Error(built.logs.map(String).join("\n"));
  }
  const script = await built.outputs[0].text();
  // the reference site's spawn tile's coarse crowns, as published
  const published = publishedFiles(REFERENCE_SITE);
  const site = siteById(REFERENCE_SITE);
  if (!site) {
    throw new Error("no reference site");
  }
  const [spawn] = tileIds(site);
  const crownsName = published.files[`crowns_${spawn}.crw.gz`];
  const crowns = gunzipSync(published.read(crownsName));
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/crowns") {
        return new Response(crowns);
      }
      return pathname === "/probe.js"
        ? new Response(script, {
            headers: { "content-type": "text/javascript" },
          })
        : new Response(
            '<!doctype html><meta charset="utf-8"><body><script type="module" src="/probe.js"></script>',
            { headers: { "content-type": "text/html" } }
          );
    },
  });
  const browser = await chromium.launch(SWIFTSHADER_WEBGPU);
  try {
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") {
        logs.push(`${m.type()}: ${m.text().slice(0, 400)}`);
      }
    });
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(`http://localhost:${server.port}/`);
    await page.waitForFunction(
      () => window.probe !== undefined || window.probeError !== undefined,
      undefined,
      { timeout: 180_000 }
    );
    const result = await page.evaluate(() => ({
      probe: window.probe,
      error: window.probeError,
    }));
    const out = JSON.stringify({ ...result, console: logs }, null, 2);
    const at = process.argv.indexOf("--out");
    if (at > 0 && process.argv[at + 1]) {
      writeFileSync(process.argv[at + 1], `${out}\n`);
    }
    process.stdout.write(`${out}\n`);
  } finally {
    await browser.close();
    await server.stop(true);
  }
}

await main();
