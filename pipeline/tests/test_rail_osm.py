"""The rail layer's OSM stand-in (rail_osm.py) and the deck merging it uses."""

import numpy as np
import shapely
import shapely.geometry

from bake import rail, rail_osm
from bake.rail import merged_decks
from tests.synthetic import SIZE, X0, Y0, along, feature_line, osm_tile, straight, tags, way


def test_tags_read_as_the_dlm_attributes_would():
    assert rail_osm.tracks_of('"tracks"=>"4"') == 4
    assert rail_osm.tracks_of(None) == 1
    assert rail_osm.electrified_of('"electrified"=>"contact_line"') == 1
    assert rail_osm.electrified_of('"electrified"=>"yes"') == 1
    assert rail_osm.electrified_of('"electrified"=>"rail"') == 2  # a third rail
    assert rail_osm.electrified_of('"electrified"=>"4th_rail"') == 2
    assert rail_osm.electrified_of('"electrified"=>"no"') == 0
    assert rail_osm.electrified_of(None) is None  # untagged: unknown, not none
    assert rail_osm.layer_of('"layer"=>"-1"') == -1
    assert rail_osm.gauge_of('"gauge"=>"1000"') == 1.0
    assert rail_osm.gauge_of('"gauge"=>"1435;1000"') == 1.435  # dual gauge: the wider
    assert rail_osm.kind_of(None, "subway") == "rail"
    assert rail_osm.kind_of("footway", None) == "path"
    assert rail_osm.kind_of("primary", None) == "road"
    assert rail_osm.kind_of("proposed", None) is None
    assert rail_osm.width_of('"width"=>"7.5"', "road") == 7.5
    assert rail_osm.width_of('"lanes"=>"2"', "road") == 2 * 3.25 + 2
    assert rail_osm.width_of(None, "path") is None
    assert rail_osm.is_bridge('"bridge"=>"viaduct"')
    assert not rail_osm.is_bridge('"bridge"=>"no"')


def test_a_carriageway_and_its_pavements_are_one_deck():
    # a road bridge mapped as three ways side by side, a footbridge 200 m on
    road = shapely.LineString([(0, 0), (60, 0)])
    left = shapely.LineString([(0, 6), (60, 6)])
    right = shapely.LineString([(0, -6), (60, -6)])
    foot = shapely.LineString([(260, 0), (300, 0)])
    decks = merged_decks(
        [
            (road, "Kennedybrücke", "road", 9.0, 1),
            (left, None, "path", 3.0, 1),
            (right, None, "path", 3.0, 1),
            (foot, None, "path", 3.5, 1),
        ]
    )
    assert len(decks) == 2
    big = max(decks, key=lambda d: shapely.Polygon(d[0]).area)
    ring, name, kind, centre = big
    assert name == "Kennedybrücke"
    assert kind == "road"  # the weightiest kind of its ways
    assert centre[0] == (0.0, 0.0) and centre[-1] == (60.0, 0.0)
    assert shapely.Polygon(ring).bounds[1] <= -7.0  # spans the pavements


def test_ways_on_different_levels_stay_apart():
    under = shapely.LineString([(0, 0), (50, 0)])
    over = shapely.LineString([(25, -20), (25, 20)])
    decks = merged_decks([(under, None, "road", 8.0, 1), (over, None, "rail", 6.0, 2)])
    assert sorted(d[2] for d in decks) == ["rail", "road"]


def member(coords, kind, width=None, name=None):
    return rail.Member(shapely.LineString(coords), name, kind, width, 0)


def test_rails_and_a_road_on_one_outline_are_two_decks():
    # the Lombardsbrücke: one footprint, the railway beside the road
    poly = shapely.box(0.0, -10.0, 100.0, 10.0)
    members = [
        member([(0.0, 5.0), (100.0, 5.0)], "rail"),
        member([(0.0, -5.0), (100.0, -5.0)], "road", name="Lombardsbrücke"),
    ]
    decks = rail.footprint_decks(poly, members)
    kinds = sorted(d[2] for d in decks)
    assert kinds == ["rail", "road"]
    for ring, name, kind, centre in decks:
        area = shapely.Polygon(ring).area
        assert 900.0 <= area <= 1100.0
        assert name == "Lombardsbrücke"
        assert (centre[0][1] > 0) == (kind == "rail")
    # one network: one deck, as before
    road = [member([(0.0, -5.0), (100.0, -5.0)], "road"), member([(0, 8), (100, 8)], "path")]
    assert [d[2] for d in rail.footprint_decks(poly, road)] == ["road"]


