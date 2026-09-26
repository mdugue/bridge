import {
  type Box3,
  type Camera,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Scene,
  Vector3,
} from "three/webgpu";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import {
  cameraPosition,
  dot,
  float,
  Fn,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { UniformNode } from "three/webgpu";
import { atmosphereAt } from "@/lib/city/atmosphere";
import {
  fitShadowRadius,
  SHADOW_BASE_RADIUS,
  shadowDeadZone,
  shadowFocusAhead,
} from "@/lib/city/shadow-fit";
import { sunDirectionWorld } from "@/lib/city/sun";
import type { V3, V4 } from "./shader-chunks";

export interface SunState {
  aboveHorizon: boolean;
  altitudeDeg: number;
  /** 0 (full day) → 1 (civil dusk and below): drives the street-lamp ignition */
  nightFactor: number;
}

/** smoothstep ramping 1→0 as x rises from edge0 to edge1 (edges may invert). */
function smoothstepDown(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export interface SunRig {
  /** Frees the shadow map — a render target disposeObject3D never reaches. */
  dispose: () => void;
  /**
   * Re-fits the shadow frustum to the camera (call per frame). `direction` is
   * the camera's world direction (NOT normalized in the horizontal plane — its
   * cos(pitch) factor is what aims the frustum) and `groundY` the terrain
   * elevation under the camera, which is both the frustum's vertical anchor
   * and the altitude the half-size is derived from (lib/city/shadow-fit.ts).
   */
  follow: (position: Vector3, direction: Vector3, groundY: number) => void;
  /** Forces a one-off shadow-map re-render. The map is otherwise only redrawn
   * when the sun or frustum moves (autoUpdate is off), so scene-topology edits
   * (demolish, a tile landing or leaving) must call this or stale shadows linger. */
  invalidateShadow: () => void;
  /** The sun's shadow camera: the tile stream loads what it sees too, so a
   *  building behind the player still casts into the view. */
  shadowCamera: Camera;
  /** GPU bytes of the shadow map (a 32-bit depth texture, no mipmaps). */
  shadowMapBytes: number;
  /** The shadow frustum on the ground, kept current: its centre in the data
   *  frame (x east, y north: world x, −z) and its half-size (z, m). The
   *  terrain reads it by reference (the horizon's near band, sky-light.ts). */
  shadowReach: Vector3;
  /** True when the next render will redraw the shadow map. */
  shadowPending: () => boolean;
  /** Re-aims sun, sky dome, fog and fill light for the given instant. */
  update: (date: Date) => SunState;
}

const SUN_INTENSITY = 2.4;

/** What the rig drives on the sky dome. */
interface SkyDome {
  setHaze: (colour: string) => void;
  setSun: (direction: Vector3) => void;
}

function createSkyDome(scene: Scene): SkyDome {
  const sky = new SkyMesh();
  // Inside the camera far plane (6000) but beyond the fog end.
  sky.scale.setScalar(4500);
  // The dome is a box ±2250 m around its centre, so it has to travel with
  // the camera: anchored at the origin (the spawn tile), a camera on the
  // far tiles (the Blaues Wunder is ~3 km out) stood outside it and saw the
  // bare clear colour where the sky should be. Its colour only reads the
  // direction from the camera, so re-centring changes nothing else. This
  // runs after culling (hence no culling) and before the model-view
  // matrix is taken from `matrixWorld`.
  sky.frustumCulled = false;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.setFromMatrixPosition(camera.matrixWorld);
    sky.updateMatrixWorld();
  };
  // Moderate haze and a small Mie lobe: more of either blows the sky around
  // the sun (and with it half the horizon) out to flat white.
  sky.turbidity.value = 4.5;
  sky.rayleigh.value = 1.6;
  sky.mieCoefficient.value = 0.0025;
  // A tighter forward lobe: the glow stays around the sun instead of
  // whitening a quarter of the sky.
  sky.mieDirectionalG.value = 0.82;
  // SkyMesh's procedural clouds (multi-octave fbm, sun-tinted) drift on TSL
  // `time`. Softened toward pale watercolour washes (not cotton balls), and
  // slow — a barely-moving Dresden sky. Effectively free: the fbm only runs
  // on sky pixels (direction.y > 0).
  sky.cloudCoverage.value = 0.3;
  sky.cloudDensity.value = 0.3;
  sky.cloudSpeed.value = 0.0001;
  // Horizon haze. The physical sky knows no ground: below the horizon it
  // repeats its brightest horizon white, so past the site's last tile the
  // view ended on a hard cut from fogged terrain to near-white. The dome
  // blends into the scene's fog colour instead — fully below the horizon
  // (the "ground" beyond the data is haze), feathered a few degrees above
  // it — so the fogged terrain, the edge haze (height-fog.ts) and the sky
  // meet in one soft band. The colour is fed per update from the palette.
  // The band also covers the low sky where the cloud plane's projection
  // crowds the fbm into one sunlit sheet (SkyMesh's own cloud fade sits
  // inside its colour node, out of reach).
  const haze = uniform(new Color(0xdf_e7_ee));
  // reason: SkyMesh builds its colour node in the constructor.
  const inner = sky.material.colorNode as V4;
  sky.material.colorNode = Fn(() => {
    // Temper the dome first: untouched, its lower third reads as flat paper
    // white and its zenith as a synthetic cyan. A little less radiance and
    // chroma keeps it a pale watercolour wash.
    const raw = inner.rgb;
    const luma = dot(raw, vec3(0.2126, 0.7152, 0.0722));
    const tempered = mix(vec3(luma), raw, 0.8).mul(0.7);
    // Soft shoulder on the bright part (the glow around the sun), by
    // luminance so the hue survives: past the knee it rolls off instead of
    // clipping to white.
    const l = luma.mul(0.7);
    const over = max(l.sub(0.45), 0);
    const shouldered = tempered.mul(
      min(l, 0.45)
        .add(over.div(over.mul(1.5).add(1)))
        .div(max(l, 1e-4))
    );
    const direction = normalize(positionWorld.sub(cameraPosition));
    const band = float(1).sub(smoothstep(-0.03, 0.28, direction.y));
    const hazed: V3 = mix(
      shouldered,
      haze,
      band.mul(band).mul(float(3).sub(band.mul(2)))
    );
    return vec4(hazed, 1);
  })();
  scene.add(sky);
  return {
    setHaze: (colour) => {
      haze.value.set(colour);
    },
    setSun: (d) => sky.sunPosition.value.copy(d),
  };
}

/**
 * Sun + atmosphere rig: directional light with an orthographic shadow camera
 * that follows the camera (see follow()), a physical sky dome fed the same sun direction,
 * and fog/hemisphere colors interpolated from the time-of-day palette so the
 * whole frame stays in tune with the slider. `worldBounds` is in scene
 * (Y-up) coordinates.
 */
export function createSunRig(
  scene: Scene,
  worldBounds: Box3,
  latLng: { lat: number; lng: number },
  /** Shadow-map edge in texels (scene-profile.ts `shadowMapSizeFor`). 3072
   * over the 110 m base frustum ≈ 0.07 m/texel: the soft Vogel-disk PCF (see
   * shadow.radius) hides residual stepping, so 3072 looks like 4096 here
   * while costing ~44% less shadow fill. The `lite` e2e profile passes 512
   * and phones 2048 — under SwiftShader the depth pass is one of the few
   * per-frame costs that does not shrink with the canvas, and no headless
   * assertion depends on edge quality. The map is redrawn when the frustum
   * re-centres or re-fits (follow), when the sun moves, and on explicit
   * invalidation — not per frame. */
  shadowMapSize: number,
  /** Optional shared vector the rig keeps in sync with the world sun direction
   * (surface→sun) so other materials (e.g. the crown shimmer) can read it. */
  sunDirectionOut: Vector3 | undefined,
  /** The scene fog's colour (height-fog.ts): it follows the palette. */
  fogColor: UniformNode<"color", Color>
): SunRig {
  const center = worldBounds.getCenter(new Vector3());
  // The frustum half-size is not fixed: it starts at the base radius (eye
  // level) and grows with altitude so a fly-over still gets sun shadows —
  // lib/city/shadow-fit.ts owns the policy, resizeFrustum below applies it.
  // These three derive from it and are recomputed on every change.
  let radius = SHADOW_BASE_RADIUS;
  // Light sits twice the frustum radius out; tight depth range = good precision.
  let shadowDistance = radius * 2;
  // World size of one shadow texel — snap the frustum centre to this grid so
  // shadow edges don't crawl/shimmer as the camera moves.
  let texelSize = (radius * 2) / shadowMapSize;
  // Metres the frustum centre may drift before the map is re-rendered.
  let deadZone = shadowDeadZone(radius);

  const hemisphere = new HemisphereLight(0xbf_d4_e6, 0x4a_5a_3a, 0.7);
  scene.add(hemisphere);

  const sky = createSkyDome(scene);

  const sun = new DirectionalLight(0xff_f4_e0, SUN_INTENSITY);
  sun.castShadow = true;
  // Re-render the shadow map only when the frustum actually moves or the sun
  // changes (see reposition/update) — not every frame. Huge win with tens of
  // thousands of shadow-casting trees.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const cam = sun.shadow.camera;
  /**
   * Rebuilds the orthographic shadow camera for a new half-size. Everything
   * that scales with the radius lives here, so the rest of the rig only ever
   * reads the four `let`s above. Cheap — a projection matrix, no reallocation:
   * the shadow map itself keeps its size, only the world area it covers
   * changes. The caller forces the re-render (the frustum always moved too).
   */
  const resizeFrustum = (next: number) => {
    radius = next;
    shadowDistance = radius * 2;
    texelSize = (radius * 2) / shadowMapSize;
    deadZone = shadowDeadZone(radius);
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    // Tight depth range around the frustum for good precision.
    cam.near = shadowDistance - radius * 1.2;
    cam.far = shadowDistance + radius * 1.2;
    cam.updateProjectionMatrix();
  };
  resizeFrustum(radius);
  // normalBias = 0 kills the peter-panning contact strip (it would offset the
  // flat ground's shadow sample toward the light at wall bases). Safe at 0
  // because nothing that needs it self-shadows: terrain doesn't cast, and
  // buildings/trees cast via their BACK faces (three's default shadowSide), so
  // their lit front faces never self-acne.
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0;
  // PCFShadowMap is soft: three's ShadowFilterNode (PCFShadowFilter) spreads
  // a 5-tap Vogel disk by radius*texel. Default radius 1 ≈ hard; bump it so
  // edges are a soft penumbra that hides the texel staircase — without VSM's
  // grid.
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);

  // Current sun direction and frustum focus; reposition() places the light and
  // its target from these so update() (time) and follow() (camera) share logic.
  const dir = new Vector3();
  {
    const d = sunDirectionWorld(new Date(0), latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    sunDirectionOut?.copy(dir);
  }
  const focus = center.clone();
  const shadowReach = new Vector3(center.x, -center.z, radius);
  const lastCentre = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  const reposition = () => {
    // Snap the focus to the texel grid to keep shadow edges stable.
    const fx = Math.round(focus.x / texelSize) * texelSize;
    const fy = Math.round(focus.y / texelSize) * texelSize;
    const fz = Math.round(focus.z / texelSize) * texelSize;
    sun.target.position.set(fx, fy, fz);
    shadowReach.set(fx, -fz, radius);
    sun.position.set(
      fx + dir.x * shadowDistance,
      fy + dir.y * shadowDistance,
      fz + dir.z * shadowDistance
    );
    // Manual shadow update only when the snapped frustum centre changed.
    // fy matters too: ascending straight up in fly mode keeps fx/fz fixed
    // while the frustum's vertical slice shifts.
    if (fx !== lastCentre.x || fy !== lastCentre.y || fz !== lastCentre.z) {
      sun.shadow.needsUpdate = true;
      lastCentre.set(fx, fy, fz);
    }
  };

  const follow = (position: Vector3, direction: Vector3, groundY: number) => {
    const nextRadius = fitShadowRadius(position.y - groundY, radius);
    // Push the centre along the view so the shadowed patch sits where the
    // camera is looking. `direction` is deliberately NOT re-normalized in the
    // horizontal plane: its cos(pitch) factor collapses the offset to zero
    // when looking straight down, which is exactly what we want there.
    const ahead = shadowFocusAhead(nextRadius);
    const wantX = position.x + direction.x * ahead;
    const wantZ = position.z + direction.z * ahead;
    // Inside the dead zone, at an unchanged radius, the frustum stays put —
    // nothing to re-render. The centre is anchored to the GROUND, not the
    // camera: airborne, a frustum centred on the camera puts its tight depth
    // range hundreds of metres above the terrain that should be shadowed.
    if (
      nextRadius === radius &&
      Number.isFinite(lastCentre.x) &&
      Math.hypot(
        wantX - lastCentre.x,
        groundY - lastCentre.y,
        wantZ - lastCentre.z
      ) < deadZone
    ) {
      return;
    }
    if (nextRadius !== radius) {
      resizeFrustum(nextRadius);
      // A resized frustum covers different world even from the same centre,
      // and the texel grid it snaps to has changed — always redraw.
      sun.shadow.needsUpdate = true;
    }
    focus.set(wantX, groundY, wantZ);
    reposition();
  };

  const update = (date: Date): SunState => {
    const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    sunDirectionOut?.copy(dir);
    const aboveHorizon = dir.y > 0;
    reposition();
    sun.shadow.needsUpdate = true; // sun moved — force a shadow re-render
    sun.visible = aboveHorizon;
    // Quick ramp after sunrise, flat during the day.
    sun.intensity = SUN_INTENSITY * Math.min(1, Math.max(dir.y, 0) * 5);
    const altitudeDeg =
      (Math.asin(Math.min(Math.max(dir.y, -1), 1)) * 180) / Math.PI;
    // Civil-dusk ignition curve: 0 by day, 1 once the sun is well below.
    const nightFactor = smoothstepDown(2, -6, altitudeDeg);
    // Generous daytime fill, but crushed at night so the warm lamp pools have
    // dark contrast to read against.
    hemisphere.intensity =
      (0.45 + 0.6 * Math.max(dir.y, 0)) * (1 - 0.75 * nightFactor);

    // Sky dome follows the same sun; fog + fill colors follow the palette.
    sky.setSun(dir);
    const palette = atmosphereAt(altitudeDeg);
    fogColor.value.set(palette.fog);
    sky.setHaze(palette.fog);
    if (scene.background instanceof Color) {
      scene.background.set(palette.fog);
    }
    hemisphere.color.set(palette.hemiSky);
    hemisphere.groundColor.set(palette.hemiGround);

    return { altitudeDeg, aboveHorizon, nightFactor };
  };

  const invalidateShadow = () => {
    sun.shadow.needsUpdate = true;
  };

  return {
    update,
    follow,
    invalidateShadow,
    // three only draws the map for a VISIBLE light: below the horizon the
    // flag stays raised (and is consumed at sunrise), so it is not "pending".
    shadowPending: () => sun.visible && sun.shadow.needsUpdate,
    shadowMapBytes: shadowMapSize * shadowMapSize * 4,
    shadowReach,
    shadowCamera: sun.shadow.camera,
    dispose: () => sun.dispose(),
  };
}
