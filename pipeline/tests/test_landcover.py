"""The land-cover bakes (pipeline/bake/landcover.py from the Basis-DLM,
landcover_osm.py from OSM): which class a polygon or a line burns."""

import shapely

from bake import landcover, landcover_osm
from tests.synthetic import SIZE, X0, Y0, dlm_tile, osm_tile, shapefile, tile_line, way

# --- water in a culvert ---------------------------------------------------------


def test_a_dlm_stream_is_not_painted_where_it_runs_piped(tmp_path):
    tile = dlm_tile(tmp_path)
    # an open stream with a culvert from x = 60 to 140 (Durchlass, BWF 2010),
    # and a second axis the DLM flags as lying in a structure (HDU_X)
    shapefile(
        tile.dlm / "gew01_l.shp",
        [tile_line((0, 100), (200, 100)), tile_line((0, 40), (200, 40))],
        {"HDU_X": ["0", "1"]},
    )
    # the culvert, and a road bridge over the stream (another structure)
    shapefile(
        tile.dlm / "ver06_l.shp",
        [tile_line((60, 100), (140, 100)), tile_line((30, 90), (30, 110))],
        {"BWF": ["2010", "1800"]},
    )
    water = shapely.union_all(landcover.stream_buffers(tile))
    assert water.contains(shapely.Point(X0 + 20, Y0 + 100))  # open, under the bridge too
    assert water.contains(shapely.Point(X0 + 30, Y0 + 100))
    assert water.contains(shapely.Point(X0 + 180, Y0 + 100))
    assert not water.intersects(shapely.Point(X0 + 100, Y0 + 100).buffer(3))
    assert not water.intersects(shapely.Point(X0 + 100, Y0 + 40).buffer(3))


def test_a_dlm_stream_without_structures_is_painted_whole(tmp_path):
    tile = dlm_tile(tmp_path)
    shapefile(tile.dlm / "gew01_l.shp", [tile_line((0, 100), (200, 100))], {"HDU_X": ["0"]})
    water = shapely.union_all(landcover.stream_buffers(tile))
    assert abs(water.area - 200 * 2 * landcover.STREAM_HALF_M) < 10


def test_osm_land_cover_draws_no_covered_water(tmp_path, monkeypatch):
    nodes = {
        1: (10, 50, ""),
        2: (190, 50, ""),
        3: (10, 150, ""),
        4: (190, 150, ""),
        11: (80, 80, ""),
        12: (120, 80, ""),
        13: (120, 120, ""),
        14: (80, 120, ""),
    }
    ways = (
        way(10, [1, 2], {"waterway": "stream"})
        + way(11, [3, 4], {"waterway": "stream", "covered": "yes"})
        + way(12, [11, 12, 13, 14, 11], {"natural": "water", "covered": "yes"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    order, _ = landcover_osm.burn_order(tile)
    raster = landcover.class_raster(tile, SIZE, order)
    assert raster[200 - 50, 100] == 8  # the open stream
    assert raster[200 - 150, 100] != 8  # the covered one
    assert raster[200 - 100, 100] != 8  # the covered pond


def test_hidden_water_reads_culverts_covers_and_underground():
    hidden = landcover_osm.hidden_water
    assert hidden('"covered"=>"yes"')
    assert hidden('"tunnel"=>"culvert"')
    assert hidden('"location"=>"underground"')
    assert not hidden('"covered"=>"no"')
    assert not hidden('"name"=>"Kortelbach"')
    assert not hidden(None)


def test_a_road_is_its_width_or_lanes_wide_and_a_one_way_main_road_half_as_wide():
    assert landcover_osm.lanes('"lanes"=>"3"') == 3 and landcover_osm.lanes(None) is None
    assert landcover_osm._road_half("secondary", None, 3) == 4.875
    assert landcover_osm._road_half("secondary", None, None) == 5.0
    assert landcover_osm._road_half("primary", None, None, oneway=True) == 3.0
    assert landcover_osm._road_half("primary", None, None) == 6.0
    assert landcover_osm._road_half("tertiary", None, None, oneway=True) == 2.0
    assert landcover_osm._road_half("residential", None, None, oneway=True) == 3.0
    assert landcover_osm._road_half("primary", 7.0, None, oneway=True) == 3.5
    assert landcover_osm._road_half("primary", None, 2, oneway=True) == 3.25
    assert landcover_osm.one_way("motorway", None)
    assert not landcover_osm.one_way("motorway", '"oneway"=>"no"')
    assert landcover_osm.one_way("secondary", '"oneway"=>"-1"')


# --- B16 / B18 OSM land cover ------------------------------------------------


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
