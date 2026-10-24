import { expect, test } from "bun:test";
import { SITES } from "@/sites";
import {
  DATA_LAYERS,
  type DataLayerKey,
  dataLayersOf,
  siteDataLayers,
} from "./data-layers";

const keys = (id: keyof typeof SITES) =>
  siteDataLayers(SITES[id].dataLayers).map((r) => r.key);

test("a site offers only the layers it has a source for", () => {
  expect(keys("dresden")).toEqual(DATA_LAYERS.map((d) => d.key));
  expect(keys("hamburg")).toEqual(["trafficLayer", "bikeLayer"]);
  expect(keys("leipzig")).toEqual(["tramLayer"]);
  expect(keys("unna")).toEqual(["trafficLayer"]);
});

test("each row credits the site's own source and names its operator", () => {
  const [traffic] = siteDataLayers(SITES.grimma.dataLayers);
  expect(traffic.source).toStartWith("Straßenverkehrszählung 2021");
  // a census counts both ways together: the HUD says the split is even
  expect(traffic.description).toContain("je zur Hälfte");
  const dresden = siteDataLayers(SITES.dresden.dataLayers);
  expect(dresden[0].description).not.toContain("je zur Hälfte");
  const [tram] = siteDataLayers(SITES.leipzig.dataLayers);
  expect(tram.description).toContain("Bahnen der LVB");
});

test("the look reset keeps the layer flags and nothing else of the look", () => {
  const flags = Object.fromEntries(
    DATA_LAYERS.map((d, i) => [d.key, i % 2 === 0])
  ) as Record<DataLayerKey, boolean>;
  // the rest of a look rides along and must not be kept
  const look = { ...flags, fogAmount: 0.4, style: "noir" };
  const kept = dataLayersOf(look);
  expect(Object.keys(kept).toSorted()).toEqual(
    DATA_LAYERS.map((d) => d.key).toSorted()
  );
  for (const [i, d] of DATA_LAYERS.entries()) {
    expect(kept[d.key]).toBe(i % 2 === 0);
  }
});
