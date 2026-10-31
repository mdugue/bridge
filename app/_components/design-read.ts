import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Material, Object3D, Texture } from "three/webgpu";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  type InstancedMesh,
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
  judgeFile,
  textureBytesOf,
} from "@/lib/city/design-budget";
import {
  type DesignBox,
  designAnchor,
  detectGeoreference,
  elsewhereFrame,
  type Georeference,
} from "@/lib/city/design-placement";
import type { DesignPartInfo } from "@/lib/city/inquiry-design";
import { FormatError, pickedFiles, read3dm, readObj } from "./design-formats";
import { IfcError, readIfc } from "./design-ifc";
import { PLAN_FORMATS, PlanError, readPlan } from "./design-plan";

/**
 * Reads a design the planner dropped into the page (ADR 0054): a glTF —
 * one .glb, or a .gltf with its .bin and textures picked together —, an
 * IFC (design-ifc.ts), an OBJ or a Rhino .3dm (design-formats.ts) into
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
  /** its box lies in another place's or system's coordinates, not the
   *  site's and not about its own origin (`elsewhereFrame`) */
  elsewhere: boolean;
  weight: DesignWeight;
  /** what it holds (bytes), its textures dropped where the budget says */
  bytes: number;
  texturesDropped: boolean;
  /** what the file said about its place, for the panel (null: nothing
   *  beyond its coordinates) */
  note: string | null;
  /** a landscape plan's: 1 for each triangle that is ground — it clears
   *  and presses the site but takes no building away; null: none is */
  groundTriangles: Uint8Array | null;
  /** shown in its own colours from the start (a plan's classes) */
  prefersColours: boolean;
  /** its parts as the file names them, by triangle (a question's card) */
  parts: DesignParts;
}

/** A design that could not be read, in words for the panel. */
export class DesignError extends Error {}

/** The formats a design can come in, by the main file's extension. */
const FORMATS = {
  gltf: /\.(glb|gltf)$/i,
  plan: PLAN_FORMATS,
  ifc: /\.ifc$/i,
  obj: /\.obj$/i,
  rhino: /\.3dm$/i,
} as const;
type DesignFormat = keyof typeof FORMATS;

/** The design's format by its file's name, or null. */
export function designFormat(name: string): DesignFormat | null {
  for (const [format, pattern] of Object.entries(FORMATS)) {
    if (pattern.test(name)) {
      return format as DesignFormat;
    }
  }
  return null;
}

/** The file of a selection that is the design, or null: a bare .xml
 *  (LandXML, or any metadata picked along) only where nothing else is. */
export function designFile(files: readonly File[]): File | null {
  const read = files.filter((f) => designFormat(f.name) !== null);
  return read.find((f) => !/\.xml$/i.test(f.name)) ?? read[0] ?? null;
}

/** The design's objects in its own frame, and what the file said about
 *  its place. */
async function parseDesign(
  main: File,
  files: readonly File[],
  epsg: number,
  tier: DesignTier,
  heightAt: (x: number, y: number) => number | null
): Promise<{ root: Object3D; note: string | null; heightsKnown?: boolean }> {
  const format = designFormat(main.name);
  if (format === "gltf") {
    return { root: await parseGltf(main, files), note: null };
  }
  // the others are read whole before they can be weighed
  const tooLarge = judgeFile(main.size, tier);
  if (tooLarge) {
    throw new DesignError(tooLarge);
  }
  try {
    if (format === "ifc") {
      return await readIfc(main, epsg);
    }
    if (format === "plan") {
      return await readPlan(main, files, epsg, heightAt);
    }
    return format === "rhino"
      ? await read3dm(main, epsg)
      : await readObj(main, files);
  } catch (error) {
    throw error instanceof IfcError ||
      error instanceof FormatError ||
      error instanceof PlanError
      ? new DesignError(error.message)
      : error;
  }
}

/** The design's georeference; one whose heights are not NHN (a Rhino
 *  anchor above the ground, a plan laid flat at 0 with no ground loaded
 *  under it and no heights of its own) keeps none of its base, so it is
 *  set on the ground. */
