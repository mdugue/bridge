"""The timetable trams (transit.py) on a synthetic feed: the cut to the
site's trams, the days picked, the way along the tracks, the file."""

import datetime
import json
import zipfile
from pathlib import Path

from pyproj import Transformer

from bake import transit as T

EPSG = 25833
# A double track east–west at y = 1000 (north: westbound) and y = 996
# (south: eastbound), 1 km long, and a branch north from x = 500.
TRACKS = [
    ([[0.0, 996.0], [500.0, 996.0], [1000.0, 996.0]], False),
    ([[1000.0, 1000.0], [500.0, 1000.0], [0.0, 1000.0]], False),
    ([[500.0, 1000.0], [500.0, 1400.0]], True),
]
ORIGIN = (400_000.0, 5_650_000.0)


def _lonlat(x: float, y: float) -> tuple[float, float]:
    back = Transformer.from_crs(EPSG, 4326, always_xy=True)
    return back.transform(ORIGIN[0] + x, ORIGIN[1] + y)


def _feed_zip(path: Path) -> Path:
    stops = {
        # the eastbound platforms stand south of the track pair
        "a_e": (10, 990),
        "b_e": (990, 990),
        # the westbound ones north of it
        "b_w": (990, 1006),
        "a_w": (10, 1006),
        "far": (5000, 5000),  # off the site
    }
    rows = {
        "agency.txt": "agency_id,agency_name\n71,Verkehrsverbund Oberelbe\n",
        "routes.txt": "route_id,agency_id,route_short_name,route_type\nr11,71,11,0\nbus,71,62,3\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n"
        + "".join(
            f"{sid},{sid},{_lonlat(*xy)[1]},{_lonlat(*xy)[0]}\n" for sid, xy in stops.items()
        ),
        "trips.txt": "route_id,service_id,trip_id\nr11,wk,t1\nr11,wk,t2\nr11,sa,t3\nbus,wk,b1\n",
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
        "t1,08:00:00,08:00:00,a_e,0\nt1,08:03:00,08:03:30,b_e,1\nt1,08:20:00,08:20:00,far,2\n"
        "t2,24:10:00,24:10:00,b_w,0\nt2,24:13:00,24:13:00,a_w,1\n"
        "t3,09:00:00,09:00:00,a_e,0\nt3,09:03:00,09:03:00,b_e,1\n"
        "b1,08:00:00,08:00:00,a_e,0\nb1,08:05:00,08:05:00,b_e,1\n",
        "calendar.txt": "monday,tuesday,wednesday,thursday,friday,saturday,sunday,"
        "start_date,end_date,service_id\n"
        "1,1,1,1,1,0,0,20261001,20261031,wk\n0,0,0,0,0,1,0,20261001,20261031,sa\n",
        # 3 October is a holiday: no Saturday service
        "calendar_dates.txt": "service_id,date,exception_type\nsa,20261003,2\n",
    }
    with zipfile.ZipFile(path, "w") as z:
        for name, text in rows.items():
            z.writestr(name, text)
    return path


def _site():
    x0, y0 = ORIGIN
    return (x0, y0, x0 + 2000, y0 + 2000)


def _tracks():
    return T.Tracks(
        [([[ORIGIN[0] + x, ORIGIN[1] + y] for x, y in coords], b) for coords, b in TRACKS]
    )


def test_seconds_run_past_midnight():
    assert T.gtfs_seconds("25:07:00") == 90_420
    assert T.gtfs_seconds("08:03:30") == 29_010


def test_the_feed_is_cut_to_the_sites_trams(tmp_path):
    feed = T.site_trams(_feed_zip(tmp_path / "f.zip"), _site(), EPSG)
    assert set(feed["routes"].values()) == {"11"}
    assert set(feed["trips"]) == {"t1", "t2", "t3"}
    assert "far" not in feed["stops"]
    assert [r[1] for r in feed["trips"]["t1"]["times"]] == ["a_e", "b_e", "far"]
    assert feed["trips"]["t2"]["times"][0][2] == 87_000


