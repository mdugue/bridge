# Aesthetic & Visual Fine-Tuning — Implementation Plan

> Goal: deepen the soft, illustrative **watercolor / contour-map** mood of the
> Dresden city-walker — particles, better water, automated night lighting, and a
> set of cheap polish passes — **without breaking the art direction or the
> fill-rate budget.**

## Guiding constraints (read first)

- **Preserve the watercolor look.** Paper-grain + warm-near/cool-far depth grade
  + vignette + pastel palette. Every new term should be a *wash*, not an edge.
  Techniques that fight this were already rejected (see *Out of scope*).
- **The bottleneck is fill-rate** (post FX + the sun shadow map), **not draw
  calls.** So the cheap path is: drive material features via by-reference
  `{ value }` uniforms (no recompile), add screen effects to the *existing*
  trailing `EffectPass`, and keep all transparent overdraw (motes, mist, glow,
  decals) small, camera-local, and faded out when not needed.
- **Coordinate frame.** Anything authored Y-up (motes, grass ring, lamps,
  clouds) goes on the **Y-up `scene`**, never the −90°-X-rotated **`world`**
  group. Anything reusing the **Z-up terrain geometry** (water, water mist) goes
  on **`world`**. Mixing these double-applies the rotation (the documented
  "trees shoot skyward" trap).
- **Don't churn shaders at runtime.** three bakes the directional/point **light
  count** and `#define`s into each compiled program (verified
  `WebGLProgram.js` → `replaceLightNums`, and the count is in the program cache
  key in `WebGLPrograms.js`). Adding/removing a light or crossing a `#define`
  boundary recompiles **every lit material** — a visible hitch. Keep light slots
  fixed; gate booleans on a uniform float, not a define.

> **Note on line numbers.** The `file:line` pointers below come from a research
> pass over the current tree; treat them as *navigation aids* and re-confirm on
> implementation (they will drift as the code changes).

---

## Prioritized roadmap

| # | Item | Effort | Payoff | Notes / depends on |
|---|------|:---:|--------|--------------------|
| 1 | **Wind sway** on tree crowns | S | Highest life-per-cost; near-free | Vertex sway in crown `onBeforeCompile`; no new data |
| 2 | **Atmospheric motes** (pollen/dust) | S–M | Strong "poetic air" | New `motes-layer.ts`; camera-local additive `Points` |
| 3 | **Better water** (Fresnel sky-tint, sun glitter, soft shoreline) | S | Poetic water, fakes reflection cheaply | Needs sun-dir uniform wired into water |
| 4 | **Drifting clouds** | S | Sky comes alive | *Just advance the Sky dome's existing `time` uniform* |
| 5 | **Golden/blue-hour** palette stops | S | Time-of-day mood | Extend `atmosphere.ts` STOPS — zero shader cost |
| 6 | **Height-term fog** (valley pooling) | M | Aerial depth along the Elbe | Patch fog chunk in *all* fog-receiving materials |
| 7 | **Water mist** | M | River atmosphere | Builds on #3; second masked sheet on `world` |
| 8 | **Grass depth** (terrain shader detail) | M | Meadow stops reading as flat fill | Bind class-id texture; meadow-gated mottle |
| 9 | **Backlit foliage translucency** (shadow-gated) | M | Foliage richness (Phase-1 leftover) | Crown shader; shadow-gate to avoid "noise" |
| 10 | **Dusk/night mode + OSM lamp pipeline** | L | The night payoff | New bake + `lamp-layer.ts`; night mode is a prerequisite |
| — | **Wiring debt:** 4 stranded setters | S | Unblocks #1/#9 HUD control | See *Shared integration contract* |

**Suggested order:** ship #1 → #3 → #4 → #5 (all S, all reinforce the existing
look, no new pipeline), then #2 and the medium polish (#6–#9), then tackle the
large #10 as its own project.

---

## 1. Wind sway on tree crowns

**Rationale.** Crowns are static today; a cheap per-vertex sway adds enormous
life for almost nothing. Single highest payoff-to-cost item.

**Approach.** Inject into the **shared** crown `MeshStandardMaterial`'s existing
`onBeforeCompile` (`buildCrownMaterial`, alongside the current shimmer block) so
it reaches both LOD crowns across every chunk:

- Plumb a by-reference `const uTime = { value: 0 }` exactly like water's `uTime`:
  create it in `loadVegetation`, thread through `buildTrees → buildCrownMaterial`,
  register `sh.uniforms.uTime = uTime`, expose `setTime(s)` on the
  `VegetationControl`, and call `veg.setTime(timer.getElapsed())` in the loop's
  existing `for (const veg of vegControls)` block (same clock as
  `terrain.water?.setTime`). One uniform write/tile/frame.
