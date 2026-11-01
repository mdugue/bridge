/**
 * The murals as drawings glazed on their walls (lib/city/murals.ts, baked
 * by pipeline/bake/murals.py and mural_drawing.py): a mural is one strip
 * along its LoD2 wall, a few centimetres in front of it, wearing a
 * pen-and-wash drawing made after its photo — pen lines in one dark ink
 * over a light wash of its own colours. A photograph broke the pastel clay
 * model; a drawing in the clay's register belongs to it.
 *
 * The strip is a glaze, not a poster: it multiplies the wall's own lit
 * colour by the drawing, taken relative to the clay (`CLAY_BASE`, the
 * drawing's paper: the wall shows where nothing is drawn). The wall's
 * sun, shadow, sky, floodlight and night carry over it, as they would
 * over paint; the fog fades the glaze to white, which multiplies nothing
 * (height-fog.ts). Papier and the Schwarzplan leave it out (a see-through
 * material; paper-scene.ts); the other picture styles draw what it made.
 *
 * Built per city tile when its full LoD2 lands (the far level is
 * simplified by half a metre: a strip 3 cm off the true wall would sink
 * into it), freed with the tile, and hidden with the building it hangs on
 * (city-layer.ts `hang`).
 *
 * The drawing's files are fetched from the site's own files and decoded by
 * the browser — one at a time, so a tile's never stand decoded side by
 * side. The pen lines are one channel (`RedFormat`), a phone's at
 * PHONE_PX_PER_M (lib/city/murals.ts `muralTexels`); the wash is small.
 * Their texels go to the GPU as data and leave the page once uploaded
 * (raster-upload.ts `dropDataOnUpload`); the textures with their mipmaps
 * weigh on the tile in the cache (tile-stream.ts `calculateBytesUsed`),
 * so a phone keeps fewer other tiles rather than more memory (ADR 0047).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FrontSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  MultiplyBlending,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three/webgpu";
import { min, mix, texture, uniform, uv, vec3, vec4 } from "three/tsl";
import {
  type Mural,
  muralBytes,
  muralStrip,
  muralTexels,
  muralsOf,
  parseMurals,
  textureBytes,
} from "@/lib/city/murals";
import { fetchOptionalBinary, fetchOptionalJson } from "./fetch-optional";
import { dropDataOnUpload } from "./raster-upload";
import { estimateGeometryBytes, trackTexture } from "./three-utils";
import { CLAY_BASE } from "./visual-style";

/** How sharp a drawing stays along a wall seen at a slant. */
const MURAL_ANISOTROPY = 8;
/** First among the see-through: a glaze multiplies what the target holds,
 *  and must find the wall there, not a lamp's halo or a pane in front of
 *  it drawn before (the water sheet and what floats on it come at 2–4). */
const MURAL_RENDER_ORDER = -1;

/** The site's murals by tile, fetched once on the first tile that asks. */
export interface MuralSource {
  /** a drawing's published WebP (`Mural.lines`, `Mural.wash`) as a URL */
  fileUrl: (file: string) => string;
  forTile: (tile: string) => Promise<readonly Mural[]>;
}

/** The site's murals as the tileset's extras name them: their source (null
 *  where it has none) and their photos' credits. */
export function siteMurals(
  extras: unknown,
  tilesetUrl: string
): { credits: readonly string[]; source: MuralSource | null } {
  const murals = muralsOf(extras);
  return {
    credits: murals?.credits ?? [],
    source: createMuralSource(
      murals ? new URL(murals.file, tilesetUrl).href : null
    ),
  };
}

/** The murals of the published file at `url` (null where the site has
 *  none): its URL resolves the drawings' names too. */
export function createMuralSource(url: string | null): MuralSource | null {
  if (!url) {
    return null;
  }
  let all: Promise<readonly Mural[]> | null = null;
  const load = (): Promise<readonly Mural[]> => {
    all ??= fetchOptionalJson<unknown>(url)
      .then((json) => parseMurals(json) ?? [])
      .catch(() => []);
    return all;
  };
  return {
    fileUrl: (file) => new URL(file, url).href,
    forTile: async (tile) => (await load()).filter((m) => m.tile === tile),
  };
}

/** One tile's murals as they hang: `meshes[i]` draws `murals[i]`. */
export interface MuralLayer {
  /** GPU and CPU bytes of its textures and strips */
  bytes: number;
  dispose: () => void;
  group: Group;
  meshes: Mesh[];
  murals: readonly Mural[];
}

/** An image's texels, top row first, at `texels`, RGBA: decoded by the
 *  browser and read back once, its values as stored (no colour
 *  conversion); null where it could not be. The pen lines are a picture
 *  too — ink coverage, which a resize and the GPU's mipmaps filter as they
 *  would any drawing — not a class or a measure. */
async function decodeImage(
  bytes: ArrayBuffer,
  [width, height]: readonly [number, number]
): Promise<Uint8ClampedArray | null> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/webp" }),
      {
        colorSpaceConversion: "none",
        imageOrientation: "none",
        premultiplyAlpha: "none",
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high",
      }
    );
    const context = new OffscreenCanvas(width, height).getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/** The red of RGBA texels: the pen lines' one channel. */
function redOf(rgba: Uint8ClampedArray): Uint8Array {
  const red = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < red.length; i++) {
    red[i] = rgba[i * 4];
  }
  return red;
}

/** One of a drawing's files decoded at `texels` as a texture — the pen
 *  lines as one channel, the wash as sRGB — or null where it could not be
 *  fetched or decoded. Rethrows an abort. */
