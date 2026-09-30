"""Bavaria (LDBV, geodaten.bayern.de/opengeodata): rasters as 1 km tiles,
LoD2 as 2 km CityGML, all under predictable URLs. There is no open DOM1:
the photogrammetric DOM20 (1 km, 20 cm) is fetched and averaged to 1 m by
the fetch step. The open DOP20 is RGB (the infrared is a separate WMS
export), so the NDVI step skips. The Basis-DLM is one 1.3 GB Shape package
in the AdV profile; only the layers the bakes read are pulled out of it."""

from __future__ import annotations

from pathlib import Path

from ..common import DLM_MEMBERS, Tile
from ..fetch import Ctx, cells
from ..net import download, remote_zip_members

CLOUD = "https://download1.bayernwolke.de/a"
DLM = "https://geodaten.bayern.de/odd/m/2/basisdlm/bkg_shape/bkg_shape_712.zip"


def _files(ctx: Ctx, tile: Tile, km: int, url: str) -> list[Path]:
    out = []
    for e, n in cells(tile, km):
        u = url.format(e=e, n=n)
        out.append(download(u, ctx.scratch / u.removeprefix(CLOUD + "/")))
    return out


def dgm(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, 1, CLOUD + "/dgm/dgm1/{e}_{n}.tif")


def dom(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, 1, CLOUD + "/dom20/DOM/32{e}_{n}_20_DOM.tif")


def dop(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, 1, CLOUD + "/dop20/data/32{e}_{n}.tif")


def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, 2, CLOUD + "/lod2/citygml/{e}_{n}.gml")


def dlm(ctx: Ctx) -> None:
    remote_zip_members(DLM, DLM_MEMBERS, ctx.raw / "dlm")
    print(f"Basis-DLM → {ctx.raw / 'dlm'}")
