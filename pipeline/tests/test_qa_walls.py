"""The ground check's walls, stairs, fences and kerbs (B5–B9, B14): a wall's
height measured over its low side, the walls' and flights' materials, the
untagged flight's width, the sides a Wange may stand on, the flights'
handrails, the tall fences, and the lowered kerbs."""

from __future__ import annotations

import json
from collections import Counter

import numpy as np
import rasterio
import shapely
from synthetic import SIZE, X0, Y0, osm_tile

from bake import kerb_drops, stairs, walls


def _way(i: int, refs: list[int], tags: dict[str, str]) -> str:
    nds = "".join(f'<nd ref="{r}"/>' for r in refs)
    kv = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
    return f'<way id="{i}" version="1">{nds}{kv}</way>'


def _tags(tags: dict[str, str]) -> str:
    return "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())


def _dom1(tile, z: np.ndarray, path=None) -> None:
    path = path or tile.raw_raster("dom1")
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
        dst.write(z.astype("float32"), 1)


def _features(tile, name: str) -> list[dict]:
    return json.loads((tile.data / "dlm" / f"{name}_t.geojson").read_text())["features"]


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
        _way(1, [1, 2], {"barrier": "wall"})
        + _way(2, [3, 4], {"barrier": "wall", "wall": "noise_barrier"})
        + _way(3, [5, 6], {"barrier": "wall", "height": "3", "material": "brick"})
        + _way(4, [7, 8], {"barrier": "city_wall", "historic": "citywalls"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dom = np.full((SIZE, SIZE), 100.0)
    dom[99:101, 50:150] = 102.2  # the wall's coping, y 99–101: open both sides
    dom[140:160, 40:160] = 110.0  # a crown over the noise barrier, y 40–60
    dom[170:190, 40:160] = 110.0  # and over the city wall, y 10–30
    _dom1(tile, dom)
    walls.run(tile)
    by_y = {
        round(f["geometry"]["coordinates"][0][1] - Y0): f["properties"]
        for f in _features(tile, "walls")
        if f["properties"]["kind"] == "wall"
    }
    assert by_y[100] == {"kind": "wall", "h": 2.2, "mat": "concrete"}
    # hidden under the crown: its class's fallback
    assert by_y[50]["h"] == walls.FALLBACK_H["noise_barrier"]
    # a tagged height and material win
    assert by_y[170] == {"kind": "wall", "h": 3.0, "mat": "brick"}
    # a historic city wall unmeasured: 6 m, and stone whatever the site's
    [city] = [
        f["properties"] for f in _features(tile, "walls") if f["properties"]["kind"] == "city_wall"
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


def test_a_flights_material_comes_from_its_surface():
    assert stairs.stair_material('"surface"=>"paving_stones"') == "concrete"
    assert stairs.stair_material('"surface"=>"sett"') == "stone"
    assert stairs.stair_material('"surface"=>"wood"') == "wood"
    assert stairs.stair_material('"surface"=>"metal_grid"') == "metal"
    assert stairs.stair_material('"surface"=>"unknown"') is None


# --- B7, B8: the flights' width, sides and handrails ----------------------------


class _Bank:
    def at(self, x, y):
        return 100 + 4 * min(max(y / 20, 0), 1)


def test_an_untagged_flight_is_a_paths_unless_it_lies_in_a_pedestrian_area():
    line = shapely.LineString([(0, 1), (0, 19)])
    f = stairs.flight(line, None, [], _Bank(), [], [], stairs.Context())
    assert f["properties"]["w"] == stairs.DEFAULT_W == 1.5
    square = stairs.Context(public=[shapely.box(-20, -20, 20, 40)])
    f = stairs.flight(line, None, [], _Bank(), [], [], square)
    assert f["properties"]["w"] == stairs.PUBLIC_W
    # a tagged width holds wherever
    f = stairs.flight(line, '"width"=>"4"', [], _Bank(), [], [], stairs.Context())
    assert f["properties"]["w"] == 4.0


def test_a_flight_knows_which_side_a_wall_or_building_stands_along():
    line = shapely.LineString([(0, 1), (0, 19)])
    # climbing north, the left side is west: a wall 0.5 m out from its edge
    wall = shapely.LineString([(-1.25, -5), (-1.25, 25)])
    ctx = stairs.Context(sides=shapely.STRtree([wall]))
    f = stairs.flight(line, None, [], _Bank(), [], [], ctx)
    assert f["properties"]["walled"] == [True, False]
    far = stairs.Context(sides=shapely.STRtree([shapely.LineString([(-4, -5), (-4, 25)])]))
    assert stairs.flight(line, None, [], _Bank(), [], [], far)["properties"]["walled"] == [
        False,
        False,
    ]


def test_a_flights_handrails_follow_its_climb_and_leave_a_fenced_side_out():
    assert stairs.rail_sides('"handrail"=>"yes"') == (True, True)
    assert stairs.rail_sides('"handrail"=>"yes","handrail:left"=>"no"') == (False, True)
    assert stairs.rail_sides('"handrail:right"=>"yes"') == (False, True)
    assert stairs.rail_sides(None) == (False, False)
    # drawn top → bottom with a handrail on its left: the right of the climb
    down = shapely.LineString([(0, 19), (0, 1)])
    f = stairs.flight(down, '"handrail:left"=>"yes"', [], _Bank(), [], [], stairs.Context())
    assert f["properties"]["rail"] == [False, True]
    # a mapped handrail along that side already: none drawn
    fence = shapely.LineString([(0.75, -5), (0.75, 25)])
    ctx = stairs.Context(fences=shapely.STRtree([fence]))
    f = stairs.flight(down, '"handrail:left"=>"yes"', [], _Bank(), [], [], ctx)
    assert "rail" not in f["properties"]


def test_stairs_run_writes_the_sides_material_and_width(tmp_path, monkeypatch):
    nodes = {
        1: (100, 70, ""),
        2: (100, 90, ""),
        3: (99, 60, ""),
        4: (99, 100, ""),
        5: (40, 70, ""),
        6: (40, 90, ""),
    }
    ways = (
        _way(1, [1, 2], {"highway": "steps", "handrail": "yes", "surface": "sett"})
        + _way(2, [3, 4], {"barrier": "retaining_wall"})
        + _way(3, [5, 6], {"highway": "steps"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    # the ground climbs 4 m between y = 72 and y = 88
    y = Y0 + SIZE - (np.arange(SIZE) + 0.5)
    ramp = 100 + 4 * np.clip((y - Y0 - 72) / 16, 0, 1)
    _dom1(tile, np.repeat(ramp[:, None], SIZE, axis=1), tile.dgm)
    stairs.run(tile)
    by_x = {
        round(f["geometry"]["coordinates"][0][0] - X0): f["properties"]
        for f in _features(tile, "stairs")
    }
    railed, plain = by_x[100], by_x[40]
    assert railed["w"] == plain["w"] == 1.5
    assert railed["mat"] == "stone"
    # the retaining wall 0.25 m west of its west (left) edge
    assert railed["walled"] == [True, False]
    assert railed["rail"] == [True, True]
    assert plain["walled"] == [False, False] and "rail" not in plain
    assert plain["mat"] == "concrete"  # the site's majority: too few tagged


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
        _way(1, [1, 2], {"railway": "rail"})
        + _way(2, [3, 4], {"barrier": "fence"})
        + _way(3, [5, 6], {"barrier": "fence"})
        + _way(4, [7, 8, 9, 10, 7], {"leisure": "pitch"})
        + _way(5, [11, 12], {"barrier": "fence"})
        + _way(6, [13, 14], {"barrier": "fence", "height": "1"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    walls.run(tile)
    by_y = {
        round(f["geometry"]["coordinates"][0][1] - Y0, 1): f["properties"]["h"]
        for f in _features(tile, "walls")
        if f["properties"]["kind"] == "fence"
    }
    assert by_y[30.0] == walls.TALL_FENCE_H  # 10 m from the track
    assert by_y[118.5] == walls.TALL_FENCE_H  # along the pitch
    assert by_y[190.0] == walls.FENCE_H
    assert by_y[35.0] == 1.0  # tagged: kept
    assert walls.fence_height("handrail", None, tall=True) == walls.HANDRAIL_H


# --- B14: lowered kerbs ---------------------------------------------------------


def _kerb_tile(tmp_path, monkeypatch):
    """A street along y = 100 with its kerbs at y = 95 (drawn east) and
    y = 105 (drawn west), the road on each line's left."""
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (100, 100, _tags({"highway": "crossing"})),
        4: (50, 96, _tags({"barrier": "kerb", "kerb": "flush"})),
        5: (150, 100, _tags({"highway": "crossing", "crossing": "uncontrolled"})),
        6: (150, 104, _tags({"barrier": "kerb", "kerb": "raised"})),
        7: (30, 100, ""),
        8: (30, 80, ""),
        9: (170, 90, ""),
        10: (170, 110, ""),
        11: (60, 100, _tags({"highway": "crossing", "crossing": "no"})),
    }
    ways = (
        _way(1, [1, 2], {"highway": "residential"})
        + _way(2, [7, 8], {"highway": "service", "service": "driveway", "width": "5"})
        + _way(3, [9, 10], {"highway": "footway", "footway": "crossing"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    south = shapely.LineString([(X0, Y0 + 95), (X0 + 200, Y0 + 95)])
    north = shapely.LineString([(X0 + 200, Y0 + 105), (X0, Y0 + 105)])
    road = shapely.STRtree([shapely.LineString([(X0, Y0 + 100), (X0 + 200, Y0 + 100)])])
    return tile, [south, north], road


def test_kerbs_lower_at_crossings_lowered_nodes_and_driveways(tmp_path, monkeypatch):
    tile, lines, road = _kerb_tile(tmp_path, monkeypatch)
    south, north = kerb_drops.kerb_drops(tile, lines, road)
    # south, from x = 0: the driveway (5 m wide), the flush node, the
    # crossing node, the second crossing (no raised node near this side)
    # and the crossing way
    assert south == [
        [27.5, 32.5, 0.03],
        [48.5, 51.5, 0.0],
        [98.5, 101.5, 0.03],
        [148.5, 151.5, 0.03],
        [168.5, 171.5, 0.03],
    ]
    # north, from x = 200: the crossing way at 30 m, the crossing node at
    # 100 m; the crossing at x = 150 keeps its raised kerb on this side
    assert north == [[28.5, 31.5, 0.03], [98.5, 101.5, 0.03]]


def test_kerbs_stand_full_without_an_extract_or_lines(tmp_path, monkeypatch):
    tile, lines, road = _kerb_tile(tmp_path, monkeypatch)
    assert kerb_drops.kerb_drops(tile, [], road) == []
    monkeypatch.setattr(type(tile), "osm_extract", lambda self: None)
    assert kerb_drops.kerb_drops(tile, lines, road) == [[], []]


def test_drops_merge_clip_and_yield_to_a_raised_kerb():
    drops = [(-1.0, 2.0, 0.03, False), (2.5, 4.0, 0.0, True), (9.0, 12.0, 0.03, False)]
    assert kerb_drops.merged(drops, [], 10.0) == [[0.0, 4.0, 0.0], [9.0, 10.0, 0.03]]
    # a raised node at 11 m vetoes the crossing's default, not a tagged drop
    assert kerb_drops.merged(drops, [11.0, 3.0], 10.0) == [[2.5, 4.0, 0.0]]
    assert kerb_drops.half_width('"width"=>"6 m"') == 3.0
    assert kerb_drops.half_width(None) == kerb_drops.CROSSING_HALF_M
    assert kerb_drops.half_width('"width"=>"40"') == kerb_drops.DRIVEWAY_W
