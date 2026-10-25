"""The walls, cliffs, fences and quays (pipeline/bake/walls.py)."""

import json
import math
from collections import Counter

import numpy as np
import rasterio
import shapely
from PIL import Image

from bake import walls
from bake.osm import tag
from bake.walls import height, lines_of
from tests.synthetic import (
    SIZE,
    X0,
    Y0,
    features,
    osm_nodes,
    osm_tile,
    read,
    slope_tile,
    way,
    write_raster,
)


def test_wall_heights_come_from_the_tags_clamped():
    assert height('"height"=>"4 m"') == 4.0
    assert height('"est_height"=>"99"') == 30.0
    assert height(None) is None
    assert tag('"bridge:structure"=>"arch","x"=>"1"', "bridge:structure") == "arch"


def test_wall_polygons_contribute_their_outer_ring_only():
    square = shapely.Polygon(
        [(0, 0), (1, 0), (1, 1), (0, 1)], holes=[[(0.2, 0.2), (0.4, 0.2), (0.4, 0.4)]]
    )
    rings = lines_of(square)
    assert len(rings) == 1
    assert rings[0].is_ring


def test_a_polygon_clipped_away_yields_no_wall():
    clipped = shapely.intersection(shapely.box(10, 10, 11, 11), shapely.box(0, 0, 1, 1))
    assert lines_of(clipped) == []


def test_cliffs_come_through_as_walls_of_their_own_kind(tmp_path, monkeypatch):
    from bake import walls

    ways = (
        '<way id="1" version="1"><nd ref="3"/><nd ref="4"/><tag k="natural" v="cliff"/></way>'
        '<way id="2" version="1"><nd ref="5"/><nd ref="6"/><tag k="natural" v="tree_row"/></way>'
    )
    tile = slope_tile(tmp_path, monkeypatch, ways)
    walls.run(tile)
    [f] = read(tile, "walls")["features"]
    assert f["properties"] == {"kind": "cliff", "h": 3.0}
    assert walls.kind_of(None, None, '"natural"=>"cliff"') == "cliff"
    assert walls.kind_of("retaining_wall", None, '"natural"=>"cliff"') == "retaining_wall"


def test_fences_follow_the_walls_and_gates_on_a_line_come_last(tmp_path, monkeypatch):
    from bake import walls

    nodes = osm_nodes(
        11,
        [
            (100.2, 75, {"barrier": "gate"}),  # 20 cm off the fence: on it
            (100, 150, {"barrier": "gate"}),  # on no line: dropped
            (100, 105, {"barrier": "lift_gate"}),  # on the wall
        ],
    )
    ways = (
        '<way id="1" version="1"><nd ref="3"/><nd ref="4"/><tag k="barrier" v="fence"/>'
        '<tag k="fence_type" v="chain_link"/></way>'
        '<way id="2" version="1"><nd ref="6"/><nd ref="5"/><tag k="barrier" v="wall"/></way>'
    )
    tile = slope_tile(tmp_path, monkeypatch, nodes + ways)
    walls.run(tile)
    doc = read(tile, "walls")
    assert doc["attribution"].startswith("©")
    wall, fence, gate_on_fence, gate_on_wall = doc["features"]
    # no material tagged on the site: concrete (walls.DEFAULT_MATERIAL)
    assert wall["properties"] == {"kind": "wall", "h": 1.5, "mat": "concrete"}
    assert fence["properties"] == {"kind": "fence", "type": "mesh", "h": 1.2}
    assert gate_on_fence["properties"] == {"kind": "gate", "w": 1.2, "on": "fence"}
    x, y = gate_on_fence["geometry"]["coordinates"]
    assert abs(y - 5656075) < 0.02  # snapped onto the line
    assert gate_on_wall["properties"] == {
        "kind": "gate",
        "w": 4.0,
        "on": "wall",
        "type": "lift_gate",
    }


