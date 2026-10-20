import { expect, test } from "bun:test";
import { Vector3 } from "three/webgpu";
import { buildLamps, createLampLights, LAMP_LIGHTS } from "./lamp-layer";

/** A lamp head 5 m up at (x, z), the camera's eye 1.7 m up. */
const head = (x: number, z = 0) => new Vector3(x, 5, z);
const eye = (x: number, z = 0) => new Vector3(x, 1.7, z);

test("a desktop lights the three nearest heads, nearest first", () => {
  const pool = createLampLights(LAMP_LIGHTS.desktop);
  expect(pool.lights).toHaveLength(3);
  // index 1 and 3 stand equally far: the earlier keeps the nearer slot
  const heads = [head(30), head(-12), head(5), head(12), head(80)];
  pool.setHeads(heads);
  pool.setNightFactor(1);
  pool.updateNearest(eye(0));
  expect(pool.lights.map((l) => l.position)).toEqual([
    heads[2],
    heads[1],
    heads[3],
  ]);
  for (const light of pool.lights) {
    expect(light.intensity).toBeGreaterThan(0);
  }

  // fewer heads than lights: the spare light stays dark
  pool.setHeads([head(5), head(10)]);
  pool.updateNearest(eye(0));
  expect(pool.lights[2].intensity).toBe(0);

  // by day nothing is lit
  pool.setNightFactor(0);
  pool.updateNearest(eye(0));
  expect(pool.lights.every((l) => l.intensity === 0)).toBe(true);
});

test("a phone's one light hands over between two lamps through darkness", () => {
  const pool = createLampLights(LAMP_LIGHTS.mobile);
  expect(pool.lights).toHaveLength(1);
  const [light] = pool.lights;
  // two lamps 30 m apart along a street, a third across the road far off
  pool.setHeads([head(0), head(30), head(15, 60)]);
  pool.setNightFactor(1);

  // walk from one lamp to the next: the light moves heads once, and only
  // where it has faded out — never a jump at full strength
  pool.updateNearest(eye(0));
  const full = light.intensity;
  let at = light.position.clone();
  let before = light.intensity;
  let moves = 0;
  for (let x = 0.1; x <= 30; x += 0.1) {
    pool.updateNearest(eye(x));
    if (!light.position.equals(at)) {
      moves++;
      expect(before).toBeLessThan(full * 0.05);
      expect(light.intensity).toBeLessThan(full * 0.05);
      at = light.position.clone();
    }
    before = light.intensity;
  }
  expect(moves).toBe(1);
  expect(light.position).toEqual(head(30));

  // a few metres off the bisector it is lit as before
  pool.updateNearest(eye(8));
  expect(light.intensity).toBe(full);
});

test("a lamp on a bridge stands on its deck, not on the ground below", () => {
  const ctx = { heightAt: () => 100, offset: { cx: 0, cy: 0 } };
  const lamps = buildLamps(
    [
      {
        geometry: { type: "Point", coordinates: [10, 20] },
        properties: { h: 5 },
      },
      {
        geometry: { type: "Point", coordinates: [30, 20] },
        properties: { deck: 112.5, h: 5 },
      },
    ],
    ctx
  );
  expect(lamps.headPositions.map((p) => p.y)).toEqual([105, 117.5]);
});