function georefOf(
  box: DesignBox,
  epsg: number,
  heightsKnown: boolean
): Georeference | null {
  const geo = detectGeoreference(box, epsg);
  return geo && !heightsKnown ? { ...geo, base: null } : geo;
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
  const picked = pickedFiles(main, files);
  const loader = new GLTFLoader(picked.manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    const data = await main.arrayBuffer();
    const gltf = await loader.parseAsync(data, "");
    return gltf.scene;
  } catch (error) {
    throw new DesignError(loaderReason(error, picked.missing));
  } finally {
    picked.release();
  }
}

/** One drawn piece of the file: a mesh, or one instance of one. */
interface Piece {
  geometry: BufferGeometry;
  material: Material;
  matrix: Matrix4;
  part: DesignPartInfo;
}

/** What the file says of a mesh's part: what its reader put on it
 *  (`userData.designPart`: an IFC element, a plan's class), else its own
 *  or its nearest named parent's name and its material's. */
function partInfo(mesh: Mesh, material: Material): DesignPartInfo {
  const given = mesh.userData.designPart as DesignPartInfo | undefined;
  if (given) {
    return given;
  }
  let name: string | null = null;
  for (let o: Object3D | null = mesh; o && !name; o = o.parent) {
    name = o.name.trim() || null;
  }
  return {
    name,
    type: null,
    id: null,
    material: material.name.trim() || null,
  };
}

/** The part of `geometry` one of its groups draws, as its own geometry
 *  (position, normal, uv; compact). */
function groupGeometry(
  geometry: BufferGeometry,
  start: number,
  count: number
): BufferGeometry {
  const index = geometry.index;
  // the source vertex of each output vertex
  const sources: number[] = [];
  const remap = new Map<number, number>();
  const triangles: number[] = [];
  for (let i = start; i < start + count; i++) {
    const v = index ? index.getX(i) : i;
    let to = remap.get(v);
    if (to === undefined) {
      to = sources.length;
      remap.set(v, to);
      sources.push(v);
    }
    triangles.push(to);
  }
  const out = new BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const from = geometry.getAttribute(name);
    if (!from) {
      continue;
    }
    const size = from.itemSize;
    const array = new Float32Array(sources.length * size);
    sources.forEach((v, i) => {
      for (let c = 0; c < size; c++) {
        array[i * size + c] = from.getComponent(v, c);
      }
    });
    out.setAttribute(name, new BufferAttribute(array, size));
  }
  out.setIndex(triangles);
  return out;
}

/** A mesh's geometries, one per material it draws: GLTFLoader gives a
 *  mesh per primitive, one material each; OBJLoader one per object with
 *  a material per `usemtl` and a group each. */
function materialParts(
  mesh: Mesh
): { geometry: BufferGeometry; material: Material }[] {
  if (!Array.isArray(mesh.material)) {
    return [{ geometry: mesh.geometry, material: mesh.material }];
  }
  const materials = mesh.material;
  const groups = mesh.geometry.groups;
  if (groups.length === 0) {
    return [{ geometry: mesh.geometry, material: materials[0] }];
  }
  const drawn =
    mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count;
  return groups
    .filter((g) => materials[g.materialIndex ?? 0] && g.count > 0)
    .map((g) => ({
      geometry: groupGeometry(
        mesh.geometry,
        g.start,
        Math.min(g.count, drawn - g.start)
      ),
      material: materials[g.materialIndex ?? 0],
    }));
}

/** Every piece under `root` that is shown (a Rhino file's hidden layers
 *  are not), its matrix in the design's frame. */
function piecesOf(root: Object3D): Piece[] {
  root.updateMatrixWorld(true);
  const out: Piece[] = [];
  const instance = new Matrix4();
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) {
      return;
    }
    for (const part of materialParts(mesh)) {
      piecesOfPart(mesh, part.geometry, part.material, instance, out);
    }
  });
  return out;
}

