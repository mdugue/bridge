import { describe, expect, test } from "bun:test";
import { coverageGaps, gapTable } from "./coverage-gaps";

const LCOV = [
  "TN:",
  "SF:lib/city/ground.ts",
  "DA:1,1",
  "end_of_record",
  "SF:app/_components/camera-pose.ts",
  "end_of_record",
].join("\n");

describe("coverage gaps", () => {
  test("lists the sources the report never names, the longest first", () => {
    const gaps = coverageGaps(LCOV, [
      { path: "lib/city/ground.ts", lines: 300 },
      { path: "app/_components/post-stack.ts", lines: 400 },
      { path: "app/_components/camera-pose.ts", lines: 500 },
      { path: "app/_components/create-app.ts", lines: 1600 },
    ]);
    expect(gaps.map((g) => g.path)).toEqual([
      "app/_components/create-app.ts",
      "app/_components/post-stack.ts",
    ]);
  });

  test("the table counts files and lines", () => {
    const table = gapTable([
      { path: "app/_components/create-app.ts", lines: 1600 },
      { path: "app/_components/post-stack.ts", lines: 400 },
    ]);
    expect(table).toContain("(2 files, 2000 lines)");
    expect(table).toContain("| `app/_components/create-app.ts` | 1600 |");
  });
});