def test_merged_ways_split_by_the_network_they_carry():
    loose = [
        (shapely.LineString([(0.0, 0.0), (80.0, 0.0)]), None, "road", 7.0, 0),
        (shapely.LineString([(0.0, 6.0), (80.0, 6.0)]), None, "rail", 5.0, 0),
    ]
    decks = rail.merged_decks(loose)
    assert sorted(d[2] for d in decks) == ["rail", "road"]


def test_a_ways_passage_is_as_wide_as_it_is_mapped():
    margin = rail_osm.PASSAGE_MARGIN
    assert rail_osm.passage_half("primary", '"width"=>"9"') == 4.5 + margin
    assert rail_osm.passage_half("primary", '"lanes"=>"2"') == 2 * 1.6 + margin
    assert rail_osm.passage_half("footway", None) == 1.25 + margin
    assert rail_osm.passage_half("residential", '"width"=>"wide"') > margin


ROAD, RAILWAY = 7, 5


def test_each_track_carries_its_bridge_layer_gauge_and_current(tmp_path, monkeypatch):
    nodes = {
        **straight(20, first=1),
        **straight(60, first=3),
        **straight(100, first=5),
        **straight(140, first=7),
    }
    ways = (
        way(1, [1, 2], {"railway": "rail", "electrified": "contact_line"})
        + way(2, [3, 4], {"railway": "rail", "bridge": "yes", "layer": "1"})
        + way(3, [5, 6], {"railway": "light_rail", "electrified": "rail", "layer": "-1"})
        + way(4, [7, 8], {"railway": "narrow_gauge", "gauge": "750"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    features = rail_osm.rails(tile)
    props = {y: along(features, y)[0]["properties"] for y in (20, 60, 100, 140)}
    assert props[20] == {"tracks": 1, "electrified": 1, "bridge": 0}
    assert props[60] == {"tracks": 1, "electrified": 0, "bridge": 1, "layer": 1}
    assert props[100] == {"tracks": 1, "electrified": 2, "bridge": 0, "layer": -1}
    assert props[140]["g"] == 0.75
    # clipped to the tile: the next tile draws its own piece
    for f in features:
        x0, _, x1, _ = feature_line(f).bounds
        assert x0 >= X0 - 0.01 and x1 <= X0 + SIZE + 0.01


def test_a_covered_stretch_or_a_tunnel_is_not_drawn(tmp_path, monkeypatch):
    nodes = {
        **straight(20, first=1),
        **straight(60, x0=80, x1=100, first=3),
        **straight(100, first=5),
    }
    ways = (
        way(1, [1, 2], {"railway": "rail", "covered": "yes"})  # 240 m under a lid
        + way(2, [3, 4], {"railway": "rail", "covered": "yes"})  # 20 m: a footbridge
        + way(3, [5, 6], {"railway": "rail", "tunnel": "yes"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    features = rail_osm.rails(tile)
    assert not along(features, 20)
    assert len(along(features, 60)) == 1
    assert not along(features, 100)
    # …but each still claims the DLM's line beside it
    taken = rail_osm.claimed(tile, 6.0)
    assert taken.contains(shapely.Point(X0 + 100, Y0 + 100))


def test_a_siding_across_a_paved_yard_has_no_ballast_bed(tmp_path, monkeypatch):
    # a quay's paving x 0–120, then the railway's land; a siding and a main
    # line run through both, and an embedded way along the street
    cls = np.full((SIZE, SIZE), RAILWAY, np.uint8)
    cls[:, :120] = ROAD
    nodes = {**straight(40, first=1), **straight(100, first=3), **straight(160, first=5)}
    ways = (
        way(1, [1, 2], {"railway": "rail", "service": "siding"})
        + way(2, [3, 4], {"railway": "rail"})
        + way(3, [5, 6], {"railway": "rail", "embedded": "yes"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)
    features = rail_osm.rails(tile)
    siding = along(features, 40)
    paved = [f for f in siding if f["properties"].get("paved")]
    assert len(paved) == 1
    x0, _, x1, _ = feature_line(paved[0]).bounds
    assert x0 - X0 < 5 and 100 < x1 - X0 < 130
    assert not any(f["properties"].get("paved") for f in along(features, 100))
    assert all(f["properties"].get("paved") for f in along(features, 160))
    area = shapely.union_all(
        [shapely.geometry.shape(f["geometry"]) for f in rail_osm.ballast(tile, features)]
    )
    assert not area.contains(shapely.Point(X0 + 50, Y0 + 40))  # the quay
    assert area.contains(shapely.Point(X0 + 170, Y0 + 40))  # the siding's bed
    assert area.contains(shapely.Point(X0 + 50, Y0 + 100))  # the main line
    assert not area.contains(shapely.Point(X0 + 50, Y0 + 160))  # embedded


def test_a_mapped_catenary_mast_stands_beside_its_track(tmp_path, monkeypatch):
    nodes = {
        **straight(50, x0=0, x1=SIZE, first=1),
        10: (80, 54, tags(power="catenary_mast")),
        11: (150, 80, tags(power="catenary_mast")),  # 30 m off: another's
        # a tram along y 36: the mast between it and the railway is the
        # tram's (the tram layer stands it)
        12: (0, 36, ""),
        13: (SIZE, 36, ""),
        14: (130, 40, tags(power="catenary_mast")),
    }
    ways = way(1, [1, 2], {"railway": "rail", "electrified": "contact_line"}) + way(
        2, [12, 13], {"railway": "tram"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    features = rail_osm.rails(tile)
    rail_osm.masts(tile, features)
    [track] = along(features, 50)
    [(station, offset)] = track["properties"]["m"]
    assert abs(station - 80) < 0.5
    assert abs(offset - 4) < 0.1  # on its left, going east


def test_a_funicular_is_a_steep_track_under_no_catenary(tmp_path, monkeypatch):
    nodes = {**straight(20, first=1), **straight(60, first=3)}
    ways = way(
        1, [1, 2], {"railway": "funicular", "electrified": "contact_line", "gauge": "1000"}
    ) + way(2, [3, 4], {"railway": "funicular", "bridge": "yes", "layer": "1"})
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    features = rail_osm.rails(tile)
    on_ground = along(features, 20)[0]["properties"]
    assert on_ground["steep"] == 1
    assert on_ground["electrified"] == 0  # a cable hauls it
    assert on_ground["g"] == 1.0
    assert along(features, 60)[0]["properties"]["bridge"] == 1
    # a deck it runs on is a rail deck, measured at a funicular's grade
    bridge = rail.bridge_way(
        shapely.LineString([(0, 0), (50, 0)]), None, '"bridge"=>"yes"', "funicular"
    )
    assert bridge is not None and bridge.steep


def test_a_beam_stretched_over_posts_spans_a_hollow_and_bends_over_a_crest():
    assert rail_osm.upper_hull([0, 10, 20, 30], [0, -5, -5, 0]) == [0, 0, 0, 0]
    assert rail_osm.upper_hull([0, 10, 20], [0, 5, 0]) == [0, 5, 0]
    # on a slope it is the slope
    assert rail_osm.upper_hull([0, 10, 20], [0, 3, 6]) == [0, 3, 6]


def test_a_monorails_beam_clears_the_ground_everywhere_and_crosses_a_hollow_straight():
    line = shapely.LineString([(0, 0), (100, 0)])

    def hollow(x: float, _y: float) -> float:
        return 100.0 - max(0.0, 20.0 - abs(x - 50.0))  # 20 m deep at x = 50

    beam = rail_osm.beam_samples(line, hollow, rail_osm.HANGING_CLEARANCE_M)
    assert beam is not None
    # one straight span from rim to rim: only its ends are kept
    assert [(round(x), round(z, 2)) for x, _, z in beam] == [(0, 105.5), (100, 105.5)]
    assert rail_osm.beam_samples(line, lambda x, _y: None, 5.5) is None

    def crest(x: float, _y: float) -> float:
        return 100.0 + max(0.0, 10.0 - abs(x - 50.0))  # a 10 m crest at x = 50

    over = rail_osm.beam_samples(line, crest, 5.5)
    assert over is not None
    for x, _, z in over:
        assert z >= crest(x, 0) + 5.5 - 1e-6
    assert max(z for *_, z in over) == 115.5


def test_a_monorails_beam_is_cut_at_the_tile_with_its_heights():
    beam = [(0.0, 0.0, 100.0), (200.0, 0.0, 140.0)]
    box = shapely.box(50, -10, 250, 10)
    [f] = rail_osm._clipped_beam(beam, box, "hanging", 2)
    assert f["properties"]["mono"] == "hanging"
    assert f["properties"]["tracks"] == 2
    assert f["geometry"]["coordinates"][0] == [50.0, 0.0]
    assert f["properties"]["bz"] == [110.0, 140.0]
