import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
  SMAA_AREA_SIZE,
  SMAA_SEARCH_HEIGHT,
  SMAA_SEARCH_WIDTH,
  smaaAreaTable,
  smaaSearchTable,
} from "./smaa-tables";

/** The pictures three's SMAANode ships (area first, then search). */
function threesPictures(): Uint8Array[] {
  const source = readFileSync(
    "node_modules/three/examples/jsm/tsl/display/SMAANode.js",
    "utf-8"
  );
  return [
    ...source.matchAll(/data:image\/png;base64,(?<png>[A-Za-z0-9+/=]+)/gu),
  ].map((m) => new Uint8Array(Buffer.from(m.groups?.png ?? "", "base64")));
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
};

/** An 8-bit PNG without interlace, as its samples (`channels` a pixel). */
function decoded(png: Uint8Array): {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
} {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const channels = png[25] === 2 ? 3 : 1;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCodePoint(...png.subarray(at + 4, at + 8));
    if (type === "IDAT") {
      idat.push(png.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? data[y * stride + x - channels] : 0;
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      const corner =
        x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] : 0;
      const predicted = [
        0,
        left,
        up,
        (left + up) >> 1,
        paeth(left, up, corner),
      ][filter];
      data[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predicted) & 255;
    }
  }
  return { width, height, channels, data };
}

test("the area table is three's picture's orthogonal block, value for value", () => {
  const picture = decoded(threesPictures()[0]);
  expect([picture.width, picture.height, picture.channels]).toEqual([
    160, 560, 3,
  ]);
  const table = smaaAreaTable();
  expect(table.length).toBe(SMAA_AREA_SIZE * SMAA_AREA_SIZE * 2);
  let differing = 0;
  let weights = 0;
  for (let y = 0; y < SMAA_AREA_SIZE; y += 1) {
    for (let x = 0; x < SMAA_AREA_SIZE; x += 1) {
      for (let c = 0; c < 2; c += 1) {
        const ours = table[2 * (y * SMAA_AREA_SIZE + x) + c];
        weights += ours > 0 ? 1 : 0;
        differing += ours === picture.data[3 * (y * 160 + x) + c] ? 0 : 1;
      }
    }
  }
  expect(differing).toBe(0);
  // (not a table of zeros against a picture of zeros)
  expect(weights).toBeGreaterThan(2000);
});

test("the search table is three's picture, value for value", () => {
  const picture = decoded(threesPictures()[1]);
  expect([picture.width, picture.height, picture.channels]).toEqual([
    SMAA_SEARCH_WIDTH,
    SMAA_SEARCH_HEIGHT,
    1,
  ]);
  const table = smaaSearchTable();
  expect([...table]).toEqual([...picture.data]);
  expect(table.filter((v) => v > 0).length).toBe(160);
});
