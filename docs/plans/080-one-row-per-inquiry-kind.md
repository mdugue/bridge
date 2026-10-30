# 080 — One row per inquiry kind: the twin's per-kind dispatch in one place

**Status:** TODO

Planned 2026-10-30 from an architecture review of the twin ("Befragen",
ADR 0042) and three verifiers' reading of it. A refactor: no card's text
changes, no new kind, no new fetch.

> **Executor instructions.** Read the whole plan, ADR 0042 and plan 052
> (§4, §4c, §4d, §4e) first. Each step ships on its own, as its own
> commit (Conventional Commits, `refactor(inquiry): …`), and leaves
> `bun run verify` green. Do them in order; stop after any step if the
> STOP conditions say so. Update this plan's status row in
> `docs/plans/README.md` when you stop, with what you built and what you
> did not.
>
> **Drift check (run first):**
> `git log --oneline -8 -- lib/city/inquiry.ts lib/city/inquiry-features.ts lib/city/inquiry-more.ts lib/city/inquiry-traffic.ts lib/city/lineage.ts lib/city/ask-items.ts lib/city/ask-more.ts app/_components/inquiry-strip.tsx app/_components/inquiry-probe.ts app/_components/create-app.ts`
> Planned against `9bd5ee49` (2026-10-30). If a commit since added a
> kind (a 13th member of `Inquiry`), redo the counts in Findings before
> you start. Line numbers below are approximate; find code by its name.

## Context

The twin answers twelve kinds of thing. `Inquiry` (`lib/city/inquiry.ts`)
is `BuildingInquiry | FeatureInquiry`. `FeatureInquiry`
(`lib/city/inquiry-features.ts`, ≈ line 106) has eleven members: `tree`,
`monument`, `bridge` (same file), `traffic`, `bikes`
(`lib/city/inquiry-traffic.ts`), and the six of `MoreInquiry`
(`lib/city/inquiry-more.ts`, ≈ line 108): `canopy`, `hedge`, `lamp`,
`furniture`, `stop`, `landing`.

Every switch over the kind is exhaustive and checked. A card function
with a missed case fails the type check (no ending return). Every other
switch fails `typescript/switch-exhaustiveness-check` (`.oxlintrc.json`,
`error`). So a new kind is never forgotten. The friction is elsewhere:

- two switches dispatch twice over the same six kinds;
- the "more" kinds live in files of their own because they were
  delivered later (plan 052 §4e), not because they differ;
- the candidate strip builds a whole card to read two strings;
- nine of `answered`'s thirteen arms do nothing.

