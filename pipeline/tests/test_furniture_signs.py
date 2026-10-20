"""Plan 030: the street's signs and fixtures, placed on a synthetic street."""

import json

import numpy as np
from synthetic import X0, Y0, local, osm_tile, read, tags, way


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


def test_a_bicycle_stand_in_a_streets_lanes_moves_to_the_kerb(tmp_path, monkeypatch):
    """A stand mapped in a residential street's lanes stands at the kerb; a
    bench on a square the class raster also counts as road (its nearest way
    a footway) stays where it is mapped."""
    from bake import furniture

    cls = np.zeros((200, 200), np.uint8)
    cls[95:105, :] = 7  # the street, y 95..105
    cls[20:60, 20:60] = 7  # a paved square, x 20..60, y 140..180
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (20, 160, ""),
        4: (60, 160, ""),
        10: (80, 102, tags(amenity="bicycle_parking", capacity="4")),
        11: (40, 158, tags(amenity="bench")),
    }
    ways = way(1, [1, 2], {"highway": "residential"}) + way(2, [3, 4], {"highway": "footway"})
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)
    furniture.run(tile)
    kinds = _by_kind(tile)
    [bike] = kinds["bike"]
    x, y = local(bike["geometry"]["coordinates"])
    assert x == 80.0 and 105.0 < y < 107.0  # the nearer, northern kerb
    [bench] = kinds["bench"]
    assert local(bench["geometry"]["coordinates"]) == (40.0, 158.0)


def test_a_bench_on_a_bridge_stands_on_its_deck(tmp_path, monkeypatch):
    """A footbridge north over a river (y 90..110), its deck 104 → 106 m:
    a bench on it over the water or beside its way over the bank stands on
    the deck; one under the deck by the path along the bank is left out, as
    before, and so is a signal in its lane; one on the meadow stands on the
    ground."""
    from bake import furniture

    cls = np.zeros((200, 200), np.uint8)
    cls[90:110, :] = 8  # the river: 90 < y <= 110
    nodes = {
        1: (100, 80, ""),
        2: (100, 120, ""),
        3: (60, 82, ""),
        4: (140, 82, ""),
        10: (101, 100, tags(amenity="bench")),  # on the deck, over the water
        11: (99, 84, tags(amenity="bench")),  # on the deck, over the bank
        12: (102, 81, tags(amenity="bench")),  # under it, by the bank's path
        13: (50, 100, tags(amenity="bench")),  # in the river
        14: (60, 70, tags(amenity="bench")),  # on the meadow
        15: (100, 96, tags(highway="traffic_signals")),  # in its lane: left out
    }
    ways = way(1, [1, 2], {"highway": "footway", "bridge": "yes"}) + way(
        2, [3, 4], {"highway": "footway"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)
    ring = [[X0 + x, Y0 + y] for x, y in ((98, 80), (104, 80), (104, 120), (98, 120), (98, 80))]
    deck = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "properties": {
            "kind": "path",
            "axis": [[X0 + 100, Y0 + 80], [X0 + 100, Y0 + 120]],
            "line": [104.0 + 0.1 * i for i in range(21)],  # every 2 m
        },
    }
    doc = {"type": "FeatureCollection", "features": [deck]}
    (tile.data / "dlm" / "bridge_t.geojson").write_text(json.dumps(doc))
    furniture.run(tile)
    benches = {
        local(f["geometry"]["coordinates"]): f["properties"].get("deck")
        for f in _by_kind(tile)["bench"]
    }
    assert benches == {(101.0, 100.0): 105.0, (99.0, 84.0): 104.2, (60.0, 70.0): None}
    assert "signal" not in _by_kind(tile)
