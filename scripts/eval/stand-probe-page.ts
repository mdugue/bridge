/**
 * The page of scripts/eval/stand-record-probe.ts (plan 090, phase 0): a
 * bare three.js WebGPU scene that answers, on the installed three's public
 * API, what the stand record needs to know — which typed arrays and
 * `normalized` flags reach TSL as which WGSL types, whether one
 * interleaved buffer carries 16-bit and 8-bit fields, whether a table's
 * origin reaches the shader per object without a material or a build per
 * table, and how many vertex buffers and inter-stage variables each
 * variant takes. It draws the viewer's own `Instances` (instancing.ts)
 * and rail segments (rail-segments.ts), and compares each record-drawn
 * picture with the same things drawn from matrices or triangles.
 * Browser code: bundled and served by the probe, never by the app.
 */
import {
  BoxGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  InterpolationSamplingType,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  Quaternion,
  REVISION,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import type { Material, Object3D } from "three/webgpu";
import {
  attribute,
  normalLocal,
  positionLocal,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import {
  Instances,
  instancePosition,
  standByte,
  standTable,
} from "@/app/_components/instancing";
import { addRibbon, mesh3, meshFrom } from "@/app/_components/mesh-kit";
import { railChunkMesh, railProfile } from "@/app/_components/rail-segments";
import { packRails } from "@/lib/city/rail-table";
import type { RailRun } from "@/lib/city/rail-table";
import { packStands, standOrigin } from "@/lib/city/stand-record";
import type { Stand } from "@/lib/city/stand-record";

const SIZE = 256;

interface Budget {
  /** the vertex stage's inputs, `name: type` */
  attributes: string[];
  /** the distinct buffers those inputs are views of (of WebGPU's eight) */
  vertexBuffers: number;
  /** the variables the vertex stage hands the fragment stage (of sixteen,
   *  less the fragment stage's counting builtins) */
  varyings: number;
}

/** The vertex stage's inputs and its outputs to the fragment stage, read
 *  from the build's WGSL (PR #314's method: three's public
 *  `renderer.debug.getShaderAsync`), and the buffers behind the inputs,
 *  read from the geometry. */
function budgetOf(vertexShader: string | null, object: Object3D): Budget {
  const text = vertexShader ?? "";
  const params =
    /fn main\s*\((?<params>[\s\S]*?)\)\s*->/u.exec(text)?.groups?.params ?? "";
  const inputs = [
    ...params.matchAll(
      /@location\(\s*\d+\s*\)\s+(?<name>\w+)\s*:\s*(?<type>[\w<>]+)/gu
    ),
  ].map((m) => ({ name: m.groups?.name ?? "", type: m.groups?.type ?? "" }));
  const struct = /struct VaryingsStruct \{(?<body>[^}]*)\}/u.exec(text);
  const varyings = (struct?.groups?.body.match(/@location/gu) ?? []).length;
  const { geometry } = object as Mesh;
  const buffers = new Set<unknown>();
  for (const { name } of inputs) {
    const a = geometry.getAttribute(name) as { data?: unknown } | undefined;
    if (a) {
      buffers.add(a.data ?? a);
    }
  }
  return {
    attributes: inputs.map((a) => `${a.name}: ${a.type}`),
    vertexBuffers: buffers.size,
    varyings,
  };
}

/** A seeded random number generator (mulberry32). */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d_2b_79_f5;
    let s = Math.imul(state ^ (state >>> 15), state | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const word = (v: number[]) => new Uint16Array(v);
const byte = (v: number[]) => new Uint8Array(v);

/** `m`'s position node on an unlit material whose colour is the turned
 *  normal: a wrong placement or turn shows as a wrong pixel. */
function flat(m: Material): MeshBasicNodeMaterial {
  const basic = new MeshBasicNodeMaterial();
  basic.positionNode = (m as MeshBasicNodeMaterial).positionNode;
  basic.colorNode = vec4(normalLocal.mul(0.5).add(0.5), 1);
  return basic;
}

const lit = (px: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] + px[i + 1] + px[i + 2] > 24) {
      n += 1;
    }
  }
  return n;
};

