"""Plan 030: the street's signs and fixtures, placed on a synthetic street;
the benches, crossings' signals, bins and playgrounds (furniture.py)."""

import json

import numpy as np
import pytest
import shapely

from tests.synthetic import SIZE, X0, Y0, local, osm_tile, read, tags, way


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


@pytest.fixture(scope="module")
def street_furniture(tmp_path_factory) -> dict[str, list]:
    """The street's furniture by kind, baked once for the tests that read it."""
    from bake import furniture

    with pytest.MonkeyPatch.context() as mp:
        tile = _street(tmp_path_factory.mktemp("street"), mp)
        furniture.run(tile)
        return _by_kind(tile)


def test_a_signal_on_the_road_stands_at_the_kerb_facing_its_traffic(street_furniture):
    [signal] = street_furniture["signal"]
    x, y = local(signal["geometry"]["coordinates"])
    # eastbound traffic: the kerb on its right is the south one
    assert x == 50.0 and 88.5 < y < 90.0
    assert signal["properties"]["a"] == 270  # it looks west, at the traffic


def test_a_hydrant_sign_in_the_lane_moves_to_the_kerb(street_furniture):
    [sign] = street_furniture["hydrantsign"]
    x, y = local(sign["geometry"]["coordinates"])
    assert x == 120.0 and 110.0 < y < 112.0  # the nearer, northern kerb
    assert "a" in sign["properties"]


def test_a_stop_sign_only_where_no_shelter_stands(street_furniture):
    kinds = street_furniture
    [stop] = kinds["stop"]
    assert local(stop["geometry"]["coordinates"]) == (20.0, 80.0)
    assert len(kinds["shelter"]) == 1


