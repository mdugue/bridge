"""The door bake's pure parts: which entrances open on the ground floor,
how wide and high a door is, and where it lands on its wall."""

import shapely

from bake import doors


def test_ground_floor():
    assert doors.on_ground_floor(None)
    assert doors.on_ground_floor('"level"=>"0"')
    assert doors.on_ground_floor('"level"=>"-1;0"')
    assert not doors.on_ground_floor('"level"=>"1"')


def test_size_by_kind_and_tags():
    assert doors.size_of('"entrance"=>"main"') == doors.SIZES["main"]
    assert doors.size_of('"entrance"=>"yes"') == doors.DEFAULT_SIZE
    assert doors.size_of('"entrance"=>"yes","width"=>"1,4 m"') == (1.4, doors.DEFAULT_SIZE[1])
    # an implausible tag falls back to the kind's size
    assert doors.size_of('"entrance"=>"garage","height"=>"40"') == doors.SIZES["garage"]


def test_snap_lands_on_the_nearest_edge_facing_out():
    square = shapely.box(0, 0, 10, 10)
    x, y, nx, ny, room = doors.snap(shapely.Point(4, -1.5), square)
    assert (x, y) == (4, 0)
    assert (nx, ny) == (0, -1)
    assert room == 4
    # from inside the footprint too: the normal still points out
    x, y, nx, ny, _ = doors.snap(shapely.Point(9.5, 3), square)
    assert (x, y, nx, ny) == (10, 3, 1, 0)
