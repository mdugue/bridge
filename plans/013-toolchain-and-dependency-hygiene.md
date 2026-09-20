# Plan 013: One type-checker, current dependencies, and a tidy agent/editor surface

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2079c3a..HEAD -- package.json bun.lock tsconfig.json .mcp.json .claude/settings.json skills-lock.json .github/dependabot.yml .vscode/ types/three-mesh-bvh.d.ts lib/city/sun.ts lib/city/sun.test.ts AGENTS.md README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (Plan 008 adds a `shots` script to
> `package.json` and edits `AGENTS.md:147-149` — expected.)

## Status

- **Priority**: P2
- **Effort**: M (twelve small, independently verifiable steps)
- **Risk**: MED (toolchain changes; each step has its own gate)
- **Depends on**: none (run it last of 008–013 so the lockfile changes do not disturb the other plans' `--frozen-lockfile` installs)
- **Category**: migration / dx / security
- **Planned at**: commit `2079c3a`, 2026-09-20

## Why this matters

Three different TypeScript compilers check this repo: `bun typecheck` runs
`tsgo` from `@typescript/native-preview@7.0.0-dev.20260707.2`, a daily build
from July that has stopped publishing (TypeScript 7.0.2 is GA since
2026-07-08); `next build` type-checks with TypeScript 6.0.3's CLI; ESLint's
typed rules use TypeScript 6 through `typescript-eslint` (which does not
accept 7). A green `bun run verify` therefore does not predict a green build.
Dependabot's five-PR budget is entirely occupied by superseded PRs, so no
patch (Biome, ultracite, ESLint 9.39.5, `@types/node`) has moved since June;
the one live PR (`suncalc` 1.9 → 2.0) is a breaking change in units,
azimuth origin and export shape that `lib/city/sun.ts` must be migrated
for. Smaller hygiene: `@types/proj4` is a deprecated stub, `geotiff` is a
runtime dependency for a build-only script, three pins contradict the
documented convention, `bun` 1.3.11 lags its own types, `.mcp.json` runs an
unpinned `@latest` package on every session, the committed agent allowlist
pre-approves arbitrary `node -e`/`python3` execution and lists a file that
no longer exists, `skills-lock.json` locks two skills nobody installs, the
hand-written `three-mesh-bvh` augmentation duplicates the one the package
ships, ESLint warnings never fail `bun lint`, and `tsconfig.json` targets
ES2017 with `allowJs` for zero JS files.

## Current state

`package.json:24-42` (devDependencies) and `:1-23` (dependencies):

```json
    "@types/proj4": "^2.19.0",
    ...
    "@typescript/native-preview": "7.0.0-dev.20260707.2",
    ...
    "typescript": "^6.0.3",
```

```json
    "geotiff": "^3.0.5",
    "n8ao": "^1.10.2",
    "postprocessing": "^6.39.5",
    "proj4": "2.22.0",
    "suncalc": "1.9.0",
    "three": "0.186.0",
    "three-mesh-bvh": "^0.9.15",
```

`package.json:44-58`:

```json
    "lint": "eslint && ultracite check",
    "typecheck": "tsgo --noEmit",
    ...
  "packageManager": "bun@1.3.11",
```

Resolved in `bun.lock` (2026-09-20): `@biomejs/biome` 2.5.0 (latest 2.5.14),
`ultracite` 7.8.3 (latest 7.12.0), `eslint` 9.39.4 (9.x is EOL since
2026-08-06; 9.39.5 is the maintenance release; ESLint 10 is blocked by
`eslint-config-next`'s plugin peers — not part of this plan),
`n8ao` 1.10.3, `three` 0.186.0 (= latest), `postprocessing` 6.39.5 (caps
`three < 0.187`), `typescript` 6.0.3, `typescript-eslint` 8.60.0 (peer
`typescript <6.1.0`), `@types/bun` 1.4.2, `@types/suncalc` 1.9.2,
`three-mesh-bvh` 0.9.15.

`AGENTS.md:36` documents `bun typecheck      # tsgo --noEmit`;
`AGENTS.md:191-193`:

```
- Version pins: exact for the three.js stack (`three`, `@types/three`,
  `postprocessing`, `n8ao`, `three-mesh-bvh`, `cityjson-threejs-loader`), the
  framework trio and the formatters; caret for everything else.
```

`lib/city/sun.ts:1-35` (suncalc 1.9 conventions: radians, azimuth from
south positive toward west, default import):

```ts
import SunCalc from "suncalc";
...
export function sunDirectionEnu(date: Date, lat: number, lng: number): Enu {
  const { azimuth, altitude } = SunCalc.getPosition(date, lat, lng);
  const horizontal = Math.cos(altitude);
  return {
    // azimuth 0 = sun due SOUTH -> east component 0, north component -1.
    east: -horizontal * Math.sin(azimuth),
    north: -horizontal * Math.cos(azimuth),
    up: Math.sin(altitude),
  };
}
```

`lib/city/sun.test.ts:2` imports `SunCalc` the same way and uses
`getTimes(...).solarNoon`, `.nadir`, `.sunrise` (`:37-41`, `:52-56`,
`:61-66`); the noon test asserts `|x| < 0.02`, `z > 0`, `y > 0.5`; the
morning test asserts `x > 0.3`; midnight `y < 0`.

`suncalc@2.0.2` (registry, 2026-09-02): ESM-only with **named** exports
(`getPosition`, `getTimes`, …), angles in **degrees**, azimuth **north-based
clockwise** (0 = N, 90 = E, 180 = S), `getTimes` values are `Date | null`,
and it ships its own `index.d.ts` (so `@types/suncalc` becomes a stale
stub). Dependabot PR #26 proposes the bump.

`tsconfig.json:3-5, 24`:

```json
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    ...
    "types": ["bun"]
```

`types/three-mesh-bvh.d.ts` (whole file):

```ts
import type { MeshBVH } from "three-mesh-bvh";

declare module "three" {
  interface BufferGeometry {
    boundsTree?: MeshBVH;
    computeBoundsTree(options?: object): void;
    disposeBoundsTree(): void;
  }
  interface Raycaster {
    /** three-mesh-bvh extension: stop at the first BVH hit (faster). */
    firstHitOnly?: boolean;
  }
}
```

`three-mesh-bvh@0.9.15`'s own `src/index.d.ts` (lines 326–341, verified
against the registry) declares `module 'three'` with
`BufferGeometry.boundsTree?`, `computeBoundsTree`, `disposeBoundsTree` and
`Raycaster.firstHitOnly?`. The runtime wiring is `app/_components/collision.ts:12-14`:

```ts
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "next-devtools": {
      "command": "npx",
      "args": ["-y", "next-devtools-mcp@latest"]
    },
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@4.21.0", "mcp"]
    }
  }
}
```

(`next-devtools-mcp` latest on 2026-09-20: 0.4.0.) `README.md:11-14` lists
only Bun and a WebGL2 browser as prerequisites; `npx` needs Node.

`.claude/settings.json` (tracked) — `permissions.allow` contains, among
others: `"Bash(python3 -)"`, five `"Bash(node shoot.mjs …)"` entries (no such
file exists), `"Bash(node -e ' *)"`, `"Bash(bash scripts/extract-dlm.sh 33412_5656)"`,
a literal `ogrinfo … 'Marienbrücke' …` query, `"Bash(bun test *)"`,
`"Bash(bunx playwright *)"`, `"Bash(git add *)"`, `"Bash(git commit *)"`,
two `WebFetch(domain:…)` grants and `"Edit(/.claude/skills/city-walker/**)"`.

`skills-lock.json:16-27` locks `next-best-practices` and
`next-cache-components` (source `vercel-labs/next-skills`); neither exists
under `.agents/skills/` (13 directories) nor as a symlink in `.claude/skills/`.

`.github/dependabot.yml:10` — `open-pull-requests-limit: 5` (npm). Open npm
PRs on 2026-09-20: #26 (suncalc), #15 (next 16.3.3 — manifest is already
16.3.5), #13 (recharts — removed from the manifest), #12 (three group —
already at latest), #3 (lint-and-format, since June).

