import json

import numpy as np
import pytest
import shapely

from bake import tram
from tests.synthetic import SIZE, X0, Y0, local, neighbour, osm_tile, read, tags, way

TRAM = {"railway": "tram", "gauge": "1450", "electrified": "contact_line"}
MAST = tags(power="catenary_mast")


def _tram_tile(tmp_path, monkeypatch, buildings: bool = True):
    """A street track along y = 100 (on the road band, running 50 m past
    both tile edges), a lawn track along y = 150 (on the meadow band), a
    ballast track along y = 50 (unclassified ground); masts either side of
    the street at x = 100, one beside the lawn track, one west of the
    tile, one too far from any track; two blocks either side of the street
    towards the east end."""
    cls = np.zeros((200, 200), np.uint8)
    cls[90:111, :] = 7  # road: y 90..110
    cls[40:61, :] = 1  # meadow: y 140..160
    nodes = {
        1: (-50, 100, ""),
        2: (250, 100, ""),
        3: (20, 150, ""),
        4: (180, 150, ""),
        5: (20, 50, ""),
        6: (180, 50, ""),
        10: (100, 88, MAST),
        11: (100, 112, MAST),
        12: (50, 144, MAST),
        13: (-10, 94, MAST),
        14: (100, 20, MAST),
    }
    ways = [
        way(1, [1, 2], TRAM),
        way(2, [3, 4], TRAM),
        way(3, [5, 6], TRAM),
    ]
    if buildings:
        corners = {
            20: (150, 108),
            21: (210, 108),
            22: (210, 130),
            23: (150, 130),
            24: (150, 70),
            25: (210, 70),
            26: (210, 92),
            27: (150, 92),
        }
        nodes.update({k: (x, y, "") for k, (x, y) in corners.items()})
        ways.append(way(10, [20, 21, 22, 23, 20], {"building": "yes"}))
        ways.append(way(11, [24, 25, 26, 27, 24], {"building": "yes"}))
    return osm_tile(tmp_path, monkeypatch, nodes, "".join(ways), classes=cls)


def _by_kind(doc, k):
    return [f for f in doc["features"] if f["properties"]["k"] == k]


def test_tracks_take_their_bed_from_the_ground_and_stop_at_the_tile_edge(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch)
    tram.run(tile)
    doc = read(tile, "tram")
    assert doc["attribution"].startswith("©")
    beds = {}
    for f in _by_kind(doc, "track"):
        _, y = local(f["geometry"]["coordinates"][0])
        beds[round(y)] = f["properties"]["bed"]
        xs = [local(c)[0] for c in f["geometry"]["coordinates"]]
        assert min(xs) >= 0 and max(xs) <= 200
    assert beds == {100: "street", 150: "grass", 50: "ballast"}


def test_a_track_across_a_square_and_a_lawn_is_cut_where_its_bed_changes(tmp_path, monkeypatch):
    from bake import tram

    cls = np.zeros((200, 200), np.uint8)
    cls[90:111, 0:60] = 7  # road: x 0..60
    cls[90:111, 60:120] = 4  # a paved square (built-up): x 60..120
    cls[90:111, 120:200] = 1  # meadow: x 120..200
    cls[90:111, 150:156] = 7  # a 6 m road crossing the lawn: too short to cut
    nodes = {1: (0, 100, ""), 2: (200, 100, "")}
    tile = osm_tile(tmp_path, monkeypatch, nodes, way(1, [1, 2], TRAM), classes=cls)
    tram.run(tile)
    pieces = sorted(
        (min(local(c)[0] for c in f["geometry"]["coordinates"]), f["properties"]["bed"])
        for f in _by_kind(read(tile, "tram"), "track")
    )
    assert [bed for _, bed in pieces] == ["street", "grass"]
    assert 115 <= pieces[1][0] <= 125  # cut where the lawn begins


def test_beds_are_smoothed_and_short_runs_absorbed():
    from bake.common import absorb_short, smooth_labels
    from bake.tram import BED_ORDER

    raw = ["street"] * 10 + ["ballast"] + ["street"] * 10 + [None] * 3
    assert set(smooth_labels(raw, 3, BED_ORDER)) == {"street"}
    labels = ["street"] * 12 + ["grass"] * 3 + ["street"] * 5 + ["ballast"] * 20
    assert absorb_short(labels, 10) == ["street"] * 20 + ["ballast"] * 20


