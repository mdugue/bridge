import { expect, test } from "bun:test";
import { ShaderChunk } from "three";
import { lightsWithFarShadow, skyLightBody, skyLightDecl } from "./sky-light";

test("the far horizon joins the directional shadow by min, never a product", () => {
  const patched = lightsWithFarShadow();
  expect(patched).toContain(
    "? min( getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize"
  );
  expect(patched).toContain("vDirectionalShadowCoord[ i ] ), hzLit ) : 1.0;");
  // a light without a shadow map still takes the horizon
  expect(patched).toContain("directLight.color *= hzLit;");
  // the loop body keeps no braces three's unroller would stop at
  const loop = patched.slice(
    patched.indexOf("DirectionalLight directionalLight;")
  );
  const body = loop.slice(
    loop.indexOf("{") + 1,
    loop.indexOf("#pragma unroll_loop_end")
  );
  expect(body.match(/\{/gu)).toBeNull();
  // point and spot shadows are untouched
  expect(patched).toContain("getPointShadow( pointShadowMap[ i ]");
  expect(patched.length).toBeGreaterThan(
    ShaderChunk.lights_fragment_begin.length
  );
});

test("a chunk without the directional shadow line is refused", () => {
  expect(() => lightsWithFarShadow("void main() {}")).toThrow();
});

test("an absent raster leaves its term at one", () => {
  expect(skyLightBody(false, false)).toContain("float skySvf = 1.0;");
  expect(skyLightBody(false, false)).toContain("float hzLit = 1.0;");
  expect(skyLightDecl(false, false)).toBe("");
  expect(skyLightBody(true, true)).toContain("hzSunVisible( vSplatUv )");
  expect(skyLightDecl(true, true)).toContain("sampler2DArray uHorizon");
});