`.vscode/settings.json:2-3, 7`:

```json
  "js/ts.experimental.useTsgo": true,
  "editor.defaultFormatter": "biomejs.biome",
  ...
  "js/ts.tsdk.path": "node_modules/typescript/lib",
```

No `.vscode/extensions.json`, no `.editorconfig`. The Effect subclasses at
`app/_components/depth-grading-effect.ts:33` and `paper-grain-effect.ts:32`
declare no instance fields (relevant to the `target` change).

Conventions: Conventional Commits (`chore:`, `build:`, `ci:` are accepted
by `.github/workflows/pr-title.yml`); `bun install --frozen-lockfile` in CI,
so every lockfile change must be committed with its manifest change.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (updates the lock) | `bun install` | exit 0, `bun.lock` updated |
| Frozen install (what CI runs) | `bun install --frozen-lockfile` | exit 0 |
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Unit | `bun test` | all pass |
| Full gate | `bun run verify` | exit 0 |
| Build | `bun run build` | exit 0 |
| E2E | `bun run test:e2e` | all pass |
| ESLint warning count | `bun x eslint --max-warnings=0` | see Step 7 |

## Scope

**In scope**:

- `package.json`, `bun.lock`
- `tsconfig.json`
- `lib/city/sun.ts`, `lib/city/sun.test.ts`
- `types/three-mesh-bvh.d.ts` (delete)
- `.mcp.json`
- `.claude/settings.json`, `skills-lock.json`
- `.github/dependabot.yml`
- `.vscode/settings.json`, `.vscode/extensions.json` (create), `.editorconfig` (create)
- `AGENTS.md` lines 36 and 191–193; `README.md` "Prerequisites"

