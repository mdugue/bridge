"""QA batch V23–V29 (trams and the riverside): the platforms a stop's sign
may stand on, the side and centre poles where no mast serves, who runs a
line, and the landing stages and groynes as the surface model shows them."""

import json

import numpy as np
import pytest
import rasterio
import shapely
from synthetic import SIZE, X0, Y0, local, osm_tile, read, tags, way
from test_riverside import raise_ground
from test_transit import EPSG, _feed_zip, _site, _tracks

from bake import riverside, tram
from bake import transit as T

TRAM = {"railway": "tram", "gauge": "1450", "electrified": "contact_line"}


def _by_kind(doc, k):
    return [f for f in doc["features"] if f["properties"]["k"] == k]


# --- V25: the platforms a tram stop's sign stands on --------------------------


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


# --- V26: who runs each line --------------------------------------------------


def test_the_feed_names_each_routes_agency(tmp_path):
    feed = T.site_trams(_feed_zip(tmp_path / "f.zip"), _site(), EPSG)
    assert feed["agencies"] == {"r11": "Verkehrsverbund Oberelbe"}


def test_a_line_is_run_by_the_agency_of_most_of_its_routes():
    feed = {
        "routes": {"a": "1", "b": "1", "c": "1", "d": "2"},
        "agencies": {"a": "LVB", "b": "LVB", "c": "Regiobus", "d": "Regiobus"},
    }
    names, index = T.route_agencies(feed, ["1", "2"])
    assert names == ["LVB", "Regiobus"]
    assert index == [0, 1]
    # a cut from before the agencies: one unnamed operator
    assert T.route_agencies({"routes": {"a": "1"}}, ["1"]) == ([""], [0])


def test_the_timetable_carries_its_operators(tmp_path):
    import datetime

    feed = T.site_trams(_feed_zip(tmp_path / "f.zip"), _site(), EPSG)
    doc = T.build_timetable(feed, _tracks(), {"weekday": datetime.date(2026, 10, 1)})
    assert doc["agencies"] == ["Verkehrsverbund Oberelbe"]
    assert doc["routeAgency"] == [0] * len(doc["routes"])


def test_a_cached_cut_without_agencies_is_derived_again(tmp_path):
    _feed_zip(tmp_path / "nv_free.zip")
    key = "_".join(f"{v:.0f}" for v in _site())
    stale = tmp_path / f"trams_{key}.json"
    stale.write_text(json.dumps({"routes": {}, "trips": {}, "stops": {}}))
    feed = T.cached_site_trams(tmp_path, _site(), EPSG)
    assert feed is not None and feed["agencies"] == {"r11": "Verkehrsverbund Oberelbe"}
    assert "agencies" in json.loads(stale.read_text())


# --- V27–V29: the landing stages and groynes as DOM1 shows them ---------------

WATER_DOM = 99.5  # the scan's water, below the DGM's (100): another day's river


def _river(
    tmp_path,
    monkeypatch,
    hull: float = 1.2,
    finger: bool = False,
    dom: bool = True,
    gangway: float | None = None,
    pier_dom: float = 101.0,
):
    """The river south of y = 100 (DGM 100); a fixed pier at x = 50 (4 m,
    y 90..110), a tagged pontoon at x = 100 (y 70..108) and a long pier at
    x = 150 (y 60..110: a pontoon by its reach) — with `finger` a short
    pier off the first pontoon's east side, with `gangway` a fixed pier
    from the bank onto its north end, DOM1 at that height over it. DOM1:
    the water at 99.5, the fixed pier at `pier_dom` (1 m over the ground),
    the first pontoon `hull` over the water, the long one awash."""
    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[100:, :] = 8
    nodes = {
        1: (50, 110, ""),
        2: (50, 90, ""),
        3: (100, 108, ""),
        4: (100, 70, ""),
        5: (150, 110, ""),
        6: (150, 60, ""),
        7: (101.5, 80, ""),
        8: (115, 80, ""),
        9: (100, 112, ""),
        10: (100, 99, ""),
    }
    ways = [
        way(1, [1, 2], {"man_made": "pier", "width": "4"}),
        way(2, [3, 4], {"man_made": "pier", "floating": "yes"}),
        way(3, [5, 6], {"man_made": "pier"}),
    ]
    if finger:
        ways.append(way(4, [7, 8], {"man_made": "pier", "width": "2"}))
    if gangway is not None:
        ways.append(way(5, [9, 10], {"man_made": "pier", "width": "2"}))
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways), classes=cls)
    if dom:
        d = np.full((SIZE, SIZE), 100.0, np.float32)
        d[100:, :] = WATER_DOM
        d[SIZE - 110 : SIZE - 90, 48:52] = pier_dom  # the fixed pier
        d[SIZE - 108 : SIZE - 70, 99:101] = WATER_DOM + hull  # the pontoon
        if finger:
            d[SIZE - 81 : SIZE - 79, 102:115] = WATER_DOM + hull
        if gangway is not None:
            d[SIZE - 112 : SIZE - 100, 99:101] = gangway
        path = tile.raw_raster("dom1")
        path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=SIZE,
            height=SIZE,
            count=1,
            dtype="float32",
            crs="EPSG:25833",
            transform=tile.transform(SIZE),
        ) as dst:
            dst.write(d, 1)
    riverside.run(tile)
    return read(tile, "riverside")


