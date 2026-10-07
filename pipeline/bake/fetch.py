"""`bun run fetch`: everything a site needs from the network, per tile.

The provider's adapter (`bake/providers/<id>.py`) knows its portal and
hands back its own files — any grid, any raster format GDAL reads, CityGML.
This module turns them into what the rest reads, and skips whatever is
already there, so a rerun only fetches what is missing:

    data/<site>/dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif   DGM1, 1 m, compact
    data/<site>/cityjson/lod2_<tile>.city.json          LoD2 as CityJSON
    data/_raw/<provider>/dom1/<tile>.tif                 surface model, 1 m
    data/_raw/<provider>/dop/<tile>.tif                  orthophoto, 20 cm
    data/_raw/<provider>/dlm/*.shp                       Basis-DLM (AdV Shape)
    data/_raw/<provider>/osm/<extract>.osm.pbf           the OSM extract
    data/_raw/<provider>/trees/<tile>.geojson            the site's tree cadastre
    data/_raw/<provider>/traffic/<tile>.geojson          the site's traffic counts
    data/_raw/gtfs/nv_free.zip                           Germany's timetable (sites with trams)
    data/_raw/<provider>/wikidata/bridges_<tile>.json    the bridges Wikidata knows
    data/_raw/<provider>/wikidata/landmarks_<tile>.json  its notable buildings and structures
    data/_raw/<provider>/lsc/<tile>.laz                  laser scan (`--lsc` only)

Statewide packages are cached under data/_raw/<provider>/downloads/; a
tile's own downloads live in a scratch folder only until its products are
written (the products are the cache: a rerun skips them).
"""

from __future__ import annotations

import importlib
import shutil
import urllib.error
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from rasterio.enums import Resampling

from . import bridge, cadastre, landmarks, traffic_sources, transit
from .citygml import write_cityjson
from .common import Tile, dlm_complete
from .net import download
from .rasters import write_tile_raster
from .spec import Spec


@dataclass(frozen=True)
class Ctx:
    """What an adapter works with: the provider's raw folder (statewide
    packages are cached in `downloads/`) and a scratch folder for the tile's
    own downloads, removed once its products are written."""

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
        if lsc and spec.products.lsc:
            laz = tile.raw / "lsc" / f"{tile.id}.laz"
            _step("laser scan", tile, laz, lambda: _place_laz(source.lsc(ctx, tile), laz))
    _try("tree cadastre", tile, lambda: cadastre.fetch(tile))
    _try("traffic counts", tile, lambda: traffic_sources.fetch(tile))
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
    return failed


def fetch_osm(spec: Spec) -> None:
    if spec.osm.exists():
        return
    try:
        # Geofabrik publishes an md5 beside every extract.
        download(spec.osm_url, spec.osm, md5_url=f"{spec.osm_url}.md5")
    except Exception as err:  # noqa: BLE001 — the tiles do not need it
        print(f"OSM extract not downloaded ({err}); put {spec.osm_url} at {spec.osm}")


def run(spec: Spec, tiles: list[Tile], lsc: bool = False) -> None:
    spec.raw.mkdir(parents=True, exist_ok=True)
    source = adapter(spec.provider)
    if spec.products.dlm and not dlm_complete(spec.raw / "dlm"):
        try:
            with _scratch(spec.raw, "dlm") as scratch:
                source.dlm(Ctx(spec.raw, scratch, spec.epsg))
        except Exception as err:  # noqa: BLE001 — report, then fetch the tiles
            print(f"Basis-DLM not fetched ({type(err).__name__}: {err})")
    fetch_osm(spec)
    if spec.trams:
        transit.fetch_gtfs(transit.gtfs_dir(spec.raw))
    if lsc and not spec.products.lsc:
        print(f"--lsc: the {spec.provider} adapter reads no laser scan — skipped")
    failures = {tile.id: fetch_tile(spec, tile, source, lsc) for tile in tiles}
    failures = {tid: what for tid, what in failures.items() if what}
    if failures:
        print("fetch: required products not fetched — the build cannot use these tiles:")
        for tid, what in failures.items():
            print(f"  {tid}: {', '.join(what)}")
        raise SystemExit(1)
