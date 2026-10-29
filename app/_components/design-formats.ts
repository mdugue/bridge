import { LoadingManager, Matrix4, type Object3D } from "three/webgpu";
import { latLngPlacement } from "@/lib/city/ifc-georef";
import { rhinoUnitMetres } from "@/lib/city/rhino-units";

/**
 * The design formats beside glTF and IFC (ADR 0054): OBJ with its MTL and
 * textures, and Rhino's .3dm. Each comes into the design reader's frame
 * (design-read.ts) — metres, Y up, −Z north — as one object tree, and
 * like every design is read on the device only: an OBJ's material file
 * and textures only from the files picked with it, rhino3dm's
 * WebAssembly from the site's own `/wasm/rhino3dm/`
 * (scripts/copy-wasm.ts). Loaded as their own chunks, only when picked.
 */

/** Thrown with a sentence for the panel. */
export class FormatError extends Error {}

/** A URL's last path part, as the picked files are named. */
export function baseName(url: string): string {
  const path = url.split(/[?#]/)[0];
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
}

/**
 * A loading manager that serves a loader only the files picked with
 * `main`: any other URL the file names is refused (and listed in
 * `missing`), so a design never makes the page fetch from anyone.
 * `release` lets the picked files' URLs go.
 */
export function pickedFiles(
  main: File,
  files: readonly File[]
): { manager: LoadingManager; missing: string[]; release: () => void } {
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
  return {
    manager,
    missing,
    release: () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    },
  };
}

/**
 * Reads an OBJ, its material file (`mtllib`) and textures among the
 * picked files. OBJ has no units and no up: taken as metres and Y up, as
 * SketchUp, Blender and Rhino write it by default.
 */
export async function readObj(
  main: File,
  files: readonly File[]
): Promise<{ root: Object3D; note: string | null }> {
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
    import("three/addons/loaders/OBJLoader.js"),
    import("three/addons/loaders/MTLLoader.js"),
  ]);
  const picked = pickedFiles(main, files);
  try {
    const text = await main.text();
    const loader = new OBJLoader(picked.manager);
    const library = /^\s*mtllib\s+(.+?)\s*$/m.exec(text)?.[1];
    const mtl = library
      ? files.find((f) => f.name === baseName(library))
      : undefined;
    if (mtl) {
      const materials = new MTLLoader(picked.manager).parse(
        await mtl.text(),
        ""
      );
      materials.preload();
      loader.setMaterials(materials);
    }
    const root = loader.parse(text);
    const note =
      library && !mtl
        ? `Die Materialdatei ${baseName(library)} wurde nicht mit ausgewählt; der Entwurf bleibt modellweiß.`
        : null;
    return { root, note };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FormatError(
      `Die Datei ließ sich nicht als OBJ lesen (${message}).`
    );
  } finally {
    picked.release();
  }
}

/** Where the site serves rhino3dm's script and .wasm (scripts/copy-wasm.ts). */
export const RHINO_LIBRARY_PATH = "/wasm/rhino3dm/";

/** A value of the loader's settings: plain, or an enum's `{ value }`. */
function settingNumber(v: unknown): number | null {
  if (typeof v === "number") {
    return v;
  }
  const inner = (v as { value?: unknown } | null)?.value;
  return typeof inner === "number" ? inner : null;
}

/** A point of the loader's settings (an array, or its indices as keys). */
function settingPoint(v: unknown): [number, number, number] | null {
  const o = v as Record<string, unknown> | null;
  const x = settingNumber(o?.[0]);
  const y = settingNumber(o?.[1]);
  const z = settingNumber(o?.[2]);
  return x === null || y === null ? null : [x, y, z ?? 0];
}

/**
 * The matrix that turns a Rhino model (Z up, its unit) into the design
 * frame, and puts it where its earth anchor says, if it is set.
 */
function rhinoMatrix(
  settings: Record<string, unknown> | undefined,
  epsg: number
): { matrix: Matrix4; note: string | null } {
  const unit = rhinoUnitMetres(settingNumber(settings?.modelUnitSystem));
  // Z up → Y up (north, +y, to −z), in metres
  const frame = new Matrix4()
    .makeRotationX(-Math.PI / 2)
    .premultiply(new Matrix4().makeScale(unit, unit, unit));
  const anchor = settings?.earthAnchorPoint as
    | Record<string, unknown>
    | undefined;
  const lat = settingNumber(anchor?.earthBasepointLatitude);
  const lng = settingNumber(anchor?.earthBasepointLongitude);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) {
    return { matrix: frame, note: null };
  }
  const base = settingPoint(anchor?.modelBasePoint) ?? [0, 0, 0];
  const north = settingPoint(anchor?.modelNorth);
  const place = latLngPlacement(
    lat,
    lng,
    settingNumber(anchor?.earthBasepointElevation) ?? 0,
    north ? [north[0], north[1]] : null,
    epsg
  );
  if (!place) {
    return { matrix: frame, note: null };
  }
  // the base point to the origin, in the design frame
  const toBase = new Matrix4().makeTranslation(
    -base[0] * unit,
    -base[2] * unit,
    base[1] * unit
  );
  return {
    matrix: new Matrix4()
      .fromArray(place)
      .transpose()
      .multiply(toBase)
      .multiply(frame),
    note: "Lage aus dem Geo-Ankerpunkt der Rhino-Datei.",
  };
}

/**
 * Reads a Rhino .3dm with rhino3dm (openNURBS as WebAssembly): its meshes,
 * and its breps and extrusions by the render meshes Rhino saved with them
 * — a file saved without them ("Nur Geometrie speichern") draws nothing.
 */
export async function read3dm(
  main: File,
  epsg: number
): Promise<{ root: Object3D; note: string | null }> {
  const { Rhino3dmLoader } = await import("three/addons/loaders/3DMLoader.js");
  const loader = new Rhino3dmLoader();
  loader.setLibraryPath(RHINO_LIBRARY_PATH);
  loader.setWorkerLimit(1);
  try {
    const content = await new Promise<Object3D>((resolve, reject) => {
      void main
        .arrayBuffer()
        .then((data) => loader.parse(data, resolve, reject), reject);
    });
    const settings = content.userData.settings as
      | Record<string, unknown>
      | undefined;
    const { matrix, note } = rhinoMatrix(settings, epsg);
    content.matrixAutoUpdate = false;
    content.matrix.copy(matrix);
    return { root: content, note };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FormatError(
      `Die Datei ließ sich nicht als Rhino-Datei lesen (${message}).`
    );
  } finally {
    // its workers and their copy of the library go
    loader.dispose();
  }
}
