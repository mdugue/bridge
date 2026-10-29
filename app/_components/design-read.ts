import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Material, Object3D, Texture } from "three/webgpu";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  type InstancedMesh,
  LoadingManager,
  Matrix3,
  Matrix4,
  type Mesh,
  Vector3,
} from "three/webgpu";
import {
  type DesignTier,
  type DesignWeight,
  geometryBytes,
  judgeDesign,
  textureBytesOf,
} from "@/lib/city/design-budget";
import {
  type DesignBox,
  designAnchor,
  detectGeoreference,
  type Georeference,
} from "@/lib/city/design-placement";

/**
 * Reads a design the planner dropped into the page (ADR 0054): a glTF —
 * one .glb, or a .gltf with its .bin and textures picked together — into
 * one geometry about its anchor (design-placement.ts `designAnchor`), with
 * a group per material of the file. Everything stays on the device: the
 * file is read from the File the browser handed over, and a .gltf's
 * resources only from the files picked with it — any other URL it names
 * is refused, so a design never makes the page ask a third party.
 *
 * The positions are moved to the anchor in doubles before they become
 * float32, so a design placed in the Land's coordinates by its nodes
 * (412 500 m east in a translation) keeps its millimetres; one whose
 * vertices themselves are in those coordinates was rounded by its export
 * (float32: half a metre at a northing) before it reaches us. Nodes and instances are flattened into the one
 * geometry: one draw per material, one BVH for the collider.
 */

/** What one material of the file looks like (the "Farben der Datei"). */
export interface DesignLook {
  color: Color;
  map: Texture | null;
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  alphaTest: number;
}

export interface DesignModel {
  /** the main file's name */
  name: string;
  /** positions about the anchor (x east, y up, z south), a group per look */
  geometry: BufferGeometry;
  looks: DesignLook[];
  /** the design's box in its own frame */
  box: DesignBox;
  georef: Georeference | null;
  weight: DesignWeight;
  /** what it holds (bytes), its textures dropped where the budget says */
  bytes: number;
  texturesDropped: boolean;
}

/** A design that could not be read, in words for the panel. */
export class DesignError extends Error {}

const GLTF_NAME = /\.(glb|gltf)$/i;

/** The file of a selection that is the design, or null. */
export function designFile(files: readonly File[]): File | null {
  return files.find((f) => GLTF_NAME.test(f.name)) ?? null;
}

