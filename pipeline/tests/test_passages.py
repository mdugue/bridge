"""The passage bake's pure parts: which ways run on the ground floor, how
wide and high a passage is, which stretches of a way run through the
footprints and what each footprint holds of it."""

import shapely

from bake import passages


def test_ground_floor():
    assert passages.on_ground_floor(None)
    assert passages.on_ground_floor('"layer"=>"-1"')
    assert passages.on_ground_floor('"level"=>"0;1"')
    # the Zwinger's terrace walk through a pavilion, a ramp up a garage
    assert not passages.on_ground_floor('"level"=>"1"')
    assert not passages.on_ground_floor('"layer"=>"1"')


def test_width_by_tag_or_kind():
    assert passages.width_of("service", None) == (passages.DRIVE_W, "kind")
    assert passages.width_of("footway", None) == (passages.WALK_W, "kind")
    assert passages.width_of("footway", 4.0) == (4.0, "width")
    # a yard track into its shed is a track's width, not a footway's
    assert passages.kind_of(None, "rail") == "railway"
    assert passages.kind_of("service", "tram") == "service"
    assert passages.kind_of(None, None) is None
    assert passages.width_of("railway", None) == (passages.TRACK_W, "kind")


def test_height_from_maxheight_where_plausible():
    assert passages.height_of(None) is None
    assert passages.height_of('"maxheight"=>"3.8"') == 3.8
    assert passages.height_of('"maxheight:physical"=>"4.1","maxheight"=>"3.5"') == 4.1
    # a typo is none
    assert passages.height_of('"maxheight"=>"38"') is None


def test_a_chain_of_ways_is_one_passage():
    a = shapely.LineString([(0, 0), (5, 0)])
    b = shapely.LineString([(5, 0), (12, 0)])
    upstairs = shapely.LineString([(0, 3), (5, 3)])
    ways = [
        (a, 2, "footway", '"width"=>"3"'),
        (b, 1, "steps", None),
        (upstairs, 3, "footway", '"level"=>"1"'),
    ]
    (way,) = passages.merged(ways)
    assert way.ids == [1, 2]
    assert way.kind == "steps"  # the longest member's kind
    assert way.width == 3.0
    assert way.line.length == 12


def test_stretches_join_across_a_party_wall_and_drop_grazes():
    line = shapely.LineString([(0, 0), (30, 0)])
    houses = [shapely.box(2, -5, 10, 5), shapely.box(11, -5, 20, 5), shapely.box(29.5, -5, 40, 5)]
    inside = [line.intersection(h) for h in houses]
    # two houses a metre apart are one passage; 0.5 m into the third none
    assert passages.stretches(line, inside) == [(2.0, 20.0)]


def test_a_footprint_s_share_walls_ceiling_and_portals():
    house = shapely.box(0, 0, 10, 10)
    axis = shapely.LineString([(5, -0.6), (5, 10.6)])
    part = passages.object_part(axis, 2.0, house)
    assert part is not None
    (roof,) = part["roof"]
    assert shapely.Polygon(roof).area == 20
    assert len(part["sides"]) == 2
    for side in part["sides"]:
        (ax, ay), (bx, by) = side
        # walked with the passage on its left
        left = (-(by - ay), bx - ax)
        assert (5 - ax) * left[0] > 0
    assert sorted(part["portals"]) == [[5.0, 0.0, 0.0, -1.0], [5.0, 10.0, 0.0, 1.0]]
    # an axis that misses the footprint holds nothing of it
    assert passages.object_part(shapely.LineString([(20, 0), (20, 10)]), 2.0, house) is None


def test_a_bend_past_the_limit_is_measured():
    assert passages.max_bend(shapely.LineString([(0, 0), (5, 0), (10, 0)])) == 0
    assert round(passages.max_bend(shapely.LineString([(0, 0), (5, 0), (5, 5)]))) == 90


class _Ground:
    """A DGM sampler: the ground at 0 everywhere."""

    def sample(self, points):
        return [[0.0] for _ in points]


def _passages(line, houses, ids=None):
    ids = ids or [f"h{i}" for i in range(len(houses))]
    way = passages.Way(line, [1], "service", None, None)
    return passages.passages_of(way, ids, houses, shapely.STRtree(houses), _Ground())


def test_a_way_that_ends_inside_its_building_is_shut_there():
    house = shapely.box(0, 0, 10, 10)
    # a drive in from the street, ending 4 m inside (a garage)
    ((axis, props),) = _passages(shapely.LineString([(5, -3), (5, 6)]), [house])
    assert axis.coords[-1] == (5.0, 6.0)  # not run on past its end
    assert round(axis.coords[0][1], 6) == -0.6  # the open end runs on through the wall
    part = props["of"]["h0"]
    assert len(part["portals"]) == 1
    # the two walls along it and the one across its end
    across = [s for s in part["sides"] if s[0][1] == s[-1][1] == 6.0]
    assert len(part["sides"]) == 3 and len(across) == 1
    # walked with the passage on its left: the strip lies at lower y
    (ax, _), (bx, _) = across[0]
    assert bx < ax


def test_a_way_that_stops_at_the_wall_runs_on_through_it():
    house = shapely.box(0, 0, 10, 10)
    # mapped to the facade's node on the far side: open, not shut
    ((axis, props),) = _passages(shapely.LineString([(5, -3), (5, 9.8)]), [house])
    assert round(axis.coords[-1][1], 6) == 10.4
    assert len(props["of"]["h0"]["sides"]) == 2


def test_a_part_beside_the_way_is_lined_too():
    house = shapely.box(0, 0, 10, 10)
    # a part of the building 0.4 m beside the drive's axis
    beside = shapely.box(5.4, 3, 9, 7)
    (_, props) = _passages(shapely.LineString([(5, -3), (5, 13)]), [house, beside])[0]
    assert set(props["of"]) == {"h0", "h1"}
    assert props["of"]["h1"]["sides"] and props["of"]["h1"]["roof"]
