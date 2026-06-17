# Transformation catalog

The ledger of every **data → look** transformation we've built, tried, or
planned — so a decision made in one chat thread is not re-litigated or
re-discovered in the next. This is the in-repo, version-controlled successor to
scattered notes; **append here when you ship, shelve, or reject a transformation.**

**Status legend:** ✅ active (shipped) · 🧪 experimental (prototype / behind a
slider, not load-bearing) · 📋 planned (designed, not built) · 🗃️ discontinued
(tried or considered and rejected — kept so we don't retry it blindly).

Each entry records **inputs**, **what it does**, **source preference / fallback**
(what it degrades to when its best input is absent — see
[portability.md](./portability.md)), and **where it lives**.

---

## ✅ Active

### Geometry & ground
- **Terrain heightfield** — DGM1 → triangulated heightfield + edge skirt to hide
  inter-tile seams. `terrain-layer.ts`, `lib/city/terrain-geometry.ts`.
- **Surface splatmap** — Basis-DLM land-cover → 4096² RGBA PNG (RGB = pastel
  palette per class, A = water coverage), sampled with anisotropy 16.
  `extract-dlm.sh` → `terrain-layer.ts`.
- **Water** — DLM alpha (water mask, `smoothstep`ed shoreline) + DGM1 geometry +
  animated normal wobble. `water-layer.ts`.
- **Buildings** — CityJSON LoD2 → one merged mesh/tile, per-vertex `objectid`;
  demolish = drop from CityJSON + re-parse; BVH picking/collision. `city-layer.ts`.
- **Ground-clamp** — DGM1 sampled to seat buildings, trees, lamps, and the player
  on terrain. `lib/city/ground-clamp.ts`.

### Building detailing (all keyed off CityJSON attrs + the loader's `surfacetype`)
- **Per-building clay tint** (*Farbvariation*) — deterministic `hash(objectid)` +
  `function` family + `measuredHeight` nudge → muted per-building wall colour.
  **Source preference:** real per-building colour *(planned: DOP)* would replace
  the hash; the hash exists precisely so the look survives when `function` is 86 %
  "unspecified". `lib/city/building-tint.ts`, `visual-style.ts`.
- **Roof colour** (*Dachfarbe*) — real **DOP-sampled** colour per building when
  available (`roofColor()` + the per-tile LUT, ~83 % coverage), else the
  synthesized palette (`surfacetype==RoofSurface` + `roofType` / `Dachneigung` →
  terracotta pitched / slate flat). Bake: `scripts/extract-roof-colour.sh`.
  *Open tuning:* raw DOP is truthful but cooler/greyer than the romantic synth
  palette — a warmth blend toward terracotta is the likely sweet spot (see 🧪).
- **Storey bands** (*Höhenlinien*) — band spacing from `storeyHeight(measuredHeight)`
  (`storeysAboveGround` is only ~4 % populated, so derived).
- **Eave line** (*Traufkante*) — cornice stroke at min RoofSurface-Z per building
  (geometry-derived; the attribute is ~4 %).
- **Dusk glow** (*Abendlicht*) — warm emissive on commerce/public/special
  (`function`), gated by the sun rig's `nightFactor`.
- **Roughness jitter** (*Materialstreuung*) — `hash(objectid)` → roughness
  clamped to [0.55, 1.0] (stays matte).

### Vegetation
- **Tree/hedge rows** — Basis-DLM hedge & tree-row lines → InstancedMesh, chunked
  into 250 m cells for frustum culling. `vegetation-layer.ts`.
- **Canopy fill** — `nDOM = DOM1 − DGM1`, one tree per ~7 m cell at the tallest
  pixel, scaled to measured height, **gated off road/bridge/water** via the DLM
  class raster. `extract-canopy.sh`.
- **NDVI crown colour** — per-tree DOP greenness (`ndvi_<tile>.png`, sampled on
  the CPU at placement) shifts the crown dry pale-sage → lush deep green.
  `extract-ndvi.sh` → `vegetation-layer.ts` `crownColor`; falls back to the
  hash-only sage when no NDVI raster (graceful — see portability).
- **Crown shaping** — radial crown normals (free), organic trunk, base darkening;
  **multi-tuft crown LOD** (rich near / cheap icosphere far, per-chunk distance);
  **backlight shimmer** (one shadow-gated sample, far cheaper than transmission).
- **Street lamps** — OSM lamp points → instanced lamp posts (ODbL). `extract-lamps.sh`.

### Lighting
- **Soft shadows** — `PCFShadowMap` + raised `shadow.radius`; terrain
  `castShadow=false`; `normalBias=0`; tight camera-following frustum. Full recipe
  and dead-ends in the [city-walker skill](../.claude/skills/city-walker/SKILL.md).

---

## 🧪 Experimental

- **Roof-colour warmth blend** — raw DOP roof colour (shipped, ✅ above) reads
  truthful but cooler/drabber than the synth terracotta palette. A blend (DOP
  variation pulled ~⅓ toward the terracotta family), ideally a live HUD slider
  (0 = raw DOP ↔ 1 = full synth warmth), would recover old-town warmth while
  keeping real material variation. **Decision pending** user review of the A/B
  (`shots/feat_aerial_day.png` vs `…_PREV.png`).
- **DOP-lean caveat (recorded):** standard DOP has building lean (tall roofs
  displaced over facades). Mitigated in the bake by eroding the roof footprint
  inward + a robust median; revisit with true-orthophotos if available.

---

## 📋 Planned (designed, not built)

Ranked roughly by impact-vs-effort (full rationale lives in chat history / the
research that produced them):

1. **DOP NDVI — density & meadow** *(crown colour now ✅ active above)* — extend
   the baked `ndvi_<tile>.png` to also drive tree placement **density** and
   **meadow/grass tinting** in the terrain splat. The crown-colour slice shipped;
   these two remain.
2. **Stylized DOP ground-drape** — posterized, desaturated DOP blended over
   terrain past ~150 m for far-distance texture. *Aesthetic risk* — prototype
   behind a slider, judge on GPU before committing.
3. **ALKIS parcels** — plot boundaries → per-parcel ground tint, garden/courtyard
   vs street, fences along lot lines; richer `Gebäudefunktion` than CityGML.
4. **Cartographic minimap** — DTK / basemap.de P10 raster tile + Ortsteile labels
   replacing the math-drawn minimap.
5. **Dappled canopy shadow** — alpha-tested colour-less proxy caster per chunk
   (mind the `WebGLShadowMap` alphaMap-override gotcha; see skill).
6. **Real trees from the laser-scan point cloud** — segment high-veg returns →
   per-tree position/height/crown; bake to per-tile GeoJSON.
7. **Cascaded Shadow Maps** — the one shadow limit the skill calls unsolved (long
   low-sun shadows clip the 110 m frustum). Sizeable integration.
8. **Adaptive / half-res post** — fill-rate is the bottleneck; a resolution scale
   under load buys headroom before the larger WebGPU move.

---

## 🗃️ Discontinued / rejected (do not retry blindly)

| Idea | Why rejected | Caveat |
|---|---|---|
| **Procedural window grid** on facades | Reads as a modern office block, fights the historic LoD2 silhouette (user veto). | Faint storey banding is the only kept remnant. |
| **Orthophoto for facade colour** | Nadir DOP only sees roofs — no facade data. | DOP for **roofs** is fine and is now the 🧪 entry above. |
| **Plain foliage translucency** | Reads as "noise" at instance distance. | Only OK if **shadow-gated** (kept as the shimmer transform). |
| **VSM shadows** | "Corduroy"/grid rings on large ground at grazing sun. | Use `PCFShadowMap` + radius instead. |
| **Large `normalBias`** | Bright peter-panning contact strip. | Keep `normalBias=0`, small negative `bias`. |
| **Bigger shadow frustum / 4096 map** | Coarser texels → fraying / cost without gain once radius softens. | Tight ~110 m frustum at 3072 + radius. |
| **Sobel / deferred outlines** | Hard edges clash with the watercolor look. | — |
| **Selective bloom, quad leaf billboards** | No payoff yet for the cost. | Revisit only with a concrete need. |
| **`BatchedMesh` for buildings** | Already merged per tile; would break `objectid` picking/demolish and not cut draw calls. | Bottleneck is fill-rate, not draw calls. |
| **Blender texture baking** | No UVs on the source geometry. | — |
| **Orthophoto as the *only* tint source** | Leaves everything identical where imagery is flat; no facade info. | Hash carries variation; DOP augments roofs. |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
