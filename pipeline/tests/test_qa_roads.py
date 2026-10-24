"""QA batch two, roads and ground (B15, B16, B18–B26): the road widths,
parking, crossings, lanes, path defaults, sidewalk bands and the arable
class."""

import re
from pathlib import Path

import numpy as np
import shapely
from PIL import Image

from bake import landcover, landcover_osm, road_widths, surface
from bake.common import Tile
from bake.markings import (
    CENTRE,
    CENTRE_SOLID,
    CYCLE,
    CYCLE_SOLID,
    CYCLE_WIDE,
    FURT,
    KERB,
    LANE_LINES,
    RED,
    ZEBRA,
    centre_bits,
    crossing_kind,
    cycle_lane_bits,
    cycle_sides,
    is_red_track,
    run,
)
from tests.synthetic import SIZE, osm_tile, way

ROOT = Path(__file__).resolve().parents[2]


# --- B24 crossings ----------------------------------------------------------


def test_a_zebra_only_where_osm_says_zebra():
    assert crossing_kind('"crossing:markings"=>"zebra"') == ZEBRA
    assert crossing_kind('"crossing:markings"=>"ladder:paired"') == ZEBRA
    assert crossing_kind('"crossing"=>"uncontrolled","crossing_ref"=>"zebra"') == ZEBRA
    assert crossing_kind('"traffic_sign"=>"DE:350"') == ZEBRA
    assert crossing_kind('"crossing_ref"=>"zebra","crossing:markings"=>"no"') == 0
    # marked / uncontrolled alone: mostly unmarked in the orthophotos
    assert crossing_kind('"crossing"=>"marked"') == 0
    assert crossing_kind('"crossing"=>"uncontrolled"') == 0


def test_lines_and_signals_paint_the_two_line_crossing():
    for value in ("lines", "dashes", "dots", "yes", "dashes;surface"):
        assert crossing_kind(f'"crossing:markings"=>"{value}"') == FURT, value
    assert crossing_kind('"crossing"=>"traffic_signals"') == FURT
    assert crossing_kind('"crossing:signals"=>"yes"') == FURT
    assert crossing_kind('"crossing"=>"traffic_signals","crossing:markings"=>"no"') == 0
    assert crossing_kind('"crossing:markings"=>"surface"') == 0


# --- B25 centre lines -------------------------------------------------------


def test_centre_lines_solid_where_overtaking_is_forbidden():
    assert centre_bits("secondary", '"lanes"=>"2"') == CENTRE
    assert centre_bits("secondary", '"lanes"=>"2","overtaking"=>"no"') == CENTRE | CENTRE_SOLID
    both = '"lanes"=>"2","overtaking:forward"=>"no","overtaking:backward"=>"no"'
    assert centre_bits("primary", both) == CENTRE | CENTRE_SOLID
    assert centre_bits("primary", '"lanes"=>"2","overtaking:forward"=>"no"') == CENTRE
    assert centre_bits("primary", '"lanes"=>"2","divider"=>"solid_line"') & CENTRE_SOLID
    # a divider that is a thing: no paint between the directions
    assert centre_bits("primary", '"lanes"=>"2","divider"=>"kerb"') == 0
    assert centre_bits("primary", '"lanes"=>"2","oneway"=>"yes"') == 0


def test_four_lanes_have_lane_lines_and_a_solid_middle():
    assert centre_bits("primary", '"lanes"=>"4"') == CENTRE | CENTRE_SOLID | LANE_LINES
    dashed = '"lanes"=>"4","divider"=>"dashed_line"'
    assert centre_bits("primary", dashed) == CENTRE | LANE_LINES
    assert not centre_bits("primary", '"lanes"=>"3"') & LANE_LINES


