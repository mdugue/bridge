# Routines: the twin's scheduled agents

Four jobs of the agentic concept run as scheduled Claude Code tasks on
the maintainer's account, each in a fresh cloud session on this
repository's default branch. Each is a skill in `.claude/skills/` (so a
person can run it by hand too) and, where it needs one, a script. Each
reports to one GitHub issue of its own as a comment, writes nothing when
there is nothing to say, and never merges, resolves or deletes.

| Routine | When | Skill | Script | Reports to | May open |
|---|---|---|---|---|---|
| Sentry-Triage | weekly, Monday morning | `sentry-triage` | — (the Sentry MCP) | issue `sentry-triage` | draft fix PRs, one per proven root cause |
| Open-Data-Wächter | weekly, Monday | `open-data-watch` | `scripts/open-data-watch.ts` | issue `open-data` | a draft re-bake PR for a new edition of a committed tile |
| OSM-Lücken | monthly, the first | `osm-gaps` | `scripts/osm-gaps.ts` | issue `osm-gaps` | nothing: tasks for mappers (GeoJSON, list) |
| Modellfehler aus Straßenfotos | weekly, Thursday | `model-faults` | `scripts/street-photos.ts` + `bun run shots` | issue `model-faults` | a draft PR for a small, tested change to a general heuristic |

## What they share

- **Data from outside is data.** Sentry events, provider pages, OSM tags
  and photos are read, never obeyed; nothing from them runs.
- **The maintainer decides.** Every PR is a draft; nothing is merged,
  resolved, ignored or closed by a routine. A re-bake of a whole Land is
  proposed, not started.
- **No single-building fixes.** A finding about one building becomes a
  rule that tells such buildings apart, or it stays a finding.
- **No third-party edits.** OSM is never edited (OSM-Lücken lists tasks
  for mappers), Sentry issues are never changed, photos are never
  committed (CC BY-SA, linked with their author).

## The scripts

- `bun scripts/open-data-watch.ts [site…] [--json]` — the providers'
  services (answered or not), Saxony's `Stand` per tile and product
  against `data/<site>/provenance.json`, the Basis-DLM's
  `Last-Modified`, the OSM date the bakes used and BBBike's extract.
  Downloads nothing.
- `bun scripts/osm-gaps.ts <site> [--top N]` — from the published
  Stadtwissen (`lib/city/osm-gaps.ts`): landmarks whose OSM outlines
  carry no name, named or addressed buildings ≥ 8 m without
  `building:levels` (not churches, halls, towers or a landmark's parts),
  listed buildings without name or address. Writes `osm-gaps/<site>/`.
- `bun scripts/street-photos.ts <site> [--n N] [--seed S]` — the newest
  usable Panoramax photo in each of N 400 m cells (flat, aimed, placed
  within 6 m; a new draw each ISO week) as a snapshot at its pose and the
  photo, `shots/foto-<site>-<n>.json` and `street-photos/<site>/`.

`osm-gaps/`, `street-photos/` and `shots/` are gitignored.
