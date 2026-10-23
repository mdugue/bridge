"""The land beyond the site: Copernicus DEM GLO-30, a 30 m surface model of
the whole of Europe (TanDEM-X), for the light the city's own data cannot
know past its tiles — the far horizon's hills and the valley's rim
(skyview.py).

The fetch reads only the window a site needs — its tiles plus REACH_M and a
pad — out of the public cloud-optimised GeoTIFFs (one per 1° cell, HTTP
range requests through GDAL) and caches it, in the source's own grid and
heights (EPSG:4326, EGM2008), as

    data/_raw/glo30/<site>.tif     float32, NaN where no cell covers (sea)

(≈ 1–5 MB a site). A rerun skips a cached window that still covers every
tile. The bakes read it through `far_terrain` and work without it: the sky
view then extends the site's own edge outward (`skyview.extend_edges`).

GLO-30 is a surface model (buildings, forests), and its heights are not the
DGM1's: before it stands in for the ground beyond the site, the median of
its difference to the DGM1 over the open ground both cover (`align`) is
taken off, so the two meet without a step.

Licence: Copernicus WorldDEM-30, free of charge for any use; a modified
product carries CREDIT, and its legal notice the liability sentence
DISCLAIMER (the licence's Article 6 (b), (c)).
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.errors import RasterioIOError
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
from scipy.ndimage import percentile_filter, uniform_filter

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
CRS = "EPSG:4326"
# How far past the site the far terrain reaches (m): the far horizon's ring
# (skyview.TERRAIN_FAR_M) …
REACH_M = 10_000.0
# … plus a pad for the smoothing at the window's edge.
PAD_M = 1_000.0
# The source's spikes (a mast, a radar speckle) are evened over SMOOTH_CELLS
# × SMOOTH_CELLS cells (≈ 90 m) before it stands in for the ground.
SMOOTH_CELLS = 3
# Open ground for the alignment: no roof within this height of the DGM (m).
OPEN_M = 0.5
# Fewer overlap cells than this: no alignment (offset 0).
ALIGN_MIN_CELLS = 200
# The valley's rim (`rims`): the high ground within RIM_REACH_M of the
# tile's low ground, per azimuth sector — the land as GLO-30 shows it once a
# building's or a copse's height is taken out (the RIM_PERCENTILE-th lowest
# of RIM_WINDOW × RIM_WINDOW cells, ≈ 150 m), its RIM_SHARE-th percentile
# over the sector (a hill, not a mast).
RIM_REACH_M = 5_000.0
RIM_WINDOW = 5
RIM_PERCENTILE = 10
RIM_SHARE = 95
RIM_RES_M = 30.0

CREDIT = (
    "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence "
    "and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; "
    "all rights reserved"
)
DISCLAIMER = (
    "The organisations in charge of the Copernicus programme by law or by delegation "
    "do not incur any liability for any use of the Copernicus WorldDEM-30"
)

Bounds = tuple[float, float, float, float]


def glo30_dir(raw: Path) -> Path:
    """One folder for every provider (the model covers them all), beside the
    providers' raw folders, as the timetable's (transit.gtfs_dir)."""
    return raw.parent / "glo30"


def site_path(raw: Path, site: str) -> Path:
    return glo30_dir(raw) / f"{site}.tif"


def cell_url(lat: int, lon: int) -> str:
    """The cloud-optimised GeoTIFF of the 1° cell whose south-west corner is
    (lat, lon)."""
    ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
    name = f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"
    return f"{BUCKET}/{name}/{name}.tif"


def union(bounds: list[Bounds]) -> Bounds:
    return (
        min(b[0] for b in bounds),
        min(b[1] for b in bounds),
        max(b[2] for b in bounds),
        max(b[3] for b in bounds),
    )


def lonlat_box(bounds: Bounds, epsg: int, reach_m: float) -> Bounds:
    """The (west, south, east, north) degrees covering `bounds` grown by
    `reach_m`."""
    x0, y0, x1, y1 = bounds
    return transform_bounds(
        f"EPSG:{epsg}",
        CRS,
        x0 - reach_m,
        y0 - reach_m,
        x1 + reach_m,
        y1 + reach_m,
        densify_pts=21,
    )


def covers(path: Path, box: Bounds) -> bool:
    """Whether a cached window holds all of `box`."""
    if not path.exists():
        return False
    with rasterio.open(path) as ds:
        b = ds.bounds
    return b.left <= box[0] and b.bottom <= box[1] and b.right >= box[2] and b.top >= box[3]


def _gdal_env() -> dict:
    """GDAL's HTTP reads: no directory listing per file, a few retries, and
    the CA bundle the environment names (a proxy that re-signs TLS; GDAL's
    curl reads no SSL_CERT_FILE of its own)."""
    env = {
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
        "GDAL_HTTP_MAX_RETRY": "4",
        "GDAL_HTTP_RETRY_DELAY": "2",
    }
    bundle = os.environ.get("CURL_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if bundle:
        env["GDAL_CURL_CA_BUNDLE"] = bundle
    return env


def _snap(box: Bounds, res: tuple[float, float]) -> Bounds:
    """`box` grown out to the source's pixel edges, which lie half a pixel
    off every whole degree."""
    rx, ry = res

    def down(v: float, r: float) -> float:
        return (math.floor(v / r - 0.5) + 0.5) * r

    def up(v: float, r: float) -> float:
        return (math.ceil(v / r - 0.5) + 0.5) * r

    return down(box[0], rx), down(box[1], ry), up(box[2], rx), up(box[3], ry)


def _open_cell(lat: int, lon: int):
    """The cell's dataset, or None where the bucket has none (the sea)."""
    try:
        return rasterio.open(f"/vsicurl/{cell_url(lat, lon)}")
    except RasterioIOError as err:
        if "404" in str(err) or "does not exist" in str(err).lower():
            return None
        raise


