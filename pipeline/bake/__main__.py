"""`python -m bake {fetch,bake} --spec JSON [--step S] [--tile ID ...]
[--jobs N]`.

`bun run fetch` / `bun run bake` (scripts/pipeline.ts) call this with the
site spec (bake/spec.py) written from the TypeScript site config."""

from __future__ import annotations

import argparse
import multiprocessing
from concurrent.futures import ProcessPoolExecutor

from . import (
    canopy,
    cultivated,
    doors,
    dormers,
    edges,
    facades,
    fetch,
    furniture,
    lamp_heights,
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
    sport,
    stairs,
    structures,
    surface,
    traffic,
    tram,
    transit,
    trees,
    walls,
    windows,
)
from .spec import parse

STEPS = {
    "landcover": landcover.run,
    "islands": landcover.run_islands,
    # Before the canopy (no tree on a deck; without a DLM the decks are
    # OSM's, rail_osm.py), the furniture (it keeps benches off the decks),
    # the tram, lowveg and small-buildings (masks).
    "rail": rail.run,
    # Before the canopy (its courtyard crowns are green in it), on one scale
    # for the whole site (its anchors pooled over the site's tiles).
    "ndvi": ndvi.run,
    "canopy": canopy.run,
    "trees": trees.run,
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
    # After the lamps and Mapillary's: their posts' heights, measured in
    # DOM1 street by street.
    "lamp-heights": lamp_heights.run,
    # What Mapillary's panoramas say about the facades (measured by the
    # fetch): three readings per building for the clay.
    "facades": facades.run,
    # The same measurements per wall: the ground floor's bays and store
    # signs (OSM's shops where no photo shows one).
    "shopfronts": shopfronts.run,
    # The facade traits per wall (the fetch's trait profiles): the windows
    # and their surrounds the building bake models.
    "windows": windows.run,
    "walls": walls.run,
    "stairs": stairs.run,
    "surface": surface.run,
    "edges": edges.run,
    # After surface and edges (reads the class raster only).
    "markings": markings.run,
    # After the NDVI: an untagged surface is read off the orthophoto.
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
    # Last: thinned against the canopy and the cadastre, masked by the walls
    # and the bridges.
    "lowveg": lowveg.run,
    # After lowveg: an orchard tree gives way to a measured one (the canopy,
    # the laser-scan crowns, the cadastre).
    "cultivated": cultivated.run,
    # After the tree bakes (the canopy, the cadastre, lowveg's scan crowns:
    # the sky view's half-transparent crowns): committed inputs (DGM + LoD2
    # + the rebuilt roofs + the crowns) and the cached GLO-30 beyond the
    # site — the sky-view factor, the far horizon and the valley's rim.
    "skyview": skyview.run,
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
    # After roofs (a rebuilt roof's parts are read each in its own colour),
    # small-buildings and structures (the scan's sheds and the buildings
    # LoD2 lacks are read too); after landcover: the site's carriageways
    # give its flight's cast.
    "roof-colour": roof_colour.run,
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


def run_tile(step: str, tile, site_tiles, research: bool = False) -> None:
    """One step on one tile; ndvi, roof-colour and sport read the site's
    every tile besides."""
    if step == "lowveg":
        lowveg.run(tile, research=research)
    elif step == "ndvi":
        ndvi.run(tile, site_tiles)
    elif step == "roof-colour":
        roof_colour.run(tile, site_tiles)
    elif step == "sport":
        sport.run(tile, site_tiles)
    else:
        STEPS[step](tile)


def run_step(step: str, tiles, site_tiles, jobs: int, research: bool = False) -> None:
    """A step over the tiles, `jobs` tiles at a time. Each tile writes only
    its own files and reads only what earlier steps wrote, so the tiles of
    one step run side by side; the next step starts once all are done."""
    if jobs <= 1 or len(tiles) <= 1:
        for tile in tiles:
            run_tile(step, tile, site_tiles, research)
        return
    # fork: the workers share the parent's loaded modules, and no dataset
    # is open between two steps
    context = multiprocessing.get_context("fork")
    with ProcessPoolExecutor(min(jobs, len(tiles)), mp_context=context) as pool:
        runs = [pool.submit(run_tile, step, t, site_tiles, research) for t in tiles]
        for done in runs:
            done.result()


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
        "--jobs",
        type=int,
        default=1,
        help="bake: this many tiles of a step side by side (one process each)",
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
    # Step by step over the tiles, not tile by tile: ndvi, roof-colour and
    # sport read every tile of the site (its class rasters, the anchors of
    # its one flight), which the steps before them must have baked first.
    for step in steps:
        run_step(step, tiles, spec.tiles, args.jobs, args.research)
    if args.step == "all" and not args.tile:
        for step in SITE_STEPS:
            run_site_step(spec, step)


if __name__ == "__main__":
    main()