def _tile_with_ways(tmp_path, monkeypatch, ways: list[tuple[list[tuple[float, float]], str]]):
    """A 200 m tile with a 10 m carriageway (class 7) along y = 95–105 and
    the given OSM ways (points in metres from the SW corner, tag XML)."""
    from pyproj import Transformer

    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    cls = np.zeros((400, 400), np.uint8)
    cls[190:210, :] = 7
    (tmp_path / "data" / "dlm").mkdir(parents=True)
    Image.fromarray(cls).save(tmp_path / "data" / "dlm" / "landcover_t.png")
    back = Transformer.from_crs(25833, 4326, always_xy=True)
    nodes, xml_ways, nid = [], [], 1
    for k, (pts, tags) in enumerate(ways):
        refs = []
        for px_, py_ in pts:
            lon, lat = back.transform(x0 + px_, y0 + py_)
            nodes.append(f'<node id="{nid}" lat="{lat:.9f}" lon="{lon:.9f}" version="1"/>')
            refs.append(f'<nd ref="{nid}"/>')
            nid += 1
        xml_ways.append(f'<way id="{100 + k}" version="1">{"".join(refs)}{tags}</way>')
    osm = tmp_path / "raw" / "osm" / "t.osm"
    osm.parent.mkdir(parents=True)
    body = "".join(nodes) + "".join(xml_ways)
    osm.write_text(f'<?xml version="1.0"?><osm version="0.6">{body}</osm>')
    monkeypatch.setattr(Tile, "osm_extract", lambda self: osm)
    return tile


def test_no_centre_line_where_a_tram_runs_on_the_axis(tmp_path, monkeypatch):
    road = '<tag k="highway" v="secondary"/><tag k="lanes" v="2"/>'
    tram = '<tag k="railway" v="tram"/>'
    tile = _tile_with_ways(
        tmp_path,
        monkeypatch,
        [([(10, 100), (190, 100)], road), ([(10, 100), (100, 100)], tram)],
    )
    run(tile, px=200)
    grey = np.asarray(Image.open(tile.data / "dlm" / "markings_t.png")).reshape(200, 200, 4)
    bits = grey[..., 1].astype(int) & ~KERB
    assert not bits[100, 60] & CENTRE  # the tram's half
    assert bits[100, 150] & CENTRE  # past its end the line is back


# --- B26 cycle lanes, B21 red tracks ---------------------------------------


def test_cycle_lane_kinds_widths_and_colour():
    assert cycle_lane_bits('"cycleway:right:lane"=>"exclusive"', "right") == CYCLE | CYCLE_SOLID
    assert cycle_lane_bits('"cycleway:right:lane"=>"advisory"', "right") == CYCLE
    assert cycle_lane_bits(None, "right") == CYCLE  # a lane, kind unsaid: dashed
    assert cycle_lane_bits('"cycleway:both:lane"=>"pictogram"', "left") == 0
    assert cycle_lane_bits('"cycleway:left:width"=>"2.25"', "left") & CYCLE_WIDE
    assert not cycle_lane_bits('"cycleway:left:width"=>"1.6"', "left") & CYCLE_WIDE
    assert cycle_lane_bits('"cycleway:right:surface:colour"=>"red"', "right") & RED
    tags = '"cycleway:right"=>"lane","cycleway:right:lane"=>"exclusive"'
    assert cycle_sides(tags) == (CYCLE | CYCLE_SOLID, 0)


def test_a_cycle_track_is_red_only_where_osm_says():
    assert is_red_track("cycleway", '"surface:colour"=>"red"')
    assert is_red_track("path", '"bicycle"=>"designated","surface:colour"=>"red"')
    assert not is_red_track("footway", '"surface:colour"=>"red"')
    assert not is_red_track("cycleway", '"surface:colour"=>"green"')
    assert not is_red_track("cycleway", None)


# --- B23 parking ------------------------------------------------------------


def _code(kind: int, place: int, marked: bool) -> int:
    return surface.parking_code(kind, place, marked)


