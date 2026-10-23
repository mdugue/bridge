"""A flight's cast, read off its sunlit carriageways, is taken to Dresden's
balance; the photo's brightness stays the flight's."""

from __future__ import annotations

import numpy as np
import rasterio
from PIL import Image

from bake import dop_balance
from bake.common import Tile

CYAN = np.array([0.79, 1.0, 1.15])  # Leipzig's cast, linear, over green


def _srgb8(linear) -> np.ndarray:
    c = np.clip(np.asarray(linear, float), 0, 1)
    return np.round(255 * np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055))


def _tile(tmp_path) -> Tile:
    """A 100 m tile at 1 m, all road: its north half sunlit grey under a
    cyan cast, its south half in shade (dark and blue)."""
    tile = Tile("t", (0.0, 0.0, 100.0, 100.0), 25833, tmp_path / "raw", tmp_path / "data")
    rgb = np.zeros((3, 100, 100), np.uint8)
    rgb[:, :50] = _srgb8(0.35 * CYAN)[:, None, None]
    rgb[:, 50:] = _srgb8([0.03, 0.05, 0.11])[:, None, None]
    dop = tile.raw_raster("dop")
    dop.parent.mkdir(parents=True)
    with rasterio.open(
        dop,
        "w",
        driver="GTiff",
        width=100,
        height=100,
        count=3,
        dtype="uint8",
        crs="EPSG:25833",
        transform=tile.transform(100),
    ) as out:
        out.write(rgb)
    Image.fromarray(np.full((100, 100), dop_balance.ROAD, np.uint8)).save(
        tile.out("dlm", "landcover_t.png")
    )
    return tile


def test_a_cyan_flight_s_roads_are_taken_to_dresden_s_grey(tmp_path, monkeypatch):
    monkeypatch.setattr(dop_balance, "MIN_TEXELS", 100)
    tile = _tile(tmp_path)
    seen = dop_balance.cast([tile])
    assert np.allclose(seen, CYAN, atol=0.02)  # the sunlit half, not the shade
    k = dop_balance.gains([tile])
    road = 0.35 * seen
    after = road * k
    assert np.allclose(after / after[1], dop_balance.REF_ROAD, atol=0.01)
    assert abs(after.sum() - road.sum()) < 1e-3  # as bright as it was


def test_the_balance_is_kept_where_the_roads_cannot_be_read(tmp_path, monkeypatch):
    monkeypatch.setattr(dop_balance, "MIN_TEXELS", 6000)
    tile = _tile(tmp_path)  # 5 000 sunlit texels: too few
    assert np.array_equal(dop_balance.gains([tile]), np.ones(3))
    bare = Tile("u", (0.0, 0.0, 100.0, 100.0), 25833, tmp_path / "raw", tmp_path / "data")
    assert np.array_equal(dop_balance.gains([bare]), np.ones(3))  # no class raster


def test_the_table_scales_each_channel_in_linear_light():
    lut = dop_balance.table(np.array([1.0, 0.5, 1.2]))
    assert np.array_equal(lut[0], np.arange(256))
    v = np.arange(256, dtype=float)
    assert np.allclose(
        dop_balance.linear(lut[1].astype(float)), 0.5 * dop_balance.linear(v), atol=0.004
    )
    assert lut[2][255] == 255  # clipped, not wrapped
    rgb = np.full((2, 2, 3), 128, np.uint8)
    assert dop_balance.balanced(rgb, lut)[0, 0].tolist() == [128, lut[1][128], lut[2][128]]


def test_dresden_s_balance_is_taken_on_to_grey_roads_its_brightness_kept():
    road = np.asarray(dop_balance.REF_ROAD)
    after = road * dop_balance.neutral_gains()
    assert np.allclose(after / after[1], 1, atol=1e-3)
    assert abs(after.sum() - road.sum()) < 1e-3
