import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Mesh, SRGBColorSpace } from "three/webgpu";
import type { Material, Texture } from "three/webgpu";
import { readObj, rhinoWorkerPrelude } from "./design-formats";

/**
 * The design formats as the scene's worker reads them: no DOM, so an
 * OBJ's textures decode with `createImageBitmap` (stubbed here: bun has
 * none) and a Rhino file's textures and text dots stay out.
 */

const OBJ = [
  "mtllib haus.mtl",
  "v 0 0 0",
  "v 10 0 0",
  "v 10 0 -10",
  "vt 0 0",
  "vt 1 0",
  "vt 1 1",
  "usemtl ziegel",
  "f 1/1 2/2 3/3",
].join("\n");

const decoded: Blob[] = [];

beforeEach(() => {
  decoded.length = 0;
  Object.assign(globalThis, {
    createImageBitmap: async (blob: Blob) => {
      decoded.push(blob);
      return await Promise.resolve({ width: 4, height: 2, close: () => null });
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "createImageBitmap");
});

/** The map of the OBJ's first mesh's material. */
function mapOf(root: { traverse: (f: (o: unknown) => void) => void }) {
  let map: Texture | null = null;
  root.traverse((o) => {
    if (o instanceof Mesh) {
      map ??= (o.material as Material & { map: Texture | null }).map;
    }
  });
  return map as Texture | null;
}

describe("an OBJ with a textured MTL", () => {
  test("its texture decodes without a DOM, as three's TextureLoader keeps it", async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe(
      "undefined"
    );
    const mtl = ["newmtl ziegel", "Kd 1 1 1", "map_Kd ziegel.png"].join("\n");
    const { root, note } = await readObj(new File([OBJ], "haus.obj"), [
      new File([OBJ], "haus.obj"),
      new File([mtl], "haus.mtl"),
      new File([new Uint8Array([1, 2, 3])], "ziegel.png"),
    ]);
    expect(note).toBeNull();
    expect(decoded).toHaveLength(1);
    expect(decoded[0].size).toBe(3);
    const map = mapOf(root);
    expect(map?.image).toEqual(expect.objectContaining({ width: 4 }));
    expect(map?.flipY).toBe(true);
    expect(map?.colorSpace).toBe(SRGBColorSpace);
  });

  test("a texture not picked is named, and the OBJ still reads", async () => {
    const mtl = ["newmtl ziegel", "Kd 1 1 1", "map_Kd fehlt.png"].join("\n");
    const { root, note } = await readObj(new File([OBJ], "haus.obj"), [
      new File([mtl], "haus.mtl"),
    ]);
    expect(note).toContain("fehlt.png");
    expect(decoded).toHaveLength(0);
    expect(mapOf(root)?.image ?? null).toBeNull();
  });
});

describe("the Rhino worker's prelude", () => {
  test("takes the textures and text dots out of a decode and says so", () => {
    const sent: unknown[] = [];
    const scope = {
      postMessage: (message: unknown) => {
        sent.push(message);
      },
    };
    rhinoWorkerPrelude(scope, "left out");
    const data = {
      objects: [{ objectType: "Mesh" }, { objectType: "TextDot" }],
      materials: [
        { textures: [{ image: "data:image/png;base64,AA" }, { image: null }] },
        null,
      ],
    };
    scope.postMessage({ type: "decode", id: 7, data });
    expect(data.objects).toEqual([{ objectType: "Mesh" }]);
    expect(data.materials[0]?.textures.map((t) => t.image)).toEqual([
      null,
      null,
    ]);
    expect(sent).toEqual([
      {
        type: "warning",
        id: 7,
        data: { type: "left out", textures: 1, dots: 1 },
      },
      { type: "decode", id: 7, data },
    ]);
  });

  test("passes anything else through as it is", () => {
    const sent: unknown[] = [];
    const scope = {
      postMessage: (message: unknown) => {
        sent.push(message);
      },
    };
    rhinoWorkerPrelude(scope, "left out");
    const plain = {
      type: "decode",
      id: 1,
      data: { objects: [], materials: [] },
    };
    scope.postMessage(plain);
    scope.postMessage({ type: "error", id: 2 });
    expect(sent).toEqual([plain, { type: "error", id: 2 }]);
  });
});
