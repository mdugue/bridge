import type { TilesRenderer } from "3d-tiles-renderer/three";
import {
  type GLTF,
  GLTFLoader,
  type GLTFLoaderPlugin,
  type GLTFParser,
} from "three/addons/loaders/GLTFLoader.js";
import type { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  propertyTableViews,
  readStructuralMetadata,
  type StructuralMetadataJson,
} from "@/lib/city/property-table";

const METADATA = "EXT_structural_metadata";

/** What the renderer looks a glTF content's loader up by (`path.glb`). */
const GLTF_CONTENT = /\.(gltf|glb)$/;

/**
 * Reads a glTF's EXT_structural_metadata property tables
 * (lib/city/property-table.ts) onto `userData.structuralMetadata` of the
 * scene and every object in it — the building mesh's per-object table,
 * which city-layer.ts reads. EXT_mesh_features needs nothing: the feature id
 * is a vertex attribute three names `_feature_id_0`.
 */
function metadataReader(parser: GLTFParser): GLTFLoaderPlugin {
  return {
    name: METADATA,
    afterRoot: async ({ scene }: GLTF) => {
      const json = parser.json as {
        extensions?: Record<string, unknown>;
        extensionsUsed?: string[];
      };
      const ext = json.extensions?.[METADATA] as
        | StructuralMetadataJson
        | undefined;
      if (!(ext && json.extensionsUsed?.includes(METADATA))) {
        return;
      }
      const views = new Map(
        await Promise.all(
          propertyTableViews(ext).map(
            async (i) =>
              [
                i,
                (await parser.getDependency("bufferView", i)) as ArrayBuffer,
              ] as const
          )
        )
      );
      const metadata = readStructuralMetadata(ext, (i) => views.get(i));
      scene.traverse((object) => {
        object.userData.structuralMetadata = metadata;
      });
    },
  };
}

/**
 * The tiles' glTF loader: meshopt-compressed content (the decoder's own
 * workers) and the property-table reader above. It takes the place of
 * 3DTilesRendererJS's GLTFExtensionsPlugin, whose metadata extension reads
 * property textures through a classic WebGLRenderer — all of three's WebGL
 * renderer and GLSL in the bundle for textures no tile has — and whose
 * CESIUM_RTC the tiles do not use. Without a loader registered here the
 * renderer parses glTF with a bare GLTFLoader, which cannot decode meshopt.
 */
export class GltfContentPlugin {
  readonly name = "GLTF_CONTENT";
  private tiles: TilesRenderer | null = null;

  constructor(private readonly meshopt: typeof MeshoptDecoder) {}

  init(tiles: TilesRenderer): void {
    const loader = new GLTFLoader(tiles.manager);
    loader.setMeshoptDecoder(this.meshopt);
    loader.register(metadataReader);
    tiles.manager.addHandler(GLTF_CONTENT, loader);
    this.tiles = tiles;
  }

  dispose(): void {
    this.tiles?.manager.removeHandler(GLTF_CONTENT);
    this.tiles = null;
  }
}
