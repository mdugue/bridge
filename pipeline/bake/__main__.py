"""`python -m bake {fetch,bake} --spec JSON [--step S] [--tile ID ...]`.

`bun run fetch` / `bun run bake` (scripts/pipeline.ts) call this with the
site spec (bake/spec.py) written from the TypeScript site config."""

from __future__ import annotations

import argparse

from . import (
    canopy,
    edges,
    fetch,
    lamps,
    landcover,
    monuments,
    ndvi,
    rail,
    roof_colour,
    stairs,
    surface,
    walls,
)
from .spec import parse

STEPS = {
    "landcover": landcover.run,
    "islands": landcover.run_islands,
    "canopy": canopy.run,
    "ndvi": ndvi.run,
    "roof-colour": roof_colour.run,
    "lamps": lamps.run,
    "monuments": monuments.run,
    "walls": walls.run,
    "stairs": stairs.run,
    "rail": rail.run,
    "surface": surface.run,
    "edges": edges.run,
}


def main() -> None:
    parser = argparse.ArgumentParser(prog="bake")
    parser.add_argument("command", choices=["fetch", "bake"])
    parser.add_argument("--spec", required=True, help="the site spec as JSON")
    parser.add_argument("--step", choices=[*STEPS, "all"], default="all")
    parser.add_argument("--tile", nargs="*", default=[], help="only these tile ids")
    args = parser.parse_args()
    spec = parse(args.spec)
    unknown = set(args.tile) - {t.id for t in spec.tiles}
    if unknown:
        parser.error(f"not a tile of {spec.site}: {', '.join(sorted(unknown))}")
    tiles = [t for t in spec.tiles if not args.tile or t.id in args.tile]
    if args.command == "fetch":
        fetch.run(spec, tiles)
        return
    steps = list(STEPS) if args.step == "all" else [args.step]
    for tile in tiles:
        for step in steps:
            STEPS[step](tile)


if __name__ == "__main__":
    main()
