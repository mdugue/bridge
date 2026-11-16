/**
 * Rails drawn from a table of segments (lib/city/rail-table.ts; plan 090,
 * phase 0 — a spike behind `?rails=table`): one instance a segment of
 * track, its geometry the pair of rails over a unit length — the very
 * ribbons the runtime builder writes per segment (mesh-kit.ts
 * `addRibbon`), built once per profile — and the vertex stage lays it
 * from the record: the two ends, the track's bearing at each (the rails
 * are offset across it, so neighbours meet as the builder's do) and the
 * track's offset across its line.
 *
 * A set is a plain `Mesh` over an `InstancedBufferGeometry` whose one
 * instance buffer is the chunk's records (three views of it: `sA`, `sB`,
 * `sMore`) — what `Instances` is for stands, without matrices. The
 * chunk's origin is the object's (`userData.standOrigin`, instancing.ts
 * `tableOrigin`), so every chunk of a profile's material shares one build.
 * Vertex buffers: position, normal, the records — three.
 *
 * Not carried over from the builder's material, and so what this arm
 * still owes before it could replace it: the press under a planner's
 * design (design-site.ts `lineUnderDesign`).
 */
import {
  Color,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshStandardNodeMaterial,
  Sphere,
  Vector3,
} from "three/webgpu";
import type { BufferGeometry } from "three/webgpu";
import {
  attribute,
  cos,
  Fn,
  mix,
  normalGeometry,
  normalLocal,
  normalWorld,
  positionGeometry,
  sin,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  packRails,
  RAIL_OFFSET_STEP_M,
  RAIL_OFFSET_ZERO,
  RAIL_RECORD_WORDS,
  RAIL_STEP_M,
  RAIL_STEP_Y_M,
  RAIL_TURN_UNIT,
  RAIL_WORD,
  railSegmentAt,
  railSegmentCount,
} from "@/lib/city/rail-table";
import type { RailChunk, RailLook, RailSink } from "@/lib/city/rail-table";
import { tableOrigin } from "./instancing";
import { railGlints } from "./lamp-reflections";
import { addRibbon, COLORS, mesh3, meshFrom } from "./mesh-kit";
import { sceneMaterial } from "./three-utils";
import { viewDirection } from "./view-direction";

/** Half the width of a drawn rail (m): rail-layer.ts's and tram-layer.ts's. */
const RAIL_HALF = 0.075;
/** The tram's steel (tram-layer.ts `TRAM_RAIL`). */
const TRAM_RAIL = 0xa9_aa_b4;

/** A look's colour, finish and pull in front of the ground — the
 *  builders' own (rail-layer.ts `buildRails`, tram-layer.ts
 *  `buildTracks`). */
const LOOKS: Record<
  RailLook,
  { color: number; offsetUnits: number; roughness: number }
> = {
  rail: { color: COLORS.rail, offsetUnits: -1, roughness: 0.5 },
  tram: { color: TRAM_RAIL, offsetUnits: -1, roughness: 0.9 },
  "tram-street": { color: TRAM_RAIL, offsetUnits: -2, roughness: 0.9 },
};

const TURN = (Math.PI * 2) / RAIL_TURN_UNIT;

/** The segment's vertex: along it by the profile's x, across the track by
 *  its z, under the rail head by its y; the normal turned with it. */
const segmentPosition = Fn(() => {
  const a = vec4(attribute("sA", "uvec4"));
  const b = vec4(attribute("sB", "uvec4"));
  const more = vec2(attribute("sMore", "uvec2"));
  const t = positionGeometry.x;
  const at = tableOrigin.add(
    mix(a.xyz, b.xyz, t).mul(vec3(RAIL_STEP_M, RAIL_STEP_Y_M, RAIL_STEP_M))
  );
  // the normal across the track: its tangent (cos, sin) a quarter on
  const na = vec2(sin(a.w.mul(TURN)).negate(), cos(a.w.mul(TURN)));
  const nb = vec2(sin(b.w.mul(TURN)).negate(), cos(b.w.mul(TURN)));
  const n = mix(na, nb, t);
  const across = more.x
    .sub(RAIL_OFFSET_ZERO)
    .mul(RAIL_OFFSET_STEP_M)
    .add(positionGeometry.z);
  normalLocal.assign(
    vec3(
      n.x.mul(normalGeometry.z),
      normalGeometry.y,
      n.y.mul(normalGeometry.z)
    ).normalize()
  );
  return vec3(
    at.x.add(n.x.mul(across)),
    at.y.add(positionGeometry.y),
    at.z.add(n.y.mul(across))
  );
});

