import { expect, test } from "bun:test";
import type { MapillaryFeature } from "./features";
import { mapillaryParts } from "./mapillary";

const at = (x: number, k: "bin" | "lamp"): MapillaryFeature => ({
  geometry: { type: "Point", coordinates: [x, 0] },
  properties: { k },
});

test("Mapillary's lamps join the lamps, its bins the furniture, marked", () => {
  const { lamps, furniture } = mapillaryParts([at(1, "lamp"), at(2, "bin")]);
  expect(lamps).toEqual([
    {
      geometry: { type: "Point", coordinates: [1, 0] },
      properties: { src: "mly" },
    },
  ]);
  expect(furniture).toEqual([
    {
      geometry: { type: "Point", coordinates: [2, 0] },
      properties: { k: "bin", src: "mly" },
    },
  ]);
});