def _on_tile_edge(tile, coords) -> float:
    """Metres of a line that run along the tile's edge."""
    xmin, ymin, xmax, ymax = tile.bounds
    on = 0.0
    for (xa, ya), (xb, yb) in zip(coords, coords[1:], strict=False):
        for axis, v in ((0, xmin), (0, xmax), (1, ymin), (1, ymax)):
            if abs((xa, ya)[axis] - v) < 0.005 and abs((xb, yb)[axis] - v) < 0.005:
                on += math.dist((xa, ya), (xb, yb))
    return on


def test_an_area_across_the_tile_edge_stands_no_fence_on_the_seam(tmp_path, monkeypatch):
    from bake import walls

    # A fenced yard and a walled garden, both 20 m wide, straddling the east
    # edge (x = 200) of the 200 m tile; the ring starts outside the tile.
    corners = [(210, 20), (190, 20), (190, 40), (210, 40), (210, 60), (190, 60), (190, 80)]
    nodes = osm_nodes(11, [(x, y, {}) for x, y in corners + [(210, 80)]])
    ways = (
        '<way id="1" version="1"><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="14"/>'
        '<nd ref="11"/><tag k="barrier" v="fence"/><tag k="area" v="yes"/></way>'
        '<way id="2" version="1"><nd ref="15"/><nd ref="16"/><nd ref="17"/><nd ref="18"/>'
        '<nd ref="15"/><tag k="barrier" v="wall"/><tag k="area" v="yes"/></way>'
    )
    tile = slope_tile(tmp_path, monkeypatch, nodes + ways)
    walls.run(tile)
    lines = [f for f in read(tile, "walls")["features"] if f["geometry"]["type"] == "LineString"]
    assert sorted(f["properties"]["kind"] for f in lines) == ["fence", "wall"]
    for f in lines:
        coords = [tuple(c) for c in f["geometry"]["coordinates"]]
        assert _on_tile_edge(tile, coords) == 0.0
        # One open line inside the tile, 10 + 20 + 10 m: the ring's three
        # sides in the tile, joined across its closing vertex.
        assert coords[0] != coords[-1]
        assert abs(shapely.LineString(coords).length - 40.0) < 0.05


def test_a_neighbours_gate_whose_gap_reaches_over_the_seam_cuts_here_too(tmp_path, monkeypatch):
    from bake import walls

    # A fence across the east edge (x = 200), a 4 m gate on it 1 m past the
    # edge (the neighbour's: its gap reaches 1 m into this tile) and a 1.2 m
    # gate 1 m past the edge (its gap stays on the neighbour's side).
    nodes = osm_nodes(
        11,
        [
            (180, 50, {}),
            (220, 50, {}),
            (201, 50, {"barrier": "gate", "width": "4"}),
            (201, 50.1, {"barrier": "gate"}),
        ],
    )
    ways = '<way id="1" version="1"><nd ref="11"/><nd ref="12"/><tag k="barrier" v="fence"/></way>'
    tile = slope_tile(tmp_path, monkeypatch, nodes + ways)
    walls.run(tile)
    gates = [f for f in read(tile, "walls")["features"] if f["properties"]["kind"] == "gate"]
    assert [g["properties"] for g in gates] == [
        {"kind": "gate", "w": 4.0, "on": "fence", "seam": True}
    ]
    assert walls.reaches_in((0, 0, 200, 200), shapely.Point(202, 50), 4.0)
    assert not walls.reaches_in((0, 0, 200, 200), shapely.Point(202.1, 50), 4.0)


