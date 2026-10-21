"""The Mapillary lamps' precision gate (QA 2026-10-21, W18): a detection is
taken only when seen from near and in the light, never a litter bin, and
never a tunnel's lighting laid on the ground above it."""

from datetime import UTC, datetime

import shapely
from pyproj import Transformer

from bake.common import Tile
from bake.mapillary import (
    NEAR_IMAGE_M,
    TUNNEL_M,
    Tunnels,
    compact,
    detections,
    in_light,
    seen_well,
)

EPSG = 25832
TO_TILE = Transformer.from_crs(4326, EPSG, always_xy=True)
TO_WGS = Transformer.from_crs(EPSG, 4326, always_xy=True)
# A lamp in Unna's old town, and the times the photos of it were taken.
LAMP = (409_185.0, 5_710_127.0)
NOON = int(datetime(2023, 10, 17, 11, 0, tzinfo=UTC).timestamp() * 1000)
NIGHT = int(datetime(2025, 12, 12, 22, 0, tzinfo=UTC).timestamp() * 1000)


def _lonlat(x: float, y: float) -> list[float]:
    return list(TO_WGS.transform(x, y))


def _detection(value="object--street-light", off=8.0, times=(NOON,), seen="2023-10-17"):
    """A cached detection at LAMP, its images `off` metres east of it."""
    return {
        "id": "1",
        "object_value": value,
        "geometry": {"type": "Point", "coordinates": _lonlat(*LAMP)},
        "last_seen_at": f"{seen}T11:00:00+0000",
        "images": [[*_lonlat(LAMP[0] + off, LAMP[1]), t] for t in times],
    }


def test_the_cache_keeps_each_image_as_place_and_time():
    f = {
        "id": "7",
        "object_value": "object--street-light",
        "geometry": {"type": "Point", "coordinates": [7.68, 51.53]},
        "images": {
            "data": [{"geometry": {"coordinates": [7.68001, 51.53002]}, "captured_at": NOON}]
        },
    }
    assert compact(f)["images"] == [[7.68001, 51.53002, NOON]]
    assert compact({**f, "images": None})["images"] == []


def test_a_lamp_seen_from_near_by_day_is_taken():
    assert seen_well(_detection(), TO_TILE)


def test_a_lamp_seen_only_from_far_is_not():
    # a bridge's lamps seen from 30-60 m came down on the meadow beside it
    assert not seen_well(_detection(off=NEAR_IMAGE_M + 5), TO_TILE)
    assert seen_well(_detection(off=NEAR_IMAGE_M - 1), TO_TILE)


def test_a_lamp_seen_only_at_night_is_not():
    # a motorway's headlights at 22:00 in December, taken for street lights
    assert not seen_well(_detection(times=(NIGHT, NIGHT)), TO_TILE)
    assert seen_well(_detection(times=(NIGHT, NOON)), TO_TILE)
    assert not seen_well(_detection(off=5.0, times=()), TO_TILE)


def test_the_light_allows_a_camera_clock_an_hour_off():
    lon, lat = 12.7296, 51.2452  # Grimma, a sunlit photo stamped 16:18 UTC in November
    stamped = int(datetime(2022, 11, 14, 16, 18, tzinfo=UTC).timestamp() * 1000)
    assert in_light(lon, lat, [stamped])  # the sun 9° below the horizon by the stamp
    assert not in_light(
        lon, lat, [int(datetime(2022, 11, 14, 19, 0, tzinfo=UTC).timestamp() * 1000)]
    )
    assert in_light(lon, lat, [None])  # no time: not known to be dark


def test_no_litter_bins_and_no_old_sightings(tmp_path):
    tile = Tile(
        "32408_5710_2_nw", (408_000, 5_710_000, 410_000, 5_712_000), EPSG, tmp_path, tmp_path
    )
    doc = {
        "features": [
            _detection(),
            _detection(value="object--trash-can"),  # mostly household wheelie bins
            _detection(seen="2019-05-01"),
        ]
    }
    out = detections(tile, doc)
    assert set(out) == {"lamp"}
    assert len(out["lamp"]) == 1
    assert abs(out["lamp"][0][0] - LAMP[0]) < 0.01 and abs(out["lamp"][0][1] - LAMP[1]) < 0.01


def _tunnels(under: list, ground: list) -> Tunnels:
    t = Tunnels.__new__(Tunnels)
    t.under = shapely.STRtree(under) if under else None
    t.ground = shapely.STRtree(ground) if ground else None
    return t


def test_a_tunnels_lighting_is_not_a_street_lamp():
    tunnel = shapely.LineString([(0, 0), (500, 0)])
    street = shapely.LineString([(0, 30), (500, 30)])
    t = _tunnels([tunnel], [street])
    assert t.lit(shapely.Point(100, 5))  # on the hill over the tunnel
    assert not t.lit(shapely.Point(100, 27))  # beside the street on the ground
    assert not t.lit(shapely.Point(100, -(TUNNEL_M + 1)))  # too far from the tunnel
    assert not _tunnels([], [street]).lit(shapely.Point(100, 5))
    assert _tunnels([tunnel], []).lit(shapely.Point(100, 5))
