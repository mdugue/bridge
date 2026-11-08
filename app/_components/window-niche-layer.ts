import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  InterpolationSamplingType,
  Matrix4,
  MeshStandardNodeMaterial,
  Vector3,
} from "three/webgpu";
import type { BufferAttribute, Mesh, Object3D } from "three/webgpu";
import {
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  length,
  max,
  min,
  mix,
  normalize,
  smoothstep,
  step,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import type { CityObjectTable } from "@/lib/city/city-mesh";
import {
  HOUSE_STRIDE,
  NICHE_CELL_M,
  NICHE_STRIDE,
  nicheCellKey,
  unpackNiche,
} from "@/lib/city/window-niches";
import {
  NIGHT_WINDOWS,
  WINDOW_PANE_ROUGHNESS,
  WINDOW_SKY,
  WINDOW_TONE,
  windowHash,
} from "./clay-windows";
import type { CityLayer } from "./city-layer";
import { Instances, instanceTint } from "./instancing";
import { streetLight } from "./lamp-reflections";
import { nightShadowFree } from "./lantern";
import type { F, V3, V4 } from "./shader-chunks";
import { viewDirection } from "./view-direction";
import type { NicheJobInput, NicheResult } from "./window-niche-client";
import { CLAY_BASE, DUSK_GLOW } from "./visual-style";
import type { ClayDetailUniforms } from "./visual-style";

/**
 * Real niches behind the near windows: the clay draws a
 * window on the wall (clay-windows.ts) — a recess the view looks into, but
 * flat, and a frontal view tells no depth. Near the eye each opening is
 * cut out of the wall instead (visual-style.ts `nicheMask`) and a box
 * stands behind it: its reveals in the wall's plaster, its back a pane
 * that mirrors the sky at a grazing view and glows after dark as the
 * clay's would; the sun falls into it past the reveals' edges.
 *
 * Where each window stands comes from the tile's own mesh
 * (lib/city/window-niches.ts, the shader's grid on the CPU), worked out off
 * the main thread once a full-LoD2 tile lands (window-niche-client.ts) and
 * kept per tile by cell, packed (16 bytes a window). One set of instances
 * for the site holds the niches of every house within `NICHE_RADIUS_M` of
 * the eye, whole houses, refilled as it moves; the clay cuts the openings
 * of those houses only (OBJECT_FLAG_NICHED), so no opening is cut without
 * its niche — what a niche too many costs is a box unseen behind a wall.
 * A tile far from the eye cuts nothing and builds no discard
 * (`NicheOptions.cutOn`).
 */

/** How much farther than the radius a house stays one with niches (m):
 *  no house turns back and forth as the eye stands at its edge. */
const HOUSE_KEEP_M = 20;
/** How far the box reaches past its opening each way (m): the clay's
 *  cut edge is anti-aliased and its corners round, and what lies past the
 *  box behind a cut would be a hole into the building; past the opening
 *  the box stays unseen behind the wall. */
const NICHE_OVERLAP_M = 0.04;
/** How far the eye moves before the set is filled again (m), and how
 *  often it is anyway (a demolish, a design, a tile landing). */
const REFILL_MOVE_M = 6;
const REFILL_MS = 1000;

/** The tile's mesh and table, copied for the worker (window-niche-client.ts):
 *  places in the Y-up scene frame, `_FACADE` codes, objects, triangles. */
export function nicheInput(
  scene: Object3D,
  mesh: Mesh,
  table: CityObjectTable
): NicheJobInput | null {
  const { geometry } = mesh;
  const position = geometry.getAttribute("position") as
    | BufferAttribute
    | undefined;
  const facade = geometry.getAttribute("facade") as BufferAttribute | undefined;
  const ids = geometry.getAttribute("featureId") as BufferAttribute | undefined;
  if (!(position && facade && ids)) {
    return null;
  }
  // mesh → content root (the data frame: the tileset's frame), then Y-up
  const toData = new Matrix4();
  for (let o: Object3D | null = mesh; o && o !== scene; o = o.parent) {
    o.updateMatrix();
    toData.premultiply(o.matrix);
  }
  scene.updateMatrix();
  toData.premultiply(scene.matrix);
  // only the triangles that may carry windows (as lib/city/window-niches.ts
  // gathers them, by their first corner): a wall of an object with a
  // window row, not a party wall, not a roof — the copy a phone makes is
  // its walls', not the tile's
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const corner = (t: number) => (index ? index.getX(t) : t);
  // the codes straight from a plain snorm16 buffer (the glTF's), else
  // through the attribute's own reads
  const raw =
    facade.array instanceof Int16Array &&
    facade.itemSize === 4 &&
    !(facade as { isInterleavedBufferAttribute?: boolean })
      .isInterleavedBufferAttribute
      ? facade.array
      : null;
  const code = raw
    ? (v: number, c: number) => raw[4 * v + c]
    : (v: number, c: number) => Math.round(facade.getComponent(v, c) * 32_767);
  const kept: number[] = [];
  for (let t = 0; t + 2 < count; t += 3) {
    const v = corner(t);
    const object = Math.round(ids.getX(v));
    if (
      code(v, 1) !== 0 &&
      code(v, 2) !== -32_767 &&
      (table.winAxis[object] ?? 0) >= 0.05
    ) {
      kept.push(t);
    }
  }
  const n = kept.length * 3;
  const positions = new Float32Array(n * 3);
  const codes = new Int16Array(n * 4);
  const objectIds = new Uint32Array(n);
  const p = new Vector3();
  for (let k = 0; k < kept.length; k += 1) {
    for (let c = 0; c < 3; c += 1) {
      const v = corner(kept[k] + c);
      const i = 3 * k + c;
      p.fromBufferAttribute(position, v).applyMatrix4(toData);
      positions[3 * i] = p.x;
      positions[3 * i + 1] = p.z;
      positions[3 * i + 2] = -p.y;
      for (let q = 0; q < 4; q += 1) {
        codes[4 * i + q] = code(v, q);
      }
      objectIds[i] = Math.round(ids.getX(v));
    }
  }
  return {
    mesh: { positions, facade: codes, objectIds },
    table: {
      baseZ: table.baseZ.slice(),
      root: table.root.slice(),
      eaveH: table.eaveH.slice(),
      rough: table.rough.slice(),
      storeyH: table.storeyH.slice(),
      winAxis: table.winAxis.slice(),
      winH: table.winH.slice(),
      winStyle: table.winStyle.slice(),
      winW: table.winW.slice(),
    },
  };
}

/** One quad of the niche's box (unit frame: x along the wall, y up, z out
 *  of it; the box spans z −1…0), wound to face along `n`. */
function quad(
  corners: [number, number, number][],
  n: [number, number, number],
  pos: number[],
  nor: number[]
): void {
  const [a, b, c, d] = corners;
  const e1 = b.map((v, i) => v - a[i]);
  const e2 = c.map((v, i) => v - a[i]);
  const face = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const tris =
    face[0] * n[0] + face[1] * n[1] + face[2] * n[2] > 0
      ? [a, b, c, a, c, d]
      : [a, c, b, a, d, c];
  for (const v of tris) {
    pos.push(...v);
    nor.push(...n);
  }
}

/** The niche's box, open to the front: its back (the pane) and its four
 *  reveals, each facing into it. */
export function nicheGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  quad(
    [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
    [0, 0, 1],
    pos,
    nor
  );
  for (const s of [-1, 1]) {
    quad(
      [
        [s, -1, -1],
        [s, 1, -1],
        [s, 1, 0],
        [s, -1, 0],
      ],
      [-s, 0, 0],
      pos,
      nor
    );
    quad(
      [
        [-1, s, -1],
        [1, s, -1],
        [1, s, 0],
        [-1, s, 0],
      ],
      [0, -s, 0],
      pos,
      nor
    );
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  return g;
}

const flat = <T extends F | V3>(node: T): T =>
  // reason: a varying keeps its node's type; TSL's declaration widens it.
  varying(node).setInterpolation(
    InterpolationSamplingType.FLAT
  ) as unknown as T;

/**
 * The niche's material: each instance's matrix columns are its frame —
 * along the wall × half width, up × half height, out of the wall × depth,
 * the opening's middle — and their fourth rows its column, storey and
 * jitter seed (the clay's night hash). Its colour is the wall's
 * (`instanceTint`): the reveals plaster a shade darker, the back the
 * clay's window back, a smooth pane.
 */
export function nicheMaterial(d: ClayDetailUniforms): MeshStandardNodeMaterial {
  const c0 = attribute("iMat0", "vec4") as V4;
  const c1 = attribute("iMat1", "vec4") as V4;
  const c2 = attribute("iMat2", "vec4") as V4;
  const c3 = attribute("iMat3", "vec4") as V4;
  const unitPos = attribute("position", "vec3") as V3;
  const unitNor = attribute("normal", "vec3") as V3;
  const hw = length(c0.xyz);
  const hh = length(c1.xyz);
  const dep = length(c2.xyz);
  const t = c0.xyz.div(hw);
  const up = c1.xyz.div(hh);
  const out = c2.xyz.div(dep);
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  m.side = FrontSide;
  m.positionNode = c3.xyz
    .add(c0.xyz.mul(unitPos.x))
    .add(c1.xyz.mul(unitPos.y))
    .add(c2.xyz.mul(unitPos.z));
  const worldNormal = varying(
    normalize(t.mul(unitNor.x).add(up.mul(unitNor.y)).add(out.mul(unitNor.z)))
  ) as V3;
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
  // the fragment in the niche (m): along, up, and its depth behind the wall
  const local = varying(
    vec3(unitPos.x.mul(hw), unitPos.y.mul(hh), unitPos.z.mul(dep).negate())
  ) as V3;
  const size = flat(vec3(hw, hh, dep));
  const back = flat(step(0.5, unitNor.z) as F);
  // the sun in the niche's frame: past the reveals' edges or not
  const sunIn = flat(
    vec3(dot(d.uSun, t), dot(d.uSun, up), dot(d.uSun, out)) as V3
  );
  const reach = local.z.div(max(sunIn.z, 1e-3));
  const ex = local.x.add(sunIn.x.mul(reach));
  const ey = local.y.add(sunIn.y.mul(reach));
  const lit = step(0, sunIn.z)
    .mul(smoothstep(-0.015, 0.015, size.x.sub(abs(ex))))
    .mul(smoothstep(-0.015, 0.015, size.y.sub(abs(ey))));
  m.receivedShadowNode = (shadow?: unknown) => {
    const own = max(
      lit.mul(mix(1, WINDOW_TONE.backSun, back)),
      nightShadowFree
    );
    return shadow ? (shadow as F).mul(own) : own;
  };
  // less sky deeper in, and in the corners
  const deep = clamp(local.z.div(max(size.z, 0.01)), 0, 1);
  const edge = min(
    min(size.x.sub(abs(local.x)), size.y.sub(abs(local.y))),
    mix(size.z.sub(local.z), float(1), back)
  );
  const corner = mix(0.55, 1, smoothstep(0, 0.1, edge));
  const sky = mix(mix(1, WINDOW_TONE.revealSky, deep), 0.7, back);
  m.aoNode = corner.mul(sky);
  const plaster = instanceTint();
  const albedo = mix(
    plaster.mul(WINDOW_TONE.reveal),
    plaster.mul(vec3(...WINDOW_TONE.back)),
    back
  );
  m.colorNode = albedo;
  m.roughnessNode = mix(float(1), float(WINDOW_PANE_ROUGHNESS), back);
  // the pane: the sky at a grazing view, brighter toward its head; after
  // dark one in four lit (the clay's hash, its column, storey and seed)
  const fres = float(1).sub(clamp(abs(dot(viewDirection(), out)), 0, 1));
  const f2 = fres.mul(fres);
  const schlick = float(0.04).add(float(0.96).mul(f2.mul(f2).mul(fres)));
  const head = clamp(local.y.div(max(size.y, 0.1)).mul(0.5).add(0.5), 0, 1);
  const paneSky = back
    .mul(head.mul(WINDOW_SKY.up).add(schlick.mul(WINDOW_SKY.fresnel)))
    .mul(float(1).sub(d.uNight.mul(0.85)));
  const jks = flat(vec3(c0.w, c1.w, c2.w) as V3);
  const on = step(
    1 - NIGHT_WINDOWS.lit,
    windowHash(jks.x.add(jks.y.mul(17.31)), jks.z.add(3.7))
  );
  m.emissiveNode = vec3(0.55, 0.66, 0.8)
    .mul(paneSky)
    .add(
      vec3(1, 0.78, 0.48)
        .mul(back.mul(on).mul(NIGHT_WINDOWS.light))
        .mul(DUSK_GLOW)
        .mul(d.uNight)
    )
    // the street lamps light its reveals as they do the wall
    .add(albedo.mul(streetLight(worldNormal)));
  m.name = "window-niche";
  return m;
}

export interface NicheTile {
  city: CityLayer;
  /** packed (lib/city/window-niches.ts `packNiches`) */
  niches: Uint16Array;
  /** cell key → [first, end) */
  cells: Map<number, [number, number]>;
  /** the cells' extent (scene x, z) */
  box: [number, number, number, number];
  /** its clay cuts openings (`NicheOptions.cutOn`) */
  cutting: boolean;
  /** the houses (root objects) whose windows are niches now */
  houses: Set<number>;
  /** each house's windows' extent (x min, x max, z min, z max) */
  boxes: Map<number, [number, number, number, number]>;
}

/** How far from the eye a house's windows are real niches (m: its
 *  nearest window), on every device: a house turns as a whole. */
export const NICHE_RADIUS_M = 250;
/** The most niches drawn at once: the densest blocks hold ≈ 3000 within
 *  80 m; a phone's set is half as large (the nearest houses first, so in
 *  the densest blocks its radius ends nearer). */
export const NICHE_CAPACITY = { desktop: 32_768, mobile: 16_384 } as const;

/** The site's niches near the eye (see the head comment). */
export interface NicheField {
  mesh: Instances<MeshStandardNodeMaterial>;
  /** a tile's niches (`nichesOf`' output) on its city; returns what
   *  takes them off again */
  add: (city: CityLayer, built: NicheResult) => () => void;
  /** fills the set around the eye (null: none, Modell) */
  update: (eye: Vector3 | null) => void;
  /** the set compiled: it may draw (`compile` once a tile has niches) */
  ready: () => boolean;
  dispose: () => void;
}

/** The colour of an object's walls as the clay mixes it (visual-style.ts
 *  `clayColour`: the base, toward its tint where it has one). */
function wallColour(table: CityObjectTable, i: number, out: Color): Color {
  const base = new Color(CLAY_BASE);
  const r = table.tint[3 * i];
  const g = table.tint[3 * i + 1];
  const b = table.tint[3 * i + 2];
  if (r * r + g * g + b * b <= 1e-4) {
    return out.copy(base);
  }
  return out.setRGB(
    base.r + (r - base.r) * 0.6,
    base.g + (g - base.g) * 0.6,
    base.b + (b - base.b) * 0.6
  );
}

/**
 * A niche's instance matrix (column-major, at `at`) from its record in a
 * `tileNiches` list (at `o`): along the wall × half width, up × half
 * height, out of it × depth — a right-handed frame, or every face's
 * winding turns and the box is culled — and the opening's middle; their
 * fourth rows its column, storey and the jitter seed.
 */
export function writeNicheMatrix(
  m: Float32Array,
  at: number,
  f: Float32Array,
  o: number,
  seed: number
): void {
  const nx = f[o + 3];
  const nz = f[o + 4];
  const half = f[o + 5] + NICHE_OVERLAP_M;
  const depth = f[o + 7];
  m.set(
    [
      nz * half,
      0,
      -nx * half,
      f[o + 9],
      0,
      f[o + 6] + NICHE_OVERLAP_M,
      0,
      f[o + 10],
      nx * depth,
      0,
      nz * depth,
      seed,
      f[o],
      f[o + 1],
      f[o + 2],
      1,
    ],
    at
  );
}

interface Candidate {
  tile: NicheTile;
  i: number;
  cx: number;
  cz: number;
}

/** A house's niches: its tile, its root object (`CityObjectTable.root`),
 *  its nearest window's distance from the eye. */
export interface House {
  tile: NicheTile;
  root: number;
  dist: number;
  niches: Candidate[];
}

const scratch = new Float32Array(NICHE_STRIDE);

/** The niches of `tile` in cells c0…c1 × r0…r1, standing, each to its
 *  house (`only`: that house's alone), with its distance from (x, z). */
function scanCells(
  tile: NicheTile,
  cells: [number, number, number, number],
  eye: [number, number],
  into: Map<number, House>,
  only?: number
): void {
  const { baseZ, root } = tile.city.table;
  const [c0, c1, r0, r1] = cells;
  for (let cx = c0; cx <= c1; cx += 1) {
    for (let cz = r0; cz <= r1; cz += 1) {
      const range = tile.cells.get(nicheCellKey(cx, cz));
      if (!range) {
        continue;
      }
      for (let i = range[0]; i < range[1]; i += 1) {
        const f = unpackNiche(tile.niches, i, cx, cz, baseZ, scratch);
        const key = root[f[8]];
        if ((only !== undefined && key !== only) || !tile.city.stands(f[8])) {
          continue;
        }
        const dist = Math.hypot(f[0] - eye[0], f[2] - eye[1]);
        let house = into.get(key);
        if (!house) {
          house = { tile, root: key, dist, niches: [] };
          into.set(key, house);
        }
        house.dist = Math.min(house.dist, dist);
        house.niches.push({ tile, i, cx, cz });
      }
    }
  }
}

/** The cells (x from, x to, z from, z to) a box covers. */
const cellsOf = (x0: number, x1: number, z0: number, z1: number) =>
  [
    Math.floor(x0 / NICHE_CELL_M),
    Math.floor(x1 / NICHE_CELL_M),
    Math.floor(z0 / NICHE_CELL_M),
    Math.floor(z1 / NICHE_CELL_M),
  ] as [number, number, number, number];

/** The houses with niches within `reach` of (x, z), standing, each with
 *  all its niches — also those past the cells searched. */
function housesNear(
  tiles: Iterable<NicheTile>,
  x: number,
  z: number,
  reach: number
): House[] {
  const out: House[] = [];
  const searched = cellsOf(x - reach, x + reach, z - reach, z + reach);
  for (const tile of tiles) {
    const own = new Map<number, House>();
    scanCells(tile, searched, [x, z], own);
    for (const house of own.values()) {
      if (house.dist > reach) {
        continue;
      }
      const box = tile.boxes.get(house.root);
      const cells = box && cellsOf(box[0], box[1], box[2], box[3]);
      if (
        cells &&
        (cells[0] < searched[0] ||
          cells[1] > searched[1] ||
          cells[2] < searched[2] ||
          cells[3] > searched[3])
      ) {
        const whole = new Map<number, House>();
        scanCells(tile, cells, [x, z], whole, house.root);
        out.push(whole.get(house.root) ?? house);
      } else {
        out.push(house);
      }
    }
  }
  return out;
}

/**
 * The houses whose windows are niches with the eye at (x, z): every one
 * whose nearest window lies within `radius`, or within `HOUSE_KEEP_M`
 * more of it while it already is one (`NicheTile.houses`) — whole houses,
 * the nearest first, as many as `capacity` niches hold.
 */
export function nearHouses(
  tiles: Iterable<NicheTile>,
  x: number,
  z: number,
  radius: number,
  capacity: number
): House[] {
  const near = housesNear(tiles, x, z, radius + HOUSE_KEEP_M).filter(
    (h) => h.dist <= radius || h.tile.houses.has(h.root)
  );
  near.sort((a, b) => a.dist - b.dist);
  const picked: House[] = [];
  let count = 0;
  for (const house of near) {
    if (count + house.niches.length > capacity) {
      break;
    }
    picked.push(house);
    count += house.niches.length;
  }
  return picked;
}

/** A tile's cells' extent (scene x, z) from their keys (`nicheCellKey`). */
function cellBox(cells: Iterable<number>): [number, number, number, number] {
  const box: [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const key of cells) {
    const cx = Math.floor(key / 65_536) - 32_768;
    const cz = (key % 65_536) - 32_768;
    box[0] = Math.min(box[0], cx * NICHE_CELL_M);
    box[1] = Math.max(box[1], (cx + 1) * NICHE_CELL_M);
    box[2] = Math.min(box[2], cz * NICHE_CELL_M);
    box[3] = Math.max(box[3], (cz + 1) * NICHE_CELL_M);
  }
  return box;
}

/** How far (x, z) lies from a box (m; 0 inside). */
const boxDistance = (
  b: readonly [number, number, number, number],
  x: number,
  z: number
) =>
  Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - z, 0, z - b[3]));

