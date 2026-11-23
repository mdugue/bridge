import { LoadingManager } from "three/webgpu";
import type { Object3D } from "three/webgpu";
import {
  rhinoFrame,
  rhinoPlacement,
  rhinoUnitMetres,
} from "@/lib/city/rhino-units";
import { bitmapTextureHandler } from "./design-bitmap-texture";

/**
 * The design formats beside glTF and IFC (ADR 0054): OBJ with its MTL and
 * textures, and Rhino's .3dm. Each comes into the design reader's frame
 * (design-read.ts) — metres, Y up, −Z north — as one object tree, and
 * like every design is read on the device only: an OBJ's material file
 * and textures only from the files picked with it, rhino3dm's
 * WebAssembly from the site's own `/wasm/rhino3dm/`
 * (scripts/copy-wasm.ts). Loaded as their own chunks, only when picked.
 * Read in the scene's worker (ADR 0061), so no image goes through the
 * DOM: an OBJ's textures decode with `createImageBitmap`, and a Rhino
 * file's textures and text dots stay out.
 */

/** Thrown with a sentence for the panel. */
export class FormatError extends Error {
  override name = "FormatError";
}

/** A URL's last path part, as the picked files are named. */
export function baseName(url: string): string {
  const path = url.split(/[?#]/u)[0];
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
): {
  manager: LoadingManager;
  missing: string[];
  settled: () => Promise<void>;
  release: () => void;
} {
  const urls = new Map<string, string>();
  for (const f of files) {
    if (f !== main) {
      urls.set(f.name, URL.createObjectURL(f));
    }
  }
  const missing: string[] = [];
  let started = false;
  let done: Promise<void> | null = null;
  const manager = new LoadingManager();
  manager.onStart = () => {
    started = true;
    done ??= new Promise((resolve) => {
      manager.onLoad = resolve;
    });
  };
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
    // every load the manager started has ended, failed ones too
    settled: async () => {
      if (started && done) {
        await done;
      }
    },
    release: () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    },
  };
}

/** The material files an OBJ names (`mtllib a.mtl b.mtl`, one or more
 *  lines). */
function materialLibraries(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/^\s*mtllib\s+(?<list>.+?)\s*$/gmu)) {
    names.push(...(match.groups?.list ?? "").split(/\s+/u).map(baseName));
  }
  return [...new Set(names)];
}

/**
 * Reads an OBJ, its material files (`mtllib`) and textures among the
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
    // MTLLoader takes a manager's handler before its TextureLoader
    picked.manager.addHandler(/./u, bitmapTextureHandler(picked.manager));
    const loader = new OBJLoader(picked.manager);
    const libraries = materialLibraries(text);
    const mtls = files.filter((f) => libraries.includes(f.name));
    const unpicked = libraries.filter((n) => !mtls.some((f) => f.name === n));
    if (mtls.length > 0) {
      const texts = await Promise.all(mtls.map(async (f) => await f.text()));
      const materials = new MTLLoader(picked.manager).parse(
        texts.join("\n"),
        ""
      );
      materials.preload();
      loader.setMaterials(materials);
    }
    const root = loader.parse(text);
    // the textures load from the picked files' URLs: let them finish
    // before those go
    await picked.settled();
    const notes: string[] = [];
    if (unpicked.length > 0) {
      notes.push(
        `Nicht mit ausgewählt: ${unpicked.join(", ")}; ${mtls.length > 0 ? "deren Materialien bleiben" : "der Entwurf bleibt"} modellweiß.`
      );
    }
    if (picked.missing.length > 0) {
      notes.push(
        `Texturen nicht mit ausgewählt: ${[...new Set(picked.missing)].join(", ")}.`
      );
    }
    return { root, note: notes.length > 0 ? notes.join(" ") : null };
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
 * The row-major matrix that turns a Rhino model (Z up, its unit) into the
 * design frame, and puts it where its earth anchor says, if it is set
 * (lib/city/rhino-units.ts).
 */
function rhinoMatrix(
  settings: Record<string, unknown> | undefined,
  epsg: number
): { matrix: number[]; note: string | null; heightsKnown: boolean } {
  const unit = rhinoUnitMetres(settingNumber(settings?.modelUnitSystem));
  const anchor = settings?.earthAnchorPoint as
    | Record<string, unknown>
    | undefined;
  const north = settingPoint(anchor?.modelNorth);
  const placed = rhinoPlacement(
    {
      latitude: settingNumber(anchor?.earthBasepointLatitude),
      longitude: settingNumber(anchor?.earthBasepointLongitude),
      elevation: settingNumber(anchor?.earthBasepointElevation),
      elevationZero: settingNumber(anchor?.earthBasepointElevationZero),
      base: settingPoint(anchor?.modelBasePoint),
      north: north ? [north[0], north[1]] : null,
    },
    unit,
    epsg
  );
  if (!placed) {
    return { matrix: rhinoFrame(unit), note: null, heightsKnown: true };
  }
  return {
    matrix: placed.matrix,
    note: placed.heightsKnown
      ? "Lage aus dem Geo-Ankerpunkt der Rhino-Datei."
      : "Lage aus dem Geo-Ankerpunkt der Rhino-Datei; er nennt keine Höhe über NN, der Entwurf steht auf dem Gelände.",
    heightsKnown: placed.heightsKnown,
  };
}

