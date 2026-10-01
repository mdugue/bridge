"""The provider's laser scan (LAZ) → the 0.5 m rasters the low-vegetation
and small-structure bakes read, in numpy through laspy (lazrs decompresses the
LAZ; both are wheels in the uv environment, so no PDAL). The rules are PDAL's `writers.gdal` with
`binmode`, which made the committed files:

- a point lands in the one cell that contains it (origin at the tile's
  south-west corner, row 0 = north in the written raster);
- `min` / `max` / `mean` / `count` per cell. `idw` is **the first point of
  the cell in file order**: in bin mode PDAL passes every point at distance
  0, and a distance-0 point sets the value and switches the weighting off
  for that cell (`GDALGrid::update`);
- with a window, an empty cell is filled from the non-empty cells within
  `window` cells, each weighted by 1 / its **Chebyshev** distance in cells,
  max(|di|, |dj|) (`GDALGrid::windowFill`; every band but `count`).

Checked against PDAL 2.x rasters of 33412_5656 with
scripts/eval/compare-bakes.py --rasters.

Written as float32 GeoTIFFs with NoData −9999 and the band descriptions
PDAL gives them (`idw`, `min`, `count`, …), so a folder PDAL made earlier
reads the same:

  dtm_050.tif                        ground (classes 2, 8, 30): idw, min, count; window 3
  dsm_050.tif                        ground + non-ground (2, 20): max, count
  nonground_count_050.tif            non-ground (20): count
  nonground_multiecho_count_050.tif  non-ground with ≥ 2 returns: count
  lowint_050.tif                     non-ground 0.25–4 m above the DTM's `idw`: the
                                     mean intensity (normalised, below), count

**Classes.** The rasters read the AdV scheme GeoSN's and NRW's scans
use (`ADV`): 2 measured ground, 8 and 30 synthetic ground (water, under
buildings: DGM1 fill, not measurements), 20 everything standing on the
ground — vegetation, buildings, cars, fences alike; what is what is decided
downstream (LoD2, NDVI, land cover, the echo ratio, the low returns'
intensity). A provider with another scheme maps its classes into this one
when its 1 km files are merged (`merge_laz(classes=…)`; Bavaria's table is
`providers/by.py`), so `lsc/<tile>.laz` always speaks AdV.

**Intensity.** The low-vegetation cue (`lowveg.INT_T`) was measured on
GeoSN's flight over Dresden (2024-11-30). Intensities are not calibrated
between sensors, so every scan is scaled by `REFERENCE_GROUND_INTENSITY /
its own measured-ground median` (`intensity_scale`) — the same surface
class, asphalt and lawn, read as the same brightness. The reference is
that median on Dresden's spawn tile, so it rasterises with a factor of
exactly 1, as before; the factor is printed and written into the
`lowint` raster's tags.

The scan is streamed in chunks; the per-cell sums are the only full-size
state (a 2 km tile at 0.5 m is 4000², ~64 MB per float64 plane).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin
from scipy import ndimage as ndi

NODATA = -9999.0
LOW_HAG = (0.25, 4.0)
CHUNK = 5_000_000


@dataclass(frozen=True)
class Classes:
    """A scan's class table in the terms the rasters read: the measured
    ground (the DTM, the surface, the intensity reference), the synthetic
    ground (the DTM only) and everything standing on the ground (the
    surface, the non-ground and low-return rasters)."""

    ground: int
    synthetic: tuple[int, ...]
    nonground: tuple[int, ...]

    @property
    def dtm(self) -> tuple[int, ...]:
        return (self.ground, *self.synthetic)

    @property
    def surface(self) -> tuple[int, ...]:
        return (self.ground, *self.nonground)


# GeoSN and NRW: 2 ground, 8 water and 30 under-building fill (synthetic),
# 20 non-ground. Other classes (noise, …) are not read.
ADV = Classes(ground=2, synthetic=(8, 30), nonground=(20,))

# GeoSN's measured-ground (class 2) intensity median on Dresden's spawn tile
# 33412_5656 (flight 2024-11-30, 34.1 M ground points; p10/p90 958/1637),
# where the low-vegetation cue was measured: every scan is brought to it.
REFERENCE_GROUND_INTENSITY = 1352


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


class Stats:
    """Running per-cell statistics of one value."""

    def __init__(self, n: int):
        size = n * n
        self.n = n
        self.count = np.zeros(size, np.float64)
        self.sum = np.zeros(size, np.float64)
        self.min = np.full(size, np.inf)
        self.max = np.full(size, -np.inf)
        # the first value per cell, in the order the points were added
        self.first = np.full(size, np.nan)

    def add(self, idx: np.ndarray, value: np.ndarray) -> None:
        size = self.n * self.n
        self.count += np.bincount(idx, minlength=size)
        self.sum += np.bincount(idx, weights=value, minlength=size)
        np.minimum.at(self.min, idx, value)
        np.maximum.at(self.max, idx, value)
        cells, at = np.unique(idx, return_index=True)
        unset = np.isnan(self.first[cells])
        self.first[cells[unset]] = value[at[unset]]

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
            out = np.where(has, self.first, np.nan)
        else:
            raise ValueError(kind)
        return out.reshape(self.n, self.n)


def window_fill(band: np.ndarray, window: int) -> np.ndarray:
    """Empty cells (NaN) from the non-empty ones within `window` cells, each
    weighted by 1 / its Chebyshev distance in cells; cells with none stay
    empty."""
    if window <= 0:
        return band
    r = np.arange(-window, window + 1)
    di, dj = np.meshgrid(r, r)
    dist = np.maximum(np.abs(di), np.abs(dj)).astype(np.float64)
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


def histogram_median(hist: np.ndarray) -> int:
    """The median of the values a bincount counts (0 when it is empty)."""
    total = hist.sum()
    if total == 0:
        return 0
    return int(np.searchsorted(np.cumsum(hist), 0.5 * total))


def intensity_scale(ground_median: int) -> float:
    """The factor that brings a scan's measured-ground intensity median to
    the reference's (1 where the scan carries no intensities)."""
    if ground_median <= 0:
        return 1.0
    return REFERENCE_GROUND_INTENSITY / ground_median


