"""North Rhine-Westphalia (Geobasis NRW, opengeodata.nrw.de): 1 km tiles
of every product, each folder with an `index.json` listing its files. File
names carry the acquisition year, which differs from tile to tile (and the
DOP folder holds two years of some tiles), so names are looked up there,
newest year first. The Basis-DLM is one 4.7 GB Shape package; only the
layers the bakes read are pulled out of it through range requests. The
laser scan (`--lsc`) is four 1 km LAZ per tile, merged into one."""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path

from ..common import DLM_MEMBERS, Tile
from ..fetch import Ctx, cells, own_cells
from ..lsc import merge_laz
from ..net import download, fetch_text, remote_zip_members

BASE = "https://www.opengeodata.nrw.de/produkte/geobasis"
FOLDERS = {
    "dgm": "hm/dgm1_tiff/dgm1_tiff",
    "dom": "hm/dom1_tiff/dom1_tiff",
    "lod2": "3dg/lod2_gml/lod2_gml",
    "dop": "lusat/akt/dop/dop_jp2_f10",
    "lsc": "hm/3dm_l_las/3dm_l_las",
}
PATTERNS = {
    "dgm": r"dgm1_32_{e}_{n}_1_nw(_\d{{4}})?\.tif",
    "dom": r"dom1_32_{e}_{n}_1_nw(_\d{{4}})?\.tif",
    "lod2": r"LoD2_32_{e}_{n}_1_NW\.gml",
    "dop": r"dop10rgbi_32_{e}_{n}_1_nw(_\d{{4}})?\.jp2",
    "lsc": r"3dm_32_{e}_{n}_1_nw(_\d{{4}})?\.laz",
}
# NRW's classes into the AdV scheme the rasters read (lsc.ADV). NRW is not
# GeoSN: its class 1 holds 22 % of a scan, every point a non-last echo
# 1.7–22 m above the ground — the tree crowns' tops — and class 20 the
# roofs and last echoes; 17 is a bridge, 26 synthetic ground. Read as GeoSN's
# (20 only) the surface missed most crowns. Noise (18) and points below the
# ground (24) are dropped. Intensities are normalised per scan in
# lsc.rasterise, against the scan's own ground.
LSC_CLASSES = {2: 2, 26: 30, 1: 20, 20: 20, 17: 20}
DLM = f"{BASE}/lm/akt/basis-dlm/basis-dlm_EPSG25832_Shape.zip"


@cache
def listing(product: str) -> list[str]:
    index = json.loads(fetch_text(f"{BASE}/{FOLDERS[product]}/index.json"))
    return [f["name"] for d in index["datasets"] for f in d["files"]]


def _files(ctx: Ctx, tile: Tile, product: str, margin: int = 0, keep: bool = False) -> list[Path]:
    """The 1 km files covering the tile, plus `margin` rings around it; a
    margin cell the listing has no file for (past NRW's border) is skipped.
    With `keep` they go to `downloads/<product>/`, shared by the site's
    tiles, else to the tile's scratch folder."""
    own = own_cells(tile, 1)
    out = []
    for e, n in cells(tile, 1, margin):
        wanted = re.compile(PATTERNS[product].format(e=e, n=n) + "$")
        names = sorted(name for name in listing(product) if wanted.match(name))
        if not names:
            if (e, n) not in own:
                print(f"{tile.id}: {product} {e}_{n} (neighbour) not available")
                continue
            raise FileNotFoundError(f"{product}: no file for the 1 km cell {e}_{n}")
        # the newest year sorts last
        url = f"{BASE}/{FOLDERS[product]}/{names[-1]}"
        folder = ctx.downloads if keep else ctx.scratch
        out.append(download(url, folder / product / names[-1]))
    return out


def dgm(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "dgm")


def dom(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "dom")


def dop(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "dop")


def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    # One ring of neighbouring cells: a seam building filed next door is
    # kept by the tile holding its envelope centre. Each file is read by up
    # to four tiles, so it is kept under downloads/lod2/.
    return _files(ctx, tile, "lod2", margin=1, keep=True)


def lsc(ctx: Ctx, tile: Tile) -> list[Path]:
    """The classified laser scan ("3D-Messdaten"), four 1 km LAZ (≈100 MB
    each) merged into the one scan the rasters read, its classes mapped by
    `LSC_CLASSES`."""
    merged = ctx.scratch / "lsc" / f"{tile.id}.laz"
    return [merge_laz(_files(ctx, tile, "lsc"), merged, classes=lambda _: LSC_CLASSES)]


def dlm(ctx: Ctx) -> None:
    remote_zip_members(DLM, DLM_MEMBERS, ctx.raw / "dlm")
    print(f"Basis-DLM → {ctx.raw / 'dlm'}")
