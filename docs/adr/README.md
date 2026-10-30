# Architecture decision records

One file per decision that constrains future work: a dependency, a data
format, a rendering approach, a workflow rule, or a rejected alternative
that must not be retried blindly. ADRs record **why** the code is the way it
is; the ledger [transformations.md](../transformations.md) records **what**
each data → look transformation does, and
[rendering.md](../rendering.md) and [data-pipeline.md](../data-pipeline.md)
how it is built.

## Index

| # | Decision |
|---|---|
| [0001](./0001-client-only-static-app.md) | Static where possible: no database, no accounts, nothing kept about a visitor; stateless server functions only where a source or service needs one |
| [0002](./0002-imperative-threejs-in-a-react-shell.md) | Imperative three.js inside a React shell, not react-three-fiber |
| [0005](./0005-one-projected-crs-and-a-rotated-world-group.md) | Data stays in its provider's UTM zone, under one recenter offset and a rotated `world` group |
| [0009](./0009-shadow-recipe.md) | Light, shadows and post: soft PCF redrawn on demand, a baked horizon for the far field, a fixed lamp pool, DoF dropped while moving, AO never |
| [0010](./0010-opaque-clay-buildings-only.md) | The look: opaque clay on a painted ground, colours within one palette, windows drawn by the shader, detail soft, water matte |
| [0012](./0012-openstreetmap-for-what-official-data-lacks.md) | Sources: official data first, OSM and Wikidata for what it lacks, named stand-ins marked per city, no look switch per city |
| [0018](./0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md) | Headless tests run a lite profile and count frames; visuals are judged on a real GPU; the Snapshot is a validated contract |
| [0021](./0021-docs-published-under-wissen-with-prerendered-diagrams.md) | docs/ is published as /wissen, and its diagrams are prerendered SVG |
| [0024](./0024-site-streams-as-3d-tiles.md) | The build bakes each city into a 3D Tiles tileset that streams around the camera, content-hashed, first frame before the rest |
| [0027](./0027-webgpu-renderer-and-tsl.md) | WebGPURenderer and TSL node materials, one path, public API only |
| [0030](./0030-terrain-tin-and-wall-snap.md) | The ground: a TIN of the native DGM, its static parts baked in, every part meeting it by one set of rules |
| [0032](./0032-camera-never-inside-a-building.md) | The camera is never below the ground or inside a building |
| [0034](./0034-picture-styles-as-one-post-pass.md) | Picture styles are one post pass over the clay scene, reading the light and the world |
| [0036](./0036-lod2-roofs-that-miss-the-scan-are-rebuilt.md) | Buildings are LoD2; geometry beyond it only where a measurement and a name agree; roofs that miss the scan are rebuilt in its form |
| [0037](./0037-sites-providers-and-per-site-data.md) | Cities, providers and the pipeline: fetch, bake, build; one deployment, a route per city |
| [0040](./0040-data-layers-and-live-city-data.md) | Data layers are switches, off at start, drawn as glass; optional features start on first use |
| [0041](./0041-line-levels-along-the-whole-line.md) | Rails, trams and bridges: decks measured in the surface model, every line on a drivable profile solved by the build |
| [0042](./0042-inquiry-cards-on-demand-facts-in-the-tileset.md) | The twin answers on demand: facts and provenance ride in the tileset, text appears only in a card |
| [0043](./0043-crash-and-page-reports-to-an-error-tracker.md) | Crash and page reports go to an error tracker without an SDK; the privacy page says what the code does |
| [0044](./0044-modell-parallel-projections.md) | Modell: the city in parallel projection, every pass reading the camera through a lens |
| [0047](./0047-phone-memory-budget-in-true-bytes.md) | Every device gets a budget in true bytes, a phone's memory never grows, a device that lost its GPU gets a lighter page |
| [0048](./0048-network-failures-are-retried.md) | A network failure is retried for a budget of the page's visible time, never decided at once |
| [0055](./0055-stadtwissen-and-written-walks.md) | What the twin knows is baked as files for agents; walks are written ahead, checked against the data, their narration marked as Claude's |
| [0056](./0056-frag-die-stadt-runs-on-the-visitors-key.md) | *Frag die Stadt* runs on the visitor's own key through one stateless function with a fixed prompt and fixed tools; the key stays in the browser, the answers are marked |
| [0057](./0057-the-sprachfuehrer-speaks-with-the-browsers-voice.md) | The Sprachführer speaks and listens with the browser's own voice, and the scene rests while it does |

## Numbering

Numbers missing from the index belonged to records merged into others;
they are never reused. A new record takes the next number after the
highest ever used (0053), checked against main and the open PRs' branches.

## Format

```markdown
# ADR NNNN: Title (a decision, not a topic)

- **Status:** proposed | accepted
- **Date:** when it was decided (month precision is fine)

## Context        — the forces, in a few sentences
## Decision       — the rule, in the active voice and the present tense
## Consequences   — what must now be kept true
## Alternatives   — only what someone would otherwise retry, with the reason
```

Rules:

- An ADR states today's decision. When it changes, rewrite the text; do
  not append an "Update" or "Amendment". The history is in git.
- A superseded ADR is deleted; code that cited it cites its successor.
- About a page, at most ~600 words. Measurements, constants, file lists
  and tuning stories belong in code comments or the developer docs.
