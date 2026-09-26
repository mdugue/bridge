"""`python -m bake <step> --tile ID --bounds XMIN YMIN XMAX YMAX --epsg N`
(the arguments come from the site config; `bun run bake` passes them)."""

from __future__ import annotations

import argparse
from pathlib import Path

from . import (
    canopy,
    cultivated,
    edges,
    furniture,
    lamps,
    landcover,
    lowveg,
    markings,
    monuments,
    names,
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
from .common import Tile

STEPS = {
    "landcover": landcover.run,
    "islands": landcover.run_islands,
    "canopy": canopy.run,
    "trees": trees.run,
    "ndvi": ndvi.run,
    "roof-colour": roof_colour.run,
    "osm-buildings": osm_buildings.run,
    # Before the furniture (it keeps benches off the bridge decks), the tram
    # and the names (the bridge names), lowveg and small-buildings (masks).
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
    # After rail (the bridge names).
    "names": names.run,
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
    parser.add_argument("step", choices=[*STEPS, "all"])
    parser.add_argument("--tile", required=True)
    parser.add_argument("--bounds", nargs=4, type=float, required=True)
    parser.add_argument("--epsg", type=int, required=True)
    parser.add_argument("--raw", type=Path, required=True, help="the site's canonical raw folder")
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument(
        "--research",
        action="store_true",
        help="lowveg: also write every candidate (scan-only hedges, shrubs) under the raw folder",
    )
    args = parser.parse_args()
    tile = Tile(args.tile, tuple(args.bounds), args.epsg, args.raw, args.data)
    steps = list(STEPS) if args.step == "all" else [args.step]
    for step in steps:
        if step == "lowveg":
            lowveg.run(tile, research=args.research)
        else:
            STEPS[step](tile)


if __name__ == "__main__":
    main()
