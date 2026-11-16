import { Texture } from "three/webgpu";
import type { Loader, LoadingManager } from "three/webgpu";

/**
 * A design's texture as three's TextureLoader loads it (flipY, the colour
 * space its caller sets), but decoded with `createImageBitmap`: three's
 * image loader makes an `<img>`, which the scene's worker has not
 * (ADR 0061). The URL goes through the manager's modifier (design-formats.ts
 * `pickedFiles`: only the picked files), and is the manager's item until
 * the image is decoded, so a reader waiting for the manager waits for it.
 */
export class BitmapTextureLoader {
  readonly manager: LoadingManager;

  constructor(manager: LoadingManager) {
    this.manager = manager;
  }

  load(
    url: string,
    onLoad?: (texture: Texture) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void
  ): Texture {
    const texture = new Texture();
    const resolved = this.manager.resolveURL(url);
    const decode = async () => {
      this.manager.itemStart(resolved);
      try {
        const response = await fetch(resolved);
        if (!response.ok) {
          throw new Error(`${response.status}: ${url}`);
        }
        // as three's ImageBitmapLoader: the pixels as stored, flipped on
        // upload (WebGPU honours flipY for a bitmap)
        texture.image = await createImageBitmap(await response.blob(), {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        texture.needsUpdate = true;
        onLoad?.(texture);
      } catch (error) {
        onError?.(error);
        this.manager.itemError(resolved);
      } finally {
        this.manager.itemEnd(resolved);
      }
    };
    void decode();
    return texture;
  }
}

/** The loader as a manager's handler (`addHandler`): three types a
 *  handler as a Loader, whose `load` returns nothing, but MTLLoader takes
 *  the texture a handler's `load` returns. */
export function bitmapTextureHandler(manager: LoadingManager): Loader {
  // reason: the handler's shape, not three's Loader class (see above)
  return new BitmapTextureLoader(manager) as unknown as Loader;
}
