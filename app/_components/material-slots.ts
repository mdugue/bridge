import {
  DataArrayTexture,
  DataTexture,
  FloatType,
  HalfFloatType,
  type Material,
  type Texture,
  type TextureNode,
  type UniformNode,
} from "three/webgpu";
import { NodeUpdateType, texture, uniform } from "three/tsl";

/**
 * A shader shared by every tile, fed per tile. three keys a node material's
 * build by the identities of its nodes, so a graph made per tile is a build
 * per tile: the ground's 110 KB shader generated again in JavaScript for
 * every tile a flight brought in (60–70 ms each on a laptop, several times
 * that on a phone), though the code came out the same every time.
 *
 * Built once per variant instead, a graph reads what differs from tile to
 * tile — its textures and a few vectors — through slots: nodes that take
 * their value, before each object is drawn, from the drawn material's
 * `userData.slots` (TSL's `onObjectUpdate`). The values land in the object
 * bind group, which three keeps per render object, so every tile draws its
 * own.
 *
 * Between objects a texture slot holds its stub again. three makes a new
 * render object's bind group from bindings it copied when the build was
 * made, holding the textures the slots had at that moment, and uploads
 * those first: a build that saw a tile's raster handed that raster to every
 * later render object of it — long after the tile had freed it (its CPU
 * bytes gone, `writeTexture` threw inside a frame, and three's render state
 * never unwound: every compile after it missed its frame). A copy can still
 * catch a raster (a compile's build may run while another compile holds its
 * slots), so a slot texture shrinks to a texel of its kind once it is freed:
 * made again, it costs a texel, never 16 MB, and never throws.
 */
export type Slots = Readonly<Record<string, unknown>>;

/** Hands a material the values its shared graph's slots read. */
export function setSlots(material: Material, slots: Slots): void {
  material.userData.slots = slots;
  for (const value of Object.values(slots)) {
    if ((value as Partial<Texture> | undefined)?.isTexture === true) {
      shrinkOnDispose(value as Texture);
    }
  }
}

/** The values a material hands its shared graph's slots. */
export const slotsOf = (material: Material | null): Slots =>
  (material?.userData.slots ?? {}) as Slots;

type ArrayOf = new (length: number) => ArrayBufferView;

type Layered = Texture & {
  image: { data?: ArrayBufferView | null; depth?: number } | null;
  isDataArrayTexture?: boolean;
  isRenderTargetTexture?: boolean;
};

const arrayFor = (type: number): ArrayOf => {
  if (type === FloatType) {
    return Float32Array;
  }
  if (type === HalfFloatType) {
    return Uint16Array;
  }
  return Uint8Array;
};

/** A 1×1 image of `like`'s element type (and layer count, for an array). */
function texelImage(like: Texture) {
  const source = like as Layered;
  const make =
    (source.image?.data?.constructor as ArrayOf | undefined) ??
    arrayFor(like.type);
  const depth = source.isDataArrayTexture ? (source.image?.depth ?? 1) : 1;
  return { data: new make(4 * depth), width: 1, height: 1, depth };
}

/**
 * A 1×1 stand-in of `like`'s kind — its class (a layered array or not),
 * format, type, colour space and filtering, which is what the shader and
 * its bindings are generated from. It holds no tile's data, so the shared
 * graph keeps no tile's texture alive; the slot swaps in the drawn tile's
 * own before any binding is made.
 */
export function stubLike(like: Texture): Texture {
  const { data, depth } = texelImage(like);
  const stub = (like as Layered).isDataArrayTexture
    ? new DataArrayTexture(data as never, 1, 1, depth)
    : new DataTexture(data as never, 1, 1);
  stub.format = like.format;
  stub.type = like.type;
  stub.colorSpace = like.colorSpace;
  stub.minFilter = like.minFilter;
  stub.magFilter = like.magFilter;
  stub.wrapS = like.wrapS;
  stub.wrapT = like.wrapT;
  stub.flipY = like.flipY;
  stub.internalFormat = like.internalFormat;
  stub.generateMipmaps = false;
  stub.needsUpdate = true;
  return stub;
}

const shrinking = new WeakSet<Texture>();

/**
 * Once freed, the texture's image is a texel of its kind (see `Slots`). A
 * render target's texture is its owner's to shrink (landcover-splat.ts):
 * it dispatches no dispose of its own.
 */
function shrinkOnDispose(tex: Texture): void {
  if (shrinking.has(tex) || (tex as Layered).isRenderTargetTexture === true) {
    return;
  }
  shrinking.add(tex);
  const onDispose = () => {
    tex.removeEventListener("dispose", onDispose);
    tex.image = texelImage(tex);
  };
  tex.addEventListener("dispose", onDispose);
}

/**
 * A texture slot: `like` is any tile's texture of this kind (it is copied
 * as a stub, not kept). Sample it with `texture(slot, uv)`; the clone
 * shares the slot's binding and value.
 */
export function slotTexture(name: string, like: Texture): TextureNode {
  const stub = stubLike(like);
  const node = texture(stub).onObjectUpdate(
    ({ material }) => (slotsOf(material)[name] as Texture | undefined) ?? stub
  );
  // Back to the stub once the object is drawn: a build made before the
  // next object's update copies the stub (see `Slots`).
  node.updateAfterType = NodeUpdateType.OBJECT;
  node.updateAfter = () => {
    node.value = stub;
    return undefined;
  };
  return node;
}

/** A uniform slot; `initial` gives its type (and the value off a tile). */
export function slotUniform<T extends object | number>(
  name: string,
  initial: T
): UniformNode<string, T> {
  // reason: `uniform` infers its node type from the value; the slot keeps
  // whatever type the initial value has.
  const node = uniform(initial as never) as unknown as UniformNode<string, T>;
  return node.onObjectUpdate(
    ({ material }) => (slotsOf(material)[name] as T | undefined) ?? initial
  );
}
