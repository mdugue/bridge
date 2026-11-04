"""Reading OSM tag values (pipeline/bake/osm.py): one number parser for
every bake that reads a height, a width or a count."""

import pytest
import shapely

from bake.osm import osm_metres, osm_number


@pytest.mark.parametrize(
    ("value", "unsigned", "signed"),
    [
        ("1,5", 1.5, 1.5),  # a decimal comma
        ("2.5 m", 2.5, 2.5),  # a unit
        ("3", 3.0, 3.0),
        ("-1.2", 1.2, -1.2),  # a sign only when asked for
        ("ca. 4", 4.0, 4.0),  # text around it
        ("1;2", 1.0, 1.0),  # a list: its first
        ("abc", None, None),
        ("", None, None),
        (None, None, None),
    ],
)
def test_a_tag_value_reads_as_its_first_number(value, unsigned, signed):
    assert osm_number(value) == unsigned
    assert osm_number(value, signed=True) == signed


def test_the_bakes_read_a_decimal_comma_as_written():
    from bake.furniture import bollard
    from bake.lowveg import osm_height
    from bake.rail_osm import width_of as way_width
    from bake.riverside import width_of as pier_width
    from bake.stairs import tagged_rise

    assert bollard('"height"=>"1,2"') == {"h": 1.2}
    assert osm_height('"height"=>"1,5 m"') == 1.5
    assert pier_width('"width"=>"4,5"') == 4.5
    assert way_width('"width"=>"7,5"', "road") == 7.5
    assert tagged_rise('"step_count"=>"10","step:height"=>"0,15"') == pytest.approx(1.5)


@pytest.mark.parametrize(
    ("value", "metres"),
    [
        ("4", 4.0),
        ("4,5", 4.5),  # a decimal comma
        ("4.5 m", 4.5),
        ("4.5m", 4.5),
        ("12 meters", 12.0),
        ("1 metre", 1.0),
        ("ca. 4 m", 4.0),  # approximately, in metres
        ("approx 4", 4.0),
        ("~3", 3.0),
        ("12'", None),  # feet
        ("10 ft", None),
        ("6'6\"", None),
        ("40 in", None),
        ("approx 4 yd", None),
        ("2-3", None),  # a range
        ("3;4", None),  # a list
        ("4 m wide", None),
        ("narrow", None),
        ("", None),
        (None, None),
    ],
)
def test_a_length_reads_only_in_metres(value, metres):
    assert osm_metres(value) == metres


def test_every_width_reader_takes_metres_only():
    from bake.rail_osm import width_of as way_width
    from bake.riverside import PIER_WIDTH_M
    from bake.riverside import width_of as pier_width
    from bake.stairs import tagged_width
    from bake.surface import parse_width
    from bake.walls import GATE_W, gate_width

    feet = '"width"=>"12\'"'
    assert way_width(feet, "path") is None
    assert pier_width(feet) == PIER_WIDTH_M
    assert tagged_width(shapely.LineString([(0, 0), (0, 10)]), feet, []) is None
    assert parse_width("12'") is None
    assert gate_width("gate", feet) == GATE_W
