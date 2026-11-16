import { expect, test } from "bun:test";
import type { InterleavedBufferAttribute } from "three/webgpu";
import { railSink } from "@/lib/city/rail-table";
import { railProfile, railSegmentMeshes } from "./rail-segments";

const sink = () => {
  const s = railSink();
  s.runs.push(
    {
      gauge: 1.435,
      lateral: 0,
      look: "tram-street",
      web: 0.04,
      pts: Array.from({ length: 10 }, (_, i) => ({ x: i * 2, y: 100, z: 3 })),
    },
    {
      gauge: 1.435,
      lateral: 4.5,
      look: "rail",
      web: 0.11,
      pts: Array.from({ length: 5 }, (_, i) => ({ x: i * 4, y: 101, z: -9 })),
    }
  );
  return s;
};

test("the profile is the builder's two ribbons over a unit length", () => {
  const profile = railProfile(1.435, 0.11);
  const position = profile.getAttribute("position");
  const xs = new Set<number>();
  let down = 0;
  let across = 0;
  for (let i = 0; i < position.count; i += 1) {
    xs.add(position.getX(i));
    down = Math.min(down, position.getY(i));
    across = Math.max(across, Math.abs(position.getZ(i)));
  }
  expect([...xs].toSorted((a, b) => a - b)).toEqual([0, 1]);
  expect(down).toBeCloseTo(-0.11, 6);
  expect(across).toBeCloseTo(1.435 / 2 + 0.075, 6);
});

test("a set a chunk and look: its records the one instance buffer, three vertex buffers", () => {
  const meshes = railSegmentMeshes(sink());
  expect(meshes).toHaveLength(2);
  const segments = meshes
    .map((m) => m.geometry.instanceCount)
    .toSorted((a, b) => a - b);
  expect(segments).toEqual([4, 9]);
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const records = ["sA", "sB", "sMore"].map(
      (n) => (g.getAttribute(n) as InterleavedBufferAttribute).data
    );
    expect(new Set(records).size).toBe(1);
    expect(records[0].stride).toBe(10);
    const buffers = new Set(
      Object.values(g.attributes).map(
        (a) => (a as InterleavedBufferAttribute).data ?? a
      )
    );
    expect(buffers.size).toBe(3);
    // the chunk's origin is the object's: one material a look for the site
    expect(mesh.userData.standOrigin).toBeDefined();
    expect(mesh.material.userData.shared).toBe(true);
    expect(g.boundingSphere?.radius).toBeGreaterThan(4);
    expect(mesh.castShadow).toBe(false);
  }
  expect(meshes[0].material).not.toBe(meshes[1].material);
});
