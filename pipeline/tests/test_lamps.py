"""Street lamps on a synthetic street: hung across it where they hang, on
their posts at the kerb where they were mapped in the lanes."""

import numpy as np
import pytest
import shapely

from tests.synthetic import SIZE, line_tree, local, osm_tile, read, tags, way, write_raster


def _street(tmp_path, monkeypatch):
    """A 10 m carriageway (y 95..105) along a residential street drawn east
    on y = 100; a row of houses on its south side (y 80..90, x 0..170) and
    on its north side (y 110..120, x 40..170), open ground east of x 170."""
    cls = np.zeros((200, 200), np.uint8)
    cls[95:105, :] = 7
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        10: (50, 100, tags(highway="street_lamp", support="suspended")),
        11: (100, 101, tags(highway="street_lamp")),
        12: (150, 103, tags(highway="street_lamp", lamp_mount="bent_mast")),
        13: (190, 100, tags(highway="street_lamp")),
        14: (30, 100, tags(highway="street_lamp", support="suspended")),
        15: (120, 80, tags(highway="street_lamp")),
        16: (60, 90, tags(highway="street_lamp", lamp_mount="wall")),
        17: (80, 111, tags(highway="street_lamp", support="wall_mounted")),
        18: (190, 80, tags(highway="street_lamp", lamp_mount="wall")),
        19: (70, 100, tags(highway="street_lamp", support="wire", lamp_mount="wall")),
        20: (0, 80, ""),
        21: (170, 80, ""),
        22: (170, 90, ""),
        23: (0, 90, ""),
        30: (40, 110, ""),
        31: (170, 110, ""),
        32: (170, 120, ""),
        33: (40, 120, ""),
    }
    ways = (
        way(1, [1, 2], {"highway": "residential"})
        + way(2, [20, 21, 22, 23, 20], {"building": "yes"})
        + way(3, [30, 31, 32, 33, 30], {"building": "yes"})
    )
    return osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)


def _lamps(tile):
    from bake import lamps

    lamps.run(tile)
    return {
        local(f["geometry"]["coordinates"]): f["properties"]
        for f in read(tile, "lamps")["features"]
    }


@pytest.fixture(scope="module")
def street_lamps(tmp_path_factory) -> dict:
    """The street's lamps, baked once for the tests that read them."""
    with pytest.MonkeyPatch.context() as mp:
        return _lamps(_street(tmp_path_factory.mktemp("street"), mp))


def test_a_lamp_tagged_suspended_hangs_between_the_facades(street_lamps):
    lamps = street_lamps
    hung = lamps[(50.0, 100.0)]
    north, south = (local(end) for end in hung["wire"])
    assert north == (50.0, 110.0) and south == (50.0, 90.0)
    assert "masts" not in hung and hung["h"] > 5


def test_an_untagged_lamp_over_the_lanes_between_houses_hangs(street_lamps):
    lamps = street_lamps
    assert "wire" in lamps[(100.0, 101.0)]


def test_a_hung_lamp_without_a_facade_holds_its_wire_on_a_mast(street_lamps):
    lamps = street_lamps
    hung = lamps[(30.0, 100.0)]
    assert hung["masts"] == [True, False]  # no house north of it
    x, y = local(hung["wire"][0])
    assert x == 30.0 and 105.0 < y < 107.0  # at the kerb


def test_a_post_in_the_lanes_moves_to_the_kerb(street_lamps):
    lamps = street_lamps
    # a bent mast mapped in the lane, and an untagged lamp with no houses
    # either side: both on their posts at the nearest kerb
    posts = {at: p for at, p in lamps.items() if "wire" not in p}
    assert (150.0, 103.0) not in posts and (190.0, 100.0) not in posts
    assert any(x == 150.0 and 105.0 < y < 107.0 for x, y in posts)
    assert any(x == 190.0 and (93.0 < y < 95.0 or 105.0 < y < 107.0) for x, y in posts)
    # off the road a lamp stands where it is mapped
    assert posts[(120.0, 80.0)] == {"h": 5.0}


def test_the_tags_that_hang_a_lamp():
    from bake.lamps import hung_tag

    assert hung_tag('"support"=>"suspended"') is True
    assert hung_tag('"lamp_mount"=>"wire"') is True
    assert hung_tag('"support"=>"pole","lamp_mount"=>"straight_mast"') is False
    assert hung_tag('"ref"=>"12"') is None
    assert hung_tag(None) is None


