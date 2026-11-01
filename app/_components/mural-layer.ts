/**
 * The murals as photo textures on their walls (lib/city/murals.ts, baked by
 * pipeline/bake/murals.py): a mural is one strip along its LoD2 wall, a few
 * centimetres in front of it, wearing the photo under the scene's own sun,
 * shadow and fog — paint on the wall, never a glow. Built per city tile
 * when its full LoD2 lands (the far level is simplified by half a metre:
 * a strip 3 cm off the true wall would sink into it), freed with the tile,
 * and hidden with the building it hangs on (city-layer.ts `hang`).
 *
 * The photo is fetched from the site's own files and decoded by the
 * browser; a phone decodes it at PHONE_PX_PER_M (lib/city/murals.ts
 * `muralTexels`). Its bytes — the texture with mipmaps and the bitmap
 * three keeps for an upload again — weigh on the tile in the cache
 * (tile-stream.ts `calculateBytesUsed`), so a phone keeps fewer other
 * tiles rather than more memory (ADR 0047).
 *
 * Night: a lit material, dimmed by the night's own light like the wall.
 * Papier draws it as paper (paper-scene.ts: one material for every
 * surface); the other picture styles draw it as they draw the scene.
 */
import {
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  SRGBColorSpace,
  Texture,
} from "three/webgpu";
import {
  type Mural,
  muralBytes,
  muralStrip,
  muralTexels,
  muralsOf,
  parseMurals,
} from "@/lib/city/murals";
import { fetchOptionalBinary, fetchOptionalJson } from "./fetch-optional";
import { trackTexture } from "./three-utils";

/** How rough the paint reads: matte, a sheen in a grazing sun at most. */
const MURAL_ROUGHNESS = 0.85;
/** How sharp a photo stays along a wall seen at a slant. */
const MURAL_ANISOTROPY = 8;

/** The site's murals by tile, fetched once on the first tile that asks. */
export interface MuralSource {
  forTile: (tile: string) => Promise<readonly Mural[]>;
  /** a mural's published WebP as a URL */
  imageUrl: (mural: Mural) => string;
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
 *  none): its URL resolves the images' names too. */
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
    forTile: async (tile) => (await load()).filter((m) => m.tile === tile),
    imageUrl: (mural) => new URL(mural.image, url).href,
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

/** A mural's photo decoded at `texels` as a texture, or null where it
 *  could not be fetched or decoded. Rethrows an abort. */
async function loadPhoto(
  url: string,
  texels: readonly [number, number],
  signal: AbortSignal
): Promise<Texture | null> {
  const bytes = await fetchOptionalBinary(url, signal);
  if (!bytes) {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/webp" }),
      {
        // flipY false: row 0 is the photo's top (`muralStrip`'s v)
        imageOrientation: "none",
        premultiplyAlpha: "none",
        resizeWidth: texels[0],
        resizeHeight: texels[1],
        resizeQuality: "high",
      }
    );
  } catch {
    return null;
  }
  if (signal.aborted) {
    bitmap.close();
    throw signal.reason;
  }
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = MURAL_ANISOTROPY;
  texture.needsUpdate = true;
  // Kept until the texture goes: three uploads the image again where it
  // re-creates the GPU texture, and a closed bitmap uploads empty.
  texture.addEventListener("dispose", () => bitmap.close());
  trackTexture(texture, muralBytes(texels) - texels[0] * texels[1] * 4);
  return texture;
}

/** The strip of one mural, wearing its photo. */
function muralMesh(
  mural: Mural,
  texture: Texture,
  offset: { cx: number; cy: number }
): Mesh {
  const strip = muralStrip(mural, offset);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(strip.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(strip.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(strip.uvs, 2));
  geometry.setIndex(new BufferAttribute(strip.index, 1));
  geometry.computeBoundingSphere();
  const material = new MeshStandardNodeMaterial({
    map: texture,
    roughness: MURAL_ROUGHNESS,
    metalness: 0,
    side: FrontSide,
  });
  // in front of the wall's clay at every distance the near level shows
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.name = "mural";
  const mesh = new Mesh(geometry, material);
  mesh.name = `mural:${mural.id}`;
  // paint casts no shadow of its own; the wall's falls on it
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.mural = mural.id;
  return mesh;
}

/**
 * Builds a tile's murals: each photo fetched and decoded, its strip made.
 * A mural whose photo does not load is left out; null where none loads.
 * Rethrows an abort (the tile left), having freed what it made.
 */
export async function buildMurals(
  murals: readonly Mural[],
  opts: {
    imageUrl: (mural: Mural) => string;
    offset: { cx: number; cy: number };
    phone: boolean;
    signal: AbortSignal;
  }
): Promise<MuralLayer | null> {
  const textures: (Texture | null)[] = [];
  try {
    for (const mural of murals) {
      textures.push(
        await loadPhoto(
          opts.imageUrl(mural),
          muralTexels(mural, opts.phone),
          opts.signal
        )
      );
    }
  } catch (err) {
    for (const t of textures) {
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
    const texture = textures[i];
    if (!texture) {
      return;
    }
    const mesh = muralMesh(mural, texture, opts.offset);
    group.add(mesh);
    meshes.push(mesh);
    shown.push(mural);
    const geometry = mesh.geometry;
    bytes +=
      muralBytes(muralTexels(mural, opts.phone)) +
      Object.values(geometry.attributes).reduce(
        (sum, a) => sum + (a.array as Float32Array).byteLength,
        geometry.index?.array.byteLength ?? 0
      );
  });
  if (meshes.length === 0) {
    return null;
  }
  return {
    bytes,
    group,
    meshes,
    murals: shown,
    dispose: () => {
      group.removeFromParent();
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        const material = mesh.material as MeshStandardNodeMaterial;
        material.map?.dispose();
        material.dispose();
      }
      group.clear();
    },
  };
}
