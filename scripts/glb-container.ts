/**
 * The glb container (glTF 2.0 binary): a JSON chunk and one BIN chunk.
 * `readGlb` splits a glb into its parsed JSON and its BIN bytes, `writeGlb`
 * puts them back together, padding the JSON with spaces and the BIN with
 * zeros to four bytes as the format asks. Build-time only; no DOM.
 */

const MAGIC = 0x46_54_6c_67; // "glTF"
export const JSON_CHUNK = 0x4e_4f_53_4a;
export const BIN_CHUNK = 0x00_4e_49_42;

export const pad = (n: number, to: number): number => Math.ceil(n / to) * to;

/** A glb's JSON (as parsed, typed by the caller) and its BIN chunk. */
export interface GlbParts<J> {
  json: J;
  bin: Uint8Array;
}

/** Splits a glb into its JSON and its BIN chunk (a view, not a copy). */
export function readGlb<J>(glb: Uint8Array): GlbParts<J> {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error("glb: not a glb");
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error("glb: first chunk is not JSON");
  }
  const json = JSON.parse(
    new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))
  ) as J;
  const binAt = 20 + jsonLength;
  if (binAt + 8 > glb.byteLength) {
    throw new Error("glb: no BIN chunk");
  }
  const binLength = view.getUint32(binAt, true);
  if (view.getUint32(binAt + 4, true) !== BIN_CHUNK) {
    throw new Error("glb: second chunk is not BIN");
  }
  return { json, bin: glb.subarray(binAt + 8, binAt + 8 + binLength) };
}

/** A glb of `json` and a BIN chunk of `chunks` laid end to end. */
export function writeGlb(json: unknown, chunks: Uint8Array[]): Uint8Array {
  const binLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const total = pad(binLength, 4);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = pad(jsonBytes.length, 4);
  const out = new Uint8Array(12 + 8 + jsonPadded + 8 + total);
  const o = new DataView(out.buffer);
  o.setUint32(0, MAGIC, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, out.length, true);
  o.setUint32(12, jsonPadded, true);
  o.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  const binStart = 20 + jsonPadded;
  o.setUint32(binStart, total, true);
  o.setUint32(binStart + 4, BIN_CHUNK, true);
  let at = binStart + 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A glTF's buffers, as far as `ownBuffer` reads them. */
interface WithBuffers {
  buffers?: { extensions?: Record<string, unknown>; uri?: string }[];
}

/** The index of the glb's own buffer (the BIN chunk): the one without a
 *  uri that is not a meshopt fallback (EXT or KHR); −1 without one. */
export function ownBuffer(json: WithBuffers): number {
  return (json.buffers ?? []).findIndex(
    (b) =>
      b.uri === undefined &&
      b.extensions?.EXT_meshopt_compression === undefined &&
      b.extensions?.KHR_meshopt_compression === undefined
  );
}
