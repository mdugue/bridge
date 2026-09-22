# ADR 0004: Commit small derived artifacts, not raw bulk data; the DGM1 GeoTIFF is the one exception; no Git-LFS

- **Status:** accepted
- **Date:** 2026-06 (initial data commits), the exception documented 2026-09 (plan 014)

## Context

The raw downloads are large and reproducible: the statewide Basis-DLM is
several gigabytes, a DOP tile hundreds of megabytes, the Geofabrik extract
~250 MB. What the viewer needs per tile is small (a few MB of PNG and
GeoJSON). The build must run on a hosted CI/deploy container that has no
access to the raw downloads and no GDAL.

## Decision

- Raw downloads live in `data/_raw/` (gitignored) on the maintainer's
  machine only.
- The bake scripts' outputs — per-tile PNG, GeoJSON and JSON under
  `data/dlm/` and `data/dop/`, and the converted CityJSON under
  `data/cityjson/` — are committed. They are the repository's single
  source of truth for what the viewer renders.
- **Exception:** the DGM1 GeoTIFF with its `.tfw` and `_akt.csv` is
  committed per tile (13–15 MB each), because `prepare-data.ts` bakes the
  heightfield from it at build time (ADR 0003) and `extract-canopy.sh` /
  `extract-rail.sh` read it. It is the only raw source in the tree.
- No Git-LFS: the committed data (~130 MB) is within what a plain clone
  tolerates, and LFS would add a second storage system to every contributor
  and CI setup.

## Consequences

- Anyone can clone, `bun install` and `bun dev` without GDAL or any
  download.
- Re-baking is a maintainer action; a bake change shows up as a data diff
  in the PR.
- CI clones with `--depth=1`-style fetches to keep the ~130 MB manageable.
- Committing a new tile means committing its GeoTIFF; the repo grows by
  ~15 MB per tile plus derivatives. Two DGM tiles (`33414_*`) are committed
  but unused — a maintainer decision whether to remove them.
- The DOM1, DOP, DLM and OSM raws are *not* reproducible from the repo;
  their editions must be recorded by hand (guide: dataset editions).

## Alternatives

- **Commit all raws (with or without LFS):** rejected — gigabytes, and the
  bake needs GDAL anyway.
- **Bake the heightfield offline and commit it too:** possible, but the
  build-time bake keeps the format free to change without a data commit and
  keeps one artifact list (`tileArtifacts`) authoritative.
- **Download raws in CI:** rejected — no stable download URLs per tile,
  and the build should not depend on a third party being up.

## References

- AGENTS.md "Data pipeline"; `.gitignore`; plan 014 (the documented
  exception, finding #59); [data-pipeline.md](../data-pipeline.md).
