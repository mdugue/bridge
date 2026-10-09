"""Street lamps on a synthetic street: hung across it where they hang, on
their posts at the kerb where they were mapped in the lanes."""

import numpy as np
from synthetic import local, osm_tile, read, tags, way


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


def test_a_lamp_tagged_suspended_hangs_between_the_facades(tmp_path, monkeypatch):
    lamps = _lamps(_street(tmp_path, monkeypatch))
    hung = lamps[(50.0, 100.0)]
    north, south = (local(end) for end in hung["wire"])
    assert north == (50.0, 110.0) and south == (50.0, 90.0)
    assert "masts" not in hung and hung["h"] > 5


def test_an_untagged_lamp_over_the_lanes_between_houses_hangs(tmp_path, monkeypatch):
    lamps = _lamps(_street(tmp_path, monkeypatch))
    assert "wire" in lamps[(100.0, 101.0)]


def test_a_hung_lamp_without_a_facade_holds_its_wire_on_a_mast(tmp_path, monkeypatch):
    lamps = _lamps(_street(tmp_path, monkeypatch))
    hung = lamps[(30.0, 100.0)]
    assert hung["masts"] == [True, False]  # no house north of it
    x, y = local(hung["wire"][0])
    assert x == 30.0 and 105.0 < y < 107.0  # at the kerb


def test_a_post_in_the_lanes_moves_to_the_kerb(tmp_path, monkeypatch):
    lamps = _lamps(_street(tmp_path, monkeypatch))
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
