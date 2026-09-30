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
from ..fetch import Ctx, cells
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
# NRW's scan records 16-bit intensities; GeoSN's, which the low-vegetation
# cue was measured on, sit about 16 times lower (NRW median ≈ 44 000).
LSC_INTENSITY_SCALE = 1 / 16
DLM = f"{BASE}/lm/akt/basis-dlm/basis-dlm_EPSG25832_Shape.zip"


@cache
def listing(product: str) -> list[str]:
    index = json.loads(fetch_text(f"{BASE}/{FOLDERS[product]}/index.json"))
    return [f["name"] for d in index["datasets"] for f in d["files"]]


def _files(ctx: Ctx, tile: Tile, product: str) -> list[Path]:
    out = []
    for e, n in cells(tile, 1):
        wanted = re.compile(PATTERNS[product].format(e=e, n=n) + "$")
        names = sorted(name for name in listing(product) if wanted.match(name))
        if not names:
            raise FileNotFoundError(f"{product}: no file for the 1 km cell {e}_{n}")
        # the newest year sorts last
        url = f"{BASE}/{FOLDERS[product]}/{names[-1]}"
        out.append(download(url, ctx.scratch / product / names[-1]))
    return out


def dgm(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "dgm")


def dom(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "dom")


def dop(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "dop")


def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "lod2")


def lsc(ctx: Ctx, tile: Tile) -> list[Path]:
    """The classified laser scan ("3D-Messdaten", the AdV classes GeoSN
    uses too: 2 ground, 20 non-ground), four 1 km LAZ (≈100 MB each) merged
    into the one scan the rasters read."""
    merged = ctx.scratch / "lsc" / f"{tile.id}.laz"
    return [merge_laz(_files(ctx, tile, "lsc"), merged, LSC_INTENSITY_SCALE)]


def dlm(ctx: Ctx) -> None:
    remote_zip_members(DLM, DLM_MEMBERS, ctx.raw / "dlm")
    print(f"Basis-DLM → {ctx.raw / 'dlm'}")
