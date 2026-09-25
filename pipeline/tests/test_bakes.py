"""Units of the bakes that need no raw data (the end-to-end comparison
against the committed artifacts is in docs/data-pipeline.md)."""

import numpy as np
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


def _osm_tile(tmp_path, monkeypatch, ways: str):
    """A 200 m tile with a DGM that rises 4 m between y = 80 and y = 100 and
    an OSM XML extract holding `ways` over nodes 1–6: the flight's ends (1, 2),
    and the corners of a 6 m × 30 m outline around it (3–6)."""
    import numpy as np
    import rasterio
    from pyproj import Transformer

    from bake.common import Tile

    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    tile.dgm.parent.mkdir(parents=True)
    rows = np.arange(200)[:, None] + 0.5  # row 0 = north
    y = 200 - rows
    z = np.broadcast_to(100 + 4 * np.clip((y - 80) / 20, 0, 1), (200, 200)).astype("float32")
    with rasterio.open(
        tile.dgm,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(200),
    ) as dst:
        dst.write(z, 1)
    back = Transformer.from_crs(25833, 4326, always_xy=True)
    pts = [(100, 105), (100, 75), (97, 75), (103, 75), (103, 105), (97, 105)]
    nodes = "".join(
        f'<node id="{i + 1}" lat="{lat:.9f}" lon="{lon:.9f}" version="1"/>'
        for i, (px, py) in enumerate(pts)
        for lon, lat in [back.transform(x0 + px, y0 + py)]
    )
    osm = tmp_path / "raw" / "osm" / "t.osm"
    osm.parent.mkdir(parents=True)
    osm.write_text(f'<?xml version="1.0"?><osm version="0.6">{nodes}{ways}</osm>')
    monkeypatch.setattr(Tile, "osm_extract", lambda self: osm)
    return tile


def _read(tile, name):
    import json

    return json.loads((tile.data / "dlm" / f"{name}_t.geojson").read_text())


def test_a_flight_is_oriented_uphill_with_its_landings_and_tagged_steps(tmp_path, monkeypatch):
    from bake import stairs

    # Drawn top → bottom; 25 steps over the 4 m rise is a 16 cm riser.
    way = (
        '<way id="1" version="1"><nd ref="1"/><nd ref="2"/>'
        '<tag k="highway" v="steps"/><tag k="step_count" v="25"/><tag k="width" v="3 m"/></way>'
    )
    tile = _osm_tile(tmp_path, monkeypatch, way)
    stairs.run(tile)
    doc = _read(tile, "stairs")
    assert doc["attribution"].startswith("©")
    [f] = doc["features"]
    (xa, ya), (xb, yb) = f["geometry"]["coordinates"]
    assert ya < yb  # reversed to run bottom → top
    assert f["properties"]["w"] == 3.0
    assert f["properties"]["n"] == 25
    lo, hi = f["properties"]["z"]
    assert abs(lo - 100) < 0.1 and abs(hi - 104) < 0.1


def test_a_flight_without_a_width_takes_it_from_its_outline_and_derives_steps(
    tmp_path, monkeypatch
):
    from bake import stairs

    ways = (
        '<way id="1" version="1"><nd ref="2"/><nd ref="1"/><tag k="highway" v="steps"/>'
        '<tag k="step_count" v="3"/></way>'  # a 1.3 m riser: a typo, derived instead
        '<way id="2" version="1"><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/>'
        '<nd ref="3"/><tag k="area:highway" v="steps"/></way>'
        '<way id="3" version="1"><nd ref="3"/><nd ref="4"/><tag k="highway" v="footway"/></way>'
    )
    tile = _osm_tile(tmp_path, monkeypatch, ways)
    stairs.run(tile)
    [f] = _read(tile, "stairs")["features"]
    assert abs(f["properties"]["w"] - 6.0) < 0.05
    assert f["properties"]["n"] == 25