def test_a_wall_clock_hangs_on_its_facade_and_a_lit_column_glows(street_furniture):
    kinds = street_furniture
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
    before; a signal on its path stands on the deck too (it was left out);
    one on the meadow stands on the ground."""
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
        15: (100, 96, tags(highway="traffic_signals")),  # on its path, on the deck
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
    [signal] = _by_kind(tile)["signal"]
    assert local(signal["geometry"]["coordinates"]) == (100.0, 96.0)
    assert signal["properties"]["deck"] == 104.8


# --- signals and hydrant signs on a bridge -----------------------------------


def test_a_signal_and_a_hydrant_sign_on_a_bridge_stand_at_its_deck_s_edge(tmp_path, monkeypatch):
    """A primary road east along y = 100 over a river (x 90..110) on a 12 m
    wide deck (x 60..140, y 94..106, its top at 105 m): its signal for the
    eastbound traffic, mapped on the way, stands at the deck's southern
    edge — on that traffic's right — facing it; a hydrant's sign mapped in
    the lane at the nearer edge. A wall clock with no facade near is still
    dropped."""
    from bake import furniture

    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[:, 90:110] = 8  # the river
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (60, 100, ""),
        4: (140, 100, ""),
        10: (100, 100, tags(highway="traffic_signals", traffic_signals__direction="forward")),
        11: (104, 101.5, tags(emergency="fire_hydrant", fire_hydrant__type="underground")),
        12: (96, 100.5, tags(amenity="clock", support="wall")),
    }
    ways = (
        way(1, [1, 3], {"highway": "primary"})
        + way(2, [3, 10, 4], {"highway": "primary", "bridge": "yes"})
        + way(3, [4, 2], {"highway": "primary"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)
    ring = [[X0 + x, Y0 + y] for x, y in ((60, 94), (140, 94), (140, 106), (60, 106), (60, 94))]
    deck = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "properties": {
            "kind": "road",
            "axis": [[X0 + 60, Y0 + 100], [X0 + 140, Y0 + 100]],
            "line": [105.0] * 41,
        },
    }
    (tile.data / "dlm" / "bridge_t.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [deck]})
    )
    furniture.run(tile)
    kinds: dict[str, list] = {}
    for f in read(tile, "furniture")["features"]:
        kinds.setdefault(f["properties"]["k"], []).append(f)
    [signal] = kinds["signal"]
    assert local(signal["geometry"]["coordinates"]) == (100.0, 94.4)
    assert signal["properties"]["a"] == 270 and signal["properties"]["deck"] == 105.0
    [sign] = kinds["hydrantsign"]
    assert local(sign["geometry"]["coordinates"]) == (104.0, 105.6)
    assert sign["properties"]["deck"] == 105.0
    assert "wallclock" not in kinds


def test_a_carriageway_is_its_lanes_wide_where_no_width_is_tagged():
    from bake.furniture import carriageway_half

    assert carriageway_half("residential", None) == 3.0  # its class's
    assert carriageway_half("primary", '"width"=>"9 m"') == 4.5
    assert carriageway_half("primary", '"lanes"=>"4"') == 6.5
    assert carriageway_half("residential", '"lanes"=>"1"') == 3.0  # a one-way's count
    assert carriageway_half("primary", '"lanes"=>"4","width"=>"9"') == 4.5
    # one carriageway of a dual road, as the class raster paints it
    whole = carriageway_half("primary", None)
    assert carriageway_half("primary", '"oneway"=>"yes"') == max(whole / 2, 2.0)
    assert carriageway_half("residential", '"oneway"=>"yes"') == 3.0


def test_a_signal_on_a_wide_deck_stands_at_its_carriageway_s_kerb():
    """A residential street along y = 0 over a 40 m wide deck (a station's
    tracks below): its signal moves to the kerb, 3 m (its class's half
    carriageway) and 0.6 m on, not 20 m to the parapet; a lamp in the lanes
    still stands by the parapet; on a deck narrower than the carriageway the
    edge comes first."""
    from bake.bridge import Axis
    from bake.furniture import Decks

    street = shapely.LineString([(0, 0), (60, 0)])
    wide = shapely.box(0, -20, 60, 20)
    decks = Decks([(wide, Axis([[0, 0], [60, 0]]), [10.0] * 31)], [(street, True)], [street], [3.0])
    at = decks.kerbside(shapely.Point(30, 0.5), toward=180.0, kerb=True)
    assert (at.x, at.y) == pytest.approx((30, -3.6))
    lamp = decks.kerbside(shapely.Point(30, 0.5))
    assert (lamp.x, lamp.y) == pytest.approx((30, 19.6))
    narrow = Decks(
        [(shapely.box(0, -2, 60, 2), Axis([[0, 0], [60, 0]]), [10.0] * 31)],
        [(street, True)],
        [street],
        [3.0],
    )
    at = narrow.kerbside(shapely.Point(30, 0.5), toward=0.0, kerb=True)
    assert (at.x, at.y) == pytest.approx((30, 1.6))


# --- street furniture (W10, W11, W13, W14, W15) ------------------------------


def test_a_bench_with_water_beyond_it_looks_at_the_water(tmp_path, monkeypatch):
    from bake import furniture
    from tests.synthetic import local

    cls = np.zeros((200, 200), np.uint8)
    cls[90:110, :] = 8  # the river: 90 < y <= 110
    nodes = {
        1: (0, 80, ""),
        2: (200, 80, ""),
        10: (100, 86, tags(amenity="bench")),  # between the path and the river
        11: (100, 74, tags(amenity="bench")),  # beyond the path, 16 m off the water
        12: (50, 86, tags(amenity="bench", direction="180")),  # tagged: kept
    }
    tile = osm_tile(tmp_path, monkeypatch, nodes, way(1, [1, 2], {"highway": "footway"}), cls)
    furniture.run(tile)
    a = {local(f["geometry"]["coordinates"]): f["properties"]["a"] for f in _by_kind(tile)["bench"]}
    assert a[(100.0, 86.0)] % 360 == 0  # the water, not the path behind it
    assert a[(100.0, 74.0)] % 360 == 0  # the path in front
    assert a[(50.0, 86.0)] == 180


def _crossing_street(tmp_path, monkeypatch, extra=None, ways_extra=""):
    """A four-lane primary road along y = 100 (its class raster band 90..110)
    drawn east, a service street crossing it along x = 80 (band 78..82), a
    signal for the eastbound traffic at x = 50 and a signalled pedestrian
    crossing at x = 140 with its footway north-south."""
    cls = np.zeros((200, 200), np.uint8)
    cls[90:110, :] = 7
    cls[:, 78:82] = 7
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (80, 0, ""),
        4: (80, 200, ""),
        5: (80, 100, ""),
        6: (140, 80, ""),
        7: (140, 120, ""),
        10: (50, 100, tags(highway="traffic_signals", traffic_signals__direction="forward")),
        11: (140, 100, tags(highway="crossing", crossing="traffic_signals")),
        **(extra or {}),
    }
    ways = (
        way(1, [1, 10, 5, 11, 2], {"highway": "primary", "lanes": "4"})
        + way(2, [3, 5, 4], {"highway": "service"})
        + way(3, [6, 11, 7], {"highway": "footway", "footway": "crossing"})
        + ways_extra
    )
    return osm_tile(tmp_path, monkeypatch, nodes, ways, cls)


def test_a_crossing_has_a_pedestrian_signal_at_each_kerb_looking_across(tmp_path, monkeypatch):
    from bake import furniture
    from tests.synthetic import local

    tile = _crossing_street(tmp_path, monkeypatch)
    furniture.run(tile)
    peds = sorted(
        (local(f["geometry"]["coordinates"]), f["properties"]["a"])
        for f in _by_kind(tile)["pedsignal"]
    )
    [((xs, ys), a_south), ((xn, yn), a_north)] = peds
    assert xs == xn == 140.0
    assert 88.5 < ys < 90.0 and a_south == 0  # the south kerb's looks north
    assert 110.0 < yn < 112.0 and a_north == 180


def test_a_signal_over_four_lanes_hangs_on_an_arm_and_repeats_past_the_junction(
    tmp_path, monkeypatch
):
    from bake import furniture
    from tests.synthetic import local

    tile = _crossing_street(tmp_path, monkeypatch)
    furniture.run(tile)
    signals = sorted(
        (local(f["geometry"]["coordinates"]), f["properties"]) for f in _by_kind(tile)["signal"]
    )
    [((x0, y0), stop), ((x1, y1), far)] = signals
    assert x0 == 50.0 and 88.5 < y0 < 90.0 and stop == {"k": "signal", "a": 270, "arm": True}
    # past the service street (half 2 m, a kerb's step, 1 m), on the right
    assert x1 == 83.6 and 88.5 < y1 < 90.0 and far == {"k": "signal", "a": 270}


def test_a_signal_on_a_square_stands_at_its_ways_kerb(tmp_path, monkeypatch):
    """The class raster's road all round (a square): no kerb in reach, so
    the way's carriageway gives it — it was dropped."""
    from bake import furniture
    from tests.synthetic import local

    cls = np.full((200, 200), 7, np.uint8)
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        10: (100, 100, tags(highway="traffic_signals")),
    }
    tile = osm_tile(
        tmp_path, monkeypatch, nodes, way(1, [1, 10, 2], {"highway": "residential"}), cls
    )
    furniture.run(tile)
    [signal] = _by_kind(tile)["signal"]
    x, y = local(signal["geometry"]["coordinates"])
    assert x == 100.0 and abs(abs(y - 100.0) - 3.6) < 0.05