def test_masts_pair_across_the_tracks_or_carry_an_arm(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch)
    tram.run(tile)
    doc = read(tile, "tram")
    masts = sorted(local(f["geometry"]["coordinates"]) for f in _by_kind(doc, "mast"))
    # the mast west of the tile is its neighbour's; the far one is the railway's
    assert masts == [(50.0, 144.0), (100.0, 88.0), (100.0, 112.0)]
    mast_at = set(masts)
    [span] = [
        f
        for f in _by_kind(doc, "span")
        if all(local(c) in mast_at for c in f["geometry"]["coordinates"])
    ]
    assert sorted(local(c) for c in span["geometry"]["coordinates"]) == [
        (100.0, 88.0),
        (100.0, 112.0),
    ]
    assert span["properties"]["x"] == [0.5]
    [arm] = _by_kind(doc, "arm")
    (x0, y0), (x1, y1) = (local(c) for c in arm["geometry"]["coordinates"])
    assert (x0, y0) == (50.0, 144.0) and x1 == 50.0 and 150.0 < y1 < 150.5


def test_rosette_spans_hang_between_facades_where_no_mast_is_near(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch)
    tram.run(tile)
    doc = read(tile, "tram")
    rosettes = _by_kind(doc, "rosette")
    # the supports stand on the 30 m grid (x = 180 here; at x = 150 the ray
    # runs along the block's west wall and finds no facade to the north)
    xs = sorted(local(f["geometry"]["coordinates"][0])[0] for f in rosettes)
    assert xs == [180.0]
    for f in rosettes:
        ys = sorted(local(c)[1] for c in f["geometry"]["coordinates"])
        assert ys == [92.0, 108.0]  # the facades either side
    # the street track's wire is held at the mast span, the pole-to-facade
    # span and the rosette
    [street] = [f for f in _by_kind(doc, "track") if f["properties"]["bed"] == "street"]
    assert street["properties"]["s"] == [100.0, 150.0, 180.0]
    [lawn] = [f for f in _by_kind(doc, "track") if f["properties"]["bed"] == "grass"]
    assert lawn["properties"]["s"] == [30.0, 130.0, 160.0]


def test_without_facades_no_rosette_is_invented(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch, buildings=False)
    tram.run(tile)
    assert _by_kind(read(tile, "tram"), "rosette") == []


def test_bridge_and_layer_tags_are_read():
    from bake.tram import bridge_of, layer_of

    assert bridge_of('"bridge"=>"viaduct"') == 1
    assert bridge_of('"bridge"=>"no"') == 0
    assert bridge_of(None) == 0
    assert layer_of('"layer"=>"-1"') == -1
    assert layer_of('"layer"=>"x"') == 0


def test_a_tram_stop_signs_its_platform_unless_a_shelter_stands_there(tmp_path, monkeypatch):
    import json

    from bake import tram

    cls = np.zeros((200, 200), np.uint8)
    cls[90:111, :] = 7
    stop = tags(railway="tram_stop", name="Albertplatz")
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (40, 100, stop),  # on the track, a platform 4 m south
        4: (30, 96, ""),
        5: (50, 96, ""),
        6: (120, 100, stop),  # a shelter stands on its platform
        7: (110, 96, ""),
        8: (130, 96, ""),
        9: (170, 100, stop),  # no platform
    }
    ways = [
        way(1, [1, 3, 6, 9, 2], TRAM),
        way(2, [4, 5], {"public_transport": "platform", "tram": "yes"}),
        way(3, [7, 8], {"public_transport": "platform", "tram": "yes"}),
    ]
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways), classes=cls)
    shelter = {
        "type": "Feature",
        "properties": {"k": "shelter", "a": 0},
        "geometry": {"type": "Point", "coordinates": [X0 + 121, Y0 + 95]},
    }
    furniture = {"type": "FeatureCollection", "features": [shelter]}
    (tile.data / "dlm" / "furniture_t.geojson").write_text(json.dumps(furniture))
    tram.run(tile)
    [sign] = _by_kind(read(tile, "tram"), "stop")
    assert local(sign["geometry"]["coordinates"]) == (40.0, 96.0)
    assert sign["properties"] == {"k": "stop", "a": 0, "name": "Albertplatz"}


