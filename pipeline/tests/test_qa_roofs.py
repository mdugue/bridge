"""The photo QA's roof and landmark rules (PR #173): the flight's sun on
its day's path, its pooled fallback and the overcast flight; the landmarks
Wikidata knows as demolished, and how near a point's building must be."""

import json
from datetime import UTC, date, datetime

import numpy as np
import shapely

from bake import dop_light, fetch, landmarks, roof_colour
from bake.dop_light import (
    MIN_SUN_CONTRAST,
    SunFit,
    cast_shadow,
    estimate_sun,
    flight_days,
    flight_file,
    pooled_sun,
    solar_path,
    solar_position,
    sun_vector,
)
from bake.roof_colour import Light, SunReading


def test_solar_position_matches_the_almanac():
    # Dresden, 19 March 2024 (the DOP's flight): true noon about 11:12 UTC,
    # the sun due south at 90° − 51.05° + its declination (−0.3°)
    az, el = solar_position(datetime(2024, 3, 19, 11, 12, tzinfo=UTC), 13.74, 51.05)
    assert abs(az - 180) < 0.5 and abs(el - 38.7) < 0.2
    # München, 24 August 2024, mid-morning: south-east, about 50° high
    az, el = solar_position(datetime(2024, 8, 24, 9, 0, tzinfo=UTC), 11.57, 48.14)
    assert 125 < az < 140 and 43 < el < 48


def test_the_path_holds_only_a_survey_sun():
    path = solar_path([date(2024, 3, 19)], 13.74, 51.05)
    assert min(el for _, el, _ in path) >= dop_light.MIN_SUN_EL
    # the March sun never climbs past 39° over Dresden: a 45° fit is no fit
    assert max(el for _, el, _ in path) < 39
    assert path[1][2] - path[0][2] == (path[2][2] - path[1][2])


def _blocks(n: int = 300) -> tuple[np.ndarray, np.ndarray]:
    dsm = np.zeros((n, n), np.float32)
    roofs = np.zeros(dsm.shape, bool)
    for r in range(70, n - 70, 30):
        for c in range(70, n - 70, 30):
            dsm[r : r + 12, c : c + 10] = 18
            roofs[r : r + 12, c : c + 10] = True
    return dsm, roofs


def test_the_sun_is_found_on_its_days_path():
    dsm, roofs = _blocks()
    path = solar_path([date(2024, 3, 19)], 13.74, 51.05)
    az, el, when = next(p for p in path if p[2].hour == 10 and p[2].minute == 30)
    shadow = cast_shadow(dsm, az, el, 2.0) & ~roofs
    counts: dict = {}
    fit = estimate_sun(shadow, dsm, roofs, path=path, counts=counts)
    assert fit is not None and fit.when is not None
    assert abs((fit.when - when).total_seconds()) <= 10 * 60
    assert abs(fit.el - el) < 1.5
    # one side of the buildings only: sure
    assert fit.contrast >= MIN_SUN_CONTRAST
    # the agreement every PATH_STEP minutes, for the flight's pooled sun
    assert len(counts) > 30 and all(u >= i for i, u in counts.values())


def test_shadows_on_both_sides_are_no_fit_of_ones_own():
    dsm, roofs = _blocks()
    # what an evenly lit courtyard quarter shows: dark all round the houses
    shadow = (cast_shadow(dsm, 180, 35, 2.0) | cast_shadow(dsm, 0, 35, 2.0)) & ~roofs
    fit = estimate_sun(shadow, dsm, roofs)
    assert fit is not None and fit.contrast < MIN_SUN_CONTRAST


def test_the_flight_sun_is_pooled_over_its_sure_tiles():
    t = [datetime(2024, 3, 19, 10, m, tzinfo=UTC) for m in (0, 10, 20)]
    a = {t[0]: (10, 100), t[1]: (50, 100), t[2]: (30, 100)}
    b = {t[0]: (20, 100), t[1]: (45, 100), t[2]: (40, 100)}
    assert pooled_sun([a, b]) == t[1]
    assert pooled_sun([]) is None
    assert pooled_sun([{t[0]: (1, 100)}]) is None  # under MIN_SUN_FIT


