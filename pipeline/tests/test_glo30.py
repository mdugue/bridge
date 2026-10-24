"""The land beyond the site (pipeline/bake/glo30.py): Copernicus GLO-30 as the
sky view's far horizon, aligned on the DGM, and the valley's rim."""

import math
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform

from bake import glo30
from bake.common import Tile
from bake.skyview import FarTerrain, Roofs, fields, horizon_tan, legend

# A 200 m tile near Meißen (EPSG:25833), so the window in degrees is real.
X0, Y0 = 392000.0, 5668000.0
SIZE = 200
EPSG = 25833


def _dgm(tile: Tile, heights: np.ndarray) -> None:
    path = tile.dgm
    path.parent.mkdir(parents=True, exist_ok=True)
    rows, cols = heights.shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=cols,
        height=rows,
        count=1,
        dtype="float32",
        crs=f"EPSG:{EPSG}",
        transform=from_origin(X0, Y0 + rows, 1.0, 1.0),
    ) as dst:
        dst.write(heights.astype(np.float32), 1)


def _tile(tmp_path: Path, heights: np.ndarray) -> Tile:
    tile = Tile(
        "t",
        (X0, Y0, X0 + SIZE, Y0 + SIZE),
        EPSG,
        tmp_path / "raw" / "sn",
        tmp_path / "data" / "site",
    )
    _dgm(tile, heights)
    return tile


def _glo30(tile: Tile, height_at) -> Path:
    """A cached GLO-30 window over the tile and 3 km around it, its heights
    `height_at(x, y)` in the tile's CRS."""
    w, s, e, n = glo30.lonlat_box(tile.bounds, EPSG, 3000.0)
    rx, ry = 1.5 / 3600, 1.0 / 3600
    cols, rows = int((e - w) / rx) + 1, int((n - s) / ry) + 1
    lon = w + (np.arange(cols) + 0.5) * rx
    lat = n - (np.arange(rows) + 0.5) * ry
    glon, glat = np.meshgrid(lon, lat)
    xs, ys = transform("EPSG:4326", f"EPSG:{EPSG}", glon.ravel(), glat.ravel())
    z = height_at(np.asarray(xs), np.asarray(ys)).reshape(rows, cols)
    path = glo30.site_path(tile.raw, tile.data.name)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=cols,
        height=rows,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(w, n, rx, ry),
        nodata=np.nan,
    ) as dst:
        dst.write(z.astype(np.float32), 1)
    return path


# --- beyond the site ----------------------------------------------------------


def test_without_the_far_terrain_the_edge_runs_on_level_not_at_its_mean(tmp_path):
    # a slope rising 0.5 m per metre eastward: 0 m at the west edge, 100 m east
    heights = np.tile(np.arange(SIZE, dtype=np.float32) * 0.5, (SIZE, 1))
    tile = _tile(tmp_path, heights)
    ground, surface, margin = fields(tile, 100, 60.0, Roofs(tile, tile.neighbours()))
    inner = ground[margin:-margin, margin:-margin]
    # west of the site the ground stays at its west edge's height, east at
    # its east edge's: one mean (50 m) stood a 50 m wall over the low side
    # (within the slope's one cell: the resampled edge cell)
    assert np.allclose(ground[margin:-margin, : margin - 1], inner[:, :1], atol=0.5)
    assert np.allclose(ground[margin:-margin, -margin + 1 :], inner[:, -1:], atol=0.5)
    west = horizon_tan(ground, surface, margin, 2.0, 270.0, 2.0, 60.0)
    assert west[:, 0].max() == 0.0


def test_the_far_terrain_stands_in_beyond_the_site_aligned_on_the_dgm(tmp_path):
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0, np.float32))
    # GLO-30 reads 3 m high on the open ground; a 60 m hill 150–400 m east
    _glo30(tile, lambda x, y: 103.0 + np.where((x > X0 + 350) & (x < X0 + 600), 60.0, 0.0))
    far = FarTerrain.of(tile)
    assert far is not None
    ground, surface, margin = fields(tile, 50, 400.0, Roofs(tile, tile.neighbours()), far=far)
    assert far.offset == pytest.approx(3.0, abs=0.05)
    res = SIZE / 50
    # the hill stands beyond the east edge, at its height over the DGM
    east = ground[margin + 25, margin + 50 + int(250 / res)]
    assert east == pytest.approx(160.0, abs=3.0)
    # the open land west is the DGM's level, not GLO-30's
    assert ground[margin + 25, 2] == pytest.approx(100.0, abs=0.1)
    tan = horizon_tan(ground, surface, margin, res, 90.0, res, 400.0)
    assert math.degrees(math.atan(tan[25, 49])) > 10


def test_no_cached_window_no_far_terrain(tmp_path):
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0, np.float32))
    assert FarTerrain.of(tile) is None
    path = glo30.site_path(tile.raw, "site")
    assert path == tmp_path / "raw" / "glo30" / "site.tif"


