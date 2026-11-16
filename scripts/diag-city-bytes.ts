/**
 * TEMPORARY diagnostic (removed before this PR is final): what a machine
 * baked for a site's buildings, layer by layer — the gzip, the glb, its
 * JSON, every buffer view as stored and as decoded — and what this
 * machine's maths library and gzip give for fixed inputs.
 * `bun scripts/diag-city-bytes.ts <site> [--full]`
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MeshoptDecoder } from "meshoptimizer";
import { readGlb } from "./glb-container";

const sha = (bytes: Uint8Array | string): string =>
  createHash("sha1").update(bytes).digest("hex").slice(0, 12);

interface View {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  extensions?: Record<
    string,
    {
      byteOffset?: number;
      byteLength: number;
      byteStride: number;
      count: number;
      mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
      filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL" | "COLOR";
    }
  >;
}
interface Gltf {
  accessors?: { bufferView?: number; count: number }[];
  bufferViews?: View[];
  meshes?: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices?: number }[];
  }[];
}

function viewNames(json: Gltf): Map<number, string> {
  const names = new Map<number, string>();
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const all = { ...prim.attributes, indices: prim.indices };
      for (const [name, acc] of Object.entries(all)) {
        const view = acc === undefined ? undefined : json.accessors?.[acc];
        if (view?.bufferView !== undefined) {
          names.set(view.bufferView, `${mesh.name}.${name}#${view.count}`);
        }
      }
    }
  }
  return names;
}

function report(file: string, logical: string): string[] {
  const gzBytes = readFileSync(file);
  const glb = Bun.gunzipSync(gzBytes);
  const { json, bin } = readGlb<Gltf>(glb);
  const lines = [
    `${logical} gz=${gzBytes.length}/${sha(gzBytes)} glb=${glb.length}/${sha(glb)} json=${sha(JSON.stringify(json))} bin=${sha(bin)}`,
  ];
  const names = viewNames(json);
  for (const [i, view] of (json.bufferViews ?? []).entries()) {
    const ext = view.extensions?.KHR_meshopt_compression;
    const name = names.get(i) ?? "table";
    if (ext) {
      const stored = bin.subarray(
        ext.byteOffset ?? 0,
        (ext.byteOffset ?? 0) + ext.byteLength
      );
      const raw = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(
        raw,
        ext.count,
        ext.byteStride,
        stored,
        ext.mode,
        ext.filter
      );
      lines.push(
        `  v${i} ${name} ${ext.mode} n=${ext.count} stored=${stored.length}/${sha(stored)} codec=${stored[0].toString(16)} decoded=${sha(raw)}`
      );
    } else {
      const stored = bin.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength
      );
      lines.push(`  v${i} ${name} plain=${stored.length}/${sha(stored)}`);
    }
  }
  return lines;
}

/** A fixed sweep through one maths function, hashed bit for bit. */
function probe(f: (x: number, y: number) => number): string {
  const out = new Float64Array(200_000);
  let x = 0.123_456_7;
  for (let i = 0; i < out.length; i += 1) {
    // a fixed linear congruence: the same arguments everywhere
    x = (x * 16_807 + 0.318_309) % 97.531;
    out[i] = f(x - 48.7, (x * 1.618) % 7.3);
  }
  return sha(new Uint8Array(out.buffer));
}

function machine(): string[] {
  const fixed = new Uint8Array(1 << 20);
  for (let i = 0; i < fixed.length; i += 1) {
    fixed[i] = (i * 2_654_435_761) >>> 13;
  }
  const maths: Record<string, (x: number, y: number) => number> = {
    acos: (x) => Math.acos(x / 50),
    asin: (x) => Math.asin(x / 50),
    atan: Math.atan,
    atan2: Math.atan2,
    cbrt: Math.cbrt,
    cos: Math.cos,
    exp: (x) => Math.exp(x / 10),
    fround: Math.fround,
    hypot: Math.hypot,
    log: (x) => Math.log(Math.abs(x)),
    pow: (x, y) => Math.abs(x) ** y,
    sin: Math.sin,
    sqrt: (x) => Math.sqrt(Math.abs(x)),
    tan: Math.tan,
  };
  return [
    `bun ${Bun.version} ${process.platform}-${process.arch}`,
    `gzip9=${sha(Bun.gzipSync(fixed, { level: 9, library: "libdeflate" }))}`,
    ...Object.entries(maths).map(([name, f]) => `Math.${name}=${probe(f)}`),
  ];
}

await MeshoptDecoder.ready;
const [site = "dresden"] = process.argv.slice(2);
const dir = path.join("public", "data", site);
const { files } = JSON.parse(
  readFileSync(path.join(dir, "manifest.json"), "utf-8")
) as { files: Record<string, string> };
const out = machine();
for (const [logical, hashed] of Object.entries(files).toSorted(([a], [b]) =>
  a.localeCompare(b)
)) {
  if (/^city_.*\.glb\.gz$/u.test(logical)) {
    const lines = report(path.join(dir, hashed), logical);
    out.push(...(process.argv.includes("--full") ? lines : lines.slice(0, 1)));
  }
}
process.stdout.write(`${out.join("\n")}\n`);
