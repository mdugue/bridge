"""Saxony (GeoSN): every product per 2 km tile — our own grid — plus the
statewide Basis-DLM as one Shape package.

Download links come from the batch-download page, which embeds the live
share id and file-name template of every product
(`batchConfig.products`). The older download-link service
(docs/data-pipeline.md#provenance) keeps stale share ids for some products
(LoD2 returned 503 in 2026-09), so it is not used here.
"""

from __future__ import annotations

import json
import shutil
import zipfile
from functools import cache
from pathlib import Path

from ..common import DLM_LAYERS, Tile
from ..fetch import Ctx, cells
from ..net import download, fetch_text, unzip_members

BATCH_PAGE = "https://www.geodaten.sachsen.de/batch-download-4719.html"
CLOUD = "https://geocloud.landesvermessung.sachsen.de/public.php/dav/files"
# One statewide package, replaced quarterly under the same URL (the batch
# page lists no share for statewide products).
BASIS_DLM = f"{CLOUD}/DtPWngtLEJP8K3k/basisdlm_sn_shape.zip"
TILE_KM = 2


@cache
def products() -> dict[str, dict]:
    page = fetch_text(BATCH_PAGE)
    marker = "batchConfig.products="
    start = page.index(marker) + len(marker)
    table, _ = json.JSONDecoder().raw_decode(page[start:])
    return table


def _zip(ctx: Ctx, product: str, e: int, n: int) -> Path:
    entry = products()[product]
    name = entry["filename"].replace("$Rechtswert$", str(e)).replace("$Hochwert$", str(n))
    return download(f"{CLOUD}/{entry['share_id']}/{name}", ctx.scratch / name)


def _files(ctx: Ctx, tile: Tile, product: str, pattern: str) -> list[Path]:
    out = []
    for e, n in cells(tile, TILE_KM):
        out += unzip_members(_zip(ctx, product, e, n), pattern, ctx.scratch / product)
    return out


def dgm(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "DGM1_TIFF_2km", r"\.tif$")


def dom(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "DOM1_TIFF_2km", r"\.tif$")


def dop(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "DOP_RGBI", r"\.tif$")


def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "LoD2_CityGML", r"\.gml$")


def lsc(ctx: Ctx, tile: Tile) -> list[Path]:
    """The classified laser scan, one LAZ per 2 km tile (≈380 MB). The
    link service's share for it answered 503 in 2026-09; the batch page's
    is live."""
    return _files(ctx, tile, "LSC", r"\.laz$")


def dlm(ctx: Ctx) -> None:
    """The statewide Shape package: a ZIP of ZIPs, of which the layers the
    bakes read are flattened into dlm/."""
    outer = download(BASIS_DLM, ctx.downloads / "basisdlm_sn_shape.zip")
    dest = ctx.raw / "dlm"
    dest.mkdir(parents=True, exist_ok=True)
    keep = (".shp", ".shx", ".dbf", ".prj", ".cpg")
    with zipfile.ZipFile(outer) as z:
        for member in z.namelist():
            if not member.lower().endswith(".zip"):
                continue
            with z.open(member) as inner, zipfile.ZipFile(inner) as shapes:
                for name in shapes.namelist():
                    path = Path(name)
                    if path.stem in DLM_LAYERS and path.suffix.lower() in keep:
                        tmp = dest / f"{path.name}.part"
                        with shapes.open(name) as src, open(tmp, "wb") as out:
                            shutil.copyfileobj(src, out)
                        tmp.rename(dest / path.name)
    print(f"Basis-DLM → {dest}")
