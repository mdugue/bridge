import json

import numpy as np
import pytest
from test_facades import X0 as sf_X0
from test_facades import Y0, _city

from bake import shopfronts as sf
from bake.facade_measure import bin_shares, ground_top
from bake.shopfronts import (
    align,
    bays,
    best_shift,
    merge,
    nearest_walls,
    shifted,
    snap_rhythm,
    vote,
)

# A shopfront 12 m long in 0.5 m bins: piers 1 m, bays 2 m (0–1 pier,
# 1–3 bay, 3–4 pier, …).
FRONT = [0, 0] + [90] * 4 + [0, 0] + [90] * 4 + [0, 0] + [90] * 4 + [0, 0] + [5] * 2


def _rec(seq: str, gf: list[int], **kw) -> dict:
    return {"seq": seq, "gf": gf} | kw


def _move(gf: list[int], k: int) -> list[int]:
    """The profile as a sequence posed k bins further along would see it
    (unseen bins -1)."""
    return ([-1] * k + gf[: len(gf) - k]) if k >= 0 else gf[-k:] + [-1] * -k


def test_openness_tells_a_shop_window_from_a_house_window_and_a_plinth():
    # rows of 0.3 m from 0.3 m up; three bins: a shop window (0.3–3.0 m),
    # a house window (0.9–2.4 m), a dark plinth (to 0.6 m) under render
    rows = []
    for k in range(10):
        z0 = round(0.3 + 0.3 * k, 2)
        rows.append([100 if z0 < 3.0 else 0, 100 if 0.9 <= z0 < 2.4 else 0, 100 if z0 < 0.6 else 0])
    v = sf.openness({"gz": rows}, 3)
    assert v.tolist() == [1.0, 0.5, 0.0]
    # a parked car hides knee height: the bin is unseen, not shut
    rows[1][0] = rows[2][0] = -1
    assert np.isnan(sf.openness({"gz": rows}, 3)[0])
    # without rows, the band's share
    assert sf.openness({"gf": [80, -1]}, 2)[0] == pytest.approx(0.8)


def test_shifting_moves_towards_the_end_and_fills_with_nan():
    p = np.array([1.0, 2.0, 3.0])
    assert np.allclose(shifted(p, 1)[1:], [1, 2]) and np.isnan(shifted(p, 1)[0])
    assert np.allclose(shifted(p, -1)[:2], [2, 3]) and np.isnan(shifted(p, -1)[2])


def test_the_shift_search_finds_a_sequence_offset_by_a_metre():
    ref = sf.as_array(FRONT, len(FRONT))
    other = sf.as_array(_move(FRONT, 2), len(FRONT))
    k, c = best_shift(ref, other, 3)
    assert k == -2 and c == pytest.approx(1.0)


def test_a_shift_that_hardly_beats_none_is_not_taken():
    rng = np.random.default_rng(1)
    ref = rng.uniform(0, 1, 30)
    other = ref + rng.normal(0, 0.3, 30)
    k, c = best_shift(ref, other, 3)
    assert k == 0 and c == pytest.approx(np.corrcoef(ref, other)[0, 1])


def test_a_flat_profile_is_not_shifted():
    ref = sf.as_array(FRONT, len(FRONT))
    flat = sf.as_array([90] * len(FRONT), len(FRONT))
    assert best_shift(ref, flat, 3) == (0, None)


def test_the_largest_sequence_is_the_reference():
    n = len(FRONT)
    shifts, stats = align(
        {"a": [_rec("a", FRONT)], "b": [_rec("b", _move(FRONT, -3))]},
        n,
    )
    assert shifts["a"] == 0 and shifts["b"] == 3
    assert stats[0]["corr"] > stats[0]["corr0"]


def test_a_bin_needs_two_votes_and_a_majority():
    p = [np.array([1.0, 0.9, 0.0, np.nan]), np.array([0.8, 0.1, np.nan, np.nan])]
    state, share = vote(p)
    # agreeing; tied; one vote; none
    assert state.tolist() == [1, -1, -1, -1]
    assert share[0] == pytest.approx(0.9)


def test_bays_bridge_one_unknown_bin_and_drop_narrow_runs():
    state = np.array([0, 1, 1, -1, 1, 0, 1, 1, 0])
    share = np.array([0.0, 1, 1, np.nan, 1, 0.2, 1, 1, 0.0])
    # 0.5–2.5 m (bridged) with its right edge into the pier by half its
    # open 0.1 m (the run beyond takes the other half); that 1 m run is too
    # narrow
    assert bays(state, share, 4.5) == [[0.5, 2.55]]


def test_the_rhythm_snaps_only_measured_near_equal_bays():
    bs = [[1.0, 3.0], [4.0, 6.2], [7.0, 8.8]]
    assert snap_rhythm(bs, 12.0) == [[1.0, 3.0], [4.1, 6.1], [6.9, 8.9]]
    uneven = [[1.0, 3.0], [4.0, 7.0], [8.0, 9.5]]
    assert snap_rhythm(uneven, 12.0) == uneven
    assert snap_rhythm(bs[:2], 12.0) == bs[:2]
    tight = [[1.0, 3.0], [3.05, 5.25], [5.35, 7.15]]  # the rhythm would close a pier
    assert snap_rhythm(tight, 12.0) == tight


def test_two_sequences_offset_by_a_metre_merge_into_the_bays():
    recs = [
        _rec("a", FRONT),
        _rec("a", FRONT),
        _rec("b", _move(FRONT, 2)),
        _rec("b", _move(FRONT, 2)),
    ]
    m = merge(recs, 10.0)
    assert m["shop"]
    assert m["align"][0]["shift"] == -2
    assert m["bays"] == [[1.0, 3.0], [4.0, 6.0], [7.0, 9.0]]


