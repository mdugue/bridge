# ADR 0025: The bakes are one Python package in a uv environment; OSM comes only from a local extract

- **Status:** accepted (tightens [ADR 0012](./0012-openstreetmap-for-what-official-data-lacks.md))
- **Date:** 2026-09

## Context

Seven bash scripts drove GDAL CLIs and embedded Python/Pillow heredocs.
numpy and `gdal_calc.py` were unavailable on the bake machine, so raster
maths was written around Pillow (palette-mode tricks, float images, a
pure-Python nDOM loop). Tile names, extents and `EPSG:25833` were spelled
in each script. Lamps, platforms and bridge structures came from live
Overpass queries (rate-limited, not reproducible); walls already came from
a local `.osm.pbf`.

## Decision

The bakes are one package, `pipeline/bake/`, on numpy, rasterio, pyogrio,
shapely and pyproj — wheels that bundle GDAL, pinned in
`pipeline/pyproject.toml` + `uv.lock`, so `uv sync` is the whole setup
(no system GDAL, no Homebrew). `bun run bake` reads the site config
(ADR 0026) and runs the steps per tile; `--ingest` first runs the site's
ingest adapter, which fetches the provider's downloads into the canonical
raw layout `data/_raw/<site>/{dom1,dop,dlm,osm}`. **Every OSM input is read
from that local extract** through GDAL's OSM driver. TypeScript stays in
the build step (`prepare-data.ts`), which turns data/ into the tileset.

## Consequences

- One language per stage: Python for geodata → data/, TypeScript for
  data/ → the tileset; bash is gone.
- A re-bake is reproducible from the recorded downloads.
- CI runs the pipeline's unit tests and ruff; the bakes themselves need
  the raw downloads and run on the maintainer's machine.
- Outputs are checked against the committed artifacts (see
  docs/data-pipeline.md); the committed data was not re-baked, because the
  current Basis-DLM edition differs.

## Alternatives

- **Keep bash, add numpy:** still three languages and string-built paths.
- **All TypeScript (gdal-async, geotiff.js):** a weaker geodata stack; the
  mesh bake stays TS because it reuses three.js.
- **Conda / pixi:** heavier than uv for pure-wheel dependencies.

## References

- `pipeline/`, `scripts/bake.ts`, `pipeline/bake/ingest_sn.py`; plan 017;
  ADR 0012.