def test_the_legend_credits_glo30_and_carries_the_rim():
    plain = legend("Quelle: GeoSN, dl-de/by-2-0")
    assert "valley" not in plain and "terrainFarM" not in plain["bands"][0]
    assert plain["attribution"] == "Quelle: GeoSN, dl-de/by-2-0 (DGM1, LoD2)"
    rim = {"floorM": 90.0, "at": [0.0, 0.0], "rimM": [100.0] * 16}
    doc = legend("Quelle: GeoSN, dl-de/by-2-0", offset=2.2, rim=rim)
    assert doc["attribution"].startswith("Quelle: GeoSN, dl-de/by-2-0 (DGM1, LoD2); ")
    assert glo30.CREDIT in doc["attribution"]
    assert doc["bands"][0]["terrainFarM"] == 10_000.0
    assert doc["valley"]["rimM"] == [100.0] * 16 and doc["valley"]["floorM"] == 90.0
    assert "-2.20 m" in doc["beyond"]


# --- the valley's rim -----------------------------------------------------------


def test_the_rim_is_read_from_the_tile_s_low_ground(tmp_path):
    # the tile slopes 0.1 m per metre down to the south: its low ground is
    # its south edge
    heights = np.repeat((np.arange(SIZE, dtype=np.float32)[::-1] * 0.1)[:, None], SIZE, axis=1)
    tile = _tile(tmp_path, 100.0 + heights)
    floor = glo30.tile_floor(tile.dgm, tile.bounds)
    assert floor is not None
    fx, fy, fz = floor
    assert fy < Y0 + 60 and fz == pytest.approx(103.0, abs=3.0)
    # around it the land climbs 40 m per km northward and stays level south;
    # a 25 m mast-like spike east is no rim
    path = _glo30(
        tile,
        lambda x, y: (
            100.0
            + np.clip(y - fy, 0, None) * 0.04
            + np.where((abs(x - fx - 1500) < 20) & (abs(y - fy) < 20), 25.0, 0.0)
        ),
    )
    az = np.arange(16) * 22.5
    valley = glo30.rims(path, EPSG, floor, 0.0, az)
    assert valley is not None and len(valley["rimM"]) == 16
    assert valley["floorM"] == pytest.approx(fz, abs=0.1)
    north, east, south = valley["rimM"][0], valley["rimM"][4], valley["rimM"][8]
    assert north == pytest.approx(100 + 0.04 * 2900, abs=12)  # the window's reach
    assert south == pytest.approx(100.0, abs=2.0)
    # east: the sector's northern edge climbs a little, the spike adds nothing
    assert 100.0 < east < 100 + 0.04 * 5000 * math.sin(math.radians(11.25))
    assert glo30.rims(tmp_path / "none.tif", EPSG, floor, 0.0, az) is None
    assert glo30.tile_floor(tmp_path / "none.tif", tile.bounds) is None


def test_the_alignment_is_the_median_over_open_ground_both_cover():
    dgm = np.full((30, 30), 100.0)
    far = dgm + 2.0
    far[:10] += 25.0  # a town in the surface model
    open_ground = np.ones_like(dgm, bool)
    open_ground[:10] = False  # its roofs: not open
    assert glo30.align(far, dgm, open_ground) == pytest.approx(2.0)
    assert glo30.align(far[:5, :5], dgm[:5, :5], open_ground[:5, :5]) == 0.0


def test_a_cell_is_named_and_snapped_as_the_bucket_has_it():
    assert glo30.cell_url(51, 13).endswith(
        "Copernicus_DSM_COG_10_N51_00_E013_00_DEM/Copernicus_DSM_COG_10_N51_00_E013_00_DEM.tif"
    )
    assert "S01_00_W002_00" in glo30.cell_url(-1, -2)
    r = 1.0 / 3600
    w, s, e, n = glo30._snap((13.1, 51.1, 13.2, 51.2), (r, r))
    assert w <= 13.1 and e >= 13.2 and s <= 51.1 and n >= 51.2
    # the edges lie half a pixel off the whole degree
    assert (w / r - 0.5) == pytest.approx(round(w / r - 0.5), abs=1e-6)


def test_a_cached_window_that_covers_the_site_is_not_fetched_again(tmp_path, monkeypatch):
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0, np.float32))
    path = _glo30(tile, lambda x, y: np.full(np.shape(x), 100.0))

    def no_network(*_a, **_k):
        raise AssertionError("fetched again")

    monkeypatch.setattr(glo30, "_open_cell", no_network)
    monkeypatch.setattr(glo30, "REACH_M", 1000.0)
    monkeypatch.setattr(glo30, "PAD_M", 0.0)
    assert glo30.fetch(tile.raw, "site", [tile.bounds], EPSG) == path
