import { expect, test } from "bun:test";
import { LoadingManager, type Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb } from "./glb-container";
import { toExtMeshopt } from "./khr-meshopt";
import { simplifyGlb, writeMeshGlb } from "./tile-glb";

interface Json {
  bufferViews: {
    extensions?: Record<
      string,
      { byteOffset: number; byteLength: number; mode: string }
    >;
  }[];
  extensionsUsed: string[];
  extensionsRequired: string[];
}

// a 20×20 grid with a bump: enough vertices for the codec to matter
function grid(): {
  positions: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
} {
  const n = 20;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      positions.set([i * 2, j * 2, Math.sin(i / 3) * Math.cos(j / 4) * 5], k);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      indices.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  return { positions, indices: new Uint32Array(indices) };
}

async function writeGrid(): Promise<Uint8Array> {
  const { positions, indices } = grid();
  return writeMeshGlb({
    name: "terrain",
    positions,
    indices,
    normals: new Float32Array(positions.length)
      .fill(0)
      .map((_, i) => (i % 3 === 2 ? 1 : 0)),
    extras: { kind: "terrain", tileId: "t" },
  });
}

test("a written glb is KHR_meshopt_compression, each attribute stream in v0 or v1", async () => {
  const glb = await writeGrid();
  const { json, bin } = readGlb<Json>(glb);
  expect(json.extensionsUsed).toContain("KHR_meshopt_compression");
  expect(json.extensionsRequired).toContain("KHR_meshopt_compression");
  expect(json.extensionsUsed).not.toContain("EXT_meshopt_compression");
  const streams = json.bufferViews
    .map((v) => v.extensions?.KHR_meshopt_compression)
    .filter((e) => e !== undefined);
  expect(streams.some((e) => e.mode === "ATTRIBUTES")).toBe(true);
  for (const e of streams) {
    // meshopt's stream header: 0xa0 | version for attributes
    if (e.mode === "ATTRIBUTES") {
      expect([0xa0, 0xa1]).toContain(bin[e.byteOffset]);
    }
  }
});

test("three's GLTFLoader reads the KHR glb back to the grid", async () => {
  const glb = await writeGrid();
  const loader = new GLTFLoader(new LoadingManager());
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(glb.slice().buffer, "");
  let mesh: Mesh | undefined;
  gltf.scene.traverse((o) => {
    mesh ??= (o as Mesh).isMesh ? (o as Mesh) : undefined;
  });
  expect(mesh).toBeDefined();
  gltf.scene.updateMatrixWorld(true);
  const position = mesh?.geometry.getAttribute("position");
  const { positions } = grid();
  expect(position?.count).toBe(positions.length / 3);
  // every grid point is a vertex again (Y-up: (x, y, z) → (x, z, −y)),
  // within the 16-bit quantisation of a 38 m mesh
  const have = new Set<string>();
  const p = new Vector3();
  for (let i = 0; i < (position?.count ?? 0); i++) {
    p.fromBufferAttribute(position as never, i).applyMatrix4(
      mesh?.matrixWorld as never
    );
    have.add(`${Math.round(p.x)},${Math.round(-p.z)}`);
  }
  for (let k = 0; k < positions.length; k += 3) {
    expect(have.has(`${positions[k]},${positions[k + 1]}`)).toBe(true);
  }
});

test("gltf-transform reads it again under its EXT name, and simplifies it", async () => {
  const glb = await writeGrid();
  const back = readGlb<Json>(toExtMeshopt(glb)).json;
  expect(back.extensionsUsed).toContain("EXT_meshopt_compression");
  expect(back.extensionsUsed).not.toContain("KHR_meshopt_compression");
  const far = await simplifyGlb(glb, 0.5);
  const { json } = readGlb<Json>(far);
  expect(json.extensionsRequired).toContain("KHR_meshopt_compression");
  expect(far.length).toBeLessThan(glb.length);
});
