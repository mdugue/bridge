"""The rail layer's OSM stand-in (rail_osm.py) and the deck merging it uses."""

import shapely

from bake import rail_osm
from bake.rail import merged_decks


def test_tags_read_as_the_dlm_attributes_would():
    assert rail_osm.tracks_of('"tracks"=>"4"') == 4
    assert rail_osm.tracks_of(None) == 1
    assert rail_osm.electrified_of('"electrified"=>"contact_line"') == 1
    assert rail_osm.electrified_of('"electrified"=>"no"') == 0
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
