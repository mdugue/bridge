"""`python -m bake {fetch,bake} --spec JSON [--step S] [--tile ID ...]`.

`bun run fetch` / `bun run bake` (scripts/pipeline.ts) call this with the
site spec (bake/spec.py) written from the TypeScript site config."""

from __future__ import annotations

import argparse

from . import (
    canopy,
    cultivated,
    doors,
    dormers,
    edges,
    facades,
    fetch,
    furniture,
    lamps,
    landcover,
    landmarks,
    lowveg,
    mapillary,
    markings,
    monuments,
    ndvi,
    osm_buildings,
    plinths,
    rail,
    riverside,
    roof_colour,
    roofs,
    shopfronts,
    skyview,
    small_buildings,
    soundmarks,
    sport,
    stairs,
    structures,
    surface,
    traffic,
    tram,
    transit,
    trees,
    walls,
)
from .spec import parse

STEPS = {
    "landcover": landcover.run,
    "islands": landcover.run_islands,
    # Before the canopy (no tree on a deck; without a DLM the decks are
    # OSM's, rail_osm.py), the furniture (it keeps benches off the decks),
    # the tram, lowveg and small-buildings (masks).
    "rail": rail.run,
    "canopy": canopy.run,
    "trees": trees.run,
    "ndvi": ndvi.run,
    "roof-colour": roof_colour.run,
    "osm-buildings": osm_buildings.run,
    # OSM entrances on the LoD2 walls (scripts/bake-city-mesh.ts draws them).
    "doors": doors.run,
    # The LoD2 walls' street side as plinth runs on the DGM (the same bake).
    "plinths": plinths.run,
    "lamps": lamps.run,
    "monuments": monuments.run,
    "furniture": furniture.run,
    # After the lamps and the furniture: Mapillary's lamps and bins where
    # OSM has none.
    "mapillary": mapillary.run,
    # What Mapillary's panoramas say about the facades (measured by the
    # fetch): three readings per building for the clay.
    "facades": facades.run,
    # The same measurements per wall: the ground floor's bays and store
    # signs (OSM's shops where no photo shows one).
    "shopfronts": shopfronts.run,
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
    # The site's counted motor traffic (its source, cached by the fetch).
    "traffic": traffic.run,
    # After NDVI (a crown over a roof is not the roof): the LoD2 roofs that
    # miss DOM1, rebuilt in its form (scripts/bake-city-mesh.ts).
    "roofs": roofs.run,
    # Committed inputs only (DGM + LoD2 + the rebuilt roofs): the sky-view
    # factor and far horizon.
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
    # Wikidata's notable buildings (fetched by `bun run fetch`), matched to
    # the LoD2 objects that draw them: marked, named, listed in the HUD.
    "landmarks": landmarks.run,
    # After landmarks (their roofs' relief): DOM1 against LoD2, confirmed by
    # OSM — the chimneys, towers and masts LoD2 leaves out, the buildings it
    # does not carry yet, and a landmark's roof form it flattens (plan 050).
    "structures": structures.run,
    # After roofs (the rebuilt ones are measured already) and the tree bakes
    # (a crown over a roof is no dormer): the dormers DOM1 shows on the
    # pitched LoD2 roofs.
    "dormers": dormers.run,
}


# Run once for the site, after every tile (they read the tiles' files: the
# timetable trams ride the tram tracks).
SITE_STEPS = ("transit",)


def site_extent(spec) -> tuple[float, float, float, float]:
    b = [t.bounds for t in spec.tiles]
    return (
        min(x[0] for x in b),
        min(x[1] for x in b),
        max(x[2] for x in b),
        max(x[3] for x in b),
    )


def run_site_step(spec, step: str) -> None:
    if step == "transit":
        if not spec.trams:
            print(f"{spec.site}: the site runs no timetable trams — skipping transit")
            return
        transit.run_site(spec.raw, spec.data, site_extent(spec), spec.epsg)


def main() -> None:
    parser = argparse.ArgumentParser(prog="bake")
    parser.add_argument("command", choices=["fetch", "bake"])
    parser.add_argument("--spec", required=True, help="the site spec as JSON")
    parser.add_argument("--step", choices=[*STEPS, *SITE_STEPS, "all"], default="all")
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
    if args.step in SITE_STEPS:
        run_site_step(spec, args.step)
        return
    steps = list(STEPS) if args.step == "all" else [args.step]
    for tile in tiles:
        for step in steps:
            if step == "lowveg":
                lowveg.run(tile, research=args.research)
                continue
            STEPS[step](tile)
    if args.step == "all" and not args.tile:
        for step in SITE_STEPS:
            run_site_step(spec, step)


if __name__ == "__main__":
    main()
