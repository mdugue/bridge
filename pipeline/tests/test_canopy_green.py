"""Without a laser scan the canopy also takes the crowns outside the
vegetation mask: green in the orthophoto, rough in the surface model, and
off every LoD2 outline — not a lawn, a green roof or a grey scrap yard."""

from __future__ import annotations

import dataclasses
import json

import numpy as np
import rasterio

from bake.canopy import built_mask, green_mask, rough_mask
from bake.common import Products, Tile
from tests.synthetic import SIZE, X0, Y0


def _raster(tile: Tile, path, bands: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=bands.shape[0],
        dtype=bands.dtype,
        crs="EPSG:25833",
        transform=tile.transform(SIZE),
    ) as dst:
        dst.write(bands)


def _tile(tmp_path, lsc: bool = False) -> tuple[Tile, np.ndarray]:
    """A 200 m tile, row 0 = north: a crown, a lawn, a green roof on a
    building and a grey yard of rough clutter."""
    tile = Tile(
        "t",
        (X0, Y0, X0 + SIZE, Y0 + SIZE),
        25833,
        tmp_path / "raw",
        tmp_path / "data",
        products=Products(dom=True, dop="rgbi", dlm=False, lsc=lsc),
    )
    rng = np.random.default_rng(0)
    dom = np.full((SIZE, SIZE), 100.0)
    red, nir = np.full((SIZE, SIZE), 60, np.uint8), np.full((SIZE, SIZE), 60, np.uint8)

    def at(x0, y0, x1, y1):
        return np.s_[SIZE - y1 : SIZE - y0, x0:x1]

    crown, lawn, roof, yard = (
        at(20, 20, 40, 40),
        at(60, 20, 80, 40),
        at(20, 60, 40, 80),
        at(60, 60, 80, 80),
    )
    for patch in (crown, roof, yard):
        dom[patch] = 110.0 + rng.normal(0.0, 1.5, dom[patch].shape)
    for patch in (crown, lawn, roof):
        red[patch], nir[patch] = 40, 200
    _raster(tile, tile.raw_raster("dop"), np.stack([red, red, red, nir]))
    # the building under the green roof, one LoD2 ring over its outline
    tile.cityjson.parent.mkdir(parents=True, exist_ok=True)
    ring = [
        (X0 + 20, Y0 + 60, 110),
        (X0 + 40, Y0 + 60, 110),
        (X0 + 40, Y0 + 80, 110),
        (X0 + 20, Y0 + 80, 110),
    ]
    tile.cityjson.write_text(
        json.dumps(
            {
                "type": "CityJSON",
                "transform": {"scale": [1, 1, 1], "translate": [0, 0, 0]},
                "vertices": [list(v) for v in ring],
                "CityObjects": {
                    "b": {
                        "type": "Building",
                        "geometry": [{"type": "MultiSurface", "boundaries": [[[0, 1, 2, 3]]]}],
                    }
                },
            }
        )
    )
    return tile, dom


def _green(tile: Tile, dom: np.ndarray) -> np.ndarray:
    return green_mask(tile, rough_mask(dom), built_mask(tile, SIZE))


def test_a_green_rough_crown_off_any_building_is_canopy(tmp_path):
    tile, dom = _tile(tmp_path)
    mask = _green(tile, dom)
    assert mask[SIZE - 30, 30]  # the crown
    assert not mask[SIZE - 30, 70]  # the lawn: green, but smooth
    assert not mask[SIZE - 70, 30]  # the green roof: on a building
    assert not mask[SIZE - 70, 70]  # the yard: rough, but grey


def test_a_provider_with_a_laser_scan_leaves_it_to_the_scan(tmp_path):
    tile, dom = _tile(tmp_path, lsc=True)
    assert not _green(tile, dom).any()
    plain = dataclasses.replace(tile, products=Products(dom=True, dop="rgbi", dlm=False))
    tile.raw_raster("dop").unlink()
    assert not _green(plain, dom).any()  # nor without an orthophoto