Three commits added kinds in one week (3569359a and d87090a5 on
2026-10-01, 6ab89b7c on 2026-10-07); none since. The next kind on the
books is the timetable's trams: the README backlog's *ride a tram* ("no
`tram-ask.ts`") and plan 052 §4's open "the timetable's trams as a kind".
This plan makes that kind, and any after it, one row and one lineage
arm instead of six edits in five files.

## Findings

### The five dispatches (verified 2026-10-30)

| Where | Function | Arms (labels / bodies) | Note |
|---|---|---|---|
| `lib/city/inquiry.ts` ≈ 372–400 | `inquiryCard` | 12 / 7 | six labels fall through to `moreCard` |
| `lib/city/inquiry-more.ts` ≈ 480–499 | `moreCard` | 6 / 6 | the second half of that dispatch |
| `app/_components/inquiry-strip.tsx` ≈ 31–57 | `kindIcon` | 12 / 12 | `furniture` reads its own `PLAY` set (≈ 59) |
| `lib/city/lineage.ts` ≈ 204–243 | `lineage` | 12 / 7 | six labels fall through to `moreLineage` |
| `lib/city/lineage.ts` ≈ 589–620 | `moreLineage` | 6 / 3 | `hedge`'s body is inline; four share `osmThingLineage` |
| `app/_components/create-app.ts` ≈ 2194–2222 | `answered` | 12 kinds + `undefined` / 4 | nine arms return `asked` unchanged |
| `app/_components/inquiry-probe.ts` ≈ 194–212 | `thingKey` | 11 / 3 | over `FeatureInquiry` only |
| `app/_components/inquiry-probe.ts` ≈ 216–223 | `porous` | an `===` chain | tree, canopy, hedge, a playground |

A seventh, unchecked dispatch sits in `create-app.ts`'s `outlineShape`
(≈ 2102–2165): `bridge` and `traffic` get their drawn triangles, `tree`
and `canopy` pass a crown form to `solidShape`, `bikes` an infinite
reach. Step 6 removes the crown half of it.

### What each dispatch needs

- **Cards** take different arguments. `buildingCard(inquiry, provenance,
  credits)`; `treeCard(t, treeFacts, provenance, credits)`;
  `monumentCard`, `bridgeCard`, `canopyCard`, `hedgeCard`, `lampCard`
  `(i, provenance, credits)`; `furnitureCard`, `stopCard`, `landingCard`
  `(i, provenance)`; `trafficCard(t)`, `bikeCard(b)`. The tests call these
  directly; their signatures stay.
- **The strip** (`InquiryStrip`, ≈ 125–138) calls
  `inquiryCard(c.inquiry, null, cardCredits(site))` per candidate (at most
  `MAX_CANDIDATES` = 8, `inquiry-probe.ts` ≈ 67; memoised on `along`) and
  reads `kicker` and `title`. Both depend on the inquiry and, for a tree,
  on `credits.register` (`treeCard`: "Baum" without a register,
  "Stadtbaum" with one). With `treeFacts` null a tree's title is its
  genus, else "Nadelbaum"/"Laubbaum". Nothing else in the heading reads
  provenance.
- **The icon**: `PLAY` in the strip is exactly the nine `FurnitureKind`s
  whose group in `FURNITURE` (`inquiry-more.ts` ≈ 349) is "Spielplatz".
- **The vote key** (`thingKey`) exists for feature kinds only. A building's
  key is `buildingKey(layer, objectIndex)` (`city-layer.ts`): its ensemble
  in its layer, which a pure table cannot compute.
- **`answered`** adds what the pick did not know. A tree's `factsUrl`:
  `treeFactsUrl(tile)` (≈ 2185) reads `extras.tiles[…].ask.treeFacts` —
  the tile list in the tileset's root extras (`TilesetTileInfo.ask`,
  `lib/city/tileset.ts` ≈ 179). The stream gets only `tileBounds` of that
  list today (`TileStreamContext.tileBounds`, `tile-stream.ts` ≈ 300; set
  in `create-app.ts` ≈ 1566). Traffic's `credit` (the site's
  `dataLayers.traffic.credit`) and `hour` — `dataLayers.current()?.trafficHour()`,
  read when the question is asked. Bikes' `credit`.

### The phase split

`inquiry-more.ts` (499 lines) is the second half of
`inquiry-features.ts` (511), and `lib/city/ask-more.ts` (588) of
`lib/city/ask-items.ts` (439). The split is plan 052 §4 against §4e: when
the kinds arrived, not what they are. Merged, each file is ≈ 1 000 lines.

- No top-level name clashes between `inquiry-features.ts` and
  `inquiry-more.ts`. Between `ask-items.ts` and `ask-more.ts`: `type
  HeightAt` (identical) and `MIN_CROWN_R` (both 0.8) — keep one of each.
- `ask-more.ts` already imports `packedCylinderSets` and `PackedTree` from
  `ask-items.ts`; `inquiry-features.ts` already imports `type MoreInquiry`
  from `inquiry-more.ts`. The halves are one module in all but name.
