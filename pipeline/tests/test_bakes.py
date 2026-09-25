"""Units of the bakes that need no raw data (the end-to-end comparison
against the committed artifacts is in docs/data-pipeline.md)."""

import math

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


def test_surface_values_map_to_the_paving_ids():
    from bake.surface import surface_id

    assert surface_id("asphalt") == 1
    assert surface_id("sett;asphalt") == 4
    assert surface_id("Paving_Stones") == 3
    assert surface_id("grass_paver") == 6
    assert surface_id("metal") == 0
    assert surface_id(None) == 0


def test_widths_parse_metres_and_reject_nonsense():
    from bake.surface import parse_width

    assert parse_width("5") == 5.0
    assert parse_width("5,5 m") == 5.5
    assert parse_width("narrow") is None
    assert parse_width("0") is None


def test_a_sidewalk_band_lies_on_the_tagged_side_only():
    from bake.surface import SIDEWALK_BAND, sidewalk_bands

    east = shapely.LineString([(0, 0), (100, 0)])  # left = north
    bands = sidewalk_bands(east, 4.0, '"sidewalk:left:surface"=>"paving_stones"')
    assert [sid for _, sid in bands] == [3]
    band = bands[0][0]
    assert band.bounds[1] >= 4.0 - 1e-6
    assert band.bounds[3] <= 4.0 + SIDEWALK_BAND + 1e-6
    both = sidewalk_bands(east, 4.0, '"sidewalk:both:surface"=>"sett"')
    assert sorted(sid for _, sid in both) == [4, 4]


def test_the_major_road_wins_a_junction_and_walks_pack_above_roads(tmp_path):
    from bake.common import Tile
    from bake.surface import burn, classify_lines, pack

    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    ns = shapely.LineString([(32, 0), (32, 64)])
    ew = shapely.LineString([(0, 32), (64, 32)])
    foot = shapely.LineString([(0, 10), (64, 10)])
    roads, walks = classify_lines(
        [ew, ns, foot],
        ["primary", "residential", "footway"],
        ['"surface"=>"asphalt"', '"surface"=>"sett"', '"surface"=>"paving_stones"'],
    )
    road = burn(roads, tile, 64)
    assert road[31, 32] == 1  # the crossing: the primary's asphalt
    assert road[5, 32] == 4  # the residential street's sett away from it
    walk = burn(walks, tile, 64)
    assert walk[64 - 10, 5] == 3
    packed = pack(road, walk)
    assert packed[64 - 10, 32] == 3 * 8 + 4


def test_a_street_frame_carries_its_bearing_and_the_distance_along_it(tmp_path):
    from bake.common import Tile
    from bake.surface import ALONG_PERIOD, direction_frames, heading_code

    assert list(heading_code(np.radians([0.0, 90.0, 180.0, 359.9]))) == [1, 65, 128, 1]
    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    # An L-shaped street: 40 m east, then north; a footway crossing it.
    road = shapely.LineString([(0, 32), (40, 32), (40, 64)])
    crossing = shapely.LineString([(20, 0), (20, 64)])
    heading, along = direction_frames(
        [road, crossing], ["residential", "footway"], [None, None]
    ).rasterise(tile, 64)

    def metres(row, col):
        # What the shader does: the offset plus the texel centre (from the
        # tile's north-west corner) projected on the decoded bearing.
        b = (heading[row, col] - 1) / 254.0 * 2.0 * np.pi
        x, y = col + 0.5, -(row + 0.5)
        offset = along[row, col] / 65536.0 * ALONG_PERIOD
        return (offset + x * np.cos(b) + y * np.sin(b)) % ALONG_PERIOD

    assert heading[31, 10] == 1  # east
    assert heading[31, 20] == 1  # a crossing footway does not turn it
    assert heading[5, 20] == 65  # the footway, north
    assert abs(metres(31, 10) - 10.5) < 0.01  # the texel centre, 10.5 m along
    # Round the bend: the northbound leg starts 40 m along the street.
    assert abs(metres(64 - 51, 40) - (40 + 18.5)) < 1.0
    assert heading[5, 50] == 0  # nothing mapped


