"""Bavaria (LDBV, geodaten.bayern.de/opengeodata): rasters as 1 km tiles,
LoD2 as 2 km CityGML, all under predictable URLs. There is no open DOM1:
the photogrammetric DOM20 (1 km, 20 cm) is fetched and averaged to 1 m by
the fetch step. The open DOP20 is RGB (the infrared is a separate WMS
export), so the NDVI step skips. The Basis-DLM is one 1.3 GB Shape package
in the AdV profile; only the layers the bakes read are pulled out of it.
The laser scan (`--lsc`) is four 1 km LAZ per tile, merged into one with
the classes mapped to the AdV scheme the rasters read."""

from __future__ import annotations

from pathlib import Path

import laspy

from ..common import DLM_MEMBERS, Tile
from ..fetch import Ctx, cells, german_dates
from ..lsc import merge_laz
from ..net import download, fetch_text, remote_zip_members

CLOUD = "https://download1.bayernwolke.de/a"
LASER = "https://geodaten.bayern.de/odd_data/laser"
DLM = "https://geodaten.bayern.de/odd/m/2/basisdlm/bkg_shape/bkg_shape_712.zip"
# The DOP20's flight blocks with their day (`ua`), through the DOP WMS.
DOP_INFO = (
    "https://geoservices.bayern.de/od/wms/dop/v1/dop20?SERVICE=WMS&VERSION=1.3.0"
    "&REQUEST=GetFeatureInfo&LAYERS=by_dop20_info&QUERY_LAYERS=by_dop20_info&CRS=EPSG:25832"
    "&WIDTH=11&HEIGHT=11&I=5&J=5&INFO_FORMAT=text/plain&STYLES=&BBOX={x0},{y0},{x1},{y1}"
)


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


def flight(ctx: Ctx, tile: Tile) -> list[str]:
    """The days the tile's 1 km DOP files were flown: their flight block's
    `ua` (the day of the images)."""
    days: list[str] = []
    for e, n in cells(tile, 1):
        x, y = e * 1000 + 500, n * 1000 + 500
        info = fetch_text(DOP_INFO.format(x0=x - 5, y0=y - 5, x1=x + 5, y1=y + 5))
        days += german_dates(info.partition(" ua ")[2][:20])
    return sorted(set(days))


def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, 2, CLOUD + "/lod2/citygml/{e}_{n}.gml")


# LDBV's classes (Laserpunkte, "Klassifizierung") → the AdV scheme
# (lsc.ADV). 2 ground; 9 water and 23/24 synthetic ground go to the DTM
# only, as GeoSN's 8/30 do. 6 building and 20 "object point, e.g.
# vegetation" (Bavaria has no 3/4/5) both become 20, everything standing
# on the ground, as in GeoSN's scan: the small-structure bake needs the
# sheds' roofs in the surface, and the hedge and tree bakes tell vegetation
# from the rest by LoD2, land cover, the echo ratio and the low returns'
# intensity, not by class. 22 was "bridge" up to 2020 (→ 20, as GeoSN
# counts a deck) and is "cellar entrance" since 2021 — points at or below
# the ground (on 691_5334, 2022: 73 k, median 0.1 m under the DTM), left
# out. Unclassified (1), noise (7) and 0 are left out too (a few hundred
# points a km², birds and multipath).
LSC_CLASSES = {2: 2, 9: 8, 23: 30, 24: 30, 6: 20, 20: 20}
LSC_BRIDGE_UNTIL = 2020


def lsc_classes(header: laspy.LasHeader) -> dict[int, int]:
    """The class table of one 1 km file, by its year (class 22's meaning
    changed in 2021)."""
    date = header.creation_date
    if date is not None and date.year <= LSC_BRIDGE_UNTIL:
        return {**LSC_CLASSES, 22: 20}
    return LSC_CLASSES


def lsc(ctx: Ctx, tile: Tile) -> list[Path]:
    """The classified laser points (CC BY 4.0), four 1 km LAZ (≈100 MB
    each; LAS 1.2, no CRS record — EPSG:25832) merged into the one scan the
    rasters read."""
    files = [
        download(f"{LASER}/{e}_{n}.laz", ctx.scratch / "lsc" / f"{e}_{n}.laz")
        for e, n in cells(tile, 1)
    ]
    merged = ctx.scratch / "lsc" / f"{tile.id}.laz"
    return [merge_laz(files, merged, classes=lsc_classes)]


def dlm(ctx: Ctx) -> None:
    remote_zip_members(DLM, DLM_MEMBERS, ctx.raw / "dlm")
    print(f"Basis-DLM → {ctx.raw / 'dlm'}")
