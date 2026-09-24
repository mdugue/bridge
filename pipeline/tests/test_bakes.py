"""Units of the bakes that need no raw data (the end-to-end comparison
against the committed artifacts is in docs/data-pipeline.md)."""

import shapely

from bake.common import round_coords
from bake.landcover import CLASSES
from bake.osm import tag
from bake.rail import buffer_line, merge_lines
from bake.walls import height, lines_of


def test_fragments_merge_across_shared_endpoints_to_the_metre():
    a = [(0.0, 0.0), (10.0, 0.0)]
    b = [(20.0, 0.0), (10.4, 0.2)]  # reversed, endpoint within the 1 m snap
    c = [(100.0, 0.0), (110.0, 0.0)]
    merged = merge_lines([a, b, c])
    assert len(merged) == 2
    chain = max(merged, key=len)
    assert {chain[0], chain[-1]} == {(0.0, 0.0), (20.0, 0.0)}


def test_a_centreline_buffers_into_a_closed_deck_outline():
    ring = buffer_line([(0.0, 0.0), (10.0, 0.0)], 2.0)
    assert len(ring) == 4
    assert shapely.Polygon(ring).area == 40.0


def test_wall_heights_come_from_the_tags_clamped():
    assert height('"height"=>"4 m"') == 4.0
    assert height('"est_height"=>"99"') == 30.0
    assert height(None) is None
    assert tag('"bridge:structure"=>"arch","x"=>"1"', "bridge:structure") == "arch"


def test_wall_polygons_contribute_their_outer_ring_only():
    square = shapely.Polygon(
        [(0, 0), (1, 0), (1, 1), (0, 1)], holes=[[(0.2, 0.2), (0.4, 0.2), (0.4, 0.4)]]
    )
    rings = lines_of(square)
    assert len(rings) == 1
    assert rings[0].is_ring


def test_coordinates_round_to_centimetres_and_drop_z():
    assert round_coords([[1.234, 5.678, 9.0]]) == [[1.23, 5.68]]


def test_the_class_ids_are_the_client_palette_order():
    # lib/city/landcover.ts keys its palette by these ids and names.
    assert list(CLASSES) == list(range(9))
    assert CLASSES[8] == "water"
