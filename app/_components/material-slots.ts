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
import { texture, uniform } from "three/tsl";

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
 */
export type Slots = Readonly<Record<string, unknown>>;

/** Hands a material the values its shared graph's slots read. */
export function setSlots(material: Material, slots: Slots): void {
  material.userData.slots = slots;
}

/** The values a material hands its shared graph's slots. */
export const slotsOf = (material: Material | null): Slots =>
  (material?.userData.slots ?? {}) as Slots;

type ArrayOf = new (length: number) => ArrayBufferView;

const arrayFor = (type: number): ArrayOf => {
  if (type === FloatType) {
    return Float32Array;
  }
  if (type === HalfFloatType) {
    return Uint16Array;
  }
  return Uint8Array;
};

/**
 * A 1×1 stand-in of `like`'s kind — its class (a layered array or not),
 * format, type, colour space and filtering, which is what the shader and
 * its bindings are generated from. It holds no tile's data, so the shared
 * graph keeps no tile's texture alive; the slot swaps in the drawn tile's
 * own before any binding is made.
 */
export function stubLike(like: Texture): Texture {
  const source = like as Texture & {
    image: { data?: ArrayBufferView; depth?: number } | null;
    isDataArrayTexture?: boolean;
  };
  const make =
    (source.image?.data?.constructor as ArrayOf | undefined) ??
    arrayFor(like.type);
  const depth = source.image?.depth ?? 1;
  const stub = source.isDataArrayTexture
    ? new DataArrayTexture(new make(4 * depth) as never, 1, 1, depth)
    : new DataTexture(new make(4) as never, 1, 1);
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

/**
 * A texture slot: `like` is any tile's texture of this kind (it is copied
 * as a stub, not kept). Sample it with `texture(slot, uv)`; the clone
 * shares the slot's binding and value.
 */
export function slotTexture(name: string, like: Texture): TextureNode {
  const stub = stubLike(like);
  return texture(stub).onObjectUpdate(
    ({ material }) => (slotsOf(material)[name] as Texture | undefined) ?? stub
  );
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