def test_a_lamp_on_a_wall_hangs_on_its_facade(street_lamps):
    lamps = street_lamps
    # on the south houses' outline, and a metre into the north ones: the head
    # half a metre out of the facade on the street side, its bracket's foot
    # on the facade
    south, north = lamps[(60.0, 90.5)], lamps[(80.0, 109.5)]
    assert south["h"] == 3.5 and local(south["wall"]) == (60.0, 90.0)
    assert local(north["wall"]) == (80.0, 110.0)
    # no facade near it: a post where it is mapped
    assert lamps[(190.0, 80.0)] == {"h": 5.0}
    # on a wire fixed to the walls: hung across the street
    assert "wire" in lamps[(70.0, 100.0)]


def test_the_tags_that_put_a_lamp_on_a_wall():
    from bake.lamps import wall_tag

    assert wall_tag('"lamp_mount"=>"wall"') is True
    assert wall_tag('"support"=>"wall_mounted"') is True
    assert wall_tag('"support"=>"wire","lamp_mount"=>"wall"') is False  # hung
    assert wall_tag('"support"=>"pole"') is False
    assert wall_tag(None) is False


def test_a_bent_mast_is_called_so():
    from bake.lamps import post

    assert post(5.0, '"lamp_mount"=>"bent_mast"') == {"h": 5.0, "bent": True}
    assert post(5.0, '"lamp_mount"=>"straight_mast"') == {"h": 5.0}
    assert post(5.0, None) == {"h": 5.0}


# --- lanterns on a mapped wall -------------------------------------------------


def _walls(tmp_path, monkeypatch):
    """A retaining wall along y = 100 (drawn east), its high ground north
    (108 m against 100 m south); a garden wall along y = 40 on flat ground;
    a city wall along x = 190 (drawn north) with a street along x = 170
    west of it. No buildings."""
    nodes = {
        1: (20, 100, ""),
        2: (180, 100, ""),
        3: (20, 40, ""),
        4: (180, 40, ""),
        5: (190, 10, ""),
        6: (190, 60, ""),
        7: (170, 0, ""),
        8: (170, 80, ""),
        10: (60, 100, tags(highway="street_lamp", lamp_mount="wall")),
        11: (120, 100, tags(highway="street_lamp")),
        12: (60, 40, tags(highway="street_lamp", lamp_mount="wall")),
        13: (190, 30, tags(highway="street_lamp", support="wall_mounted")),
    }
    ways = (
        way(1, [1, 10, 11, 2], {"barrier": "retaining_wall"})
        + way(2, [3, 12, 4], {"barrier": "wall"})
        + way(3, [5, 13, 6], {"barrier": "city_wall"})
        + way(4, [7, 8], {"highway": "residential"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dgm = np.full((SIZE, SIZE), 100.0)
    dgm[: SIZE - 100, :] = 108.0  # north of y = 100
    write_raster(tile.dgm, dgm, dtype="float32")
    return tile


def test_a_wall_lantern_with_no_building_near_hangs_on_the_wall(tmp_path, monkeypatch):
    lamps = _lamps(_walls(tmp_path, monkeypatch))
    # on the retaining wall's face, the low side, half a metre out
    face = lamps[(60.0, 99.5)]
    assert face["on"] == "wall" and face["h"] == 3.5
    assert local(face["wall"]) == (60.0, 100.0)
    # a freestanding city wall: on the side of the street
    city = lamps[(189.5, 30.0)]
    assert city["on"] == "wall" and local(city["wall"]) == (190.0, 30.0)


def test_a_lamp_beside_a_low_wall_or_untagged_stays_a_post(tmp_path, monkeypatch):
    lamps = _lamps(_walls(tmp_path, monkeypatch))
    # a garden wall (1.5 m) holds no lantern: the lamp stands on its post
    assert lamps[(60.0, 40.0)] == {"h": 5.0}
    # nor is an untagged lamp on a wall hung on it
    assert lamps[(120.0, 100.0)] == {"h": 5.0}


def test_a_low_retaining_wall_hangs_its_lantern_lower():
    from bake.lamps import WALL_H, Walls

    walls = Walls.__new__(Walls)
    walls.lines = [shapely.LineString([(0, 0), (100, 0)])]
    walls.tops = [3.0]
    walls.tree = shapely.STRtree(walls.lines)
    ground = {1: 103.4, -1: 100.0}  # the left (north) side 3.4 m up
    walls.ground_at = lambda x, y: ground[1 if y > 0 else -1]
    ways, lines = line_tree([(0, -30), (100, -30)])
    foot, head, h = walls.bracket(shapely.Point(50, 0), ways, lines)
    assert foot == [50.0, 0.0] and (head.x, head.y) == pytest.approx((50, -0.5))
    assert h == 2.5 < WALL_H  # under the crown, its bracket rising to it
    ground[1] = 102.0  # a 2 m step holds none
    assert walls.bracket(shapely.Point(50, 0), ways, lines) is None
