"""`python -m bake {fetch,bake} --spec JSON [--step S] [--tile ID ...]
[--jobs N]`.

`bun run fetch` / `bun run bake` (scripts/pipeline.ts) call this with the
site spec (bake/spec.py) written from the TypeScript site config."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import multiprocessing
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from . import (
    canopy,
    cultivated,
    doors,
    dop_balance,
    dormers,
    edges,
    facades,
    fetch,
    furniture,
    lamp_heights,
    lamps,
    landcover,
    landmark_facts,
    landmarks,
    lowveg,
    mapillary,
    markings,
    monuments,
    murals,
    ndvi,
    osm_buildings,
    passages,
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
    step_cache,
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
    # OSM's passages through the LoD2 buildings (the same bake cuts them).
    "passages": passages.run,
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
# timetable trams ride the tram tracks; the murals hang on the LoD2 walls).
SITE_STEPS = ("transit", "landmark-facts", "murals")


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
    elif step == "landmark-facts":
        # the nameplates' facts for the landmarks the tiles' step matched
        landmark_facts.run_site(spec.raw, spec.data, spec.site)
    elif step == "murals":
        murals.run_site(spec)


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


def step_key(step: str, research: bool, spec_hash: str) -> dict:
    """What a step's recorded run is valid for besides its files: its code
    (its module and every bake module it reaches, the locked packages), the
    site spec, the flags — and the year, for a step that reads the date."""
    module = STEPS[step].__module__
    key = {
        "step": step,
        "code": step_cache.code_hash(module),
        "spec": spec_hash,
        "research": bool(research),
    }
    if step_cache.dated(module):
        key["year"] = datetime.date.today().year
    return key


def recorded_tile(spec, step: str, tile, research: bool, key: dict, save: bool) -> None:
    """The step on the tile, its run recorded (step_cache.py) — or, with the
    cache off, its old record dropped."""
    manifest = step_cache.manifest_path(spec.raw, spec.site, step, tile.id)
    if not save:
        Path(manifest).unlink(missing_ok=True)
        run_tile(step, tile, spec.tiles, research)
        return
    with step_cache.recording([os.getcwd(), str(spec.data), str(spec.raw)]) as rec:
        run_tile(step, tile, spec.tiles, research)
    step_cache.save(manifest, key, rec)


def warm(spec, step: str, tiles, jobs: int) -> None:
    """The site-wide measurements every tile of `step` reads, made once
    before the workers fork (each would make its own otherwise): the NDVI's
    anchors, the flight's colour cast, the roofs' sun readings (`jobs` at a
    time), the city's bin colour, a leaf-off flight. They are
    `step_cache.memo`s, so each tile's manifest still lists the files they
    came from."""
    first = spec.tiles[0]
    if step == "ndvi":
        for t in spec.tiles:
            if t.raw_raster("dop").exists():
                ndvi.tile_anchors(t)
    elif step == "roof-colour":
        dop_balance.gains(spec.tiles)
        roof_colour.site_readings(tiles, spec.tiles, jobs)
    elif step == "sport":
        dop_balance.gains(spec.tiles)
    elif step == "furniture":
        furniture.site_bin_tone(first)
    elif step == "monuments":
        monuments.winter_flight(first)


class Bake:
    """The bake's run settings and the site's recorded runs."""

    def __init__(self, spec, jobs: int, research: bool, spec_hash: str, mode: str) -> None:
        self.spec, self.jobs, self.research = spec, jobs, research
        self.spec_hash = spec_hash
        # "cache": skip what is unchanged; "force": run all, record it;
        # "off": run all, record nothing
        self.mode = mode
        self.ledger = step_cache.Ledger(spec.raw, spec.site, list(STEPS))
        self.tiles = {t.id: t for t in spec.tiles}

    def _run(self, step: str, tiles) -> None:
        key = step_key(step, self.research, self.spec_hash)
        args = (self.research, key, self.mode != "off")
        if self.jobs <= 1 or len(tiles) <= 1:
            for tile in tiles:
                recorded_tile(self.spec, step, tile, *args)
                self.ledger.done(step, tile.id)
            return
        warm(self.spec, step, tiles, self.jobs)
        # fork: the workers share the parent's loaded modules (and what
        # `warm` measured), and no dataset is open between two steps
        context = multiprocessing.get_context("fork")
        with ProcessPoolExecutor(min(self.jobs, len(tiles)), mp_context=context) as pool:
            runs = [pool.submit(recorded_tile, self.spec, step, t, *args) for t in tiles]
            for done in runs:
                done.result()
        for tile in tiles:
            self.ledger.done(step, tile.id)

    def step(self, step: str, tiles) -> None:
        """A step over the tiles, `jobs` tiles at a time. Each tile writes
        only its own files and reads only what earlier steps wrote, so the
        tiles of one step run side by side; the next step starts once all
        are done. Every tile is judged before any runs: a step's tiles read
        each other's files as the step found them."""
        if self.mode != "cache":
            self._run(step, tiles)
            return
        key = step_key(step, self.research, self.spec_hash)
        todo = []
        for tile in tiles:
            if self.ledger.unchanged(step, tile.id, key):
                print(f"{tile.id}: {step} unchanged — skipped (--force runs it)")
            else:
                todo.append(tile)
        again = sorted(
            {r for t in todo for r in self.ledger.restore(step, t.id)},
            key=lambda r: self.ledger.order[r[0]],
        )
        then = self.ledger.after(again, step)
        for s, tid in again:
            print(f"{tid}: {s} runs again — {step} reads its output, which a later step replaced")
            self._run(s, [self.tiles[tid]])
        if todo:
            self._run(step, todo)
        # what the restores put back is then rewritten as before (a lamp's
        # height), judged as any step: unchanged inputs skip it
        for s, tid in then:
            print(f"{tid}: {s} runs again — a restore before {step} put back its input")
            self.step(s, [self.tiles[tid]])


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
    parser.add_argument(
        "--force",
        action="store_true",
        help="bake: run every step, even one whose inputs and code are unchanged",
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
    mode = "off" if os.environ.get("BAKE_CACHE") == "0" else "force" if args.force else "cache"
    bake = Bake(
        spec, args.jobs, args.research, hashlib.sha256(args.spec.encode()).hexdigest(), mode
    )
    # Step by step over the tiles, not tile by tile: ndvi, roof-colour and
    # sport read every tile of the site (its class rasters, the anchors of
    # its one flight), which the steps before them must have baked first.
    for step in steps:
        bake.step(step, tiles)
    if args.step == "all" and not args.tile:
        for step in SITE_STEPS:
            run_site_step(spec, step)


if __name__ == "__main__":
    main()
