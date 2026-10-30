import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { type DataManifest, MANIFEST_FILE } from "../lib/city/tile";

/**
 * Where scripts/prepare-data.ts puts a site's served files (ADR 0007): each
 * artifact under a content-hashed name, the manifest that maps the logical
 * names to them, and, at the end, nothing else — a file no publish named
 * this run is pruned. A warmer (warmers.ts) only names: it writes nothing.
 */
export interface Publisher {
  /** publishes `content` as `logical`; returns the name it is served
   *  under (written once: the same bytes are the same name) */
  publish: (logical: string, content: Uint8Array) => string;
  /** a file served under its own name (the start page's site stats) */
  publishPlain: (name: string, content: Uint8Array) => void;
  /** writes the manifest and prunes what this run did not name */
  finish: () => { artifacts: number; written: number; pruned: number };
}

/** `name.ext` → `name.<8 hex of sha1>.ext` (`.glb.gz`, `.pts.gz`, `.crw.gz`
 *  keep both). */
export function hashedName(file: string, content: Uint8Array): string {
  const hash = createHash("sha1").update(content).digest("hex").slice(0, 8);
  const ext = file.match(/(\.(?:glb|pts|crw)\.gz|\.[^.]+)$/u)?.[0] ?? "";
  return `${basename(file, ext)}.${hash}${ext}`;
}

export function createPublisher(
  outDir: string,
  opts: { warming: boolean }
): Publisher {
  if (!opts.warming) {
    mkdirSync(outDir, { recursive: true });
  }
  const manifest: DataManifest = { version: 1, files: {} };
  const keep = new Set<string>([MANIFEST_FILE]);
  let written = 0;
  return {
    publish: (logical, content) => {
      const hashed = hashedName(logical, content);
      manifest.files[logical] = hashed;
      keep.add(hashed);
      const dest = join(outDir, hashed);
      if (!opts.warming && !existsSync(dest)) {
        writeFileSync(dest, content);
        written++;
      }
      return hashed;
    },
    publishPlain: (name, content) => {
      keep.add(name);
      if (!opts.warming) {
        writeFileSync(join(outDir, name), content);
      }
    },
    finish: () => {
      const artifacts = Object.keys(manifest.files).length;
      if (opts.warming) {
        return { artifacts, written: 0, pruned: 0 };
      }
      writeFileSync(
        join(outDir, MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`
      );
      let pruned = 0;
      for (const entry of readdirSync(outDir)) {
        if (!keep.has(entry)) {
          rmSync(join(outDir, entry), { recursive: true });
          pruned++;
        }
      }
      return { artifacts, written, pruned };
    },
  };
}