def test_street_parking_marks_the_tagged_side_and_its_orientation():
    from bake.surface import street_parking

    east = shapely.LineString([(0, 0), (100, 0)])  # left = north
    tags = (
        '"parking:left"=>"lane","parking:right:orientation"=>"perpendicular",'
        '"parking:right"=>"street_side"'
    )
    lanes = street_parking(east, 4.0, tags)
    assert sorted(code for _, code in lanes) == [1, 2]
    left = next(g for g, code in lanes if code == 1)
    assert left.bounds[1] >= -1e-6  # north of the axis
    assert street_parking(east, 4.0, '"parking:both"=>"no"') == []


def test_car_parks_are_lots_on_the_ground_with_their_aisles_cleared(tmp_path):
    from bake.common import Tile
    from bake.surface import burn, is_car_park, pack, parking_shapes

    assert is_car_park("parking", '"parking"=>"surface"')
    assert is_car_park("parking_space", None)
    assert not is_car_park("parking", '"parking"=>"underground"')
    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    lot = shapely.box(10, 10, 50, 50)
    aisle = shapely.LineString([(10, 30), (50, 30)])
    park = burn(
        parking_shapes(
            [aisle], ["service"], ['"service"=>"parking_aisle"'], [lot], ["parking"], [None]
        ),
        tile,
        64,
    )
    packed = pack(np.zeros_like(park), np.zeros_like(park), park)
    assert packed[64 - 20, 30] >> 6 == 3  # a bay row
    assert packed[64 - 30, 30] >> 6 == 0  # the aisle
    assert packed[5, 5] == 0


def test_the_raster_interleaves_its_two_bytes_per_texel():
    from bake.surface import interleave

    r = np.array([[1, 2], [3, 4]], dtype=np.uint8)
    g = np.array([[9, 8], [7, 6]], dtype=np.uint8)
    assert interleave(r, g).tolist() == [[1, 9, 2, 8], [3, 7, 4, 6]]


def test_a_lot_without_an_aisle_runs_along_its_long_side():
    from bake.surface import heading_code, lot_frames

    frames = lot_frames([shapely.box(0, 0, 10, 40)], ["parking"], [None])
    assert heading_code(np.asarray(frames.bearing)).tolist() in ([65], [192])  # north-south
    assert frames.anchor == [(5.0, 20.0)]


def test_edge_distances_are_signed_and_smooth_across_a_diagonal():
    from bake.edges import distance_px, edge_field, signed_distance_px

    mask = np.zeros((9, 9), dtype=bool)
    mask[4, 4] = True
    d = distance_px(mask, 6)
    assert d[4, 4] == 0 and d[4, 5] == 1 and d[4, 8] == 4
    sd = signed_distance_px(np.arange(8)[None, :].repeat(8, 0) < 4, 6)
    assert sd[0, 3] == 0.5 and sd[0, 4] == -0.5  # the edge between cols 3 and 4
    # A diagonal road edge: the smoothed field's 0-isoline runs straight.
    n = 64
    rows, cols = np.mgrid[0:n, 0:n]
    cls = np.where(cols > rows, 7, 4).astype(np.uint8)
    field = edge_field(cls, 7, 1.0, n)
    diag = field[np.arange(8, 56), np.arange(8, 56)]
    assert np.all(np.abs(diag) < 0.6)


