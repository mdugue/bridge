import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import {
  attribute,
  cameraProjectionMatrix,
  cameraWorldMatrix,
  clamp,
  cross,
  float,
  length,
  materialOpacity,
  max,
  mix,
  modelViewMatrix,
  modelWorldMatrixInverse,
  positionGeometry,
  select,
  smoothstep,
  varying,
  vec3,
  vec4,
  viewportSize,
} from "three/tsl";
import type { Pt } from "./rail-layer";
import type { F, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * Thin wires as camera-facing ribbons, one scene-wide material: the trams'
 * overhead line (tram-layer.ts) and the wires the street lamps hang on
 * across a street (lamp-layer.ts). A wire is never thinner on screen than
 * a pixel floor (its coverage then carried by the alpha) and fades out
 * with distance; wires never cast.
 */

/** the pixel floor of a wire's drawn width, and its fade with distance (m) */
const WIRE_MIN_PX = 0.8;
const WIRE_FADE = { near: 150, far: 350 };
/** A wire's ink and its opacity at full coverage. */
export interface WireInk {
  color: number;
  opacity: number;
}

/** The trams' overhead line: light and faint. */
export const TRAM_INK: WireInk = { color: 0x80_85_90, opacity: 0.6 };

/** Wire segments as camera-facing ribbons: each vertex is a centre point,
 *  the segment's direction, the side (±1) and the half-width. */
export interface Wires {
  dir: number[];
  half: number[];
  index: number[];
  pos: number[];
  side: number[];
}

export function wires(): Wires {
  return { pos: [], dir: [], side: [], half: [], index: [] };
}

export function addWire(w: Wires, pts: Pt[], half: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (dx === 0 && dy === 0 && dz === 0) {
      continue;
    }
    const base = w.pos.length / 3;
    for (const p of [a, b]) {
      for (const s of [-1, 1]) {
        w.pos.push(p.x, p.y, p.z);
        w.dir.push(dx, dy, dz);
        w.side.push(s);
        w.half.push(half);
      }
    }
    w.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

/**
 * The wire's frame at this vertex, all in view space from the vertex's
 * own centre point (`positionGeometry`, so the drawn offset never feeds
 * back into it): the direction across the wire and the view ray, the
 * depth, the metres a pixel spans there, the true and the drawn half-width
 * and the distance fade. The pixel size needs the height of the target
 * being drawn into — the post stack's scene target, at the drawing-buffer
 * size, not the canvas — which `viewportSize` reads from the render target
 * current at draw time.
 */
function wireFrame() {
  const half = attribute("wireHalf", "float") as F;
  const centre = modelViewMatrix.mul(vec4(positionGeometry, 1)).xyz as V3;
  const dirV = modelViewMatrix.mul(vec4(attribute("wireDir", "vec3"), 0))
    .xyz as V3;
  const acrossRaw = cross(dirV, centre);
  const acrossLen = length(acrossRaw);
  const across = select(
    acrossLen.greaterThan(1e-6),
    acrossRaw.div(acrossLen),
    vec3(1, 0, 0)
  ) as V3;
  const depth = max(centre.z.negate(), 0.05) as F;
  // metres per pixel at this depth; projection[1][1] is the y row of the
  // projection's second column. A parallel projection (Modell) has the same
  // pixel at every depth: its w row takes nothing from z (perspective −1).
  const focalY = cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y;
  const perspective = cameraProjectionMatrix.mul(vec4(0, 0, 1, 0)).w.abs();
  const px = mix(float(1), depth, perspective)
    .mul(2)
    .div(focalY.mul(viewportSize.y)) as F;
  const truePx = half.mul(2).div(px);
  const drawnHalf = max(half, px.mul(0.5 * WIRE_MIN_PX)) as F;
  const fade = smoothstep(WIRE_FADE.near, WIRE_FADE.far, depth);
  return { across, centre, drawnHalf, fade, truePx };
}

/**
 * The unlit wire ink, fogged like everything else (the scene's fog node).
 * The vertex is pushed across the wire and the view ray by its drawn
 * half-width — never under half the pixel floor — in view space, and handed
 * back to the position slot in the mesh's local frame (the camera's world
 * matrix, then the model's inverse), so the regular projection lands it
 * exactly where the view-space ribbon puts it. The alpha carries the true
 * coverage (true width over the floor, at least a fifth) times the
 * distance fade, at the ink's own faint opacity; it is worked out per
 * vertex and interpolated, as a varying.
 */
function wireMaterial(ink: WireInk): MeshBasicNodeMaterial {
  return sceneMaterial(`wire-${ink.color}-${ink.opacity}`, () => {
    const m = new MeshBasicNodeMaterial({
      color: new Color(ink.color),
      transparent: true,
      depthWrite: false,
    });
    const { across, centre, drawnHalf, fade, truePx } = wireFrame();
    const side = attribute("wireSide", "float") as F;
    const drawn = centre.add(across.mul(drawnHalf).mul(side));
    m.positionNode = modelWorldMatrixInverse
      .mul(cameraWorldMatrix)
      .mul(vec4(drawn, 1)).xyz;
    const alpha = float(ink.opacity)
      .mul(clamp(truePx.div(WIRE_MIN_PX), 0.2, 1))
      .mul(float(1).sub(fade));
    m.opacityNode = materialOpacity.mul(varying(alpha));
    return m;
  });
}

export function wireMesh(
  w: Wires,
  name: string,
  ink: WireInk = TRAM_INK
): Mesh | null {
  if (w.index.length === 0) {
    return null;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(w.pos, 3));
  g.setAttribute("wireDir", new Float32BufferAttribute(w.dir, 3));
  g.setAttribute("wireSide", new Float32BufferAttribute(w.side, 1));
  g.setAttribute("wireHalf", new Float32BufferAttribute(w.half, 1));
  g.setIndex(w.index);
  g.computeBoundingSphere();
  const mesh = new Mesh(g, wireMaterial(ink));
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