/** A tile's clay starts cutting within this much past the set's radius
 *  of it (m), and stops past `CUT_OFF_M`: a clay that cuts loses its early
 *  depth test, so only the tiles near the eye do. */
const CUT_ON_M = 60;
const CUT_OFF_M = 160;

/** What the field asks of the app. */
export interface NicheOptions {
  /** the most niches drawn (`NICHE_CAPACITY`) */
  capacity: number;
  /** builds a drawable's shaders off the frame */
  compile: (object: Object3D) => Promise<unknown>;
  /** a tile's clay cuts its openings or not (visual-style.ts
   *  `setClayNicheCut`) */
  cutOn: (city: CityLayer, on: boolean) => void;
}

/** The site's niche set (one per app). */
export function createNicheField(
  d: ClayDetailUniforms,
  options: NicheOptions
): NicheField {
  const { capacity, compile, cutOn } = options;
  const geometry = nicheGeometry();
  const mesh = new Instances(geometry, nicheMaterial(d), capacity);
  mesh.name = "window-niches";
  mesh.setColorAt(0, new Color(CLAY_BASE));
  mesh.drawCount = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.visible = false;
  const tiles = new Map<CityLayer, NicheTile>();
  const none: ReadonlySet<number> = new Set();
  const last = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  let lastAt = 0;
  let dirty = true;
  let compiled = false;
  let compiling = false;
  const colour = new Color();
  const setCut = (tile: NicheTile, on: boolean) => {
    if (tile.cutting === on) {
      return;
    }
    tile.cutting = on;
    cutOn(tile.city, on);
  };
  /** the tiles near the eye cut, those far from it stop */
  const cutNear = (eye: Vector3) => {
    for (const tile of tiles.values()) {
      const far = boxDistance(tile.box, eye.x, eye.z);
      if (far < NICHE_RADIUS_M + CUT_ON_M) {
        setCut(tile, true);
      } else if (far > NICHE_RADIUS_M + CUT_OFF_M) {
        setCut(tile, false);
      }
    }
  };
  const startCompile = () => {
    if (compiled || compiling) {
      return;
    }
    compiling = true;
    mesh.drawCount = 1;
    void compile(mesh)
      .catch(() => {
        // built on its first draw then
      })
      .finally(() => {
        compiled = true;
        dirty = true;
      });
  };
  /** what a tile's clay cuts: its houses' objects with niches */
  const setHouses = (tile: NicheTile, objects: ReadonlySet<number>) => {
    tile.houses = new Set([...objects].map((o) => tile.city.table.root[o]));
    tile.city.setNiched(objects);
  };
  const clear = () => {
    for (const tile of tiles.values()) {
      if (tile.houses.size > 0) {
        setHouses(tile, none);
      }
    }
  };
  const fill = (eye: Vector3) => {
    const houses = nearHouses(
      tiles.values(),
      eye.x,
      eye.z,
      NICHE_RADIUS_M,
      capacity
    );
    const m = mesh.instanceMatrix.array as Float32Array;
    const tints = mesh.instanceTints?.array as Float32Array;
    const objects = new Map<NicheTile, Set<number>>();
    let k = 0;
    for (const house of houses) {
      const { table } = house.tile.city;
      let own = objects.get(house.tile);
      if (!own) {
        own = new Set();
        objects.set(house.tile, own);
      }
      for (const { i, cx, cz } of house.niches) {
        const f = unpackNiche(
          house.tile.niches,
          i,
          cx,
          cz,
          table.baseZ,
          scratch
        );
        const object = f[8];
        own.add(object);
        writeNicheMatrix(m, k * 16, f, 0, table.rough[object]);
        wallColour(table, object, colour).toArray(tints, k * 3);
        k += 1;
      }
    }
    for (const tile of tiles.values()) {
      setHouses(tile, objects.get(tile) ?? none);
    }
    mesh.drawCount = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceTints) {
      mesh.instanceTints.needsUpdate = true;
    }
    mesh.visible = k > 0;
  };
  return {
    mesh,
    add: (city, { niches, cells, houses }) => {
      const boxes = new Map<number, [number, number, number, number]>();
      for (let o = 0; o + HOUSE_STRIDE <= houses.length; o += HOUSE_STRIDE) {
        boxes.set(houses[o], [
          houses[o + 1],
          houses[o + 2],
          houses[o + 3],
          houses[o + 4],
        ]);
      }
      const map = new Map<number, [number, number]>();
      for (let i = 0; i + 2 < cells.length; i += 3) {
        map.set(cells[i], [cells[i + 1], cells[i + 2]]);
      }
      const tile: NicheTile = {
        city,
        niches,
        cells: map,
        box: cellBox(map.keys()),
        cutting: false,
        houses: new Set(),
        boxes,
      };
      tiles.set(city, tile);
      dirty = true;
      startCompile();
      return () => {
        tiles.delete(city);
        setHouses(tile, none);
        setCut(tile, false);
        dirty = true;
      };
    },
    update: (eye) => {
      if (!(eye && compiled)) {
        if (mesh.visible) {
          mesh.visible = false;
          clear();
          dirty = true;
        }
        return;
      }
      const now = performance.now();
      if (
        !dirty &&
        Math.hypot(eye.x - last.x, eye.z - last.z) < REFILL_MOVE_M &&
        now - lastAt < REFILL_MS
      ) {
        return;
      }
      dirty = false;
      last.copy(eye);
      lastAt = now;
      cutNear(eye);
      fill(eye);
    },
    ready: () => compiled,
    dispose: () => {
      for (const tile of tiles.values()) {
        setHouses(tile, none);
        setCut(tile, false);
      }
      tiles.clear();
      mesh.removeFromParent();
      geometry.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}