def _reading(fit, days=(date(2024, 3, 19),), counts=None):
    return SunReading(list(days), (13.74, 51.05), fit, counts)


def test_a_tile_whose_fit_is_a_guess_takes_its_flights(tmp_path, monkeypatch):
    from bake.common import Tile

    def tile(i):
        return Tile(f"t{i}", (0.0, 0.0, 2000.0, 2000.0), 25833, tmp_path, tmp_path)

    t0, t1, t2 = tile(0), tile(1), tile(2)
    noon = datetime(2024, 3, 19, 11, 10, tzinfo=UTC)
    guess = SunFit(120.0, 22.0, 0.3, 1.4)
    sure = SunFit(180.0, 38.7, 0.5, 4.0, noon)
    readings = {
        "t0": _reading(guess, counts={noon: (10, 100)}),
        "t1": _reading(sure, counts={noon: (50, 100)}),
        # another day's flight is no peer
        "t2": _reading(sure, days=(date(2024, 4, 7),), counts={noon: (1, 100)}),
    }
    monkeypatch.setattr(roof_colour, "sun_reading", lambda t, *a, **k: readings[t.id])
    monkeypatch.setattr(
        roof_colour, "flight_days", lambda raw, tid: readings[tid].days if tid in readings else []
    )
    sun, source = roof_colour.flight_sun(t0, [t0, t1, t2], np.zeros((3, 256)))
    assert source == "pooled"
    assert abs(sun[0] - solar_position(noon, 13.74, 51.05)[0]) < 1e-6
    sun, source = roof_colour.flight_sun(t1, [t0, t1, t2], np.zeros((3, 256)))
    assert source == "own" and sun == (180.0, 38.7)
    # no day known: a guess is no sun
    readings["t0"] = _reading(guess, days=())
    assert roof_colour.flight_sun(t0, [t0, t1], np.zeros((3, 256))) == (None, None)


def test_an_overcast_flight_corrects_no_slope():
    north = (0.0, 0.707, 0.707)
    light = Light(np.zeros((1, 1), bool), (180, 35), 1.87, "own")
    assert light.overcast
    assert light.gain(north) == 1.0
    assert not light.faces_away(north)
    assert light.gains(np.array([north])).tolist() == [1.0]
    # the sun is still there for the lean fit
    assert light.sun == light.lean_sun == sun_vector(180, 35)
    sunny = Light(np.zeros((1, 1), bool), (180, 35), 6.0, "own")
    assert not sunny.overcast and sunny.faces_away(north) and sunny.gain(north) > 1


def test_an_unsure_fit_still_finds_the_lean_but_scales_no_face():
    north = (0.0, 0.707, 0.707)
    light = Light(np.zeros((1, 1), bool), None, 6.0, None, lean_sun=(240, 30))
    assert light.sun is None and light.lean_sun == sun_vector(240, 30)
    assert light.gains(np.array([north])).tolist() == [1.0]
    assert not light.faces_away(north)
    assert Light(np.zeros((1, 1), bool), None, 6.0).lean_sun is None


def test_flight_days_round_trip(tmp_path):
    dest = flight_file(tmp_path, "t")
    fetch.write_flight(dest, ["2025-04-04", "2025-03-28", "2025-04-04"], "sn")
    assert flight_days(tmp_path, "t") == [date(2025, 3, 28), date(2025, 4, 4)]
    assert flight_days(tmp_path, "missing") == []
    assert fetch.german_dates("Bildflugdatum = '19.03.2025'") == ["2025-03-19"]


# --- landmarks -----------------------------------------------------------


