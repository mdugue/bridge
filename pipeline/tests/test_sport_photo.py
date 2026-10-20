"""An untagged sports ground takes the surface the orthophoto shows: green
and growing is grass, green and not growing artificial turf, pink-red
tartan, orange clay or cinder, grey or blue a hard court. A tagged
surface stays."""

from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image

from bake import sport
from bake.dop_balance import linear
from tests.synthetic import SIZE, osm_tile, way


def lin(*srgb: int) -> np.ndarray:
    return linear(np.array(srgb, np.float32))


# Dresden's measured medians (sRGB) and calibrated NDVI
def test_the_photo_tells_the_surface():
    turf = lin(61, 106, 90)
    assert sport.photo_surface(lin(59, 96, 74), 0.57, True, "soccer") == 1  # grass
    assert sport.photo_surface(turf, 0.0, True, "soccer") == 2
    assert sport.photo_surface(turf, 0.0, False, "soccer") is None  # no infrared
    assert sport.photo_surface(lin(196, 110, 106), 0.0, True, "soccer") == 3  # tartan
    assert sport.photo_surface(lin(219, 169, 131), 0.0, True, "tennis") == 4  # clay
    assert sport.photo_surface(lin(174, 141, 120), 0.0, True, "soccer") == 7  # cinder
    assert sport.photo_surface(lin(191, 187, 180), 0.0, True, "soccer") == 6  # asphalt
    assert sport.photo_surface(lin(73, 124, 155), 0.0, True, "basketball") == 6  # blue coat
    assert sport.photo_surface(lin(170, 150, 128), 0.0, True, "tennis") == 4  # earth: clay


def test_a_sand_ground_only_turns_grass():
    sand = lin(226, 219, 207)
    assert sport.photo_surface(sand, 0.0, True, "equestrian") is None
    assert sport.photo_surface(lin(106, 125, 116), 0.38, True, "equestrian") == 1


def _tile(tmp_path, monkeypatch, shade: bool = False):
    """Two 60 × 40 m football pitches side by side, the west one untagged,
    the east one tagged grass; the photo shows red rubber on both."""
    nodes = {
        1: (20, 80, ""),
        2: (80, 80, ""),
        3: (80, 120, ""),
        4: (20, 120, ""),
        5: (110, 80, ""),
        6: (170, 80, ""),
        7: (170, 120, ""),
        8: (110, 120, ""),
    }
    ways = way(1, [1, 2, 3, 4, 1], {"leisure": "pitch", "sport": "soccer"}) + way(
        2, [5, 6, 7, 8, 5], {"leisure": "pitch", "sport": "soccer", "surface": "grass"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    rgb = np.zeros((3, SIZE, SIZE), np.uint8)
    rgb[:] = np.array([196, 110, 106] if not shade else [30, 40, 70])[:, None, None]
    path = tile.raw_raster("dop")
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=3,
        dtype="uint8",
        crs="EPSG:25833",
        transform=tile.transform(SIZE),
    ) as dst:
        dst.write(rgb)
    Image.fromarray(np.zeros((100, 100), np.uint8)).save(tile.out("dlm", "ndvi_t.png"))
    return tile


def _surfaces(tile) -> list[int]:
    table = json.loads(tile.out("dlm", "sport_t.json").read_text())
    return sorted((round(r[0]), r[6]) for r in table["grounds"])


def test_an_untagged_pitch_takes_the_photo_s_surface_a_tagged_one_its_tag(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    sport.run(tile)
    assert _surfaces(tile) == [(50, 3), (140, 1)]  # the west one tartan


def test_a_pitch_in_shade_keeps_its_sport_s_default(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch, shade=True)
    sport.run(tile)
    assert _surfaces(tile) == [(50, 1), (140, 1)]