/** A URL's last path part, as the picked files are named. */
function baseName(url: string): string {
  const path = url.split(/[?#]/)[0];
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
}

/** Why the loader refused, in words; `missing`: the resources it named
 *  that were not picked. */
function loaderReason(error: unknown, missing: readonly string[]): string {
  if (missing.length > 0) {
    return `Die .gltf-Datei verweist auf Dateien, die nicht mit ausgewählt wurden (${missing.join(", ")}). Bitte mit auswählen oder als .glb exportieren.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/draco/i.test(message)) {
    return "Die Datei ist Draco-komprimiert. Bitte ohne Draco-Kompression exportieren.";
  }
  if (/ktx2|basisu/i.test(message)) {
    return "Die Datei nutzt KTX2-Texturen. Bitte mit PNG- oder JPEG-Texturen exportieren.";
  }
  return `Die Datei ließ sich nicht als glTF lesen (${message}).`;
}

/** Parses the picked glTF with only the picked files as its resources. */
async function parseGltf(
  main: File,
  files: readonly File[]
): Promise<Object3D> {
  const urls = new Map<string, string>();
  for (const f of files) {
    if (f !== main) {
      urls.set(f.name, URL.createObjectURL(f));
    }
  }
  const missing: string[] = [];
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      return url;
    }
    const picked = urls.get(baseName(url));
    if (picked) {
      return picked;
    }
    // a URL that cannot be fetched: nothing leaves the page
    missing.push(baseName(url));
    return `refused:${baseName(url)}`;
  });
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const data = await main.arrayBuffer();
    const gltf = await loader.parseAsync(data, "");
    return gltf.scene;
  } catch (error) {
    throw new DesignError(loaderReason(error, missing));
  } finally {
    for (const url of urls.values()) {
      URL.revokeObjectURL(url);
    }
  }
}

/** One drawn piece of the file: a mesh, or one instance of one. */
interface Piece {
  geometry: BufferGeometry;
  material: Material;
  matrix: Matrix4;
}

/** Every piece under `root`, its matrix in the design's frame. */
function piecesOf(root: Object3D): Piece[] {
  root.updateMatrixWorld(true);
  const out: Piece[] = [];
  const instance = new Matrix4();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) {
      return;
    }
    // (GLTFLoader gives a mesh per primitive, one material each)
    const material = Array.isArray(mesh.material)
      ? mesh.material[0]
      : mesh.material;
    const instanced = mesh as InstancedMesh;
    if (instanced.isInstancedMesh) {
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, instance);
        out.push({
          geometry: mesh.geometry,
          material,
          matrix: mesh.matrixWorld.clone().multiply(instance),
        });
      }
    } else {
      out.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld });
    }
  });
  return out;
}

const triangleCount = (g: BufferGeometry) =>
  Math.floor((g.index?.count ?? g.getAttribute("position").count) / 3);

/** The pieces' box in the design's frame, vertex by vertex, in doubles. */
function boxOf(pieces: readonly Piece[]): DesignBox {
  const box = new Box3();
  const v = new Vector3();
  for (const { geometry, matrix } of pieces) {
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      box.expandByPoint(
        v.fromBufferAttribute(position, i).applyMatrix4(matrix)
      );
    }
  }
  return { min: box.min.toArray(), max: box.max.toArray() };
}

/** What a material of the file looks like, read once. */
function lookOf(material: Material): DesignLook {
  const m = material as Material & {
    color?: Color;
    map?: Texture | null;
    roughness?: number;
    metalness?: number;
  };
  return {
    color: m.color?.clone() ?? new Color(0xcc_cc_cc),
    map: m.map ?? null,
    roughness: m.roughness ?? 0.8,
    metalness: m.metalness ?? 0,
    opacity: m.opacity,
    transparent: m.transparent,
    alphaTest: m.alphaTest,
  };
}

/** The bytes of the distinct textures the looks draw with. */
function texturesBytes(looks: readonly DesignLook[]): number {
  const seen = new Set<Texture>();
  let bytes = 0;
  for (const { map } of looks) {
    if (map && !seen.has(map)) {
      seen.add(map);
      const image = map.image as { width?: number; height?: number } | null;
      bytes += textureBytesOf(image?.width ?? 0, image?.height ?? 0);
    }
  }
  return bytes;
}

/** Writes one piece into the merged arrays from `vertex`, `triangle`. */
function writePiece(
  piece: Piece,
  toAnchor: Matrix4,
  out: {
    position: Float32Array;
    normal: Float32Array;
    uv: Float32Array;
    index: Uint32Array;
  },
  vertex: number,
  triangle: number
): void {
  const { geometry } = piece;
  const matrix = toAnchor.clone().multiply(piece.matrix);
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    const at = (vertex + i) * 3;
    v.fromBufferAttribute(position, i).applyMatrix4(matrix);
    out.position[at] = v.x;
    out.position[at + 1] = v.y;
    out.position[at + 2] = v.z;
    if (normal) {
      v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      out.normal[at] = v.x;
      out.normal[at + 1] = v.y;
      out.normal[at + 2] = v.z;
    }
    if (uv) {
      out.uv[(vertex + i) * 2] = uv.getX(i);
      out.uv[(vertex + i) * 2 + 1] = uv.getY(i);
    }
  }
  // a mirrored node turns its triangles inside out: wound back
  const flip = matrix.determinant() < 0;
  const triangles = triangleCount(geometry);
  const index = geometry.index;
  for (let t = 0; t < triangles; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const at = (triangle + t) * 3;
    out.index[at] = vertex + a;
    out.index[at + 1] = vertex + (flip ? c : b);
    out.index[at + 2] = vertex + (flip ? b : c);
  }
  if (!normal) {
    pieceNormals(out, vertex, position.count, triangle, triangles);
  }
}

/**
 * Normals for a piece the file gave none: its faces' summed over its own
 * vertices (a piece's vertices are its own in the merged arrays).
 */
function pieceNormals(
  out: { position: Float32Array; normal: Float32Array; index: Uint32Array },
  vertex: number,
  vertices: number,
  triangle: number,
  triangles: number
): void {
  const { position: p, normal: n, index } = out;
  for (let t = triangle; t < triangle + triangles; t++) {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a];
    const wy = p[c + 1] - p[a + 1];
    const wz = p[c + 2] - p[a + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let i = vertex; i < vertex + vertices; i++) {
    const len = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
    n[i * 3] /= len;
    n[i * 3 + 1] /= len;
    n[i * 3 + 2] /= len;
  }
}

/**
 * The pieces as one geometry about `anchor`, a group per material in the
 * order of `materials`.
 */
function mergePieces(
  pieces: readonly Piece[],
  materials: readonly Material[],
  anchor: readonly [number, number, number]
): BufferGeometry {
  let vertices = 0;
  let triangles = 0;
  for (const { geometry } of pieces) {
    vertices += geometry.getAttribute("position").count;
    triangles += triangleCount(geometry);
  }
  const out = {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    uv: new Float32Array(vertices * 2),
    index: new Uint32Array(triangles * 3),
  };
  const toAnchor = new Matrix4().makeTranslation(
    -anchor[0],
    -anchor[1],
    -anchor[2]
  );
  const merged = new BufferGeometry();
  let vertex = 0;
  let triangle = 0;
  materials.forEach((material, group) => {
    const start = triangle;
    for (const piece of pieces) {
      if (piece.material !== material) {
        continue;
      }
      writePiece(piece, toAnchor, out, vertex, triangle);
      vertex += piece.geometry.getAttribute("position").count;
      triangle += triangleCount(piece.geometry);
    }
    merged.addGroup(start * 3, (triangle - start) * 3, group);
  });
  merged.setAttribute("position", new BufferAttribute(out.position, 3));
  merged.setAttribute("normal", new BufferAttribute(out.normal, 3));
  merged.setAttribute("uv", new BufferAttribute(out.uv, 2));
  merged.setIndex(new BufferAttribute(out.index, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Reads the design among `files` for the site's `epsg`, within the budget
 * of `tier` (lib/city/design-budget.ts). Throws a DesignError in words.
 */
export async function readDesign(
  files: readonly File[],
  epsg: number,
  tier: DesignTier
): Promise<DesignModel> {
  const main = designFile(files);
  if (!main) {
    throw new DesignError(
      "Bitte eine .glb- oder .gltf-Datei wählen (Export aus SketchUp, Rhino, Revit, Archicad, Blender …)."
    );
  }
  const root = await parseGltf(main, files);
  const pieces = piecesOf(root);
  if (pieces.length === 0) {
    throw new DesignError("Die Datei enthält keine Flächen.");
  }
  const materials = [...new Set(pieces.map((p) => p.material))];
  const looks = materials.map(lookOf);
  let vertices = 0;
  let triangles = 0;
  for (const { geometry } of pieces) {
    vertices += geometry.getAttribute("position").count;
    triangles += triangleCount(geometry);
  }
  const weight: DesignWeight = {
    triangles,
    geometryBytes: geometryBytes(vertices, triangles),
    textureBytes: texturesBytes(looks),
  };
  const verdict = judgeDesign(weight, tier);
  if (!verdict.ok) {
    throw new DesignError(verdict.reason);
  }
  const box = boxOf(pieces);
  const geometry = mergePieces(pieces, materials, designAnchor(box));
  // what the file held besides: its own geometries, materials, textures
  const kept = new Set(verdict.keepTextures ? looks.map((l) => l.map) : []);
  for (const piece of pieces) {
    piece.geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  for (const look of looks) {
    if (look.map && !kept.has(look.map)) {
      look.map.dispose();
      look.map = null;
    }
  }
  return {
    name: main.name,
    geometry,
    looks,
    box,
    georef: detectGeoreference(box, epsg),
    weight,
    bytes: verdict.bytes,
    texturesDropped: !verdict.keepTextures && weight.textureBytes > 0,
  };
}
