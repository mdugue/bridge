"""A street's lamps are alike: each takes the median of the post heights
DOM1 shows along its street, or of its kind of street on the tile, or the
5 m it had; a tall one reaches its arm over the carriageway."""

from __future__ import annotations

import json

import numpy as np
import rasterio
import shapely

from bake import lamp_heights
from tests.synthetic import SIZE, X0, Y0, line_tree, osm_tile, way, write_raster


def _lamps(xs, y):
    return [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [X0 + x, Y0 + y]},
            "properties": {"h": 5.0},
        }
        for x in xs
    ]


def _tile(tmp_path, monkeypatch):
    """A primary road along y = 150 with five lamps 2 m off it, the DOM
    showing four of their posts (9.6–10.3 m) and missing one; a residential
    street along y = 50 with two lamps, one under a tree."""
    nodes = {1: (0, 150, ""), 2: (200, 150, ""), 3: (0, 50, ""), 4: (200, 50, "")}
    ways = way(1, [1, 2], {"highway": "primary", "name": "Hauptstraße"}) + way(
        2, [3, 4], {"highway": "residential", "name": "Gasse"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dom = np.full((SIZE, SIZE), 100.0)
    for x, h in ((20, 9.6), (60, 10.0), (100, 10.3), (140, 10.1)):  # x 180: missed
        dom[SIZE - 152, x] = 100.0 + h
    dom[SIZE - 58 : SIZE - 42, 112:128] = 108.0  # a crown over the lamp at x 120
    dom[SIZE - 52, 60] = 104.5  # the street's other lamp reads 4.5 m
    path = tile.raw_raster("dom1")
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(SIZE),
    ) as dst:
        dst.write(dom.astype("float32"), 1)
    hung = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [X0 + 100, Y0 + 50]},
        "properties": {"h": 7.0, "wire": [[X0 + 100, Y0 + 40], [X0 + 100, Y0 + 60]]},
    }
    features = _lamps((20, 60, 100, 140, 180), 152) + _lamps((60, 120), 52) + [hung]
    tile.out("dlm", "lamps_t.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features})
    )
    return tile


def _heights(tile):
    doc = json.loads(tile.out("dlm", "lamps_t.geojson").read_text())
    return [(f["properties"]["h"], f["properties"].get("hs")) for f in doc["features"]]


def test_a_street_s_posts_take_the_median_its_lamps_show(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    lamp_heights.run(tile)
    h = _heights(tile)
    # the primary road: four readings, all five lamps at their median
    assert h[:5] == [(10.0, "street")] * 5
    # the residential street: one reading (the other lamp under a crown) —
    # too few for the street, or for its kind on the tile
    assert h[5:7] == [(5.0, None)] * 2
    assert h[7] == (7.0, None)  # a hung lamp keeps its wire's height


def test_too_few_readings_on_a_street_borrow_its_kind_s(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    monkeypatch.setattr(lamp_heights, "STREET_MIN", 5)
    monkeypatch.setattr(lamp_heights, "KIND_MIN", 4)
    lamp_heights.run(tile)
    assert _heights(tile)[:5] == [(10.0, "class")] * 5


def test_a_lamp_on_a_bridge_is_read_over_its_deck(tmp_path, monkeypatch):
    """Three lamps on a footbridge's deck 6 m over the ground (y = 100), the
    DOM showing the deck and their 4.5 m posts on it: read over the ground
    the deck around them is not clear, read over the deck they are 4.5 m."""
    nodes = {1: (0, 100, ""), 2: (200, 100, "")}
    ways = way(1, [1, 2], {"highway": "footway", "bridge": "yes", "name": "Steg"})
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dom = np.full((SIZE, SIZE), 100.0)
    dom[SIZE - 108 : SIZE - 92, :] = 106.0  # the deck
    for x in (40, 100, 160):
        dom[SIZE - 102, x] = 110.5
    path = tile.raw_raster("dom1")
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(SIZE),
    ) as dst:
        dst.write(dom.astype("float32"), 1)
    features = _lamps((40, 100, 160), 102)
    for f in features:
        f["properties"]["deck"] = 106.0
    tile.out("dlm", "lamps_t.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features})
    )
    lamp_heights.run(tile)
    assert _heights(tile) == [(4.5, "street")] * 3


def test_a_lamp_on_a_facade_keeps_its_height(tmp_path, monkeypatch):
    """Over a wall lantern DOM1 reads the facade's eave, not a post."""
    tile = _tile(tmp_path, monkeypatch)
    path = tile.out("dlm", "lamps_t.geojson")
    doc = json.loads(path.read_text())
    wall = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [X0 + 60, Y0 + 152]},
        "properties": {"h": 3.5, "wall": [X0 + 60, Y0 + 152.5]},
    }
    doc["features"].append(wall)
    path.write_text(json.dumps(doc))
    lamp_heights.run(tile)
    assert _heights(tile)[-1] == (3.5, None)


