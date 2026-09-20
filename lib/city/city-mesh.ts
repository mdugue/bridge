import type { FootprintPoly } from "./minimap";

/**
 * Baked building mesh: produced by scripts/bake-city-mesh.ts (via
 * prepare-data.ts) from a tile's CityJSON and read by
 * app/_components/city-layer.ts. Two files per tile:
 *  - <tile>.city-mesh.json — this meta: per-object style + demolish tree +
 *    footprints, the quantisation and the recenter offset
 *  - <tile>.city-mesh.bin.gz — the vertex stream (see `encodeCityMesh`)
 *
 * The browser used to download 8–11 MB of CityJSON per tile and spend
 * ~0.5 s of main thread per tile on JSON.parse + earcut triangulation +
 * per-vertex attribute annotation. Doing that once at build time leaves the
 * client with a gzipped binary it uploads after one dequantising pass, and
 * demolish becomes a vertex filter instead of a re-parse. No THREE, no DOM.
 */
export const CITY_MESH_VERSION = 1;

/** A quantised uint16 reserved for nothing; the full range is usable. */
const U16_MAX = 0xff_ff;

export type Rgb = [number, number, number];

export interface CityMeshObject {
  /** lowest vertex elevation (m, data-frame Z) — the building's own base */
  baseZ: number;
  /** eave height above the base (m): lowest RoofSurface vertex, else the top */
  eaveH: number;
  /** [minx, miny, minz, maxx, maxy, maxz] in EPSG, Buildings only */
  extent?: number[];
  /** GroundSurface footprints (EPSG), for the minimap */
  footprints: [number, number][][];
  /** 1 = warm dusk glow (commerce/public/special), 0 = housing */
  glow: 0 | 1;
  /** CityObject id (the CityJSON key) */
  id: string;
  /** roof colour (linear RGB): DOP-sampled when available, else synthesized */
  roof: Rgb;
  /** index of the root of this object's building tree (itself for a root) */
  root: number;
  /** signed roughness jitter [-1, 1] */
  rough: number;
  /** storey height (m) for the contour bands */
  storeyH: number;
  /** wall colour (linear RGB) */
  tint: Rgb;
  /** CityObject type, e.g. "Building" / "BuildingPart" */
  type: string;
}

export interface CityMeshQuant {
  /** data-frame position of quantised value 0, per axis (recentered) */
  origin: [number, number, number];
  /** metres per quantisation step, per axis */
  scale: [number, number, number];
}

export interface CityMeshMeta {
  /** EPSG code of the source CRS (25832/25833) */
  epsg: number;
  objects: CityMeshObject[];
  /** recenter offset: mesh x = epsgX − cx, mesh y = epsgY − cy (Z-up) */
  offset: { cx: number; cy: number };
  quant: CityMeshQuant;
  tile: string;
  version: typeof CITY_MESH_VERSION;
  vertexCount: number;
}

/** The decoded vertex stream (non-indexed triangles, flat per-face vertices). */
export interface CityMeshVertices {
  /** 1 on RoofSurface vertices, 0 elsewhere */
  isRoof: Uint8Array;
  /** index into `meta.objects` */
  objectIds: Uint16Array;
  /** recentered data-frame (Z-up) positions, 3 per vertex */
  positions: Float32Array;
}

/** Byte length of the binary stream for `n` vertices (u16×3 + u16 + u8). */
export function cityMeshByteLength(n: number): number {
  return n * 6 + n * 2 + n;
}

/**
 * Quantises the vertex stream: positions to uint16 per axis over the tile's
 * own extent (a 2 km tile → ~3 cm steps in plan, and elevation at ≥1 cm),
 * followed by the object ids and roof flags. Coincident vertices quantise
 * identically, so shared edges stay watertight.
 */
export function encodeCityMesh(v: CityMeshVertices): {
  bytes: Uint8Array;
  quant: CityMeshQuant;
} {
  const n = v.objectIds.length;
  if (v.positions.length !== n * 3 || v.isRoof.length !== n) {
    throw new Error("City mesh attribute lengths disagree");
  }
  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let i = 0; i < n * 3; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis], v.positions[i]);
    max[axis] = Math.max(max[axis], v.positions[i]);
  }
  if (n === 0) {
    min.fill(0);
    max.fill(0);
  }
  const origin: [number, number, number] = [min[0], min[1], min[2]];
  const scale: [number, number, number] = [
    Math.max(0.01, (max[0] - min[0]) / U16_MAX),
    Math.max(0.01, (max[1] - min[1]) / U16_MAX),
    Math.max(0.01, (max[2] - min[2]) / U16_MAX),
  ];
  const bytes = new Uint8Array(cityMeshByteLength(n));
  const pos = new Uint16Array(bytes.buffer, 0, n * 3);
  for (let i = 0; i < n * 3; i++) {
    const axis = i % 3;
    pos[i] = Math.min(
      U16_MAX,
      Math.round((v.positions[i] - origin[axis]) / scale[axis])
    );
  }
  new Uint16Array(bytes.buffer, n * 6, n).set(v.objectIds);
  bytes.set(v.isRoof, n * 8);
  return { bytes, quant: { origin, scale } };
}

/** Inflated bytes → float32 positions + ids + roof flags (one pass). */
export function decodeCityMesh(
  buffer: ArrayBuffer,
  meta: Pick<CityMeshMeta, "quant" | "vertexCount">
): CityMeshVertices {
  const n = meta.vertexCount;
  const expected = cityMeshByteLength(n);
  if (buffer.byteLength !== expected) {
    throw new Error(
      `City mesh size mismatch: expected ${expected} bytes, got ${buffer.byteLength}`
    );
  }
  const { origin, scale } = meta.quant;
  const q = new Uint16Array(buffer, 0, n * 3);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const axis = i % 3;
    positions[i] = origin[axis] + q[i] * scale[axis];
  }
  return {
    positions,
    objectIds: new Uint16Array(buffer, n * 6, n).slice(),
    isRoof: new Uint8Array(buffer, n * 8, n).slice(),
  };
}

