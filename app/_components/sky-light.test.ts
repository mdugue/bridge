import { expect, test } from "bun:test";
import {
  DataArrayTexture,
  DataTexture,
  ShaderChunk,
  ShaderLib,
  Vector3,
} from "three";
import {
  type GroundLight,
  groundLightKey,
  injectGroundLight,
  lightsWithFarShadow,
  skyLightBody,
  skyLightDecl,
} from "./sky-light";

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

test("the near band reads the upper four layers and yields to the frustum", () => {
  const decl = skyLightDecl(false, true);
  expect(decl).toContain("uniform vec3 uShadowReach;");
  // far band: layers 0–3 at 45°, near band: layers 4–7 at 90°
  expect(decl).toContain("hzAngle( uv, k0, 0.0, 45.0 )");
  expect(decl).toContain("hzAngle( uv, k0, 4.0, 90.0 )");
  expect(decl).toContain("smoothstep( r * 0.80, r,");
  // a sun straight overhead has no azimuth: atan(0, 0) is never taken
  const guard = decl.indexOf("length( uSunDir.xz ) < 1e-4");
  expect(guard).toBeGreaterThan(0);
  expect(guard).toBeLessThan(decl.indexOf("atan( uSunDir.x, -uSunDir.z )"));
});

test("the horizon is read at an explicit LOD (it runs after a non-uniform return)", () => {
  const decl = skyLightDecl(false, true);
  expect(decl).toContain("textureLod( uHorizon,");
  expect(decl).not.toMatch(/[^D]texture\( uHorizon/u);
});

function groundLight(parts: { horizon: boolean; svf: boolean }): GroundLight {
  return {
    svf: parts.svf ? new DataTexture() : undefined,
    horizon: parts.horizon ? new DataArrayTexture() : undefined,
    origin: [10, 20],
    size: [1000, 1000],
    skyView: { value: 1 },
    horizonShade: { value: 1 },
    shadowReach: { value: new Vector3() },
    sunDirection: new Vector3(0, 1, 0),
  };
}

function standardShader() {
  return {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
}

test("what stands on the ground takes its far shadow and sky view", () => {
  const light = groundLight({ horizon: true, svf: true });
  const sh = standardShader();
  injectGroundLight(sh, light, true);
  // the rows and the frustum by reference: the sliders and the sun rig
  // reach it
  expect(sh.uniforms.uHorizonShade).toBe(light.horizonShade);
  expect(sh.uniforms.uShadowReach).toBe(light.shadowReach);
  expect(sh.uniforms.uSkyView).toBe(light.skyView);
  expect(sh.vertexShader).toContain("vSplatUv = vec2(");
  expect(sh.fragmentShader).toContain("hzSunVisible( vSplatUv )");
  expect(sh.fragmentShader).toContain("min( getShadow(");
  expect(sh.fragmentShader).toContain("*= mix( 1.0, skySvf, uSkyView )");
  // the terms are defined before anything reads them
  expect(sh.fragmentShader.indexOf("float hzLit")).toBeLessThan(
    sh.fragmentShader.indexOf("directLight.color *= hzLit")
  );
});

test("a wall takes the far shadow without the ground's sky view", () => {
  const light = groundLight({ horizon: true, svf: true });
  const sh = standardShader();
  injectGroundLight(sh, light, false);
  expect(sh.fragmentShader).toContain("hzSunVisible( vSplatUv )");
  expect(sh.fragmentShader).not.toContain("skySvf, uSkyView");
  expect(sh.uniforms.uSvf).toBeUndefined();
  expect(groundLightKey(light, false)).not.toBe(groundLightKey(light, true));
});

test("a tile without the rasters leaves the shader as it was", () => {
  const sh = standardShader();
  injectGroundLight(sh, undefined, true);
  injectGroundLight(sh, groundLight({ horizon: false, svf: false }), true);
  expect(sh.fragmentShader).toBe(ShaderLib.physical.fragmentShader);
  expect(sh.vertexShader).toBe(ShaderLib.physical.vertexShader);
  expect(groundLightKey(undefined, true)).toBe("gl00");
});
