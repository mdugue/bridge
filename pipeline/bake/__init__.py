"""The offline geodata bakes: provider downloads -> the per-tile artifacts
committed under data/ (see docs/data-pipeline.md). One package, one Python
environment (pyproject.toml / uv.lock), run through `bun run bake`."""
