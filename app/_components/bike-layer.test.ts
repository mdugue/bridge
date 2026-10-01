import { expect, test } from "bun:test";
import type { BikeCounter } from "@/lib/city/bike-counts";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { createBikeLayer } from "./bike-layer";
import type { Instances } from "./instancing";

const counter = (
  id: string,
  x: number,
  counts: number[],
  measuredAt = new Date(2026, 9, 1, 7)
): BikeCounter => ({
  angleDeg: 0,
  directions: counts.map((count, i) => ({ toward: `R${i}`, count })),
  id,
  measuredAt,
  name: id,
  where: "",
  x,
  y: 0,
});

const columnsOf = (layer: ReturnType<typeof createBikeLayer>) =>
  layer.group.children[0] as Instances;

test("a column per direction, standing on the ground, as tall as its count", () => {
  let loaded = 100;
  const ctx: GroundContext = {
    offset: { cx: 0, cy: 0 },
    heightAt: (x) => (x < loaded ? 110 : null),
  };
  const layer = createBikeLayer(ctx);
  layer.set(
    [
      counter("a", 10, [309, 482]),
      counter("b", 50, [123]),
      counter("c", 150, [5, 5]),
    ],
    new Date(2026, 9, 1, 7, 30)
  );
  const columns = columnsOf(layer);
  // c stands over ground not loaded yet: it waits
  expect(columns.drawCount).toBe(3);
  expect(columns.castShadow).toBe(false);
  loaded = 200;
  expect(layer.reground()).toBe(true);
  expect(columns.drawCount).toBe(5);
  expect(layer.reground()).toBe(false);
  layer.dispose();
});

test("an old count stands grey", () => {
  const ctx: GroundContext = { offset: { cx: 0, cy: 0 }, heightAt: () => 0 };
  const layer = createBikeLayer(ctx);
  layer.set([counter("a", 0, [10, 10])], new Date(2026, 9, 1, 7, 30));
  const fresh = Array.from(columnsOf(layer).instanceTints?.array ?? []).slice(
    0,
    3
  );
  layer.set([counter("a", 0, [10, 10])], new Date(2026, 9, 2, 7, 30));
  const stale = Array.from(columnsOf(layer).instanceTints?.array ?? []).slice(
    0,
    3
  );
  expect(stale).not.toEqual(fresh);
  // grey: the three channels close together
  expect(Math.max(...stale) - Math.min(...stale)).toBeLessThan(0.1);
  layer.dispose();
});
