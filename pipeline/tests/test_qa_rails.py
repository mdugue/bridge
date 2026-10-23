"""The rail layer's tracks from OSM (rail_osm.py, rail.py): each track one
by one with its bridge, layer, gauge and electrification, the DLM's lines
only where OSM maps none, the covered stretches left out, the tracks set in
the paving without a ballast bed, the mapped catenary masts on their track,
and the platforms' heights by the trains they serve."""

from __future__ import annotations

import numpy as np
import pyogrio.raw
import shapely
import shapely.geometry

from bake import rail, rail_osm
from tests.synthetic import SIZE, X0, Y0, osm_tile, tags, way

ROAD, RAILWAY = 7, 5


def _write_dlm(tile, lines: list[shapely.LineString], elk: str = "1000") -> None:
    tile.dlm.mkdir(parents=True, exist_ok=True)
    n = len(lines)
    pyogrio.raw.write(
        tile.dlm / "ver03_l.shp",
        np.array([shapely.to_wkb(g) for g in lines], dtype=object),
        [np.array(v, dtype=object) for v in (["1000"] * n, ["1000"] * n, [elk] * n, ["1100"] * n)],
        fields=["SPW", "GLS", "ELK", "BKT"],
        crs="EPSG:25833",
        geometry_type="LineString",
        driver="ESRI Shapefile",
    )


def _line(f: dict) -> shapely.LineString:
    return shapely.geometry.shape(f["geometry"])


def _along(features: list[dict], y: float) -> list[dict]:
    """The features whose line runs along y (m from the tile's corner)."""
    return [f for f in features if abs(_line(f).centroid.y - (Y0 + y)) < 1.0]


def _straight(y: float, x0: float = -20, x1: float = SIZE + 20, first: int = 1):
    return {first: (x0, y, ""), first + 1: (x1, y, "")}


def test_electrification_reads_overhead_third_rail_none_or_untagged():
    assert rail_osm.electrified_of('"electrified"=>"contact_line"') == 1
    assert rail_osm.electrified_of('"electrified"=>"yes"') == 1
    assert rail_osm.electrified_of('"electrified"=>"rail"') == 2
    assert rail_osm.electrified_of('"electrified"=>"4th_rail"') == 2
    assert rail_osm.electrified_of('"electrified"=>"no"') == 0
    assert rail_osm.electrified_of(None) is None
    assert rail_osm.layer_of('"layer"=>"-1"') == -1
    assert rail_osm.gauge_of('"gauge"=>"1000"') == 1.0
    assert rail_osm.gauge_of('"gauge"=>"1435;1000"') == 1.435