def mosaic(box: Bounds, cells: list) -> tuple[np.ndarray, object]:
    """The window `box` out of the open cells, on the grid of the first one
    (snapped to its pixels): (heights, transform), NaN where none covers."""
    res = cells[0].res
    w, s, e, n = _snap(box, res)
    cols, rows = int(round((e - w) / res[0])), int(round((n - s) / res[1]))
    transform = from_origin(w, n, res[0], res[1])
    out = np.full((rows, cols), np.nan, np.float32)
    for ds in cells:
        b = ds.bounds
        part = (max(w, b.left), max(s, b.bottom), min(e, b.right), min(n, b.top))
        if part[0] >= part[2] or part[1] >= part[3]:
            continue
        win = ds.window(*part).round_offsets().round_lengths()
        data = ds.read(1, window=win).astype(np.float32)
        reproject(
            data,
            out,
            src_transform=ds.window_transform(win),
            src_crs=CRS,
            dst_transform=transform,
            dst_crs=CRS,
            resampling=Resampling.nearest,
            src_nodata=ds.nodata,
            dst_nodata=np.nan,
            init_dest_nodata=False,
        )
    return out, transform


def fetch(raw: Path, site: str, tiles: list[Bounds], epsg: int) -> Path:
    """The site's window of GLO-30, unless a cached one still covers every
    tile plus REACH_M. Raises when nothing could be read."""
    dest = site_path(raw, site)
    box = lonlat_box(union(tiles), epsg, REACH_M + PAD_M)
    if covers(dest, box):
        return dest
    with rasterio.Env(**_gdal_env()):
        cells = [
            ds
            for lat in range(math.floor(box[1]), math.floor(box[3]) + 1)
            for lon in range(math.floor(box[0]), math.floor(box[2]) + 1)
            if (ds := _open_cell(lat, lon)) is not None
        ]
        if not cells:
            raise OSError(f"no GLO-30 cell covers {box}")
        try:
            heights, transform = mosaic(box, cells)
        finally:
            for ds in cells:
                ds.close()
    if not np.isfinite(heights).any():
        raise OSError(f"GLO-30 read nothing over {box}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    with rasterio.open(
        part,
        "w",
        driver="GTiff",
        width=heights.shape[1],
        height=heights.shape[0],
        count=1,
        dtype="float32",
        crs=CRS,
        transform=transform,
        nodata=np.nan,
        compress="deflate",
        predictor=3,
        tiled=True,
    ) as dst:
        dst.write(heights, 1)
    part.replace(dest)
    return dest


# --- the bakes' side ----------------------------------------------------------


