# Architecture decision records

One file per decision that constrains future work: a dependency, a data
format, a rendering approach, a workflow rule, or a rejected alternative
that must not be retried blindly. ADRs record **why** the code is the way it
is; the ledger [transformations.md](../transformations.md) records **what**
each data → look transformation does and its status.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](./0001-client-only-static-app.md) | Client-only static app: no backend, no database, no persistence | accepted |
| [0002](./0002-imperative-threejs-in-a-react-shell.md) | Imperative three.js inside a React shell, not react-three-fiber | accepted |
| [0003](./0003-bake-heavy-inputs-at-build-time.md) | Bake heavy inputs at build time; the browser decodes no raster and parses no CityJSON | accepted |
| [0004](./0004-commit-derived-artifacts-not-raw-data.md) | Commit small derived artifacts, not raw bulk data; the DGM1 GeoTIFF is the one exception; no Git-LFS | accepted |
| [0005](./0005-one-projected-crs-and-a-rotated-world-group.md) | One projected CRS (EPSG:25833) and a −90° rotated `world` group | accepted |
| [0006](./0006-tile-block-with-one-primary-and-one-artifact-map.md) | A 2×2 tile block with one primary tile, and one artifact map shared by bake and client | superseded by 0024 |
| [0007](./0007-content-hashed-publishing-with-a-manifest.md) | Content-hashed data files with a `manifest.json` | accepted |
| [0008](./0008-progressive-two-phase-boot.md) | Progressive two-phase boot: first frame from the primary tile, everything else streamed | accepted (second phase: 0024) |
| [0009](./0009-shadow-recipe.md) | Shadow recipe: soft PCF, receive-only terrain, on-demand refresh with a dead zone, altitude-fitted frustum | accepted |
| [0010](./0010-opaque-clay-buildings-only.md) | Buildings render as opaque clay only; no transmission, no outlines | accepted; outlines narrowed by 0032 |
| [0011](./0011-motion-keyed-quality-regression.md) | Motion-keyed quality regression: DoF off while moving, SSAO never gated | accepted |
| [0012](./0012-openstreetmap-for-what-official-data-lacks.md) | OpenStreetMap for what the official data lacks (walls, lamps, platforms, bridge structure), from a local extract where possible | accepted (always local: 0025) |
| [0013](./0013-rail-layer-from-dissolved-areas-and-centreline-driven-decks.md) | Rail layer from dissolved ballast areas and centreline-driven decks, built once per block | accepted (per tile: 0024) |
| [0014](./0014-wall-to-terrain-breakline-conflation.md) | Burn OSM wall lines into the heightfield as breaklines | accepted (at bake time: 0024); the coarse level only since 0030 |
| [0015](./0015-roof-colour-from-orthophotos-with-vibrance-lift.md) | Roof colour from orthophotos with a hue-preserving vibrance lift | accepted |
| [0016](./0016-land-cover-rasters-downsampled-with-alpha-as-data.md) | Land-cover rasters downsampled to 2048² with the alpha channel treated as data | superseded by 0023 |
| [0017](./0017-look-controls-table-and-snapshot-contract.md) | Look controls declared in one table; the Snapshot is a validated, versioned contract | accepted |
| [0018](./0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md) | Headless tests run a lite profile and assert presence; visuals are judged on a real GPU | accepted |
| [0019](./0019-oxlint-oxfmt-and-native-typescript.md) | oxlint + oxfmt and the native TypeScript 7 compiler; no ESLint, no biome | accepted |
| [0020](./0020-fixed-light-pool-and-static-shadow-casters.md) | A fixed pool of real point lights; animated geometry never updates the shadow map | accepted |
| [0021](./0021-docs-published-under-wissen-with-prerendered-diagrams.md) | docs/ is published as /wissen, and its diagrams are prerendered SVG | accepted |
| [0022](./0022-stream-tiles-around-the-camera.md) | Stream tiles around the camera with a hand-written tile manager, a loader worker and 1 km near cells | superseded by 0024 (never accepted) |
| [0023](./0023-land-cover-colours-painted-at-runtime.md) | Land-cover colours are painted at runtime from one palette | accepted |
| [0024](./0024-site-streams-as-3d-tiles.md) | The site streams as OGC 3D Tiles with glTF content through 3DTilesRendererJS | accepted |
| [0025](./0025-bakes-are-one-python-package.md) | The bakes are one Python package in a uv environment; OSM comes only from a local extract | accepted |
| [0026](./0026-one-site-config-per-build.md) | One site config per build, with an ingest adapter per data provider | accepted |
| [0027](./0027-webgpu-renderer-and-tsl.md) | Move to WebGPURenderer and TSL node materials | proposed (GPU spike, plan 020) |
| [0028](./0028-osm-stairs-as-geometry-over-a-lowered-terrain.md) | OSM stairs as step geometry over a lowered terrain | accepted |
| [0029](./0029-static-dressing-baked-into-the-fine-terrain.md) | Static dressing (walls, stairs) is baked into the fine terrain glTF | accepted |
| [0030](./0030-terrain-tin-and-wall-snap.md) | The fine terrain level is an error-bounded TIN of the native DGM; walls snap to the measured step | accepted |
| [0031](./0031-baked-horizon-map-for-far-shadows.md) | A baked horizon map casts the far field's shadows; the shadow map keeps the near field | accepted |
| [0032](./0032-picture-styles-as-one-post-pass.md) | Picture styles (comic, film noir, Sin City, Papier) are one optional post pass over the clay scene; Papier adds a render-time material override | accepted |

## Format

```markdown
# ADR NNNN: Title (a decision, not a topic)

- **Status:** proposed | accepted | superseded by ADR-NNNN | deprecated
- **Date:** when it was decided (month precision is fine)

## Context        — the forces: what problem, what constraints, what was measured
## Decision       — one paragraph, in the active voice
## Consequences   — what becomes easier, what becomes harder, what must now be kept true
## Alternatives   — what was considered and why it lost (so nobody retries it blindly)
## References     — code, plans, ledger entries, commits or PRs
```

## Adding one

1. Copy the format, take the next number, keep the title a decision.
2. Link it from the index above and, where it changes a transformation,
   from [transformations.md](../transformations.md).
3. Superseding: add a new ADR, set the old one's status to *superseded by*,
   and never edit the old decision text — the history is the point.

The first twenty were written in September 2026 from the code, the
[implementation plans](../plans/README.md) and the ledger, with dates taken
from the git history where a decision predates its record.
