---
name: open-data-watch
description: "The weekly Open-Data-Wächter of city walk, run by a scheduled task (or by hand): check the Länder's download services, new editions of DGM1, DOM1, LoD2, DOP and the Basis-DLM, and the age of the OSM data the bakes used; report on the open-data issue, and where a new edition of a committed tile is out, try the re-bake as a draft PR."
---

# Open-Data-Wächter

The twin is built from open data that changes under it: Saxony replaces
tiles as it flies them again, the statewide Basis-DLM every quarter, OSM
every minute; services go down for days (GeoSN's in 2026-10). This skill
says what changed since the committed data was fetched and does the first
step about it.

## Run the check

```bash
bun scripts/open-data-watch.ts            # every committed site
bun scripts/open-data-watch.ts dresden    # one
bun scripts/open-data-watch.ts --json     # for a script
```

It downloads no data. Its report has two parts: **Zu tun** (a service
that does not answer, a newer `Stand` than `provenance.json` records, a
newer Basis-DLM, OSM data older than 60 days) and **Stand** (what answered,
and editions no record holds yet). Only a recorded edition can be
outdone: `bun scripts/open-data-watch.ts <site> --record` writes the
current ones into the tiles that record none, right after a fetch.

## Act on it

1. **Nothing under „Zu tun“:** stop. Write nothing.
2. **A service down:** say which, since when (look at the last comment on
   the issue: was it down last week too?), and whether a re-bake is
   blocked by it. Three weeks in a row is worth a line to the maintainer.
3. **A new edition of a committed tile** (DGM1, LoD2, DOM1, DOP): try the
   re-bake on a branch `claude/rebake-<site>-<date>`. The fetch keeps
   any file already there, so first move the changed product's files of
   those tiles aside (the committed `data/<site>/dgm/dgm1_<tile>_tiff/`,
   `data/<site>/cityjson/lod2_<tile>.city.json`, or the raw ones under
   `data/_raw/`), then fetch the whole site, `bun run fetch <site>` (plus
   `--lsc` where its provenance names the laser scan): a fresh container
   holds no raw inputs, and a step without them rewrites its committed
   output with less (hedges without the scan, lamps without their
   measured heights). A download of the changed tiles that comes back
   byte for byte the same is no new data: report it, record nothing.
   Then bake the whole site, `bun run bake <site>` — steps read their
   neighbours across a seam, so a tile alone leaves the seams stale.
   Some „skipping“ lines are the site's design: they name the site's
   configuration („the site names no …“, „the site runs no …“) or an
   empty tile („no lamps“). Every other one names a missing file, folder
   or cache („no … at/under …“, „no complete …“, „not cached“): that step
   kept its old outputs, so the PR would mix two editions. Some steps
   instead write an empty file without their cache (the Mapillary
   facades, windows and lamps: „no facade measurements“, „no Mapillary
   cache“; the container has no `MAPILLARY_TOKEN`), so also check
   `git diff --stat data/<site>/`: an output of a tile whose edition did
   not change must not shrink or vanish. Either case: no PR, a line in
   the report naming the steps. Then `bun run test:pipeline`,
   `bun run verify`, then update `data/<site>/provenance.json` (the new
   `Stand` and the date; after a new Basis-DLM, its `lastModified` day
   under `geosn["Basis-DLM"]`, which the check compares against) and the guide's dataset table in both languages.
   Open a **draft PR**; it changes what the viewer shows, so it carries
   snapshots (the `pr-snapshots` skill) of the changed tiles. A fetch
   that fails (the service is down, the raw data is gigabytes the
   container cannot hold) is a line in the report, not a half PR.
4. **A newer Basis-DLM, OSM older than 60 days:** these re-bake every
   tile of every site of that Land (hours, gigabytes). Do not start it:
   report it with what it would touch, for the maintainer to schedule.
   The maintainer's rule: bake from fresh OSM extracts (BBBike works from
   the container, Geofabrik does not), never dodge a re-bake — so say
   plainly when one is due.
5. **Editions no record holds:** list them once (they stay until someone
   records them); recording them is a small PR of its own if asked.
6. **Report** in German as one comment on the open issue labelled
   **`open-data`** in `mdugue/bridge` (create it, titled
   „Open-Data-Wächter“, only if none is open): the „Zu tun“ lines with
   what was done about each, links to any PR, and the report's
   „Stand“ folded under `<details>`.

## Never

- commit raw downloads (`data/_raw/` is gitignored for a reason) or
  another site's data folder that is not committed yet (ADR 0037);
- merge, or push to a branch other than the re-bake's own;
- re-bake a whole Land on your own initiative.