def rasterise(
    laz: Path, out: Path, bounds, epsg: int, res: float = 0.5, classes: Classes = ADV
) -> float:
    """Every raster the low-vegetation bake reads, from one LAZ, into `out`.
    Returns the scan's intensity factor."""
    xmin, ymin, xmax, _ = bounds
    bins = Bins(xmin, ymin, xmax - xmin, res)
    ground = Stats(bins.n)
    surface = Stats(bins.n)
    nonground = np.zeros(bins.n * bins.n)
    multiecho = np.zeros(bins.n * bins.n)
    ground_int = np.zeros(65536, np.int64)
    size = bins.n * bins.n
    for pts in _chunks(laz):
        x, y, z = np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)
        cls = np.asarray(pts.classification)
        idx, ok = bins.cells(x, y)
        g = ok & np.isin(cls, classes.dtm)
        ground.add(idx[g], z[g])
        s = ok & np.isin(cls, classes.surface)
        surface.add(idx[s], z[s])
        ng = ok & np.isin(cls, classes.nonground)
        nonground += np.bincount(idx[ng], minlength=size)
        me = ng & (np.asarray(pts.number_of_returns) >= 2)
        multiecho += np.bincount(idx[me], minlength=size)
        measured = ok & (cls == classes.ground)
        ground_int += np.bincount(np.asarray(pts.intensity)[measured], minlength=65536)
    # PDAL writes its bands in a fixed order — min, max, mean, idw, count —
    # whatever order `output_type` lists them in (GDALWriter.cpp).
    dtm = {k: window_fill(ground.band(k), 3) for k in ("min", "idw")}
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
    # The low returns: height above the DTM's band 2 — `idw`, by PDAL's band
    # order, not `min` — as hag_dem reads it from the float32 file, at the
    # cell each point falls in.
    dem = dtm["idw"].astype(np.float32).astype(np.float64).ravel()
    low = Stats(bins.n)
    for pts in _chunks(laz):
        x, y, z = np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)
        idx, ok = bins.cells(x, y)
        ng = ok & np.isin(np.asarray(pts.classification), classes.nonground)
        hag = z[ng] - dem[idx[ng]]
        keep = (hag >= LOW_HAG[0]) & (hag <= LOW_HAG[1])  # NaN ground drops out
        low.add(idx[ng][keep], np.asarray(pts.intensity, np.float64)[ng][keep])
    median = histogram_median(ground_int)
    scale = intensity_scale(median)
    mean = low.band("mean")
    if scale != 1.0:
        mean = mean * scale
    path = out / "lowint_050.tif"
    write_raster(path, bins, {"mean": mean, "count": low.band("count")}, epsg)
    with rasterio.open(path, "r+") as ds:
        ds.update_tags(ground_intensity_median=median, intensity_scale=f"{scale:.6f}")
    print(f"{laz.name}: measured-ground intensity median {median} → intensity × {scale:.4f}")
    return scale


# The dimensions the rasters read; a merged scan keeps these.
MERGED_DIMS = ("intensity", "return_number", "number_of_returns", "classification")


def merge_laz(
    sources: list[Path],
    dest: Path,
    intensity_scale: float = 1.0,
    classes: Callable[[laspy.LasHeader], Mapping[int, int]] | None = None,
) -> Path:
    """Several LAZ files (a provider's 1 km tiles) as the one scan per 2 km
    tile the rasters read, in the first file's point format and scale. Only
    what the rasters need is carried: x, y, z and `MERGED_DIMS`.

    `classes` maps a source's classes into the AdV scheme the rasters read
    (`ADV`), given the source's header (a provider's scheme may change with
    the survey year); a class it does not list is dropped. `intensity_scale`
    is a fixed pre-scale, kept for callers that set one: `rasterise`
    normalises every scan by its own ground median anyway, which a fixed
    factor does not change."""
    if not sources:
        raise ValueError(f"no laser scan files for {dest.name}")
    with laspy.open(sources[0]) as first:
        header = laspy.LasHeader(point_format=first.header.point_format.id, version="1.4")
        header.scales = first.header.scales
        header.offsets = first.header.offsets
    tmp = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with laspy.open(tmp, mode="w", header=header, do_compress=True) as out:
        for src in sources:
            with laspy.open(src) as reader:
                table = class_table(classes(reader.header)) if classes else None
            for pts in _chunks(src):
                if table is not None:
                    mapped = table[np.asarray(pts.classification)]
                    keep = mapped > 0
                    pts = pts[keep]
                rec = laspy.ScaleAwarePointRecord.zeros(len(pts), header=header)
                rec.x, rec.y, rec.z = pts.x, pts.y, pts.z
                for dim in MERGED_DIMS:
                    rec[dim] = pts[dim]
                if table is not None:
                    rec.classification = mapped[keep]
                if intensity_scale != 1.0:
                    scaled = np.asarray(pts.intensity, np.float64) * intensity_scale
                    rec.intensity = np.clip(np.round(scaled), 0, 65535).astype(np.uint16)
                out.write_points(rec)
    tmp.replace(dest)
    return dest


def class_table(mapping: Mapping[int, int]) -> np.ndarray:
    """A class mapping as a lookup over every class code; 0 = dropped."""
    table = np.zeros(256, np.uint8)
    for src, dst in mapping.items():
        table[src] = dst
    return table