def test_street_bays_are_painted_only_where_osm_says():
    lane = '"parking:right"=>"lane","parking:right:orientation"=>"parallel"'
    assert surface.parking_side(lane, "right") == _code(1, 0, False)
    marked = lane + ',"parking:right:markings"=>"yes"'
    assert surface.parking_side(marked, "right") == _code(1, 0, True)
    angled = '"parking:both"=>"on_kerb","parking:both:orientation"=>"diagonal"'
    assert surface.parking_side(angled, "left") == _code(2, 2, False)
    half = '"parking:left"=>"half_on_kerb"'
    assert surface.parking_side(half, "left") == _code(1, 1, False)
    # the old scheme: `marked` and `painted_area_only` are paint
    old = '"parking:lane:right"=>"parallel","parking:lane:right:parallel"=>"half_on_kerb"'
    assert surface.parking_side(old, "right") == _code(1, 1, False)
    assert surface.parking_side('"parking:lane:both"=>"marked"', "right") == _code(1, 0, True)
    assert surface.parking_side('"parking:right"=>"no"', "right") == 0


def test_a_lot_is_painted_unless_it_says_not_or_is_unpaved():
    assert surface.lot_code("parking", None) == _code(3, 0, True)
    assert surface.lot_code("parking", '"markings"=>"no"') == _code(3, 0, False)
    assert surface.lot_code("parking", '"surface"=>"gravel"') == _code(3, 0, False)
    assert surface.lot_code("parking", '"parking"=>"street_side"') == _code(3, 0, False)
    side = '"parking"=>"street_side","markings"=>"yes"'
    assert surface.lot_code("parking", side) == _code(3, 0, True)


def test_the_a_byte_packs_the_offset_place_and_paint():
    along = np.array([[0, 0x1ABC, 0x1FFF]], np.uint16)
    park = np.array([[0, _code(1, 2, True), surface.CLEARED]], np.uint8)
    low, high = surface.pack_along(along, park)
    assert low.tolist() == [[0, 0xBC, 0xFF]]
    assert high[0, 0] == 0
    assert high[0, 1] == 0x1A | 2 << 5 | 0x80
    assert high[0, 2] == 0x1F  # a cleared aisle: no place, no paint
    ts = (ROOT / "lib" / "city" / "landcover.ts").read_text()
    client = re.search(r"export const SURFACE_ALONG_BITS = (\d+)", ts)
    assert client is not None and int(client.group(1)) == surface.ALONG_BITS


# --- B22 sidewalk bands -----------------------------------------------------


def test_a_sidewalk_band_reaches_to_the_building_at_most_8_m():
    line = shapely.LineString([(0, 0), (40, 0)])
    near = shapely.box(0, 3 + 5, 40, 20)  # 5 m past a 3 m half-width, north (left)
    tree = shapely.STRtree([near])
    quads = surface.band_depths(line, 3.0, 1.0, tree)
    assert quads
    _, ymin, _, ymax = shapely.union_all(quads).bounds
    assert abs(ymin - 3.0) < 0.05 and abs(ymax - 8.0) < 0.3
    far = shapely.STRtree([shapely.box(0, 30, 40, 40)])
    _, _, _, ymax = shapely.union_all(surface.band_depths(line, 3.0, 1.0, far)).bounds
    assert abs(ymax - (3.0 + surface.SIDEWALK_BAND)) < 0.3


# --- B20 path defaults ------------------------------------------------------


def test_path_defaults_asphalt_in_town_unpaved_outside(tmp_path, monkeypatch):
    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    cls = np.zeros((400, 400), np.uint8)
    cls[:, 100:104] = 6  # a north-south path at x = 50 … 52
    (tmp_path / "data" / "dlm").mkdir(parents=True)
    Image.fromarray(cls).save(tmp_path / "data" / "dlm" / "landcover_t.png")
    town = shapely.box(x0, y0 + 100, x0 + 200, y0 + 200)  # the north half
    monkeypatch.setattr(surface, "settlement", lambda t: [town])
    monkeypatch.setattr(surface, "dlm_path_surfaces", lambda t: [])
    kind = surface.path_defaults(tile, 200)
    asphalt, unpaved = surface.SURFACE_OF["asphalt"], surface.SURFACE_OF["unpaved"]
    assert kind[20, 51] == asphalt and kind[180, 51] == unpaved
    assert kind[20, 10] == 0  # not a path
    bef = shapely.box(x0 + 40, y0 + 150, x0 + 60, y0 + 190)
    monkeypatch.setattr(surface, "dlm_path_surfaces", lambda t: [(bef, unpaved)])
    assert surface.path_defaults(tile, 200)[30, 51] == unpaved  # the DLM's BEF wins


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


