import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  InterpolationSamplingType,
  Matrix4,
  MeshStandardNodeMaterial,
  Vector3,
  Vector4,
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
  NICHE_CELL_M,
  NICHE_STRIDE,
  nicheCellKey,
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
import { nightShadowFree } from "./lantern";
import { setSlots, slotsOf } from "./material-slots";
import type { F, V3, V4 } from "./shader-chunks";
import { viewDirection } from "./view-direction";
import type { NicheJobInput } from "./window-niche-client";
import { CLAY_BASE, DUSK_GLOW, NICHES_SLOT } from "./visual-style";
import type { ClayDetailUniforms } from "./visual-style";

/**
 * Real niches behind the near windows (desktop only): the clay draws a
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
 * kept per tile by cell. One set of instances for the site holds the niches
 * within `NICHE_RADIUS_M` of the eye, refilled as it moves; the tiles whose
 * niches it holds cut their openings within the radius it filled (less a
 * window's reach), so no opening is cut without its niche — what a niche
 * too many costs is a box unseen behind a wall.
 */

/** How far from the eye windows are real niches (m). */
export const NICHE_RADIUS_M = 80;
/** The most niches drawn at once: the old town's densest blocks hold
 *  ≈ 3000 within the radius. */
export const NICHE_CAPACITY = 8192;
/** A window's reach from its middle (m): an opening cut within the filled
 *  radius less this has its niche. */
const NICHE_REACH_M = 3;
/** How far the box reaches past its opening each way (m): the clay's
 *  cut edge is anti-aliased and its corners round, and what lies past the
 *  box behind a cut would be a hole into the building; past the opening
 *  the box stays unseen behind the wall. */
const NICHE_OVERLAP_M = 0.04;
/** How far the eye moves before the set is filled again (m), and how
 *  often it is anyway (a demolish, a design, a tile landing). */
const REFILL_MOVE_M = 4;
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
  const n = position.count;
  const positions = new Float32Array(n * 3);
  const p = new Vector3();
  for (let i = 0; i < n; i += 1) {
    p.fromBufferAttribute(position, i).applyMatrix4(toData);
    positions[3 * i] = p.x;
    positions[3 * i + 1] = p.z;
    positions[3 * i + 2] = -p.y;
  }
  const codes = new Int16Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    codes[4 * i] = Math.round(facade.getX(i) * 32_767);
    codes[4 * i + 1] = Math.round(facade.getY(i) * 32_767);
    codes[4 * i + 2] = Math.round(facade.getZ(i) * 32_767);
    codes[4 * i + 3] = Math.round(facade.getW(i) * 32_767);
  }
  const objectIds = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    objectIds[i] = Math.round(ids.getX(i));
  }
  const index = geometry.getIndex();
  return {
    mesh: {
      positions,
      facade: codes,
      objectIds,
      index: index ? Uint32Array.from(index.array) : undefined,
    },
    table: {
      baseZ: table.baseZ.slice(),
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
  m.colorNode = mix(
    plaster.mul(WINDOW_TONE.reveal),
    plaster.mul(vec3(...WINDOW_TONE.back)),
    back
  );
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
    );
  m.name = "window-niche";
  return m;
}

interface NicheTile {
  city: CityLayer;
  niches: Float32Array;
  /** cell key → [first, end) */
  cells: Map<number, [number, number]>;
}

/** The site's niches near the eye (see the head comment). */
export interface NicheField {
  mesh: Instances<MeshStandardNodeMaterial>;
  /** a tile's niches (`cellNiches`' output) on its city; returns what
   *  takes them off again */
  add: (
    city: CityLayer,
    niches: Float32Array,
    cells: Float64Array
  ) => () => void;
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
  dist: number;
}

/** The niches of `tiles` within `radius` of (x, z), nearest first when
 *  there are more than `capacity`; and the radius they cover. */