def test_one_image_alone_makes_no_shopfront():
    m = merge([_rec("a", FRONT)], 10.0)
    assert not m["shop"] and m["bays"] == []


def test_house_windows_are_no_shopfront():
    windows = [0, 0, 45, 45, 0, 0, 45, 45, 0, 0] * 2
    m = merge([_rec("a", windows), _rec("b", windows)], 10.0)
    assert not m["shop"] and m["bays"] == []


def test_a_store_sign_seen_twice_makes_a_shopfront():
    plain = [0] * 20
    recs = [
        _rec("a", plain, sg=[4, 5, 6], sz=[3.4, 4.0]),
        _rec("b", plain, sg=[5, 6, 7], sz=[3.6, 4.2]),
    ]
    m = merge(recs, 10.0)
    assert m["shop"] and m["bays"] == []
    assert m["sign"] == {"at": [[2.5, 3.5]], "z": [3.5, 4.1]}
    # one image is enough with a map feature by the wall
    assert merge(recs[:1], 10.0, near_feature=True)["sign"]["at"] == [[2.0, 3.5]]
    assert not merge(recs[:1], 10.0)["shop"]


def test_the_ground_floor_top_needs_agreeing_images():
    assert merge([_rec("a", FRONT, gt=3.1), _rec("b", FRONT, gt=3.3)], 10.0)["gf_top"] == 3.2
    assert "gf_top" not in merge([_rec("a", FRONT, gt=2.1), _rec("b", FRONT, gt=4.3)], 10.0)
    assert "gf_top" not in merge([_rec("a", FRONT, gt=3.1), _rec("b", FRONT)], 10.0)


def test_points_go_to_their_nearest_wall_within_reach():
    ws = [
        {"a": (0.0, 0.0), "b": (10.0, 0.0), "L": 10.0},
        {"a": (10.0, 0.0), "b": (10.0, 10.0), "L": 10.0},
    ]
    pts = np.array([[3.0, 1.0], [9.5, 6.0], [3.0, 9.0]])
    assert nearest_walls(ws, pts, 3.0) == {0: [3.0], 1: [6.0]}


def test_bin_shares_leave_bins_too_little_seen_unknown():
    from bake.facade_measure import PX

    w = int(0.5 * PX)
    holes = np.zeros((10, 3 * w), bool)
    holes[:, :w] = True
    seen = np.ones_like(holes)
    seen[:, 2 * w :] = False
    assert bin_shares(holes, seen, 3) == [100, 0, -1]


def test_the_ground_floor_top_is_read_from_wide_low_openings():
    from bake.facade_measure import PX

    eave = 10.0
    holes = np.zeros((int(eave * PX), 200), bool)
    row = lambda z: int((eave - z) * PX)  # noqa: E731
    holes[row(3.2) : row(0.4), 10:40] = True  # a 1.5 m shop window to 3.2 m
    holes[row(3.0) : row(0.3), 60:90] = True  # a door to 3.0 m
    holes[row(2.4) : row(1.4), 120:160] = True  # a house window: sill too high
    assert ground_top(holes, eave) == pytest.approx(3.1, abs=0.05)
    assert ground_top(holes[:, :50], eave) is None  # one narrow opening


def test_the_tile_lists_photo_shopfronts_and_osm_shops(tmp_path):
    city = _city({"A": (0, 0, 12, 10, 12), "B": (30, 0, 42, 10, 12)})
    ws = sf.walls(city)
    wa = next(w for w in ws if w["oid"] == "A" and w["L"] == pytest.approx(12.0))
    recs = [_rec("a", FRONT[:24]), _rec("b", FRONT[:24])]
    by_wall = {(wa["oid"], wa["wi"]): [r | {"oid": "A", "wi": wa["wi"]} for r in recs]}
    wb = next(w for w in ws if w["oid"] == "B")
    mid = np.array([[(wb["a"][0] + wb["b"][0]) / 2 + 0.5, (wb["a"][1] + wb["b"][1]) / 2 + 0.5]])
    ground = lambda x, y: 100.0 + 0.1 * (x - sf_X0)  # noqa: E731 — a slope eastwards
    out, stats = sf.shopfronts(city, by_wall, np.zeros((0, 2)), mid, ground)
    assert stats["photo"] == 1 and stats["osm"] == 1
    a = out["A-root"][0]
    # the outward normal points away from the footprint (A spans y 0–10)
    mid_y = (wa["a"][1] + wa["b"][1]) / 2 - Y0
    assert a["n"][1] == pytest.approx(-1.0 if mid_y < 5 else 1.0)
    # the ground in front of each end, half a metre in from the corner
    xa = wa["a"][0] + (0.5 if wa["b"][0] > wa["a"][0] else -0.5)
    assert a["z"][0] == pytest.approx(ground(xa, 0), abs=0.01)
    assert (
        a["src"] == "photo"
        and a["bays"][0] == [1.0, 3.0]
        and a["a"] == [round(c, 2) for c in wa["a"]]
    )
    b = out["B-root"][0]
    assert b["src"] == "osm" and b["osm_at"][0] == pytest.approx(wb["L"] / 2, abs=0.6)
    path = tmp_path / "s.json"
    sf.write(path, out)
    doc = json.loads(path.read_text())
    assert "Mapillary" in doc["attribution"] and "OpenStreetMap" in doc["attribution"]
