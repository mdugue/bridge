"""Railway land is not all track: the DLM's parcel reaches the fences and
holds depots, yards' tarmac and the embankments' grass. The ballast lies on
the tracks' beds alone, and the parcel's green beyond them is lawn."""

from __future__ import annotations

import json

import numpy as np
import pyogrio.raw
import shapely
import shapely.geometry
from PIL import Image

from bake import edges, rail
from tests.synthetic import SIZE, X0, Y0, osm_tile, way

RAILWAY, ROAD = 5, 7


def _write(path, geoms, fields: dict[str, list[str]], kind: str) -> None:
    pyogrio.raw.write(
        path,
        np.array([shapely.to_wkb(g) for g in geoms], dtype=object),
        [np.array(v, dtype=object) for v in fields.values()],
        fields=list(fields),
        crs="EPSG:25833",
        geometry_type=kind,
        driver="ESRI Shapefile",
    )


def _tile(tmp_path, monkeypatch):
    """A railway parcel y 20–80 round a DLM track along y = 50; OSM maps a
    siding along y = 35 (x 50–150), a tram along y = 65 and a track outside
    the parcel along y = 120."""
    nodes = {
        1: (50, 35, ""),
        2: (150, 35, ""),
        3: (0, 65, ""),
        4: (200, 65, ""),
        5: (0, 120, ""),
        6: (200, 120, ""),
    }
    ways = (
        way(1, [1, 2], {"railway": "rail", "service": "siding"})
        + way(2, [3, 4], {"railway": "tram"})
        + way(3, [5, 6], {"railway": "rail"})
    )
    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[SIZE - 80 : SIZE - 20, :] = RAILWAY
    cls[SIZE - 180 : SIZE - 160, :] = ROAD
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)
    tile.dlm.mkdir(parents=True, exist_ok=True)
    parcel = shapely.box(X0, Y0 + 20, X0 + SIZE, Y0 + 80)
    _write(tile.dlm / "ver03_f.shp", [parcel], {"OBJART": ["42010"]}, "Polygon")
    track = shapely.LineString([(X0, Y0 + 50), (X0 + SIZE, Y0 + 50)])
    fields = {"SPW": ["1000"], "GLS": ["1000"], "ELK": ["1000"], "BKT": ["1100"]}
    _write(tile.dlm / "ver03_l.shp", [track], fields, "LineString")
    return tile


def _at(area: shapely.Geometry, x: float, y: float) -> bool:
    return area.contains(shapely.Point(X0 + x, Y0 + y))


def test_the_ballast_lies_on_the_tracks_beds_within_the_railway_land(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    area = shapely.union_all(
        [shapely.geometry.shape(f["geometry"]) for f in rail.ballast(tile, rail.rails(tile))]
    )
    assert _at(area, 100, 50)  # the DLM's track
    assert _at(area, 100, 35)  # OSM's siding
    assert not _at(area, 20, 35)  # the siding ends at x = 50
    assert not _at(area, 100, 25)  # the parcel's edge: an embankment
    assert not _at(area, 100, 65)  # a tram has no ballast bed here
    assert not _at(area, 100, 120)  # a track outside the railway land
    assert abs(area.area - (SIZE + 100) * rail.rail_osm.BED_ONE) < 10


def test_green_railway_land_off_the_tracks_is_lawn(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    track = {"type": "LineString", "coordinates": [[X0, Y0 + 50], [X0 + SIZE, Y0 + 50]]}
    tile.out("dlm", "rail_t.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "geometry": track, "properties": {"tracks": 1}}],
            }
        )
    )
    Image.fromarray(np.full((SIZE, SIZE), 128, np.uint8)).save(tile.out("dlm", "ndvi_t.png"))
    green = edges.urban_green(tile, tile.classes())

    def at(x, y):
        return bool(green[SIZE - y, x])

    assert at(100, 25)  # the embankment
    assert at(100, 42)  # beside the track, past its bed
    assert not at(100, 50)  # the track bed
    assert not at(100, 35)  # the siding's bed
    assert not at(100, 170)  # the carriageway stays road
