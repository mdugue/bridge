"""A provider's rasters, whatever their grid, cut to one of our tiles: a
mosaic of every source file that touches the tile, clipped to its extent at
the resolution the bakes read (DGM1 and DOM1 at 1 m, the DOP at 20 cm).
Saxony's downloads already sit on our grid; 1 km downloads (NRW, Bavaria,
Hamburg) are mosaicked four at a time."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.merge import merge

from .common import Tile


def write_tile_raster(
    sources: list[Path],
    tile: Tile,
    dest: Path,
    res: float,
    resampling: Resampling = Resampling.bilinear,
    heights: bool = False,
    method: str = "first",
) -> Path:
    """Mosaics `sources` over the tile's extent at `res` metres into a tiled,
    compressed GeoTIFF. `heights` rounds a float raster to centimetres (far
    below a DGM1's accuracy) so DEFLATE with the floating-point predictor
    packs a 2 km DGM into ~6 MB instead of 15. Raises instead of writing a
    raster that is not georeferenced in the tile's CRS or holds no data."""
    if not sources:
        raise ValueError(f"no source rasters for {dest.name}")
    datasets = []
    try:
        for path in sources:
            datasets.append(rasterio.open(path))
            _check_georeferenced(datasets[-1], path, tile.epsg)
        first = datasets[0]
        nodata = first.nodata
        if heights and (nodata is None or abs(nodata) > 1e30):
            nodata = -9999.0  # also replaces Hamburg's float-min NoData
        mosaic, transform = merge(
            datasets,
            bounds=tile.bounds,
            res=res,
            nodata=nodata,
            resampling=resampling,
            method=method,
        )
    finally:
        for ds in datasets:
            ds.close()
    if nodata is None:
        valid = np.ones(mosaic.shape, dtype=bool)
    elif np.isnan(nodata):
        valid = ~np.isnan(mosaic)
    else:
        valid = mosaic != nodata
    if not valid.any() or (nodata is None and not mosaic.any()):
        raise ValueError(f"{dest.name}: the sources hold no data inside the tile")
    if heights:
        mosaic[valid] = np.round(mosaic[valid] * 100) / 100
    profile = {
        "driver": "GTiff",
        "width": mosaic.shape[2],
        "height": mosaic.shape[1],
        "count": mosaic.shape[0],
        "dtype": mosaic.dtype,
        "crs": f"EPSG:{tile.epsg}",
        "transform": transform,
        "nodata": nodata,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
        "compress": "deflate",
        "predictor": 3 if np.issubdtype(mosaic.dtype, np.floating) else 2,
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    with rasterio.open(tmp, "w", **profile) as out:
        out.write(mosaic)
    tmp.rename(dest)
    return dest


def _check_georeferenced(ds, path: Path, epsg: int) -> None:
    """A source must sit in the tile's CRS: merging does not reproject."""
    if ds.transform.is_identity:
        raise ValueError(f"{path.name} carries no georeferencing (a .tfw next to it?)")
    if ds.crs is not None and ds.crs.to_epsg() not in (None, epsg):
        raise ValueError(f"{path.name} is in EPSG:{ds.crs.to_epsg()}, not EPSG:{epsg}")
