/**
 * Plan 091 phase 2's figures: every committed site's sky-view raster
 * encoded as BC4 and as EAC R11 (scripts/block-encode.ts) — the error of
 * the value the shader reads in byte steps (level 0, and every level
 * against the box-filtered chain), the time an encode takes, whether two
 * encodes are the same bytes, and the bytes on the wire (raw, gzip 9,
 * brotli 11) against the PNG. `bun scripts/eval/svf-blocks-trial.ts [--json]`.
 */
import { readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { parseBlockRaster } from "../../lib/city/block-raster";
import type { BlockFormat } from "../../lib/city/block-raster";
import { decodeGreyPng } from "../../lib/city/png-raster";
import { decodeLevel, encodeBlockRaster, mipChain } from "../block-encode";

const FORMATS: BlockFormat[] = ["bc4", "eac"];

interface Errors {
  max: number;
  mean: number;
  p99: number;
}

function errorsOf(errs: Float64Array): Errors {
  const sorted = Float64Array.from(errs).sort();
  let sum = 0;
  for (const e of errs) {
    sum += e;
  }
  return {
    mean: sum / errs.length,
    p99: sorted[Math.floor(0.99 * (sorted.length - 1))],
    max: sorted.at(-1) ?? 0,
  };
}

const rows: Record<string, unknown>[] = [];
for (const site of readdirSync("data")
  .filter((d) => !d.startsWith("_"))
  .sort()) {
  const dir = nodePath.join("data", site, "dlm");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^svf_.*\.png$/u.test(f));
  } catch {
    continue;
  }
  for (const file of files.sort()) {
    const png = readFileSync(nodePath.join(dir, file));
    const grey = await decodeGreyPng(png);
    const chain = mipChain(grey);
    const row: Record<string, unknown> = {
      site,
      file,
      size: `${grey.width}x${grey.height}`,
      png: png.length,
      raw: grey.data.length,
    };
    for (const format of FORMATS) {
      const t0 = performance.now();
      const bytes = encodeBlockRaster(grey, format);
      const ms = performance.now() - t0;
      const again = encodeBlockRaster(grey, format);
      const stable =
        Buffer.compare(Buffer.from(bytes), Buffer.from(again)) === 0;
      const parsed = parseBlockRaster(bytes);
      const level0 = decodeLevel(parsed.levels[0], format);
      const errs0 = new Float64Array(level0.length);
      for (let i = 0; i < level0.length; i += 1) {
        errs0[i] = Math.abs(level0[i] - grey.data[i]);
      }
      let allMax = 0;
      for (const [k, level] of parsed.levels.entries()) {
        const dec = decodeLevel(level, format);
        for (let i = 0; i < dec.length; i += 1) {
          allMax = Math.max(allMax, Math.abs(dec[i] - chain[k].data[i]));
        }
      }
      row[format] = {
        ms: Math.round(ms),
        stable,
        bytes: bytes.length,
        gzip: gzipSync(bytes, { level: 9 }).length,
        brotli: brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length,
        level0: errorsOf(errs0),
        mipsMax: allMax,
      };
    }
    rows.push(row);
    if (!process.argv.includes("--json")) {
      const f = (x: unknown) => {
        const r = x as {
          ms: number;
          stable: boolean;
          gzip: number;
          level0: Errors;
          mipsMax: number;
        };
        return `${r.ms}ms ${r.stable ? "stable" : "UNSTABLE"} gz ${(r.gzip / 1024).toFixed(0)}k mean ${r.level0.mean.toFixed(3)} p99 ${r.level0.p99.toFixed(2)} max ${r.level0.max.toFixed(2)} mips ${r.mipsMax.toFixed(2)}`;
      };
      process.stdout.write(
        `${site} ${file} png ${(png.length / 1024).toFixed(0)}k | bc4 ${f(row.bc4)} | eac ${f(row.eac)}\n`
      );
    }
  }
}
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
}
