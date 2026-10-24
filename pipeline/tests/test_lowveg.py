"""The low vegetation and the hedges (pipeline/bake/lowveg.py, hedges.py): the
hedges drawn once at their measured height, the scan's trees thinned."""

import json

import numpy as np
import shapely

from bake import hedges, lowveg
from bake.common import Tile


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