- Add `uniform float uTime;` to the existing vertex `#include <common>` replace,
  then a **new** replace on `#include <begin_vertex>` that bends `transformed.xz`
  in local crown space (crowns live in the Y-up `scene`, so local Y is already
  up — no rotation to undo):

  ```glsl
  #include <begin_vertex>
  #ifdef USE_INSTANCING
    vec2 iorigin = instanceMatrix[3].xz;          // per-tree world column → phase
    float phase  = dot(iorigin, vec2(0.07, 0.11));
    float bendK  = clamp(transformed.y / 7.0, 0.0, 1.0);
    bendK *= bendK;                               // stiff low, loose high
    float sway = sin(uTime*1.1 + phase) + 0.5*sin(uTime*2.3 + phase*1.7);
    transformed.x += sway * bendK * 0.18;
    transformed.z += 0.6 * sin(uTime*0.9 + phase + 1.7) * bendK * 0.18;
  #endif
  ```

  `instanceMatrix[3].xz` gives a **free, stable per-tree phase** — no new
  attribute, no buffer upload. `transformed` is local space in `begin_vertex`
  (instance/model matrices apply later), which is exactly what we want.

**Integration points.** `vegetation-layer.ts` `buildCrownMaterial(...)` (the
shared crown material), `loadVegetation` (create/thread `uTime`),
`VegetationControl` interface + return (`setTime`), `create-app.ts` render loop
(the `vegControls` iteration, next to `terrain.water?.setTime`).

**Gotchas (verified).**
- **Shadows won't track the sway.** Crowns cast shadows *and* the sun rig runs
  `shadow.autoUpdate = false` (re-render only on frustum/sun move). The
  vertex sway is in the *main* material, not the auto depth material, and the
  shadow map is stale between moves — so the cast shadow stays rigid while the
  crown sways. **Recommendation: accept the desync** (invisible at this
  stylization/scale). Do **not** force `shadow.needsUpdate` per frame to fix it —
  that re-renders the 3072² map over tens of thousands of trees every frame and
  destroys the whole `autoUpdate=false` win. (Matching the shadow would require
  duplicating the sway in a `customDepthMaterial` *and* per-frame shadow
  re-renders — not worth it.)
- **Phase must come from instance position**, or every tree sways in lockstep
  ("earthquake, not wind"). Guard `instanceMatrix` reads with `#ifdef
  USE_INSTANCING` (consistent with the shimmer block).
- Keep amplitude small (~0.1–0.2 local units) and rooted at the crown base
  (`bendK→0` near the trunk top) — trunks are a separate, non-swaying mesh, so
  too much sway visibly detaches crown from trunk.

**Performance.** Zero new triangles/draw calls/attributes; a few ALU ops + 2
`sin()` per crown vertex. Negligible.

**Verification.** Sway is temporal — a still can't show it. Capture the **same
pose at two `uTime`s** and diff crown silhouettes; confirm neighbours are
out-of-phase and crowns stay seated on trunks. Best from an **oblique, near-
ground** angle across a tree row with a side-on sun. Confirm `renderer.info`
(via `__poc.getRenderInfo`, post disabled) shows **no** triangle/draw increase.

---

## 2. Atmospheric motes (pollen / dust in sunlight)

**Rationale.** Sparse drifting motes are the most "poetic" particle effect and,
done camera-local, stay cheap regardless of map size.

**Approach.** New `app/_components/motes-layer.ts`: one `THREE.Points` of
~2000–4000 vertices on the **Y-up `scene`**, kept centered on the camera via a
**toroidal wrap** so the same fixed buffer perpetually surrounds the player
(count independent of map size). Verified specifics for three r184:

- `PointsMaterial`: `map: softRadialSprite` (a 64² `CanvasTexture` radial-alpha
  disc — soft & round, on-aesthetic), `size ~2` (world m), `sizeAttenuation:
  true`, `transparent: true`, `blending: AdditiveBlending`, `depthWrite: false`,
  `depthTest: true`, `opacity ~0.16`, `toneMapped: false`, `color '#fff2d8'`
  (warm pale), and **`fog: false`** (critical — see gotcha).
- Mount: `scene.add(motes.points)`; set `points.frustumCulled = false` (camera-
  centred, always on-screen). Seed positions with the deterministic `hash()` so
  snapshots reproduce. Advance in the loop after `sunRig.follow(camera.position)`
  with `motes.update(dt, camera.position)` (`dt` already clamped to 0.05):
  per-mote `pos += vel*dt` + a sine bob, then wrap on the **camera-relative**
  offset into `[-R, R)` (R ≈ 30 m), then one `position.needsUpdate = true`.
- Intensity toggle `setMotes(0..1)` → drives **both** `opacity` *and*
  `geometry.setDrawRange` (so lowering it actually buys back fill-rate), with
  `visible=false` at ~0.