def smooth(heights: np.ndarray, size: int = SMOOTH_CELLS) -> np.ndarray:
    """A NaN-aware box mean over size × size cells."""
    ok = np.isfinite(heights)
    filled = np.where(ok, heights, 0.0).astype(np.float64)
    weight = uniform_filter(ok.astype(np.float64), size, mode="nearest")
    total = uniform_filter(filled, size, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = total / weight
    return np.where(weight > 0, out, np.nan).astype(np.float32)


def far_terrain(
    path: Path, epsg: int, bounds: Bounds, res: float, resampling=Resampling.bilinear
) -> np.ndarray | None:
    """GLO-30 (smoothed) on a north-up grid of `res` m over `bounds` in the
    site's CRS — NaN where it has none; None without the cached window."""
    if not path.exists():
        return None
    xmin, ymin, xmax, ymax = bounds
    cols, rows = int(round((xmax - xmin) / res)), int(round((ymax - ymin) / res))
    out = np.full((rows, cols), np.nan, np.float32)
    with rasterio.open(path) as ds:
        src = smooth(ds.read(1).astype(np.float32))
        reproject(
            src,
            out,
            src_transform=ds.transform,
            src_crs=ds.crs,
            dst_transform=from_origin(xmin, ymax, res, res),
            dst_crs=f"EPSG:{epsg}",
            resampling=resampling,
            src_nodata=np.nan,
            dst_nodata=np.nan,
            init_dest_nodata=False,
        )
    return out


def align(far: np.ndarray, dgm: np.ndarray, open_ground: np.ndarray) -> float:
    """The median of GLO-30 over the DGM1 where both cover open ground (no
    roof on it): the datum's difference and what the surface model keeps of
    low cover. 0 where they share too few cells."""
    both = np.isfinite(far) & np.isfinite(dgm) & open_ground
    if both.sum() < ALIGN_MIN_CELLS:
        return 0.0
    return float(np.median(far[both] - dgm[both]))


def tile_floor(dgm: Path, bounds: Bounds) -> tuple[float, float, float] | None:
    """The tile's low ground: where its DGM1, averaged over RIM_RES_M cells
    and then RIM_WINDOW × RIM_WINDOW of them (≈ 150 m: a river, not a pit),
    is lowest — (x, y, height). None without the DGM."""
    if not dgm.exists():
        return None
    x0, y0, x1, y1 = bounds
    cols, rows = int(round((x1 - x0) / RIM_RES_M)), int(round((y1 - y0) / RIM_RES_M))
    out = np.full((rows, cols), np.nan, np.float32)
    with rasterio.open(dgm) as ds:
        reproject(
            ds.read(1).astype(np.float32),
            out,
            src_transform=ds.transform,
            src_crs=ds.crs,
            dst_transform=from_origin(x0, y1, RIM_RES_M, RIM_RES_M),
            dst_crs=ds.crs,
            resampling=Resampling.average,
            src_nodata=ds.nodata,
            dst_nodata=np.nan,
            init_dest_nodata=False,
        )
    low = smooth(out, RIM_WINDOW)
    if not np.isfinite(low).any():
        return None
    r, c = np.unravel_index(np.nanargmin(low), low.shape)
    return x0 + (c + 0.5) * RIM_RES_M, y1 - (r + 0.5) * RIM_RES_M, float(low[r, c])


def rims(
    path: Path,
    epsg: int,
    floor: tuple[float, float, float],
    offset: float,
    azimuths: np.ndarray,
) -> dict | None:
    """The valley around the tile's low ground (`tile_floor`): its height
    (`floorM`, m) and, per azimuth (degrees clockwise from north), the
    height of the high ground within RIM_REACH_M of it in that azimuth's
    sector (`rimM`, m on the DGM's datum, None where the sector holds no
    ground) — the valley's rim on that side (lib/city/valley-fog.ts).
    Measured from the low ground, not the tile's middle: on a slope the
    land beside a tile on the hillside stands above the site's floor along
    the slope as well as up it, and read as a valley. None without the
    window."""
    fx, fy, fz = floor
    grown = (fx - RIM_REACH_M, fy - RIM_REACH_M, fx + RIM_REACH_M, fy + RIM_REACH_M)
    heights = far_terrain(path, epsg, grown, RIM_RES_M)
    if heights is None:
        return None
    ok = np.isfinite(heights)
    low = percentile_filter(np.where(ok, heights, -1e9), RIM_PERCENTILE, size=RIM_WINDOW)
    low = np.where(ok & (low > -1e8), low - offset, np.nan)
    rows, cols = heights.shape
    xs = grown[0] + (np.arange(cols) + 0.5) * RIM_RES_M - fx
    ys = grown[3] - (np.arange(rows) + 0.5) * RIM_RES_M - fy
    gx, gy = np.meshgrid(xs, ys)
    keep = np.isfinite(low) & (np.hypot(gx, gy) <= RIM_REACH_M)
    az = np.degrees(np.arctan2(gx, gy)) % 360.0
    half = 180.0 / len(azimuths)
    out: list[float | None] = []
    for a in azimuths:
        off = (az - a + 180.0) % 360.0 - 180.0
        sector = keep & (np.abs(off) < half)
        out.append(round(float(np.percentile(low[sector], RIM_SHARE)), 1) if sector.any() else None)
    return {
        "floorM": round(float(fz), 1),
        "at": [round(float(fx), 1), round(float(fy), 1)],
        "rimM": out,
    }
