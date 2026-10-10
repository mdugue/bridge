# Plan 045: One source for the raster decoders and the class ids, on both sides of the bake

> **Executor instructions**: Follow the steps in order; each ends in its
> own commit. Steps 1, 2 and 4 must not change any baked output or any
> pixel (constants and helpers move, values stay). Step 3 changes how a few
> OSM tags parse and is the only one that can change baked data — it needs
> no re-bake here (no raw data), but say so in the status row. On a STOP
> condition, stop and report. When done, update this plan's row in
> `docs/plans/README.md`.
>
> **Multi-site layout (merged 2026-10-01, ADR 0037, plan 049)**: the data
> lives per site — `data/<site>/{dgm,cityjson,dlm,dop}` (Dresden's under
> `data/dresden/`), raw downloads in `data/_raw/<provider>/` — and the bakes
> run as `bun run fetch <site>` / `bun run bake <site> [tile…] [--step X]`
> through `scripts/pipeline.ts` (`scripts/bake.ts` and `--ingest` are gone;
> Saxony's adapter is `pipeline/bake/providers/sn.py`). Read the paths and
> commands below in that layout; this is drift, not a STOP condition.
>
> **Soundscape removed (2026-10-10)**: `lib/city/soundscape.ts` and its
> test are gone with the soundscape (plan 035). Skip step 1.2, drop the
> file from the drift check, the scope and the verify line, and the
> `classId === 7` done criterion; this is drift, not a STOP condition.
>
> **Drift check (run first)**:
> `git diff --stat dd470e9..HEAD -- lib/city/landcover.ts lib/city/landcover.test.ts lib/city/soundscape.ts lib/city/markings.ts lib/city/cultivated.ts pipeline/bake`

## Status

- **Priority**: P3 (latent, but the next class or scale change hits it)
- **Effort**: S
- **Risk**: LOW (steps 1, 2, 4), MED (step 3 changes tag parsing)
- **Depends on**: 037 (test commands); do **before** plan 017 phase 4 (OSM land cover renumbers/adds classes)
- **Category**: tech-debt
- **Planned at**: commit `a28de75`, 2026-10-01; refreshed against `dd470e9` (main with ADR 0035: `pipeline/bake/common.py` now also holds `label_line`/`smooth_labels`/`absorb_short`, moved out of `tram.py` — the shared-helper home this plan uses too)

## Why this matters

The bake writes bytes; the shader and a few CPU helpers decode them. Where
a decoder is copied instead of shared, a test can pin the copy while the
shipped code does something else — and that has already happened:
`lib/city/landcover.ts` `surfaceHeading` decodes the paving raster's
heading byte over 0–180°, its test pins that, while the bake has encoded
0–360° since 2026-09-25 and the shader decodes 0–360°. (It is only used by
its test, so nothing renders wrong today.) On the Python side the
land-cover class ids are typed as integer literals in eleven bake modules
(`(5, 6, 7, 8)`, `ROAD = 7`, …), and OSM numbers are parsed by several
helpers with different rules (`walls.number` reads `"1,5"` as 1.0,
`surface.parse_width` reads it as 1.5). Plan 017 phase 4 (OSM land cover
as a DLM substitute) is exactly the change that touches every class gate.

## Current state

### TypeScript

`lib/city/landcover.ts:95-114`:

```ts
export function unpackSurface(byte: number): { park: number; road: number; walk: number } {
  return { road: byte & 7, walk: (byte >> 3) & 7, park: byte >> 6 };
}

/**
 * The street direction the raster's G channel stores (0 = unknown, else
 * 1 + bearing mod 180° over 0..254) in radians from east, or null.
 */
export function surfaceHeading(byte: number): number | null {
  return byte === 0 ? null : ((byte - 1) / 254) * Math.PI;
}
```

`lib/city/landcover.test.ts:70-77`:

```ts
  expect(unpackSurface(byte)).toEqual({ road: 4, walk: 3, park: 3 });
  expect(surfaceHeading(0)).toBeNull();
  expect(surfaceHeading(1)).toBe(0);
  expect(surfaceHeading(128)).toBeCloseTo(Math.PI / 2, 10);
```

The encoder (`pipeline/bake/surface.py:236-241`): "1 + the bearing over
0..360° in 0..254"; the shader (`app/_components/ground-detail.ts:384-390`):
`gb.sub(1).div(254).mul(2 * Math.PI)`. Neither `unpackSurface` nor
`surfaceHeading` has a production caller
(`grep -rn "unpackSurface\|surfaceHeading" app lib --include=*.ts | grep -v test`).
`lib/city/soundscape.ts:378-390` decodes the same byte inline:

```ts
export function stepSurface(classId: number, surfaceByte: number): StepSurface {
  const road = surfaceByte & 7;
  const walk = (surfaceByte >> 3) & 7;
  const onRoad = classId === 7;
```

while `lib/city/landcover.ts:33-37` exports `WATER_CLASS = 8`,
`MEADOW_CLASS = 1`, `BUILTUP_CLASS = 4`, `PATH_CLASS = 6`, `ROAD_CLASS = 7`.

Scale constants already shared between TS decoder and TSL:
`EDGE_SCALE` (`lib/city/landcover.ts:67`, used by `ground-detail.ts:330`),
`COLONY_EDGE_SCALE` (`lib/city/cultivated.ts:15`, used by
`cultivated-layer.ts:282`), `MARKING_OFFSET_SCALE` (`lib/city/markings.ts:21`,
used by `road-markings.ts:153`) — all `20`. Their Python twins:
`pipeline/bake/edges.py:51` `EDGE_SCALE = 20.0`,
`pipeline/bake/cultivated.py:86` `EDGE_SCALE = 20.0`,
`pipeline/bake/markings.py:122` `EDGE_SCALE = 20.0  # bytes per metre, as edges.py`.
Only the edges scale is pinned (`landcover.test.ts`: "every committed edge
legend has the viewer's scale", reading `data/dlm/edges_*.json`).

### Python

`pipeline/bake/landcover.py:25-35`:

```python
CLASSES = {
    0: "background", 1: "farmland", 2: "forest", 3: "copse", 4: "builtup",
    5: "railway", 6: "path", 7: "road", 8: "water",
}
```

Literal class ids elsewhere (each with a comment naming the classes):
`canopy.py:19` `BLOCKED = (5, 6, 7, 8)`; `cultivated.py:85` `NO_BEDS = (5, 7, 8)`;
`edges.py:40-43` `ROAD = 7`, `MEADOW = 1`, `BUILTUP = 4`, `NO_KERB = (5, 8)`;
`furniture.py:59` `BLOCKED = (5, 8)`; `lamps.py:13` `BLOCKED = (5, 8)`;
`lowveg.py:95-96` `BLOCKED_CLASSES = (5, 8)`, `TREE_BLOCKED_CLASSES = (5, 6, 7, 8)`;
`markings.py:91` `ROAD = 7`; `riverside.py:45` `WATER = 8`;
`small_buildings.py:71` `BLOCKED = (5, 7, 8)`; `tram.py:69` `ROAD, MEADOW = 7, 1`;
`trees.py:65` `WOODLAND = (2, 3)`; `landcover.py:145` `(raster == 7)`.
`pipeline/tests/test_bakes.py:53-56` pins `list(CLASSES) == list(range(9))`
and `CLASSES[8] == "water"`; `lib/city/landcover.test.ts` ("every
committed legend names the same classes") pins the committed legends
against the TS table — the cross-language guard already exists through
the data.

OSM number helpers:
`stairs.py:49-51` `number()` — `re.search(r"\d*\.?\d+", …)` (unsigned, dot only);
`walls.py:71-73` `number()` — `r"[-+]?\d*\.?\d+"` (signed, dot only);
`surface.py:159-167` `parse_width()` — accepts `5`, `5.5 m`, `5,5`;
`lowveg.py:204-210` `osm_height()` — `float(str(...).replace("m", ""))`;
`furniture.py:170-180` (bollard) and `riverside.py:128-133` (`width_of`) —
`float((tag(...) or "").split()[0])`.
Verbatim duplicates: `surface_id` (`sport.py:153`, `surface.py:152`),
`table_json` (`markings.py:635`, `sport.py:307`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `bun run test` | all pass |
| Pipeline tests + ruff | `bun run test:pipeline` | all pass, clean |
| Gate | `bun run fix && bun run verify` | exit 0 |

## Scope

**In scope**: `lib/city/landcover.ts` (+ test), `lib/city/soundscape.ts`
(+ test), `lib/city/scales.test.ts` (create, or a test next to
`landcover.test.ts`), `pipeline/bake/{landcover,canopy,cultivated,edges,furniture,lamps,lowveg,markings,riverside,small_buildings,tram,trees,stairs,walls,surface,sport,osm,common}.py`,
`pipeline/tests/*`.

**Out of scope**: the TSL decoders (they already import the TS constants);
any change to a class id's *value*; re-baking `data/`; `bridge.py`'s
seamark clearance and `markings.py`'s `lane_count` (different shapes of
value — leave them).

## Git workflow

Branch `claude/045-one-source-decoders`; commits:
`refactor(landcover): the paving heading decodes as the shader does`,
`refactor(pipeline): named class ids from landcover.CLASSES`,
`fix(pipeline): one OSM number parser (decimal comma, units)`,
`test: the bakes' byte scales match the viewer's`. No push unless instructed.

## Steps

### Step 1: TypeScript decoders

1. `surfaceHeading`: decode as the bake and shader do — `((byte - 1) / 254) * 2 * Math.PI` —
   and fix its doc comment ("1 + bearing over 0..360° in 0..254").
   Update the test: `surfaceHeading(128)` ≈ `Math.PI` (127/254 · 2π);
   add `surfaceHeading(64)` ≈ `63/254 · 2π`. (Alternatively delete
   `surfaceHeading` and its test lines — it has no caller. Prefer fixing:
   the soundscape or the minimap may want the street direction.)
2. `soundscape.ts` `stepSurface`: use `unpackSurface(surfaceByte)` and
   `ROAD_CLASS` from `./landcover` instead of the inline bit ops and `7`.

**Verify**: `bun test lib/city/landcover.test.ts lib/city/soundscape.test.ts` → all pass.

### Step 2: Named class ids in Python

In `pipeline/bake/landcover.py`, right below `CLASSES`, add named ids
derived from it (so a renumbering moves them together):

```python
_ID = {name: i for i, name in CLASSES.items()}
BACKGROUND, FARMLAND, FOREST, COPSE, BUILTUP = (_ID[n] for n in ("background", "farmland", "forest", "copse", "builtup"))
RAILWAY, PATH, ROAD, WATER = (_ID[n] for n in ("railway", "path", "road", "water"))
MEADOW = FARMLAND  # the viewer calls class 1 meadow (lib/city/landcover.ts MEADOW_CLASS)
```

Replace every literal listed under "Current state → Python" with these
names (`BLOCKED = (RAILWAY, PATH, ROAD, WATER)`, etc.), importing from
`.landcover`. **Check for import cycles**: if `landcover.py` imports a
module that would now import it back, put the names in a new
`pipeline/bake/classes.py` (with `CLASSES` moved there and re-exported
from `landcover.py`) instead. Values must be identical.

Add a pytest: the named ids equal the literal values they replaced
(`assert (RAILWAY, PATH, ROAD, WATER) == (5, 6, 7, 8)` …) so a renumbering
is a deliberate test change.

**Verify**: `bun run test:pipeline` → all pass;
`grep -nE "\(5, ?6, ?7, ?8\)|\(5, ?8\)|\(5, ?7, ?8\)|= 7  #|== 7\)" pipeline/bake/*.py` → no matches.

### Step 3: One OSM number parser

In `pipeline/bake/osm.py` add:

```python
def osm_number(value: str | None, *, signed: bool = False) -> float | None:
    """A number from an OSM tag value: the first number in it, a decimal
    comma read as a point ("1,5" → 1.5), units and text around it ignored
    ("2.5 m" → 2.5); a sign only when `signed`. None when there is none."""
```

Use it in `stairs.number`, `walls.number` (signed), `lowveg.osm_height`,
the bollard height in `furniture.py`, and `riverside.width_of` — keep each
call site's own clamping and defaults. Delete the two local `number()`
functions (repoint their callers). Move `surface_id` and `table_json` into
`common.py` (or `osm.py` for `surface_id`, whichever it belongs with) and
import them where they were.

Tests (`pipeline/tests/test_bakes.py` or a new `test_osm.py`):
`"1,5"` → 1.5, `"2.5 m"` → 2.5, `"3"` → 3.0, `"-1.2"` → 1.2 unsigned /
−1.2 signed, `"abc"` → None, `None` → None, `"1;2"` → 1.0.

**Verify**: `bun run test:pipeline` → all pass. Note in the status row:
"walls/stairs/hedges/bollards/piers tagged with a decimal comma now parse
as written; takes effect on the next re-bake".

### Step 4: Pin the byte scales across the languages

Create a bun test (e.g. `lib/city/scales.test.ts`) that reads the three
Python files as text and asserts the scale they write equals the TS
decoder's constant:

```ts
const pyScale = (file: string, name: string) =>
  Number(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "mu").exec(readFileSync(file, "utf8"))?.[1]);
expect(pyScale("pipeline/bake/edges.py", "EDGE_SCALE")).toBe(EDGE_SCALE);
expect(pyScale("pipeline/bake/cultivated.py", "EDGE_SCALE")).toBe(COLONY_EDGE_SCALE);
expect(pyScale("pipeline/bake/markings.py", "EDGE_SCALE")).toBe(MARKING_OFFSET_SCALE);
```

Check `lib/city/purity.test.ts` allows `node:fs` in `lib/city` tests (other
`lib/city/*.test.ts` already read `data/` with `readFileSync` — follow
them).

**Verify**: `bun test lib/city/scales.test.ts` → pass; change one Python
constant locally to 21 → fails; restore.

## Test plan

Covered in the steps: the heading decode, the named ids, the parser
table, the cross-language scale pin.

## Done criteria

- [ ] `bun run verify` and `bun run test:pipeline` exit 0
- [ ] `grep -n "2 \* Math.PI" lib/city/landcover.ts` → in `surfaceHeading`
- [ ] `grep -n "classId === 7" lib/city/soundscape.ts` → no match
- [ ] `grep -n "def number" pipeline/bake/*.py` → no match
- [ ] `grep -c "def table_json\|def surface_id" pipeline/bake/*.py | grep -v ":0"` → one file each
- [ ] Committed `data/` unchanged

## STOP conditions

- Step 2 needs a value change anywhere to pass → stop (that is a bug
  report, not a refactor).
- A call site's existing tests (e.g. walls height, bollard height) fail
  with `osm_number` in a way that is not the decimal-comma case → stop and
  report the input.

## Maintenance notes

- New bake code uses the named ids and `osm_number`; a reviewer should
  reject new integer class literals.
- When plan 017 phase 4 adds or renumbers classes, `CLASSES` and
  `lib/city/landcover.ts` `LANDCOVER_CLASSES` change together; the
  committed-legend test and step 2's pytest catch a half change.