async function loadLayer(
  url: string,
  texels: readonly [number, number],
  kind: "lines" | "wash",
  signal: AbortSignal
): Promise<Texture | null> {
  const bytes = await fetchOptionalBinary(url, signal);
  if (!bytes) {
    return null;
  }
  const rgba = await decodeImage(bytes, texels);
  if (signal.aborted) {
    throw signal.reason;
  }
  if (!rgba) {
    return null;
  }
  const lines = kind === "lines";
  const layer = lines
    ? new DataTexture(redOf(rgba), texels[0], texels[1], RedFormat)
    : new DataTexture(
        new Uint8Array(rgba.buffer),
        texels[0],
        texels[1],
        RGBAFormat
      );
  // flipY false: row 0 is the drawing's top (`muralStrip`'s v)
  layer.flipY = false;
  layer.colorSpace = lines ? NoColorSpace : SRGBColorSpace;
  // a row of one-channel texels is not four-byte aligned
  layer.unpackAlignment = 1;
  layer.generateMipmaps = true;
  layer.minFilter = LinearMipmapLinearFilter;
  layer.magFilter = LinearFilter;
  layer.anisotropy = MURAL_ANISOTROPY;
  layer.needsUpdate = true;
  dropDataOnUpload(layer);
  trackTexture(layer, textureBytes(texels, lines ? 1 : 4));
  return layer;
}

/** The clay's base colour in the working (linear) space: the paper, one
 *  node every mural's glaze shares. */
const PAPER_RGB = new Color(CLAY_BASE);
const PAPER = vec3(PAPER_RGB.r, PAPER_RGB.g, PAPER_RGB.b);

/** The strip of one mural, glazed with its drawing. */
function muralMesh(
  mural: Mural,
  lines: Texture,
  wash: Texture,
  offset: { cx: number; cy: number }
): Mesh {
  const strip = muralStrip(mural, offset);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(strip.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(strip.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(strip.uvs, 2));
  geometry.setIndex(new BufferAttribute(strip.index, 1));
  geometry.computeBoundingSphere();
  const material = new MeshBasicNodeMaterial({ side: FrontSide });
  const [r, g, b] = mural.ink;
  // a uniform: every mural's glaze is one program
  const ink = uniform(
    new Vector3().setFromColor(
      new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
    )
  );
  // the drawing over the paper; the paper multiplies the wall by one (the
  // bake keeps the wash under it, mural_drawing.py `under_paper`)
  const drawn = mix(ink, texture(wash, uv()).rgb, texture(lines, uv()).r);
  material.colorNode = vec4(min(drawn.div(PAPER), vec3(1)), 1);
  // a glaze: the wall's lit colour times the drawing (dst × src)
  material.blending = MultiplyBlending;
  material.premultipliedAlpha = true;
  material.transparent = true;
  material.depthWrite = false;
  // in front of the wall's clay at every distance the near level shows
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.name = "mural";
  const mesh = new Mesh(geometry, material);
  mesh.name = `mural:${mural.id}`;
  mesh.renderOrder = MURAL_RENDER_ORDER;
  // the wall's light and shadow are under it already
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.mural = mural.id;
  return mesh;
}

/** A mural's two layers, loaded one after the other; null where either
 *  does not load (the other freed). Rethrows an abort, having freed what
 *  it made. */
async function loadDrawing(
  mural: Mural,
  opts: { fileUrl: (file: string) => string; phone: boolean },
  signal: AbortSignal
): Promise<[Texture, Texture] | null> {
  const lines = await loadLayer(
    opts.fileUrl(mural.lines),
    muralTexels(mural, opts.phone),
    "lines",
    signal
  );
  if (!lines) {
    return null;
  }
  let wash: Texture | null;
  try {
    wash = await loadLayer(
      opts.fileUrl(mural.wash),
      mural.washPx,
      "wash",
      signal
    );
  } catch (err) {
    lines.dispose();
    throw err;
  }
  if (!wash) {
    lines.dispose();
    return null;
  }
  return [lines, wash];
}

/**
 * Builds a tile's murals: each drawing fetched and decoded, its strip
 * made. A mural whose drawing does not load is left out; null where none
 * loads. Rethrows an abort (the tile left), having freed what it made.
 */
export async function buildMurals(
  murals: readonly Mural[],
  opts: {
    fileUrl: (file: string) => string;
    offset: { cx: number; cy: number };
    phone: boolean;
    signal: AbortSignal;
  }
): Promise<MuralLayer | null> {
  const drawings: ([Texture, Texture] | null)[] = [];
  try {
    for (const mural of murals) {
      drawings.push(await loadDrawing(mural, opts, opts.signal));
    }
  } catch (err) {
    for (const t of drawings.flat()) {
      t?.dispose();
    }
    throw err;
  }
  const group = new Group();
  group.name = "murals";
  const meshes: Mesh[] = [];
  const shown: Mural[] = [];
  let bytes = 0;
  murals.forEach((mural, i) => {
    const drawing = drawings[i];
    if (!drawing) {
      return;
    }
    const mesh = muralMesh(mural, drawing[0], drawing[1], opts.offset);
    group.add(mesh);
    meshes.push(mesh);
    shown.push(mural);
    bytes += muralBytes(mural, opts.phone) + estimateGeometryBytes(mesh);
  });
  if (meshes.length === 0) {
    return null;
  }
  const textures = drawings.flatMap((d) => d ?? []);
  return {
    bytes,
    group,
    meshes,
    murals: shown,
    dispose: () => {
      group.removeFromParent();
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
      for (const t of textures) {
        t.dispose();
      }
      group.clear();
    },
  };
}