/** The warning type the prelude reports what it left out with. */
const RHINO_LEFT_OUT = "city-walk: left out";

/**
 * Runs in three's Rhino worker ahead of its own code, as a prelude to
 * the library (it is stringified: it names nothing outside itself).
 * Takes the textures and text dots out of what the worker sends back:
 * three's loader would draw them through the DOM (an `<img>`, a
 * `<canvas>`), which the scene's worker has not, and fail the whole
 * file. Reports how many it took as a loader warning of `type`.
 */
export function rhinoWorkerPrelude(
  scope: { postMessage: (message: unknown, transfer?: unknown) => void },
  type: string
): void {
  const post = scope.postMessage.bind(scope);
  scope.postMessage = (message, transfer) => {
    const m = message as {
      type?: string;
      id?: number;
      data?: {
        objects?: { objectType?: string }[];
        materials?: ({ textures?: { image: string | null }[] } | null)[];
      };
    } | null;
    if (m?.type === "decode" && m.data) {
      let textures = 0;
      for (const material of m.data.materials ?? []) {
        for (const texture of material?.textures ?? []) {
          if (texture.image !== null) {
            texture.image = null;
            textures += 1;
          }
        }
      }
      const objects = m.data.objects ?? [];
      const kept = objects.filter((o) => o.objectType !== "TextDot");
      m.data.objects = kept;
      const dots = objects.length - kept.length;
      if (textures + dots > 0) {
        post({ type: "warning", id: m.id, data: { type, textures, dots } });
      }
    }
    post(message, transfer);
  };
}

/** A loading manager that serves three's Rhino loader its library with
 *  the prelude ahead; `release` lets the built script go. */
async function rhinoLibrary(): Promise<{
  manager: LoadingManager;
  release: () => void;
}> {
  const libraryUrl = `${RHINO_LIBRARY_PATH}rhino3dm.js`;
  const response = await fetch(libraryUrl);
  if (!response.ok) {
    throw new Error(`rhino3dm.js: ${response.status}`);
  }
  const script = [
    await response.text(),
    `(${rhinoWorkerPrelude.toString()})(self, ${JSON.stringify(RHINO_LEFT_OUT)});`,
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([script], { type: "text/javascript" })
  );
  const manager = new LoadingManager();
  manager.setURLModifier((u) => (u === libraryUrl ? url : u));
  return { manager, release: () => URL.revokeObjectURL(url) };
}

/** What the prelude left out of a file, in words; null where nothing. */
function leftOutNote(warnings: unknown): string | null {
  const found = (Array.isArray(warnings) ? warnings : []).find(
    (w: { type?: unknown } | null) => w?.type === RHINO_LEFT_OUT
  ) as { textures?: number; dots?: number } | undefined;
  const parts = [
    (found?.textures ?? 0) > 0 ? "Texturen" : null,
    (found?.dots ?? 0) > 0 ? "Textpunkte (TextDots)" : null,
  ].filter((p) => p !== null);
  return parts.length > 0
    ? `${parts.join(" und ")} der Rhino-Datei werden nicht gezeigt.`
    : null;
}

/**
 * Reads a Rhino .3dm with rhino3dm (openNURBS as WebAssembly): its meshes,
 * and its breps and extrusions by the render meshes Rhino saved with them
 * — a file saved without them ("Nur Geometrie speichern") draws nothing.
 */
export async function read3dm(
  main: File,
  epsg: number
): Promise<{ root: Object3D; note: string | null; heightsKnown: boolean }> {
  const { Rhino3dmLoader } = await import("three/addons/loaders/3DMLoader.js");
  let library: Awaited<ReturnType<typeof rhinoLibrary>> | null = null;
  let loader: InstanceType<typeof Rhino3dmLoader> | null = null;
  try {
    library = await rhinoLibrary();
    const rhino = new Rhino3dmLoader(library.manager);
    loader = rhino;
    rhino.setLibraryPath(RHINO_LIBRARY_PATH);
    rhino.setWorkerLimit(1);
    const data = await main.arrayBuffer();
    const content = await new Promise<Object3D>((resolve, reject) => {
      try {
        rhino.parse(data, resolve, reject);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    const settings = content.userData.settings as
      | Record<string, unknown>
      | undefined;
    const { matrix, note, heightsKnown } = rhinoMatrix(settings, epsg);
    content.matrixAutoUpdate = false;
    // (row-major: fromArray reads column-major)
    content.matrix.fromArray(matrix).transpose();
    const notes = [note, leftOutNote(content.userData.warnings)].filter(
      (n) => n !== null
    );
    return {
      root: content,
      note: notes.length > 0 ? notes.join(" ") : null,
      heightsKnown,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FormatError(
      `Die Datei ließ sich nicht als Rhino-Datei lesen (${message}).`
    );
  } finally {
    // its workers and their copy of the library go
    loader?.dispose();
    library?.release();
  }
}
