import { describe, expect, test } from "bun:test";
import {
  DESIGN_LIMITS,
  geometryBytes,
  judgeDesign,
  textureBytesOf,
} from "./design-budget";

const MB = 1024 * 1024;

describe("design budget", () => {
  test("a light design keeps its textures", () => {
    const verdict = judgeDesign(
      { triangles: 50_000, geometryBytes: 5 * MB, textureBytes: 8 * MB },
      "mobile"
    );
    expect(verdict).toEqual({ ok: true, keepTextures: true, bytes: 13 * MB });
  });

  test("textures go first on a phone", () => {
    const verdict = judgeDesign(
      { triangles: 50_000, geometryBytes: 5 * MB, textureBytes: 64 * MB },
      "mobile"
    );
    expect(verdict).toEqual({ ok: true, keepTextures: false, bytes: 5 * MB });
  });

  test("too many triangles are refused, with the numbers", () => {
    const verdict = judgeDesign(
      { triangles: 1_200_000, geometryBytes: 30 * MB, textureBytes: 0 },
      "mobile"
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("1.200.000");
      expect(verdict.reason).toContain("250.000");
    }
    expect(
      judgeDesign(
        { triangles: 1_200_000, geometryBytes: 30 * MB, textureBytes: 0 },
        "desktop"
      ).ok
    ).toBe(true);
  });

  test("the phone's budget holds its own limit of triangles", () => {
    const { triangles, bytes } = DESIGN_LIMITS.mobile;
    // a mesh at the triangle limit, vertices shared about two to one
    expect(geometryBytes(triangles / 2, triangles)).toBeLessThan(bytes);
  });

  test("a texture with its mips", () => {
    expect(textureBytesOf(1024, 1024)).toBe(Math.ceil(4 * MB * (4 / 3)));
  });
});