def test_fence_types_and_heights_come_from_the_tags():
    from bake.walls import fence_height, fence_type, gate_width

    assert fence_type("fence", None) == "railing"  # Dresden's wrought iron
    assert fence_type("fence", '"fence_type"=>"wood"') == "picket"
    assert fence_type("fence", '"fence_type"=>"metal"') == "railing"
    assert fence_type("fence", '"fence_type"=>"concrete"') == "railing"
    assert fence_type("handrail", '"fence_type"=>"wire"') == "rail"
    assert fence_height("fence", '"height"=>"1.8 m"') == 1.8
    assert fence_height("fence", '"height"=>"25"') == 1.2  # implausible: default
    assert fence_height("handrail", None) == 1.0
    assert gate_width("gate", '"width"=>"3"') == 3.0
    assert gate_width("lift_gate", None) == 4.0
    assert gate_width("gate", None) == 1.2


# --- B5: a wall's height is measured -------------------------------------------


def test_an_untagged_wall_stands_at_its_measured_height(tmp_path, monkeypatch):
    nodes = {
        1: (50, 100, ""),
        2: (150, 100, ""),
        3: (50, 50, ""),
        4: (150, 50, ""),
        5: (50, 170, ""),
        6: (150, 170, ""),
        7: (50, 20, ""),
        8: (150, 20, ""),
    }
    ways = (
        way(1, [1, 2], {"barrier": "wall"})
        + way(2, [3, 4], {"barrier": "wall", "wall": "noise_barrier"})
        + way(3, [5, 6], {"barrier": "wall", "height": "3", "material": "brick"})
        + way(4, [7, 8], {"barrier": "city_wall", "historic": "citywalls"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dom = np.full((SIZE, SIZE), 100.0)
    dom[99:101, 50:150] = 102.2  # the wall's coping, y 99–101: open both sides
    dom[140:160, 40:160] = 110.0  # a crown over the noise barrier, y 40–60
    dom[170:190, 40:160] = 110.0  # and over the city wall, y 10–30
    write_raster(tile.raw_raster("dom1"), dom, dtype="float32")
    walls.run(tile)
    by_y = {
        round(f["geometry"]["coordinates"][0][1] - Y0): f["properties"]
        for f in features(tile, "walls")
        if f["properties"]["kind"] == "wall"
    }
    assert by_y[100] == {"kind": "wall", "h": 2.2, "mat": "concrete"}
    # hidden under the crown: its class's fallback
    assert by_y[50]["h"] == walls.FALLBACK_H["noise_barrier"]
    # a tagged height and material win
    assert by_y[170] == {"kind": "wall", "h": 3.0, "mat": "brick"}
    # a historic city wall unmeasured: 6 m, and stone whatever the site's
    [city] = [
        f["properties"] for f in features(tile, "walls") if f["properties"]["kind"] == "city_wall"
    ]
    assert city == {"kind": "city_wall", "h": 6.0, "mat": "stone"}


def test_a_station_does_not_count_by_a_building_or_under_a_crown_on_both_sides():
    flat = walls.Grid(np.full((40, 40), 100.0, dtype=np.float32), 0.0, 40.0, 1.0)
    top = np.full((40, 40), 100.0, dtype=np.float32)
    top[19:21, 5:35] = 101.8
    none = walls.Grid(np.zeros((40, 40), dtype=np.uint8), 0.0, 40.0, 1.0)
    model = walls.SurfaceModel(walls.Grid(top, 0.0, 40.0, 1.0), flat, none, "dom1")
    line = shapely.LineString([(5, 20), (35, 20)])
    assert abs(model.measure([line], "wall") - 1.8) < 1e-4  # float32 rasters
    blocked = np.zeros((40, 40), dtype=np.uint8)
    blocked[:, :] = 1  # a building along it: its eaves, not the wall
    model.blocked = walls.Grid(blocked, 0.0, 40.0, 1.0)
    assert model.measure([line], "wall") is None
    model.blocked = none
    # a crown over the line (the NDVI's ≈ 2 m raster green over it) is no
    # wall's top; a lawn beside it (a mown lawn's 0.33) does not matter
    ndvi = np.full((20, 20), 0.33, dtype=np.float32)
    model.green = [walls.Grid(ndvi, 0.0, 40.0, 2.0)]
    assert abs(model.measure([line], "wall") - 1.8) < 1e-4
    ndvi[9:11, :] = 0.7
    assert model.measure([line], "wall") is None
    model.green = []
    # too short to measure
    assert model.measure([shapely.LineString([(5, 20), (5.5, 20)])], "wall") is None


def test_an_unmeasured_wall_falls_back_by_its_class():
    assert walls.wall_class("wall", '"wall"=>"flood_wall"') == "flood_wall"
    assert walls.wall_class("city_wall", '"wall"=>"flood_wall"') == "flood_wall"
    assert walls.wall_class("city_wall", '"historic"=>"citywalls"') == "city_wall"
    assert walls.wall_class("city_wall", None) == "wall"  # no historic one
    assert walls.fallback_height("wall", "flood_wall", {}) == 2.5
    assert walls.fallback_height("city_wall", "city_wall", {}) == 6.0
    assert walls.fallback_height("city_wall", "wall", {}) == 1.5
    seen = {"wall": [1.0] * 5 + [2.0] * 6}
    assert walls.fallback_height("wall", "wall", seen) == 2.0  # the tile's median
    assert walls.fallback_height("wall", "wall", {"wall": [2.0] * 3}) == 1.5
    retaining = walls.DEFAULT_H["retaining_wall"]
    assert walls.fallback_height("retaining_wall", "wall", seen) == retaining


# --- B6: what a wall and a flight are made of -----------------------------------


def test_a_walls_material_comes_from_its_tags_or_the_sites_majority():
    assert walls.material_of('"material"=>"Sandstone"') == "stone"
    assert walls.material_of('"material"=>"glass;steel"') == "metal"
    assert walls.material_of('"wall"=>"flood_wall"') == "concrete"
    assert walls.material_of('"wall"=>"dry_stone"') == "stone"
    assert walls.material_of('"material"=>"glass"') is None
    assert walls.material_of(None) is None
    assert walls.majority(Counter(brick=5, stone=4)) == "brick"
    assert walls.majority(Counter(brick=4, stone=4)) == "brick"  # a tie: alphabetical
    assert walls.majority(Counter(stone=7)) == "concrete"  # too few tagged


# --- B9: tall fences ------------------------------------------------------------


def test_an_untagged_fence_by_a_railway_or_round_a_pitch_stands_two_metres(tmp_path, monkeypatch):
    nodes = {
        1: (0, 20, ""),
        2: (200, 20, ""),
        3: (20, 30, ""),
        4: (180, 30, ""),
        5: (20, 190, ""),
        6: (100, 190, ""),
        7: (120, 120, ""),
        8: (180, 120, ""),
        9: (180, 170, ""),
        10: (120, 170, ""),
        11: (125, 118.5, ""),
        12: (175, 118.5, ""),
        13: (20, 35, ""),
        14: (180, 35, ""),
    }
    ways = (
        way(1, [1, 2], {"railway": "rail"})
        + way(2, [3, 4], {"barrier": "fence"})
        + way(3, [5, 6], {"barrier": "fence"})
        + way(4, [7, 8, 9, 10, 7], {"leisure": "pitch"})
        + way(5, [11, 12], {"barrier": "fence"})
        + way(6, [13, 14], {"barrier": "fence", "height": "1"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    walls.run(tile)
    by_y = {
        round(f["geometry"]["coordinates"][0][1] - Y0, 1): f["properties"]["h"]
        for f in features(tile, "walls")
        if f["properties"]["kind"] == "fence"
    }
    assert by_y[30.0] == walls.TALL_FENCE_H  # 10 m from the track
    assert by_y[118.5] == walls.TALL_FENCE_H  # along the pitch
    assert by_y[190.0] == walls.FENCE_H
    assert by_y[35.0] == 1.0  # tagged: kept
    assert walls.fence_height("handrail", None, tall=True) == walls.HANDRAIL_H


# --- quays: measured where the water meets the land ---------------------------


def _harbour(tmp_path, monkeypatch, ways: str = "", nodes=None):
    """Water south of y = 100; to its north a 4 m quay from x = 0 to 90 (the
    DGM's 1–2 m ramp) and a 1:2 bank from x = 90 on."""
    classes = np.zeros((SIZE, SIZE), np.uint8)
    classes[100:, :] = 8
    tile = osm_tile(tmp_path, monkeypatch, nodes or {}, ways, classes=classes)
    z = np.zeros((SIZE, SIZE), np.float32)
    z[:98, :90] = 4.0
    z[98, :90], z[99, :90] = 2.7, 1.3
    for r in range(92, 100):  # rows 92–99: 0.5 m a row
        z[r, 90:] = (100 - r) * 0.5
    z[:92, 90:] = 4.0
    with rasterio.open(tile.dgm, "r+") as dst:
        dst.write(z, 1)
    return tile


def test_a_quay_is_measured_where_the_water_meets_a_wall_not_a_bank(tmp_path, monkeypatch):
    tile = _harbour(tmp_path, monkeypatch)
    found = walls.quays(tile, [])
    assert len(found) == 1
    [(line, h)] = found
    xs, ys = (shapely.get_coordinates(line) - (X0, Y0)).T
    # the wall's run along the water, its ends inside the quay's 0–90 m
    assert xs.min() < 10 and 80 < xs.max() < 92
    assert np.all(np.abs(ys - 100) < 2)
    assert h == 4.0
    # and it is drawn as a wall the terrain bake snaps to its step
    walls.run(tile)
    [quay] = [f["properties"] for f in features(tile, "walls") if f["properties"]["kind"] == "quay"]
    assert quay == {"kind": "quay", "h": 4.0, "mat": "concrete"}
    # measured in the provider's DGM: its credit beside OSM's
    doc = json.loads((tile.data / "dlm" / "walls_t.geojson").read_text())
    assert doc["attribution"].endswith("quays: Quelle: GeoSN, dl-de/by-2-0")


def test_a_lawn_bank_or_a_mapped_retaining_wall_is_no_measured_quay(tmp_path, monkeypatch):
    tile = _harbour(tmp_path, monkeypatch)
    lawn = np.full((SIZE, SIZE), int(0.33 * 255), np.uint8)
    Image.fromarray(lawn).save(tile.out("dlm", "ndvi_t.png"))
    assert walls.quays(tile, []) == []
    (tile.data / "dlm" / "ndvi_t.png").unlink()
    mapped = shapely.LineString([(X0, Y0 + 101), (X0 + 90, Y0 + 101)])
    assert walls.quays(tile, [mapped]) == []


def test_a_wall_that_draws_the_step_or_a_flight_of_steps_takes_the_quay(tmp_path, monkeypatch):
    tile = _harbour(tmp_path, monkeypatch)
    edge = shapely.LineString([(X0, Y0 + 101), (X0 + 90, Y0 + 101)])
    # a wall mapped on the edge as tall as the step faces the water itself
    assert walls.quays(tile, [], [(edge, 4.0)]) == []
    # a parapet on the quay's top does not
    assert len(walls.quays(tile, [], [(edge, 1.0)])) == 1
    # a wall that holds the earth snaps to the steepest metre within its
    # reach: 6 m inland it draws the same step
    inland = shapely.LineString([(X0, Y0 + 106), (X0 + 90, Y0 + 106)])
    assert walls.quays(tile, [inland]) == []
    # a flight of steps down to the water keeps its foot open
    steps = shapely.LineString([(X0 + 45, Y0 + 110), (X0 + 45, Y0 + 99)])
    found = walls.quays(tile, [], [], [steps])
    assert len(found) == 2
    assert all(shapely.distance(line, steps) >= walls.QUAY_STAIR_M - 0.5 for line, _ in found)
