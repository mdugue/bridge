import { expect, test } from "bun:test";
import { ownBuffer, readGlb, writeGlb } from "./glb-container";

test("a glb comes apart and back together, padded to four bytes", () => {
  const json = { asset: { version: "2.0" }, buffers: [{ byteLength: 3 }] };
  const glb = writeGlb(json, [new Uint8Array([1, 2, 3])]);
  expect(glb.length % 4).toBe(0);
  const back = readGlb<typeof json>(glb);
  expect(back.json).toEqual(json);
  expect([...back.bin]).toEqual([1, 2, 3, 0]);
});

test("a glb without a BIN chunk is refused in the reader's words", () => {
  const glb = writeGlb({ asset: { version: "2.0" } }, []);
  // cut the (empty) BIN chunk's header off
  const cut = glb.slice(0, glb.length - 8);
  new DataView(cut.buffer).setUint32(8, cut.length, true);
  expect(() => readGlb(cut)).toThrow("glb: no BIN chunk");
});

test("the own buffer is the one without a uri that is no meshopt fallback", () => {
  expect(
    ownBuffer({
      buffers: [
        { extensions: { KHR_meshopt_compression: { fallback: true } } },
        { uri: "x.bin" },
        {},
      ],
    })
  ).toBe(2);
  expect(ownBuffer({})).toBe(-1);
});
