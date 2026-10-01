import { expect, test } from "bun:test";
import { SITES } from "@/sites";
import { DATA_LAYERS, siteDataLayers } from "./data-layers";

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