def test_bins_take_their_own_colour_else_the_citys_majority(tmp_path, monkeypatch):
    from bake import furniture
    from bake.furniture import bin_tone

    assert bin_tone("Red") == "red"
    assert bin_tone("dark green") == "green"
    assert bin_tone("#7a828e") == "grey"
    assert bin_tone("#cc1111") == "red"
    assert bin_tone("brown") is None
    nodes = {
        100 + i: (
            10 + 6 * (i % 25),
            20 + 10 * (i // 25),
            tags(amenity="waste_basket", colour="red"),
        )
        for i in range(25)
    }
    nodes |= {
        200 + i: (10 + 6 * i, 60, tags(amenity="waste_basket", colour="grey")) for i in range(5)
    }
    nodes[300] = (100, 150, tags(amenity="waste_basket"))
    nodes[301] = (120, 150, tags(amenity="waste_basket", colour="blue"))
    tile = osm_tile(tmp_path, monkeypatch, nodes)
    furniture.run(tile)
    by = {tuple(f["geometry"]["coordinates"]): f["properties"] for f in _by_kind(tile)["bin"]}
    assert by[(X0 + 100, Y0 + 150)].get("c") == "red"  # untagged: the city's
    assert by[(X0 + 120, Y0 + 150)].get("c") == "blue"
    assert "c" not in by[(X0 + 10, Y0 + 60)]  # grey is the model's own
    # too few tagged: no city colour
    few = {
        1: (50, 50, tags(amenity="waste_basket", colour="red")),
        2: (60, 50, tags(amenity="waste_basket")),
    }
    tile = osm_tile(tmp_path / "few", monkeypatch, few)
    furniture.run(tile)
    by = {tuple(f["geometry"]["coordinates"]): f["properties"] for f in _by_kind(tile)["bin"]}
    assert "c" not in by[(X0 + 60, Y0 + 50)]


def _with_dom(tile, heights: np.ndarray) -> None:
    import rasterio

    path = tile.raw_raster("dom1")
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(200),
    ) as dst:
        dst.write((100.0 + heights).astype("float32"), 1)


def test_an_empty_playground_stands_what_the_surface_model_shows(tmp_path, monkeypatch):
    from bake import furniture

    nodes = {1: (20, 20, ""), 2: (60, 20, ""), 3: (60, 60, ""), 4: (20, 60, "")}
    tile = osm_tile(
        tmp_path, monkeypatch, nodes, way(1, [1, 2, 3, 4, 1], {"leisure": "playground"})
    )
    h = np.zeros((200, 200))
    # rows are 200 − y: a swing's frame 6 m east-west at y ≈ 50, a climbing
    # frame at (30, 30), a tree (8 m, its fringe 3 m) at (50, 30)
    h[149:151, 25:31] = 2.2
    h[169:172, 29:32] = 2.5
    h[167:174, 47:54] = 3.0
    h[169:172, 49:52] = 8.0
    h[155:175, 20] = 1.6  # the hedge along its western edge
    _with_dom(tile, h)
    furniture.run(tile)
    pieces = [f for k, fs in _by_kind(tile).items() if k != "playground" for f in fs]
    assert sorted(f["properties"]["k"] for f in pieces) == ["climb", "swing"]
    assert all(f["properties"]["src"] == "dom" for f in pieces)
    [swing] = [f for f in pieces if f["properties"]["k"] == "swing"]
    assert swing["properties"]["a"] % 180 == 0  # across its east-west frame
    # a playground with its equipment mapped stands only that
    nodes[10] = (40, 40, tags(playground="slide"))
    tile = osm_tile(
        tmp_path / "mapped",
        monkeypatch,
        nodes,
        way(1, [1, 2, 3, 4, 1], {"leisure": "playground"}),
    )
    _with_dom(tile, h)
    furniture.run(tile)
    kinds = _by_kind(tile)
    assert "climb" not in kinds and "swing" not in kinds and len(kinds["slide"]) == 1
