"""The cultivated-land bake (pipeline/bake/cultivated.py)."""

import math

import numpy as np
import pytest
import rasterio
import shapely

from bake.common import Tile
from bake.cultivated import (
    VINE_ROW_SPACING_M,
    axis_code,
    build,
    colony_raster,
    contour_angle,
    grid_trees,
    long_axis,
    parcels_of,
    vine_rows,
)


def _tile(tmp_path, slope_east: float = 0.0, slope_north: float = 0.0) -> Tile:
    """A 200 m tile whose DGM rises by the given gradients (m per m)."""
    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    tile.dgm.parent.mkdir(parents=True)
    cols = np.arange(200)[None, :] + 0.5
    rows = np.arange(200)[:, None] + 0.5  # row 0 = north
    z = (100 + slope_east * cols + slope_north * (200 - rows)).astype("float32")
    with rasterio.open(
        tile.dgm,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(200),
    ) as dst:
        dst.write(z, 1)
    return tile


def test_a_garden_mostly_inside_a_colony_is_one_of_its_parcels():
    colony = shapely.box(0, 0, 100, 50)
    plots = [shapely.box(x, 0, x + 10, 20) for x in range(0, 100, 10)]
    outside = shapely.box(200, 0, 210, 20)
    straddling = shapely.box(95, 0, 115, 20)  # a quarter inside
    assert len(parcels_of(colony, [*plots, outside, straddling])) == 10
    assert parcels_of(colony, [colony]) == []  # the colony itself is no parcel


def test_orchard_trees_stand_on_a_grid_along_the_long_axis():
    # 40 × 16 m, turned 30°
    o = shapely.affinity.rotate(shapely.box(0, 0, 40, 16), 30, origin=(0, 0))
    trees = grid_trees(o, spacing=8.0)
    assert abs(math.degrees(long_axis(o)) - 30) < 1e-6
    assert len(trees) == 10  # 5 along × 2 across
    inner = o.buffer(-3.9)
    assert all(inner.contains(shapely.Point(t)) for t in trees)
    # neighbours are 8 m apart along the axis or across it
    pts = np.array(trees)
    d = np.hypot(*(pts[:, None, :] - pts[None, :, :]).transpose(2, 0, 1))
    nearest = np.sort(d, axis=1)[:, 1]
    assert np.allclose(nearest, 8.0, atol=1e-6)


def test_vine_rows_run_along_the_contour_1_8_m_apart(tmp_path):
    # the slope rises to the north: rows run east–west
    tile = _tile(tmp_path, slope_north=0.2)
    vineyard = shapely.box(411050, 5656050, 411110, 5656100)
    angle = contour_angle(tile, vineyard)
    assert abs(math.sin(angle)) < 1e-6
    rows = vine_rows(vineyard, angle)
    # offsets (k + ½)·1.8 m about the middle that fit in ±25 m
    assert len(rows) == 2 * round(25 / VINE_ROW_SPACING_M)
    ys = sorted(r.coords[0][1] for r in rows)
    assert np.allclose(np.diff(ys), VINE_ROW_SPACING_M)
    assert all(abs(r.length - 60) < 1e-6 for r in rows)


def test_a_slope_to_the_east_turns_the_rows_north_south(tmp_path):
    tile = _tile(tmp_path, slope_east=0.15)
    angle = contour_angle(tile, shapely.box(411050, 5656050, 411110, 5656100))
    assert abs(math.cos(angle)) < 1e-6


def test_a_flat_vineyard_runs_along_its_long_axis(tmp_path):
    tile = _tile(tmp_path)
    v = shapely.box(411050, 5656050, 411070, 5656150)  # long north–south
    assert abs(math.cos(contour_angle(tile, v))) < 1e-6


def _metres(code: int) -> float:
    return (int(code) - 128) / 20.0