def test_a_shelter_across_the_seam_takes_the_stops_sign(tmp_path, monkeypatch):
    import json

    from bake import tram

    stop = tags(railway="tram_stop", name="Nahtstelle")
    nodes = {
        1: (0, 100, ""),
        2: (260, 100, ""),
        3: (197, 100, stop),  # the sign would stand at (197, 96), on this tile
        4: (185, 96, ""),
        5: (215, 96, ""),
    }
    ways = [
        way(1, [1, 3, 2], TRAM),
        way(2, [4, 5], {"public_transport": "platform", "tram": "yes"}),
    ]
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways))
    east = neighbour(tile, "u")
    shelter = {
        "type": "Feature",
        "properties": {"k": "shelter", "a": 0},
        "geometry": {"type": "Point", "coordinates": [X0 + 203, Y0 + 95]},
    }
    doc = {"type": "FeatureCollection", "features": [shelter]}
    (east.data / "dlm" / "furniture_u.geojson").write_text(json.dumps(doc))
    tram.run(tile)
    # the shelter 6 m away is the neighbour's: it stands for the stop still
    assert _by_kind(read(tile, "tram"), "stop") == []


@pytest.mark.parametrize(
    ("other", "keep"),
    [
        ('"public_transport"=>"platform","tram"=>"yes"', True),
        ('"public_transport"=>"platform"', True),  # names no mode: may be the tram's
        ('"public_transport"=>"platform","tram"=>"yes","bus"=>"yes"', True),
        ('"public_transport"=>"platform","bus"=>"yes"', False),
        ('"railway"=>"platform","train"=>"yes"', False),
        ('"public_transport"=>"platform","subway"=>"yes"', False),
        ('"public_transport"=>"platform","tram"=>"yes","level"=>"-1"', False),
        ('"public_transport"=>"platform","layer"=>"-2"', False),
        ('"public_transport"=>"platform","location"=>"underground"', False),
        ('"public_transport"=>"platform","tunnel"=>"yes"', False),
    ],
)
# --- V25: the platforms a tram stop's sign stands on --------------------------


def test_only_a_trams_platform_at_street_level_takes_the_sign(other, keep):
    assert tram.tram_platform(other) is keep


def test_a_stop_over_an_underground_platform_signs_the_street_one(tmp_path, monkeypatch):
    stop = tags(railway="tram_stop", name="Max-Weber-Platz")
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (100, 100, stop),
        4: (90, 99, ""),  # the U-Bahn's platform right under the stop
        5: (110, 99, ""),
        6: (90, 95, ""),  # the tram's, 5 m south
        7: (110, 95, ""),
        8: (40, 100, tags(railway="tram_stop", name="Bahnhof")),
        9: (30, 98, ""),  # only the station's train platform beside it
        10: (50, 98, ""),
    }
    ways = [
        way(1, [1, 8, 3, 2], TRAM),
        way(2, [4, 5], {"public_transport": "platform", "subway": "yes", "level": "-1"}),
        way(3, [6, 7], {"public_transport": "platform", "tram": "yes"}),
        way(4, [9, 10], {"railway": "platform", "train": "yes"}),
    ]
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways))
    tram.run(tile)
    [sign] = _by_kind(read(tile, "tram"), "stop")
    assert local(sign["geometry"]["coordinates"]) == (100.0, 95.0)


# --- V24: side poles and centre poles where no mast serves --------------------


def test_grid_stations_are_the_same_places_whichever_tile_clipped_the_line():
    whole = shapely.LineString([(X0 - 50, Y0 + 100), (X0 + 250, Y0 + 100)])
    part = shapely.LineString([(X0 + 45, Y0 + 100), (X0 + 200, Y0 + 100)])
    xs = {round(whole.interpolate(s).x - X0, 3) for s in tram.grid_stations(whole)}
    ys = {round(part.interpolate(s).x - X0, 3) for s in tram.grid_stations(part)}
    assert ys == {x for x in xs if 45 <= x < 200}
    assert sorted(ys) == [60.0, 90.0, 120.0, 150.0, 180.0]