**Integration points.** `create-app.ts` (create after sun rig + `scene.add`;
`motes.update` in the loop; `setMotes` on the handle; `motes.dispose()` in
dispose — **must dispose `material.map` too**, `disposeObject3D` won't),
`poc-debug.ts` (`setMotes?`), `city-walk.tsx` (HUD slider + `look.motesPct`
round-trip), `vegetation-layer.ts` `hash()` (reuse for seeding).

**Gotchas (verified against `three@0.184.0` source).**
- **`fog: true` (the default) is actively wrong for additive points** —
  `fog_fragment` mixes toward the pastel `fogColor`, so distant motes get
  *brighter*, the opposite of atmosphere. Set `fog: false` and fade with your
  own distance-alpha near the wrap boundary (which also hides edge pops).
- **`depthWrite: false`** ⇒ motes write no depth, so **N8AO does not darken
  them** and **DoF does not blur them as geometry** (they composite sharp over
  the possibly-blurred backdrop — desired for crisp dust). `depthTest: true`
  still hides them behind buildings. The HalfFloat composer means additive
  overlap builds smooth glow before tone-map.
- Wrap on the **camera-relative** offset (not absolute), or motes stream off to
  one side. Mount on `scene`, not `world`.
- Additive barely shows over the bright sky — motes pop against shadowed
  facades and dark foliage (the intended "sunbeam dust"). Don't crank opacity to
  compensate. Consider gating opacity by sun altitude.

**Performance.** One extra draw call, zero triangles, zero shadow-pass cost. The
JS wrap loop is sub-0.1 ms at a few thousand points (move to a vertex shader
only if you ever exceed ~8k). Keep `size` small and count ≤4k.

**Verification.** Snapshot from (a) a shadowed street with a low sun behind
buildings and (b) an oblique near-ground angle. Confirm soft round sprites,
correct occlusion behind buildings, fog-free fade, **no** AO halos or DoF rings,
and that `setMotes(0)` fully removes them. `getRenderInfo` shows only +1 draw.

---

## 3. Better water — Fresnel sky-tint, sun glitter, soft shoreline

**Rationale.** Water is a flat tinted sheet today. A faked reflection + glitter
reads as poetic water at standard-material cost (no `transmission`).

**Approach.** All three land in the existing `water-layer.ts` `onBeforeCompile`:

- Add uniforms `uSunDir` (the **shared `Vector3` that already exists** in
  `create-app.ts` and is mutated by the sun rig — pass it by reference, zero
  per-frame cost), `uSkyTint` (a `Color`), `uSunColor` (seed from the sun
  light's `0xfff4e0`), and scalar strengths. `cameraPosition` is a **built-in**
  three uniform — no wiring needed.
- Capture a world-space varying `vWaterWP` at `<worldpos_vertex>` (already
  compiled because `receiveShadow=true` defines `USE_SHADOWMAP`).
- **Fresnel sky-tint** at `<map_fragment>` (append to the existing wcov block):
  mix `diffuseColor.rgb` toward `uSkyTint` by a view-angle Fresnel — fakes the
  sky reflection.
- **Sun glitter** additive at `<emissivemap_fragment>`: a `pow(NdotH, ~120)`
  specular lobe built from a **Y-up** ripple normal (not the data-frame ripple),
  gated by `clamp(uSunDir.y, 0, 1)` so it vanishes at night.
- **Soft shoreline**: widen the `smoothstep(0.35,0.65,…)` water-coverage band and
  feather `diffuseColor.a` so the bank dissolves instead of stair-stepping.
- Feed `uSkyTint` per frame by reusing `scene.fog.color` (already set from
  `atmosphereAt()` each `sunRig.update`) — extend the existing
  `terrain.water?.setTime(...)` call to `terrain.water?.update(elapsed,
  (scene.fog as Fog).color)`. Keeps water in lockstep with the palette for free.

**Integration points.** `water-layer.ts` `onBeforeCompile` + widened
`createWaterLayer` signature (accept `sunDirection`, add `update/setSky`),
`terrain-layer.ts` (thread `sunDirection` into `createWaterLayer`),
`create-app.ts` (the shared `sunDirection` Vector3; the per-frame water tick),
`vegetation-layer.ts` `buildCrownMaterial` (the reference implementation of this
exact uSunDir + worldpos-varying + additive-emissive pattern).

**Gotchas (verified).**
- **Frame mixing.** Terrain/water geometry is Z-up data frame; the sine ripple
  perturbs `normal.z` (data-up) correctly, **but Fresnel/glitter need world
  (Y-up) vectors** — derive them from `vWaterWP` (modelMatrix bakes the −90°
  rotation → Y-up) and `cameraPosition`. Build a *separate* Y-up ripple normal
  for the glitter half-vector; don't feed the data-frame normal into it.
- **N8AO on water.** Water is `transparent:true` + default `depthWrite:true`, so
  N8AO can smear a grey AO smudge along shorelines/under bridges. If it reads
  badly, flag it out of N8AO (`cannotReceiveAO`/treat-as-opaque) rather than
  dropping `depthWrite` (which would also drop water from DoF depth).
- **`onBeforeCompile` chunk reuse.** The existing code already replaces
  `<map_fragment>`, `<common>`, `<normal_fragment_begin>` — **append** to those
  same replacement strings; a second `.replace` of an already-substituted chunk
  silently no-ops.
- Additive glitter competes with ACES tone-map — expect to push the multiplier
  higher than feels right in linear space (same note as the clay rim).

**Performance.** Zero draw calls/triangles; a handful of fragment ALU ops over
*wet pixels only* (everything else `discard`s at the mask). Negligible. **Do not**
promote water to `MeshPhysicalMaterial` reflections/transmission — that 2×'s the
scene like the ghost style.

**Verification.** Snapshot low & oblique over the Elbe (primary tile has the
river). Fresnel/glitter only show at grazing angles — don't validate top-down.
Sweep the sun-time slider to confirm glitter fades with `clamp(sunDir.y)` and the
shoreline dissolves with no hard stair-step.

---

## 4. Drifting clouds

**Rationale.** The sky is cloudless and static. Biggest finding: the
`three/examples/jsm/objects/Sky.js` dome in r184 **already ships a complete
procedural drifting-cloud system** (multi-octave fbm, `cloudCoverage`,
`cloudDensity`, `cloudSpeed`, `cloudElevation`, sun-tinted) — but nothing ever
advances its `time` uniform, so today's clouds are frozen.

**Approach.** **Just drive the existing `time` uniform** and tune for watercolor
softness — zero new geometry, zero new pass, zero extra fill-rate:
- In `createSkyDome`, set softer defaults: `cloudDensity ~0.25–0.35`,
  `cloudCoverage ~0.3` (pale washes, not cotton balls), modest `cloudSpeed
  ~0.0003–0.0006` (a Dresden breeze).
- Expose `setTime(seconds)` on the sun rig → `sky.material.uniforms.time.value =
  seconds`; call it once per frame next to `terrain.water?.setTime(...)`.
- Optional HUD slider for coverage later.

**Integration points.** `sun-rig.ts` `createSkyDome` (tune defaults, expose the
material) + `SunRig` interface (`setTime`), `create-app.ts` render loop (one
sibling line to the water tick).

**Gotchas (verified).** The dome is **not fogged** and renders at the far plane,
tinted only by its own sun math — so keep the palette `fog.color` and dome
turbidity in rough agreement at low sun or a color step appears at the horizon.
Cloud color runs *before* tone-mapping and can punch through; tune via
`cloudDensity` first. **Do not** add cloud shadows (would force per-frame shadow
re-renders). Confirm whether clouds are already faintly visible at current
defaults before tuning, so you don't over-correct.

**Performance.** Effectively free — the fbm branch only runs where
`direction.y > 0` (sky pixels), and animating `time` is one uniform write/frame.

**Verification.** Snapshot tilted up; capture two frames seconds apart to confirm
drift. Verify clouds sit behind buildings, fade at the horizon, and warm at
golden hour.

---

## 5. Golden-hour / blue-hour grading

**Rationale.** Enrich the *temporal* mood to complement (not fight) the spatial
warm-near/cool-far `DepthGradingEffect`.

**Approach (primary, zero shader cost).** Extend the `atmosphere.ts` `STOPS`
palette: add a **golden** stop (~+3–8° altitude) pushing `fog` toward warm peach
and `hemiSky` warmer, and a **blue-hour** stop (~−8 to −2°) of cool indigo.
Because `scene.fog.color`, `scene.background`, and the hemisphere already follow
the palette — and the dome physically reddens at low sun — this tints the whole
frame for free.

**Optional second term.** A single depth-**independent** global `uWarmth`/`uTint`
multiply on `DepthGradingEffect` (or a tiny sibling) driven from `altitudeDeg`.
Must stay low-amplitude and global — a depth-aware temporal tint would
double-count the aerial-perspective cue the depth grade already applies.

**Integration points.** `lib/city/atmosphere.ts` `STOPS` / `atmosphereAt`;
optionally `depth-grading-effect.ts` + `post-stack.ts` (a global tint uniform +
passthrough setter driven from sun altitude).

**Gotchas.** STOPS are linear-RGB lerped — place a saturated golden stop close
enough in altitude to its neighbours that interpolation doesn't wash it muddy.
Keep everything a wash.

**Verification.** One fixed pose at several sun times (blue ~−6°, golden ~+5°,
midday ~+55°); confirm a warm→neutral→cool arc that still leaves the near-warm/
far-cool depth grade intact at every time.

---

## 6. Height-term fog (valley pooling)

**Rationale.** Built-in `Fog`/`FogExp2` is purely distance-based. A height term
lets the Elbe valley pool with deeper haze — very on-aesthetic aerial depth.

**Approach.** A shared `addHeightFog(material)` helper applied in each
fog-receiving material's existing `onBeforeCompile`:
- Inject `varying float vWorldY;` written from `(modelMatrix * vec4(transformed,
  1.0)).y` in `begin_vertex` (true world-Y — works across the Y-up scene and the
  rotated world group). Clay already computes exactly this `vClayWP`.
- Add by-reference uniforms `uFogHeightStart`, `uFogHeightFalloff`,
  `uFogHeightStrength`.
- **Replace `#include <fog_fragment>`**, building **on** the existing distance
  `fogFactor` (never replacing it): `heightMask = 1.0 -
  smoothstep(uFogHeightStart, uFogHeightStart+uFogHeightFalloff, vWorldY);
  fogFactor = min(fogFactor + uFogHeightStrength*heightMask*(1.0-fogFactor),
  1.0);` — additive-toward-fogColor only, so far high ground still hazes
  normally and only low+near surfaces pool. Seed `uFogHeightStart` from the
  Elbe/DGM min captured at boot.

**Integration points.** New `addHeightFog()` applied at **every** fog-receiving
material: `terrain-layer.ts`, `water-layer.ts`, all three vegetation materials
(crown/trunk/hedge), and clay/ghost in `visual-style.ts`. Reuses the
`uFogHeightStart`-style by-reference pattern of `clayDetail`.

**Gotchas (verified).** **Apply to all of them or you get a seam** — if terrain
pools but the water sheet doesn't, the river floats out of the haze. Patching
`<fog_fragment>` is version-brittle (pin a comment; the replace silently
no-ops if three changes the chunk). Use true world-Y, not `position.y`/local Z.
The Sky dome is unfogged, so clouds won't pick this up (fine). `clay`/`ghost` are
`userData.shared` and may already be compiled — set `material.needsUpdate=true`
once after wiring new uniforms.

**Performance.** One varying + a few ALU ops per opaque fragment; no draw calls,
no overdraw. Negligible.

**Verification.** Oblique shot along the Elbe valley; confirm the valley floor
reads hazier than bridge decks/high ground at equal distance, the effect is
additive (distant high ground still hazes), and water + terrain + tree bases pool
together with no floating-water seam. Decide whether it's always-on or gated to
low sun (a product call).

---

## 7. Water mist

**Rationale.** Drifting river haze; pairs with #3. Done as a masked sheet, not
particles (thousands of particles over the river is the wrong tool).

**Approach.** A second flat sheet **sharing the Z-up terrain geometry** (so it
drapes on the heightfield), masked to the water class like the water sheet, with
a scrolling-noise / soft fbm (≤3 octaves) "steam" band and low peak alpha. Add it
to the **`world`** group (it reuses Z-up geometry — *not* the Y-up scene). Tint
from the same palette `fog.color` as #3.

**Integration points.** `water-layer.ts` (a `createWaterMist` factory or a
`mistMesh` on `WaterLayer` reusing the shared geometry — do **not** dispose that
geometry), `create-app.ts` (`world.add(t.water.mistMesh)`), the same per-frame
`update(elapsed, skyColor)` tick.

**Gotchas (verified).** Set mist **`depthWrite: false`** (and `transparent:true`)
or it punches near-camera depth into the composer's shared depth texture and DoF
focuses on the haze / the depth grade treats it as a near surface. Mask-gate to
water pixels only. This is a plain alpha sheet — it does **not** trigger the
`transmission` full-scene re-render. Keep it a **single** sheet; don't stack.

**Performance.** +1 draw call/tile (frustum-culled), bounded to river pixels by
the mask discard. fbm at ≤3 octaves is the dominant term.

**Verification.** Oblique low angle over the river at dawn; confirm wisps drift
(two frames or a seeded `uTime` offset since the harness renders one frame), mist
does **not** appear over roads/meadow, and DoF doesn't snap onto the haze.

---

## 8. Grass depth (terrain shader detail — *not* a tuft ring)

**Rationale.** Flat meadow reads as a dead pastel fill. Add painterly depth in
the **already-running terrain fragment pass** — zero geometry.

**Approach (recommended: shader detail).** In `createTerrainMaterial`, between
the base diffuse and the contour-ink composite, add a **meadow-gated** value
mottle + slight normal perturbation:
- **Detect meadow (class 1).** The RGB color path doesn't currently read the
  class id. Bind the **class-id texture** (`splat.texture`, already loaded on
  `SplatLayer` — no new fetch) as a second sampler `uSplatClass` and test
  `floor(tex.r*255.0+0.5) == 1.0`. (Approximating by RGB color-distance is
  fragile against forest/copse/farmland greens — bind the class raster.)
- Add `varying vec2 vWorldXY = position.xy` (terrain is Z-up data frame, so
  `position.xy` is the world horizontal — the water layer already relies on
  this). On the meadow mask: a few octaves of cheap hash/`sin` noise → ±~6%
  diffuse mottle, and optionally perturb the shading normal (like water's
  `<normal_fragment_begin>`) so the sun grazes faint texture — this is what
  sells "depth" at oblique angles. **Distance-fade** the detail (via
  `fwidth`/distance, mirroring the contour machinery) so it never aliases far.

**Integration points.** `terrain-layer.ts` `createTerrainMaterial` (base-diffuse
expr + contour composite; new `uSplatClass` sampler + `vWorldXY` varying),
`SplatLayer` (already carries both `texture` and `colorTexture`).

**Gotchas (verified).** Must distance-fade or the mottle/normal perturbation
shimmers in the far field — the exact failure mode that got plain foliage
translucency rejected as "noise." A literal **camera-follow tuft ring is the
costly path** and is *not* recommended as the primary solution: tens of thousands
of new shadow-casting instanced triangles into both passes + per-frame matrix
rewrites + `computeBoundingSphere` on every recenter, straight onto the fill-rate
budget — and up close it risks reading as confetti against the soft look. If ever
wanted, keep it a small-radius near-only flourish with `castShadow=false`, sharing
the wind `uTime`; ship shader-detail first. (Also note: a near grass ring isn't
in the DoF autofocus raycast set, so focus could reach past it to terrain.)

**Performance.** Zero draw calls/triangles/shadow cost — ~2 texture taps + a few
ops per meadow fragment, distance-faded so far fragments early-out.

**Verification.** Grazing camera over a meadow patch with a low side-on sun
(invisible head-on/top-down). Confirm detail is meadow-only (roads/water/forest
untouched) and fades with distance; `renderer.info` shows no triangle increase.

---

## 9. Backlit foliage translucency (shadow-gated) — Phase-1 leftover

**Rationale.** The recorded art direction adopts this **only if shadow-gated**
(plain translucency was rejected as "noise"). Adds richness to near/large trees
when backlit.

**Approach.** In the crown material, add a translucency term sampled ~2 m toward
the sun and **gated by the shadow** (so building occluders kill the glow but the
crown's own self-shadow doesn't), limited to near/large trees. The crown shader
already samples `directionalLightShadows[0]` / guards on `NUM_DIR_LIGHT_SHADOWS >
0` — reuse that machinery.

**Integration points.** `vegetation-layer.ts` `buildCrownMaterial` (extend the
existing shimmer/shadow block). Shares the by-reference uniform contract.

**Gotchas (verified).** The crown shimmer **hard-codes `directionalLightShadows[0]`
and `NUM_DIR_LIGHT_SHADOWS > 0`**. If a second shadow-casting light is ever added
(e.g. a shadow-casting lamp), the `[0]` index and the count guard silently change
behavior — **keep lamps non-shadow-casting** (the lamp design already does). Gate
the glow on `clamp(sunDir.y,0,1)` and limit to near/large instances to keep it
from reading as noise.

**Performance.** A few fragment ops on crowns only. Bounded.

**Verification.** Oblique shot with the sun behind a tree row; confirm glow
appears only on backlit, unoccluded crowns and dies behind buildings.

---

## 10. Dusk/night mode + automated OSM street-lamp lighting (the large one)

**Rationale.** Night currently goes flat-dark (`sun.visible=false`, hemisphere
floor). Lamps only "pay off" once a dusk/night mode exists. This is really a
"build a night mode" project with lamps as the centerpiece. **Mostly-fake** is
the only viable lighting design in WebGL forward rendering.

### 10a. Data source & bake — OSM `highway=street_lamp`

**Confirmed:** neither ATKIS Basis-DLM nor ALKIS models street furniture —
**geodaten.sachsen.de has no lamp layer.** OSM is the right source: `highway=
street_lamp` is ~6.18M nodes globally, **6,169 in Dresden** (measured
2026-06-15), licensed **ODbL** (attribution + share-alike on the derived file).

New `scripts/extract-lamps.sh`, mirroring `extract-canopy.sh`, writing a tiny
committed per-tile `data/dlm/lamps_<tile>.geojson` (Points in **EPSG:25833**,
each with an `"h"` height like canopy):

1. **Fetch** lamp nodes via Overpass into a gitignored
   `data/_raw/osm/…` cache (hit the API **once**, never at runtime). Project
   bbox in WGS84 (reprojected from UTM33 E 410000–416000 / N 5656000–5660000):

   ```
   # run once to size the InstancedMesh buffer:
   [out:json][timeout:120];
   node["highway"="street_lamp"](51.0485,13.7160,51.0853,13.8007);
   out count;

   # the bake fetch (id + lat/lon only — smallest payload):
   [out:json][timeout:180];
   node["highway"="street_lamp"](51.0485,13.7160,51.0853,13.8007);
   out skel qt;
   ```
2. **Reproject** WGS84 → EPSG:25833 (`ogr2ogr -s_srs EPSG:4326 -t_srs
   EPSG:25833`, already in the pipeline).
3. **Gate against the class raster** (reuse the `extract-canopy.sh` Pillow
   helper) — *inverted* vs trees: keep lamps on road/path/built-up, drop clear
   water hits. Default to *keep* (OSM lamps are well-placed).
4. **Height:** OSM rarely tags it — default `h = 5.0` m, override from a tag if
   present.
5. **Always write a file**, even an empty `FeatureCollection` (a tile may have
   zero lamps, and `prepare-data.ts` exits(1) on a missing source).

Wire through `prepare-data.ts` copies, `city-walk-client.tsx` `tile()`
(`lampsSrc`), `TileSrc`/`CityWalkOptions`. Add **"Lamp positions ©
OpenStreetMap contributors (ODbL)"** to the HUD/about.

### 10b. Rendering — new `lamp-layer.ts` (mirrors `vegetation-layer.ts`)

`loadLamps(url, ctx)` → `{ group, updateNearest(camPos), setNightFactor(t) }`,
reusing `VegetationContext` `{offset, heightAt, signal}` and the EPSG→world drop
(`heightAt`, skip `null`). **Add the group to the Y-up `scene`.** Four sublayers
(chunk into 250 m cells only if a tile has hundreds — confirm via the count
query):

- **Posts** — instanced tapered cylinder + lantern box, `MeshStandardMaterial`,
  `castShadow/receiveShadow`. Normal lit geometry, ~12 tris each.
- **Lantern heads** — separate small instanced **emissive** mesh;
  `emissiveIntensity` driven 0 (day) → warm amber (`#ffd089`) at night. Emissive
  costs nothing in the light loop.
- **Glow sprites** — additive radial quad at each head: `AdditiveBlending`,
  `transparent`, `depthWrite:false`, **`toneMapped:false`** (or ACES greys the
  halo), radius capped ~3–4 m.
- **Ground light-pool decals** — additive `CircleGeometry` disc (~6–8 m) laid
  flat at `y = ground + 0.05` with `polygonOffset`, `depthWrite:false`,
  `toneMapped:false`. The "pool on the pavement" that sells night.
- **Fixed pool of `MAX_REAL_LAMPS = 3` real `PointLight`s** — allocated **once**
  at construction, `castShadow=false`, added to the scene up front so the shader
  compiles for `NUM_POINT_LIGHTS=3` a **single time**. Each frame
  `updateNearest(camPos)` repositions them to the nearest 3 lamp heads and sets
  `intensity = nightFactor * BASE * falloff` (crossfade to hide the pop). **Never
  add/remove** — at midday set `intensity=0`, don't remove.

Optionally tie it together with **`SelectiveBloomEffect`** (postprocessing 6.39.1)
over the emissive heads only (`effect.selection.set(headMeshes)`) — *its own
`EffectPass`*, not merged into the SMAA/grading pass. Defer if the additive
sprites already read as glow.

One scalar `nightFactor ∈ [0,1]` from the sun rig drives emissive intensity,
sprite/decal opacity, and real-light intensity — inert grey posts by day, ignited
at dusk.

### 10c. Dusk/night mode — `sun-rig.ts` + `atmosphere.ts`

Night already darkens correctly (`sun.visible=false`, deep-night palette stops).
What's missing:
- Add `nightFactor` to `SunState`, e.g. `smoothstep(2, -6, altitudeDeg)` (civil
  dusk). Return it; have `setSun` fan it out to `lampControls.setNightFactor(...)`
  (mirror the `vegControls` iteration).
- Lower/cool the hemisphere floor at true night (toward ~0.12, cool tint) so the
  warm lamp pools have contrast to read against. Optionally cool `hemiGround` at
  the night palette stops.
- The time slider already spans 0–24 h and reports altitude, so dusk is already
  reachable — this work makes that range *worth looking at*.

**Integration points.** `scripts/extract-lamps.sh` (clone `extract-canopy.sh` +
the `extract-dlm.sh` ogr2ogr export), `prepare-data.ts`, `city-walk-client.tsx`,
`create-app.ts` (`loadLamps` in `loadTileScene`, a `lampControls[]` array,
`lamp.updateNearest(camera.position)` in the loop, `setNightFactor` fan-out in
`setSun`), `sun-rig.ts` (`nightFactor` in `SunState`), `atmosphere.ts` (cool
night `hemiGround`), new `app/_components/lamp-layer.ts`.

**Gotchas (verified).** Lamps on the **Y-up scene**. Allocate PointLights **once**
(count change = full recompile; verified in `WebGLProgram.js`/`WebGLPrograms.js`).
**No shadow-casting lamps** (cubemap render + a sampler slot from the ~16-unit
budget). **`toneMapped:false`** on glow/pool or ACES greys them. Additive
sprites/decals are fill-rate — cap radius, `depthWrite:false`, fade to 0 by day.
Ground decals need `y+0.05` + `polygonOffset` against z-fighting on slopes. If
chunked, `instanceMatrix.needsUpdate=true` + `computeBoundingSphere()`. Empty-tile
bake must still write a file. Overpass is a rate-limited live call — cache the raw
response. **Night mode is a prerequisite**, not a nice-to-have.

**Performance.** Posts/heads ~a few thousand tris total + ~4 draw calls/tile —
trivial. Real cost is additive glow/pool fill-rate (cap radius, fade by day). The
3 real lights add a **fixed, bounded** `NUM_POINT_LIGHTS=3` per-fragment cost,
constant because the count never changes. The fake approach keeps cost flat
regardless of lamp count, where N real lights scale per-fragment + shadow cost +
recompiles linearly with N.

**Verification.** Snapshot with a **dusk/night `date`** (altitude < −2°) at
street eye-height looking down a road obliquely. Confirm: warm glowing heads,
warm (not grey-crushed) halos, ground pools flat on a *sloped* street without
z-fighting, the nearest 1–3 lamps casting real moving light on adjacent facades
while distant ones stay flat fakes, and **by day** the lamps are inert grey posts
with no overdraw. Walk two snapshots apart to confirm the PointLight handoff has
no recompile hitch.

---

## Shared integration contract (every new effect follows this)

The codebase has a clean three-tier contract; a feature is only fully wired **and
self-verifiable** when it reaches all three tiers.

1. **The live uniform / object.** Post effect → subclass `postprocessing`'s
   `Effect` with a `uniforms` map and a clamping `setX(v)`, and **add it to the
   existing trailing `EffectPass`** (SMAA+grading+vignette+grain — one fullscreen
   pass, so a uniform-only effect there is ~free). In-scene material feature →
   drive via an `onBeforeCompile` **by-reference `{ value }` uniform** (water's
   `uTime`, crown's `shimmer`, clay's `uAO/uRim`); mutating `.value` retunes with
   **no recompile**. Add a `DEFAULT_X` export.
2. **The handle setter** on `CityWalkHandle` in `create-app.ts` (+ its returned
   impl). Post setters delegate to `postStack`; scene-feature setters fan out
   over a controls array like `vegControls`.
3. **HUD slider + QA hook + snapshot round-trip.** Copy the paper-grain slider
   block (`Slider`/`Switch`/`ToggleGroup`); the handler does **both** React
   `setX` (drives label + snapshot) **and** `handleRef.current?.setX(next/100)`.
   Then register the setter in `updatePocDebug({...})`, mirror it on
   `PocDebugInfo`, and add the value to the `Snapshot.look` interface **in both
   `city-walk.tsx` and the duplicated copy in `snapshot-shot.spec.ts`**, written
   in `copySnapshot`, read in `applyLook`, **and applied in the harness
   `page.evaluate`** — all sites must agree or the look won't round-trip.

Advance any `uTime` with **one line** in the single `renderer.setAnimationLoop`
(the clock is `timer.getElapsed()` / capped `dt`); no allocations in the loop.

**Known wiring debt (verified):** four setters — `setTreeShimmer`,
`setTreeMultiTuft`, `setBuildingRim`, `setBuildingGroundShade` — exist on the
handle but are **not** in `updatePocDebug`, `PocDebugInfo`, any HUD control, or
the snapshot. They can't be driven by the harness or saved in a shot. Wiring them
through tier 3 first is a cheap worked example of this contract and makes the wind
sway (#1) and foliage translucency (#9) HUD controls nearly free to land.

**Self-verify on a real GPU.** Frame from an **oblique** angle (a tree through a
bridge / misplaced layer is invisible head-on), drop a snapshot JSON in `shots/`,
run `bunx playwright test e2e/snapshot-shot.spec.ts --headed` (**must** be
`--headed` — headless SwiftShader renders shadows/AA/blending/transmission
nothing like a real GPU), read the PNG, iterate. For temporal effects (sway,
motes, water, clouds, mist) capture two frames at different `uTime`s. For
night/lamp features set the snapshot `date` below the horizon. Read
`renderer.info` via `__poc.getRenderInfo` **with post disabled** to confirm
draw/triangle counts (the post composer's `getRenderInfo` reports only the last
pass). Also run `bun typecheck` + `bun lint` (ultracite's complexity cap — keep
GLSL in clearly-scoped string blocks, extract helpers).

---

## Out of scope / explicitly rejected (don't re-propose)

- **Literal window grids** on buildings — reads as a modern office, fights the
  historic LoD silhouette (user-vetoed; faint storey-banding is the only remnant).
- **Sobel / deferred outlines** — clashes with the watercolor look.
- **Quad leaf-billboarding** — no payoff; this is why grass depth (#8) is a
  terrain-shader effect, not billboards.
- **Plain (non-shadow-gated) foliage translucency** — reads as "noise"; only the
  shadow-gated form (#9) is acceptable.
- **`MeshPhysicalMaterial` transmission/reflection for water** — 2×'s the scene
  like the ghost style; Fresnel (#3) fakes it at standard cost.
- **Cloud shadows / per-frame shadow updates for sway** — would force shadow
  re-renders every frame and blow the tens-of-thousands-of-trees budget.
- **A grass-tuft ring as the primary grass solution** — costly path; #8 uses
  shader detail instead.

**Known larger future moves (deliberately deferred):**
- **Cascaded Shadow Maps** — the only real fix for very long shadows clipping
  beyond the frustum at low sun.
- **WebGPURenderer + TSL** — three's strategic direction and where advanced soft
  shadows + cheap many-lights live, but our post stack is WebGL; revisit only if
  we hit WebGL ceilings (a renderer migration, not a feature).
- **Clustered/deferred (Forward+)** for hundreds of *real* lights — incompatible
  with the forward post stack; the fixed-pool + fakes design (#10) gets the look
  without it.