def test_what_wikidata_knows_as_gone():
    assert landmarks.gone({"states": [landmarks.DEMOLISHED]}) is True
    # destroyed 1945 and restored: the Frauenkirche
    assert landmarks.gone({"dissolved": "1945-02-15", "states": ["Q75505084"]}) is False
    # an end date and no state: gone (a church rebuilt keeps its OSM outline)
    assert landmarks.gone({"dissolved": "1894-01-01", "states": []}) is True
    assert landmarks.gone({"dissolved": None, "states": []}) is False
    # a cache from before the state: unknown
    assert landmarks.gone({"id": "Q1"}) is None


def _quarter():
    city = {
        "CityObjects": {
            "rathaus": {"children": ["wing"]},
            "wing": {"parents": ["rathaus"]},
            "brewery": {},
        }
    }
    ids = ["wing", "brewery"]
    polys = [shapely.box(0, 0, 40, 40), shapely.box(100, 0, 120, 20)]
    return city, ids, polys, shapely.STRtree(polys)


def test_a_demolished_church_is_not_the_house_on_its_site():
    city, ids, polys, tree = _quarter()
    church = {
        "id": "Q2",
        "label": "Alte Reformierte Kirche",
        "building": True,
        "x": 20.0,
        "y": 20.0,
    }
    standing = {**church, "states": [], "dissolved": None}
    assert landmarks.matched_objects(standing, city, ids, polys, tree, {}) == ["wing"]
    demolished = {**church, "states": [landmarks.DEMOLISHED], "dissolved": "1894-01-01"}
    assert landmarks.matched_objects(demolished, city, ids, polys, tree, {}) == []
    # unless OSM tags a standing outline with it
    outline = {"Q2": [shapely.box(0, 0, 40, 40)]}
    assert landmarks.matched_objects(demolished, city, ids, polys, tree, outline) == ["wing"]


def test_a_point_beside_a_building_needs_it_near_or_named():
    city, ids, polys, tree = _quarter()
    item = {"id": "Q3", "label": "Lindenbrauerei", "building": True, "states": []}
    near = {**item, "x": 128.0, "y": 10.0}  # 8 m off the brewery
    assert landmarks.matched_objects(near, city, ids, polys, tree, {}) == ["brewery"]
    far = {**item, "x": 138.0, "y": 10.0}  # 18 m off
    assert landmarks.matched_objects(far, city, ids, polys, tree, {}) == []
    named = {"brewery": "Kulturzentrum Lindenbrauerei"}
    assert landmarks.matched_objects(far, city, ids, polys, tree, {}, named) == ["brewery"]
    # a name of the same kind is no name: "Altes Rathaus" is not the "Neues Rathaus"
    town = {**item, "label": "Altes Rathaus", "x": 55.0, "y": 20.0}  # 15 m off the wing
    hall = {"wing": "Neues Rathaus"}
    assert landmarks.matched_objects(town, city, ids, polys, tree, {}, hall) == []


def test_an_old_cache_is_completed_with_the_state(tmp_path, monkeypatch):
    dest = tmp_path / "landmarks_t.json"
    items = [{"id": "Q1", "label": "A"}, {"id": "Q2", "label": "B"}]
    dest.write_text(json.dumps({"landmarks": items}))
    rows = [
        {
            "i": {"value": "http://www.wikidata.org/entity/Q1"},
            "dissolved": {"value": "1894-01-01T00:00:00Z"},
            "states": {"value": "http://www.wikidata.org/entity/Q56556915"},
        },
        {"i": {"value": "http://www.wikidata.org/entity/Q2"}},
    ]
    monkeypatch.setattr(landmarks, "_ask", lambda query: rows)
    assert landmarks.complete_status(dest)
    a, b = json.loads(dest.read_text())["landmarks"]
    assert a["dissolved"] == "1894-01-01" and a["states"] == [landmarks.DEMOLISHED]
    assert landmarks.gone(a) and not landmarks.gone(b)
    assert not landmarks.complete_status(dest)  # complete already
