# Plan 032: Street names — map lettering from the air, a caption on foot

> **Executor instructions**: Read fully first. Phases in order. Look is
> judged on a real GPU (`bun run shots --headed`, full profile, fly mode
> at 80 m, 200 m and 500 m). Update the status row in
> `docs/plans/README.md` when a phase lands.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- app/_components/tile-stream.ts app/_components/city-walk.tsx lib/city/features.ts`

## Status

- **Priority**: P3 (orientation; the contour-map look gets its lettering)
- **Effort**: M (bake S, lettering M, caption S)
- **Risk**: MED — text is the easiest thing to make look cheap
- **Planned at**: 2026-09-25
- **Status**: TODO

## Why this matters

The art direction is a watercolour / contour map (ledger north star), and a
map has names. Nothing in the scene draws text today: no `TextGeometry`,
no sprites, no canvas text, no font loader; OSM highway `name` is never
read, and the bridge and monument names are baked but unused. The guide
says street-name *signs* are mapped too sparsely to draw
(`docs/guide/en/how-it-works.md:123-124`) — that stays true; this plan
draws the **names of the ways**, which are mapped almost everywhere
(**2 920 named highway ways** in the four tiles, BBBike 2026-09-19).

## Design

No new dependency. Text is rasterised **at runtime with Canvas 2D** in the
page's own font (Inter, already loaded via `@fontsource-variable/inter`),
so glyph shaping, umlauts and ß come from the browser.

### Bake — `pipeline/bake/names.py` → `data/dlm/names_<tile>.geojson`

- `lines` with `highway` and `name` (not `footway=sidewalk`, not
  `service`), merged per name within the tile (`linemerge`), clipped with
  a 50 m margin.
- Per merged line: label anchors along its straightest stretches — a
  window of `len(name) × 4.2 m + 20 m` whose direction changes < 20°,
  one anchor per 450 m of line, owned by one tile (`owns()`), so a name
  crossing a seam is written once. Each anchor carries the sub-polyline
  it lies on (the label follows the curve), the name and the road class.
- Also the bridge names (`bridge_<tile>` `name`, DLM `NAM`) and squares
  (`place=square` / pedestrian areas with a name) as centred labels.
- `attribution` = OSM. Tests: merge, anchor count, seam ownership.

### Runtime — `app/_components/name-layer.ts`

- One canvas atlas per tile (≤ 2048 × 1024; one row per label, the text
  drawn once in the ink colour with a pale halo), uploaded as a texture
  and freed in `dispose` (textures are not freed by `disposeObject3D`).
- Per label a ribbon mesh on the ground along its sub-polyline, 4 m tall
  lettering (main roads 6 m), sampled every 4 m on `ctx.heightAt` +
  0.05 m, UV along the arc length; flipped when the direction points
  west so it reads left to right.
- Material: unlit, ink tone of the contour lines, `depthWrite: false`,
  `polygonOffset`, height fog on, **opacity by camera altitude** — 0 below
  25 m above ground, full from 60 m (a uniform the render loop sets from
  `groundUnderCamera()`); never casts.
- On the minimap: none (a separate decision).

### HUD caption (phase 2)

On foot, a small caption in the HUD ("Königstraße") with the name of the
nearest named way within 25 m, updated from the 10 Hz `onPose` stream
(`city-walk.tsx:374-381`) against the loaded name lines (CPU, per tile).
Hidden in fly mode and in immersive mode.

### Docs

Ledger (new section "Names"), `data-flow.md`, `rendering.md` codebook
(and `docs/guide/*/how-it-works.md`, which says names are not shown),
`using-the-viewer.md` for the caption (en + de).

## Phases

1. Bake + ground lettering in fly mode.
2. The on-foot caption.

## STOP conditions

- Lettering aliases or crawls at 500 m: generate mips for the atlas and
  raise the minimum letter height with altitude; if it still reads badly,
  limit labels to main roads above 250 m.
- A tile's atlas exceeds 2048 × 2048: drop minor roads' labels first.
- It looks like a navigation app, not a drawn map (maintainer's call on
  the plates): tone the ink toward the contour colour and lower opacity
  before removing anything.
