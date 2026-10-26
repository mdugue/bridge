import { describe, expect, test } from "bun:test";
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import {
  type GroundPrepInput,
  groundPrepTransfer,
  indexBox,
  localReader,
  prepareGround,
} from "./ground-prep";
import { planTriangles } from "./terrain-tin";
import {
  MIST_REACH_M,
  reach,
  trianglesOver,
  WATER_REACH_M,
  type WaterMask,
} from "./water-mask";

const BOUNDS = [1000, 5000, 1200, 5200] as const;
const ORIGIN = { cx: 1100, cy: 5100 };
const N = 21;

/**
 * An N×N grid over BOUNDS as a quantised glTF level stores it: normalized
 * int16, four per vertex (x, y, z, pad), Y-up, a skirt quad along the west
 * edge (vertical: no area in plan), and the node's dequantisation plus the
 * up-axis turn as `toData`.
 */
function level() {
  const count = N * N + 2;
  const raw = new Int16Array(count * 4);
  const q = (v: number) => Math.round(v * 32_767);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      // local x east, y up, z south, all in [-1, 1]
      raw[4 * i] = q((c / (N - 1)) * 2 - 1);
      raw[4 * i + 1] = q(Math.sin(c * 0.7 + r * 0.3) * 0.5);
      raw[4 * i + 2] = q((r / (N - 1)) * 2 - 1);
    }
  }
  // the skirt: two vertices under the north-west corner and the next one
  raw.set([q(-1), q(-1), q(-1), 0], 4 * N * N);
  raw.set([q(-1), q(-1), q(-1 + 2 / (N - 1)), 0], 4 * (N * N + 1));
  const tris: number[] = [];
  for (let r = 0; r + 1 < N; r++) {
    for (let c = 0; c + 1 < N; c++) {
      const a = r * N + c;
      tris.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
    }
  }
  tris.push(0, N * N, N, N, N * N, N * N + 1);
  const index = new Uint32Array(tris);
  // local → data: scale to 100 m half-width, 20 m relief, 40 m up; Y-up → Z-up
  const node = new Matrix4().compose(
    new Vector3(0, 40, 0),
    new Quaternion(),
    new Vector3(100, 20, 100)
  );
  const upTurn = new Matrix4().makeRotationX(Math.PI / 2);
  const toData = new Matrix4().multiplyMatrices(upTurn, node);
  return { raw, index, toData, count };
}

/** Water in the cells of the tile's eastern half. */
function eastWater(cells: number): WaterMask {
  const water = new Uint8Array(cells * cells);
  for (let y = 0; y < cells; y++) {
    water.fill(1, y * cells + cells / 2 + cells / 8, (y + 1) * cells);
  }
  return { cells, water };
}

function input(mask: WaterMask | null, grid: number | null): GroundPrepInput {
  const { raw, index, toData, count } = level();
  return {
    positions: raw,
    stride: 4,
    offset: 0,
    count,
    normalized: true,
    index,
    toData: toData.elements,
    origin: ORIGIN,
    bounds: BOUNDS,
    grid,
    mask,
  };
}

/** What three's accessors make of the same level (the code it replaced). */
function reference(mask: WaterMask) {
  const { raw, index, toData, count } = level();
  const position = new InterleavedBufferAttribute(
    new InterleavedBuffer(raw, 4),
    3,
    0,
    true
  );
  const v = new Vector3();
  const data: Vector3[] = [];
  const cx = new Uint16Array(count);
  const cy = new Uint16Array(count);
  const [minX, minY, maxX, maxY] = BOUNDS;
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(toData);
    data.push(v.clone());
    const x = Math.floor(
      (v.x + ORIGIN.cx - minX) * (mask.cells / (maxX - minX))
    );
    const y = Math.floor(
      (maxY - (v.y + ORIGIN.cy)) * (mask.cells / (maxY - minY))
    );
    cx[i] = Math.min(mask.cells - 1, Math.max(0, x));
    cy[i] = Math.min(mask.cells - 1, Math.max(0, y));
  }
  const plan = planTriangles(index, raw, 4, 0);
  const sheet = (metres: number) => {
    const kept = trianglesOver(plan, cx, cy, reach(mask, metres, maxX - minX));
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const idx = new BufferAttribute(kept, 1);
    for (let i = 0; i < idx.count; i++) {
      v.fromBufferAttribute(position, idx.getX(i));
      v.toArray().forEach((c, k) => {
        lo[k] = Math.min(lo[k], c);
        hi[k] = Math.max(hi[k], c);
      });
    }
    return { index: kept, box: [...lo, ...hi] };
  };
  return { data, water: sheet(WATER_REACH_M), mist: sheet(MIST_REACH_M) };
}

describe("ground prep", () => {
  test("reads quantised positions as three's accessors do", () => {
    const { raw, count } = level();
    const position = new InterleavedBufferAttribute(
      new InterleavedBuffer(raw, 4),
      3,
      0,
      true
    );
    const read = localReader(input(null, null));
    const local = new Float64Array(3);
    const v = new Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(position, i);
      read(i, local);
      expect([...local]).toEqual(v.toArray());
    }
  });

  test("a TIN's projected vertices and heights, as the main thread read them", () => {
    const mask = eastWater(16);
    const prep = prepareGround(input(null, null));
    const ref = reference(mask);
    expect(prep.elevations).toBeUndefined();
    ref.data.forEach((d, i) => {
      expect(prep.xy?.[2 * i]).toBe(d.x + ORIGIN.cx);
      expect(prep.xy?.[2 * i + 1]).toBe(d.y + ORIGIN.cy);
      expect(prep.z?.[i]).toBe(Math.fround(d.z));
    });
  });

  test("a grid level's elevations are its first n² vertices' heights", () => {
    const prep = prepareGround(input(null, N));
    const ref = reference(eastWater(16));
    expect(prep.elevations?.length).toBe(N * N);
    expect(prep.xy).toBeUndefined();
    for (let i = 0; i < N * N; i++) {
      expect(prep.elevations?.[i]).toBe(Math.fround(ref.data[i].z));
    }
  });

  test("the sheets keep the triangles the main thread kept, in their boxes", () => {
    const mask = eastWater(16);
    const prep = prepareGround(input(mask, null));
    const ref = reference(mask);
    expect(prep.water?.index).toEqual(ref.water.index);
    expect(prep.mist?.index).toEqual(ref.mist.index);
    expect([...(prep.water?.box ?? [])]).toEqual(ref.water.box);
    expect([...(prep.mist?.box ?? [])]).toEqual(ref.mist.box);
    // the water reaches less far than the mist, and neither keeps the skirt
    expect(prep.water?.index.length).toBeGreaterThan(0);
    expect(prep.water?.index.length).toBeLessThan(prep.mist?.index.length ?? 0);
    expect(prep.mist?.index.length).toBeLessThan(
      input(null, null).index?.length ?? 0
    );
  });

  test("no sheets without water cells", () => {
    const prep = prepareGround(input(null, N));
    expect(prep.water).toBeUndefined();
    expect(prep.mist).toBeUndefined();
  });

  test("an empty sheet has an empty box", () => {
    const box = indexBox(new Uint16Array(0), () => undefined);
    expect(box[0]).toBe(Number.POSITIVE_INFINITY);
    expect(box[3]).toBe(Number.NEGATIVE_INFINITY);
  });

  test("hands every result array over, each once", () => {
    const prep = prepareGround(input(eastWater(16), null));
    const buffers = groundPrepTransfer(prep);
    expect(buffers.length).toBe(6);
    expect(new Set(buffers).size).toBe(6);
  });
});
