"""What an OSM way on a bridge tells its deck (rail.bridge_way, BridgeWays)."""

import shapely

from bake.rail import BridgeWays, bridge_way

LINE = shapely.LineString([(0, 0), (30, 0)])


def test_a_bridge_name_is_one_that_names_a_bridge():
    assert bridge_way(LINE, "Schloßbrücke", '"bridge"=>"yes"').name == "Schloßbrücke"
    assert bridge_way(LINE, "Nicolaisteg", '"bridge"=>"yes"').name == "Nicolaisteg"
    # a street over the bridge is not its name; its bridge:name is
    assert bridge_way(LINE, "Budapester Straße", '"bridge"=>"yes"') is None
    way = bridge_way(LINE, "Budapester Straße", '"bridge"=>"yes","bridge:name"=>"Brücke X"')
    assert way.name == "Brücke X"


def test_a_bridge_built_before_1850_of_no_tagged_structure_is_a_masonry_arch():
    old = bridge_way(LINE, None, '"bridge"=>"yes","start_date"=>"1221/27"')
    assert (old.structure, old.dated) == ("arch", True)
    tagged = bridge_way(
        LINE, None, '"bridge"=>"yes","bridge:structure"=>"beam","start_date"=>"1800"'
    )
    assert (tagged.structure, tagged.dated) == ("beam", False)
    assert bridge_way(LINE, None, '"bridge"=>"yes","start_date"=>"1902"') is None


def test_not_a_bridge_says_nothing():
    assert bridge_way(LINE, "Schloßbrücke", '"bridge"=>"no"') is None
    assert bridge_way(LINE, "Schloßbrücke", None) is None


def test_a_way_runs_on_a_deck_when_half_of_it_lies_on_it():
    on = bridge_way(LINE, "Schloßbrücke", '"bridge"=>"yes"')
    beside = bridge_way(shapely.LineString([(0, 5), (30, 5)]), "Nebenbrücke", '"bridge"=>"yes"')
    deck = shapely.box(-2, -3, 32, 3)
    assert [w.name for w in BridgeWays([on, beside]).on(deck)] == ["Schloßbrücke"]
    assert BridgeWays([]).on(deck) == []
