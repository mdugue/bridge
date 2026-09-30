import { expect, test } from "bun:test";
import {
  describeFailure,
  describeOffsite,
  describePlacement,
  formatDistance,
  LocateError,
} from "./locate-me";

test("formatDistance says metres up to a kilometre, then km", () => {
  expect(formatDistance(8.4)).toBe("8 m");
  expect(formatDistance(999)).toBe("999 m");
  expect(formatDistance(2345)).toBe("2,3 km");
  expect(formatDistance(994_200)).toBe("994 km");
});

test("describePlacement names the precision, the compass and the distance", () => {
  const inside = {
    kind: "inside",
    accuracy: 14,
    epsgX: 0,
    epsgY: 0,
    headingDeg: 90,
  } as const;
  expect(describePlacement(inside, "Dresden")).toBe(
    "Du bist hier — auf ±14 m genau"
  );
  expect(
    describePlacement({ ...inside, headingDeg: null }, "Dresden")
  ).toContain("ohne Kompass");
  expect(
    describePlacement({ kind: "outside", distanceM: 160_000 }, "Dresden")
  ).toContain("160 km außerhalb von Dresden");
});

test("describeFailure words each reason, and anything else", () => {
  expect(describeFailure(new LocateError("denied"))).toContain("verweigert");
  expect(describeFailure(new LocateError("timeout"))).toContain(
    "Zeitüberschreitung"
  );
  expect(describeFailure(new Error("boom"))).toBe(
    "Standort konnte nicht bestimmt werden"
  );
});

test("describeOffsite names the site and the distance, and asks where to", () => {
  const outside = describeOffsite(
    { kind: "outside", distanceM: 160_000 },
    "Dresden"
  );
  expect(outside.title).toBe("Du bist nicht in Dresden");
  expect(outside.body).toContain("160 km außerhalb");
  expect(outside.body).toEndWith("Wohin stattdessen?");
  expect(describeOffsite({ kind: "unsupported" }, "Dresden").body).toContain(
    "Karte von Dresden"
  );
});