def _street(tmp_path, monkeypatch, ys=(100,), lamps=(), mast=None, road=(89, 111)):
    """A road band (y from road[0] to road[1]) with a track along each of
    `ys`, running past both tile edges; no buildings."""
    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[SIZE - road[1] : SIZE - road[0], :] = 7
    nodes, ways = {}, []
    for i, y in enumerate(ys):
        nodes[10 * i + 1] = (-50, y, "")
        nodes[10 * i + 2] = (250, y, "")
        ways.append(way(i + 1, [10 * i + 1, 10 * i + 2], TRAM))
    if mast is not None:
        nodes[99] = (*mast, tags(power="catenary_mast"))
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways), classes=cls)
    features = [
        {
            "type": "Feature",
            "properties": {"k": "lamp"},
            "geometry": {"type": "Point", "coordinates": [X0 + x, Y0 + y]},
        }
        for x, y in lamps
    ]
    doc = {"type": "FeatureCollection", "features": features}
    (tile.data / "dlm" / "lamps_t.geojson").write_text(json.dumps(doc))
    tram.run(tile)
    return read(tile, "tram")


def test_side_poles_stand_past_the_kerb_a_span_between_them(tmp_path, monkeypatch):
    doc = _street(tmp_path, monkeypatch)
    poles = sorted(local(f["geometry"]["coordinates"]) for f in _by_kind(doc, "pole"))
    xs = sorted({x for x, _ in poles})
    # the 30 m grid (x = 0 is the seam: the ground west of it is no baked tile's here)
    assert xs == [30.0, 60.0, 90.0, 120.0, 150.0, 180.0]
    for _, y in poles:
        assert 110.0 <= y <= 112.0 or 88.0 <= y <= 89.5  # just past either kerb
    spans = _by_kind(doc, "span")
    assert len(spans) == len(xs)
    for f in spans:
        assert f["properties"]["x"] == [pytest.approx(0.5, abs=0.03)]
    [track] = _by_kind(doc, "track")
    assert track["properties"]["s"] == xs  # the wire is held at every one


def test_a_street_lamp_beside_the_spot_is_the_pole(tmp_path, monkeypatch):
    doc = _street(tmp_path, monkeypatch, lamps=[(61.5, 112.0), (95.0, 120.0)])
    lamp_poles = [f for f in _by_kind(doc, "pole") if f["properties"].get("lamp")]
    assert [local(f["geometry"]["coordinates"]) for f in lamp_poles] == [(61.5, 112.0)]


def test_a_wide_central_strip_takes_a_centre_pole_a_narrow_one_side_poles(tmp_path, monkeypatch):
    wide = _street(tmp_path / "wide", monkeypatch, ys=(97, 103))  # 6 m: a 3.35 m strip
    poles = [local(f["geometry"]["coordinates"]) for f in _by_kind(wide, "pole")]
    assert poles and {y for _, y in poles} == {100.0}
    assert len(_by_kind(wide, "arm")) == 2 * len(poles)
    assert _by_kind(wide, "span") == []
    narrow = _street(tmp_path / "narrow", monkeypatch, ys=(98, 102))  # 4 m: 1.35 m
    ys = {y for _, y in (local(f["geometry"]["coordinates"]) for f in _by_kind(narrow, "pole"))}
    assert all(y > 105 or y < 95 for y in ys)
    assert _by_kind(narrow, "arm") == []


def test_no_pole_within_45_m_of_a_mapped_mast(tmp_path, monkeypatch):
    doc = _street(tmp_path, monkeypatch, mast=(100, 112))
    xs = {local(f["geometry"]["coordinates"])[0] for f in _by_kind(doc, "pole")}
    assert xs and all(abs(x - 100) > 45 for x in xs)


def test_no_pole_where_the_street_runs_off_the_baked_tiles():
    class Off:
        def cls(self, x, y):
            return None if x > 10 else 7

    assert tram._edge(Off(), shapely.Point(0, 0), 1.0, 0.0, 0.0) is None
    assert tram._edge(Off(), shapely.Point(0, 0), -1.0, 0.0, 0.0) == tram.POLE_OPEN_M
