/**
 * Copies the WebAssembly the design readers load on demand into
 * `public/wasm/` (ADR 0054): the site serves them itself, so reading a
 * planner's file never asks a third party. Run before `next dev` and
 * `next build`; `public/wasm/` is generated and ignored.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** The served name of each module and the package file it is copied from. */
export const WASM_FILES: Readonly<Record<string, string>> = {
  "web-ifc.wasm": "web-ifc/web-ifc.wasm",
  // three's Rhino3dmLoader fetches both from its library path
  "rhino3dm/rhino3dm.js": "rhino3dm/rhino3dm.js",
  "rhino3dm/rhino3dm.wasm": "rhino3dm/rhino3dm.wasm",
  // the browser build's (the package's `browser` export)
  "sql-wasm-browser.wasm": "sql.js/dist/sql-wasm-browser.wasm",
};

const root = join(import.meta.dir, "..");
const out = join(root, "public", "wasm");

if (import.meta.main) {
  mkdirSync(out, { recursive: true });
  for (const [name, from] of Object.entries(WASM_FILES)) {
    const source = Bun.resolveSync(from, root);
    mkdirSync(dirname(join(out, name)), { recursive: true });
    copyFileSync(source, join(out, name));
  }
}
