# Plan 027: What OSM knows about the buildings — shop glow, heritage, era

> **Executor instructions**: Read fully first. Phase 0 is a bug fix and
> lands first, on its own. Phases 1–3 add columns to the per-object table;
> follow the end-to-end column path below exactly (the table is typed from
> the bake to the shader). Look is judged on a real GPU (`bun run shots
> --headed`, full profile, dusk plates). Update the status row in
> `docs/plans/README.md` when a phase lands.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- scripts/bake-city-mesh.ts lib/city/city-mesh.ts lib/city/building-tint.ts app/_components/visual-style.ts app/_components/city-layer.ts`

## Status

- **Priority**: P2 (evening look, and a real bug in phase 0)
- **Effort**: phase 0 S; 1 M; 2 S–M; 3 S (or rejected)
- **Risk**: LOW — per-object data, one free float, no new geometry
- **Planned at**: 2026-09-25
- **Status**: IN PROGRESS — phase 0 done (attributes through `root`)

## Why this matters

The clay buildings are tinted and lit at dusk from the ALKIS `function`
code alone (`buildingGlows`, `lib/city/building-tint.ts:264-274`): a whole
commercial or public building glows over its full height; housing stays
dark. The street at night therefore has no shop fronts, although OSM maps
them densely (four tiles, BBBike 2026-09-19): **1 181 `shop=*` points**
and ~600 cafés, restaurants, bars, pubs and fast-food places; of those
with a `level`, most are on the ground floor (`level=0` 272, `-1` 70,
`1` 54).

OSM also carries `heritage=*` on 162 buildings, `building:levels` on 4 685,
`roof:colour` on 600 — and `start_date` on only 53 (see phase 3).

**Phase 0 — found while planning.** 385 `Building`s per tile have no
geometry of their own; their `BuildingPart`s carry it, but the parts carry
no `function`. `bakeCityMesh` reads only each object's own attributes
(`scripts/bake-city-mesh.ts:157-180`), so every part of a non-housing
building gets `glow = 0` and the housing tint (90 such parents in
`33410_5656` alone). The fix: resolve attributes through `root`
(`rootOf`) — the part's own value first, the root's as fallback — for
`function`, tint and glow.

## The column path (every phase uses it)

1. A bake writes a LUT keyed by CityObject id, like `roof_colour.py`
   (`data/dop/roofcolor_<tile>.json`): here `data/dlm/osmbuild_<tile>.json`
   `{ objects: { <oid>: { shop: 1, heritage: 1, era: 1890 } }, attribution }`.
2. `scripts/prepare-data.ts` `parseCity` loads it and adds it to the city
   cache key (`:250-262`, `:287-288`); `cityMeshSourceFiles` in
   `lib/city/tile.ts:28-36` lists it.
3. `bakeCityMesh` row (`bake-city-mesh.ts:170-180`); `CityObjectRow` and
   the table types (`lib/city/city-mesh.ts:17-81`).
4. The glTF property table column (`scripts/bake-tiles.ts` `cityMesh`; types
   limited to FLOAT32 / UINT8 / UINT32 / VEC3 FLOAT32, `tile-glb.ts:24-29`).
5. `readObjectTable` (`city-layer.ts:60-89`).
6. `packObjectTexels`: band2.w is the **one free float** (`city-mesh.ts:98-115`).
   Pack the flags as bits in it (shop 1, heritage 2) — no fourth band needed.
7. The clay shader fetch (`visual-style.ts:122-133`); tests in
   `city-mesh.test.ts` and the bake-tiles test.

## Bake — `pipeline/bake/osm_buildings.py`

- Footprints from the committed CityJSON (`GroundSurface` rings, or the
  roof rings as `roof_colour.py` reads them), one polygon per object id.
- Shops: `points` with `shop IS NOT NULL` or the gastronomy amenities;
  drop `level` < 0 or > 0 when tagged (upper floors, basements); a point
  inside a footprint marks that object (and its root). Also OSM building
  polygons that carry `shop` or the amenities themselves.
- Heritage: OSM `multipolygons` with `building` and `heritage`; the LoD2
  object whose footprint overlaps it ≥ 50 % is marked.
- Era (phase 3 only): `start_date` / `year_of_construction`, parsed to a
  year.
- `attribution` = OSM. Tests with `_osm_tile` and a two-object CityJSON.

## Shader (`visual-style.ts`)

- **Shop glow**: a warm wash on the **ground floor only** —
  `vLocalH < storeyH` (already varyings), soft top edge, walls only,
  `uDuskGlow * uNight`. **No window grid**: the procedural window grid is
  a recorded user veto (ledger 🗃️). A low-frequency horizontal hash
  modulation (a few metres long) so a long front is not one flat strip.
  The whole-building glow of `buildingGlows` stays for public buildings.
- **Heritage**: a barely-there warm lift of the facade tint and a finer
  eave line; judged on plates, off if it reads as highlighting.

## Phases

0. Attribute inheritance through `root` (tests: a part inherits
   `function`; a part's own value wins). Plate: before/after at dusk.
1. Shop column + ground-floor glow — plates: Neustadt (Alaunstraße /
   Louisenstraße) and the Prager Straße at 21:00.
2. Heritage flag.
3. **Era — spike first.** 53 of 8 151 OSM buildings carry a date in the
   four tiles; that is not enough to colour a city. Look for an official
   source (the Sachsen Denkmalliste / Dresden's Themenstadtplan) and
   report coverage. Below 30 % coverage: mark phase 3 REJECTED with the
   numbers and add a 🗃️ ledger row.

## STOP conditions

- The ground-floor wash reads as a window band or a glowing plinth on
  housing: reduce to buildings with a shop and lower the strength; do not
  add window structure.
- A shop point falls in a courtyard building rather than the street
  front in > 20 % of 20 checked: switch the join to "nearest facade
  within 3 m" before tuning the shader.