/** One geometry of `mesh` as pieces: once, or once per instance. */
function piecesOfPart(
  mesh: Mesh,
  geometry: BufferGeometry,
  material: Material,
  instance: Matrix4,
  out: Piece[]
): void {
  const part = partInfo(mesh, material);
  const instanced = mesh as InstancedMesh;
  if (!instanced.isInstancedMesh) {
    out.push({ geometry, material, matrix: mesh.matrixWorld, part });
    return;
  }
  for (let i = 0; i < instanced.count; i++) {
    instanced.getMatrixAt(i, instance);
    out.push({
      geometry,
      material,
      matrix: mesh.matrixWorld.clone().multiply(instance),
      part,
    });
  }
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
): { geometry: BufferGeometry; parts: DesignParts } {
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
  const parts = partsRecorder();
  let vertex = 0;
  let triangle = 0;
  materials.forEach((material, group) => {
    const start = triangle;
    for (const piece of pieces) {
      if (piece.material !== material) {
        continue;
      }
      parts.add(vertex, piece.part);
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
  return { geometry: merged, parts: parts.done() };
}

/** The design's parts and, for each run of the merged vertices, whose
 *  they are: `starts[k]` the run's first vertex, `of[k]` its part. By
 *  vertex, not triangle: the BVH reorders the index (three-mesh-bvh),
 *  never the vertices, and each piece's vertices are written as one run. */
export interface DesignParts {
  info: DesignPartInfo[];
  starts: Uint32Array;
  of: Uint32Array;
}

/** Collects the runs as the pieces are written, a part's index by its
 *  info (a piece's instances share one). */
function partsRecorder() {
  const info: DesignPartInfo[] = [];
  const index = new Map<DesignPartInfo, number>();
  const starts: number[] = [];
  const of: number[] = [];
  return {
    add: (vertex: number, part: DesignPartInfo) => {
      let k = index.get(part);
      if (k === undefined) {
        k = info.length;
        info.push(part);
        index.set(part, k);
      }
      if (of.at(-1) !== k) {
        starts.push(vertex);
        of.push(k);
      }
    },
    done: (): DesignParts => ({
      info,
      starts: Uint32Array.from(starts),
      of: Uint32Array.from(of),
    }),
  };
}

/** The part a vertex of the merged geometry belongs to (its index). */
export function partOfVertex(parts: DesignParts, vertex: number): number {
  let lo = 0;
  let hi = parts.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (parts.starts[mid] <= vertex) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return parts.of[lo] ?? 0;
}

/**
 * Reads the design among `files` for the site's `epsg`, within the budget
 * of `tier` (lib/city/design-budget.ts). Throws a DesignError in words.
 */
export async function readDesign(
  files: readonly File[],
  epsg: number,
  tier: DesignTier,
  heightAt: (x: number, y: number) => number | null = () => null
): Promise<DesignModel> {
  const main = designFile(files);
  if (!main) {
    throw new DesignError(
      "Bitte eine .glb-, .gltf-, .ifc-, .obj- oder .3dm-Datei wählen (Export aus SketchUp, Rhino, Revit, Archicad, Vectorworks, Blender …), oder einen Landschaftsplan als .dxf, .shp, .gpkg oder LandXML."
    );
  }
  const { root, note, heightsKnown } = await parseDesign(
    main,
    files,
    epsg,
    tier,
    heightAt
  );
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
  const georef = georefOf(box, epsg, heightsKnown ?? true);
  const { geometry, parts } = mergePieces(pieces, materials, designAnchor(box));
  const plan = materials.some((m) => m.userData.planGround !== undefined);
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
    georef,
    // (a plan's reader says so itself, with its classes)
    elsewhere: !georef && !plan && elsewhereFrame(box),
    weight,
    bytes: verdict.bytes,
    texturesDropped: !verdict.keepTextures && weight.textureBytes > 0,
    note,
    groundTriangles: plan ? groundTriangles(geometry, materials) : null,
    prefersColours: plan,
    parts,
  };
}

/** 1 for each triangle of a plan's ground (`userData.planGround`): it is
 *  the site, not a building's plan (design-cover.ts). */
function groundTriangles(
  geometry: BufferGeometry,
  materials: readonly Material[]
): Uint8Array {
  const out = new Uint8Array((geometry.index?.count ?? 0) / 3);
  for (const g of geometry.groups) {
    if (materials[g.materialIndex ?? 0]?.userData.planGround) {
      out.fill(1, g.start / 3, (g.start + g.count) / 3);
    }
  }
  return out;
}
