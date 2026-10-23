# ADR 0019: oxlint + oxfmt and the native TypeScript 7 compiler; no ESLint, no biome

- **Status:** accepted
- **Date:** 2026-09-21 (plan 013 and its follow-ups)

## Context

Three different TypeScript compilers once checked the repo: a frozen
preview build of TS 7 for `bun typecheck`, TS 6 inside `next build`, and
TS 6 via typescript-eslint. A green `verify` did not predict a green build.
TypeScript 7 (the native, Go-based compiler) ships no `lib/typescript.js`,
so the classic JS compiler API is gone; typescript-eslint hard-crashes on it
and no channel accepts `typescript >= 7`. biome (with the ultracite preset)
had 451 style violations that were a refactor, not a config change, and its
oxlint preset is as opinionated.

## Decision

- **One TypeScript, 7.x native.** `bun typecheck` (`tsc --noEmit`) and
  `next build` run the same compiler. No tool that needs the JS compiler
  API is used (`@typescript/typescript6` is the shim if ever needed).
- **oxlint + oxfmt** replace ESLint and biome. `.oxlintrc.json` names its
  rules explicitly (the `correctness` default reports nothing here; the
  categories `suspicious`, `pedantic` and `style` add hundreds of findings
  that do not fit this codebase). Type-aware rules run through
  `oxlint-tsgolint`; three deliberately unlisted (`strict-boolean-
  expressions`, `no-unnecessary-condition`, `no-confusing-void-expression`)
  each flag idioms the code uses on purpose. `--max-warnings=0`; a
  complexity cap of 20. Markdown is excluded from oxfmt (it detaches list
  continuation lines). CSS is no longer linted, knowingly.
- **Pins:** exact for the three.js stack, the framework trio, the lint
  tools (bump `oxlint` and `oxlint-tsgolint` together) and `suncalc`
  (its 2.0 changed units and the azimuth origin — a silent float would
  rotate the sun rather than fail); the Bun version comes from
  `packageManager`; `.mcp.json` pins both MCP servers.
- No interpreter grants (`node -e`, `python3 -`) in the committed agent
  allowlist; those belong in the untracked local settings.

## Consequences

- One rule of `eslint-config-next` has no oxlint equivalent
  (`no-location-assign-relative-destination`); nothing here calls
  `location.assign`.
- `allowJs: true` cannot be removed from `tsconfig.json` — `next build`
  rewrites it back.
- Prose stays hand-wrapped; `bun run fix` before `bun run verify` (no
  format-on-save hook for Claude Code after it reformatted files with
  conflict markers).
- Re-adding ESLint to "recover" a rule must first check oxlint's full
  catalogue (`oxlint --print-config -D all`).

## Alternatives

- **ESLint 10 on TS 6:** a second compiler forever; rejected.
- **biome + ultracite:** the style refactor; rejected.
- **Adopting ultracite's oxlint preset:** same refactor, and JSON configs
  cannot `extends` its `.mjs` presets; rejected.

## Amendment (2026-10-23): `bun check` for the fast check

`bun typecheck` runs `bun check` (Bun 1.4.4), Bun's port of the same
checker: 0.5 s where `tsc --noEmit` took 3.8 s cold on four cores, with
identical output on a probe file of thirteen error kinds, and no
incremental cache to go stale (tsc's `tsconfig.tsbuildinfo` once kept an
error a dependency update had removed). It is a second implementation, so
the one-compiler guarantee is kept where it gates: `next build` still
type-checks with tsc 7, and CI's Typecheck job runs `bun typecheck` and
`bun run typecheck:tsc` (tsc) both — green only where they agree. A
disagreement is a Bun bug to report; tsc is the reference.

## References

- plan 013; AGENTS.md "Commands", "Conventions"; `.oxlintrc.json`,
  `.oxfmtrc.json`, `package.json`.