def test_flat_indoor_and_bridge_flights_are_left_out():
    from bake.stairs import skipped, step_count, width_of

    assert skipped('"indoor"=>"yes"')
    assert skipped('"bridge"=>"yes"')
    assert skipped('"level"=>"-1"')
    assert not skipped('"level"=>"0"')
    assert not skipped(None)
    assert step_count(1.6, None) == 10
    line = shapely.LineString([(0, 0), (10, 0)])
    outline = shapely.box(-1, -3, 11, 3)  # 12 m × 6 m around a 10 m axis
    assert width_of(line, None, [outline]) == 7.2  # area / length inside
    assert width_of(line, '"width"=>"100"', [outline]) == 30.0


def test_cliffs_come_through_as_walls_of_their_own_kind(tmp_path, monkeypatch):
    from bake import walls

    ways = (
        '<way id="1" version="1"><nd ref="3"/><nd ref="4"/><tag k="natural" v="cliff"/></way>'
        '<way id="2" version="1"><nd ref="5"/><nd ref="6"/><tag k="natural" v="tree_row"/></way>'
    )
    tile = _osm_tile(tmp_path, monkeypatch, ways)
    walls.run(tile)
    [f] = _read(tile, "walls")["features"]
    assert f["properties"] == {"kind": "cliff", "h": 3.0}
    assert walls.kind_of(None, None, '"natural"=>"cliff"') == "cliff"
    assert walls.kind_of("retaining_wall", None, '"natural"=>"cliff"') == "retaining_wall"


class _Bank:
    """A DGM stub: 100 m south of y = 0, rising 4 m to y = 20 across all x."""

    def at(self, x, y):
        return 100 + 4 * min(max(y / 20, 0), 1)


class _Flat:
    def at(self, x, y):
        return 112.0


def test_an_untagged_flight_spans_the_slope_between_its_walls():
    from bake.stairs import flight

    walls = [
        shapely.LineString([(-7, -5), (-7, 25)]),  # 7 m left
        shapely.LineString([(11, -5), (11, 25)]),  # 11 m right
    ]
    f = flight(shapely.LineString([(0, 1), (0, 19)]), None, [], _Bank(), walls, [])
    w = f["properties"]["w"]
    assert abs(w - (18 - 0.6)) < 1e-6
    (x0, _), (x1, _) = f["geometry"]["coordinates"]
    assert x0 == x1 == 2.0  # re-centred between the walls


def test_walls_too_far_or_on_one_side_leave_the_default_width():
    from bake.stairs import DEFAULT_W, flight

    line = shapely.LineString([(0, 1), (0, 19)])
    one_side = [shapely.LineString([(-3, -5), (-3, 25)])]
    assert flight(line, None, [], _Bank(), one_side, [])["properties"]["w"] == DEFAULT_W
    far = [shapely.LineString([(-30, -5), (-30, 25)]), shapely.LineString([(30, -5), (30, 25)])]
    assert flight(line, None, [], _Bank(), far, [])["properties"]["w"] == DEFAULT_W


def test_a_flight_onto_a_raised_area_the_dgm_lacks_takes_its_tagged_rise():
    from bake.stairs import flight

    terrace = shapely.box(20, -10, 60, 10)
    tags = '"step_count"=>"41","step:height"=>"0.15","incline"=>"up","width"=>"20"'
    line = shapely.LineString([(0, 0), (21, 0)])  # drawn upwards, ends on the terrace
    f = flight(line, tags, [], _Flat(), [], [terrace])
    assert f["properties"]["z"] == [112.0, 118.15]
    assert f["properties"]["n"] == 41
    assert f["terrace"] is terrace
    # Without a raised area at its top, the flight stays as flat as the DGM.
    assert flight(line, tags, [], _Flat(), [], []) is None


def test_only_plain_raised_areas_count_as_terraces():
    from bake.stairs import is_raised

    assert is_raised({"other_tags": '"layer"=>"1","highway"=>"pedestrian"'})
    assert not is_raised({"other_tags": '"layer"=>"-1"'})
    assert not is_raised({"other_tags": '"layer"=>"0"'})
    assert not is_raised({"other_tags": '"layer"=>"1"', "building": "yes"})
    assert not is_raised({"other_tags": '"layer"=>"1","railway"=>"platform"'})
    assert not is_raised({"other_tags": '"layer"=>"1"', "landuse": "railway"})


