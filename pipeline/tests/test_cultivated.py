"""The cultivated-land bake (pipeline/bake/cultivated.py)."""

import math

import numpy as np
import pytest
import rasterio
import shapely

from bake.common import Tile
from bake.cultivated import (
    ORCHARD_TREE_H,
    VINE_ROW_SPACING_M,
    axis_code,
    build,
    colony_raster,
    crown_peaks,
    dop_rows,
    grid_trees,
    long_axis,
    orchard_genus,
    parcels_of,
    path_axis,
    slope_layout,
    vine_layout,
    vine_rows,
    window_wave,
)
from tests.synthetic import SIZE, X0, Y0, crowns, write_raster


def _tile(
    tmp_path, slope_east: float = 0.0, slope_north: float = 0.0, tid: str = "t", dx: float = 0.0
) -> Tile:
    """A 200 m tile whose DGM rises by the given gradients (m per m)."""
    x0, y0 = 411000.0 + dx, 5656000.0
    tile = Tile(tid, (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
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


def test_vine_rows_run_along_a_steep_contour_vine_row_spacing_apart(tmp_path):
    # the slope rises steeply to the north: rows run east–west
    tile = _tile(tmp_path, slope_north=0.4)
    vineyard = shapely.box(411050, 5656050, 411110, 5656100)
    angle, src = slope_layout(tile, vineyard)
    assert abs(math.sin(angle)) < 1e-6 and src == "contour"
    rows = vine_rows(vineyard, angle)
    # offsets (k + ½)·2.3 m about the middle that fit in ±25 m
    assert len(rows) == 2 * round(25 / VINE_ROW_SPACING_M)
    ys = sorted(r.coords[0][1] for r in rows)
    assert np.allclose(np.diff(ys), VINE_ROW_SPACING_M)
    assert all(abs(r.length - 60) < 1e-6 for r in rows)


def test_a_steep_slope_to_the_east_turns_the_rows_north_south(tmp_path):
    tile = _tile(tmp_path, slope_east=0.3)
    angle, src = slope_layout(tile, shapely.box(411050, 5656050, 411110, 5656100))
    assert abs(math.cos(angle)) < 1e-6 and src == "contour"


def test_on_a_gentle_slope_the_rows_run_down_the_fall_line(tmp_path):
    # 15–20 %: Meißen's rows at 3–12 % run downhill, not along the contour
    tile = _tile(tmp_path, slope_north=0.2)
    angle, src = slope_layout(tile, shapely.box(411050, 5656050, 411110, 5656100))
    assert abs(math.cos(angle)) < 1e-6 and src == "fall"
    tile = _tile(tmp_path / "e", slope_east=0.15)
    angle, src = slope_layout(tile, shapely.box(411050, 5656050, 411110, 5656100))
    assert abs(math.sin(angle)) < 1e-6 and src == "fall"


def test_a_flat_vineyard_runs_along_its_long_axis(tmp_path):
    tile = _tile(tmp_path)
    v = shapely.box(411050, 5656050, 411070, 5656150)  # long north–south
    angle, src = slope_layout(tile, v)
    assert abs(math.cos(angle)) < 1e-6 and src == "axis"


def test_a_vineyard_across_a_seam_gets_one_angle_on_both_tiles(tmp_path):
    # west tile rises north, east tile north and twice as steeply east (the
    # surface continuous across the seam): the angle is the whole
    # polygon's, the same from either side (this tile's DGM alone kinked it)
    west = _tile(tmp_path, slope_north=0.2)
    east = _tile(tmp_path, slope_east=0.4, slope_north=0.2, tid="u", dx=200)
    v = shapely.box(411150, 5656050, 411250, 5656100)
    (a, src), (b, _) = slope_layout(west, v), slope_layout(east, v)
    assert a == pytest.approx(b, abs=1e-9) and src == "contour"
    # mean gradient (0.2, 0.2), 28 %: the rows run along the diagonal (135°), not
    # 0° on the west tile and 117° on the east one
    assert math.degrees(a) == pytest.approx(135, abs=2)


def test_a_measured_tree_takes_an_orchard_trees_place(tmp_path):
    tile = _tile(tmp_path)
    x0, y0 = tile.bounds[:2]
    orchard = shapely.box(x0 + 110, y0 + 110, x0 + 150, y0 + 130)
    free, _ = build(tile, [orchard], ["orchard"], [None], [], [])
    spots = [f["geometry"]["coordinates"] for f in free if f["properties"]["k"] == "tree"]
    near = [spots[0][0] + 2.0, spots[0][1]]  # a canopy crown 2 m off the first
    wide = [spots[-1][0] + 6.0, spots[-1][1]]  # a 7 m crown 6 m off the last
    measured = (np.array([near, wide]), np.array([0.0, 7.0]))
    feats, parts = build(tile, [orchard], ["orchard"], [None], [], [], measured)
    kept = [f["geometry"]["coordinates"] for f in feats if f["properties"]["k"] == "tree"]
    assert len(kept) == len(spots) - 2
    assert spots[0] not in kept and spots[-1] not in kept
    assert parts["stats"]["orchardTrees"] == len(kept)


def test_measured_trees_are_read_across_the_seam(tmp_path):
    from bake.common import write_geojson
    from bake.cultivated import measured_trees

    west = _tile(tmp_path)
    _tile(tmp_path, tid="u", dx=200)
    point = {"type": "Point", "coordinates": [411205.0, 5656100.0]}
    write_geojson(
        west.out("dlm", "canopyx_u.geojson"),
        [{"type": "Feature", "properties": {"h": 9, "r": 3}, "geometry": point}],
        25833,
    )
    xy, r = measured_trees(west, (410980, 5655980, 411220, 5656220))
    assert xy.tolist() == [[411205.0, 5656100.0]] and r.tolist() == [3.0]


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


# ---- P21: orchard trees ---------------------------------------------------


def test_crown_peaks_keep_the_fruit_trees_heights():
    ndom = crowns(
        [
            (X0 + 50.5, Y0 + 150.5, 4.0),
            (X0 + 60.5, Y0 + 150.5, 7.5),
            (X0 + 70.5, Y0 + 150.5, 15.0),  # a poplar: the canopy's
            (X0 + 80.5, Y0 + 150.5, 1.2),  # a bush
        ]
    )
    peaks = crown_peaks(ndom, np.ones(ndom.shape, bool))
    assert sorted((c, round(h, 1)) for _, c, h in peaks) == [(50, 4.0), (60, 7.5)]


def _orchard_tile(tmp_path, spots) -> Tile:
    tile = _tile(tmp_path)
    write_raster(tile.raw_raster("dom1"), (100 + crowns(spots)).astype("float32"))
    return tile


def test_an_orchards_trees_stand_where_dom1_shows_them(tmp_path):
    spots = [(X0 + 110.5 + 6 * i, Y0 + 120.5, 3.0 + i) for i in range(6)]
    tile = _orchard_tile(tmp_path, [*spots, (X0 + 30.5, Y0 + 30.5, 5.0)])
    orchard = shapely.box(X0 + 100, Y0 + 110, X0 + 150, Y0 + 130)
    built = np.zeros((SIZE, SIZE), bool)
    built[70:90, 120:131] = True  # a shed's roof over the crowns at x = 122.5, 128.5
    feats, parts = build(
        tile, [orchard], ["orchard"], [None], [], [], tags=['"trees"=>"apple_trees"'], built=built
    )
    trees = [f for f in feats if f["properties"]["k"] == "tree"]
    got = sorted((f["geometry"]["coordinates"][0], f["properties"]["h"]) for f in trees)
    want = [(X0 + 110.5 + 6 * i, 3.0 + i) for i in (0, 1, 4, 5)]
    assert got == [(pytest.approx(x, abs=0.05), pytest.approx(h, abs=0.05)) for x, h in want]
    p = trees[0]["properties"]
    assert p["src"] == "dom" and p["g"] == "Malus" and "l" not in p
    # the crowns by the trees' heights: 3, 4, 7 and 8 m
    widths = sorted(f["properties"]["d"] for f in trees)
    assert widths == pytest.approx([2.55, 3.4, 5.95, 6.8], abs=0.05)
    assert parts["stats"]["orchardTrees"] == 4


def test_an_orchard_dom1_shows_no_tree_in_gets_none(tmp_path):
    # Dresden's rail-embankment "orchard": four trees on the grid, none there
    tile = _orchard_tile(tmp_path, [])
    orchard = shapely.box(X0 + 100, Y0 + 110, X0 + 150, Y0 + 130)
    built = np.zeros((SIZE, SIZE), bool)
    feats, _ = build(tile, [orchard], ["orchard"], [None], [], [], built=built)
    assert not [f for f in feats if f["properties"]["k"] == "tree"]
    # without DOM1 it is still the grid
    feats, _ = build(tile, [orchard], ["orchard"], [None], [], [])
    trees = [f["properties"] for f in feats if f["properties"]["k"] == "tree"]
    assert trees and all(t["src"] == "grid" and t["h"] == ORCHARD_TREE_H for t in trees)


def test_an_orchards_genus_is_its_trees_tag():
    assert orchard_genus('"trees"=>"apple_trees"') == "Malus"
    assert orchard_genus('"trees"=>"plum_trees;apple_trees"') == "Prunus"
    assert orchard_genus('"trees"=>"pear_trees"') == "Pyrus"
    assert orchard_genus('"trees"=>"christmas_trees"') == "conifer"
    assert orchard_genus('"trees"=>"olive_trees"') is None
    # no `trees=*`: what it produces (Dresden's: "apple;strawberry;cherry")
    assert orchard_genus('"produce"=>"strawberry;cherry;apple"') == "Prunus"
    assert orchard_genus('"trees"=>"pear_trees","produce"=>"apple"') == "Pyrus"
    assert orchard_genus(None) is None


def test_a_christmas_tree_plantation_is_evergreen(tmp_path):
    tile = _tile(tmp_path)
    orchard = shapely.box(X0 + 100, Y0 + 110, X0 + 150, Y0 + 130)
    tags = ['"trees"=>"christmas_trees"']
    feats, _ = build(tile, [orchard], ["orchard"], [None], [], [], tags=tags)
    trees = [f["properties"] for f in feats if f["properties"]["k"] == "tree"]
    assert trees and all(t["l"] == "e" and "g" not in t for t in trees)


# ---- P22: vine rows ---------------------------------------------------------


def _stripes(shape, res: float, angle_deg: float, period: float, x0=0.0, y0=0.0) -> np.ndarray:
    """Rows at `angle_deg` from east, `period` m apart (north up)."""
    rows, cols = np.indices(shape)
    x = x0 + (cols + 0.5) * res
    y = y0 - (rows + 0.5) * res
    a = math.radians(angle_deg)
    across = -x * math.sin(a) + y * math.cos(a)
    return 120 + 60 * np.cos(2 * math.pi * across / period)


@pytest.mark.parametrize(("angle", "period"), [(30.0, 2.4), (100.0, 2.2), (0.0, 3.0)])
def test_a_windows_wave_gives_the_rows_direction_and_spacing(angle, period):
    rng = np.random.default_rng(1)
    patch = _stripes((200, 200), 0.2, angle, period) + rng.normal(0, 20, (200, 200))
    found = window_wave(patch, 0.2)
    assert found is not None
    a, s, _ = found
    off = (math.degrees(a) - angle + 90) % 180 - 90
    assert abs(off) < 2.0
    assert s == pytest.approx(period, abs=0.08)


def test_a_window_without_rows_shows_no_wave():
    rng = np.random.default_rng(2)
    assert window_wave(rng.normal(120, 20, (200, 200)), 0.2) is None
    assert window_wave(np.full((200, 200), np.nan), 0.2) is None


def _dop(tile: Tile, grey: np.ndarray) -> None:
    band = np.clip(grey, 0, 255).astype("uint8")
    write_raster(tile.raw / "dop" / f"{tile.id}.tif", np.stack([band, band, band]), res=0.2)


def test_a_vineyards_rows_are_the_orthophotos(tmp_path):
    # a steep slope, whose contour runs east–west: the photo's rows at 75°,
    # 2.5 m apart, win over it
    tile = _tile(tmp_path, slope_north=0.4)
    n = round(SIZE / 0.2)
    _dop(tile, _stripes((n, n), 0.2, 75.0, 2.5, X0, Y0 + SIZE))
    v = shapely.box(X0 + 40, Y0 + 40, X0 + 160, Y0 + 130)
    angle, gap, src = vine_layout(tile, v)
    assert src == "dop"
    assert math.degrees(angle) == pytest.approx(75, abs=1.5)
    assert gap == pytest.approx(2.5, abs=0.08)
    feats, parts = build(tile, [v], ["vineyard"], [None], [], [])
    vineyard = next(f for f in feats if f["properties"]["k"] == "vineyard")["properties"]
    assert vineyard["src"] == "dop" and vineyard["dir"] == pytest.approx(75, abs=1.5)
    assert parts["stats"]["vineFrom"] == {"dop": 1}


def test_a_vineyard_without_rows_in_the_photo_takes_the_slopes(tmp_path):
    tile = _tile(tmp_path, slope_north=0.4)
    n = round(SIZE / 0.2)
    _dop(tile, np.random.default_rng(3).normal(120, 15, (n, n)))
    v = shapely.box(X0 + 40, Y0 + 40, X0 + 160, Y0 + 130)
    assert dop_rows(tile, v) is None
    angle, gap, src = vine_layout(tile, v)
    assert src == "contour" and abs(math.sin(angle)) < 1e-6 and gap == VINE_ROW_SPACING_M


def test_the_windows_that_agree_outvote_a_corner_planted_across(tmp_path):
    tile = _tile(tmp_path)
    n = round(SIZE / 0.2)
    grey = _stripes((n, n), 0.2, 20.0, 2.3, X0, Y0 + SIZE)
    # the vineyard's western fifth planted at 110°
    grey[:, : n // 5] = _stripes((n, n // 5), 0.2, 110.0, 2.3, X0, Y0 + SIZE)
    _dop(tile, grey)
    v = shapely.box(X0, Y0 + 20, X0 + SIZE, Y0 + 180)
    angle, gap = dop_rows(tile, v)
    assert math.degrees(angle) == pytest.approx(20, abs=1.5)
    assert gap == pytest.approx(2.3, abs=0.08)


# ---- P23: the colonies' plots ---------------------------------------------


def test_a_colonys_plots_follow_its_paths_not_its_long_axis():
    colony = shapely.box(0, 0, 200, 80)  # long east–west
    # the access paths run north–south (a little off), one main path across
    paths = [shapely.LineString([(x, -5), (x + 3, 85)]) for x in (30, 70, 110, 150)]
    paths.append(shapely.LineString([(0, 40), (200, 40)]))
    a = path_axis(colony, paths)
    assert math.degrees(a) == pytest.approx(math.degrees(math.atan2(90, 3)), abs=0.5)


def test_a_colony_with_few_mapped_paths_keeps_its_long_axis(tmp_path):
    colony = shapely.box(0, 0, 200, 80)
    assert path_axis(colony, [shapely.LineString([(30, 0), (30, 30)])]) is None
    assert path_axis(colony, []) is None
    tile = _tile(tmp_path)
    c = shapely.box(X0 + 20, Y0 + 20, X0 + 120, Y0 + 60)
    g = colony_raster(tile, 200, [c], [], [], None, [math.pi / 2])[..., 1]
    assert g[200 - 40, 60] == 1 + axis_code(math.pi / 2)
    g = colony_raster(tile, 200, [c], [], [], None, [None])[..., 1]
    assert g[200 - 40, 60] == 1 + axis_code(0.0)


def test_build_hands_the_colonies_path_axes_to_the_raster(tmp_path):
    tile = _tile(tmp_path)
    colony = shapely.box(X0 + 10, Y0 + 10, X0 + 190, Y0 + 70)
    lines = [shapely.LineString([(X0 + x, Y0), (X0 + x, Y0 + 80)]) for x in (50, 100, 150)]
    _, parts = build(tile, [colony], ["allotments"], [None], [], [], path_lines=lines)
    assert parts["axes"] == [pytest.approx(math.pi / 2)]
    assert parts["stats"]["pathAxes"] == 1


def test_a_terraces_walls_tell_the_rows_direction_not_their_spacing():
    # bright walls 0.6 m wide every 13 m along 150°: their harmonics fill
    # the band, none stands alone
    rows, cols = np.indices((200, 200))
    x, y = (cols + 0.5) * 0.2, -(rows + 0.5) * 0.2
    a = math.radians(150)
    across = (-x * math.sin(a) + y * math.cos(a)) % 13.0
    patch = 100 + 120 * (across < 0.6) + np.random.default_rng(4).normal(0, 5, (200, 200))
    found = window_wave(patch, 0.2)
    assert found is not None
    angle, spacing, _ = found
    assert abs((math.degrees(angle) - 150 + 90) % 180 - 90) < 2
    assert spacing is None