def test_each_track_carries_its_bridge_layer_gauge_and_current(tmp_path, monkeypatch):
    nodes = {
        **_straight(20, first=1),
        **_straight(60, first=3),
        **_straight(100, first=5),
        **_straight(140, first=7),
    }
    ways = (
        way(1, [1, 2], {"railway": "rail", "electrified": "contact_line"})
        + way(2, [3, 4], {"railway": "rail", "bridge": "yes", "layer": "1"})
        + way(3, [5, 6], {"railway": "light_rail", "electrified": "rail", "layer": "-1"})
        + way(4, [7, 8], {"railway": "narrow_gauge", "gauge": "750"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    features = rail_osm.rails(tile)
    props = {y: _along(features, y)[0]["properties"] for y in (20, 60, 100, 140)}
    assert props[20] == {"tracks": 1, "electrified": 1, "bridge": 0}
    assert props[60] == {"tracks": 1, "electrified": 0, "bridge": 1, "layer": 1}
    assert props[100] == {"tracks": 1, "electrified": 2, "bridge": 0, "layer": -1}
    assert props[140]["g"] == 0.75
    # clipped to the tile: the next tile draws its own piece
    for f in features:
        x0, _, x1, _ = _line(f).bounds
        assert x0 >= X0 - 0.01 and x1 <= X0 + SIZE + 0.01


def test_a_covered_stretch_or_a_tunnel_is_not_drawn(tmp_path, monkeypatch):
    nodes = {
        **_straight(20, first=1),
        **_straight(60, x0=80, x1=100, first=3),
        **_straight(100, first=5),
    }
    ways = (
        way(1, [1, 2], {"railway": "rail", "covered": "yes"})  # 240 m under a lid
        + way(2, [3, 4], {"railway": "rail", "covered": "yes"})  # 20 m: a footbridge
        + way(3, [5, 6], {"railway": "rail", "tunnel": "yes"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    features = rail_osm.rails(tile)
    assert not _along(features, 20)
    assert len(_along(features, 60)) == 1
    assert not _along(features, 100)
    # …but each still claims the DLM's line beside it
    taken = rail_osm.claimed(tile, 6.0)
    assert taken.contains(shapely.Point(X0 + 100, Y0 + 100))


def test_a_siding_across_a_paved_yard_has_no_ballast_bed(tmp_path, monkeypatch):
    # a quay's paving x 0–120, then the railway's land; a siding and a main
    # line run through both, and an embedded way along the street
    cls = np.full((SIZE, SIZE), RAILWAY, np.uint8)
    cls[:, :120] = ROAD
    nodes = {**_straight(40, first=1), **_straight(100, first=3), **_straight(160, first=5)}
    ways = (
        way(1, [1, 2], {"railway": "rail", "service": "siding"})
        + way(2, [3, 4], {"railway": "rail"})
        + way(3, [5, 6], {"railway": "rail", "embedded": "yes"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)
    features = rail_osm.rails(tile)
    siding = _along(features, 40)
    paved = [f for f in siding if f["properties"].get("paved")]
    assert len(paved) == 1
    x0, _, x1, _ = _line(paved[0]).bounds
    assert x0 - X0 < 5 and 100 < x1 - X0 < 130
    assert not any(f["properties"].get("paved") for f in _along(features, 100))
    assert all(f["properties"].get("paved") for f in _along(features, 160))
    area = shapely.union_all(
        [shapely.geometry.shape(f["geometry"]) for f in rail_osm.ballast(tile, features)]
    )
    assert not area.contains(shapely.Point(X0 + 50, Y0 + 40))  # the quay
    assert area.contains(shapely.Point(X0 + 170, Y0 + 40))  # the siding's bed
    assert area.contains(shapely.Point(X0 + 50, Y0 + 100))  # the main line
    assert not area.contains(shapely.Point(X0 + 50, Y0 + 160))  # embedded


def test_the_dlm_draws_only_where_osm_maps_no_track(tmp_path, monkeypatch):
    # OSM's two tracks 2 m either side of the DLM's centreline at y 50, no
    # OSM along the DLM's line at y 150; one OSM way untagged
    nodes = {**_straight(48, first=1), **_straight(52, first=3)}
    ways = way(1, [1, 2], {"railway": "rail"}) + way(
        2, [3, 4], {"railway": "rail", "electrified": "no"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    _write_dlm(
        tile,
        [
            shapely.LineString([(X0 - 10, Y0 + 50), (X0 + SIZE + 10, Y0 + 50)]),
            shapely.LineString([(X0 - 10, Y0 + 150), (X0 + SIZE + 10, Y0 + 150)]),
        ],
    )
    features = rail.rails(tile, osm=True)
    assert not _along(features, 50)  # OSM's tracks stand for it
    assert len(_along(features, 150)) == 1  # the DLM's line OSM lacks
    assert _along(features, 150)[0]["properties"]["electrified"] == 1
    # the untagged way: overhead, as the DLM's line beside it says
    assert _along(features, 48)[0]["properties"]["electrified"] == 1
    assert _along(features, 52)[0]["properties"]["electrified"] == 0
    # without the extract: the DLM's lines alone
    assert len(rail.rails(tile)) == 2


def test_a_mapped_catenary_mast_stands_beside_its_track(tmp_path, monkeypatch):
    nodes = {
        **_straight(50, x0=0, x1=SIZE, first=1),
        10: (80, 54, tags(power="catenary_mast")),
        11: (150, 80, tags(power="catenary_mast")),  # 30 m off: another's
        # a tram along y 36: the mast between it and the railway is the
        # tram's (the tram layer stands it)
        12: (0, 36, ""),
        13: (SIZE, 36, ""),
        14: (130, 40, tags(power="catenary_mast")),
    }
    ways = way(1, [1, 2], {"railway": "rail", "electrified": "contact_line"}) + way(
        2, [12, 13], {"railway": "tram"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    features = rail_osm.rails(tile)
    rail_osm.masts(tile, features)
    [track] = _along(features, 50)
    [(station, offset)] = track["properties"]["m"]
    assert abs(station - 80) < 0.5
    assert abs(offset - 4) < 0.1  # on its left, going east


def test_a_platform_stands_as_high_as_its_trains_ask():
    assert rail.mapped_height('"height"=>"0.76"') == 0.76
    assert rail.mapped_height('"height"=>"96"') == 0.96  # centimetres
    assert rail.mapped_height('"height"=>"200"') is None  # 2 m: implausible
    assert rail.platform_kind('"subway"=>"yes"', "rail") == "subway"
    assert rail.platform_kind('"tram"=>"yes"', None) == "tram"
    assert rail.platform_kind(None, "light_rail") == "light_rail"
    assert rail.platform_kind(None, None) == "rail"
    assert rail.PLATFORM_HEIGHT["rail"] == 0.76
