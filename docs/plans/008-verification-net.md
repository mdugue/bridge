# Plan 008 — Make the verification net catch what it exists to catch

- **Status:** PARTIAL — steps 1–4 and 8 done (2026-09-21); step 5's CI
  scope done (2026-09-24); its coverage artifact and step 6 (rest) open.
  Step 7 is moot since the WebGPU/TSL port (plan 020, 2026-09-26: no
  `onBeforeCompile` patch is left to pin)
- **Priority / effort of the remainder:** P2 / S
- **Written:** 2026-09-20 against `2079c3a`; condensed 2026-09-22 (the
  original step text is in git history at `761d609`)

## Why

The headless e2e could pass with nothing rendered: a missing WebGL
*skipped* every render test, the "renders" test asserted a flag set
unconditionally at boot, no test checked vegetation, lamps, rail, walls or
water (every loader swallows failures into an empty group), demolish was
judged on the filtered document rather than the mesh, no test read
`data/**`, the `onBeforeCompile` shader patches string-`replace` chunk
names that nothing pins, and the CI e2e gate ignored `scripts/`, `data/`
and `patches/`.

## Done

- On CI (`process.env.CI`) a missing WebGL **fails**; locally it still
  skips. `afterAll` checks for page errors.
- **Scene census** (`app/_components/scene-census.ts`): per layer, meshes,
  instances of the instanced sets and triangles × instances, exposed on
  `__poc.stats.layerStats`; the e2e asserts every layer under the lite
  profile (`vegetation.instances > 1000`, `lamps.instances > 100`,
  `terrain.meshes === 1`, water ≥ 1, city/rail/walls triangles > 0) and
  that demolish shrinks `city.triangles`. Both crown LOD meshes are counted.
- Failure artifacts: `screenshot: only-on-failure`,
  `trace: retain-on-failure`.
- The `--headed` snapshot harness is opt-in (`SHOTS=1` / `bun run shots`,
  `testIgnore` otherwise) so a default run can never overwrite real-GPU
  plates.
- `lib/city/purity.test.ts` guards that `lib/city` imports neither `three`
  nor the DOM (tests may use `node:fs`; modules may not).
- Data contracts live in `lib/city/features.ts`; `features.test.ts` checks
  every committed GeoJSON of every `TILE_BLOCK` tile (geometry per kind,
  `kind ∈ hedge|treerow`, finite `h`, `deck.length` = ring length,
  `Polygon|MultiPolygon|LineString` for areas, required files present).

## Open

### Step 5 — coverage artifact

(The CI gate half is done: the e2e diff list now includes `scripts data
sites patches tsconfig.json postcss.config.mjs`.) Add
`bunfig.toml` with `[test] coverageSkipTestFiles = true`,
`coverageReporter = ["text", "lcov"]`, `coverageDir = "coverage"`; in the
`unit` job run `bun run test:coverage` (the script exists) and upload
`coverage/` with `actions/upload-artifact@v7` (`if: always()`, 7 days).
Publish, do not enforce: a threshold is a maintainer call once a baseline
exists.

### Step 6 — remaining fixture-integrity checks

`features.test.ts` covers the GeoJSON contracts. Still unchecked: existence
of `cityjson/lod2_<tile>.city.json`, `dlm/landcover_<tile>.png` (+ its
legend JSON, whose class keys `lib/city/landcover.test.ts` already pins)
and `dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif|.tfw` per tile of every site; non-empty `canopy_`
and `vegrows_` per tile; an explicit pin that `rail_33412_5656_2_sn` has 0
features (legitimately empty); `bridge.kind ∈ {rail, road, path, other}`;
`rail.tracks` finite; `roofcolor_<tile>.json` = `{ roofs: Record<id,
[r,g,b]> }`; `type === "FeatureCollection"`. Never modify `data/` to prove a
test bites — point the test's data root at a scratch copy.

### Step 7 — shader-anchor tests · MOOT

The WebGPU/TSL port ([ADR 0027](../adr/0027-webgpu-renderer-and-tsl.md),
plan 020 in [completed.md](./completed.md)) removed every
`onBeforeCompile` patch: a look term is a type-checked node expression,
and the layers' unit tests assert the node setup (a node material, the
expected slots set, the uniforms shared) instead of chunk anchors. The
step's text (the anchors, markers and cache keys to pin) is in git
history.

## Invariants this plan established

- Adding a layer needs a `LayerName`, a census line and an e2e assertion;
  adding a GeoJSON artifact needs a contract row and test (the shader-patch
  anchors went with the port). Reviewers reject PRs missing the matching
  test.
- `CityWalkStats` fields propagate to `__poc` automatically, but
  `PocDebugInfo` must gain the typed member.

See [ADR 0018](../adr/0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md).