- **The context trap.** `MoreContext.heightAt` (`ask-more.ts` ≈ 45) is the
  tile's own ground. `tile-stream.ts`'s `askSteps` (in `buildDressing`,
  ≈ 1347–1376) passes `{ offset: ctx.offset, heightAt: terrain.heightAt,
  tile }`. In `AskContext` (`ask-items.ts` ≈ 36–45) that ground is
  `treeHeightAt`; `AskContext.heightAt` is the ground over every loaded
  terrain (`askCtx` ≈ 1336–1345 spreads `ground` =
  `{ offset, heightAt: ctx.heightAt }`, ≈ 1222). Monuments and decks
  stand on that one. A merge that passes `askCtx` to `moreSetsSteps`
  unchanged would stand every lamp, bench, hedge and canopy tree on the
  wrong ground near a seam — and every test would still pass, because
  each test's `ctx` has one `heightAt: () => 110`. The merge renames
  `heightAt` to `treeHeightAt` in the "more" code (it never widens to
  `heightAt`), and a new test tells the two grounds apart.
- `moreSetsSteps` is a sliced generator (`build-steps.ts`), driven inside
  `askSteps`. It stays a generator; the merge moves it, not its shape.
- Dead on the way: `furnitureName` (`inquiry-more.ts` ≈ 378; its comment
  says "the card and the strip", neither calls it) and `canopySets`
  (`ask-more.ts` ≈ 224; only its `…Steps` twin is called). No caller in
  `app/`, `lib/`, `scripts/` or `e2e/` as of 2026-10-30.

### Constraints the design must keep

- **ADR 0042**: facts become text only in a card; the words live in
  `lib/city/inquiry*.ts`. A kind table in `lib/city` keeps that. Its icon
  is a label (`"tree-pine"`), not a Lucide component: `lib/city` is DOM-
  and React-free. The strip keeps a `Record<label, LucideIcon>`.
- **Plan 052 §4c**: `lib/city/lineage.ts` is its own chunk, the only
  `import()` in `app/_components/inquiry-data.tsx` (`loadLineage`). The
  boot carries none of it. No module the main bundle loads may import
  `lineage.ts` by value. The kind table holds **no lineage pointer**:
  one `import()` serves every kind, so a per-row lazy pointer buys
  nothing. `lineage.ts` keeps its own dispatch inside the chunk.
- **The chunk price** (ADR 0040, "Each feature behind `import()`";
  plan 074, Findings, Part B): a lazy chunk that shares three.js with the
  scene cost +22.7 KB gz first-load JS. `lineage.ts` imports no three.js,
  which is why its chunk is cheap. Nothing in this plan adds an
  `import()` or a three.js import to `lib/city`.
