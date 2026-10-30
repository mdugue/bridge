import { describe, expect, test } from "bun:test";
import { latLngToUtm, utmToLatLng } from "./crs";
import {
  type RhinoAnchor,
  rhinoPlacement,
  rhinoUnitMetres,
} from "./rhino-units";

/** A row-major matrix applied to a point. */
const apply = (m: readonly number[], [x, y, z]: readonly number[]) =>
  [0, 1, 2].map(
    (r) => m[r * 4] * x + m[r * 4 + 1] * y + m[r * 4 + 2] * z + m[r * 4 + 3]
  );

describe("rhinoUnitMetres", () => {
  test("the units a model is drawn in", () => {
    expect(rhinoUnitMetres(2)).toBe(0.001);
    expect(rhinoUnitMetres(3)).toBe(0.01);
    expect(rhinoUnitMetres(4)).toBe(1);
    expect(rhinoUnitMetres(9)).toBe(0.3048);
  });

  test("none, custom or unknown are metres", () => {
    expect(rhinoUnitMetres(0)).toBe(1);
    expect(rhinoUnitMetres(11)).toBe(1);
    expect(rhinoUnitMetres(null)).toBe(1);
  });
});

describe("rhinoPlacement", () => {
  const ll = utmToLatLng(25_833, 412_300, 5_657_420)!;
  const anchor: RhinoAnchor = {
    latitude: ll.lat,
    longitude: ll.lng,
    elevation: 112,
    elevationZero: 1,
    base: [1000, 2000, 0],
    north: [0, 1],
  };

  test("the base point lands at the anchor, in metres, Y up", () => {
    const p = rhinoPlacement(anchor, 0.001, 25_833)!;
    expect(p.heightsKnown).toBe(true);
    const [e, h, z] = apply(p.matrix, [1000, 2000, 0]);
    expect(e).toBeCloseTo(412_300, 3);
    expect(-z).toBeCloseTo(5_657_420, 3);
    expect(h).toBeCloseTo(112, 6);
    // 10 m up the model's Z is 10 m up
    expect(apply(p.matrix, [1000, 2000, 10_000])[1]).toBeCloseTo(122, 6);
    // 10 m along the model's +y is about 10 m north
    const [, , z1] = apply(p.matrix, [1000, 12_000, 0]);
    expect(-z1 + z).toBeCloseTo(10, 1);
  });

  test("an anchor never set is none", () => {
    const unset = -1.234_321_012_343_21e308;
    expect(
      rhinoPlacement(
        { ...anchor, latitude: unset, longitude: unset },
        1,
        25_833
      )
    ).toBeNull();
    expect(
      rhinoPlacement({ ...anchor, latitude: 0, longitude: 0 }, 1, 25_833)
    ).toBeNull();
  });

  test("an elevation above the ground is not taken as NHN", () => {
    const p = rhinoPlacement({ ...anchor, elevationZero: 0 }, 1, 25_833)!;
    expect(p.heightsKnown).toBe(false);
    const at = latLngToUtm(25_833, ll.lat, ll.lng)!;
    expect(apply(p.matrix, [1000, 2000, 0])[0]).toBeCloseTo(at.x, 3);
  });

  test("an unread zero with Rhino's default elevation 0 is not NHN", () => {
    const unread = { ...anchor, elevationZero: null };
    expect(
      rhinoPlacement({ ...unread, elevation: 0 }, 1, 25_833)!.heightsKnown
    ).toBe(false);
    expect(
      rhinoPlacement({ ...unread, elevation: 112 }, 1, 25_833)!.heightsKnown
    ).toBe(true);
  });
});