**Out of scope**:

- ESLint 10 (blocked upstream; a maintainer decision to bump-with-peer-warnings or drop ESLint).
- `n8ao` 2.x, `cityjson-threejs-loader` vendoring, Playwright/Next/React bumps (all current or deliberate).
- Closing Dependabot PRs (maintainer action — see Maintenance notes).
- Any source file other than `lib/city/sun.ts`.

## Git workflow

- Branch: `advisor/013-toolchain-and-dependency-hygiene`.
- One commit per step; `build:` for dependency/toolchain steps, `chore:` for
  config, `fix:` for the suncalc migration, `docs:` for the doc lines.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: One type-checker — `tsc` from TypeScript 6

1. Remove `"@typescript/native-preview": "7.0.0-dev.20260707.2"` from
   `devDependencies`; change `"typecheck": "tsgo --noEmit"` to
   `"typecheck": "tsc --noEmit"`.
2. `bun install` (lock updates).
3. `AGENTS.md:36` → `bun typecheck      # tsc --noEmit (TypeScript 6 — the same compiler next build and ESLint use)`.
4. `.vscode/settings.json` — delete the `"js/ts.experimental.useTsgo": true,` line.

**Verify**: `time bun typecheck` → exit 0 (note the wall time in the PR;
expect seconds, not minutes). `bun run build` → exit 0.

### Step 2: Migrate to suncalc 2

1. In `package.json`: `"suncalc": "2.0.2"` (exact — see Step 3's convention
   note), remove `"@types/suncalc"`. `bun install`.
2. Read `node_modules/suncalc/index.d.ts` and confirm: named export
   `getPosition(date, lat, lng)` returning `{ azimuth, altitude }` in
   **degrees** with azimuth north-based clockwise, and `getTimes(...)`
   returning an object with `solarNoon`, `nadir`, `sunrise` typed
   `Date | null`. If any of these differ, STOP and report the actual API.
3. Rewrite `lib/city/sun.ts`:

   ```ts
   import { getPosition } from "suncalc";

   const DEG2RAD = Math.PI / 180;

   /**
    * Solar direction math, kept three-free so it is unit-testable.
    *
    * Frames involved:
    *  - suncalc 2.x: `azimuth` is compass degrees, north-based clockwise
    *    (0 = N, 90 = E, 180 = S); `altitude` is degrees above the horizon.
    *  - ENU: x=east, y=north, z=up (a map-style local tangent frame).
    *  - World (three.js scene): East=+X, Up=+Y, North=-Z (see enuToWorld).
    */
   ...
   export function sunDirectionEnu(date: Date, lat: number, lng: number): Enu {
     const { azimuth, altitude } = getPosition(date, lat, lng);
     const az = azimuth * DEG2RAD;
     const alt = altitude * DEG2RAD;
     const horizontal = Math.cos(alt);
     return {
       east: horizontal * Math.sin(az),
       north: horizontal * Math.cos(az),
       up: Math.sin(alt),
     };
   }
   ```

   (`enuToWorld` and `sunDirectionWorld` are unchanged.) The sign change is
   exact: the old convention's azimuth was from south, so
   `sin(az_north) = −sin(az_south)` and `cos(az_north) = −cos(az_south)`.