def test_a_terrace_platform_fills_the_holes_of_its_area():
    from bake.stairs import platform

    promenade = shapely.Polygon(
        [(0, 0), (40, 0), (40, 20), (0, 20)], holes=[[(10, 5), (20, 5), (20, 15), (10, 15)]]
    )
    assert platform(promenade).area == 800


def test_furniture_kinds_come_from_the_tags():
    from bake.furniture import kind_of

    assert kind_of(None, None, '"amenity"=>"bench"') == "bench"
    assert kind_of("bollard", None, None) == "bollard"
    assert kind_of(None, None, '"leisure"=>"picnic_table"') == "picnic"
    assert kind_of(None, "bus_stop", '"shelter"=>"yes"') == "shelter"
    assert kind_of(None, "bus_stop", '"shelter"=>"no"') is None
    stands = '"amenity"=>"bicycle_parking","bicycle_parking"=>"stands"'
    assert kind_of(None, None, stands) == "bike"
    assert kind_of(None, None, stands.replace("stands", "wall_loops")) is None
    assert kind_of(None, None, '"amenity"=>"restaurant"') is None


def test_furniture_indoors_or_underground_is_hidden():
    from bake.furniture import hidden

    assert hidden('"indoor"=>"yes"')
    assert hidden('"level"=>"-1"')
    assert not hidden('"level"=>"0"')
    assert not hidden(None)


def test_a_bench_direction_reads_degrees_or_a_compass_point():
    from bake.furniture import direction, hoops

    assert direction("SW") == 225.0
    assert direction("370") == 10.0
    assert direction("left") is None
    assert hoops("10") == 5
    assert hoops("1") == 1
    assert hoops("lots") == 1


def test_an_untagged_bench_faces_the_nearest_way_or_across_the_one_it_is_on():
    from bake.furniture import bench_on_way, facing

    lines = np.array([shapely.LineString([(0, 0), (100, 0)])], dtype=object)
    ways = shapely.STRtree(lines)
    # 5 m north of an east-west path: it looks south, onto it.
    assert facing(shapely.Point(50, 5), ways, lines) == 180.0
    # On the path: a quarter turn from its run (east → south).
    assert facing(shapely.Point(50, 0), ways, lines) == 180.0
    assert facing(shapely.Point(50, 500), ways, lines) is None
    # A bench mapped as a way north of the path faces it, at its length.
    mid, a, length = bench_on_way(shapely.LineString([(40, 3), (43, 3)]), ways, lines)
    assert (mid.x, mid.y, a, length) == (41.5, 3.0, 180.0, 3.0)


def test_a_bollard_keeps_its_tagged_height_and_metal():
    from bake.furniture import bollard

    # The Stallhof's bronze columns are mapped as bollards.
    assert bollard('"height"=>"1.46","material"=>"bronze"') == {"h": 1.46, "metal": True}
    assert bollard('"height"=>"40 m"') == {"h": 3.0}
    assert bollard(None) == {}


def test_playground_equipment_is_only_what_is_mapped():
    from bake.furniture import _equipment_piece, equipment_kind

    assert equipment_kind('"playground"=>"basketswing"') == "swing"
    assert equipment_kind('"playground"=>"structure"') == "climb"
    assert equipment_kind('"playground"=>"mound"') is None
    # A slide drawn as a way stands at its midpoint, turned along it.
    geom, props = _equipment_piece(shapely.LineString([(0, 0), (0, 4)]), "slide")
    assert (geom.x, geom.y, props) == (0.0, 2.0, {"k": "slide", "a": 0})
    # A sandpit drawn as an area keeps its outline; a point stays a point.
    square = shapely.Polygon([(0, 0), (3, 0), (3, 3), (0, 3)])
    assert _equipment_piece(square, "sandpit")[0].geom_type == "Polygon"
    assert _equipment_piece(shapely.Point(1, 1), "swing")[0].geom_type == "Point"
