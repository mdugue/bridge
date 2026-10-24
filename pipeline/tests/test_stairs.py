"""The flights of steps (pipeline/bake/stairs.py): their direction, width,
steps, sides and handrails."""

import numpy as np
import shapely

from bake import stairs
from tests.synthetic import SIZE, X0, Y0, features, osm_tile, read, slope_tile, way, write_raster


def test_a_flight_is_oriented_uphill_with_its_landings_and_tagged_steps(tmp_path, monkeypatch):
    from bake import stairs

    # Drawn top → bottom; 25 steps over the 4 m rise is a 16 cm riser.
    way = (
        '<way id="1" version="1"><nd ref="1"/><nd ref="2"/>'
        '<tag k="highway" v="steps"/><tag k="step_count" v="25"/><tag k="width" v="3 m"/></way>'
    )
    tile = slope_tile(tmp_path, monkeypatch, way)
    stairs.run(tile)
    doc = read(tile, "stairs")
    assert doc["attribution"].startswith("©")
    [f] = doc["features"]
    (xa, ya), (xb, yb) = f["geometry"]["coordinates"]
    assert ya < yb  # reversed to run bottom → top
    assert f["properties"]["w"] == 3.0
    assert f["properties"]["n"] == 25
    lo, hi = f["properties"]["z"]
    assert abs(lo - 100) < 0.1 and abs(hi - 104) < 0.1


def test_a_flight_without_a_width_takes_it_from_its_outline_and_derives_steps(
    tmp_path, monkeypatch
):
    from bake import stairs

    ways = (
        '<way id="1" version="1"><nd ref="2"/><nd ref="1"/><tag k="highway" v="steps"/>'
        '<tag k="step_count" v="3"/></way>'  # a 1.3 m riser: a typo, derived instead
        '<way id="2" version="1"><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/>'
        '<nd ref="3"/><tag k="area:highway" v="steps"/></way>'
        '<way id="3" version="1"><nd ref="3"/><nd ref="4"/><tag k="highway" v="footway"/></way>'
    )
    tile = slope_tile(tmp_path, monkeypatch, ways)
    stairs.run(tile)
    [f] = read(tile, "stairs")["features"]
    assert abs(f["properties"]["w"] - 6.0) < 0.05
    assert f["properties"]["n"] == 25


def test_flat_indoor_and_bridge_flights_are_left_out():
    from bake.stairs import skipped, step_count, width_of

    assert skipped('"indoor"=>"yes"')
    assert skipped('"bridge"=>"yes"')
    assert skipped('"level"=>"-1"')
    assert not skipped('"level"=>"0"')
    assert not skipped(None)
    assert step_count(1.6, None) == 10
    line = shapely.LineString([(0, 0), (10, 0)])
    outline = shapely.box(-1, -3, 11, 3)  # 12 m × 6 m around a 10 m axis
    assert width_of(line, None, [outline]) == 7.2  # area / length inside
    assert width_of(line, '"width"=>"100"', [outline]) == 30.0


class _Bank:
    """A DGM stub: 100 m south of y = 0, rising 4 m to y = 20 across all x."""

    def at(self, x, y):
        return 100 + 4 * min(max(y / 20, 0), 1)


class _Flat:
    def at(self, x, y):
        return 112.0


def test_an_untagged_flight_spans_the_slope_between_its_walls():
    from bake.stairs import flight

    walls = [
        shapely.LineString([(-7, -5), (-7, 25)]),  # 7 m left
        shapely.LineString([(11, -5), (11, 25)]),  # 11 m right
    ]
    f = flight(shapely.LineString([(0, 1), (0, 19)]), None, [], _Bank(), walls, [])
    w = f["properties"]["w"]
    assert abs(w - (18 - 0.6)) < 1e-6
    (x0, _), (x1, _) = f["geometry"]["coordinates"]
    assert x0 == x1 == 2.0  # re-centred between the walls


def test_walls_too_far_or_on_one_side_leave_the_default_width():
    from bake.stairs import DEFAULT_W, flight

    line = shapely.LineString([(0, 1), (0, 19)])
    one_side = [shapely.LineString([(-3, -5), (-3, 25)])]
    assert flight(line, None, [], _Bank(), one_side, [])["properties"]["w"] == DEFAULT_W
    far = [shapely.LineString([(-30, -5), (-30, 25)]), shapely.LineString([(30, -5), (30, 25)])]
    assert flight(line, None, [], _Bank(), far, [])["properties"]["w"] == DEFAULT_W


