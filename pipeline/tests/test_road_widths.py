"""The road widths (pipeline/bake/road_widths.py): OSM's widths, lanes and
parking on the DLM's road axes."""

import shapely

from bake import road_widths

# --- B15 road widths --------------------------------------------------------


def test_osm_widths_lanes_and_parking():
    assert road_widths.osm_half('"width"=>"7.5"', 2, 2.5) == 3.75
    assert road_widths.osm_half('"width:carriageway"=>"6","width"=>"12"', 2, 2.5) == 3.0
    assert road_widths.osm_half('"lanes"=>"2"', None, 2.5) == 3.0
    both = '"lanes"=>"2","parking:both"=>"lane"'
    assert road_widths.osm_half(both, None, 2.5) == 5.0  # 6 m + 2 × 2 m
    half = '"parking:right"=>"half_on_kerb"'
    assert road_widths.osm_half(half, 2, 2.5) == 3.5  # 6 m + 1 m on the road
    assert road_widths.osm_half('"parking:both"=>"on_kerb"', 2, 2.5) == 3.0
    assert road_widths.osm_half(None, None, 2.5) == 2.5  # the class's width
    assert road_widths.osm_half('"lanes"=>"9"', None, 2.5) == road_widths.MAX_HALF_M


def test_a_dlm_axis_takes_the_width_of_the_way_along_it():
    axis = shapely.LineString([(0, 0), (100, 0)])
    along = shapely.LineString([(-5, 1.0), (60, 1.0)])  # 1 m off, the first 60 m
    across = shapely.LineString([(80, -50), (80, 50)])  # crosses it: not its way
    osm = road_widths.OsmCarWays([along, across], ['"width"=>"9"', '"width"=>"20"'])
    parts = road_widths.buffered(axis, osm, None, 2.5)
    assert len(parts) == 2
    wide, narrow = parts
    assert abs(wide.bounds[3] - 4.5) < 1e-6 and abs(narrow.bounds[3] - 2.5) < 1e-6
    assert road_widths.buffered(axis, None, None, 2.5)[0].bounds[3] == 2.5