# --- B16 / B18 OSM land cover ------------------------------------------------


def test_one_way_main_roads_are_half_as_wide():
    assert landcover_osm._road_half("primary", None, None, oneway=True) == 3.0
    assert landcover_osm._road_half("primary", None, None) == 6.0
    assert landcover_osm._road_half("tertiary", None, None, oneway=True) == 2.0
    assert landcover_osm._road_half("residential", None, None, oneway=True) == 3.0
    assert landcover_osm._road_half("primary", 7.0, None, oneway=True) == 3.5
    assert landcover_osm._road_half("primary", None, 2, oneway=True) == 3.25
    assert landcover_osm.one_way("motorway", None)
    assert not landcover_osm.one_way("motorway", '"oneway"=>"no"')
    assert landcover_osm.one_way("secondary", '"oneway"=>"-1"')


def test_rail_on_its_own_bed_is_railway_land():
    assert landcover_osm.rail_half("rail", '"bridge"=>"yes"') == 2.5
    assert landcover_osm.rail_half("light_rail", None) == 2.5
    assert landcover_osm.rail_half("subway", '"bridge"=>"viaduct"') is None
    assert landcover_osm.rail_half("tram", None) == 2.0
    assert landcover_osm.rail_half("tram", '"embedded"=>"yes"') is None
    assert landcover_osm.rail_half("abandoned", None) is None


def test_allotments_and_cemeteries_are_meadow_farmland_arable():
    def cls(**v):
        return landcover_osm._area_class(v)

    assert cls(landuse="allotments") == 1
    assert cls(landuse="cemetery") == 1
    assert cls(landuse="farmland") == 9
    assert cls(landuse="meadow") == 1


def test_a_field_lies_over_the_meadow_around_it_a_wood_over_the_field(tmp_path, monkeypatch):
    # a meadow west, a field overlapping it east, and a wood inside the field
    nodes = {
        1: (10, 40, ""),
        2: (120, 40, ""),
        3: (120, 160, ""),
        4: (10, 160, ""),
        5: (80, 40, ""),
        6: (190, 40, ""),
        7: (190, 160, ""),
        8: (80, 160, ""),
        9: (150, 80, ""),
        10: (180, 80, ""),
        11: (180, 120, ""),
        12: (150, 120, ""),
    }
    ways = (
        way(1, [1, 2, 3, 4, 1], {"landuse": "meadow"})
        + way(2, [5, 6, 7, 8, 5], {"landuse": "farmland"})
        + way(3, [9, 10, 11, 12, 9], {"landuse": "forest"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    raster = landcover.class_raster(tile, SIZE, landcover_osm.burn_order(tile)[0])
    assert raster[SIZE - 100, 40] == 1  # the meadow alone
    assert raster[SIZE - 100, 100] == 9  # where the field overlaps it
    assert raster[SIZE - 100, 165] == 2  # the wood inside the field


# --- B19 the arable class ----------------------------------------------------


def test_a_field_frame_runs_along_its_long_axis():
    frames = surface.Frames()
    surface.add_long_axis(frames, shapely.box(0, 0, 300, 40))
    assert abs(np.sin(frames.bearing[0])) < 1e-9  # east-west
    surface.add_long_axis(frames, shapely.Point(0, 0).buffer(0))  # empty: none
    assert len(frames.bearing) == 1
