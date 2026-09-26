import { expect, test } from "bun:test";
import { createLookState } from "@/lib/city/look-state";
import { Object3D } from "three";
import type { CityLayer } from "./city-layer";
import type { LampControl } from "./lamp-layer";
import type { TerrainLayer } from "./terrain-layer";
import {
  catchUp,
  DressingPlugin,
  type TileDressing,
  type TileStreamContext,
} from "./tile-stream";
import type { VegetationControl } from "./vegetation-layer";

test("a dressing that joins the stream late takes the season, night and look of now", () => {
  const calls: string[] = [];
  const vegetation = {
    applyLook: (look: { shimmer: number }) =>
      calls.push(`look ${look.shimmer}`),
    setSeason: (day: number) => {
      calls.push(`season ${day}`);
      return true;
    },
  } as unknown as VegetationControl;
  const lamps = {
    setNightFactor: (night: number) => calls.push(`night ${night}`),
  } as unknown as LampControl;
  const look = createLookState();
  look.set({ shimmer: 0.25 });
  // Built on 10 July by day; the scene moved on to a January night while
  // its compile was pending.
  catchUp({ vegetation, lamps }, { look, night: () => 1, season: () => 9 });
  expect(calls).toEqual(["look 0.25", "season 9", "night 1"]);
});

test("the stream's dispose releases every dressed tile, quietly", () => {
  let changes = 0;
  const stream = {
    cities: new Set<CityLayer>(),
    terrains: new Set<TerrainLayer>(),
    dressings: new Set<TileDressing>(),
    demolished: new Map<string, Set<number>>(),
  };
  const plugin = new DressingPlugin(
    {
      // the gate never opens: nothing is built here
      dressingGate: new Promise<void>(() => undefined),
      onChange: () => {
        changes++;
      },
    } as unknown as TileStreamContext,
    stream
  );
  const freed: string[] = [];
  const terrain = {
    dispose: () => freed.push("terrain"),
  } as unknown as TerrainLayer;
  const city = { dispose: () => freed.push("city") } as unknown as CityLayer;
  stream.terrains.add(terrain);
  stream.cities.add(city);
  plugin.dressed.set(new Object3D(), { terrain });
  plugin.dressed.set(new Object3D(), { city, svf: "svf.png" });
  // 3DTilesRendererJS unregisters (and disposes) its plugins before it
  // disposes its tiles: disposeTile never comes for these.
  plugin.dispose();
  expect(freed).toEqual(["terrain", "city"]);
  expect(plugin.dressed.size).toBe(0);
  expect(stream.terrains.size).toBe(0);
  expect(stream.cities.size).toBe(0);
  expect(plugin.skyView.held()).toBe(0);
  // the app is going: no change reaches it
  expect(changes).toBe(0);
});
