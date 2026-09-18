# Plan 006: Remove the "activity-card" scaffold leftovers, prune unused dependencies, and write real onboarding docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8075a21..HEAD -- package.json bun.lock biome.jsonc eslint.config.mts app/layout.tsx app/globals.css types/three-mesh-bvh.d.ts .vscode/settings.json .mcp.json .github/dependabot.yml .github/workflows/ci.yml README.md AGENTS.md components/ui hooks/use-mobile.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. **PR #16 modifies `biome.jsonc`,
> `AGENTS.md`, `.mcp.json`, `.claude/settings.json`, `components.json`,
> `bun.lock`, `app/globals.css` and 19 files under `components/ui/`.** Steps
> 1–4 and 6–8 are safe to do while it is open (small, easy to re-merge);
> Step 5 (deleting UI files) and Step 9 (AGENTS.md) must wait until the
> operator confirms PR #16 has merged or been closed — otherwise skip them
> and say so in the status row.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (plan 001's `bun run verify` makes verification one command; use the three separate commands otherwise)
- **Category**: tech-debt (with deps, dx, docs, security-hygiene items folded in)
- **Planned at**: commit `8075a21`, 2026-09-18

## Why this matters

The repo was bootstrapped from a different project ("activity-card", a
Strava activity-card generator) and the scaffold was never re-pointed:

- `package.json` is still named `activity-card`; four dependencies have zero
  imports anywhere (`@giro3d/giro3d` alone pulls a full 3D-GIS stack incl.
  OpenLayers and chart.js — 40 packages), seven more exist only for shadcn
  UI files nothing imports (`recharts` brings redux/immer — 42 packages),
  and the `shadcn` CLI sits in runtime `dependencies` (159 packages) for a
  single CSS import. Every CI job and every dev machine installs all of it.
- `biome.jsonc` and `eslint.config.mts` carry overrides for files that do
  not exist (`lib/strava-api.generated.ts`, `components/themes/**`,
  `e2e/strava-mock.ts`, `skills/**`, `storybook-static/**`) while the
  vendored skills that should be excluded live in `.agents/skills/`.
- `app/layout.tsx` loads four Google font families for a UI with a handful
  of labels, and assigns `--font-heading` to two of them, so which heading
  font renders depends on stylesheet order.
- `README.md` is the untouched create-next-app template: every sentence in
  it is wrong for this project, and nothing documents the data pipeline,
  the tile id, the CRS requirement, the controls, the debug hook, or how to
  run the tests. `AGENTS.md` omits the five rules an agent most needs.
- Small hygiene items from the same audit: CI uses `bun-version: latest`
  (non-reproducible), the typechecker is a caret range on a daily dev tag,
  Dependabot has no group for the three.js stack although `postprocessing`
  caps `three` at `< 0.187.0`, `.mcp.json` runs `npx shadcn@latest`
  unpinned, and `.vscode/settings.json` names Prettier (not installed) as
  the default formatter in a Biome repo.

None of this affects the shipped bundle; all of it affects install time,
audit surface, reviewer trust in the config, and whether a newcomer or an
agent can get the app running from the docs.

## Current state

Excerpt — `package.json` (dependencies, abridged; line numbers approximate):

```json
"dependencies": {
  "@base-ui/react": "^1.8.0",
  "@giro3d/giro3d": "^2.0.4",          // zero imports
  "cityjson-threejs-loader": "0.4.0",
  "cmdk": "^1.1.1",                     // only components/ui/command.tsx (unreachable)
  "date-fns": "^4.4.0",                 // used by city-walk.tsx and react-day-picker — keep
  "embla-carousel-react": "^8.6.0",     // only carousel.tsx (unreachable)
  "fast-xml-parser": "^5.11.1",         // zero imports
  "fit-file-parser": "^3.0.2",          // zero imports
  "html-to-image": "^1.11.13",          // zero imports
  "input-otp": "^1.5.0",                // only input-otp.tsx (unreachable)
  "next-themes": "^0.4.6",              // only sonner.tsx (unreachable)
  "react-resizable-panels": "^4.12.4",  // only resizable.tsx (unreachable)
  "recharts": "3.10.1",                 // only chart.tsx (unreachable)
  "shadcn": "^4.21.0",                  // CLI; only app/globals.css imports "shadcn/tailwind.css"
  "sonner": "^2.0.8",                   // only sonner.tsx (unreachable)
  ...
},
"devDependencies": {
  "@typescript/native-preview": "^7.0.0-dev.20260707.2",
  ...
},
"name": "activity-card",
"ignoreScripts": ["sharp", "unrs-resolver"],
"trustedDependencies": ["sharp", "unrs-resolver"],
```

Reachable `components/ui` files (imported from `app/` directly or
transitively): `alert, button, calendar, card, drawer, field, kbd, popover,
slider, spinner, switch, toggle-group, tooltip` + `label, separator`
(via field) + `toggle` (via toggle-group) = **16 of 55**. `hooks/use-mobile.ts`
is imported only by the unreachable `components/ui/sidebar.tsx`. The
reachable set imports only `react`, `class-variance-authority`,
`lucide-react`, `@base-ui/react/*`, `vaul`, `react-day-picker`, plus
`@/lib/utils` (`clsx`, `tailwind-merge`).

Excerpt — `biome.jsonc:16-38` (dead overrides) and `69-74`:

```jsonc
    {
      // Auto-generated from Strava's OpenAPI spec (`bun run strava:types`).
      // Machine output — don't lint or format it; regenerate instead.
      "includes": ["lib/strava-api.generated.ts"],
      "linter": { "enabled": false },
      "formatter": { "enabled": false }
    },
    {
      // Vendored agent skills installed via `npx skills add` and pinned by
      // skills-lock.json. Third-party content (some entries are symlinks) —
      // don't lint or format it; re-add/update instead.
      "includes": ["skills/**"],
      "linter": { "enabled": false },
      "formatter": { "enabled": false }
    },
    {
      // Theme cards are faithful ports of design prototypes; loosen the
      // rules that punish their seeded arrays, sport-branch density,
      // and 1080×1350 inline layout styles.
      "includes": ["components/themes/**"],
      ...
    },
// ...
      "javascript": {
        // `Bun` is used by the test mock server (e2e/strava-mock.ts);
        // declared inline in the file for TS, declared here for biome.
        "globals": ["Bun"]
      },
```

Excerpt — `eslint.config.mts:8-25`:

```ts
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendor-generated by `shadcn add` / Next.js scaffold; do not edit.
    "components/ui/**",
    "hooks/use-mobile.ts",
    "skills/**",
    // Generated, gitignored test artifacts — ...
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    // Gitignored Storybook build output — minified vendor bundles.
    "storybook-static/**",
  ]),
```

Excerpt — `app/layout.tsx:1-22` and `34-46`:

```tsx
import type { Metadata } from "next";
import { Anton, Geist_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const spaceGroteskHeading = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const anton = Anton({
  weight: ["400"],
  variable: "--font-heading",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
// ...
    <html
      className={cn(
        "h-full",
        "antialiased",
        geistMono.variable,
        anton.variable,
        "font-sans",
        inter.variable,
        spaceGroteskHeading.variable
      )}
      lang="en"
    >
```

`app/globals.css:10-12` maps `--font-sans`, `--font-mono: var(--font-geist-mono)`,
`--font-heading`. `font-heading` is used by `components/ui/drawer.tsx:101`
(mobile "Scene settings" title) and `card.tsx:40` (CardTitle); `font-mono`
only by the unreachable `chart.tsx`.

Other one-liners:

- `types/three-mesh-bvh.d.ts:3-4` — comment says `app/city/_components/collision.ts`; the file is `app/_components/collision.ts`.
- `.vscode/settings.json:3` — `"editor.defaultFormatter": "esbenp.prettier-vscode"`.
- `.mcp.json` — `"args": ["shadcn@latest", "mcp"]`.
- `.github/workflows/ci.yml` — `bun-version: latest` at lines 27, 39, 51, 63, 86.
- `.github/dependabot.yml:11-24` — groups `next`, `react`, `tailwind`, `shadcn`, `lint-and-format`, `types` (which excludes only `@types/react*`); no group for three.
- `bun.lock:1302` — `postprocessing@6.39.5` peer `"three": ">= 0.168.0 < 0.187.0"`; `three` is `0.186.0`.
- `README.md` — 30 lines of create-next-app boilerplate.
- `AGENTS.md` — conventions only (TS strict, Tailwind, component placement, no console.log, Conventional Commits, "ask before a backend").

Facts for the README (all verified in this audit; use them verbatim):

- App: "City Walk — Dresden", a walkable LoD1 city model on DGM1 terrain
  with sun/shadow simulation and sketch-style rendering; single route `/`;
  client-only three.js (no backend, no auth, no persistence).
- Prerequisites: Bun 1.3+, a WebGL2-capable browser. Quickstart:
  `bun install`, `bun dev`, open http://localhost:3000.
- Data pipeline: `data/` (committed Saxony open geodata: 8 LoD1 CityJSON
  tiles under `data/cityjson/`, 6 DGM1 GeoTIFF tiles under `data/dgm/`) →
  `scripts/prepare-data.ts` (runs before `dev`/`build`) → `public/data/`
  (gitignored). The app loads one tile, id `33412_5656_2_sn`. Tile id
  scheme: `<UTM zone 33><easting km>_<northing km>_<2 km edge>_sn`; the
  loaded tile spans 412000–414000 E / 5656000–5658000 N (EPSG:25833).
  (If plan 004 has landed, the tile id lives in `lib/city/tile.ts` and the
  terrain is preprocessed into a `.heightfield.json/.f32` pair; if not, the
  script copies the `.tif`/`.tfw`. Check which is true and describe that.)
- CRS: CityJSON must declare EPSG:25832 or 25833 in `metadata.referenceSystem`
  (`lib/city/crs.ts`); reproject with `cjio in.city.json reproject 25833 save out.city.json`.
  The GeoTIFF needs embedded georeferencing or a `.tfw` sidecar; embed with
  `gdal_translate -a_srs EPSG:25833 in.tif out.tif`. The city's recenter
  point must fall inside the DGM extent or startup fails loudly.
- Controls (desktop): drag to look, `WASD` move, `Shift` sprint, `F`
  walk/fly, `Space`/`Shift` up/down in fly mode, scroll to zoom (FOV),
  double-click the ground to travel, `R` demolish the building under the
  crosshair, `B` insert a building, "Immersive mode" button = pointer lock
  (`Esc` exits), click the minimap to teleport. Touch: drag to look,
  joystick to walk, pinch to zoom, double-tap to travel, settings drawer.
- Coordinate frames: data is EPSG Z-up; the `world` group is rotated −90°
  about X so three.js Y is up (`app/_components/create-app.ts`); world
  `x = easting − cx`, `z = −(northing − cy)`, with `(cx, cy)` from the
  loader's recenter matrix (`lib/city/recenter.ts`, `lib/city/ground-clamp.ts`);
  sun direction goes SunCalc → ENU → world (`lib/city/sun.ts`).
- Testing: `bun run verify` (lint + typecheck + unit; from plan 001) or
  `bun lint && bun typecheck && bun run test`; e2e: `bunx playwright install chromium`
  once, then `bun run test:e2e` (software WebGL; `NEXT_PUBLIC_POC_DEBUG=1`
  in CI builds exposes the `window.__poc` hook defined in
  `app/_components/poc-debug.ts`; dev builds expose it automatically).
- Architecture in one paragraph: React shell (`app/_components/city-walk.tsx`)
  → imperative three.js app (`createCityWalkApp` in `create-app.ts`) that
  returns a handle of setters; pure, three-free, unit-tested math in
  `lib/city/`; demolish = data-level filter + re-parse (`city-layer.ts`);
  `cityjson-threejs-loader` is patched via `patches/` (see the patch header).
- Data provenance: the source portal, download date and licence are NOT
  recorded anywhere in the repo. Write the section with a clearly marked
  `TODO(maintainer):` line for those three facts rather than inventing them.

Conventions: Conventional Commits, lowercase subject (e.g. `chore: drop unused
dependencies`, `docs: rewrite README for the city viewer`). Biome formats
JSON/MD on `bun fix`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (updates lockfile after manifest edits) | `bun install` | exit 0, `bun.lock` changed |
| Frozen install (what CI does) | `bun install --frozen-lockfile` | exit 0 |
| Fast gate | `bun run verify` (or `bun lint && bun typecheck && bun run test`) | exit 0 |
| Build | `bun run build` | exit 0, no `next/font` warnings |
| E2E | `bun run test:e2e` | 3 passed |
| Bun version | `bun --version` | e.g. `1.3.11` |

## Scope

**In scope**:
- `package.json`, `bun.lock` (via `bun install` only — never hand-edit the lockfile)
- `biome.jsonc`, `eslint.config.mts`, `.vscode/settings.json`, `.mcp.json`
- `.github/workflows/ci.yml` (only the `bun-version` inputs), `.github/dependabot.yml`
- `app/layout.tsx`, `app/globals.css` (one line)
- `types/three-mesh-bvh.d.ts` (comment)
- `README.md`, `AGENTS.md`
- `components/ui/*` (deletions only, Step 5) and `hooks/use-mobile.ts` (deletion, Step 5)
- `plans/README.md` (status row)

**Out of scope**:
- Any file under `app/_components/`, `lib/`, `e2e/`, `scripts/` — no code changes in this plan.
- `next.config.ts` (the `/city → /` redirect is harmless history; leave it).
- `patches/`, `skills-lock.json`, `.agents/**`, `.claude/**`, `.cursor/**`.
- Dropping ESLint in favour of Biome-only linting — a maintainer decision, listed as an option in `plans/README.md`.
- SHA-pinning GitHub Actions — optional hygiene, not part of this plan.

## Git workflow

- Branch: `advisor/006-scaffold-cleanup` from `main`.
- One commit per step (messages below).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Manifest — name, dead deps, dev-only CLI, exact typechecker pin

Edit `package.json`:

1. `"name": "bridge"`.
2. Remove from `dependencies`: `@giro3d/giro3d`, `fast-xml-parser`, `fit-file-parser`, `html-to-image`.
3. Move `shadcn` from `dependencies` to `devDependencies` (same range).
4. Change `"@typescript/native-preview": "^7.0.0-dev.20260707.2"` to the
   exact resolved version from `bun.lock` (search the lockfile for
   `"@typescript/native-preview@` and copy the version; at planning time it
   was `7.0.0-dev.20260707.2`). No caret.
5. Delete the `"ignoreScripts": [...]` key. (Bun's allowlist for lifecycle
   scripts is `trustedDependencies`, which stays; a package.json
   `ignoreScripts` array is not a Bun field, so it only misleads. `sharp`
   and `unrs-resolver` need their postinstall.)
6. Add `"packageManager": "bun@<output of bun --version>"` (exact, e.g. `bun@1.3.11`).

Run `bun install` (not frozen) to update `bun.lock`.

**Verify**:
- `bun install --frozen-lockfile` → exit 0 (the lock matches the manifest).
- `grep -c "giro3d\|fast-xml-parser\|fit-file-parser\|html-to-image" bun.lock` → `0`.
- `grep -n '"shadcn"' package.json` → one hit, inside `devDependencies`.
- `bun run build` → exit 0 (the `shadcn/tailwind.css` import still resolves).
- `bun run verify` → exit 0.

Commit: `chore: rename package, drop unused deps, pin the typechecker`.

### Step 2: CI Bun pin and a Dependabot group for the three stack

- `.github/workflows/ci.yml`: replace every `bun-version: latest` with
  `bun-version-file: package.json` (5 occurrences).
- `.github/dependabot.yml`: add a group

```yaml
      three:
        patterns:
          - three
          - "@types/three"
          - three-mesh-bvh
          - postprocessing
          - n8ao
          - cityjson-threejs-loader
```

  and add `"@types/three"` to the `types` group's `exclude-patterns`. Fix
  the stale comment on the `github-actions` block ("Keep Actions and the
  `oven-sh/setup-bun` pin fresh") — the Bun version now comes from
  `package.json`.

**Verify**: `grep -c "bun-version: latest" .github/workflows/ci.yml` → `0`; `grep -c "bun-version-file: package.json" .github/workflows/ci.yml` → `5`; `grep -n "three:" .github/dependabot.yml` → 1 hit.

Commit: `ci: pin bun from package.json and group three.js updates`.

### Step 3: Lint configs describe this repo

`biome.jsonc`:
- Delete the `lib/strava-api.generated.ts` override and the `components/themes/**` override entirely.
- Change `"includes": ["skills/**"]` to `"includes": [".agents/**"]` and reword its comment ("Vendored agent skills under .agents/skills, pinned by skills-lock.json — third-party content, never lint or format").
- In the `e2e/**` override, delete the `"javascript": { "globals": ["Bun"] }` block and its comment (no e2e file uses `Bun`).
- Keep everything else, including the `components/ui/**` override and the `ultracite/biome/vitest` extend.

`eslint.config.mts`: change `"skills/**"` to `".agents/**"`; delete the `storybook-static/**` line and its comment.

**Verify**: `bun lint` → exit 0; `grep -n "strava\|themes\|storybook\|\"skills/\*\*\"" biome.jsonc eslint.config.mts` → no output.

Commit: `chore: remove lint overrides for files that do not exist`.

### Step 4: One heading font, no duplicate variable

`app/layout.tsx`: keep `Inter` (`--font-sans`) and `Space_Grotesk`
(`--font-heading`, it declares `subsets`); delete the `Anton` and
`Geist_Mono` imports, constants and class names. The `cn(...)` call becomes
`cn("h-full", "antialiased", "font-sans", inter.variable, spaceGroteskHeading.variable)`.

`app/globals.css`: delete the line `--font-mono: var(--font-geist-mono);`
(Tailwind's default mono stack applies; nothing reachable uses `font-mono`).

**Verify**: `bun run build` → exit 0 and the output contains no `next/font` warning about missing `subsets`; `grep -c "font-heading" app/layout.tsx` → `1`; `bun run test:e2e` → 3 passed (the mobile drawer title still renders).

Commit: `perf: load two font families instead of four`.

### Step 5: Prune unreachable shadcn files and their dependencies — ONLY after PR #16 is resolved

Skip this step (and say so in the status row) unless the operator confirms
PR #16 "Aesthectic and visual fine tuning" has merged or been closed.

1. Compute reachability instead of trusting this plan's list:

```sh
cd "$(git rev-parse --show-toplevel)"
seed=$(grep -rhoE "@/components/ui/[a-z-]+" app hooks lib | sed 's#@/components/ui/##' | sort -u)
reach="$seed"; prev=""
while [ "$reach" != "$prev" ]; do
  prev="$reach"
  more=$(for f in $reach; do grep -hoE "@/components/ui/[a-z-]+" "components/ui/$f.tsx" 2>/dev/null | sed 's#@/components/ui/##'; done)
  reach=$(printf "%s\n%s\n" "$reach" "$more" | sort -u)
done
echo "$reach"
```

   Expected (16): `alert button calendar card drawer field kbd label popover separator slider spinner switch toggle toggle-group tooltip`. If the list differs from the expected set, use the computed list (the codebase moved), but STOP if it contains fewer than 13 entries.

2. Delete every `components/ui/*.tsx` NOT in the computed list (39 files at planning time) and `hooks/use-mobile.ts` (only `sidebar.tsx` imported it).
3. Remove from `package.json` `dependencies`: `cmdk`, `embla-carousel-react`, `input-otp`, `next-themes`, `react-resizable-panels`, `recharts`, `sonner`. Keep `vaul`, `react-day-picker`, `date-fns`, `class-variance-authority`, `lucide-react`, `@base-ui/react`, `clsx`, `tailwind-merge`.
4. Remove `"hooks/use-mobile.ts"` from `eslint.config.mts`'s ignore list and from the `components/ui/**` override's `includes` in `biome.jsonc`.
5. `bun install`.

**Verify**: `ls components/ui | wc -l` → `16`; `bun install --frozen-lockfile` → exit 0; `bun run verify` → exit 0; `bun run build` → exit 0; `bun run test:e2e` → 3 passed; `grep -c "recharts\|sonner\|cmdk\|embla\|input-otp\|next-themes\|react-resizable-panels" bun.lock` → `0`.

Commit: `chore: remove unreachable shadcn components and their dependencies`.

### Step 6: Stale comment and editor default formatter

- `types/three-mesh-bvh.d.ts`: change `app/city/_components/collision.ts` to `app/_components/collision.ts`.
- `.vscode/settings.json`: change `"editor.defaultFormatter"` to `"biomejs.biome"`.

**Verify**: `grep -n "app/city" types/three-mesh-bvh.d.ts` → no output; `grep -n "prettier" .vscode/settings.json` → no output.

Commit: `chore: fix stale path comment and editor formatter`.

### Step 7: Pin the MCP server

`.mcp.json`: replace `"shadcn@latest"` with `"shadcn@<version>"` where
`<version>` is the resolved `shadcn` version in `bun.lock` (search for
`"shadcn@`). Add a one-line `"//"`-style comment is not valid JSON — instead
mention the pin in AGENTS.md (Step 9). If PR #16 is open, this file will
conflict trivially; still do it.

**Verify**: `grep -n "shadcn@latest" .mcp.json` → no output.

Commit: `chore: pin the shadcn MCP server version`.

### Step 8: Rewrite `README.md`

Replace the whole file using the "Facts for the README" list above. Required
sections, in this order: title + one-paragraph description; Prerequisites;
Quickstart; Data (pipeline, tile id and scheme, CRS/georef requirements
with the two CLI recipes, provenance with the `TODO(maintainer):` line);
Controls (desktop and touch tables); Architecture (the frame summary with
file links, the handle pattern, demolish design, the patched loader);
Development (`bun run verify`, unit vs e2e, the debug hook and
`NEXT_PUBLIC_POC_DEBUG`, `bun fix`); a short "Plans" line pointing at
`plans/README.md`. Keep it under ~150 lines. Do not describe features that
do not exist.

**Verify**: `grep -c "create-next-app\|Geist\|Vercel" README.md` → `0`; `grep -n "prepare-data" README.md` → ≥ 1 hit; `grep -n "EPSG:25833" README.md` → ≥ 1 hit; `bun lint` → exit 0.

Commit: `docs: rewrite README for the city viewer`.

### Step 9: `AGENTS.md` additions — ONLY after PR #16 is resolved

(PR #16 rewrites `AGENTS.md` +156/−58; if it is open, skip and note it.)
Append a section:

```markdown
## Verification

- `bun run verify` = lint + typecheck + unit tests. Run it before pushing.
- E2E: `bunx playwright install chromium` once, then `bun run test:e2e`.
  The spec drives the viewer through `window.__poc` (app/_components/poc-debug.ts);
  changing that hook means updating e2e/city-walk.spec.ts.

## Repo rules that are easy to break

- `lib/city/**` is pure logic: no `three`, no DOM, every module has a colocated `*.test.ts`.
  three.js glue lives in `app/_components/`.
- `components/ui/**` is vendored by `shadcn add` — regenerate, never hand-edit. Adding a
  component adds its dependency; removing one should remove the dependency too.
- Tile data: `data/` → `scripts/prepare-data.ts` → `public/data/` (gitignored). The tile id
  lives in `lib/city/tile.ts` (or, before plan 004, in both the script and
  `app/_components/city-walk-client.tsx` — change both).
- Vendored agent skills live in `.agents/skills/` (symlinked from `.claude/skills/`), pinned by
  `skills-lock.json`; never edit them in place.
- Version pins: exact for the three.js stack (`three`, `@types/three`, `postprocessing`,
  `n8ao`, `three-mesh-bvh`, `cityjson-threejs-loader`), the framework trio and the
  formatters; caret for everything else. `.mcp.json` pins the shadcn MCP server to the
  lockfile version.
```

Also fix the stale line "Theme components may use scoped `<style>` for fonts" (there are no theme components) by deleting it.

**Verify**: `grep -n "bun run verify" AGENTS.md` → 1 hit; `grep -n "Theme components" AGENTS.md` → no output.

Commit: `docs: add verification and repo rules to AGENTS.md`.

### Step 10: Full verification

`bun install --frozen-lockfile` → exit 0; `bun run verify` → exit 0; `bun run build` → exit 0; `bun run test:e2e` → 3 passed.

## Test plan

No new tests — this plan changes no runtime code paths except font loading
and dependency presence, both covered by `bun run build` and the existing
e2e suite (mobile drawer title uses `font-heading`).

## Done criteria

- [ ] `bun install --frozen-lockfile`, `bun run verify`, `bun run build`, `bun run test:e2e` all succeed
- [ ] `grep -n '"name": "activity-card"' package.json` → no output
- [ ] `grep -c "giro3d\|fast-xml-parser\|fit-file-parser\|html-to-image" package.json bun.lock` → `0` for both
- [ ] `grep -n "ignoreScripts" package.json` → no output; `grep -n "packageManager" package.json` → 1 hit
- [ ] `grep -c "bun-version: latest" .github/workflows/ci.yml` → `0`
- [ ] `grep -n "strava\|components/themes\|storybook" biome.jsonc eslint.config.mts` → no output
- [ ] `grep -c "next/font/google" app/layout.tsx` → `1` and exactly two font constructors remain
- [ ] `grep -c "create-next-app" README.md` → `0`
- [ ] Steps 5 and 9 either done (with PR #16 confirmed resolved) or explicitly skipped in the status row
- [ ] `git status --porcelain` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- `bun run build` fails after Step 1 because `shadcn/tailwind.css` cannot be
  resolved — report; do not move `shadcn` back without saying why.
- `bun run build` fails after Step 4 with a missing `--font-heading`
  consumer — the drawer/card title classes changed; report.
- Step 5's reachability script returns fewer than 13 entries.
- Any `bun.lock` change you did not cause via `bun install` (never hand-edit it).
- You are asked to (or want to) touch a file outside the in-scope list.

## Maintenance notes

- Dependabot will now propose the three.js stack as one PR; merging that PR
  still needs a manual WebGL smoke run — the peer range on `postprocessing`
  is the constraint to watch.
- When `shadcn add` is used again, expect a new dependency in the diff and
  a new file under `components/ui/`; both should be reviewed together.
- The README's data-provenance TODO needs the maintainer: source portal,
  download date, licence and attribution string for the Saxony open data.
- Open maintainer decisions recorded in `plans/README.md`, not here: drop
  ESLint in favour of Biome only; SHA-pin GitHub Actions; close the
  superseded Dependabot PRs (#9, #13, #15) and check `suncalc` 2.0's API
  before merging #10.