def test_a_holiday_saturday_loses_to_the_next(tmp_path):
    feed = T.site_trams(_feed_zip(tmp_path / "f.zip"), _site(), EPSG)
    days = T.pick_days(feed, datetime.date(2026, 10, 1))
    assert days["saturday"] == datetime.date(2026, 10, 10)
    assert T.kind_of(days["weekday"]) == "weekday"
    assert "sunday" not in days


def test_a_tram_keeps_to_the_track_beside_its_platform():
    tracks = _tracks()
    x0, y0 = ORIGIN
    east = tracks.leg((x0 + 10, y0 + 990), (x0 + 990, y0 + 990))
    west = tracks.leg((x0 + 990, y0 + 1006), (x0 + 10, y0 + 1006))
    assert east is not None and west is not None
    assert {round(tracks.xy[n][1] - y0) for n in east} == {996}
    assert {round(tracks.xy[n][1] - y0) for n in west} == {1000}


def test_no_track_near_a_platform_no_leg():
    tracks = _tracks()
    x0, y0 = ORIGIN
    assert tracks.leg((x0 + 10, y0 + 990), (x0 + 990, y0 + 1300)) is None


def test_the_timetable_of_each_kind_of_day(tmp_path):
    feed = T.site_trams(_feed_zip(tmp_path / "f.zip"), _site(), EPSG)
    days = {"weekday": datetime.date(2026, 10, 1), "saturday": datetime.date(2026, 10, 10)}
    doc = T.build_timetable(feed, _tracks(), days)
    assert doc["routes"] == ["11"]
    # eastbound and westbound are two patterns; t3 runs t1's with times
    # of its own (no stand at b)
    assert len(doc["patterns"]) == 2
    east = doc["patterns"][0]
    # from the track vertex nearest one platform to the next's
    assert east["at"] == [0, 1000]
    # the leg off the site ends the trip: t1 runs its two stops on the site
    weekday = doc["days"]["weekday"]["trips"]
    assert [start for _, start in weekday] == [28_800, 87_000]
    profile = doc["profiles"][weekday[0][0]]
    assert profile["t"] == [0, 0, 180, 210]
    [(saturday, start)] = doc["days"]["saturday"]["trips"]
    assert start == 32_400
    assert doc["profiles"][saturday] == {"pattern": 0, "t": [0, 0, 180, 180]}


def test_a_bridge_track_is_marked_on_its_pattern():
    tracks = _tracks()
    x0, y0 = ORIGIN
    run = [
        ("s", 0, 0, tracks.leg((x0 + 10, y0 + 990), (x0 + 505, y0 + 1390))),
        ("t", 60, 60, None),
    ]
    coords, at, bridge = T.pattern_geometry(run, tracks)
    assert bridge, "the branch is a bridge"
    first, last = bridge[0]
    assert coords[first][0] == x0 + 500 and coords[last][1] > y0 + 1300
    assert at[0] == 0


def test_the_file_is_written(tmp_path):
    raw = tmp_path / "raw" / "sn"
    data = tmp_path / "data"
    # the feed is shared by every provider: beside their raw folders
    gtfs = tmp_path / "raw" / "gtfs"
    gtfs.mkdir(parents=True)
    _feed_zip(gtfs / "nv_free.zip")
    (data / "dlm").mkdir(parents=True)
    tracks = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"k": "track", **({"bridge": 1} if b else {})},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[ORIGIN[0] + x, ORIGIN[1] + y] for x, y in coords],
                },
            }
            for coords, b in TRACKS
        ],
    }
    (data / "dlm" / "tram_t.geojson").write_text(json.dumps(tracks))
    T.run_site(raw, data, _site(), EPSG, datetime.date(2026, 10, 1))
    doc = json.loads((data / "transit" / "trams.json").read_text())
    assert "DELFI" in doc["attribution"] and "OpenStreetMap" in doc["attribution"]
    assert doc["days"]["weekday"]["date"] == "2026-10-01"
    # the filtered feed is cached beside the raw one
    assert list(gtfs.glob("trams_*.json"))
