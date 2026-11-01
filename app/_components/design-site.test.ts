import { afterEach, describe, expect, test } from "bun:test";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import {
  foldedThing,
  inDesignSiteAt,
  releaseDesignSite,
  setDesignSite,
} from "./design-site";

const offset = { cx: 1000, cy: 2000 };
/** A 4 × 4 m site at EPSG (1010…1014, 2020…2024), its floor at 110 m. */
const mask = {
  x0: 1010,
  y0: 2020,
  cell: 1,
  cols: 4,
  rows: 4,
  cells: new Uint8Array(16).fill(1),
  floors: new Float32Array(16).fill(110),
};
const at = (e: number, n: number) => ({ x: e - offset.cx, z: offset.cy - n });
const tree = (position: [number, number]) =>
  ({ kind: "tree", position }) as unknown as FeatureInquiry;

afterEach(() => releaseDesignSite());

describe("what the design's site folds away, as a question sees it", () => {
  test("a point in the site, one beside it, none without a design", () => {
    expect(inDesignSiteAt(at(1012, 2022).x, at(1012, 2022).z)).toBe(false);
    setDesignSite(mask, offset);
    expect(inDesignSiteAt(at(1012, 2022).x, at(1012, 2022).z)).toBe(true);
    expect(inDesignSiteAt(at(1015, 2022).x, at(1015, 2022).z)).toBe(false);
    expect(inDesignSiteAt(at(1012, 2019).x, at(1012, 2019).z)).toBe(false);
  });

  test("a tree by its foot, a hedge by where the ray met it, a bridge never", () => {
    setDesignSite(mask, offset);
    const outside = at(1030, 2030);
    expect(foldedThing(tree([1012, 2022]), outside, offset)).toBe(true);
    expect(foldedThing(tree([1030, 2022]), at(1012, 2022), offset)).toBe(false);
    const hedge = { kind: "hedge", position: [1030, 2030] } as never;
    expect(foldedThing(hedge, at(1012, 2022), offset)).toBe(true);
    const bridge = { kind: "bridge", position: [1012, 2022] } as never;
    expect(foldedThing(bridge, at(1012, 2022), offset)).toBe(false);
  });
});