function segmentMaterial(look: RailLook): MeshStandardNodeMaterial {
  const { color, offsetUnits, roughness } = LOOKS[look];
  return sceneMaterial(`rail-segments:${look}`, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(color),
      roughness,
    });
    m.name = `rail-segments-${look}`;
    m.positionNode = segmentPosition();
    m.emissiveNode = railGlints(normalWorld, viewDirection().negate());
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = offsetUnits;
    return m;
  });
}

/** The pair of rails over a unit length, as the builder's ribbons: x
 *  along (0..1), y down from the head, z across the track. */
export function railProfile(gauge: number, web: number): BufferGeometry {
  const acc = mesh3();
  const unit = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ];
  addRibbon(acc, unit, gauge / 2, RAIL_HALF, web);
  addRibbon(acc, unit, -gauge / 2, RAIL_HALF, web);
  const mesh = meshFrom(acc, 0, {
    cast: false,
    material: segmentMaterial("rail"),
  });
  if (!mesh) {
    throw new Error("rail profile: no geometry");
  }
  return mesh.geometry;
}

/** A set of segments. */
export type RailSet = Mesh<InstancedBufferGeometry, MeshStandardNodeMaterial>;

/** One chunk's set: its records as the instance buffer, a sphere around
 *  its segments. */
export function railChunkMesh(
  chunk: RailChunk,
  profile: BufferGeometry
): RailSet {
  const geometry = new InstancedBufferGeometry();
  geometry.index = profile.index;
  for (const [name, value] of Object.entries(profile.attributes)) {
    geometry.setAttribute(name, value);
  }
  const records = new InstancedInterleavedBuffer(
    chunk.words,
    RAIL_RECORD_WORDS,
    1
  );
  geometry.setAttribute(
    "sA",
    new InterleavedBufferAttribute(records, 4, RAIL_WORD.a)
  );
  geometry.setAttribute(
    "sB",
    new InterleavedBufferAttribute(records, 4, RAIL_WORD.b)
  );
  geometry.setAttribute(
    "sMore",
    new InterleavedBufferAttribute(records, 2, RAIL_WORD.more)
  );
  const count = railSegmentCount(chunk);
  geometry.instanceCount = count;
  const points: Vector3[] = [];
  let reach = 0;
  for (let i = 0; i < count; i += 1) {
    const s = railSegmentAt(chunk, i);
    points.push(
      new Vector3(s.a.x, s.a.y, s.a.z),
      new Vector3(s.b.x, s.b.y, s.b.z)
    );
    reach = Math.max(reach, Math.abs(s.lateral));
  }
  const sphere = new Sphere().setFromPoints(points);
  sphere.radius += reach + chunk.gauge / 2 + RAIL_HALF + chunk.web;
  geometry.boundingSphere = sphere;
  const mesh = new Mesh(geometry, segmentMaterial(chunk.look));
  mesh.name = "rail-segments";
  mesh.userData.standOrigin = new Vector3(...chunk.origin);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/** Everything a tile's builders handed the sink, as sets: one a chunk and
 *  profile. The profile geometries are the tile's own (freed with its
 *  sets). */
export function railSegmentMeshes(sink: RailSink): RailSet[] {
  const profiles = new Map<string, BufferGeometry>();
  return packRails(sink.runs).map((chunk) => {
    const key = `${chunk.gauge}:${chunk.web}`;
    let profile = profiles.get(key);
    if (!profile) {
      profile = railProfile(chunk.gauge, chunk.web);
      profiles.set(key, profile);
    }
    return railChunkMesh(chunk, profile);
  });
}