# --- arms -------------------------------------------------------------------


def _carriageways(*coords):
    return [line_tree(*coords)]


def test_a_tall_post_reaches_its_arm_to_the_carriageway():
    from bake.lamp_heights import arm_of

    roads = _carriageways([(0, 100), (200, 100)])
    beside = shapely.Point(50, 104)  # 4 m north of the street's line
    assert arm_of(beside, 9.0, False, roads) == 180
    # a post under the arm's height stands with its head on top
    assert arm_of(beside, 5.0, False, roads) is None
    # ... unless OSM calls its mast bent
    assert arm_of(beside, 5.0, True, roads) == 180
    # no carriageway within reach, or the post on its line: no side to reach to
    assert arm_of(shapely.Point(50, 130), 9.0, False, roads) is None
    assert arm_of(shapely.Point(50, 100.2), 9.0, False, roads) is None


def test_a_mast_between_two_carriageways_reaches_the_nearer_one_only():
    from bake.lamp_heights import arm_of

    # a dual carriageway's two lines 12 m apart, the mast on the strip between
    roads = _carriageways([(0, 94), (200, 94)], [(0, 106), (200, 106)])
    assert arm_of(shapely.Point(50, 99), 10.0, False, roads) == 180
    assert arm_of(shapely.Point(50, 101), 10.0, False, roads) == 0


def test_a_mast_reaches_over_the_street_not_the_service_way_behind_it():
    from bake.lamp_heights import arm_of

    # a car park's aisle 2 m north of the mast, the street 6 m south
    roads = [line_tree([(0, 94), (200, 94)]), line_tree([(0, 102), (200, 102)])]
    assert arm_of(shapely.Point(50, 100), 9.0, False, roads) == 180
    # with no street in reach, the service way is what it lights
    assert arm_of(shapely.Point(50, 100), 9.0, False, roads[1:]) == 0


def test_lamp_heights_give_the_tall_posts_of_a_main_road_an_arm(tmp_path, monkeypatch):
    """A primary road along y = 150 with four lamps 2 m north of it that
    DOM1 reads at 10 m, a residential street along y = 50 with two at 4.5 m,
    one of them a bent mast."""
    from bake import lamp_heights

    nodes = {1: (0, 150, ""), 2: (200, 150, ""), 3: (0, 50, ""), 4: (200, 50, "")}
    ways = way(1, [1, 2], {"highway": "primary", "name": "Hauptstraße"}) + way(
        2, [3, 4], {"highway": "residential", "name": "Gasse"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dom = np.full((SIZE, SIZE), 100.0)
    for x in (20, 60, 100, 140):
        dom[SIZE - 153, x] = 110.0
    for x in (40, 80, 120):
        dom[SIZE - 53, x] = 104.5
    write_raster(tile.raw_raster("dom1"), dom, dtype="float32")

    def lamp(x, y, **props):
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [X0 + x, Y0 + y]},
            "properties": {"h": 5.0, **props},
        }

    features = [lamp(x, 152.5) for x in (20, 60, 100, 140)]
    features += [lamp(40, 52.5), lamp(80, 52.5, bent=True), lamp(120, 52.5)]
    path = tile.out("dlm", "lamps_t.geojson")
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    lamp_heights.run(tile)
    out = [f["properties"] for f in json.loads(path.read_text())["features"]]
    assert [(p["h"], p.get("arm")) for p in out[:4]] == [(10.0, 180)] * 4
    assert [(p["h"], p.get("arm")) for p in out[4:]] == [(4.5, None), (4.5, 180), (4.5, None)]
