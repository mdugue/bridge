"""A provider's rasters cut to a tile (pipeline/bake/rasters.py): the guards
that refuse a broken mosaic before it is committed as a DGM."""

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from bake.common import Tile
from bake.rasters import write_tile_raster

X0, Y0, N = 411000.0, 5656000.0, 4  # a 4 m tile at 1 m
FLOAT_MIN = float(np.finfo(np.float32).min)  # Hamburg's NoData


def _tile(tmp_path) -> Tile:
    return Tile("t", (X0, Y0, X0 + N, Y0 + N), 25833, tmp_path / "raw", tmp_path / "data")


def _source(path, heights: np.ndarray, epsg: int = 25833, nodata=None, x0: float = X0):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=heights.shape[1],
        height=heights.shape[0],
        count=1,
        dtype="float32",
        crs=f"EPSG:{epsg}",
        transform=from_origin(x0, Y0 + N, 1.0, 1.0),
        nodata=nodata,
    ) as dst:
        dst.write(heights.astype("float32"), 1)
    return path


def test_a_float_min_nodata_is_written_as_minus_9999_and_heights_to_the_centimetre(tmp_path):
    heights = 100 + np.arange(N * N, dtype=float).reshape(N, N) + 0.004
    heights[0, 0] = FLOAT_MIN  # a hole in the survey
    src = _source(tmp_path / "a.tif", heights, nodata=FLOAT_MIN)
    dest = write_tile_raster([src], _tile(tmp_path), tmp_path / "dgm.tif", 1.0, heights=True)
    with rasterio.open(dest) as ds:
        assert ds.nodata == -9999.0
        out = ds.read(1)
    assert out[0, 0] == -9999.0
    assert out[0, 1] == pytest.approx(101.0, abs=1e-4)  # 101.004 rounded
    assert out[3, 3] == pytest.approx(115.0, abs=1e-4)


def test_a_mosaic_of_one_height_is_refused(tmp_path):
    # Hamburg's mosaic once came out 0 m everywhere: every house floated
    src = _source(tmp_path / "a.tif", np.zeros((N, N)), nodata=FLOAT_MIN)
    with pytest.raises(ValueError, match="flat heights"):
        write_tile_raster([src], _tile(tmp_path), tmp_path / "dgm.tif", 1.0, heights=True)
    assert not (tmp_path / "dgm.tif").exists()


def test_a_source_in_another_crs_is_refused(tmp_path):
    heights = 100 + np.arange(N * N, dtype=float).reshape(N, N)
    src = _source(tmp_path / "a.tif", heights, epsg=25832)
    with pytest.raises(ValueError, match="EPSG:25832, not EPSG:25833"):
        write_tile_raster([src], _tile(tmp_path), tmp_path / "dgm.tif", 1.0, heights=True)


def test_a_source_beside_the_tile_is_refused(tmp_path):
    heights = 100 + np.arange(N * N, dtype=float).reshape(N, N)
    src = _source(tmp_path / "a.tif", heights, nodata=-9999.0, x0=X0 + 100)
    with pytest.raises(ValueError, match="no data inside the tile"):
        write_tile_raster([src], _tile(tmp_path), tmp_path / "dgm.tif", 1.0, heights=True)
