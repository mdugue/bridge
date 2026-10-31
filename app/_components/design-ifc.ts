import type { IfcAPI } from "web-ifc";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SRGBColorSpace,
} from "three/webgpu";
import { detectGeoreference } from "@/lib/city/design-placement";
import type { DesignPartInfo } from "@/lib/city/inquiry-design";
import {
  type IfcPlacement,
  type MapConversion,
  mapConversionPlacement,
  siPrefixFactor,
  siteReferencePlacement,
} from "@/lib/city/ifc-georef";

/**
 * Reads an IFC model into the design reader's frame (design-read.ts,
 * ADR 0054) with web-ifc — the IFC kernel compiled to WebAssembly, loaded
 * as its own chunk only when an .ifc is picked, its .wasm from the site's
 * own `/wasm/` (scripts/copy-wasm.ts): nothing is asked of a third party.
 *
 * web-ifc tessellates every product with its colour and hands it in
 * metres, Y up, the model's north −Z: a mesh per placed geometry, a
 * material per colour. Spaces and openings are not drawn (a room's volume
 * would fill the building). Where the file says where it stands
 * (lib/city/ifc-georef.ts) the root carries that place, so the design's
 * box lands in the Land's coordinates and is placed like a georeferenced
 * glTF.
 */

/** Where the site serves web-ifc's .wasm (scripts/copy-wasm.ts). */
export const IFC_WASM_PATH = "/wasm/";

/** IFC types that carry geometry but are not drawn (a room's volume, an
 *  opening's void), by their codes. */
function undrawnTypes(types: typeof import("web-ifc")): Set<number> {
  return new Set([
    types.IFCSPACE,
    types.IFCOPENINGELEMENT,
    types.IFCOPENINGSTANDARDCASE,
  ]);
}

