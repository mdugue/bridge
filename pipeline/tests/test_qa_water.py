"""The water bodies (water.py) and the hedges drawn once, at their measured
height (hedges.py, lowveg.py, landcover_osm.py): units on synthetic grids,
no raw data."""

import base64
import io

import numpy as np
import shapely
from PIL import Image

from bake import hedges, lowveg, water
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


def test_a_dlm_hedge_osm_maps_too_is_left_to_osm():
    rows = [
        {
            "properties": {"kind": "hedge"},
            "geometry": shapely.geometry.mapping(shapely.LineString([(0, 0), (30, 0)])),
        },
        {
            "properties": {"kind": "treerow"},
            "geometry": shapely.geometry.mapping(shapely.LineString([(0, 1), (30, 1)])),
        },
    ]
    osm = [shapely.LineString([(0, 1.0), (20, 1.0)])]  # the first 20 m, 1 m off
    kept, removed = hedges.without_mapped(rows, osm)
    kinds = [f["properties"]["kind"] for f in kept]
    assert kinds == ["treerow", "hedge"] or kinds == ["hedge", "treerow"]
    hedge = next(f for f in kept if f["properties"]["kind"] == "hedge")
    assert shapely.geometry.shape(hedge["geometry"]).length < 10.5
    assert 21 <= removed <= 23


def dom_over(ndom: np.ndarray) -> hedges.DomHeights:
    return hedges.DomHeights(ndom, (0.0, 0.0, float(ndom.shape[0]), float(ndom.shape[0])))


def test_a_hedge_without_a_scan_takes_dom1s_height_or_goes():
    ndom = np.zeros((40, 40), np.float32)
    ndom[9:12, 5:35] = 1.7  # a hedge along y = 30
    ndom[10, 20] = 9.0  # a tree over it
    line = shapely.LineString([(5, 29.5), (35, 29.5)])
    assert abs(hedges.dom_height(line, dom_over(ndom)) - 1.7) < 1e-6
    gone = shapely.LineString([(5, 5.5), (35, 5.5)])
    assert hedges.dom_height(gone, dom_over(ndom)) == 0.0
    feats, _ = lowveg.osm_hedge_features(None, [(None, line), (None, gone)], None, dom_over(ndom))
    assert [f["properties"]["src"] for f in feats] == ["osm+dom"]
    assert feats[0]["properties"]["h"] == 1.7


def test_a_scan_hedge_ships_only_long_slim_clear_of_crowns_and_green():
    ndom = np.zeros((80, 80), np.float32)
    ndom[0:10, 0:10] = 12.0  # a crown in the north-west corner
    clear = hedges.crown_clearance(ndom, (0.0, 0.0, 80.0, 80.0))
    open_line = shapely.LineString([(20, 40), (40, 40)])
    green = np.full(40, 0.4)
    assert hedges.scan_hedge_ok(open_line, 1.0, clear, green)
    assert hedges.scan_hedge_ok(open_line, 1.0, clear, None)  # no NDVI raster
    assert not hedges.scan_hedge_ok(open_line, 1.0, clear, np.full(40, 0.05))
    assert not hedges.scan_hedge_ok(shapely.LineString([(20, 40), (24, 40)]), 1.0, clear, None)
    assert not hedges.scan_hedge_ok(open_line, 6.0, clear, None)  # a bed, not a hedge
    rim = shapely.LineString([(0, 69.5), (12, 69.5)])  # a metre off the crown
    assert not hedges.scan_hedge_ok(rim, 1.0, clear, None)


def test_the_scan_hedges_that_pass_ship_without_their_flag():
    line = shapely.LineString([(0, 0), (8, 0)])
    passed = lowveg.hedge_feature(line, 1.2, 0.8, "lsc")
    passed["properties"]["ship"] = True
    failed = lowveg.hedge_feature(line, 1.2, 0.8, "lsc")
    failed["properties"]["ship"] = False
    kept = lowveg.shipped([passed, failed, lowveg.hedge_feature(line, 1.5, 1.0, "osm+dom")])
    assert [f["properties"]["src"] for f in kept] == ["lsc", "osm+dom"]
    assert "ship" not in kept[0]["properties"]
    assert passed["properties"]["ship"] is True  # the research file keeps it


def test_a_bent_weir_foams_along_its_chord():
    bent = shapely.LineString([(0, 0), (5, 3), (10, 0.4)])
    entry = water.foam_entry(bent, 1.24, (0.0, -1.0))
    assert entry == {"line": [[0.0, 0.0], [10.0, 0.4]], "drop": 1.2, "down": [0.0, -1.0]}
