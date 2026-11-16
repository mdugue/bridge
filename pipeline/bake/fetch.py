"""`bun run fetch`: everything a site needs from the network, per tile.

The provider's adapter (`bake/providers/<id>.py`) knows its portal and
hands back its own files — any grid, any raster format GDAL reads, CityGML.
This module turns them into what the rest reads, and skips whatever is
already there, so a rerun only fetches what is missing:

    data/<site>/dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif   DGM1, 1 m, compact
    data/<site>/cityjson/lod2_<tile>.city.json          LoD2 as CityJSON
    data/_raw/<provider>/dom1/<tile>.tif                 surface model, 1 m
    data/_raw/<provider>/dop/<tile>.tif                  orthophoto, 20 cm
    data/_raw/<provider>/dop/<tile>.flight.json          the days it was flown
    data/_raw/<provider>/dlm/*.shp                       Basis-DLM (AdV Shape)
    data/_raw/<provider>/osm/<extract>.osm.pbf           the OSM extract (Geofabrik's, else
                                                         BBBike's that covers the site)
    data/_raw/<provider>/osm/<extract>.source.json       where it came from, as of which day
    data/_raw/<provider>/trees/<tile>.geojson            the site's tree cadastre
    data/_raw/<provider>/traffic/<tile>.geojson          the site's traffic counts
    data/_raw/gtfs/nv_free.zip                           Germany's timetable (sites with trams)
    data/_raw/glo30/<site>.tif                           Copernicus GLO-30 around it (glo30.py)
    data/_raw/<provider>/wikidata/bridges_<tile>.json    the bridges Wikidata knows
    data/_raw/<provider>/wikidata/landmarks_<tile>.json  its notable buildings and structures
    data/_raw/<provider>/wikidata/monuments_<tile>.json  the monuments it knows the material of
    data/_raw/<provider>/wikidata/landmark_facts_<site>.json  the landmarks' dates and makers
    data/_raw/<provider>/lsc/<tile>.laz                  laser scan (`--lsc` only)
    data/_raw/<provider>/murals/{items,photos}.json      the murals' items and photos (murals.py)
    data/_raw/<provider>/murals/photos/*                 the photo each mural's rule chose

Statewide packages, and the LoD2 files a tile shares with its neighbours
(the one-cell ring), are cached under data/_raw/<provider>/downloads/; a
tile's other downloads live in a scratch folder only until its products are
written (the products are the cache: a rerun skips them).

The fetch exits 1 when a product the build or the bakes cannot do without
failed — a tile's DGM1 or LoD2, the Basis-DLM (where the provider has one)
or the OSM extract — after it has tried everything else.
"""

from __future__ import annotations

import http.client
import importlib
import json
import re
import shutil
import time
import urllib.error
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from rasterio.enums import Resampling

from . import (
    bridge,
    cadastre,
    facades,
    glo30,
    landmark_facts,
    landmarks,
    mapillary,
    monuments,
    murals,
    osm_source,
    traffic_sources,
    transit,
)
from .citygml import write_cityjson
from .common import Tile, dlm_complete
from .dop_light import flight_file
from .net import download, fetch_text
from .osm_source import poly_url, read_record
from .rasters import write_tile_raster
from .spec import Spec, osm_path


@dataclass(frozen=True)
class Ctx:
    """What an adapter works with: the provider's raw folder (statewide
    packages and shared LoD2 files are cached in `downloads/`) and a
    scratch folder for the tile's own downloads, removed once its products
    are written."""

    raw: Path
    scratch: Path
    epsg: int

    @property
    def downloads(self) -> Path:
        return self.raw / "downloads"


class Adapter(Protocol):
    """A provider's portal. Each product function returns the provider's own
    files covering the tile (to be mosaicked and clipped here)."""

    def dgm(self, ctx: Ctx, tile: Tile) -> list[Path]: ...
    def dom(self, ctx: Ctx, tile: Tile) -> list[Path]: ...
    def dop(self, ctx: Ctx, tile: Tile) -> list[Path]: ...
    def lod2(self, ctx: Ctx, tile: Tile) -> list[Path]: ...
    def lsc(self, ctx: Ctx, tile: Tile) -> list[Path]:
        """The laser scan's LAZ covering the tile (Provider.products.lsc)."""
        ...

    def dlm(self, ctx: Ctx) -> None:
        """Fill `ctx.raw / "dlm"` with the AdV Shape layers."""

    def flight(self, ctx: Ctx, tile: Tile) -> list[str]:
        """The days (ISO) the tile's orthophoto was flown, from the
        provider's metadata (optional: an adapter without it leaves the
        flight's sun to be searched over the whole sky, dop_light.py)."""
        ...