/** A value of a flattened IFC line: plain, or web-ifc's wrapper. */
function num(v: unknown): number | null {
  if (typeof v === "number") {
    return v;
  }
  const o = v as { value?: unknown; _representationValue?: unknown } | null;
  const inner = o?.value ?? o?._representationValue;
  if (typeof inner === "number") {
    return inner;
  }
  if (typeof inner === "string" && inner.trim() !== "") {
    const n = Number(inner);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(v: unknown): string | null {
  if (typeof v === "string") {
    return v;
  }
  const inner = (v as { value?: unknown } | null)?.value;
  return typeof inner === "string" ? inner : null;
}

function numbers(v: unknown): number[] {
  const list = Array.isArray(v)
    ? (v as unknown[])
    : ((v as { value?: unknown } | null)?.value as unknown[] | undefined);
  return Array.isArray(list)
    ? list.map((x) => num(x)).filter((x): x is number => x !== null)
    : [];
}

/** Every line of `type`'s id, its subtypes' too (IfcMapConversionScaled
 *  is an IfcMapConversion). */
function linesOf(api: IfcAPI, model: number, type: number): number[] {
  const ids = api.GetLineIDsWithType(model, type, true);
  const out: number[] = [];
  for (let i = 0; i < ids.size(); i++) {
    out.push(ids.get(i));
  }
  return out;
}

/** The model's length unit (m): its IfcSIUnit LENGTHUNIT's prefix. */
function lengthUnit(api: IfcAPI, model: number, si: number): number {
  for (const id of linesOf(api, model, si)) {
    const unit = api.GetLine(model, id) as {
      UnitType?: { value?: string };
      Prefix?: { value?: string } | null;
    };
    if (unit.UnitType?.value === "LENGTHUNIT") {
      return siPrefixFactor(unit.Prefix?.value);
    }
  }
  return 1;
}

/** A named unit's factor (m) where it is an SI length, else null. */
function siLength(unit: unknown): number | null {
  const u = unit as {
    UnitType?: { value?: string };
    Name?: { value?: string };
    Prefix?: { value?: string } | null;
  } | null;
  return u?.Name?.value === "METRE" ? siPrefixFactor(u.Prefix?.value) : null;
}

/** The site's placement's location in the design frame (m), or null. */
function siteOrigin(
  site: Record<string, unknown>,
  unit: number
): [number, number, number] | null {
  const placement = site.ObjectPlacement as {
    RelativePlacement?: { Location?: { Coordinates?: unknown } };
  } | null;
  const [x = 0, y = 0, z = 0] = numbers(
    placement?.RelativePlacement?.Location?.Coordinates
  );
  // IFC is Z up; the design frame Y up, z south
  return x || y || z ? [x * unit, z * unit, -y * unit] : null;
}

/** Where the file says the model stands, if it does. */
function placementOf(
  api: IfcAPI,
  model: number,
  types: typeof import("web-ifc"),
  epsg: number
): IfcPlacement | { why: string } | null {
  const unit = lengthUnit(api, model, types.IFCSIUNIT);
  for (const id of linesOf(api, model, types.IFCMAPCONVERSION)) {
    const line = api.GetLine(model, id, true) as Record<string, unknown>;
    const crs = line.TargetCRS as { Name?: unknown; MapUnit?: unknown } | null;
    const map: MapConversion = {
      crs: text(crs?.Name),
      // without a MapUnit the values are in the project's length unit
      unit: siLength(crs?.MapUnit) ?? unit,
      eastings: num(line.Eastings) ?? 0,
      northings: num(line.Northings) ?? 0,
      height: num(line.OrthogonalHeight) ?? 0,
      abscissa: num(line.XAxisAbscissa),
      ordinate: num(line.XAxisOrdinate),
      scale: num(line.Scale),
    };
    return mapConversionPlacement(map, epsg);
  }
  let trueNorth: [number, number] | null = null;
  for (const id of linesOf(
    api,
    model,
    types.IFCGEOMETRICREPRESENTATIONCONTEXT
  )) {
    const context = api.GetLine(model, id, true) as {
      TrueNorth?: { DirectionRatios?: unknown } | null;
    };
    const ratios = numbers(context.TrueNorth?.DirectionRatios);
    if (ratios.length >= 2) {
      trueNorth = [ratios[0], ratios[1]];
      break;
    }
  }
  for (const id of linesOf(api, model, types.IFCSITE)) {
    const site = api.GetLine(model, id, true) as Record<string, unknown>;
    const placed = siteReferencePlacement(
      {
        latitude: numbers(site.RefLatitude),
        longitude: numbers(site.RefLongitude),
        elevation: num(site.RefElevation),
        unit,
        trueNorth,
        origin: siteOrigin(site, unit),
      },
      epsg
    );
    if (placed) {
      return placed;
    }
  }
  return null;
}

/** The colour's material, one per distinct colour. */
function materialFor(
  materials: Map<string, MeshStandardMaterial>,
  c: { x: number; y: number; z: number; w: number }
): MeshStandardMaterial {
  const key = `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${c.w.toFixed(2)}`;
  let material = materials.get(key);
  if (!material) {
    material = new MeshStandardMaterial({
      // IfcColourRgb is a display colour: sRGB
      color: new Color().setRGB(c.x, c.y, c.z, SRGBColorSpace),
      opacity: c.w,
      transparent: c.w < 0.99,
      roughness: 0.85,
    });
    materials.set(key, material);
  }
  return material;
}

/** web-ifc's interleaved vertices (x y z nx ny nz) and index as a geometry. */
function geometryOf(
  vertices: Float32Array,
  index: Uint32Array
): BufferGeometry {
  const count = vertices.length / 6;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    position[i * 3] = vertices[i * 6];
    position[i * 3 + 1] = vertices[i * 6 + 1];
    position[i * 3 + 2] = vertices[i * 6 + 2];
    normal[i * 3] = vertices[i * 6 + 3];
    normal[i * 3 + 1] = vertices[i * 6 + 4];
    normal[i * 3 + 2] = vertices[i * 6 + 5];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  geometry.setIndex(new BufferAttribute(index.slice(), 1));
  return geometry;
}

/** Thrown with a sentence for the panel. */
export class IfcError extends Error {}

/**
 * Reads `file` as IFC for the site's `epsg`: the model as one group in the
 * design reader's frame, and a line on where its place came from (null:
 * nothing in the file — placed in front of the player).
 */
export async function readIfc(
  file: File,
  epsg: number
): Promise<{ root: Object3D; note: string | null }> {
  const types = await import("web-ifc");
  const api = new types.IfcAPI();
  api.SetWasmPath(IFC_WASM_PATH, true);
  let model = -1;
  let started = false;
  try {
    // single-threaded: the threaded build needs a cross-origin isolated page
    await api.Init(undefined, true);
    started = true;
    model = api.OpenModel(new Uint8Array(await file.arrayBuffer()), {
      COORDINATE_TO_ORIGIN: false,
    });
    if (model < 0) {
      throw new IfcError("Die Datei ließ sich nicht als IFC lesen.");
    }
    const root = new Group();
    const geometries = new Map<number, BufferGeometry>();
    const materials = new Map<string, MeshStandardMaterial>();
    const undrawn = undrawnTypes(types);
    api.StreamAllMeshes(model, (flat) => {
      const type = api.GetLineType(model, flat.expressID) as number;
      if (undrawn.has(type)) {
        return;
      }
      const line = api.GetLine(model, flat.expressID) as Record<
        string,
        unknown
      >;
      // what a question's card calls it (lib/city/inquiry-design.ts)
      const part: DesignPartInfo = {
        name: text(line.Name) ?? text(line.ObjectType),
        type: api.GetNameFromTypeCode(type),
        id: text(line.GlobalId),
        material: null,
      };
      for (let i = 0; i < flat.geometries.size(); i++) {
        const placed = flat.geometries.get(i);
        let geometry = geometries.get(placed.geometryExpressID);
        if (!geometry) {
          const ifc = api.GetGeometry(model, placed.geometryExpressID);
          geometry = geometryOf(
            api.GetVertexArray(ifc.GetVertexData(), ifc.GetVertexDataSize()),
            api.GetIndexArray(ifc.GetIndexData(), ifc.GetIndexDataSize())
          );
          ifc.delete();
          geometries.set(placed.geometryExpressID, geometry);
        }
        if (geometry.index?.count) {
          const mesh = new Mesh(geometry, materialFor(materials, placed.color));
          mesh.userData.designPart = part;
          mesh.matrixAutoUpdate = false;
          mesh.matrix.fromArray(placed.flatTransformation);
          root.add(mesh);
        }
      }
    });
    if (root.children.length === 0) {
      throw new IfcError("Die IFC-Datei enthält keine darstellbaren Bauteile.");
    }
    // geometry already in the Land's coordinates (a survey point as its
    // origin) is not placed a second time
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const already = detectGeoreference(
      { min: box.min.toArray(), max: box.max.toArray() },
      epsg
    );
    const place = already ? null : placementOf(api, model, types, epsg);
    let note: string | null = already
      ? "Lage aus den Landeskoordinaten der IFC-Geometrie."
      : null;
    if (place && "matrix" in place) {
      root.matrixAutoUpdate = false;
      // (row-major: fromArray reads column-major)
      root.matrix.fromArray(place.matrix).transpose();
      note = place.note;
    } else if (place) {
      note = place.why;
    }
    return { root, note };
  } catch (error) {
    if (error instanceof IfcError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new IfcError(`Die Datei ließ sich nicht als IFC lesen (${message}).`);
  } finally {
    if (started) {
      if (model >= 0) {
        api.CloseModel(model);
      }
      // the kernel's memory goes with it: a phone keeps nothing of it
      api.Dispose();
    }
  }
}