def test_an_untagged_flight_is_a_paths_unless_it_lies_in_a_pedestrian_area():
    line = shapely.LineString([(0, 1), (0, 19)])
    f = stairs.flight(line, None, [], _Bank(), [], [], stairs.Context())
    assert f["properties"]["w"] == stairs.DEFAULT_W
    square = stairs.Context(public=[shapely.box(-20, -20, 20, 40)])
    f = stairs.flight(line, None, [], _Bank(), [], [], square)
    assert f["properties"]["w"] == stairs.PUBLIC_W
    # a tagged width holds wherever
    f = stairs.flight(line, '"width"=>"4"', [], _Bank(), [], [], stairs.Context())
    assert f["properties"]["w"] == 4.0


def test_a_flight_onto_a_raised_area_the_dgm_lacks_takes_its_tagged_rise():
    from bake.stairs import flight

    terrace = shapely.box(20, -10, 60, 10)
    tags = '"step_count"=>"41","step:height"=>"0.15","incline"=>"up","width"=>"20"'
    line = shapely.LineString([(0, 0), (21, 0)])  # drawn upwards, ends on the terrace
    f = flight(line, tags, [], _Flat(), [], [terrace])
    assert f["properties"]["z"] == [112.0, 118.15]
    assert f["properties"]["n"] == 41
    assert f["terrace"] is terrace
    # Without a raised area at its top, the flight stays as flat as the DGM.
    assert flight(line, tags, [], _Flat(), [], []) is None


def test_only_plain_raised_areas_count_as_terraces():
    from bake.stairs import is_raised

    assert is_raised({"other_tags": '"layer"=>"1","highway"=>"pedestrian"'})
    assert not is_raised({"other_tags": '"layer"=>"-1"'})
    assert not is_raised({"other_tags": '"layer"=>"0"'})
    assert not is_raised({"other_tags": '"layer"=>"1"', "building": "yes"})
    assert not is_raised({"other_tags": '"layer"=>"1","railway"=>"platform"'})
    assert not is_raised({"other_tags": '"layer"=>"1"', "landuse": "railway"})


def test_a_terrace_platform_fills_the_holes_of_its_area():
    from bake.stairs import platform

    promenade = shapely.Polygon(
        [(0, 0), (40, 0), (40, 20), (0, 20)], holes=[[(10, 5), (20, 5), (20, 15), (10, 15)]]
    )
    assert platform(promenade).area == 800


def test_a_flights_material_comes_from_its_surface():
    assert stairs.stair_material('"surface"=>"paving_stones"') == "concrete"
    assert stairs.stair_material('"surface"=>"sett"') == "stone"
    assert stairs.stair_material('"surface"=>"wood"') == "wood"
    assert stairs.stair_material('"surface"=>"metal_grid"') == "metal"
    assert stairs.stair_material('"surface"=>"unknown"') is None


# --- B7, B8: the flights' width, sides and handrails ----------------------------


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
        way(1, [1, 2], {"highway": "steps", "handrail": "yes", "surface": "sett"})
        + way(2, [3, 4], {"barrier": "retaining_wall"})
        + way(3, [5, 6], {"highway": "steps"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    # the ground climbs 4 m between y = 72 and y = 88
    y = Y0 + SIZE - (np.arange(SIZE) + 0.5)
    ramp = 100 + 4 * np.clip((y - Y0 - 72) / 16, 0, 1)
    write_raster(tile.dgm, np.repeat(ramp[:, None], SIZE, axis=1), dtype="float32")
    stairs.run(tile)
    by_x = {
        round(f["geometry"]["coordinates"][0][0] - X0): f["properties"]
        for f in features(tile, "stairs")
    }
    railed, plain = by_x[100], by_x[40]
    assert railed["w"] == plain["w"] == 1.5
    assert railed["mat"] == "stone"
    # the retaining wall 0.25 m west of its west (left) edge
    assert railed["walled"] == [True, False]
    assert railed["rail"] == [True, True]
    assert plain["walled"] == [False, False] and "rail" not in plain
    assert plain["mat"] == "concrete"  # the site's majority: too few tagged
