# Plan 012: Drive the look controls from one table and validate the Snapshot contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2079c3a..HEAD -- app/_components/city-walk.tsx app/_components/poc-debug.ts app/_components/create-app.ts e2e/snapshot-shot.spec.ts e2e/city-walk.spec.ts lib/city/`
> Plans 008–011 touch `city-walk.tsx` (props, WebGL preflight),
> `poc-debug.ts` (`layerStats`, `shadowRenders`) and `create-app.ts` —
> expected drift. Re-locate every excerpt below by its text; a missing
> excerpt is a STOP.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/008-verification-net.md; run after 010 and 011 (they touch `city-walk.tsx`)
- **Category**: tech-debt (deferred finding #21 from the 2026-09-18 run, plus the snapshot-validation defect)
- **Planned at**: commit `2079c3a`, 2026-09-20

## Why this matters

Twenty-one 0..1 "look" sliders are each wired by hand in six places that
must agree and that nothing checks: the `CityWalkHandle` interface and its
forwarder, `PocDebugInfo` (the `__poc` test hook), a `useState` in the HUD,
a `PctSlider` JSX block, the `Snapshot.look` type, the snapshot copy/apply
code, the `__poc` registration list, and the e2e screenshot harness's own
copy of the whole shape and apply loop. Adding one slider is ~16 edits in 4–5
files; the git history shows 35 of 96 commits touching the three core files
together. `city-walk.tsx` has 39 `useState` calls and a 62-prop controls
component.

The same file applies a pasted Snapshot after checking one field
(`camera.pos.x`), so a trimmed or hand-edited snapshot — the documented QA
workflow — yields NaN camera matrices, NaN uniforms and `undefined` slider
values while reporting "Snapshot applied".

After this plan: `lib/city/look-controls.ts` is the one table (key, label,
group, snapshot key, handle setter, max); the HUD, the handle interface, the
`__poc` hook, the snapshot serializer/parser and the e2e harness all read
it; `parseSnapshot` validates every field before anything is applied; and
the HUD re-applies its state to a freshly created handle, closing the latent
desync. The `__poc` setter *names* do not change — they are the e2e
contract.

## Current state

### The handle side

`app/_components/create-app.ts:186-287` — `CityWalkHandle` declares 28
`set*` methods with one-line doc comments, e.g.:

```ts
  /** fog amount 0..1 (0 = clear day, 1 = thick painterly haze) */
  setAtmosphere: (amount: number) => void;
  /** building storey contour-line (Höhenlinien) strength 0..1 */
  setBuildingBands: (strength: number) => void;
  ...
  /** river-mist (Flussnebel) strength 0..1 over the water surface */
  setWaterMist: (strength: number) => void;
```

and `CameraState` (`:117-126`):

```ts
export interface CameraState {
  epsg: { x: number; y: number };
  fov: number;
  /** 0 = north, clockwise positive (east) */
  headingDeg: number;
  mode: MovementMode;
  /** + = looking up, - = looking down */
  pitchDeg: number;
  pos: { x: number; y: number; z: number };
}
```

The handle literal at `:1225-1364` implements each setter as a one-liner
(uniform `.value` writes, `postStack.*`, loops over `vegControls`, etc.).
The 21 percent-style setters are exactly: `setAtmosphere`, `setHeightFog`,
`setWaterMist`, `setDepthGrading`, `setBuildingTransparency`,
`setBuildingGroundShade`, `setBuildingBands`, `setBuildingRim`,
`setBuildingTint`, `setBuildingRoofTint`, `setBuildingRoofVibrance`,
`setBuildingEave`, `setBuildingDuskGlow`, `setBuildingRoughness`,
`setMeadowNdvi`, `setTreeShimmer`, `setTreeTranslucency`,
`setTreeLeafFlutter`, `setTreeLeafBright`, `setContactShadows`,
`setPaperGrain`. The non-percent look controls are `setDepthOfField(boolean)`,
`setFocusMode("auto" | "manual")`, `setFocusDistance(metres)`,
`setTreeMultiTuft(boolean)`.

### The HUD side (`app/_components/city-walk.tsx`)

- `:170-209` — `SNAPSHOT_VERSION = 1` and the `Snapshot` interface whose
  `look` lists 21 `…Pct` numbers (six required: `contactPct`, `fogPct`,
  `gradingPct`, `grainPct`, `transparencyPct`; the rest optional) plus `dof`,
  `focusDistanceM?`, `focusMode?`, `multiTuft?`.
- `:221-262` — `PctSlider({ description, disabled, id, label, max = 100, min = 0, onChange, step = 1, unit = "%", value })`.
- `:265-298` — `ControlGroup({ children, defaultOpen, icon, title })`.
- `:470-534` — `SceneControlsProps` (62 props); `:541-989` — `SceneControls`
  renders the groups **Sun & time**, **Atmosphere**, **Buildings**,
  **Vegetation**, **Rendering**, **Scene**, **Snapshot**. Each percent slider
  is a block like:

  ```tsx
        <PctSlider
          description="Haze pooling along the valley floor / the Elbe"
          id="height-fog"
          label="Talnebel"
          onChange={(n) => {
            setHeightFog(n);
            handleRef.current?.setHeightFog(n / 100);
          }}
          value={heightFog}
        />
  ```

- `:1009-1082` — 37 `useState` calls in `CityWalk`, 21 of them for the
  percent sliders, initialised as `Math.round(DEFAULT_X * 100)` from the
  `DEFAULT_*` constants imported at `:81-121` (`DEFAULT_ATMOSPHERE`,
  `DEFAULT_HEIGHT_FOG`, `DEFAULT_CONTACT_SHADOWS`, `DEFAULT_DEPTH_GRADING`,
  `DEFAULT_PAPER_GRAIN`, `DEFAULT_MEADOW_NDVI`, `DEFAULT_TREE_*`,
  `DEFAULT_BUILDING_*`, `DEFAULT_CLAY_TRANSPARENCY`, `DEFAULT_WATER_MIST`).
- `:1147-1206` — on boot: `handleRef.current = h;` then a hand-written
  `updatePocDebug({ ready: true, …, setAtmosphere: h.setAtmosphere, … })`
  listing every setter; the handle is seeded with the sun only
  (`setSun(composeDate(INITIAL_DATE, INITIAL_MINUTES))`), never with the
  current slider state.
- `:1254-1297` — `copySnapshot` builds `look` by listing all 21 keys.
- `:1301-1360` — `applyOptionalLook` (a 16-row tuple table
  `[look.x, setX, h.setY]`) and `applyLook`.
- `:1362-1398` — `applySnapshot`:

  ```ts
    let snap: Snapshot;
    try {
      snap = JSON.parse(snapshotText) as Snapshot;
    } catch {
      setSnapshotMsg("Invalid snapshot JSON");
      return;
    }
    if (!snap.camera?.pos || typeof snap.camera.pos.x !== "number") {
      setSnapshotMsg("Snapshot missing or malformed camera");
      return;
    }
    h.applyCameraState(snap.camera);
    ...
  ```

- `:1400-1467` — `controlsFields = <SceneControls … />` passing all 62 props.
- `:1519-1534` and `:1561-1585` — the coarse-pointer action bar and the
  sidebar footer (unchanged by this plan).

The slider DOM ids (kept stable — the mobile e2e test finds the drawer by
the label text `Boden-Verlauf`, `e2e/city-walk.spec.ts:492`): `atmosphere`,
`height-fog`, `water-mist`, `depth-grading`, `building-transparency`
(max 90), `building-ground-shade`, `building-bands`, `building-rim`,
`building-tint`, `building-roof-tint`, `building-roof-vibrance`,
`building-eave`, `building-dusk-glow`, `building-roughness`, `meadow-ndvi`,
`tree-shimmer`, `tree-translucency`, `tree-leaf-flutter`, `tree-leaf-bright`,
`contact-shadows`, `paper-grain`.

### The hook side

`app/_components/poc-debug.ts:19-118` — `PocDebugInfo` re-declares every
setter as an optional member with a paraphrased comment, e.g.
`setBuildingBands?: (strength: number) => void;`. The e2e suite calls them
by name (`e2e/city-walk.spec.ts:345-378`).

### The harness side

`e2e/snapshot-shot.spec.ts:23-60` re-types `Snapshot` by hand (without `v`)
and `:85-156` applies every look field one `if` at a time inside
`page.evaluate`.

### Conventions

- `lib/city/` is three-free and DOM-free; a Playwright spec may import a
  pure module from there with a relative path (`../lib/city/…`).
- React Compiler is on (`next.config.ts`); hooks rules apply; refs are not
  written during render.
- Complexity cap (ultracite): table-driven code is the way to stay under it
  (the existing `pctFields` tuple table at `:1304-1325` was added for exactly
  that reason).
- Unit tests colocated; model `lib/city/*.test.ts` on `lib/city/tfw.test.ts`.
- `components/ui/slider` takes `value={[n]}` and `onValueChange` (see
  `PctSlider`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Full gate | `bun run verify` | exit 0 |
| One test file | `bun test lib/city/snapshot.test.ts` | all pass |
| E2E | `bun run test:e2e` | all pass |
| Shot harness (manual, real GPU) | `bun run shots` (plan 008) | writes `shots/*.png` |

## Suggested executor toolkit

- `vercel-react-best-practices` skill for the state/derivation pattern in
  Step 3 (keep derived values out of state; one `look` record).

## Scope

**In scope**:

- `lib/city/look-controls.ts` (create) + `look-controls.test.ts` (create)
- `lib/city/snapshot.ts` (create) + `snapshot.test.ts` (create)
- `app/_components/look-defaults.ts` (create)
- `app/_components/city-walk.tsx`
- `app/_components/poc-debug.ts`
- `app/_components/create-app.ts` (only `CameraState` and the `CityWalkHandle` interface header)
- `e2e/snapshot-shot.spec.ts`

**Out of scope**:

- The handle *implementations* in `bootApp` (the one-line forwarders stay).
- `PctSlider`, `ControlGroup`, `SidebarMinimap`, `ScenicViews`, the sun/date
  controls, the Scene group, the footer — keep their markup.
- `e2e/city-walk.spec.ts` — it must keep passing unchanged (that is the
  proof the `__poc` names survived).
- Any visual change; any new slider.

## Git workflow

- Branch: `advisor/012-look-controls-table`.
- Commits per step: `refactor:` for 1–5, `fix:` for the snapshot validation
  (Step 2's use in Step 4), `test:` where a step is test-only.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The table (`lib/city/look-controls.ts`)

```ts
/**
 * The 0..1 "look" controls, declared ONCE. The HUD renders sliders from this
 * table, the handle/`__poc` expose one setter per row, and snapshots
 * serialise one `<snapshotKey>` per row — add a control here and every
 * consumer follows. No THREE, no DOM (the e2e harness imports this file).
 */
export type LookGroup = "atmosphere" | "buildings" | "vegetation" | "rendering";

export type LookSetterName =
  | "setAtmosphere"
  | "setHeightFog"
  | "setWaterMist"
  | "setDepthGrading"
  | "setBuildingTransparency"
  | "setBuildingGroundShade"
  | "setBuildingBands"
  | "setBuildingRim"
  | "setBuildingTint"
  | "setBuildingRoofTint"
  | "setBuildingRoofVibrance"
  | "setBuildingEave"
  | "setBuildingDuskGlow"
  | "setBuildingRoughness"
  | "setMeadowNdvi"
  | "setTreeShimmer"
  | "setTreeTranslucency"
  | "setTreeLeafFlutter"
  | "setTreeLeafBright"
  | "setContactShadows"
  | "setPaperGrain";

/** What every consumer of the look controls must provide: one 0..1 setter per row. */
export type LookTarget = Record<LookSetterName, (value01: number) => void>;

export interface LookControlDef {
  description?: string;
  group: LookGroup;
  /** DOM id of the slider (stable: tests find controls by it) */
  id: string;
  /** state key */
  key: LookKey;
  label: string;
  /** slider maximum in percent (default 100) */
  max?: number;
  /** handle / __poc setter that receives value / 100 */
  setter: LookSetterName;
  /** key inside Snapshot.look — kept for compatibility with saved snapshots */
  snapshotKey: string;
}

export type LookKey =
  | "fogAmount" | "heightFog" | "waterMist" | "grading"
  | "transparency" | "groundShade" | "bands" | "rim" | "tint" | "roofTint"
  | "roofVibrance" | "eave" | "duskGlow" | "roughness"
  | "meadowNdvi" | "shimmer" | "translucency" | "leafFlutter" | "leafBright"
  | "contact" | "grain";

/** Percent values (integers 0..max) of every look control. */
export type LookPct = Record<LookKey, number>;

export const LOOK_CONTROLS: readonly LookControlDef[] = [
  { key: "fogAmount", id: "atmosphere", label: "Fog", group: "atmosphere", setter: "setAtmosphere", snapshotKey: "fogPct" },
  { key: "heightFog", id: "height-fog", label: "Talnebel", description: "Haze pooling along the valley floor / the Elbe", group: "atmosphere", setter: "setHeightFog", snapshotKey: "heightFogPct" },
  // … one row per slider, in the ORDER the HUD renders them today (copy each
  // label/description verbatim from city-walk.tsx; transparency has max: 90)
];

export const LOOK_BY_KEY: Readonly<Record<LookKey, LookControlDef>> = /* built from LOOK_CONTROLS */;

export function clampPct(def: LookControlDef, value: number): number {
  const max = def.max ?? 100;
  return Math.min(Math.max(Math.round(value), 0), max);
}
```

Fill all 21 rows from the JSX at `city-walk.tsx:660-898` (labels,
descriptions, ids, order, `max: 90` on transparency).

`lib/city/look-controls.test.ts`: 21 rows; `key`, `id`, `setter`,
`snapshotKey` are each unique; every `setter` starts with `set`; every
`snapshotKey` ends with `Pct`; every `group` is one of the four;
`clampPct` clamps `-5 → 0`, `150 → 100`, `95 → 90` for transparency,
`49.6 → 50`.

**Verify**: `bun test lib/city/look-controls.test.ts` → pass;
`bun test lib/city/purity.test.ts` → pass.

### Step 2: The snapshot contract (`lib/city/snapshot.ts`)

```ts
import { LOOK_CONTROLS } from "./look-controls";

export type MovementModeJson = "fly" | "walk";

/** Camera pose as it round-trips through JSON (create-app's CameraState IS this type). */
export interface CameraStateJson {
  epsg: { x: number; y: number };
  fov: number;
  headingDeg: number;
  mode: MovementModeJson;
  pitchDeg: number;
  pos: { x: number; y: number; z: number };
}

export interface SnapshotLook {
  /** per-control percentages, keyed by LookControlDef.snapshotKey (all optional: older snapshots omit newer controls) */
  [pctKey: string]: number | boolean | string | undefined;
  dof?: boolean;
  focusDistanceM?: number;
  focusMode?: "auto" | "manual";
  multiTuft?: boolean;
}

export interface Snapshot {
  camera: CameraStateJson;
  /** ISO instant driving the sun */
  date: string;
  look?: SnapshotLook;
  v: number;
}

export const SNAPSHOT_VERSION = 1;

export type SnapshotParse =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: string };

/** Parses and validates pasted snapshot JSON; never throws; rejects anything non-finite or out of enum. */
export function parseSnapshot(text: string): SnapshotParse
```

Validation rules (each failure returns `{ ok: false, reason }` with a
one-line human reason such as `"camera.headingDeg must be a finite number"`):

- `JSON.parse` failure → `"Invalid snapshot JSON"`.
- top level is an object; `v` is a finite number (unknown versions are
  accepted — forward compatibility — but non-numbers are not).
- `camera`: `pos.{x,y,z}`, `epsg.{x,y}`, `fov`, `headingDeg`, `pitchDeg`
  finite numbers (`1e999` parses to `Infinity` and must be rejected);
  `mode` ∈ {`walk`, `fly`}; `fov` in (0, 180).
- `date`: a string with `!Number.isNaN(Date.parse(date))`.
- `look`, when present: for every `LOOK_CONTROLS` row whose `snapshotKey` is
  present, the value is a finite number (range is clamped by the applier, not
  rejected); `dof`/`multiTuft` booleans when present; `focusMode` ∈ {`auto`,
  `manual`} when present; `focusDistanceM` finite ≥ 1 when present. Unknown
  keys are ignored.

Keep each rule in a small helper (`finite(v, path)`, `checkCamera`,
`checkLook`) to stay under the complexity cap.

`lib/city/snapshot.test.ts`: a valid snapshot round-trips (`ok: true`,
deep-equal); malformed JSON; missing camera; `headingDeg: "42"`;
`pos.y: 1e999` (Infinity); `mode: "hover"`; `date: "yesterday"`;
`look.fogPct: "50"`; `look.focusMode: "fixed"`; a snapshot with no `look`
is accepted; an unknown `look.sparklePct` is accepted and preserved; a
legacy snapshot with only the six originally-required percent keys is
accepted.

**Verify**: `bun test lib/city/snapshot.test.ts` → all pass (≥ 12 cases).

### Step 3: One `CameraState`, one `LookTarget`

1. `create-app.ts`: replace the `CameraState` interface body with
   `export type CameraState = CameraStateJson;` (import the type from
   `@/lib/city/snapshot`; `MovementMode` from `fps-movement` is the same
   union — if it is not literally `"walk" | "fly"`, STOP).
2. `create-app.ts`: change `export interface CityWalkHandle {` to
   `export interface CityWalkHandle extends LookTarget {` and delete the 21
   percent setters from the interface body (move each one-line doc comment
   onto the corresponding row of `LOOK_CONTROLS` as `description` if the row
   has none, otherwise drop it — the table is now the documentation). Keep
   `setDepthOfField`, `setFocusMode`, `setFocusDistance`, `setTreeMultiTuft`,
   `setSun`, `setMovementMode`, `setMoveInput` and everything else. The
   handle literal in `bootApp` needs no change (the members still exist).
3. `poc-debug.ts`: `export interface PocDebugInfo extends Partial<LookTarget> {`
   and delete the 21 percent members from its body. Keep the rest.

**Verify**: `bun typecheck` → exit 0 (the compiler proves the handle
literal still satisfies every `LookTarget` member).

### Step 4: Defaults and the HUD rewrite

1. Create `app/_components/look-defaults.ts`:

   ```ts
   import type { LookPct } from "@/lib/city/look-controls";
   // imports of the DEFAULT_* constants exactly as city-walk.tsx:81-121 has them today
   const pct = (v: number) => Math.round(v * 100);
   /** Initial percent value of every look slider — mirrors the scene's own defaults. */
   export const DEFAULT_LOOK_PCT: LookPct = {
     fogAmount: pct(DEFAULT_ATMOSPHERE),
     heightFog: pct(DEFAULT_HEIGHT_FOG),
     ...
   };
   ```

   Add a test (`look-defaults.test.ts`) asserting every `LookKey` has an
   integer value in `[0, max]`.
2. In `city-walk.tsx`:
   - Replace the 21 percent `useState` calls with
     `const [look, setLook] = useState<LookPct>(DEFAULT_LOOK_PCT);` and add

     ```ts
     const setLookValue = (key: LookKey, value: number) => {
       const def = LOOK_BY_KEY[key];
       const v = clampPct(def, value);
       setLook((prev) => (prev[key] === v ? prev : { ...prev, [key]: v }));
       handleRef.current?.[def.setter](v / 100);
     };
     ```

   - Add a small component:

     ```tsx
     /** The percent sliders of one control group, rendered from LOOK_CONTROLS. */
     function LookSliders({ group, look, onLook }: { group: LookGroup; look: LookPct; onLook: (key: LookKey, value: number) => void }) {
       return (
         <>
           {LOOK_CONTROLS.filter((def) => def.group === group).map((def) => (
             <PctSlider
               description={def.description}
               id={def.id}
               key={def.key}
               label={def.label}
               max={def.max}
               onChange={(n) => onLook(def.key, n)}
               value={look[def.key]}
             />
           ))}
         </>
       );
     }
     ```

     and use `<LookSliders group="atmosphere" look={look} onLook={onLook} />`
     etc. in place of the 21 hand-written `PctSlider` blocks — keeping the
     non-percent controls (Multi-Tuft switch, DoF switch + `FocusControls`,
     the sun/date fields, the Scene and Snapshot groups) exactly where they
     are today.
   - Shrink `SceneControlsProps` to: `look`, `onLook`, `dof`, `setDof`,
     `focusMode`, `setFocusMode`, `focusDistance`, `setFocusDistance`,
     `multiTuft`, `setMultiTuft`, `day`, `minutes`, `sun`, `updateSun`,
     `mode`, `coarse`, `handleRef`, `insertBuilding`, `copySnapshot`,
     `applySnapshot`, `snapshotText`, `setSnapshotText`, `snapshotMsg`
     (23 props).
   - `copySnapshot`: build `look` as

     ```ts
     const lookJson: SnapshotLook = { dof, focusMode, focusDistanceM: focusDistance, multiTuft };
     for (const def of LOOK_CONTROLS) {
       lookJson[def.snapshotKey] = look[def.key];
     }
     ```

   - `applySnapshot`: use `parseSnapshot(snapshotText)`; on `ok: false` set
     `snapshotMsg` to `reason` and return; then `h.applyCameraState(snap.camera)`,
     the date handling as today, and one loop for the percent controls:

     ```ts
     const applyLookPct = (h: CityWalkHandle, lookJson: SnapshotLook) => {
       const next = { ...look };
       for (const def of LOOK_CONTROLS) {
         const raw = lookJson[def.snapshotKey];
         if (typeof raw === "number") {
           next[def.key] = clampPct(def, raw);
           h[def.setter](next[def.key] / 100);
         }
       }
       setLook(next);
     };
     ```

     followed by the four non-percent fields (as `applyOptionalLook` does
     today for `focusMode`, `focusDistanceM`, `multiTuft`, plus `dof`).
     Delete `applyOptionalLook`, `applyLook` and the local `Snapshot`
     interface (import `Snapshot`, `SnapshotLook`, `SNAPSHOT_VERSION` from
     `@/lib/city/snapshot`).
   - `__poc` registration: keep the explicit non-look members and add the
     look setters with one loop:

     ```ts
     const lookSetters: Partial<LookTarget> = {};
     for (const def of LOOK_CONTROLS) {
       lookSetters[def.setter] = h[def.setter];
     }
     updatePocDebug({ ...lookSetters, ready: true, /* …the existing non-look members… */ });
     ```

   - Re-seed a fresh handle right after `handleRef.current = h;`:

     ```ts
     // A remounted handle boots at the scene defaults; push the HUD's current
     // state so sliders and scene never disagree.
     for (const def of LOOK_CONTROLS) {
       h[def.setter](look[def.key] / 100);
     }
     h.setDepthOfField(dof);
     h.setFocusMode(focusMode);
     h.setFocusDistance(focusDistance);
     h.setTreeMultiTuft(multiTuft);
     ```

     (`look`, `dof`, … are read from the closure of the effect's first run;
     with the current single-mount lifecycle they equal the defaults — the
     value is in the future tile-switch case, and the compiler will flag the
     dependency array if it disagrees: list them, and confirm the effect
     still runs once per mount by checking `__poc.frames` keeps counting.)

**Verify**: `bun run verify` → exit 0. `bunx playwright test e2e/city-walk.spec.ts`
→ all pass **unchanged** (this proves the `__poc` names, the labels, and the
slider ids survived). `grep -c "useState" app/_components/city-walk.tsx` → ≤ 18.

### Step 5: The harness reads the same table

In `e2e/snapshot-shot.spec.ts`:

- Delete the local `Snapshot` interface; `import type { Snapshot } from "../lib/city/snapshot";`
  and `import { LOOK_CONTROLS } from "../lib/city/look-controls";`.
- Replace the 16 `if (s.look.xPct !== undefined)` blocks by passing the table
  into the page:

  ```ts
      await page.evaluate(
        ([s, defs]) => {
          const api = window.__poc;
          if (!api?.applyCameraState) {
            throw new Error("snapshot api unavailable");
          }
          api.applyCameraState(s.camera);
          api.setSunIso?.(s.date);
          const look = s.look ?? {};
          for (const def of defs) {
            const raw = look[def.snapshotKey];
            const setter = api[def.setter];
            if (typeof raw === "number" && setter) {
              setter(raw / 100);
            }
          }
          if (look.dof !== undefined) api.setDepthOfField?.(look.dof);
          if (look.focusMode !== undefined) api.setFocusMode?.(look.focusMode);
          if (look.focusDistanceM !== undefined) api.setFocusDistance?.(look.focusDistanceM);
          if (look.multiTuft !== undefined) api.setTreeMultiTuft?.(look.multiTuft);
        },
        [snap, LOOK_CONTROLS] as const
      );
  ```

  (`api[def.setter]` is typed because `PocDebugInfo extends Partial<LookTarget>`.)
- Validate the file with `parseSnapshot` right after reading it and
  `throw new Error(reason)` on failure so a broken shot fails loudly instead
  of rendering the defaults.

**Verify**: `SHOTS=1 bunx playwright test --list` → lists zero tests when
`shots/` is empty, without a module-resolution error. Then create a scratch
`shots/probe.json` by copying a snapshot from the running app (`bun dev`,
Snapshot → Copy) and run `bun run shots` on a machine with a display: the
PNG renders with the copied look. Delete the probe afterwards (`shots/` is
gitignored either way).

## Test plan

- `lib/city/look-controls.test.ts` (uniqueness/shape, `clampPct`),
  `lib/city/snapshot.test.ts` (≥ 12 validation cases),
  `app/_components/look-defaults.test.ts`.
- e2e: `city-walk.spec.ts` unchanged and green (the contract test);
  `snapshot-shot.spec.ts` via `bun run shots` on a real GPU (manual).
- Manual in `bun dev`: paste `{"v":1,"camera":{"pos":{"x":0}},"look":{}}`
  → the message names the missing field and nothing moves; paste a real
  snapshot with `"fogPct": 250` → fog slider shows 100.

## Done criteria

- [ ] `bun run verify` exits 0; `bun run test:e2e` exits 0 with `e2e/city-walk.spec.ts` unmodified
- [ ] `test -f lib/city/look-controls.ts && test -f lib/city/snapshot.ts && test -f app/_components/look-defaults.ts`
- [ ] `grep -c "useState" app/_components/city-walk.tsx` → ≤ 18
- [ ] `grep -c "handleRef.current?.set" app/_components/city-walk.tsx` → ≤ 6
- [ ] `grep -n "Pct?: number\|Pct: number" app/_components/city-walk.tsx e2e/snapshot-shot.spec.ts` → 0 matches
- [ ] `grep -n "extends LookTarget" app/_components/create-app.ts` → 1; `grep -n "extends Partial<LookTarget>" app/_components/poc-debug.ts` → 1
- [ ] `grep -n "parseSnapshot" app/_components/city-walk.tsx e2e/snapshot-shot.spec.ts` → matches in both
- [ ] `grep -n "LOOK_CONTROLS" e2e/snapshot-shot.spec.ts` → ≥ 1
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- `MovementMode` is not exactly `"walk" | "fly"`.
- Playwright cannot import `../lib/city/look-controls` from the spec (report
  the resolution error; do not copy the table into the spec).
- `e2e/city-walk.spec.ts` fails after Step 4 — a `__poc` name, a label or a
  slider id changed; find the diff, do not edit the spec.
- The ultracite complexity cap rejects `CityWalk` even after the rewrite —
  report which function; do not add `biome-ignore`.

## Maintenance notes

- Adding a look slider is now: one row in `LOOK_CONTROLS`, one default in
  `look-defaults.ts`, one setter in the `bootApp` handle literal. The
  compiler enforces the third (`CityWalkHandle extends LookTarget`); the e2e
  harness and the snapshot format follow automatically.
- `snapshotKey` values are the persisted format: never rename one (old
  snapshots would silently lose that slider); add a new key and keep the old
  one readable if a control is ever renamed.
- The handle setters still do not clamp their input (only the HUD path
  does); `__poc` callers can still pass 3.0. A clamp at the handle boundary
  is a one-line follow-up per setter if it ever matters.
- Deferred, related: `Xyz`/focus-debug/render-info shapes are still spelled
  twice (`create-app.ts`, `poc-debug.ts`); a shared `lib/city/math.ts` for
  `clamp`/`smoothstep`/`DEG2RAD`; and splitting the 900-line `bootApp` —
  see `plans/README.md`.
