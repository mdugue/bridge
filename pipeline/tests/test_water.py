"""The water bodies (pipeline/bake/water.py): units on synthetic grids, no raw
data."""

import base64
import io

import numpy as np
import shapely
from PIL import Image

from bake import water
from bake.water import Grid

BOUNDS = (0.0, 0.0, 200.0, 200.0)


def harbour() -> tuple[np.ndarray, np.ndarray]:
    """A 200 × 200 m tile: a river at 2.00 m in the south half, a basin
    opening onto it at 0.78 (the DGM's two fills), land at 6 m north."""
    z = np.full((200, 200), 6.0, np.float32)
    wet = np.zeros((200, 200), bool)
    wet[100:, :] = True  # the river
    wet[40:100, 60:120] = True  # the basin
    z[100:, :] = 2.0
    z[40:100, 60:120] = 0.78
    return z, wet


def test_a_basin_the_dgm_fills_lower_is_lifted_to_the_river_it_opens_onto():
    z, wet = harbour()
    labels, count = water.label_bodies(Grid(BOUNDS, 200), wet, [])
    assert count == 1
    surface, raised = water.lifts(z, labels)
    assert np.allclose(surface[wet], 2.0)
    assert np.isfinite(raised[50, 90]) and raised[50, 90] == 2.0
    assert not np.isfinite(raised[150, 10])  # the river stays: nothing lowered
    lift = water.lift_raster(raised)
    assert lift["levels"] == [2.0] and lift["m2"] == 60 * 60
    png = np.asarray(Image.open(io.BytesIO(base64.b64decode(lift["png"]))))
    assert png[50, 90] == 1 and png[150, 10] == 0


def test_a_sloping_river_keeps_its_measured_surface():
    z = np.full((200, 200), 6.0, np.float32)
    wet = np.zeros((200, 200), bool)
    wet[80:120, :] = True
    z[80:120, :] = np.linspace(3.0, 1.0, 200)[None, :]  # falls 2 m over the tile
    labels, _ = water.label_bodies(Grid(BOUNDS, 200), wet, [])
    surface, raised = water.lifts(z, labels)
    assert not np.isfinite(raised).any()
    assert np.array_equal(surface, z)


def test_a_weir_mapped_across_the_water_splits_it_and_keeps_its_step():
    z, wet = harbour()
    weir = shapely.LineString([(60, 120), (120, 120)])  # across the basin's mouth (row 80)
    grid = Grid(BOUNDS, 200)
    labels, count = water.label_bodies(grid, wet, [("weir", weir)])
    assert count == 2
    _, raised = water.lifts(z, labels)
    assert not np.isfinite(raised[50, 90])


def test_a_bar_standing_out_of_the_water_is_shore():
    z = np.full((200, 200), 6.0, np.float32)
    wet = np.zeros((200, 200), bool)
    wet[50:150, :] = True
    z[50:150, :] = 1.0
    z[90:110, 80:120] = 1.8  # a gravel bar, 0.8 m out of the water
    level = water.local_level(z, wet)
    dry = water.dry_cells(z, wet, level)
    assert dry[100, 100] and not dry[60, 10]
    raster = np.where(np.repeat(np.repeat(wet, 2, 0), 2, 1), water.WATER, 1).astype(np.uint8)
    green = np.zeros_like(dry)
    shore = water.reclass(raster, dry, green)
    assert shore["sandM2"] == 20 * 40 and shore["meadowM2"] == 0
    assert raster[200, 200] == water.SANDY and raster[120, 20] == water.WATER


def test_a_body_says_where_it_meets_the_tiles_edges_and_at_what_height():
    cells = np.zeros((10, 10), bool)
    cells[:, 2:5] = True  # runs north to south across the tile
    cells[3:6, 9] = True
    surface = np.full((10, 10), 2.0)
    surface[-1] = 1.5
    runs = water.edge_runs(cells, surface)
    assert runs["n"] == [[2, 5, 2.0]] and runs["s"] == [[2, 5, 1.5]]
    assert runs["e"] == [[3, 6, 2.0]] and "w" not in runs


def test_the_tint_grid_names_each_cells_body_and_fills_out_the_land():
    labels = np.zeros((128, 128), np.int32)
    labels[:, :64] = 3  # a body on the west half, its row 0
    grid = water.tint_grid(labels, {3: 0})
    cells = np.frombuffer(base64.b64decode(grid["cells"]), np.uint8).reshape(64, 64)
    assert grid["n"] == 64 and (cells == 1).all()  # the east half filled from it
    assert water.tint_grid(labels, {}) is None


def test_a_drop_along_the_water_foams():
    z = np.full((120, 120), 6.0, np.float32)
    wet = np.zeros((120, 120), bool)
    wet[40:80, :] = True  # a river running east, 40 m wide
    z[40:80, :60] = 3.0
    z[40:80, 60:] = 1.0  # a 2 m weir at x = 60
    grid = Grid((0.0, 0.0, 120.0, 120.0), 120)
    lines = water.foam(grid, z, wet, [])
    assert len(lines) == 1
    (x0, _), (x1, _) = lines[0]["line"]
    assert abs(x0 - 60) < 3 and abs(x1 - 60) < 3
    assert lines[0]["drop"] >= 1.5
    assert lines[0]["down"][0] > 0.9  # downstream is east


def test_a_bent_weir_foams_along_its_chord():
    bent = shapely.LineString([(0, 0), (5, 3), (10, 0.4)])
    entry = water.foam_entry(bent, 1.24, (0.0, -1.0))
    assert entry == {"line": [[0.0, 0.0], [10.0, 0.4]], "drop": 1.2, "down": [0.0, -1.0]}


def test_a_surfaces_range_is_read_along_its_own_water_not_past_a_dyke():
    z = np.full((12, 40), 9.0)
    water_ = np.zeros(z.shape, bool)
    water_[1:5] = True  # a channel at 1 m …
    z[1:5] = 1.0
    z[1:5, 20:] = 1.6  # … with a 0.6 m step half way
    water_[6:10] = True  # past a dyke one row wide, a canal at 3 m
    z[6:10] = 3.0
    span = water.surface_range(z, water_, 3)
    assert abs(span[2, 18] - 0.6) < 1e-9  # the step, within reach
    assert (span[1:5, :15] == 0.0).all()  # far from it: its own flat water
    assert (span[6:10] == 0.0).all()  # the canal never sees the channel
    assert (span[~water_] == 0.0).all()


def test_a_body_gets_a_row_of_its_level_range_area_and_edges_a_pond_none():
    z, wet = harbour()
    wet[10:15, 10:15] = True  # a pond of 25 m², under BODY_MIN_M2
    labels, count = water.label_bodies(Grid(BOUNDS, 200), wet, [])
    river, pond = labels[150, 0], labels[12, 12]
    assert count == 2 and river != pond
    surface = np.where(wet, 2.0, np.nan)
    surface[160:] = 2.5  # a third of the river lies higher: the level is the mode
    rows, index = water.body_rows(Grid(BOUNDS, 200), labels, count, surface, wet, {})
    assert list(index) == [river] and index[river] == 0
    [row] = rows
    assert row["level"] == 2.0 and row["range"] == [2.0, 2.5]
    assert row["m2"] == 200 * 100 + 60 * 60  # the river and the basin, 1 m cells
    x, y = row["at"]
    assert wet[int(200 - y), int(x)]  # a point in the body
    assert row["edges"] == {"s": [[0, 200, 2.5]], "w": [[100, 200, 2.0]], "e": [[100, 200, 2.0]]}
    assert "lab" not in row  # no colour measured
