"""Plan 030: the street's signs and fixtures, placed on a synthetic street."""

import numpy as np
from synthetic import local, osm_tile, read, tags, way


def _street(tmp_path, monkeypatch):
    """A road band y 90..110 with a primary road along y = 100 drawn east,
    a signal on it for the eastbound traffic, an underground hydrant in the
    lane, two bus stops (one beside a shelter), a wall clock by a building
    and a lit advertising column."""
    cls = np.zeros((200, 200), np.uint8)
    cls[90:110, :] = 7  # road: 90 < y <= 110
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        10: (50, 100, tags(highway="traffic_signals", traffic_signals__direction="forward")),
        11: (
            120,
            104,
            tags(emergency="fire_hydrant", fire_hydrant__type="underground"),
        ),
        12: (150, 80, tags(highway="bus_stop", shelter="no")),
        13: (154, 80, tags(highway="bus_stop", shelter="yes")),
        14: (20, 80, tags(highway="bus_stop")),
        15: (100, 60, tags(amenity="clock", support="wall")),
        16: (30, 130, tags(advertising="column", lit="yes")),
        20: (95, 40, ""),
        21: (105, 40, ""),
        22: (105, 58, ""),
        23: (95, 58, ""),
    }
    ways = way(1, [1, 10, 2], {"highway": "primary"}) + way(
        2, [20, 21, 22, 23, 20], {"building": "yes"}
    )
    return osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)


def _by_kind(tile):
    out: dict[str, list] = {}
    for f in read(tile, "furniture")["features"]:
        out.setdefault(f["properties"]["k"], []).append(f)
    return out


def test_a_signal_on_the_road_stands_at_the_kerb_facing_its_traffic(tmp_path, monkeypatch):
    from bake import furniture

    tile = _street(tmp_path, monkeypatch)
    furniture.run(tile)
    [signal] = _by_kind(tile)["signal"]
    x, y = local(signal["geometry"]["coordinates"])
    # eastbound traffic: the kerb on its right is the south one
    assert x == 50.0 and 88.5 < y < 90.0
    assert signal["properties"]["a"] == 270  # it looks west, at the traffic


def test_a_hydrant_sign_in_the_lane_moves_to_the_kerb(tmp_path, monkeypatch):
    from bake import furniture

    tile = _street(tmp_path, monkeypatch)
    furniture.run(tile)
    [sign] = _by_kind(tile)["hydrantsign"]
    x, y = local(sign["geometry"]["coordinates"])
    assert x == 120.0 and 110.0 < y < 112.0  # the nearer, northern kerb
    assert "a" in sign["properties"]


def test_a_stop_sign_only_where_no_shelter_stands(tmp_path, monkeypatch):
    from bake import furniture

    tile = _street(tmp_path, monkeypatch)
    furniture.run(tile)
    kinds = _by_kind(tile)
    [stop] = kinds["stop"]
    assert local(stop["geometry"]["coordinates"]) == (20.0, 80.0)
    assert len(kinds["shelter"]) == 1


def test_a_wall_clock_hangs_on_its_facade_and_a_lit_column_glows(tmp_path, monkeypatch):
    from bake import furniture

    tile = _street(tmp_path, monkeypatch)
    furniture.run(tile)
    kinds = _by_kind(tile)
    [clock] = kinds["wallclock"]
    assert local(clock["geometry"]["coordinates"]) == (100.0, 58.0)
    assert clock["properties"]["a"] % 360 == 0  # out of the north wall
    [column] = kinds["column"]
    assert column["properties"] == {"k": "column", "lit": True}


def test_street_signs_and_fixtures_come_from_the_tags():
    from bake.furniture import kind_of

    assert kind_of(None, None, '"advertising"=>"column","lit"=>"yes"') == "column"
    assert kind_of(None, "traffic_signals", None) == "signal"
    hydrant = '"emergency"=>"fire_hydrant","fire_hydrant:type"=>'
    assert kind_of(None, None, hydrant + '"pillar"') == "hydrant"
    assert kind_of(None, None, hydrant + '"underground"') == "hydrantsign"
    assert kind_of(None, None, hydrant + '"wall"') is None
    assert kind_of(None, None, '"amenity"=>"clock","support"=>"pole"') == "clock"
    assert kind_of(None, None, '"amenity"=>"clock","support"=>"wall_mounted"') == "wallclock"
    assert kind_of(None, None, '"amenity"=>"clock","support"=>"tower"') is None
    assert kind_of(None, None, '"amenity"=>"clock","support"=>"pole","display"=>"sundial"') is None
    assert kind_of(None, None, '"amenity"=>"drinking_water"') == "water"
    # a platform node without a shelter stands nothing (its bus_stop has the sign)
    assert kind_of(None, None, '"public_transport"=>"platform"') is None
