"""Roads and ways in a tunnel are not drawn on the ground above them: the
Basis-DLM's road axes are cut where a DLM tunnel runs along them, and the OSM
ways every terrain bake reads skip `tunnel=*`."""

from __future__ import annotations

import shapely

from bake import landcover, landcover_osm
from bake.common import Tile
from bake.osm import read_ways
from tests.synthetic import SIZE, X0, Y0, osm_tile, shapefile, tile_line, way


def test_a_dlm_road_axis_is_not_painted_where_a_tunnel_runs_along_it(tmp_path):
    tile = Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")
    road = tile_line((0, 100), (200, 100))
    shapefile(tile.dlm / "ver01_l.shp", [road], {"BRF": ["8"], "WDM": ["1303"]})
    # the tunnel on the road's own axis from x = 50 to 150; a footbridge
    # (another structure) across it changes nothing
    shapefile(
        tile.dlm / "ver06_l.shp",
        [tile_line((50, 100), (150, 100)), tile_line((20, 80), (20, 120))],
        {"BWF": ["1870", "1800"]},
    )
    painted = shapely.union_all(landcover.road_buffers(tile))
    assert painted.contains(shapely.Point(X0 + 25, Y0 + 102))
    assert painted.contains(shapely.Point(X0 + 175, Y0 + 98))
    assert not painted.intersects(shapely.Point(X0 + 100, Y0 + 100).buffer(4))


def test_a_road_only_crossing_over_a_tunnel_keeps_its_crossing(tmp_path):
    tile = Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")
    shapefile(
        tile.dlm / "ver01_l.shp",
        [tile_line((100, 0), (100, 200))],
        {"BRF": ["-9998"], "WDM": ["1307"]},
    )
    shapefile(tile.dlm / "ver06_l.shp", [tile_line((0, 100), (200, 100))], {"BWF": ["1870"]})
    painted = shapely.union_all(landcover.road_buffers(tile))
    assert painted.contains(shapely.Point(X0 + 100, Y0 + 100))


TUNNEL_WAYS = {
    1: (10, 100, ""),
    2: (190, 100, ""),
    3: (10, 50, ""),
    4: (190, 50, ""),
    5: (10, 150, ""),
    6: (190, 150, ""),
}


def _ways() -> str:
    return (
        way(10, [1, 2], {"highway": "primary", "tunnel": "yes"})
        + way(11, [3, 4], {"highway": "residential"})
        + way(12, [5, 6], {"waterway": "stream", "tunnel": "culvert"})
    )


def test_ways_in_a_tunnel_or_a_culvert_are_not_read(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, TUNNEL_WAYS, _ways())
    geoms, fields = read_ways(tile, "highway IS NOT NULL OR waterway IS NOT NULL", ["highway"])
    assert list(fields["highway"]) == ["residential"]
    assert len(geoms) == 1
    assert set(fields) == {"highway"}


def test_osm_land_cover_paints_no_road_or_stream_over_a_tunnel(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, TUNNEL_WAYS, _ways())
    order, _ = landcover_osm.burn_order(tile)
    raster = landcover.class_raster(tile, SIZE, order)
    assert raster[200 - 50, 100] == 7  # the street on the surface
    assert raster[200 - 100, 100] != 7  # the one in the tunnel
    assert raster[200 - 150, 100] != 8  # the stream in its culvert
