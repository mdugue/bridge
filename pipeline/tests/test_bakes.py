"""Units of the bakes that need no raw data (the end-to-end comparison
against the committed artifacts is in docs/data-pipeline.md)."""

import shapely

from bake.common import owns, round_coords
from bake.landcover import CLASSES
from bake.osm import tag
from bake.rail import buffer_line, is_platform, merge_lines
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


def test_rail_without_a_dlm_leaves_committed_files_alone(tmp_path):
    from bake import rail
    from bake.common import Tile

    out = tmp_path / "data" / "dlm"
    out.mkdir(parents=True)
    committed = out / "rail_t.geojson"
    committed.write_text('{"features": [1]}')
    tile = Tile("t", (0.0, 0.0, 2000.0, 2000.0), 25833, tmp_path / "raw", tmp_path / "data")
    rail.run(tile)
    assert committed.read_text() == '{"features": [1]}'
    assert sorted(p.name for p in out.iterdir()) == ["rail_t.geojson"]


def test_a_polygon_clipped_away_yields_no_wall():
    clipped = shapely.intersection(shapely.box(10, 10, 11, 11), shapely.box(0, 0, 1, 1))
    assert lines_of(clipped) == []


def test_platforms_come_from_railway_or_public_transport_on_a_railway():
    assert is_platform("platform", None)
    assert is_platform(None, '"railway"=>"platform"')
    assert is_platform(None, '"public_transport"=>"platform","railway"=>"platform_edge"')
    assert not is_platform(None, '"public_transport"=>"platform","highway"=>"bus_stop"')
    assert not is_platform(None, None)


def test_a_point_on_a_seam_belongs_to_one_tile():
    west = (410_000.0, 5_656_000.0, 412_000.0, 5_658_000.0)
    east = (412_000.0, 5_656_000.0, 414_000.0, 5_658_000.0)
    assert not owns(west, 412_000.0, 5_657_000.0)
    assert owns(east, 412_000.0, 5_657_000.0)
    assert not owns(east, 411_950.0, 5_657_000.0)


def test_a_dlm_monument_is_a_fountain_by_its_code_or_its_name():
    from bake.monuments import dlm_kind

    assert dlm_kind("1780", None) == "fountain"
    assert dlm_kind("1750", "Cholerabrunnen") == "fountain"
    assert dlm_kind("1750", "Pferdetränke") == "fountain"
    assert dlm_kind("1770", "Postmeilensäule") == "column"
    assert dlm_kind("1770", "Weichbildstein") == "stone"
    assert dlm_kind("1750", "Böttgerstele") == "stone"
    assert dlm_kind("1750", "Goldener Reiter") == "statue"
    assert dlm_kind("1750", None) == "statue"


def test_a_basin_outline_becomes_a_rim_with_the_water_as_its_hole():
    from bake.monuments import RIM_M, basin_geometry

    rim = basin_geometry(shapely.MultiPolygon([shapely.box(0, 0, 10, 10)]))
    assert rim.geom_type == "Polygon"
    assert len(rim.interiors) == 1
    assert shapely.Polygon(rim.interiors[0]).area == (10 - 2 * RIM_M) ** 2
    # Too small to inset: a solid bowl; smaller still: a spout (a point).
    assert len(basin_geometry(shapely.box(0, 0, 0.6, 2)).interiors) == 0
    assert basin_geometry(shapely.box(0, 0, 0.5, 0.5)).geom_type == "Point"


def test_a_dlm_monument_on_an_osm_fountain_names_it_and_stands_in_it():
    from bake.monuments import conflate

    basin = shapely.box(0, 0, 16, 16)
    dlm = [
        {"geom": shapely.Point(8, 8), "kind": "statue", "name": "Stilles Wasser"},
        {"geom": shapely.Point(100, 100), "kind": "statue", "name": "Goldener Reiter"},
        {"geom": shapely.Point(300, 300), "kind": "fountain", "name": "Queckbrunnen"},
    ]
    osm = [
        {"geom": basin, "name": None, "style": "basin"},
        {"geom": shapely.Point(200, 200), "name": "Kugelbrunnen", "style": "basin"},
    ]
    out = {o["name"]: o for o in conflate(dlm, osm)}
    assert out["Stilles Wasser"]["kind"] == "fountain"
    assert out["Stilles Wasser"]["figure"] is True
    assert out["Stilles Wasser"]["source"] == "dlm+osm"
    assert out["Stilles Wasser"]["geom"].geom_type == "Polygon"
    assert out["Goldener Reiter"]["kind"] == "statue"
    assert out["Queckbrunnen"]["source"] == "dlm"
    assert out["Kugelbrunnen"]["source"] == "osm"
    assert out["Kugelbrunnen"]["figure"] is False
    assert len(out) == 4


def test_osm_fountain_tags_pick_the_basin_style():
    from bake.monuments import classify_fountain

    assert classify_fountain("splash_pad", None) == "splash"
    assert classify_fountain(None, "reflecting_pool") == "pool"
    assert classify_fountain("decorative", "fountain") == "basin"


def test_a_sculpture_in_a_basin_is_measured_into_a_relief():
    import numpy as np

    from bake.monuments import measure_relief

    ndom = np.zeros((40, 40))
    ndom[18:22, 18:22] = 3.7  # a 4 × 4 m body, 3.7 m tall
    basin = shapely.Polygon(
        [(8, 8), (32, 8), (32, 32), (8, 32)], holes=[[(9, 9), (31, 9), (31, 31), (9, 31)]]
    )
    # The grid's north-west corner is (0, 40): row 18 spans y 22..21.
    relief = measure_relief(ndom, (0.0, 40.0), basin, "fountain")
    assert relief is not None
    assert (relief["cols"], relief["rows"]) == (6, 6)  # the body + one empty cell round it
    assert max(relief["dm"]) == 37
    assert (relief["west"], relief["north"]) == (17.0, 23.0)


def test_a_monument_under_a_tree_crown_has_no_relief():
    import numpy as np

    from bake.monuments import measure_relief

    ndom = np.zeros((40, 40))
    ndom[19:21, 19:21] = 3.0  # the statue
    point = shapely.Point(20.0, 20.0)
    assert measure_relief(ndom, (0.0, 40.0), point, "statue") is not None
    ndom[15:19, 17:24] = 12.0  # a crown right beside it
    assert measure_relief(ndom, (0.0, 40.0), point, "statue") is None