def test_the_colony_raster_holds_the_distance_to_the_garden_edge_and_the_axis(tmp_path):
    tile = _tile(tmp_path)
    x0, y0 = tile.bounds[:2]
    colony = shapely.box(x0 + 20, y0 + 20, x0 + 120, y0 + 60)  # long east–west
    path = shapely.buffer(shapely.LineString([(x0 + 70, y0), (x0 + 70, y0 + 200)]), 1.0)
    raster = colony_raster(tile, 200, [colony], [], [path], None)
    r, g = raster[..., 0], raster[..., 1]
    row = 200 - 40  # y = 40 m (texel centre 39.5 m)
    # texel centre x = 40.5 m: 20.5 m from the west edge, 19.5 m from the
    # south and north ones — past the ±6.35 m the byte holds
    assert r[row, 40] == 255
    # 2.5 m inside the west edge (x = 22.5 m), 1.5 m outside it
    assert _metres(r[row, 22]) == pytest.approx(2.5, abs=0.05)
    assert _metres(r[row, 18]) == pytest.approx(-1.5, abs=0.05)
    # the path's middle (x = 69.5–70.5 m): 0.5 m into the 2 m cut
    assert _metres(r[row, 69]) == pytest.approx(-0.5, abs=0.05)
    assert _metres(r[row, 72]) == pytest.approx(1.5, abs=0.05)
    assert r[row, 150] == 0  # far outside
    assert g[row, 40] == 1 + axis_code(0.0) == 1
    assert g[row, 69] == 1  # the axis carries across the path…
    assert g[row, 16] == 1  # …and a few metres out, where the edge fades
    assert g[row, 150] == 0


def test_the_edge_follows_a_diagonal_without_the_rasters_staircase(tmp_path):
    tile = _tile(tmp_path)
    x0, y0 = tile.bounds[:2]
    colony = shapely.Polygon([(x0 + 20, y0 + 20), (x0 + 180, y0 + 20), (x0 + 20, y0 + 180)])
    r = colony_raster(tile, 200, [colony], [], [], None)[..., 0]
    # along the hypotenuse x + y = 200 the distance is |x + y − 200| / √2
    cols = np.arange(60, 140)
    rows = 200 - (200 - cols)  # texel (col, row) centre: x = col + .5, y = 200 − row − .5
    for off in (-3, -1, 1, 3):
        d = np.array([_metres(r[rw - off, c]) for c, rw in zip(cols, rows, strict=True)])
        true = -(cols + 0.5 + (200 - (rows - off) - 0.5) - 200) / math.sqrt(2)
        assert np.abs(d - true).max() < 0.3


def test_a_mapped_parcel_takes_its_own_axis_and_a_seam_along_its_border(tmp_path):
    tile = _tile(tmp_path)
    x0, y0 = tile.bounds[:2]
    colony = shapely.box(x0 + 20, y0 + 20, x0 + 120, y0 + 60)
    plot = shapely.box(x0 + 30, y0 + 30, x0 + 40, y0 + 50)  # long north–south
    raster = colony_raster(tile, 200, [colony], [plot], [], None)
    r, g = raster[..., 0], raster[..., 1]
    assert g[200 - 40, 35] == 1 + axis_code(math.pi / 2)
    assert g[200 - 40, 60] == 1 + axis_code(0.0)
    # the seam: the garden edge 0.25 m either side of x = 30 m (to the
    # 0.5 m grid the distance is measured on)
    assert _metres(r[200 - 40, 29]) == pytest.approx(0.25, abs=0.3)
    assert _metres(r[200 - 40, 30]) < _metres(r[200 - 40, 29])
    assert _metres(r[200 - 40, 35]) > 4


def test_build_counts_colonies_and_plants_only_unmapped_orchards_on_the_grid(tmp_path):
    tile = _tile(tmp_path)
    x0, y0 = tile.bounds[:2]
    colony = shapely.box(x0 + 10, y0 + 10, x0 + 90, y0 + 90)
    orchard = shapely.box(x0 + 110, y0 + 110, x0 + 150, y0 + 130)
    mapped = shapely.box(x0 + 110, y0 + 150, x0 + 150, y0 + 170)
    tree = shapely.Point(x0 + 120, y0 + 160)
    feats, parts = build(
        tile,
        [colony, orchard, mapped],
        ["allotments", "orchard", "orchard"],
        [None, None, None],
        [tree],
        [],
    )
    kinds = [f["properties"]["k"] for f in feats]
    assert kinds.count("colony") == 1 and kinds.count("orchard") == 2
    trees = [f["properties"] for f in feats if f["properties"]["k"] == "tree"]
    assert sum(t["src"] == "osm" for t in trees) == 1
    assert sum(t["src"] == "grid" for t in trees) >= 2
    assert parts["stats"]["colonies"] == 1 and parts["stats"]["withParcels"] == 0