def cells(tile: Tile, km: int, margin: int = 0) -> Iterator[tuple[int, int]]:
    """South-west corners (km) of a provider's `km` grid covering the tile,
    plus `margin` rings of cells around it (the LoD2 fetch reads one: a
    provider files a seam building in one cell by its own rule, and the
    converter keeps it for the tile holding its envelope centre — which
    may be the cell next door)."""
    xmin, ymin, xmax, ymax = (int(b) // 1000 for b in tile.bounds)
    pad = margin * km
    for e in range(xmin - xmin % km - pad, xmax + pad, km):
        for n in range(ymin - ymin % km - pad, ymax + pad, km):
            yield e, n


def own_cells(tile: Tile, km: int) -> set[tuple[int, int]]:
    """The cells inside the tile (`cells(tile, km)` without a margin): a
    file missing for one of them is an error, one missing for a margin cell
    (past the provider's coverage) is skipped."""
    return set(cells(tile, km))


def not_published(err: OSError) -> bool:
    """Whether a download failed because the server has no such file (404,
    410) — the one failure that skips a margin cell. Anything else (a
    timeout, a cut connection, a failed check, a 5xx) raises, so `_step`
    reports the product as not fetched and the next run tries again."""
    return isinstance(err, urllib.error.HTTPError) and err.code in (404, 410)


def german_dates(text: str) -> list[str]:
    """Every `dd.mm.yyyy` in `text`, as ISO dates."""
    return [f"{y}-{m}-{d}" for d, m, y in re.findall(r"\b(\d{2})\.(\d{2})\.(\d{4})\b", text)]


def write_flight(dest: Path, days: list[str], provider: str) -> None:
    """The flight days through a `.part` file; none raises, so the next run
    asks again."""
    if not days:
        raise ValueError("the provider's metadata names no flight day")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    part.write_text(json.dumps({"days": sorted(set(days)), "provider": provider}))
    part.replace(dest)


def adapter(provider: str) -> Adapter:
    return importlib.import_module(f"bake.providers.{provider}")  # type: ignore[return-value]


def _step(what: str, tile: Tile, dest: Path, make) -> bool:
    """One product of a tile. Every writer goes through a `.part` file and
    raises rather than writing something incomplete, so an existing `dest`
    is a finished one; a failure is reported and the next product goes on.
    True when `dest` is there (it was, or it was made), False on a failure."""
    if dest.exists():
        return True
    try:
        make()
        print(f"{tile.id}: {what} → {dest}")
        return True
    except Exception as err:  # noqa: BLE001 — report, then fetch the rest
        print(f"{tile.id}: {what} not fetched ({type(err).__name__}: {err})")
        return False


def _try(what: str, tile: Tile, call) -> bool:
    """A per-tile fetch with no `dest` of its own to skip on (it keeps its
    own cache): any failure is reported and the next fetch goes on."""
    try:
        call()
        return True
    except Exception as err:  # noqa: BLE001 — report, then fetch the rest
        print(f"{tile.id}: {what} not fetched ({type(err).__name__}: {err})")
        return False


@contextmanager
def _scratch(raw: Path, name: str) -> Iterator[Path]:
    """A scratch folder at a fixed place, emptied before and after, so a
    killed run leaves nothing behind that the next one would not clear."""
    path = raw / ".scratch" / name
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _place_laz(files: list[Path], dest: Path) -> None:
    """A laser scan is not mosaicked: the adapter hands back the one LAZ on
    our grid, which is moved into place through a `.part` file."""
    if len(files) != 1:
        raise ValueError(f"expected one LAZ for the tile, got {len(files)}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(".laz.part")
    shutil.move(files[0], part)
    part.replace(dest)


def fetch_tile(spec: Spec, tile: Tile, source: Adapter, lsc: bool = False) -> list[str]:
    """Fetches the tile's products; returns the REQUIRED ones that failed
    (the DGM1 and the LoD2: the build fails without them). The optional
    ones — surface model, orthophoto, laser scan and the per-tile extras —
    only print a line when they fail: their features are then off."""
    failed: list[str] = []
    with _scratch(spec.raw, tile.id) as scratch:
        ctx = Ctx(spec.raw, scratch, spec.epsg)
        # required
        if not _step(
            "DGM1",
            tile,
            tile.dgm,
            lambda: write_tile_raster(source.dgm(ctx, tile), tile, tile.dgm, 1.0, heights=True),
        ):
            failed.append("DGM1")
        # required
        if not _step(
            "LoD2",
            tile,
            tile.cityjson,
            lambda: write_cityjson(source.lod2(ctx, tile), tile.bounds, spec.epsg, tile.cityjson),
        ):
            failed.append("LoD2")
        # optional from here on
        if spec.products.dom:
            dom = tile.raw_raster("dom1")
            _step(
                "surface model",
                tile,
                dom,
                lambda: write_tile_raster(
                    source.dom(ctx, tile), tile, dom, 1.0, Resampling.average, heights=True
                ),
            )
        if spec.products.dop:
            dop = tile.raw_raster("dop")
            _step(
                "orthophoto",
                tile,
                dop,
                # "max": archives cut at district borders overlap with
                # empty (black) wedges, which the brighter source fills.
                lambda: write_tile_raster(
                    source.dop(ctx, tile), tile, dop, 0.2, Resampling.average, method="max"
                ),
            )
        if spec.products.dop and hasattr(source, "flight"):
            # the day the orthophoto was flown: its sun's path (dop_light.py)
            days = flight_file(spec.raw, tile.id)
            _step(
                "flight days",
                tile,
                days,
                lambda: write_flight(days, source.flight(ctx, tile), spec.provider),
            )
        if lsc and spec.products.lsc:
            laz = tile.raw / "lsc" / f"{tile.id}.laz"
            _step("laser scan", tile, laz, lambda: _place_laz(source.lsc(ctx, tile), laz))
    _try("tree cadastre", tile, lambda: cadastre.fetch(tile))
    _try("traffic counts", tile, lambda: traffic_sources.fetch(tile))
    _try("Mapillary objects", tile, lambda: mapillary.fetch(tile))
    _try("Mapillary facades", tile, lambda: facades.fetch(tile))
    _try("Mapillary facade traits", tile, lambda: facades.fetch(tile, "traits"))
    _try("Mapillary glass facades", tile, lambda: facades.fetch(tile, "glass"))
    _try(
        "Wikidata bridges",
        tile,
        lambda: bridge.fetch_wikidata(spec.raw, tile.id, tile.bounds, tile.epsg),
    )
    _try(
        "Wikidata landmarks",
        tile,
        lambda: landmarks.fetch_wikidata(spec.raw, tile.id, tile.bounds, tile.epsg),
    )
    _try(
        "Wikidata monuments",
        tile,
        lambda: monuments.fetch_wikidata(spec.raw, tile.id, tile.bounds, tile.epsg),
    )
    return failed


# Tries at the OSM extract before it counts as unreachable, and the pause
# before each next one (s): Geofabrik's resets come in runs.
OSM_TRIES = 3
OSM_PAUSE_S = 10.0


def _published_md5(url: str) -> str | None:
    """The md5 the server publishes beside an extract (`<extract>.md5`;
    Geofabrik and BBBike both do), or None where it cannot be read."""
    try:
        return fetch_text(f"{url}.md5").split()[0].lower()
    except (OSError, IndexError, http.client.HTTPException):
        return None


def _download_extract(url: str, dest: Path, poly: str | None = None) -> None:
    """An extract checked against its published md5, and its record
    (osm_source.py), with `poly`, the boundary fetched with it (BBBike's).
    It is downloaded beside `dest` and takes its place only once complete
    and checked, so a failed download leaves what was there. Only a failure
    to reach the server is tried again (`osm_source.unreachable`); a 404, a
    checksum that does not match or a full disk raise at once."""
    new = dest.with_name(dest.name + ".new")
    for attempt in range(1, OSM_TRIES + 1):
        new.unlink(missing_ok=True)
        try:
            published = _published_md5(url)
            download(url, new, md5_url=f"{url}.md5")
            break
        except Exception as err:
            if not osm_source.unreachable(err) or attempt == OSM_TRIES:
                raise
            print(f"OSM extract: {url} failed ({type(err).__name__}: {err}) — try {attempt + 1}")
            time.sleep(OSM_PAUSE_S * attempt)
    md5 = osm_source.file_md5(new)
    if published is not None and published != md5:
        new.unlink()
        raise ValueError(f"{url}: md5 {md5}, published {published}")
    new.replace(dest)
    if poly is not None:
        osm_source.poly_path(dest).write_text(poly)
    modified = osm_source.last_modified(url)
    poly_md5 = osm_source.text_md5(poly) if poly is not None else None
    osm_source.write_record(dest, url, modified, md5, published, poly_md5)


def _fetch_bbbike(spec: Spec, url: str | None) -> bool:
    """BBBike's city extract the site names, if its published boundary
    covers the site's tiles with the bakes' widest margin; else a line on
    by how much it falls short, and nothing is taken. The extract and its
    boundary are fetched together, and fetched again together when the
    boundary BBBike publishes is not the one recorded with the file."""
    if url is None:
        print(f"OSM extract: {spec.site} names no BBBike extract to fall back on (Site.bbbike)")
        return False
    dest = osm_path(spec.raw, url)
    try:
        poly = fetch_text(poly_url(url))
        problem = _covers(spec, osm_source.parse_poly(poly))
    except Exception as err:  # noqa: BLE001 — no boundary, no coverage to vouch for
        poly, problem = None, f"its boundary {poly_url(url)} not read ({type(err).__name__}: {err})"
    # the coverage first: a site it does not cover downloads nothing, and
    # a copy another site of the Land fetched stays for that site
    if problem is None and (
        not dest.exists()
        or osm_source.intact(dest) is not None
        or (read_record(dest) or {}).get("polyMd5") != osm_source.text_md5(poly)
    ):
        try:
            _download_extract(url, dest, poly)
        except Exception as err:  # noqa: BLE001 — report, then fetch the tiles
            problem = f"not downloaded ({type(err).__name__}: {err})"
    problem = problem or osm_source.usable(spec, dest)
    if problem is not None:
        print(
            f"OSM extract: BBBike's {dest.name} not taken for {spec.site}: {problem} — "
            "the OSM steps find no extract until one that covers the site is there"
        )
        return False
    print(f"OSM extract: {osm_source.describe(dest)} — Geofabrik's could not be had")
    return True


def _covers(spec: Spec, boundary) -> str | None:
    """Whether `boundary` covers the site with the bakes' widest margin."""
    short = osm_source.shortfall(boundary, spec.tiles)
    if short is None:
        return None
    margin = osm_source.MAX_MARGIN_DEG
    return f"it does not cover {spec.site} with the bakes' {margin}° margin (short {short})"


def fetch_osm(spec: Spec, fallback: str | None = None) -> bool:
    """The site's OSM extract; False when none could be had. Geofabrik's
    first; where it cannot be reached (after `OSM_TRIES`; a 404, a failed
    checksum or a full disk are no outage) BBBike's city extract the site
    names, if it covers the site (osm_source.py) — checked for this site
    even when another site of the Land fetched the file. A file is only
    ever replaced by a complete, checked download, never deleted first.
    The tiles are still fetched, but the bakes need it (every OSM layer,
    and the land cover where the provider has no Basis-DLM), so `run`
    fails at the end."""
    primary = spec.osm
    if primary.exists():
        problem = osm_source.intact(primary)
        if problem is None:
            # Geofabrik's Land extract: no coverage to check (osm_source.resolve)
            print(f"OSM extract: {osm_source.describe(primary)}")
            return True
        print(f"OSM extract: {problem} — fetched again (it stays until a download replaces it)")
    elif fallback is not None:
        pbf = osm_path(spec.raw, fallback)
        if pbf.exists() and osm_source.usable(spec, pbf) is None:
            print(f"OSM extract: {osm_source.describe(pbf)}")
            return True
    try:
        _download_extract(spec.osm_url, primary)
        print(f"OSM extract: {osm_source.describe(primary)}")
        return True
    except Exception as err:  # noqa: BLE001 — report, then maybe the fallback
        print(f"OSM extract: {spec.osm_url} not downloaded ({type(err).__name__}: {err})")
        if primary.exists():
            # a file that is not its record's: no fallback reads past it
            print(f"OSM extract: {primary.name} stays, and the bake refuses it")
            return False
        if not osm_source.unreachable(err):
            print("OSM extract: not a failure to reach Geofabrik — no fallback (check the config)")
            return False
    if _fetch_bbbike(spec, fallback):
        return True
    print(f"OSM extract: none for {spec.site}; Geofabrik's {spec.osm_url} belongs at {primary}")
    return False


def fetch_dlm(spec: Spec, source: Adapter) -> bool:
    """The provider's Basis-DLM, where it has one; False when it could not
    be fetched. The land-cover bake refuses to run without it, so `run`
    fails at the end — after the tiles."""
    if not spec.products.dlm or dlm_complete(spec.raw / "dlm"):
        return True
    try:
        with _scratch(spec.raw, "dlm") as scratch:
            source.dlm(Ctx(spec.raw, scratch, spec.epsg))
        return True
    except Exception as err:  # noqa: BLE001 — report, then fetch the tiles
        print(f"Basis-DLM not fetched ({type(err).__name__}: {err})")
        return False


def fetch_glo30(spec: Spec) -> bool:
    """The land beyond the site (Copernicus GLO-30, glo30.py), for every
    tile of the site whichever are fetched: optional — without it the sky
    view extends the site's edge and the valley haze reads the site alone."""
    try:
        path = glo30.fetch(spec.raw, spec.site, [t.bounds for t in spec.tiles], spec.epsg)
        print(f"{spec.site}: Copernicus GLO-30 → {path}")
        return True
    except Exception as err:  # noqa: BLE001 — optional: report, fetch the rest
        print(f"{spec.site}: Copernicus GLO-30 not fetched ({type(err).__name__}: {err})")
        return False


def fetch_murals(spec: Spec) -> None:
    """The murals' items and photos (murals.py), read off the extract:
    optional — without them the walls stay plaster."""
    try:
        murals.fetch(spec)
    except Exception as err:  # noqa: BLE001 — optional: report, fetch the rest
        print(f"{spec.site}: murals not fetched ({type(err).__name__}: {err})")


def run(spec: Spec, tiles: list[Tile], lsc: bool = False, fallback: str | None = None) -> None:
    """The site's fetch; `fallback` is the BBBike extract's URL
    (`Site.bbbike`), taken where Geofabrik's cannot be had."""
    spec.raw.mkdir(parents=True, exist_ok=True)
    source = adapter(spec.provider)
    # required, site-wide: the bakes refuse to run without either
    site_failed = [
        what
        for what, ok in (
            ("Basis-DLM", fetch_dlm(spec, source)),
            ("OSM extract", fetch_osm(spec, fallback)),
        )
        if not ok
    ]

    if spec.trams:
        transit.fetch_gtfs(transit.gtfs_dir(spec.raw))
    fetch_glo30(spec)
    if lsc and not spec.products.lsc:
        print(f"--lsc: the {spec.provider} adapter reads no laser scan — skipped")
    failures = {tile.id: fetch_tile(spec, tile, source, lsc) for tile in tiles}
    # after the tiles' landmark caches: the facts of every item they name
    try:
        landmark_facts.fetch_wikidata(spec.raw, spec.data, spec.site, [t.id for t in tiles])
    except Exception as err:  # noqa: BLE001 — optional: the nameplates show the name alone
        print(f"{spec.site}: the landmarks' facts not fetched ({type(err).__name__}: {err})")
    if not site_failed:
        # the murals read the extract that is there now
        fetch_murals(osm_source.resolve(spec, fallback))
    failures = {tid: what for tid, what in failures.items() if what}
    if site_failed:
        # the land cover needs the DLM, or without one the extract; every
        # other OSM step skips with a note (osm.has_extract)
        stops = "Basis-DLM" in site_failed or not spec.products.dlm
        print(
            f"fetch: {', '.join(site_failed)} not fetched — "
            + (
                "the bakes cannot run without it"
                if stops
                else "the bake refuses its OSM steps without it (some would rewrite "
                "committed files with less, docs/portability.md); --without-osm runs them"
            )
        )
    if failures:
        print("fetch: required products not fetched — the build cannot use these tiles:")
        for tid, what in failures.items():
            print(f"  {tid}: {', '.join(what)}")
    if site_failed or failures:
        raise SystemExit(1)
