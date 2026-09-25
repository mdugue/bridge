"""The sky-view factor and far-horizon bake (pipeline/bake/skyview.py)."""

import json
import math

import numpy as np
import rasterio

from bake.common import Tile
from bake.skyview import (
    AZIMUTHS,
    Field,
    Roofs,
    burn_triangles,
    far_horizon,
    fields,
    horizon_tan,
    pack_horizon,
    site_sources,
    sky_view,
    surface_triangles,
)


def test_a_flat_field_sees_the_whole_sky_and_no_horizon():
    ground = np.full((60, 60), 100.0, np.float32)
    svf = sky_view(ground, ground, 20, 2.0, reach_m=40)
    assert svf.shape == (20, 20)
    assert np.allclose(svf, 1.0)
    angles = far_horizon(ground, ground, 20, 2.0, near_m=4, far_m=40)
    assert angles.shape == (AZIMUTHS, 20, 20)
    assert np.all(angles == 0)


def test_a_block_raises_the_horizon_by_its_angle_in_its_direction_only():
    res = 2.0
    ground = np.full((101, 101), 100.0, np.float32)
    surface = ground.copy()
    # a 20 m block 40 m east of the centre cell (row 50, col 50)
    surface[45:56, 70:73] = 120.0
    margin = 40
    east = horizon_tan(ground, surface, margin, res, 90.0, res, 80.0)
    west = horizon_tan(ground, surface, margin, res, 270.0, res, 80.0)
    c = 50 - margin
    assert math.degrees(math.atan(east[c, c])) == np.float32(math.degrees(math.atan(20 / 40)))
    assert west[c, c] == 0
    # the far horizon ignores what is nearer than its near distance
    near_only = horizon_tan(ground, surface, margin, res, 90.0, 50.0, 80.0)
    assert near_only[c, c] == 0


def test_the_sky_view_at_the_foot_of_a_long_wall_is_about_a_half():
    res = 1.0
    ground = np.zeros((401, 401), np.float32)
    surface = ground.copy()
    surface[:, 201:] = 1000.0  # a very tall wall along the east side
    svf = sky_view(ground, surface, 150, res, reach_m=150)
    # the ground cell next to the wall: the east half of the sky is gone
    assert 0.45 < svf[50, 50] < 0.6


def test_an_l_shaped_roof_burns_its_l_not_its_hull():
    # 10 × 10 m, the north-east quarter cut away, flat at 20 m
    ring = np.array(
        [[0, 0, 20], [10, 0, 20], [10, 5, 20], [5, 5, 20], [5, 10, 20], [0, 10, 20]], float
    )
    wall = np.array([[0, 0, 0], [10, 0, 0], [10, 0, 20], [0, 0, 20]], float)
    tris = surface_triangles([ring, wall])
    assert len(tris) == 4  # the wall is vertical: nothing to burn
    heights = burn_triangles(Field((0, 0, 10, 10), 1.0), tris)
    assert np.isnan(heights[2, 7])  # the cut-away quarter (row 0 = north)
    assert heights[7, 2] == 20.0 and heights[2, 2] == 20.0 and heights[7, 7] == 20.0


def test_a_sloped_roof_is_burned_on_its_plane():
    # rises 1 m per metre eastward from 10 m
    ring = np.array([[0, 0, 10], [10, 0, 20], [10, 10, 20], [0, 10, 10]], float)
    heights = burn_triangles(Field((0, 0, 10, 10), 1.0), surface_triangles([ring]))
    assert np.allclose(heights[5], 10.5 + np.arange(10))


def test_the_horizon_packs_four_azimuths_per_texel_in_four_planes():
    n = 3
    angles = np.stack([np.full((n, n), float(k)) for k in range(16)]) * (45.0 / 255.0)
    grey = pack_horizon(angles)
    assert grey.shape == (4 * n, 4 * n)
    # plane p (rows p·n …), texel (r, c), channel k → azimuth 4p + k
    assert list(grey[n + 1, 4 * 2 : 4 * 2 + 4]) == [4, 5, 6, 7]
    assert list(grey[3 * n, 0:4]) == [12, 13, 14, 15]


def _dgm(tile: Tile, tid: str, x0: float, y0: float, size: int, z: float) -> None:
    path = tile.data / "dgm" / f"dgm1_{tid}_tiff" / f"dgm1_{tid}.tif"
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=size,
        height=size,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=rasterio.transform.from_origin(x0, y0 + size, 1.0, 1.0),
    ) as dst:
        dst.write(np.full((size, size), z, np.float32), 1)


def _cityjson(tile: Tile, tid: str, x0: float, y0: float, x1: float, y1: float, z: float):
    path = tile.data / "cityjson" / f"lod2_{tid}.city.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "transform": {"scale": [1, 1, 1], "translate": [0, 0, 0]},
        "vertices": [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
        "CityObjects": {"b": {"type": "Building", "geometry": [{"boundaries": [[0, 1, 2, 3]]}]}},
    }
    path.write_text(json.dumps(doc))


def test_the_neighbour_tile_fills_the_margin_across_the_seam(tmp_path):
    tile = Tile("a", (0.0, 0.0, 200.0, 200.0), 25833, tmp_path / "raw", tmp_path / "data")
    _dgm(tile, "a", 0, 0, 200, 100.0)
    _dgm(tile, "b", 200, 0, 200, 100.0)
    # a 50 m block on the neighbour, 20 m past the seam
    _cityjson(tile, "b", 220, 80, 240, 120, 150.0)
    roofs = Roofs(tile, site_sources(tile))
    assert {tid for tid, _ in roofs.sources} == {"a", "b"}
    ground, surface, margin = fields(tile, 100, 60.0, roofs)
    res = 2.0
    east = horizon_tan(ground, surface, margin, res, 90.0, res, 60.0)
    # the cell at the seam's west side, mid-height: the block is ~20–21 m east
    angle = math.degrees(math.atan(east[50, 99]))
    assert 65 < angle < 70
    # beyond the site the ground is open, at the tile edge's height
    assert np.all(ground[:, : margin - 1] == 100.0)
