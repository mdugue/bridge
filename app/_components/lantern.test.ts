import { describe, expect, test } from "bun:test";
import { Vector3 } from "three/webgpu";
import { createLantern, lanternNight, lanternStrength } from "./lantern";

describe("the walker's lantern", () => {
  test("is dark by day and at dusk while the sun is up", () => {
    expect(lanternNight(0)).toBe(0);
    expect(lanternNight(0.5)).toBe(0);
    expect(lanternNight(1)).toBe(1);
  });

  test("is carried on foot and gone from the air", () => {
    expect(lanternStrength(1, 1.7)).toBe(1);
    expect(lanternStrength(1, 60)).toBe(0);
    expect(lanternStrength(1, 15)).toBeGreaterThan(0);
    expect(lanternStrength(1, 15)).toBeLessThan(1);
  });

  test("hangs below the eye, ahead and to the right, whatever the pitch", () => {
    const lantern = createLantern("mobile");
    lantern.setNight(1);
    // looking north (−z), steeply down
    lantern.follow(new Vector3(0, 10, 0), new Vector3(0, -0.9, -0.1), 1.7);
    const p = lantern.light.position;
    expect(p.y).toBeLessThan(10);
    expect(p.z).toBeLessThan(0); // ahead
    expect(p.x).toBeGreaterThan(0); // right of a walker facing −z
    expect(lantern.light.intensity).toBeGreaterThan(0);
    lantern.off();
    expect(lantern.light.intensity).toBe(0);
  });

  test("casts shadows on a desktop only, and redraws them only when moved", () => {
    expect(createLantern("mobile").light.castShadow).toBe(false);
    const lantern = createLantern("desktop");
    expect(lantern.light.castShadow).toBe(true);
    lantern.setNight(1);
    const eye = new Vector3(0, 1.7, 0);
    const dir = new Vector3(0, 0, -1);
    lantern.follow(eye, dir, 1.7);
    expect(lantern.light.shadow.needsUpdate).toBe(true);
    lantern.light.shadow.needsUpdate = false;
    lantern.follow(eye, dir, 1.7);
    expect(lantern.light.shadow.needsUpdate).toBe(false);
    lantern.follow(new Vector3(1, 1.7, 0), dir, 1.7);
    expect(lantern.light.shadow.needsUpdate).toBe(true);
  });
});
