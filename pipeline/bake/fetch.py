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

Statewide packages are cached under data/_raw/<provider>/downloads/; a
tile's own downloads live in a scratch folder only until its products are
written (the products are the cache: a rerun skips them).
"""

from __future__ import annotations

import importlib
import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from rasterio.enums import Resampling

from .citygml import write_cityjson
from .common import DLM_LAYERS, Tile
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
    def dlm(self, ctx: Ctx) -> None:
        """Fill `ctx.raw / "dlm"` with the AdV Shape layers."""


def cells(tile: Tile, km: int) -> Iterator[tuple[int, int]]:
    """South-west corners (km) of a provider's `km` grid covering the tile."""
    xmin, ymin, xmax, ymax = (int(b) // 1000 for b in tile.bounds)
    for e in range(xmin - xmin % km, xmax, km):
        for n in range(ymin - ymin % km, ymax, km):
            yield e, n


def adapter(provider: str) -> Adapter:
    return importlib.import_module(f"bake.providers.{provider}")  # type: ignore[return-value]


def _step(what: str, tile: Tile, dest: Path, make) -> None:
    """One product of a tile. Every writer goes through a `.part` file and
    raises rather than writing something incomplete, so an existing `dest`
    is a finished one; a failure is reported and the next product goes on."""
    if dest.exists():
        return
    try:
        make()
        print(f"{tile.id}: {what} → {dest}")
    except Exception as err:  # noqa: BLE001 — report, then fetch the rest
        print(f"{tile.id}: {what} not fetched ({type(err).__name__}: {err})")


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


def has_dlm(raw: Path) -> bool:
    """Whether every layer the bakes read is there (an interrupted fetch may
    have left some)."""
    dlm = raw / "dlm"
    return all((dlm / f"{layer}{ext}").exists() for layer in DLM_LAYERS for ext in (".shp", ".dbf"))


def fetch_tile(spec: Spec, tile: Tile, source: Adapter) -> None:
    with _scratch(spec.raw, tile.id) as scratch:
        ctx = Ctx(spec.raw, scratch, spec.epsg)
        _step(
            "DGM1",
            tile,
            tile.dgm,
            lambda: write_tile_raster(source.dgm(ctx, tile), tile, tile.dgm, 1.0, heights=True),
        )
        _step(
            "LoD2",
            tile,
            tile.cityjson,
            lambda: write_cityjson(source.lod2(ctx, tile), tile.bounds, spec.epsg, tile.cityjson),
        )
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


def fetch_osm(spec: Spec) -> None:
    if spec.osm.exists():
        return
    try:
        download(spec.osm_url, spec.osm)
    except OSError as err:
        print(f"OSM extract not downloaded ({err}); put {spec.osm_url} at {spec.osm}")


def run(spec: Spec, tiles: list[Tile]) -> None:
    spec.raw.mkdir(parents=True, exist_ok=True)
    source = adapter(spec.provider)
    if spec.products.dlm and not has_dlm(spec.raw):
        with _scratch(spec.raw, "dlm") as scratch:
            source.dlm(Ctx(spec.raw, scratch, spec.epsg))
    fetch_osm(spec)
    for tile in tiles:
        fetch_tile(spec, tile, source)