def test_a_piers_deck_is_the_surface_models_not_the_bank_plus_04(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch)
    [pier] = _by_kind(doc, "pier")
    assert pier["properties"]["deck"] == 101.0  # the DGM + 0.4 would say 100.4


def test_a_pontoon_floats_at_its_measured_freeboard_and_an_awash_one_is_not_drawn(
    tmp_path, monkeypatch
):
    doc = _river(tmp_path, monkeypatch)
    [pontoon] = _by_kind(doc, "pontoon")  # the long one lies under the scan's water
    assert local(pontoon["properties"]["bank"])[0] == pytest.approx(100, abs=3)
    # against the scan's water (99.5), not the DGM's (100)
    assert pontoon["properties"]["fb"] == 1.2


def test_only_a_drawn_pier_spares_a_pontoon_its_gangway(tmp_path, monkeypatch):
    shown = _river(tmp_path / "shown", monkeypatch, gangway=100.8)
    [pontoon] = _by_kind(shown, "pontoon")
    assert "bank" not in pontoon["properties"]  # the pier reaches it
    assert len(_by_kind(shown, "pier")) == 2
    hidden = _river(tmp_path / "hidden", monkeypatch, gangway=100.0)  # not in the scan
    [pontoon] = _by_kind(hidden, "pontoon")
    assert "bank" in pontoon["properties"]
    assert len(_by_kind(hidden, "pier")) == 1


def test_a_pier_the_scan_has_under_the_dgms_river_floats(tmp_path, monkeypatch):
    # 0.4 m over the scan's water (99.5), under the DGM's (100): a pontoon
    doc = _river(tmp_path, monkeypatch, pier_dom=99.9)
    assert _by_kind(doc, "pier") == []
    [floated] = [f for f in _by_kind(doc, "pontoon") if local(f["properties"]["bank"])[0] < 60]
    assert floated["properties"]["fb"] == 0.4
    ys = [local(c)[1] for c in floated["geometry"]["coordinates"][0]]
    assert max(ys) <= 100.5  # cut to the water


def test_the_freeboard_is_clamped(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch, hull=2.2)
    [pontoon] = _by_kind(doc, "pontoon")
    assert pontoon["properties"]["fb"] == 1.5


def test_a_steamer_moored_over_a_landing_stage_hides_its_deck_not_the_stage(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch, hull=4.2)  # a paddle steamer's superstructure
    [pontoon] = _by_kind(doc, "pontoon")
    assert pontoon["properties"]["fb"] == 0.9


def test_without_dom1_the_old_rules_hold(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch, dom=False)
    [pier] = _by_kind(doc, "pier")
    assert pier["properties"]["deck"] == 100.4
    pontoons = _by_kind(doc, "pontoon")
    assert len(pontoons) == 2 and {f["properties"]["fb"] for f in pontoons} == {0.9}


def test_a_finger_pier_off_a_pontoon_floats_with_it(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch, finger=True)
    fingers = [f for f in _by_kind(doc, "pontoon") if f["properties"].get("finger")]
    [finger] = fingers
    assert "bank" not in finger["properties"]
    assert finger["properties"]["fb"] == 1.2  # its pontoon's
    [parent] = [f for f in _by_kind(doc, "pontoon") if not f["properties"].get("finger")]
    assert "bank" in parent["properties"]  # the finger is no way ashore


def test_a_groyne_is_drawn_where_the_ground_stands_over_the_water(tmp_path, monkeypatch):
    nodes = {1: (180, 104, ""), 2: (180, 50, "")}
    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[100:, :] = 8
    tile = osm_tile(
        tmp_path, monkeypatch, nodes, way(1, [1, 2], {"man_made": "groyne"}), classes=cls
    )
    raise_ground(tile, (178, 183), (80, 105), 100.6)  # its head (y < 80) under the river
    river = riverside.River(tile)
    out, under = riverside.groynes(tile, river)
    [groyne] = out
    ys = [local(c)[1] for c in groyne["geometry"]["coordinates"]]
    assert min(ys) == pytest.approx(80, abs=2.1) and max(ys) == pytest.approx(104, abs=0.1)
    assert groyne["properties"]["w"] == 100.0
    assert under == pytest.approx(30, abs=2.1)
    # nothing beside it to tell it from: drawn whole, no `w`
    line = shapely.LineString([(X0 + 20, Y0 + 180), (X0 + 20, Y0 + 150)])
    runs, water = riverside.groyne_runs(line, river)
    assert water is None and runs == [line]
