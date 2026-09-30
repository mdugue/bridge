import { expect, test } from "bun:test";
import {
  DataArrayTexture,
  DataTexture,
  FloatType,
  MeshStandardNodeMaterial,
  type NodeFrame,
  RedFormat,
  RenderTarget,
  Vector2,
} from "three/webgpu";
import { texture, uv } from "three/tsl";
import { setSlots, slotTexture, slotUniform, stubLike } from "./material-slots";

interface Image {
  data?: unknown;
  depth?: number;
  height: number;
  width: number;
}
const imageOf = (t: { image: unknown }) => t.image as Image;

/** What three hands a node's update for one drawn object. */
const frameFor = (material: MeshStandardNodeMaterial) =>
  ({ material }) as unknown as NodeFrame;

test("a texture slot reads the drawn material's raster, then holds its stub again", () => {
  const a = new DataTexture(new Uint8Array(16), 4, 4, RedFormat);
  const b = new DataTexture(new Uint8Array(16), 4, 4, RedFormat);
  const slot = slotTexture("class", a);
  const stub = slot.value;
  // the graph keeps a stand-in, never a tile's raster
  expect(stub).not.toBe(a);
  const ma = new MeshStandardNodeMaterial();
  const mb = new MeshStandardNodeMaterial();
  setSlots(ma, { class: a });
  setSlots(mb, { class: b });
  slot.updateBefore(frameFor(ma));
  expect(slot.value).toBe(a);
  // after the object is drawn: a build in between copies the stub
  slot.updateAfter(frameFor(ma));
  expect(slot.value).toBe(stub);
  slot.updateBefore(frameFor(mb));
  expect(slot.value).toBe(b);
  // a material without the slot draws the stub
  slot.updateBefore(frameFor(new MeshStandardNodeMaterial()));
  expect(slot.value).toBe(stub);
});

test("a sampling clone sees the drawn tile's texture in its own update", () => {
  // On WebGL a clone decides in its update whether to flip a render
  // target's rows, and three may update it before the slot it samples.
  const target = new RenderTarget(4, 4);
  const slot = slotTexture("color", target.texture);
  const clone = texture(slot, uv());
  const material = new MeshStandardNodeMaterial();
  setSlots(material, { color: target.texture });
  // three's order for one object: every updateBefore, then every update
  slot.updateBefore(frameFor(material));
  expect(clone.value).toBe(target.texture);
});

test("a uniform slot reads the drawn material's value", () => {
  const slot = slotUniform("origin", new Vector2(0, 0));
  const material = new MeshStandardNodeMaterial();
  const origin = new Vector2(1010, 20);
  setSlots(material, { origin });
  slot.update(frameFor(material));
  expect(slot.value).toBe(origin);
});

test("a stub has its texture's kind, not its size", () => {
  const raster = new DataTexture(
    new Float32Array(64),
    4,
    4,
    RedFormat,
    FloatType
  );
  const stub = stubLike(raster);
  expect(stub).toBeInstanceOf(DataTexture);
  expect([imageOf(stub).width, imageOf(stub).height]).toEqual([1, 1]);
  expect(stub.type).toBe(FloatType);
  expect(stub.format).toBe(RedFormat);
  expect((imageOf(stub).data as object).constructor).toBe(Float32Array);
  const layers = new DataArrayTexture(new Uint8Array(4 * 4 * 3), 4, 4, 3);
  const layered = stubLike(layers);
  expect(layered).toBeInstanceOf(DataArrayTexture);
  expect(imageOf(layered).depth).toBe(3);
});

test("a slot texture shrinks to a texel once freed; its bytes may be gone", () => {
  const raster = new DataTexture(new Uint8Array(16), 4, 4, RedFormat);
  setSlots(new MeshStandardNodeMaterial(), { class: raster });
  // what the terrain does once the GPU has the bytes
  (raster.image as { data: Uint8Array | null }).data = null;
  raster.dispose();
  expect([imageOf(raster).width, imageOf(raster).height]).toEqual([1, 1]);
  expect(imageOf(raster).data).toBeInstanceOf(Uint8Array);
  // a render target's texture is its owner's to shrink
  const target = new RenderTarget(8, 8);
  setSlots(new MeshStandardNodeMaterial(), { color: target.texture });
  target.texture.dispose();
  expect(imageOf(target.texture).width).toBe(8);
});
