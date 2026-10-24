import { expect, test } from "bun:test";
import { platformTops, TrackIndex, type TrackSample } from "./platform-level";

/** A platform 4 m wide beside a track along x at z 0, its edge at z 1.7. */
const ring = [
  { x: 0, z: 1.7 },
  { x: 40, z: 1.7 },
  { x: 40, z: 5.7 },
  { x: 0, z: 5.7 },
];

function trackAt(y: number, raised = false): TrackIndex {
  const samples: TrackSample[] = [];
  for (let x = -10; x <= 50; x += 4) {
    samples.push({ raised, x, y, z: 0 });
  }
  return new TrackIndex(samples);
}

test("a platform stands its height over the rail head of the track beside it", () => {
  const got = platformTops(
    { ground: ring.map(() => 110), h: 0.76, inside: [110], ring },
    trackAt(110),
    0.17
  );
  expect(got?.top.length ?? 0).toBeGreaterThan(0);
  for (const y of got?.top ?? []) {
    expect(y).toBeCloseTo(110 + 0.17 + 0.76);
  }
});

test("on a viaduct it stands on the track's level, not the street below", () => {
  const got = platformTops(
    { ground: ring.map(() => 104), h: 0.96, inside: [104], ring },
    trackAt(112, true),
    0.17
  );
  expect(got?.top[0]).toBeCloseTo(112 + 0.17 + 0.96);
  // the fascia reaches down to the deck, not to the street
  expect(got?.depth ?? 99).toBeLessThan(2);
});

test("never under the ground the DGM shows inside it", () => {
  const got = platformTops(
    { ground: ring.map(() => 110), h: 0.76, inside: [111.5], ring },
    trackAt(110),
    0.17
  );
  expect(got?.top[0]).toBeCloseTo(111.5);
});

test("a tram stop with no track near stands over the street", () => {
  const got = platformTops(
    {
      ground: [110.3, 110, 110.2, 110.4],
      h: 0.25,
      inside: [110.2],
      kind: "tram",
      ring,
    },
    new TrackIndex([]),
    0.17
  );
  expect(got?.top[0]).toBeCloseTo(110 + 0.02 + 0.25);
});
