import { expect, test } from "bun:test";
import {
  propertyTableViews,
  readStructuralMetadata,
  type StructuralMetadataJson,
} from "./property-table";

const buffer = (array: ArrayBufferView): ArrayBuffer =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice()
    .buffer;

/** Two objects, a column of every kind the bake writes (scripts/tile-glb.ts)
 *  and a class property without a column, over buffer views 0–6. */
function twoObjects() {
  const zwinger = new TextEncoder().encode("Zwinger");
  const views = [
    buffer(new Float32Array([100.5, 101])),
    buffer(new Float32Array([18.5, -1])),
    buffer(new Uint16Array([3, 0])),
    buffer(new Float32Array([0.5, 0.25, 0.75, 1, 1, 1])),
    buffer(zwinger),
    buffer(new Uint32Array([0, zwinger.length, zwinger.length])),
    buffer(new Uint16Array([1, 0])),
  ];
  const ext: StructuralMetadataJson = {
    schema: {
      classes: {
        building: {
          properties: {
            baseZ: { type: "SCALAR", componentType: "FLOAT32" },
            height: {
              type: "SCALAR",
              componentType: "FLOAT32",
              noData: -1,
              default: -1,
            },
            flags: { type: "SCALAR", componentType: "UINT16" },
            tint: { type: "VEC3", componentType: "FLOAT32" },
            name: { type: "STRING" },
            roofType: { type: "ENUM", enumType: "roofType", noData: "NONE" },
            levels: { type: "SCALAR", componentType: "UINT8" },
          },
        },
      },
      enums: {
        roofType: {
          valueType: "UINT16",
          values: [
            { name: "NONE", value: 0 },
            { name: "3100", value: 1 },
          ],
        },
      },
    },
    propertyTables: [
      {
        class: "building",
        count: 2,
        properties: {
          baseZ: { values: 0 },
          height: { values: 1 },
          flags: { values: 2 },
          tint: { values: 3 },
          name: { values: 4, stringOffsets: 5, stringOffsetType: "UINT32" },
          roofType: { values: 6 },
        },
      },
    ],
  };
  return { ext, views };
}

test("a table reads back what was stored, column by column", () => {
  const { ext, views } = twoObjects();
  expect(propertyTableViews(ext).toSorted((a, b) => a - b)).toEqual([
    0, 1, 2, 3, 4, 5, 6,
  ]);
  const [table] = readStructuralMetadata(ext, (i) => views[i]).tableAccessors;
  expect(table.count).toBe(2);
  const column = (name: string) =>
    [0, 1].map((id) => table.getPropertyValue(name, id));
  expect(column("baseZ")).toEqual([100.5, 101]);
  // the bake's "unknown" stays the marker (noData's default), not 0
  expect(column("height")).toEqual([18.5, -1]);
  expect(column("flags")).toEqual([3, 0]);
  expect(column("tint")).toEqual([
    [0.5, 0.25, 0.75],
    [1, 1, 1],
  ]);
  expect(column("name")).toEqual(["Zwinger", ""]);
  // a code by its name; the NONE code is no code
  expect(column("roofType")).toEqual(["3100", ""]);
});

test("a class property without a column answers its default; anything else outside the table throws", () => {
  const { ext, views } = twoObjects();
  const [table] = readStructuralMetadata(ext, (i) => views[i]).tableAccessors;
  expect("levels" in table.properties).toBe(true);
  expect(table.getPropertyValue("levels", 1)).toBe(0);
  expect("winStyle" in table.properties).toBe(false);
  expect(() => table.getPropertyValue("winStyle", 0)).toThrow();
  expect(() => table.getPropertyValue("baseZ", 2)).toThrow();
});
