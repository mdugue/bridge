"""Berlin (SenSBW, gdi.berlin.de): INSPIRE ATOM downloads. DGM1 and DOM1
are 2 km tiles of XYZ text (gridded to GeoTIFF here), LoD2 is 1 km CityGML,
the TrueDOP (RGBI, JPEG 2000, 2 km sheets) comes in one ZIP per district,
searched for the sheet through range requests. The Basis-DLM is a WFS
only — land cover comes from OSM (sites/providers.ts).

Untested from the environment that wrote it (the portal's certificate chain
was refused there); the URL scheme is from the ATOM feeds, 2026-09."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from ..common import Tile
from ..fetch import Ctx, cells
from ..net import download, remote_zip_members, unzip_members

ATOM = "https://gdi.berlin.de/data"
TRUEDOP = f"{ATOM}/truedop_2026/atom/{{}}.zip"
DISTRICTS = ("Mitte", "Nord", "Nordost", "Nordwest", "Ost", "Süd", "Südost", "Südwest", "West")


def xyz_to_tif(xyz: Path, epsg: int) -> Path:
    """A regular 1 m XYZ grid (cell centres) as a float32 GeoTIFF."""
    x, y, z = np.loadtxt(xyz, usecols=(0, 1, 2), unpack=True)
    xmin, ymax = x.min() - 0.5, y.max() + 0.5
    cols = np.rint(x - x.min()).astype(int)
    rows = np.rint(y.max() - y).astype(int)
    grid = np.full((rows.max() + 1, cols.max() + 1), -9999.0, dtype=np.float32)
    grid[rows, cols] = z
    dest = xyz.with_suffix(".tif")
    with rasterio.open(
        dest,
        "w",
        driver="GTiff",
        width=grid.shape[1],
        height=grid.shape[0],
        count=1,
        dtype="float32",
        crs=f"EPSG:{epsg}",
        transform=from_origin(xmin, ymax, 1, 1),
        nodata=-9999.0,
    ) as out:
        out.write(grid, 1)
    return dest


def _heights(ctx: Ctx, tile: Tile, feed: str, prefix: str) -> list[Path]:
    out = []
    for e, n in cells(tile, 2):
        name = f"{prefix}{e}_{n}.zip"
        zip_path = download(f"{ATOM}/{feed}/atom/{name}", ctx.scratch / feed / name)
        grids = unzip_members(zip_path, rf"{e}_{n}[^/]*\.(xyz|txt)$", ctx.scratch / feed)
        if not grids:
            raise FileNotFoundError(f"{name}: no XYZ grid for {e}_{n}")
        out += [xyz_to_tif(p, ctx.epsg) for p in grids]
    return out


def dgm(ctx: Ctx, tile: Tile) -> list[Path]:
    return _heights(ctx, tile, "dgm1", "DGM1_")


def dom(ctx: Ctx, tile: Tile) -> list[Path]:
    return _heights(ctx, tile, "dom", "DOM1_")


def dop(ctx: Ctx, tile: Tile) -> list[Path]:
    # Every district's archive: a sheet on a district border is in two.
    out = []
    for e, n in cells(tile, 2):
        found = []
        for district in DISTRICTS:
            dest = ctx.scratch / "truedop" / district
            found += remote_zip_members(TRUEDOP.format(district), rf"{e}_{n}[^/]*\.jp2$", dest)
        if not found:
            raise FileNotFoundError(f"TrueDOP: no sheet for {e}_{n}")
        out += found
    return out


def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    out = []
    for e, n in cells(tile, 1):
        name = f"LoD2_{e}_{n}.zip"
        zip_path = download(f"{ATOM}/a_lod2/atom/{name}", ctx.scratch / "lod2" / name)
        out += unzip_members(zip_path, r"\.(xml|gml)$", ctx.scratch / "lod2" / name)
    return out


def dlm(ctx: Ctx) -> None:
    raise SystemExit("Berlin publishes no Basis-DLM in the Shape profile (products.dlm)")