- **Narrowing**: a `Record<Kind, Row>` looked up by `inquiry.kind` gives a
  union of rows whose functions take the intersection of the kinds. Only a
  correlated mapped type keeps the arms narrowed without a cast:
  `{ [K in InquiryKind]: KindRow<InquiryOf<K>> }` with
  `InquiryOf<K> = Extract<Inquiry, { kind: K }>` (or
  `{ [I in Inquiry as I["kind"]]: I }[K]`), indexed inside a function
  generic in `K` (TypeScript issue 47109's pattern). AGENTS.md forbids
  `any` without a reason and the plan forbids casts (STOP).
- **The traffic hour** stays a live read when the question is asked, never
  a value captured when a set is built.
- **Phone memory** (ADR 0047): nothing here may add a field to the stored
  ask solids or the packed tree arrays.
- **Complexity cap 20** (`.oxlintrc.json`): a twelve-arm switch is 13.
  `moreLineage`'s `hedge` body has a dozen `&&`/`===`; inlined into
  `lineage` it would break the cap. It becomes `hedgeLineage` first.

### What is tested today

- Each card function's text: `inquiry.test.ts` (buildings),
  `inquiry-features.test.ts` (tree, monument, bridge),
  `inquiry-more.test.ts` (the six), `inquiry-traffic.test.ts`.
- The dispatch is not: `inquiry.test.ts` calls `inquiryCard` only with
  buildings. Nothing tests that `inquiryCard` routes the other eleven
  kinds to their cards.
- `lineage.test.ts` covers building, tree, bridge, canopy, lamp. Not
  hedge, furniture, stop, landing, monument, traffic, bikes.
- The strip, `kindIcon`, `porous` and `thingKey` have no unit test. No e2e
  asserts the strip (`inquiry-strip` test id appears in no spec).
- E2E, `e2e/city-walk.spec.ts`: "the inquiry card tells what the data
  knows, and where it comes from" and "a tree answers with what the
  city's register says about it" (`@desktop-render`), "touch UI: …
  long-press ask" (`@phone`).
- The fixtures clash by name across files: `inquiry-features.test.ts` and
  `inquiry-more.test.ts` each define `DRESDEN` (different values);
  `ask-items.test.ts` and `ask-more.test.ts` each define `ctx`, `TILE`.

## Steps

### Step 0 — Pin what the dispatch says today (tests only)

On unchanged code, before any refactor:

1. A new test file, `lib/city/inquiry-kinds.test.ts`, with one fixture
   per kind in a table typed
   `{ [K in Inquiry["kind"]]: Extract<Inquiry, { kind: K }> }` — the
   type forces a fixture for a 13th kind. Reuse the shapes of the existing
   tests' fixtures; include a register tree, an orchard tree, a
   playground and a bench, a wall lamp and a hung lamp.
2. **Routing**: for every fixture, `inquiryCard(fx, provenance, credits,
   treeFacts)` `toEqual`s the direct card function's output with the same
   arguments (`canopyCard(fx, provenance, credits)`, `trafficCard(fx)`, …).
   The direct functions' text is pinned by their own tests; this pins the
   route.
3. **Headings**: for every fixture, `inquiryCard(fx, null, credits)`'s
   `kicker` and `title` as literals (the strip's view). Run once to read
   them, then write them in by hand and check each against the card's
   code.
4. **Lineage**: in `lineage.test.ts`, add one literal expectation each
   for `hedge` (one per `source`: `dlm`, `osm`, `lsc`, `osm+lsc`,
   `osm+dom`), `furniture`, `stop`, `landing`, `monument`, `traffic`,
   `bikes` — the full `LineageEntry[]`, captured from the current code.
5. `bun run verify`. Commit: `test(inquiry): pin each kind's route,
   heading and lineage`.

### Step 1 — One dispatch, not two

1. `lib/city/inquiry.ts` `inquiryCard`: replace the six fall-through
   labels with one arm each, calling `canopyCard`, `hedgeCard`,
   `lampCard` (`provenance, credits`) and `furnitureCard`, `stopCard`,
   `landingCard` (`provenance`). Import them from `./inquiry-more`; drop
   the `moreCard` import (≈ line 40).
2. `lib/city/inquiry-more.ts`: delete `moreCard` (≈ 480–499).
3. `lib/city/lineage.ts`: move `moreLineage`'s `hedge` body into
   `function hedgeLineage(l: Lineage, m: HedgeInquiry): void`. In
   `lineage`, give `canopy` (`canopyLineage(l, inquiry, site)`) and
   `hedge` (`hedgeLineage(l, inquiry)`) one arm each and keep `furniture`,
   `lamp`, `landing`, `stop` as one grouped arm calling
   `osmThingLineage(l, inquiry)`. Delete `moreLineage`. `fromMapillary`
   and `lampFromOsm` keep their `MoreInquiry` parameter.
4. `bun run verify`; Step 0's tests and every card test pass unchanged.
   Commit: `refactor(inquiry): one dispatch per card and lineage`.

### Step 2 — Merge the phase-split halves

1. **Cards.** Move everything in `lib/city/inquiry-more.ts` below its
   imports into `lib/city/inquiry-features.ts` (after the bridge card).
   Fold the imports. Drop `import type { MoreInquiry } from
   "./inquiry-more"` (≈ line 23). Rewrite the head comment: the cards of
   every thing that is not a building, each saying what its data knows
   and quoting its source. Delete `furnitureName` (re-check with a grep
   first). Delete `inquiry-more.ts`.
2. Repoint the imports: `lib/city/inquiry.ts` (the six cards),
   `lib/city/lineage.ts` ≈ 33 (`CanopyInquiry`, `MoreInquiry` — keep it
   `import type`), `lib/city/ask-more.ts` ≈ 31 (gone after 3),
   `lib/city/lineage.test.ts` ≈ 11, `lib/city/inquiry-more.test.ts` ≈ 3–10.
   `inquiry-more.test.ts` keeps its own file (its `DRESDEN` clashes with
   the other file's); only its import specifier changes. Renaming it with
   `git mv` is optional.
3. **Picks.** Move everything in `lib/city/ask-more.ts` below its
   imports into `lib/city/ask-items.ts`. Keep one `HeightAt` and one
   `MIN_CROWN_R`. Drop the self-import of `packedCylinderSets`. Delete
   `canopySets` (re-check with a grep). Delete `ask-more.ts`.
4. **The rename.** Delete `MoreContext`. The "more" functions take
   `Pick<AskContext, "offset" | "tile"> & { treeHeightAt: HeightAt }`
   (named, e.g., `OwnGroundContext`) — `askCtx` satisfies it as it
   stands. Every former `ctx.heightAt` in the moved code
   (`standing`, `hanging`, `onWall`, `canopySetsSteps`' `place`,
   `furnitureItem`, `landingItems`, …) reads `ctx.treeHeightAt`. None reads
   `ctx.heightAt`. `canopySetsSteps` still hands `tree-placement.ts`
   `{ heightAt: ctx.treeHeightAt, offset }` — that module's own field name.
5. `app/_components/tile-stream.ts` `askSteps`: import `moreSetsSteps`
   from `@/lib/city/ask-items` and pass `askCtx` itself (it already
   carries `treeHeightAt: terrain.heightAt`), not a second literal.
6. Tests: `ask-more.test.ts` keeps its file and its assertions; its import
   specifier changes and its `ctx` literal's `heightAt` becomes
   `treeHeightAt`. Add one test (in `ask-items.test.ts`): a context whose
   `heightAt` returns 110 and `treeHeightAt` returns 50 stands a lamp, a
   bench and a canopy tree at 50, and a monument at 110.
7. Docs: `docs/rendering.md` ≈ 160 (the asked-things row names
   `lib/city/ask-more.ts`), `docs/transformations.md` ≈ 1912
   (`ask-more.ts`), plan 052 §4e's two file names
   (`lib/city/ask-more.ts`, `lib/city/inquiry-more.ts`). Grep `docs/`,
   `.claude/skills/` and code comments for both names.
8. `bun run verify`. Commit: `refactor(inquiry): one module for the
   cards of things, one for their picks`.

### Step 3 — A heading without a card

1. In `lib/city`, export `kindLabel(inquiry: Inquiry, credits:
   CardCredits): KindLabel`, with
   `KindLabel = { icon: KindIcon; kicker: string; title: string }` and
   `KindIcon` a string union of the thirteen icon names the strip uses
   today (`building`, `tree-pine`, `tree-deciduous`, `landmark`,
   `bridge`, `car`, `bike`, `shrub`, `lamp-floor`, `ferris-wheel`,
   `armchair`, `tram-front`, `anchor`).
2. The words exist once. Each card function computes its kicker and title
   through a small heading helper (`treeHeading(t, facts, credits)`,
   `furnitureHeading(p)`, …) that `kindLabel` calls too, with the facts
   absent. Do not copy a kicker string into `kindLabel`. A building's
   heading needs `mergedFacts`; let `buildingCard` compute its merged facts
   once and pass them to the helper.
3. The furniture icon reads the `FURNITURE` group: "Spielplatz" →
   `ferris-wheel`, else `armchair`. Delete the strip's `PLAY` set.
4. `app/_components/inquiry-strip.tsx`: `kindIcon` becomes
   `const ICONS: Record<KindIcon, LucideIcon>`; the `useMemo` maps
   candidates through `kindLabel(c.inquiry, cardCredits(site))`. Drop the
   `inquiryCard` import.
5. Test (in `inquiry-kinds.test.ts`): for every fixture,
   `kindLabel(fx, credits)`'s kicker and title equal Step 0's literals,
   and its icon equals the one `kindIcon` returned (write the expected
   icons in as literals before you delete `kindIcon`).
6. `bun run verify`. Commit: `refactor(inquiry): the strip reads a
   heading, not a card`.

### Step 4 — The kind table

1. **Spike first** (≤ 1 h, not committed). In a scratch copy of
   `lib/city/inquiry.ts`, write the table type for two kinds (`building`,
   `tree`) and a generic lookup, e.g.

   ```ts
   type InquiryKind = Inquiry["kind"];
   type InquiryOf<K extends InquiryKind> = Extract<Inquiry, { kind: K }>;
   interface KindRow<I extends Inquiry> {
     card: (i: I, input: CardInput) => InquiryCard;
     label: (i: I, credits: CardCredits) => KindLabel;
     porous: (i: I) => boolean;
   }
   type KindTable = { [K in InquiryKind]: KindRow<InquiryOf<K>> };
   ```

   with `CardInput = { credits; provenance; treeFacts }`. Check that a
   function generic in `K` can call `KINDS[i.kind].card(i, input)` and
   that `inquiryCard(inquiry: Inquiry, …)` calls it, with no `as`, under
   both `bun check` and `bun run typecheck:tsc`. If it needs a cast:
   STOP, record the error text in the status row, ship Steps 0–3.
2. Build the table in `lib/city/inquiry.ts` (it holds `buildingCard`; a
   separate module would import it back and make a cycle). Rows: `card`
   (adapting each card function's own arguments from `CardInput` — the
   card functions keep their signatures), `label` (Step 3's helpers),
   `porous` (`building` false; `tree`, `canopy`, `hedge` true;
   `furniture` true for `k === "playground"` only; the rest false).
3. **The vote key.** Feature rows also carry `key`, with today's formats
   exactly (`${kind}:${tile}:${index}` for tree and traffic,
   `bikes:${id}:${position}`, `${kind}:${tile}:${position}` for the
   others). A building has none: its key is `buildingKey(layer,
   objectIndex)`. Write the row type so `key` is required on the eleven
   feature rows and absent on `building` (a conditional row type over
   `K`). If that type reads worse than the switch it replaces, leave
   `thingKey` in the probe — its switch is still checked — and say so in
   the status row.
4. `inquiryCard`, `kindLabel`, and in `app/_components/inquiry-probe.ts`
   `porous` (and `thingKey` if moved) become lookups in the table.
5. `lib/city/lineage.ts` keeps its Step 1 switch (or turns it into its own
   correlated `Record` inside the chunk; optional). It imports from
   `inquiry.ts` by type only, as now. The table imports nothing from
   `lineage.ts`.
6. Tests: Step 0's and Step 3's pass unchanged. Add `porous` per fixture
   (and `key` per feature fixture, if moved) as literals.
7. Docs: ADR 0042's Consequences ("A new kind … adds a ray target from
   its data and lines in `lib/city/inquiry*.ts`") gains: "and a row in the
   kind table (`lib/city/inquiry.ts`), an arm in `lineage.ts`". The
   `new-scene-layer` skill's step 10 (`.claude/skills/new-scene-layer/SKILL.md`
   ≈ 46) says the same. Amend, do not rewrite (`docs-upkeep`).
8. `bun run verify`, the first-load check (Verification). Commit:
   `refactor(inquiry): one row per kind`.

### Step 5 (optional) — `answered` into the adapters

**Decide before starting.** Do it only if the tram kind is planned next
(ask the maintainer, or look for a plan or a `tram-ask.ts`). A tram
inquiry would need the operator's credit and a live read, the way traffic
needs its hour: a 13th arm in `answered` is the cost this step removes.
Without a tram kind on the way, skip it and say so in the status row:
four bodies in one closure are cheap.

1. **The tree's facts URL.** Add `TileStreamContext.treeFactsUrl:
   (tileId: string) => string | undefined` beside `tileBounds`
   (`tile-stream.ts` ≈ 300). `create-app.ts` sets it from today's
   `treeFactsUrl` (≈ 2185). `askCtx` carries the tile's URL (one string a
   tile); `treeInquiry` (`ask-items.ts` ≈ 85) sets `factsUrl` when the
   inquiry is made, at hit time. No per-tree storage.
2. **Traffic.** `trafficAskSet(group, features, tile, answer: { credit?:
   string; hour: () => TrafficHourStatus | undefined })` sets both in its
   `nearest`, which runs when the question is asked — the hour stays live.
   `startDataLayers` (`data-layers-feature.ts` ≈ 83) binds them:
   `askSet: (g, f, t) => trafficAskSet(g, f, t, { credit, hour:
   overlays.trafficHour })`, the credit from a new option
   (`create-app.ts` ≈ 1844 passes `opts.site.dataLayers?.traffic?.credit`).
   `TrafficBuilder.askSet`'s type follows; `tile-stream.ts` ≈ 898 calls it
   unchanged.
3. **Bikes.** `bikeAskSets(counters, ground, now, credit?)`; the overlays'
   `asks` (`data-overlays.ts` ≈ 166) pass the site's bike credit from the
   same new options.
4. Delete `answered`, `treeFactsUrl`, `layerSources` and `trafficHour` in
   `create-app.ts`; `inquireAt` maps candidates as the probe gave them.
5. Tests: `traffic-ask.test.ts` and `bike-ask.test.ts` assert the credit,
   and the traffic hour read at `nearest` (a counter `hour` called once
   per question, not at build). `tile-stream.test.ts` ≈ 696 builds a
   `TrafficBuilder`: update its `askSet`.
6. E2E: the tree spec checks the register's lines, which need `factsUrl`
   — it must still pass.
7. Commit: `refactor(inquiry): what a card needs comes with the pick`.

### Step 6 (independent, small) — The crown says its form; one pier reach

Ships before, between or after the others.

1. `PIER_REACH` (12 m) is in `app/_components/bridge-ask.ts` ≈ 17 and
   `app/_components/selection-shape.ts` ≈ 76. Export it from
   `bridge-ask.ts` (the pick owns the reach; the outline follows it) and
   import it in `selection-shape.ts`.
2. The outline reads the crown form from the kind today
   (`create-app.ts` `outlineShape`, ≈ 2150–2159: `tree`/`canopy`, then
   `cone`), and `solidShape` (`selection-shape.ts` ≈ 125) takes the second
   solid as the crown (`k === 1 ? crown : null`). Let the crown solid say
   it: `AskSolid`'s cylinder member gains an optional
   `crown?: "cone" | "ellipsoid"` (`lib/city/ask-solids.ts` ≈ 44). Set it
   only where the solids are made at hit time — `packedTreeSet`'s `hit` and
   `nearest` (`ask-items.ts` ≈ 108–176), from the target just made
   (`cone === true` → `"cone"`). The stored solids of lamps, hedges,
   furniture and landings never get the field (ADR 0047).
3. `solidShape(solids)` drops its `crown` parameter and reads
   `s.crown`; `CrownForm` goes. `outlineShape` passes the solids alone.
   `selection-shape.test.ts` (its calls with `"ellipsoid"`/`"cone"`)
   builds crown solids instead; the same three assertions hold.
4. Whether a trunk or a post should also carry a role: no. Nothing draws
   them differently.
5. Commit: `refactor(inquiry): the crown solid carries its form`.

## Verification

After every step:

- `bun run fix`, then `bun run verify` (lint, `bun check`, units).
- `bun run typecheck:tsc` for Steps 4 and 5 (the reference checker).
- `git diff --stat` touches only the step's files.
- The card tests pass with their assertions unchanged:
  `lib/city/inquiry.test.ts`, `inquiry-features.test.ts`,
  `inquiry-more.test.ts` (wherever it lives after Step 2),
  `inquiry-traffic.test.ts`, `lineage.test.ts`, and Step 0's file. A diff
  in any of their `expect` lines is a STOP.

After Steps 1–4 (one production build each, or one at the end of a
branch that carries several):

- E2E: `bun run test:e2e --grep "inquiry card|tree answers|long-press ask"`
  (production build; the three specs listed in Findings).
- **The lineage chunk stays lazy.** After `next build`, a string only
  `lineage.ts` holds — `die Krone als Grundform, ohne Gattung` — is in
  exactly one file under `.next/static/`, and that file holds no string
  of the strip (`Hier auch · vorn zuerst`) or the card
  (`inquiry-data-toggle`). Then load `/dresden?scene=lite` headless and
  list the `/_next/static/*.js` it fetches until `__poc.ready` (plan
  074's method, Findings, Part B): the lineage file is not among them;
  it is fetched when *Daten* unfolds.
- **First-load JS** (gzip −9 of that list): within ±0.5 KB of the base
  commit's. These steps move code; they add none.

After Step 6: one plate of an asked cone tree, a round crown and a
bridge from an oblique angle on a real GPU (`bun run shots`), or, without
a GPU, the headless outline in the `@desktop-render` tree spec. The
outline must look as before.

## STOP conditions

Stop, leave the tree green at the last finished step, and write the
reason in the status row if:

- **Any card text changes**: a kicker, title, address, fact, id or source
  line, in any test, the e2e specs or a manual look at the card.
- **The lineage chunk enters the first load**, or first-load JS grows
  by more than 0.5 KB gz in Steps 1–4.
- **Narrowing needs a cast**: any `as`, `!` added to silence a kind, or
  `any` in the table or its lookup. (Step 4's spike decides this before
  any rewrite.)
- **The ground rename does not hold**: a "more" pick reads
  `AskContext.heightAt`, or the new two-ground test fails.
- **The traffic hour is read at build time**, not when the question is
  asked (Step 5).
- **A stored ask solid or the packed tree array gains a field** (Step 6).
- A kind was added since this plan (drift check): redo Findings first.

## Out of scope

- The tram kind itself (`tram-ask.ts`, the card, *Mitfahren*): its own
  plan; this one only makes room for it.
- New kinds (squares, plan 052 §4e), new fields, new fetches.
- Any change to what a card says, its order or its methods.
- `lineage.ts`'s content and its chunk boundary (plan 052 §4c).
- The building's pick, ensemble and key (`city-layer.ts`).
- The bridge and traffic halves of `outlineShape` (their drawn triangles).
- Splitting the merged ≈ 1 000-line files again by subject (trees,
  street things, structures): possible later, not needed for this.
- `inquiry-card.tsx`'s `useTreeFacts` and `inquiry-data.tsx`'s building
  checks: one-kind reads, not dispatches.
- Plans 046 (god modules) and 074 (the lazy seam): this plan neither
  needs nor blocks them.

## Maintenance notes

- After Step 4, a new kind is: its inquiry type in
  `lib/city/inquiry-features.ts` (added to `FeatureInquiry`), its card
  and heading helper there, one row in the kind table, its pick in
  `lib/city/ask-items.ts` (or an `app/_components/*-ask.ts` for a drawn
  mesh or a data layer), one arm in `lineage.ts`, a fixture in
  `inquiry-kinds.test.ts` (its mapped type demands one), and an icon
  name in `KindIcon` plus the strip's `ICONS` only for a new icon. The
  type check and the lint name each missing piece.
- After Step 5, what a card needs beyond the pick comes with the pick:
  a kind that needs a live read binds a closure in its adapter, read in
  `nearest`, never captured at build.
- `heightAt` against `treeHeightAt` is a trap a reader falls into: keep
  the two-ground test, and keep the names apart in any context added
  later.
- Plan 052 §4e and the README backlog's *ride a tram* point here once
  this plan is DONE; condense it into `completed.md` per the README's
  Lifecycle.