export function nearNiches(
  tiles: Iterable<NicheTile>,
  x: number,
  z: number,
  radius: number,
  capacity: number
): { picked: Candidate[]; covered: number } {
  const picked: Candidate[] = [];
  const c0 = Math.floor((x - radius) / NICHE_CELL_M);
  const c1 = Math.floor((x + radius) / NICHE_CELL_M);
  const r0 = Math.floor((z - radius) / NICHE_CELL_M);
  const r1 = Math.floor((z + radius) / NICHE_CELL_M);
  for (const tile of tiles) {
    for (let cx = c0; cx <= c1; cx += 1) {
      for (let cz = r0; cz <= r1; cz += 1) {
        const range = tile.cells.get(nicheCellKey(cx, cz));
        if (!range) {
          continue;
        }
        for (let i = range[0]; i < range[1]; i += 1) {
          const o = i * NICHE_STRIDE;
          const dist = Math.hypot(tile.niches[o] - x, tile.niches[o + 2] - z);
          if (dist <= radius && tile.city.stands(tile.niches[o + 8])) {
            picked.push({ tile, i, dist });
          }
        }
      }
    }
  }
  if (picked.length <= capacity) {
    return { picked, covered: radius };
  }
  picked.sort((a, b) => a.dist - b.dist);
  const covered = picked[capacity].dist;
  return { picked: picked.slice(0, capacity), covered };
}

/** The site's niche set (one per app; desktop only). `compile` builds its
 *  shaders off the frame before it first draws. */
export function createNicheField(
  d: ClayDetailUniforms,
  compile: (object: Object3D) => Promise<unknown>
): NicheField {
  const geometry = nicheGeometry();
  const mesh = new Instances(geometry, nicheMaterial(d), NICHE_CAPACITY);
  mesh.name = "window-niches";
  mesh.setColorAt(0, new Color(CLAY_BASE));
  mesh.drawCount = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.visible = false;
  const tiles = new Map<CityLayer, NicheTile>();
  /** what every tile with niches cuts: the set's centre and radius */
  const cut = new Vector4(0, 0, 0, 0);
  const last = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  let lastAt = 0;
  let dirty = true;
  let compiled = false;
  let compiling = false;
  const colour = new Color();
  const setCut = (city: CityLayer, on: boolean) => {
    const clay = city.mesh.material as MeshStandardNodeMaterial;
    setSlots(clay, {
      ...slotsOf(clay),
      [NICHES_SLOT]: on ? cut : new Vector4(0, 0, 0, 0),
    });
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
  const fill = (eye: Vector3) => {
    const { picked, covered } = nearNiches(
      tiles.values(),
      eye.x,
      eye.z,
      NICHE_RADIUS_M,
      NICHE_CAPACITY
    );
    const m = mesh.instanceMatrix.array as Float32Array;
    const tints = mesh.instanceTints?.array as Float32Array;
    for (let k = 0; k < picked.length; k += 1) {
      const { tile, i } = picked[k];
      const f = tile.niches;
      const o = i * NICHE_STRIDE;
      const object = f[o + 8];
      writeNicheMatrix(m, k * 16, f, o, tile.city.table.rough[object]);
      wallColour(tile.city.table, object, colour).toArray(tints, k * 3);
    }
    mesh.drawCount = picked.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceTints) {
      mesh.instanceTints.needsUpdate = true;
    }
    cut.set(eye.x, eye.z, Math.max(covered - NICHE_REACH_M, 0), 0);
    mesh.visible = picked.length > 0;
  };
  return {
    mesh,
    add: (city, niches, cells) => {
      const map = new Map<number, [number, number]>();
      for (let i = 0; i + 2 < cells.length; i += 3) {
        map.set(cells[i], [cells[i + 1], cells[i + 2]]);
      }
      tiles.set(city, { city, niches, cells: map });
      setCut(city, true);
      dirty = true;
      startCompile();
      return () => {
        tiles.delete(city);
        setCut(city, false);
        dirty = true;
      };
    },
    update: (eye) => {
      if (!(eye && compiled)) {
        if (mesh.visible || cut.z > 0) {
          mesh.visible = false;
          cut.z = 0;
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
      fill(eye);
    },
    ready: () => compiled,
    dispose: () => {
      for (const city of tiles.keys()) {
        setCut(city, false);
      }
      tiles.clear();
      mesh.removeFromParent();
      geometry.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}