const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) > 24 ||
      Math.abs(a[i + 1] - b[i + 1]) > 24 ||
      Math.abs(a[i + 2] - b[i + 2]) > 24
    ) {
      n += 1;
    }
  }
  return n;
};

async function main() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  document.body.append(canvas);
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  const errors: string[] = [];
  // reason: the probe reads the device's validation errors, which three
  // exposes on its backend only
  const { device } = renderer.backend as unknown as { device: GPUDevice };
  device.addEventListener("uncapturederror", (event) => {
    errors.push(event.error.message.slice(0, 300));
  });
  // three reports a pipeline it could not make on the console
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" ").slice(0, 300));
    consoleError(...args);
  };
  let builds = 0;
  renderer.debug.onNodeBuilderCreated = () => {
    builds += 1;
  };

  /** Draws a frame, and again once the first one's pipelines are ready. */
  const frame = async (drawn: Scene, view: OrthographicCamera) => {
    await renderer.compileAsync(drawn, view);
    renderer.render(drawn, view);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    renderer.render(drawn, view);
  };

  const camera = new OrthographicCamera(-60, 60, 60, -60, 1, 500);
  camera.position.set(80, 120, 140);
  camera.lookAt(0, 0, 0);
  const scene = new Scene();
  scene.background = new Color(0x00_00_00);

  /** Draws `objects` alone and returns the frame's pixels. */
  const draw = async (objects: Object3D[]): Promise<Uint8ClampedArray> => {
    scene.clear();
    for (const o of objects) {
      scene.add(o);
    }
    await frame(scene, camera);
    const copy = document.createElement("canvas");
    copy.width = SIZE;
    copy.height = SIZE;
    const ctx = copy.getContext("2d");
    if (!ctx) {
      throw new Error("no 2d context");
    }
    ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, SIZE, SIZE).data;
  };
  const shaderOf = async (object: Object3D) => {
    const s = await renderer.debug.getShaderAsync(scene, camera, object);
    return budgetOf(s.vertexShader, object);
  };

  // --- 1. stands: matrices against records ---------------------------------
  const random = rng(7);
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const material = new MeshBasicNodeMaterial();
  material.positionNode = instancePosition();
  // the turned normal as the colour: a wrong turn shows
  material.colorNode = vec4(normalLocal.mul(0.5).add(0.5), 1);
  const tables = [
    { at: [-1030, 100, 2040], n: 120 },
    { at: [-1030, 100, 2040], n: 90 },
  ].map(({ at, n }, k) => {
    const stands: Stand[] = Array.from({ length: n }, () => ({
      x: at[0] + (k === 0 ? 0 : 55) + random() * 50,
      y: at[1] + random() * 4,
      z: at[2] + random() * 100,
      turn: random() * Math.PI * 2,
      scale: [1 + random() * 3, 1 + random() * 6, 1 + random() * 3],
      kind: [3, 200],
      more: [17, 255],
    }));
    return stands;
  });
  camera.position.set(-1030 + 55 + 80, 100 + 120, 2040 + 50 + 140);
  camera.lookAt(-1030 + 55, 100, 2040 + 50);
  camera.updateMatrixWorld();
  const matrixSets = tables.map((stands) => {
    const set = new Instances(box, material, stands.length);
    const m = new Matrix4();
    const y = new Vector3(0, 1, 0);
    for (const [i, s] of stands.entries()) {
      m.compose(
        new Vector3(s.x, s.y, s.z),
        new Quaternion().setFromAxisAngle(y, s.turn),
        new Vector3(...s.scale)
      );
      set.setMatrixAt(i, m);
    }
    set.instanceMatrix.needsUpdate = true;
    set.computeBoundingSphere();
    return set;
  });
  // one file's bytes for both tables, each set a view of its run
  const all = tables.flat();
  const file = new Uint16Array(all.length * 10);
  let run = 0;
  const recordSets = tables.map((stands) => {
    const origin = standOrigin(stands);
    const view = file.subarray(run * 10, (run + stands.length) * 10);
    view.set(packStands(stands, origin));
    run += stands.length;
    const set = Instances.ofStands(box, material, standTable(view, origin));
    set.computeBoundingSphere();
    return set;
  });
  // a second set of the same material and layout must build nothing
  await draw([matrixSets[0]]);
  builds = 0;
  const fromMatrices = await draw(matrixSets);
  const matrixBuilds = builds;
  await draw([recordSets[0]]);
  builds = 0;
  const fromRecords = await draw(recordSets);
  const recordBuilds = builds;
  // a record's bytes, taken out of their words in the vertex stage
  // (`standByte`): the stands above carry 200 and 255 in bytes 1 and 3
  const byteRed = async (index: 0 | 1 | 2 | 3) => {
    const m = new MeshBasicNodeMaterial();
    m.positionNode = instancePosition();
    const value = varying(standByte(index).div(255)).setInterpolation(
      InterpolationSamplingType.FLAT
    );
    m.colorNode = vec4(vec3(value), 1);
    const sets = recordSets.map((set) => {
      const twin = new Instances(box, m, set.capacity, set.placement);
      twin.geometry.boundingSphere = set.geometry.boundingSphere;
      return twin;
    });
    const px = await draw(sets);
    let red = 0;
    for (let i = 0; i < px.length; i += 4) {
      red = Math.max(red, px[i]);
    }
    return red;
  };
  const standBytes = {
    // sRGB of 200/255 is 229, of 255/255 is 255
    byte1Of200: await byteRed(1),
    byte3Of255: await byteRed(3),
  };
  const stands = {
    standBytes,
    litMatrices: lit(fromMatrices),
    litRecords: lit(fromRecords),
    differing: differing(fromMatrices, fromRecords),
    buildsForASecondMatrixSet: matrixBuilds,
    buildsForASecondRecordSet: recordBuilds,
    matrices: await shaderOf(matrixSets[0]),
    records: await shaderOf(recordSets[0]),
  };

  // --- 2. which arrays reach TSL as which types ----------------------------
  const quad = new BoxGeometry(100, 1, 100);
  camera.position.set(0, 200, 0.001);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const typeRows: Record<string, unknown>[] = [];
  const probeType = async (
    label: string,
    make: (g: InstancedBufferGeometry) => unknown,
    declared: string,
    expectRed: number
  ) => {
    const g = new InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.instanceCount = 1;
    make(g);
    const m = new MeshBasicNodeMaterial();
    if (g.hasAttribute("other")) {
      // read too, so that its buffer is uploaded (it moves nothing)
      m.positionNode = positionLocal.add(
        vec4(attribute("other", "uvec4")).xyz.mul(0)
      );
    }
    // the first component as red, scaled so that 200 (of a byte) or
    // 40 000 (of a word) reads the same grey whatever the type
    // (typed as a vec4 for the compiler; the node is of `declared`)
    const raw = attribute("probe", declared as "vec4");
    const value = declared.startsWith("u") ? vec4(raw) : raw;
    m.colorNode = vec4(vec3(value.x.mul(expectRed)), 1);
    const mesh = new Mesh(g, m);
    mesh.frustumCulled = false;
    const before = errors.length;
    let wgsl = "";
    let px: Uint8ClampedArray | null = null;
    let threw = "";
    try {
      px = await draw([mesh]);
      const s = await renderer.debug.getShaderAsync(scene, camera, mesh);
      wgsl =
        /@location\(\s*\d+\s*\)\s+probe\s*:\s*(?<type>[\w<>]+)/u.exec(
          s.vertexShader ?? ""
        )?.groups?.type ?? "?";
    } catch (error) {
      threw = String(error).slice(0, 200);
    }
    const stored = (g.getAttribute("probe") as { array: ArrayLike<number> })
      .array;
    typeRows.push({
      label,
      wgsl,
      // the mid-frame pixel's red: 188 (0.5, sRGB) when the value arrived
      // as meant
      red: px ? px[(SIZE / 2) * SIZE * 4 + (SIZE / 2) * 4] : null,
      arrayAfterUpload: (stored as object).constructor.name,
      errors: errors.slice(before),
      threw,
    });
    m.dispose();
  };
  // 16-bit words, interleaved
  await probeType(
    "interleaved Uint16Array, not normalized, itemSize 4",
    (g) =>
      g.setAttribute(
        "probe",
        new InterleavedBufferAttribute(
          new InstancedInterleavedBuffer(
            word([40_000, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            10,
            1
          ),
          4,
          0
        )
      ),
    "uvec4",
    0.5 / 40_000
  );
  await probeType(
    "interleaved Uint16Array, normalized, itemSize 4",
    (g) =>
      g.setAttribute(
        "probe",
        new InterleavedBufferAttribute(
          new InstancedInterleavedBuffer(
            word([40_000, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            10,
            1
          ),
          4,
          0,
          true
        )
      ),
    "vec4",
    (0.5 * 65_535) / 40_000
  );
  await probeType(
    "interleaved Uint16Array, not normalized, itemSize 2 at word 8",
    (g) =>
      g.setAttribute(
        "probe",
        new InterleavedBufferAttribute(
          new InstancedInterleavedBuffer(
            word([0, 0, 0, 0, 0, 0, 0, 0, 40_000, 0]),
            10,
            1
          ),
          2,
          8
        )
      ),
    "uvec2",
    0.5 / 40_000
  );
  // bytes, interleaved
  await probeType(
    "interleaved Uint8Array, normalized, itemSize 4 at byte 16 of 20",
    (g) => {
      const bytes = byte(Array.from({ length: 20 }, () => 0));
      bytes[16] = 200;
      g.setAttribute(
        "probe",
        new InterleavedBufferAttribute(
          new InstancedInterleavedBuffer(bytes, 20, 1),
          4,
          16,
          true
        )
      );
    },
    "vec4",
    (0.5 * 255) / 200
  );
  await probeType(
    "interleaved Uint8Array, not normalized, itemSize 4 at byte 16 of 20",
    (g) => {
      const bytes = byte(Array.from({ length: 20 }, () => 0));
      bytes[16] = 200;
      g.setAttribute(
        "probe",
        new InterleavedBufferAttribute(
          new InstancedInterleavedBuffer(bytes, 20, 1),
          4,
          16
        )
      );
    },
    "uvec4",
    0.5 / 200
  );
  // plain (not interleaved) attributes
  await probeType(
    "InstancedBufferAttribute Uint16Array, not normalized, itemSize 4",
    (g) =>
      g.setAttribute(
        "probe",
        new InstancedBufferAttribute(word([40_000, 0, 0, 0]), 4)
      ),
    "uvec4",
    0.5 / 40_000
  );
  await probeType(
    "InstancedBufferAttribute Uint16Array, normalized, itemSize 4",
    (g) =>
      g.setAttribute(
        "probe",
        new InstancedBufferAttribute(word([40_000, 0, 0, 0]), 4, true)
      ),
    "vec4",
    (0.5 * 65_535) / 40_000
  );
  await probeType(
    "InstancedBufferAttribute Uint16Array, normalized, itemSize 3",
    (g) =>
      g.setAttribute(
        "probe",
        new InstancedBufferAttribute(word([40_000, 0, 0]), 3, true)
      ),
    "vec3",
    (0.5 * 65_535) / 40_000
  );
  await probeType(
    "InstancedBufferAttribute Uint8Array, normalized, itemSize 4",
    (g) =>
      g.setAttribute(
        "probe",
        new InstancedBufferAttribute(byte([200, 0, 0, 0]), 4, true)
      ),
    "vec4",
    (0.5 * 255) / 200
  );
  await probeType(
    "InstancedBufferAttribute Uint8Array, not normalized, itemSize 4",
    (g) =>
      g.setAttribute(
        "probe",
        new InstancedBufferAttribute(byte([200, 0, 0, 0]), 4)
      ),
    "uvec4",
    0.5 / 200
  );
  await probeType(
    "InstancedBufferAttribute Uint16Array, normalized, itemSize 1",
    (g) =>
      g.setAttribute(
        "probe",
        new InstancedBufferAttribute(word([40_000, 0]), 1, true)
      ),
    "float",
    (0.5 * 65_535) / 40_000
  );
  // two views of one ArrayBuffer: words and bytes of the same 20 bytes
  const shared = new ArrayBuffer(20);
  new Uint8Array(shared)[16] = 200;
  const memoryBefore = { ...renderer.info.memory } as Record<string, number>;
  await probeType(
    "two interleaved buffers over one ArrayBuffer (a Uint16Array and a Uint8Array view)",
    (g) => {
      g.setAttribute(
        "other",
        new InterleavedBufferAttribute(
          new InstancedInterleavedBuffer(new Uint16Array(shared), 10, 1),
          4,
          0
        )
      );
      g.setAttribute(
        "probe",
        new InterleavedBufferAttribute(
          new InstancedInterleavedBuffer(new Uint8Array(shared), 20, 1),
          4,
          16,
          true
        )
      );
    },
    "vec4",
    (0.5 * 255) / 200
  );
  const memoryAfter = { ...renderer.info.memory } as Record<string, number>;

  // --- 3. rails: triangles against segments --------------------------------
  const railRuns: RailRun[] = [
    {
      gauge: 1.435,
      lateral: 0,
      look: "tram-street",
      web: 0.04,
      pts: Array.from({ length: 24 }, (_, i) => ({
        x: 500 + i * 2,
        y: 110 + Math.sin(i / 5) * 0.4,
        z: -300 + Math.sin(i / 4) * 6,
      })),
    },
    {
      gauge: 1.435,
      lateral: 4.5,
      look: "rail",
      web: 0.11,
      pts: Array.from({ length: 12 }, (_, i) => ({
        x: 500 + i * 4,
        y: 110.2,
        z: -310 - i * 0.7,
      })),
    },
  ];
  const acc = mesh3();
  for (const r of railRuns) {
    addRibbon(acc, [...r.pts], r.lateral + r.gauge / 2, 0.075, r.web);
    addRibbon(acc, [...r.pts], r.lateral - r.gauge / 2, 0.075, r.web);
  }
  const plain = new MeshBasicNodeMaterial();
  plain.colorNode = vec4(normalLocal.mul(0.5).add(0.5), 1);
  const triangles = meshFrom(acc, 0, { cast: false, material: plain });
  const chunks = packRails(railRuns);
  const segmentMaterials = new Map<Material, Material>();
  const segments = chunks.map((chunk) => {
    const mesh = railChunkMesh(chunk, railProfile(chunk.gauge, chunk.web));
    let basic = segmentMaterials.get(mesh.material);
    if (!basic) {
      basic = flat(mesh.material);
      segmentMaterials.set(mesh.material, basic);
    }
    const drawn: Mesh = mesh;
    drawn.material = basic;
    return drawn;
  });
  // a narrow view along the track, so a rail is several pixels wide
  const railCamera = new OrthographicCamera(-8, 8, 8, -8, 1, 500);
  railCamera.position.set(523, 150, -280);
  railCamera.lookAt(523, 110, -303);
  railCamera.updateMatrixWorld();
  const drawRails = async (objects: Object3D[]) => {
    scene.clear();
    for (const o of objects) {
      scene.add(o);
    }
    await frame(scene, railCamera);
    const copy = document.createElement("canvas");
    copy.width = SIZE;
    copy.height = SIZE;
    const ctx = copy.getContext("2d");
    if (!ctx) {
      throw new Error("no 2d context");
    }
    ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, SIZE, SIZE).data;
  };
  const railTriangles = triangles ? await drawRails([triangles]) : null;
  builds = 0;
  const railSegments = await drawRails(segments);
  const rails = {
    chunks: chunks.length,
    litTriangles: railTriangles ? lit(railTriangles) : null,
    litSegments: lit(railSegments),
    differing: railTriangles ? differing(railTriangles, railSegments) : null,
    builds,
    segments: await (async () => {
      const s = await renderer.debug.getShaderAsync(
        scene,
        railCamera,
        segments[0]
      );
      return budgetOf(s.vertexShader, segments[0]);
    })(),
  };

  return {
    three: REVISION,
    adapter: (
      renderer.backend as unknown as {
        adapter?: { info?: { description?: string } };
      }
    ).adapter?.info?.description,
    stands,
    types: typeRows,
    oneArrayBufferTwoViews: {
      attributesBefore: memoryBefore.attributes,
      attributesAfter: memoryAfter.attributes,
    },
    rails,
    errors,
  };
}

declare global {
  interface Window {
    probe?: unknown;
    probeError?: string;
  }
}

try {
  window.probe = await main();
} catch (error) {
  window.probeError = String((error as Error | undefined)?.stack ?? error);
}