/** The per-vertex attributes the clay shader reads (see visual-style.ts). */
export interface CityDetailAttributes {
  /** aBaseZ: the building's own base elevation */
  baseZ: Float32Array;
  /** aBuild: (isRoof, storeyH, eaveH, glow) */
  build: Float32Array;
  /** aRough: per-building roughness jitter */
  rough: Float32Array;
  /** aTint: roof colour on roof faces, wall colour elsewhere */
  tint: Float32Array;
}

/**
 * Expands the per-object style table to per-vertex attributes. One linear
 * pass with typed-array lookups — the per-object work (hashes, palette
 * choices, roof LUT) already happened at bake time.
 */
export function buildDetailAttributes(
  meta: Pick<CityMeshMeta, "objects">,
  v: Pick<CityMeshVertices, "isRoof" | "objectIds">
): CityDetailAttributes {
  const n = v.objectIds.length;
  const out: CityDetailAttributes = {
    baseZ: new Float32Array(n),
    tint: new Float32Array(n * 3),
    build: new Float32Array(n * 4),
    rough: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = meta.objects[v.objectIds[i]];
    if (!o) {
      continue;
    }
    const roof = v.isRoof[i] === 1;
    const c = roof ? o.roof : o.tint;
    out.baseZ[i] = o.baseZ;
    out.tint[i * 3] = c[0];
    out.tint[i * 3 + 1] = c[1];
    out.tint[i * 3 + 2] = c[2];
    out.build[i * 4] = roof ? 1 : 0;
    out.build[i * 4 + 1] = o.storeyH;
    out.build[i * 4 + 2] = o.eaveH;
    out.build[i * 4 + 3] = o.glow;
    out.rough[i] = o.rough;
  }
  return out;
}

/**
 * Demolition on the data level: the object's whole building tree. In this
 * dataset many Buildings carry no geometry themselves — their BuildingParts
 * do — so picking a part must take the root and every sibling with it.
 */
export function doomedObjects(
  meta: Pick<CityMeshMeta, "objects">,
  objectIndex: number
): Set<number> {
  const picked = meta.objects[objectIndex];
  const doomed = new Set<number>();
  if (!picked) {
    return doomed;
  }
  meta.objects.forEach((o, i) => {
    if (o.root === picked.root) {
      doomed.add(i);
    }
  });
  return doomed;
}

/** Keeps only the vertices whose object index passes `keep`. */
export function filterVertices(
  v: CityMeshVertices,
  keep: (objectIndex: number) => boolean
): CityMeshVertices {
  const n = v.objectIds.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (keep(v.objectIds[i])) {
      count++;
    }
  }
  const out: CityMeshVertices = {
    positions: new Float32Array(count * 3),
    objectIds: new Uint16Array(count),
    isRoof: new Uint8Array(count),
  };
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (!keep(v.objectIds[i])) {
      continue;
    }
    out.positions[j * 3] = v.positions[i * 3];
    out.positions[j * 3 + 1] = v.positions[i * 3 + 1];
    out.positions[j * 3 + 2] = v.positions[i * 3 + 2];
    out.objectIds[j] = v.objectIds[i];
    out.isRoof[j] = v.isRoof[i];
    j++;
  }
  return out;
}

/** Number of live objects of type Building. */
export function countBuildings(
  meta: Pick<CityMeshMeta, "objects">,
  alive: (objectIndex: number) => boolean
): number {
  let count = 0;
  meta.objects.forEach((o, i) => {
    if (o.type === "Building" && alive(i)) {
      count++;
    }
  });
  return count;
}

/** Footprint polygons of the live objects (Building bbox fallback baked in). */
export function footprintPolys(
  meta: Pick<CityMeshMeta, "objects">,
  alive: (objectIndex: number) => boolean
): FootprintPoly[] {
  const out: FootprintPoly[] = [];
  meta.objects.forEach((o, i) => {
    if (!alive(i)) {
      return;
    }
    for (const pts of o.footprints) {
      out.push({ pts });
    }
  });
  return out;
}

function invalid(reason: string): never {
  throw new Error(`Invalid city mesh meta: ${reason}`);
}

/** Validates the parts of the meta the loader depends on structurally. */
export function parseCityMeshMeta(json: unknown): CityMeshMeta {
  if (typeof json !== "object" || json === null) {
    return invalid("not an object");
  }
  const raw = json as Record<string, unknown>;
  if (raw.version !== CITY_MESH_VERSION) {
    return invalid(
      `version ${String(raw.version)} (expected ${CITY_MESH_VERSION})`
    );
  }
  const n = raw.vertexCount;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    return invalid(`vertexCount must be a non-negative integer, got ${n}`);
  }
  if (!Array.isArray(raw.objects)) {
    return invalid("objects must be an array");
  }
  const quant = raw.quant as CityMeshQuant | undefined;
  if (!(quant && quant.origin?.length === 3 && quant.scale?.length === 3)) {
    return invalid("quant must carry origin[3] and scale[3]");
  }
  const offset = raw.offset as { cx?: unknown; cy?: unknown } | undefined;
  if (
    !(offset && typeof offset.cx === "number" && typeof offset.cy === "number")
  ) {
    return invalid("offset must carry cx and cy");
  }
  if (typeof raw.epsg !== "number") {
    return invalid("epsg must be a number");
  }
  return raw as unknown as CityMeshMeta;
}
