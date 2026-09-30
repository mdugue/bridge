"""`python -m bake {fetch,bake} --spec JSON [--step S] [--tile ID ...]`.

`bun run fetch` / `bun run bake` (scripts/pipeline.ts) call this with the
site spec (bake/spec.py) written from the TypeScript site config."""

from __future__ import annotations

import argparse

from . import (
    canopy,
    cultivated,
    edges,
    fetch,
    furniture,
    lamps,
    landcover,
    lowveg,
    markings,
    monuments,
    ndvi,
    osm_buildings,
    rail,
    riverside,
    roof_colour,
    skyview,
    small_buildings,
    soundmarks,
    sport,
    stairs,
    surface,
    tram,
    trees,
    walls,
)
from .spec import parse

STEPS = {
    "landcover": landcover.run,
    "islands": landcover.run_islands,
    "canopy": canopy.run,
    "trees": trees.run,
    "ndvi": ndvi.run,
    "roof-colour": roof_colour.run,
    "osm-buildings": osm_buildings.run,
    # Before the furniture (it keeps benches off the bridge decks), the tram,
    # lowveg and small-buildings (masks).
    "rail": rail.run,
    "lamps": lamps.run,
    "monuments": monuments.run,
    "furniture": furniture.run,
    "walls": walls.run,
    "stairs": stairs.run,
    "surface": surface.run,
    "edges": edges.run,
    # After surface and edges (reads the class raster only).
    "markings": markings.run,
    "sport": sport.run,
    # After land cover, NDVI and the furniture (the stop signs skip a stop
    # that already has a shelter).
    "tram": tram.run,
    "riverside": riverside.run,
    # Committed inputs only (DGM + LoD2): the sky-view factor and far horizon.
    "skyview": skyview.run,
    # OSM churches + the committed LoD2/DGM: the bell towers the hidden
    # soundscape strikes the hour from (plan 035).
    "soundmarks": soundmarks.run,
    # Last: thinned against the canopy and the cadastre, masked by the walls
    # and the bridges.
    "lowveg": lowveg.run,
    # After lowveg: an orchard tree gives way to a measured one (the canopy,
    # the laser-scan crowns, the cadastre).
    "cultivated": cultivated.run,
    # After lowveg (the same laser-scan rasters, made on first use), walls,
    # rail (bridges), monuments and furniture (stop shelters): the small
    # structures LoD2 lacks, appended to the city mesh at build time.
    "small-buildings": small_buildings.run,
}


def main() -> None:
    parser = argparse.ArgumentParser(prog="bake")
    parser.add_argument("command", choices=["fetch", "bake"])
    parser.add_argument("--spec", required=True, help="the site spec as JSON")
    parser.add_argument("--step", choices=[*STEPS, "all"], default="all")
    parser.add_argument("--tile", nargs="*", default=[], help="only these tile ids")
    parser.add_argument(
        "--lsc",
        action="store_true",
        help="fetch: also the laser scan where the provider publishes one (≈380 MB a tile)",
    )
    parser.add_argument(
        "--research",
        action="store_true",
        help="lowveg: also write every candidate (scan-only hedges, shrubs) under the raw folder",
    )
    args = parser.parse_args()
    spec = parse(args.spec)
    unknown = set(args.tile) - {t.id for t in spec.tiles}
    if unknown:
        parser.error(f"not a tile of {spec.site}: {', '.join(sorted(unknown))}")
    tiles = [t for t in spec.tiles if not args.tile or t.id in args.tile]
    if args.command == "fetch":
        fetch.run(spec, tiles, lsc=args.lsc)
        return
    steps = list(STEPS) if args.step == "all" else [args.step]
    for tile in tiles:
        for step in steps:
            if step == "lowveg":
                lowveg.run(tile, research=args.research)
                continue
            STEPS[step](tile)


if __name__ == "__main__":
    main()