def test_kerb_lines_follow_the_road_edge_with_the_road_on_their_left(tmp_path):
    from bake.common import Tile
    from bake.edges import edge_field, kerb_lines

    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    cls = np.full((64, 64), 4, dtype=np.uint8)
    cls[20:30, :] = 7  # an east-west road, rows 20–29 (y 34–44 m)
    lines = kerb_lines(tile, edge_field(cls, 7, 1.0, 64), cls)
    assert len(lines) == 2
    for line in lines:
        xy = np.asarray(line.coords)
        d = xy[-1] - xy[0]
        left = xy[len(xy) // 2] + np.array([-d[1], d[0]]) / np.hypot(*d)
        assert 34.0 < left[1] < 44.0  # the road is on the left
    # Water beside the road: no kerb on that side.
    cls[30:, :] = 8
    assert len(kerb_lines(tile, edge_field(cls, 7, 1.0, 64), cls)) == 1


def test_osm_islands_carve_only_road_texels_lawn_over_walk(tmp_path, monkeypatch):
    from bake import landcover
    from bake.common import Tile

    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    raster = np.full((64, 64), 7, dtype=np.uint8)
    raster[:, :8] = 4  # a pavement strip the square's areas overlap
    square = shapely.box(0, 16, 48, 48)  # a pedestrian area
    lawn = shapely.box(24, 24, 40, 40)  # a lawn inside it
    monkeypatch.setattr(landcover, "osm_islands", lambda _: [(4, [square]), (1, [lawn])])
    changed = landcover.carve_islands(raster, tile)
    assert raster[64 - 32, 32] == 1  # the lawn wins inside the square
    assert raster[64 - 20, 16] == 4  # the square, off the lawn
    assert raster[64 - 5, 32] == 7  # outside both: still road
    assert raster[64 - 32, 4] == 4  # was built-up, untouched
    assert changed == np.count_nonzero(raster[:, 8:] != 7)
    assert landcover.carve_islands(raster, tile) == 0  # idempotent


def test_sports_grounds_take_their_surface_from_the_tag_else_the_sport():
    from bake.sport import classify

    assert classify("pitch", "soccer", None) == (1, 1)  # grass, football lines
    assert classify("pitch", "soccer", "artificial_turf") == (2, 1)
    assert classify("pitch", "tennis;padel", None) == (4, 2)  # clay by default
    assert classify("pitch", "beachvolleyball", "sand") == (5, 4)
    assert classify("pitch", "basketball", "tartan") == (3, 3)
    assert classify("track", None, None) == (3, 6)  # a tartan track, lanes
    assert classify("pitch", "table_tennis", None) == (6, 0)  # a hard pad, no lines
    assert classify("pitch", "curling", None) is None  # nothing to show
    assert classify("pitch", None, "sand") == (5, 0)  # an unknown sport: its surface
    assert classify("pitch", None, None) is None


def test_a_pitch_is_a_rotated_rectangle_along_its_long_side():
    from bake.sport import frame

    pitch = shapely.affinity.rotate(shapely.box(-50, -30, 50, 30), 30, origin=(0, 0))
    shape, (cx, cy, angle, hl, hw, _) = frame(pitch, 1)
    assert shape == 0
    assert (round(cx, 6), round(cy, 6)) == (0, 0)
    assert round(math.degrees(angle) % 180, 3) == 30
    assert (round(hl, 3), round(hw, 3)) == (50, 30)


def test_an_oval_track_is_a_capsule_band_of_its_measured_width():
    from bake.sport import frame

    straight, outer, band = 42.0, 46.0, 8.0
    core = shapely.LineString([(-straight, 0), (straight, 0)])
    ring = shapely.difference(core.buffer(outer), core.buffer(outer - band))
    shape, (_, _, _, a, r, w) = frame(ring, 6)
    assert shape == 1
    assert abs(a - straight) < 0.1
    assert abs(r - outer) < 0.1
    assert abs(w - band) < 0.2
    # A narrow bent strip is no oval: it keeps a rectangle or its outline.
    strip = shapely.LineString([(0, 0), (40, 0), (60, 8)]).buffer(2.0)
    assert frame(strip, 6)[0] != 1


def test_the_index_raster_names_a_court_inside_a_larger_ground(tmp_path):
    from bake.common import Tile
    from bake.sport import index_raster

    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    big = shapely.box(4, 4, 60, 60)
    court = shapely.box(20, 20, 40, 40)
    raster = index_raster([big, court], tile, 64)
    assert raster.shape == (64, 64, 4)
    assert raster[64 - 30, 30].tolist()[:3] == [2, 1, 255]  # the court, then the ground
    assert raster[64 - 10, 10].tolist()[:3] == [1, 1, 255]
    assert raster[33, 3, 0] == 1  # the grown edge, half a metre out
    assert raster[33, 1].tolist()[:3] == [0, 1, 0]  # only the wider growth


def _cadastre_tree(x, y, h=None, d=None, botanical="Tilia cordata", german="Winter-Linde"):
    return {
        "properties": {
            "gis_x_utm": x,
            "gis_y_utm": y,
            "baumhoehe_akt": h,
            "kronendurchmesser_akt": d,
            "art_botanisch": botanical,
            "art_deutsch": german,
        }
    }


def test_the_tile_owns_its_cadastre_trees_and_skips_stumps():
    from bake.trees import parse_trees

    raw = {
        "features": [
            _cadastre_tree(100.0, 100.0, 12, 8),
            _cadastre_tree(200.0, 100.0, 12, 8),  # the east seam: the neighbour's
            _cadastre_tree(150.0, 150.0, 2, 1, botanical="Stammstück"),
        ]
    }
    trees = parse_trees(raw, (0.0, 0.0, 200.0, 200.0))
    assert [(t["x"], t["y"]) for t in trees] == [(100.0, 100.0)]
    assert trees[0]["leaf"] == "d"


def test_missing_sizes_come_from_the_tiles_own_trees_clamped():
    from bake.trees import H_MAX, impute, parse_trees

    raw = {
        "features": [
            *(_cadastre_tree(float(i), 1.0, 10, 5) for i in range(3)),
            _cadastre_tree(9.0, 1.0, None, None),  # both imputed: genus median, ratio
            _cadastre_tree(8.0, 1.0, 99, None),  # clamped
        ]
    }
    sizes, imputed_h, imputed_d = impute(parse_trees(raw, (0.0, 0.0, 10.0, 10.0)))
    assert (imputed_h, imputed_d) == (1, 2)
    assert sizes[3] == (10, 5)
    assert sizes[4][0] == H_MAX


def test_a_cadastre_tree_in_forest_is_flagged():
    from bake.trees import tree_features

    cls = np.zeros((4, 4), dtype=np.uint8)
    cls[0, 0] = 2  # forest in the north-west corner
    tree = {"x": 1.0, "y": 9.0, "archetype": 0, "leaf": "d", "foliage": 1, "globe": True}
    f = tree_features([tree], [(10.0, 6.0)], cls, (0.0, 0.0, 10.0, 10.0))[0]
    assert f["properties"] == {"h": 10.0, "d": 6.0, "a": 0, "l": "d", "c": 1, "g": 1, "f": 1}


def test_only_the_osm_hedges_ship():
    from bake.lowveg import hedge_feature, shipped, shrub_feature

    line = shapely.LineString([(0, 0), (5, 0)])
    feats = [
        hedge_feature(line, 1.43, 1.0, "osm"),
        hedge_feature(line, 1.2, 0.8, "osm+lsc"),
        hedge_feature(line, 1.2, 0.8, "lsc"),
        shrub_feature(shapely.Point(1, 1), 1.5, 1.0, "lsc"),
    ]
    kept = shipped(feats)
    assert [f["properties"]["src"] for f in kept] == ["osm", "osm+lsc"]
    assert kept[0]["properties"]["h"] == 1.4


def test_a_hedge_height_tag_is_read_when_plausible():
    from bake.lowveg import osm_height

    assert osm_height('"height"=>"1.8 m"') == 1.8
    assert osm_height('"height"=>"12"') is None
    assert osm_height(None) is None


def test_scan_trees_a_cadastre_tree_claims_are_dropped(tmp_path):
    from bake.lowveg import cadastre_filter

    trees = tmp_path / "trees.geojson"
    trees.write_text(
        '{"features":[{"geometry":{"type":"Point","coordinates":[0,0]},"properties":{"d":12}}]}'
    )

    def point(x):
        return {"geometry": {"type": "Point", "coordinates": [x, 0.0]}, "properties": {}}

    # 3 m: within the 4 m floor; 5.5 m: inside the 6 m crown; 7 m: its own tree
    kept, dropped = cadastre_filter([point(3.0), point(5.5), point(7.0)], trees)
    assert dropped == 2
    assert [f["geometry"]["coordinates"][0] for f in kept] == [7.0]


def test_a_closed_hedge_way_stays_a_line_of_hedge():
    from bake.lowveg import hedge_rings

    square = shapely.Polygon([(0, 0), (4, 0), (4, 4), (0, 4)])
    rings = hedge_rings(square)
    assert len(rings) == 1
    assert rings[0].is_ring and rings[0].length == 16.0


def test_a_laser_scan_rasterises_by_pdals_binning_rules(tmp_path):
    import laspy
    import rasterio

    from bake.lsc import rasterise

    # A 4 m tile at 0.5 m = 8×8 cells. Two ground points in the south-west
    # cell (the first in file order is its idw, as PDAL's bin mode has it),
    # one in the cell diagonally north-east of the empty cell north of it,
    # a 1.5 m shrub return and a 12 m crown return (two echoes) in that cell.
    # A last non-ground return 0.1 m over the DTM's idw but 0.6 m over its
    # min: PDAL's hag_dem reads band 2, which is `idw` in PDAL's band order.
    x = [0.1, 0.25, 0.75, 0.25, 0.3, 0.2]
    y = [0.1, 0.25, 1.25, 0.75, 0.7, 0.8]
    z = [101.0, 100.0, 104.0, 103.5, 114.0, 102.6]
    header = laspy.LasHeader(point_format=6, version="1.4")
    header.scales = [0.01, 0.01, 0.01]
    header.offsets = [0, 0, 0]
    las = laspy.LasData(header)
    las.x, las.y, las.z = np.array(x), np.array(y), np.array(z)
    las.classification = np.array([2, 2, 2, 20, 20, 20], np.uint8)
    las.number_of_returns = np.array([1, 1, 1, 1, 2, 1], np.uint8)
    las.intensity = np.array([0, 0, 0, 1000, 3000, 5000], np.uint16)
    laz = tmp_path / "t.laz"
    las.write(laz)
    rasterise(laz, tmp_path, (0.0, 0.0, 4.0, 4.0), 25833)

    def band(name, desc):
        with rasterio.open(tmp_path / name) as ds:
            return ds.read(list(ds.descriptions).index(desc) + 1)

    idw = band("dtm_050.tif", "idw")
    assert idw[7, 0] == 101.0  # the first point, not the one on the centre
    assert band("dtm_050.tif", "min")[7, 0] == 100.0
    assert band("dtm_050.tif", "count")[7, 0] == 2
    # the empty cell north of it: its two donors are both 1 cell away by
    # Chebyshev distance (the diagonal one would be √2 by Euclid's)
    assert idw[6, 0] == 102.5
    assert band("dtm_050.tif", "min")[6, 0] == 102.0
    assert band("dsm_050.tif", "max")[6, 0] == 114.0
    assert band("nonground_count_050.tif", "count")[6, 0] == 3
    with rasterio.open(tmp_path / "dtm_050.tif") as ds:
        assert ds.descriptions == ("min", "idw", "count")  # PDAL's band order
    assert band("nonground_multiecho_count_050.tif", "count")[6, 0] == 1
    # only the shrub return is 0.25–4 m above the DTM
    assert band("lowint_050.tif", "mean")[6, 0] == 1000.0
    assert band("lowint_050.tif", "count")[6, 0] == 1
    assert band("lowint_050.tif", "mean")[0, 7] == -9999.0
