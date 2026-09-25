import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { decodeGreyPng } from "./png-raster";

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(body, 8);
  let c = 0xff_ff_ff_ff;
  for (const byte of out.subarray(4, 8 + body.length)) {
    c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  }
  view.setUint32(8 + body.length, (c ^ 0xff_ff_ff_ff) >>> 0);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/** Encodes greyscale pixels with the given filter per row (reference encoder). */
function encode(
  width: number,
  height: number,
  px: Uint8Array,
  filterOf: (y: number) => number
): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const f = filterOf(y);
    raw[y * (width + 1)] = f;
    for (let x = 0; x < width; x++) {
      const v = px[y * width + x];
      const left = x > 0 ? px[y * width + x - 1] : 0;
      const up = y > 0 ? px[(y - 1) * width + x] : 0;
      const upLeft = x > 0 && y > 0 ? px[(y - 1) * width + x - 1] : 0;
      const pred = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][f];
      raw[y * (width + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  const z = new Uint8Array(deflateSync(raw));
  // Split the stream over two IDAT chunks, as encoders may.
  const half = z.length >> 1;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", z.subarray(0, half)),
    chunk("IDAT", z.subarray(half)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("decodeGreyPng", () => {
  test("round-trips every filter type byte for byte", async () => {
    const width = 37;
    const height = 23;
    const px = new Uint8Array(width * height);
    let s = 12_345;
    for (let i = 0; i < px.length; i++) {
      s = (s * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff;
      // class-id-like runs with the odd random byte
      px[i] = s % 7 === 0 ? s & 255 : Math.floor(i / 17) % 9;
    }
    const png = encode(width, height, px, (y) => y % 5);
    const out = await decodeGreyPng(png);
    expect(out.width).toBe(width);
    expect(out.height).toBe(height);
    expect(Array.from(out.data)).toEqual(Array.from(px));
  });

  test("rejects colour PNGs instead of misreading them", async () => {
    const png = encode(2, 2, new Uint8Array(4), () => 0);
    png[8 + 8 + 9] = 2; // IHDR colour type → RGB
    const err = await decodeGreyPng(png).then(
      () => null,
      (e: unknown) => e
    );
    expect(String(err)).toContain("unsupported PNG");
  });

  test("decodes the committed class rasters to valid class ids", async () => {
    const dir = join(import.meta.dir, "../../data/dlm");
    const file = readdirSync(dir).find((f) => /^landcover_.*\.png$/.test(f));
    if (!file) {
      return;
    }
    const out = await decodeGreyPng(
      new Uint8Array(readFileSync(join(dir, file)))
    );
    expect(out.data.length).toBe(out.width * out.height);
    expect(out.data.every((v) => v <= 8)).toBe(true);
  });
});