4. `lib/city/sun.test.ts`: `import { getTimes } from "suncalc";`, replace
   `SunCalc.getTimes` with `getTimes`, and guard the nullable times:

   ```ts
   const { sunrise, solarNoon } = getTimes(new Date("2026-06-21T12:00:00Z"), LAT, LNG);
   if (!(sunrise && solarNoon)) {
     throw new Error("June in Dresden has a sunrise and a solar noon");
   }
   ```

   Keep every existing assertion as is. Add one test: at solar noon on
   2026-12-21 the sun is due south and low (`dir.y` between 0.15 and 0.35,
   `|dir.x| < 0.02`).

**Verify**: `bun test lib/city/sun.test.ts` → all pass (the noon/morning/
midnight assertions are the correctness proof of the sign convention).
`bun typecheck` → exit 0 (no `@types/suncalc` needed).

### Step 3: Dependency hygiene

1. Move `"geotiff": "^3.0.5"` from `dependencies` to `devDependencies`
   (its only importer is `scripts/prepare-data.ts`, which runs before
   `next build` — CI installs dev dependencies).
2. Remove `"@types/proj4"` (proj4 2.22 ships `dist/index.d.ts`).
3. Pin the three.js stack exactly as the convention says: `"n8ao": "1.10.3"`,
   `"postprocessing": "6.39.5"`, `"three-mesh-bvh": "0.9.15"` (the resolved
   versions — the lock's `three` entries do not change).
4. `bun install`.
5. `AGENTS.md:191-193` — extend the sentence to
   `…and the formatters; caret for everything else, except pins whose next major is known-breaking (`suncalc` was one until plan 013 migrated it).`
   — or simply leave `suncalc` exact and say so.

**Verify**: `bun install --frozen-lockfile` → exit 0. `bun run verify` →
exit 0. `bun run build` → exit 0 (prepare-data still finds `geotiff`).
`grep -n '"three\|postprocessing\|n8ao\|three-mesh-bvh' package.json` → no
`^` on those four lines.

### Step 4: Bun runtime pin (conditional)

If `bun --version` on the executing machine is `>= 1.4.2`: set
`"packageManager": "bun@1.4.2"`, run `bun install`, and confirm
`git diff --stat bun.lock` shows no unrelated churn (if the lock format
changed wholesale, revert this step and report). If the local bun is older,
skip this step and say so in the PR — CI reads the pin via `setup-bun`, so a
maintainer can bump it later.

**Verify**: `bun install --frozen-lockfile` → exit 0.

### Step 5: `tsconfig.json` tidy

Change `"target": "ES2017"` to `"target": "ES2022"` and delete
`"allowJs": true,`. (Next's SWC transform ignores `target`; it only affects
`tsc`'s class-field semantics, and the two `Effect` subclasses declare no
fields. There is no `.js` source file in the `include` globs.)

**Verify**: `bun typecheck` → exit 0; `bun run build` → exit 0;
`bunx playwright test e2e/city-walk.spec.ts` → all pass (the post stack's
Effect subclasses still construct).

### Step 6: Delete the redundant `three-mesh-bvh` augmentation

`git rm types/three-mesh-bvh.d.ts`.

**Verify**: `bun typecheck` → exit 0. If it now reports
`Property 'computeBoundsTree' does not exist on type 'BufferGeometry'` (or
`firstHitOnly`), the package's augmentation was not picked up — STOP and
report (do not restore the shim without saying why).

### Step 7: ESLint warnings fail the lint

Run `bun x eslint --max-warnings=0` and count the warnings. If there are
more than 5, STOP and report the list (fixing a backlog is not this plan).
Otherwise fix them (or add a targeted `// eslint-disable-next-line <rule>`
with a reason) and set `"lint": "eslint --max-warnings=0 && ultracite check"`.

**Verify**: `bun lint` → exit 0.

### Step 8: Pin the devtools MCP server; document Node

`.mcp.json`: `"args": ["-y", "next-devtools-mcp@0.4.0"]`.
`README.md` Prerequisites: add
`- Node.js 20+ — only for the optional MCP servers in \`.mcp.json\` (they start with \`npx\`); the app itself needs Bun alone.`

**Verify**: `grep -n "@latest" .mcp.json` → 0 matches.

### Step 9: Prune the agent allowlist and the skills lock

1. `.claude/settings.json` — remove the five `node shoot.mjs …` entries,
   `"Bash(node -e ' *)"` and `"Bash(python3 -)"`; replace
   `"Bash(bash scripts/extract-dlm.sh 33412_5656)"` with
   `"Bash(bash scripts/extract-*.sh *)"`; replace the literal `ogrinfo …`
   entry with `"Bash(ogrinfo *)"`. Keep everything else (the `git`, `bun test`,
   `bunx playwright`, `WebFetch`, `Read`, `Edit` grants are the maintainer's
   workflow).
2. `skills-lock.json` — delete the `next-best-practices` and
   `next-cache-components` entries.

**Verify**: `bun x biome format --write .claude/settings.json skills-lock.json`
(or `bun run fix` restricted to those files) leaves valid JSON;
`grep -c "shoot.mjs\|node -e" .claude/settings.json` → 0;
`grep -c "next-skills" skills-lock.json` → 0.

### Step 10: Editor and file conventions

1. Create `.vscode/extensions.json`:

   ```json
   { "recommendations": ["biomejs.biome"] }
   ```

2. Create `.editorconfig`:

   ```
   root = true

   [*]
   charset = utf-8
   end_of_line = lf
   insert_final_newline = true
   indent_style = space
   indent_size = 2
   trim_trailing_whitespace = true

   [*.py]
   indent_size = 4

   [*.md]
   trim_trailing_whitespace = false
   ```

**Verify**: `bun lint` → exit 0 (Biome ignores `.editorconfig`; nothing
else changes).

### Step 11: Free the Dependabot queue

`.github/dependabot.yml:10` → `open-pull-requests-limit: 10` (npm). Add a
comment above it: superseded PRs must be closed by a maintainer for
Dependabot to reconcile; the higher cap stops one slow major from starving
the groups.

**Verify**: the YAML still parses (`bun x js-yaml .github/dependabot.yml`
prints an object, or open it in an editor with YAML validation).

### Step 12: Final gate

**Verify**: `bun install --frozen-lockfile && bun run verify && bun run build && bun run test:e2e`
→ all exit 0.

## Test plan

- `lib/city/sun.test.ts` (existing 5 + 1 new winter-noon case) is the proof
  of the suncalc migration.
- Every other step is verified by the toolchain itself (`bun typecheck`,
  `bun lint`, `bun run build`, e2e).

## Done criteria

- [ ] `bun install --frozen-lockfile && bun run verify && bun run build && bun run test:e2e` exit 0
- [ ] `grep -n "native-preview\|tsgo" package.json AGENTS.md .vscode/settings.json` → 0 matches
- [ ] `grep -n '"suncalc": "2.0.2"' package.json` → 1; `grep -c "@types/suncalc\|@types/proj4" package.json` → 0
- [ ] `grep -n '"geotiff"' package.json` → inside `devDependencies`
- [ ] `test ! -f types/three-mesh-bvh.d.ts`
- [ ] `grep -n "max-warnings=0" package.json` → 1
- [ ] `grep -n "@latest" .mcp.json` → 0; `grep -c "shoot.mjs" .claude/settings.json` → 0; `grep -c "next-skills" skills-lock.json` → 0
- [ ] `test -f .editorconfig && test -f .vscode/extensions.json`
- [ ] `grep -n '"target": "ES2022"' tsconfig.json` → 1; `grep -c allowJs tsconfig.json` → 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- `bun typecheck` with `tsc` reports errors that `tsgo` did not (report
  them; they are real — do not switch back).
- suncalc 2's API differs from the description in Step 2.
- More than 5 ESLint warnings (Step 7).
- Deleting the bvh shim breaks typecheck (Step 6).
- Any step needs a source change outside `lib/city/sun.ts`.

## Maintenance notes

- **Maintainer actions this plan cannot do**: close Dependabot PRs #3, #12,
  #13, #15 (superseded) and #26 (superseded by Step 2) so the queue drains;
  decide ESLint 10 vs. dropping ESLint (recorded as a maintainer choice in
  `plans/README.md`).
- TypeScript 7 (`tsc` native) can replace TypeScript 6 for *everything* once
  `typescript-eslint` accepts `>= 7` — that is the moment to get the fast
  path back with one compiler instead of two.
- Keep `@types/bun` and `packageManager` on the same minor; Dependabot bumps
  the former, only a human bumps the latter.
- `.claude/settings.json` is project-shared: anything that pre-approves an
  interpreter (`node -e`, `python3 -`) belongs in the untracked
  `settings.local.json` if a maintainer wants it back.
