import { Box3, type Group, type Mesh, Raycaster, Vector3 } from "three/webgpu";
import type { AskSet } from "@/lib/city/ask-solids";
import type { TrafficFeature } from "@/lib/city/features";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import { lineBearing } from "@/lib/city/inquiry-traffic";

/** The tile's flow bodies (traffic-layer.ts): the one mesh that carries
 *  the vertex → section table, or none. */
export function trafficMesh(group: Group | undefined): Mesh | null {
  let found: Mesh | null = null;
  group?.traverse((o) => {
    if (!found && (o as Mesh).isMesh && o.userData.trafficSection) {
      found = o as Mesh;
    }
  });
  return found;
}

/** A line's middle vertex (the site's CRS): where the card says it is. */
function middle(coords: readonly (readonly number[])[]): [number, number] {
  const p = coords[Math.floor((coords.length - 1) / 2)] ?? [0, 0];
  const q = coords[Math.ceil((coords.length - 1) / 2)] ?? p;
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}

/**
 * A tile's counted traffic as one askable set (ADR 0041, the data layers
 * of ADR 0040): rays meet the flow bodies as built, and the vertex they
 * meet names its section (`userData.trafficSection`). Asked only while
 * the layer shows. The bodies get their BVH on the first question that
 * reaches them, not with the tile. The bodies grow with the hour and
 * widen from the air in their shader; the ray meets them at their daily
 * size, which the tolerant rings of the probe make up for.
 */
export function trafficAskSet(
  group: Group | undefined,
  features: readonly TrafficFeature[],
  tile: string
): AskSet<FeatureInquiry> | null {
  const mesh = trafficMesh(group);
  if (!(group && mesh)) {
    return null;
  }
  const sections = mesh.userData.trafficSection as Uint32Array;
  mesh.geometry.computeBoundingBox();
  const bounds = (mesh.geometry.boundingBox ?? new Box3()).clone();
  bounds.applyMatrix4(mesh.matrixWorld);
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const origin = new Vector3();
  const direction = new Vector3();
  return {
    box: {
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    },
    nearest: (o, d, far) => {
      if (!group.visible) {
        return null;
      }
      if (!mesh.geometry.boundsTree) {
        mesh.geometry.computeBoundsTree();
      }
      raycaster.set(origin.set(o.x, o.y, o.z), direction.set(d.x, d.y, d.z));
      raycaster.far = far;
      const hit = raycaster.intersectObject(mesh, false)[0];
      const index = hit?.face ? sections[hit.face.a] : undefined;
      const feature = index === undefined ? undefined : features[index];
      if (!(hit && feature?.properties && index !== undefined)) {
        return null;
      }
      const coords = feature.geometry.coordinates;
      return {
        distance: hit.distance,
        target: {
          kind: "traffic",
          tile,
          index,
          position: middle(coords),
          bearing: lineBearing(coords),
          properties: feature.properties,
        },
        solids: [],
      };
    },
  };
}
