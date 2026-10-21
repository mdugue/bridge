"""The QA round's crowns (P7, P21, P22, P23): the tree rows' trees at DOM1's
crown peaks (canopy.py), the orchards' at theirs, the vineyards' rows as the
orthophoto shows them and the colonies' plots along their paths
(cultivated.py)."""

import json
import math

import numpy as np
import pytest
import rasterio
import shapely

from bake import canopy
from bake.common import Tile
from bake.cultivated import (
    ORCHARD_TREE_H,
    VINE_ROW_SPACING_M,
    axis_code,
    build,
    colony_raster,
    crown_peaks,
    dop_rows,
    orchard_genus,
    path_axis,
    vine_layout,
    window_wave,
)

X0, Y0, SIZE = 411000.0, 5656000.0, 200


def _write(path, data: np.ndarray, res: float = 1.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bands = data[None] if data.ndim == 2 else data
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=bands.shape[2],
        height=bands.shape[1],
        count=bands.shape[0],
        dtype=bands.dtype,
        crs="EPSG:25833",
        transform=rasterio.transform.from_origin(X0, Y0 + SIZE, res, res),
    ) as dst:
        dst.write(bands)


def _tile(tmp_path, slope_north: float = 0.0) -> Tile:
    """A flat (or north-rising) 200 m tile with its DGM at 100 m."""
    tile = Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")
    rows = np.arange(SIZE)[:, None] + 0.5
    z = 100 + slope_north * (SIZE - rows) + np.zeros((1, SIZE))
    _write(tile.dgm, z.astype("float32"))
    return tile


def _crowns(spots: list[tuple[float, float, float]], radius: float = 2.0) -> np.ndarray:
    """An nDOM of round crowns (x, y, height in EPSG metres) on the tile's
    1 m grid."""
    cx = X0 + np.arange(SIZE) + 0.5
    cy = Y0 + SIZE - np.arange(SIZE) - 0.5
    gx, gy = np.meshgrid(cx, cy)
    out = np.zeros((SIZE, SIZE))
    for x, y, h in spots:
        out = np.maximum(out, h * np.clip(1 - np.hypot(gx - x, gy - y) / (2 * radius), 0, 1))
    return out


# ---- P7: the tree rows' trees -------------------------------------------


def test_thinning_keeps_the_tallest_and_drops_its_neighbours():
    xy = np.array([[0.0, 0.0], [2.0, 0.0], [5.0, 0.0], [6.5, 0.0]])
    tops = np.array([8.0, 12.0, 9.0, 10.0])
    # 12 m at 2 drops 0 (2 m off); 10 m at 6.5 drops 5 (1.5 m off)
    assert canopy.thinned(xy, tops, 3.0).tolist() == [1, 3]


def _rows(tile: Tile, line: list[tuple[float, float]]) -> None:
    path = tile.out("dlm", f"vegrows_{tile.id}.geojson")
    feats = [
        {"type": "Feature", "properties": {"kind": kind}, "geometry": geom}
        for kind, geom in (
            ("treerow", {"type": "LineString", "coordinates": line}),
            # a hedge is no tree row
            (
                "hedge",
                {"type": "LineString", "coordinates": [[X0 + 10, Y0 + 40], [X0 + 190, Y0 + 40]]},
            ),
        )
    ]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))


def test_a_rows_trees_stand_at_its_crown_peaks_as_tall_as_measured(tmp_path):
    tile = _tile(tmp_path)
    y = Y0 + 100
    _rows(tile, [(X0 + 20, y), (X0 + 180, y)])
    # crowns every 10 m, 1 m off the line, 8–16 m tall; one 9 m off it
    # (another row's), one beside the canopy's crown, one on the hedge
    spots = [(X0 + 30.5 + 10 * i, y + 1.5, 8.0 + i) for i in range(9)]
    ndom = _crowns([*spots, (X0 + 60.5, y + 9.5, 14.0), (X0 + 100.5, Y0 + 40.5, 10.0)])
    taken = np.array([[X0 + 72.0, y + 2.0]])  # 2–3 m from the crown at x = 70
    xy, tops, n = canopy.row_trees(tile, ndom, ndom > 0, taken)
    assert n == 1
    xs = sorted(float(x) for x in xy[:, 0])
    assert xs == pytest.approx([X0 + 30.5 + 10 * i for i in range(9) if i != 4], abs=0.01)
    assert np.allclose(xy[:, 1], y)  # on the line
    assert sorted(tops.tolist()) == pytest.approx([8.0 + i for i in range(9) if i != 4], abs=0.6)


def test_without_tree_rows_there_are_no_row_trees(tmp_path):
    tile = _tile(tmp_path)
    xy, tops, n = canopy.row_trees(tile, np.zeros((SIZE, SIZE)), np.ones((SIZE, SIZE), bool), [])
    assert (len(xy), len(tops), n) == (0, 0, 0)


def test_a_tree_by_a_carriageway_reaches_over_it(tmp_path, monkeypatch):
    tile = _tile(tmp_path)
    lane = shapely.box(X0 + 100, Y0, X0 + 106, Y0 + SIZE)
    monkeypatch.setattr(canopy.ways, "carriageways", lambda _tile: [lane])
    rows = np.array([100, 100, 100])
    # 2.5 m, 6.5 m and 20 m from the lane's west edge (x = 100)
    cols = np.array([97, 93, 80])
    tops = np.array([10.0, 10.0, 30.0])
    # reach: 0.29 · h + 0.5 → 3.4 m, 3.4 m, 9.2 m
    assert canopy.over_carriageway(tile, rows, cols, tops, SIZE).tolist() == [True, False, False]


# ---- P21: orchard trees ---------------------------------------------------


def test_crown_peaks_keep_the_fruit_trees_heights():
    ndom = _crowns(
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
    _write(tile.raw_raster("dom1"), (100 + _crowns(spots)).astype("float32"))
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
    assert p["d"] == pytest.approx(min(max(0.85 * p["h"], 2.0), 9.0), abs=0.05)
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
    _write(tile.raw / "dop" / f"{tile.id}.tif", np.stack([band, band, band]), res=0.2)


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


def test_a_committed_scan_tree_a_new_tree_stands_on_is_dropped(tmp_path):
    # a tile without its laser scan keeps its scan trees, but one the trees
    # step now places a tree on goes, as lowveg's own thinning drops it
    from bake.common import write_geojson
    from bake.lowveg import rethin_scan_trees

    tile = Tile("t", (0.0, 0.0, 200.0, 200.0), 25833, tmp_path / "raw", tmp_path / "data")
    assert rethin_scan_trees(tile) is None

    def point(x, y, **props):
        geometry = {"type": "Point", "coordinates": [x, y]}
        return {"type": "Feature", "properties": props, "geometry": geometry}

    dlm = tmp_path / "data" / "dlm"
    scan = [point(10, 10, h=12, r=3), point(50, 50, h=9, r=2), point(120, 80, h=15, r=4)]
    write_geojson(tile.out("dlm", "canopyx_t.geojson"), scan, 25833, "scan credit")
    write_geojson(tile.out("dlm", "trees_t.geojson"), [point(52, 51, d=6)], 25833)
    assert rethin_scan_trees(tile) == 1
    doc = json.loads((dlm / "canopyx_t.geojson").read_text())
    assert [f["geometry"]["coordinates"] for f in doc["features"]] == [[10, 10], [120, 80]]
    assert doc["attribution"] == "scan credit"
    # nothing more to drop: the file stays as it is
    assert rethin_scan_trees(tile) == 0
