"""The GeoSN laser scan (LAZ) → the 0.5 m rasters the low-vegetation bake
reads, in numpy through laspy (lazrs decompresses the LAZ; both are wheels in
the uv environment, so no PDAL). The rules are PDAL's `writers.gdal` with
`binmode`, which made the committed files:

- a point lands in the one cell that contains it (origin at the tile's
  south-west corner, row 0 = north in the written raster);
- `min` / `max` / `mean` / `count` per cell; `idw` weights each point of a
  cell by 1 / its distance to the cell centre (a point on the centre wins);
- with a window, an empty cell is filled from the non-empty cells within
  `window` cells, each weighted by 1 / its distance in cells (every band but
  `count`).

Written as float32 GeoTIFFs with NoData −9999 and the band descriptions
PDAL gives them (`idw`, `min`, `count`, …), so a folder PDAL made earlier
reads the same:

  dtm_050.tif                        ground (classes 2, 8, 30): idw, min, count; window 3
  dsm_050.tif                        ground + non-ground (2, 20): max, count
  nonground_count_050.tif            non-ground (20): count
  nonground_multiecho_count_050.tif  non-ground with ≥ 2 returns: count
  lowint_050.tif                     non-ground 0.25–4 m above the DTM's `min`: the
                                     mean intensity, count

The scan is streamed in chunks; the per-cell sums are the only full-size
state (a 2 km tile at 0.5 m is 4000², ~64 MB per float64 plane).
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin
from scipy import ndimage as ndi

NODATA = -9999.0
GROUND = (2, 8, 30)
NON_GROUND = 20
LOW_HAG = (0.25, 4.0)
CHUNK = 5_000_000


class Bins:
    """A tile's 0.5 m cells (row 0 = north) and where points fall in them."""

    def __init__(self, xmin: float, ymin: float, size: float, res: float):
        self.xmin, self.ymin, self.res = xmin, ymin, res
        self.n = int(round(size / res))
        self.transform = from_origin(xmin, ymin + self.n * res, res, res)

    def cells(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Flat cell index (row 0 = north) and the in-tile mask."""
        col = np.floor((x - self.xmin) / self.res).astype(np.int64)
        row_s = np.floor((y - self.ymin) / self.res).astype(np.int64)
        ok = (col >= 0) & (col < self.n) & (row_s >= 0) & (row_s < self.n)
        row = self.n - 1 - row_s
        return row * self.n + col, ok

    def centre(self, idx: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        row, col = np.divmod(idx, self.n)
        return (
            self.xmin + (col + 0.5) * self.res,
            self.ymin + (self.n - 1 - row + 0.5) * self.res,
        )


class Stats:
    """Running per-cell statistics of one value."""

    def __init__(self, n: int, idw: bool = False):
        size = n * n
        self.n = n
        self.count = np.zeros(size, np.float64)
        self.sum = np.zeros(size, np.float64)
        self.min = np.full(size, np.inf)
        self.max = np.full(size, -np.inf)
        self.idw = idw
        if idw:
            self.wsum = np.zeros(size, np.float64)
            self.wzsum = np.zeros(size, np.float64)
            # a point exactly on the centre: PDAL takes its value outright
            self.exact = np.full(size, np.nan)

    def add(self, idx: np.ndarray, value: np.ndarray, dist: np.ndarray | None = None) -> None:
        size = self.n * self.n
        self.count += np.bincount(idx, minlength=size)
        self.sum += np.bincount(idx, weights=value, minlength=size)
        np.minimum.at(self.min, idx, value)
        np.maximum.at(self.max, idx, value)
        if self.idw and dist is not None:
            on = dist == 0
            self.exact[idx[on]] = value[on]
            w = 1.0 / np.where(on, 1.0, dist)
            self.wsum += np.bincount(idx[~on], weights=w[~on], minlength=size)
            self.wzsum += np.bincount(idx[~on], weights=(w * value)[~on], minlength=size)

    def band(self, kind: str) -> np.ndarray:
        """One output type as an n×n float array, NaN where no point fell."""
        has = self.count > 0
        if kind == "count":
            out = self.count.copy()
        elif kind == "min":
            out = np.where(has, self.min, np.nan)
        elif kind == "max":
            out = np.where(has, self.max, np.nan)
        elif kind == "mean":
            out = np.where(has, self.sum / np.maximum(self.count, 1), np.nan)
        elif kind == "idw":
            idw = np.where(
                self.wsum > 0, self.wzsum / np.where(self.wsum > 0, self.wsum, 1), np.nan
            )
            out = np.where(np.isnan(self.exact), idw, self.exact)
            out = np.where(has, out, np.nan)
        else:
            raise ValueError(kind)
        return out.reshape(self.n, self.n)


def window_fill(band: np.ndarray, window: int) -> np.ndarray:
    """Empty cells (NaN) from the non-empty ones within `window` cells, each
    weighted by 1 / its distance in cells; cells with none stay empty."""
    if window <= 0:
        return band
    r = np.arange(-window, window + 1)
    dist = np.hypot(*np.meshgrid(r, r))
    kernel = np.where(dist > 0, 1.0 / np.where(dist > 0, dist, 1), 0.0)
    has = ~np.isnan(band)
    num = ndi.convolve(np.where(has, band, 0.0), kernel, mode="constant")
    den = ndi.convolve(has.astype(np.float64), kernel, mode="constant")
    filled = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
    return np.where(has, band, filled)


def write_raster(path: Path, bins: Bins, bands: dict[str, np.ndarray], epsg: int) -> None:
    profile = {
        "driver": "GTiff",
        "width": bins.n,
        "height": bins.n,
        "count": len(bands),
        "dtype": "float32",
        "crs": f"EPSG:{epsg}",
        "transform": bins.transform,
        "nodata": NODATA,
        "compress": "deflate",
        "predictor": 3,
        "tiled": True,
    }
    tmp = path.with_suffix(".tmp.tif")
    with rasterio.open(tmp, "w", **profile) as ds:
        for i, (name, band) in enumerate(bands.items(), start=1):
            ds.write(np.where(np.isnan(band), NODATA, band).astype(np.float32), i)
            ds.set_band_description(i, name)
    tmp.rename(path)


def _chunks(laz: Path) -> Iterator[laspy.ScaleAwarePointRecord]:
    with laspy.open(laz) as reader:
        yield from reader.chunk_iterator(CHUNK)


def rasterise(laz: Path, out: Path, bounds, epsg: int, res: float = 0.5) -> None:
    """Every raster the low-vegetation bake reads, from one LAZ, into `out`."""
    xmin, ymin, xmax, _ = bounds
    bins = Bins(xmin, ymin, xmax - xmin, res)
    ground = Stats(bins.n, idw=True)
    surface = Stats(bins.n)
    nonground = np.zeros(bins.n * bins.n)
    multiecho = np.zeros(bins.n * bins.n)
    size = bins.n * bins.n
    for pts in _chunks(laz):
        x, y, z = np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)
        cls = np.asarray(pts.classification)
        idx, ok = bins.cells(x, y)
        g = ok & np.isin(cls, GROUND)
        cx, cy = bins.centre(idx[g])
        ground.add(idx[g], z[g], np.hypot(x[g] - cx, y[g] - cy))
        s = ok & ((cls == 2) | (cls == NON_GROUND))
        surface.add(idx[s], z[s])
        ng = ok & (cls == NON_GROUND)
        nonground += np.bincount(idx[ng], minlength=size)
        me = ng & (np.asarray(pts.number_of_returns) >= 2)
        multiecho += np.bincount(idx[me], minlength=size)
    dtm = {k: window_fill(ground.band(k), 3) for k in ("idw", "min")}
    dtm["count"] = ground.band("count")
    write_raster(out / "dtm_050.tif", bins, dtm, epsg)
    write_raster(
        out / "dsm_050.tif",
        bins,
        {"max": surface.band("max"), "count": surface.band("count")},
        epsg,
    )
    write_raster(
        out / "nonground_count_050.tif",
        bins,
        {"count": nonground.reshape(bins.n, bins.n)},
        epsg,
    )
    write_raster(
        out / "nonground_multiecho_count_050.tif",
        bins,
        {"count": multiecho.reshape(bins.n, bins.n)},
        epsg,
    )
    # The low returns: height above the DTM's `min` band (PDAL's hag_dem on
    # band 2), read at the cell each point falls in.
    dem = dtm["min"].ravel()
    low = Stats(bins.n)
    for pts in _chunks(laz):
        x, y, z = np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)
        idx, ok = bins.cells(x, y)
        ng = ok & (np.asarray(pts.classification) == NON_GROUND)
        hag = z[ng] - dem[idx[ng]]
        keep = (hag >= LOW_HAG[0]) & (hag <= LOW_HAG[1])  # NaN ground drops out
        low.add(idx[ng][keep], np.asarray(pts.intensity, np.float64)[ng][keep])
    write_raster(
        out / "lowint_050.tif",
        bins,
        {"mean": low.band("mean"), "count": low.band("count")},
        epsg,
    )
