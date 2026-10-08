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


def test_a_glazed_row_takes_one_image_where_no_other_looked():
    # two images, each seeing a different half of a wall that is glass
    # nearly throughout: no bin has two votes, yet the row is its glass
    glass = [90] * 12 + [-1] * 2 + [90] * 10
    a = glass[:14] + [-1] * 10
    b = [-1] * 12 + glass[12:]
    m = merge([_rec("a", a), _rec("b", b)], 12.0)
    assert m["row"] and m["shop"]
    assert m["bays"] == [[0.0, 12.0]]
    # windows and piers in equal parts are no row
    m = merge([_rec("a", FRONT), _rec("b", FRONT)], 10.0)
    assert "row" not in m


def test_two_images_agreeing_on_wall_make_a_closed_run():
    shut = [90] * 6 + [0] * 4 + [90] * 10
    m = merge([_rec("a", shut), _rec("b", shut)], 10.0)
    assert m["closed"] == [[3.0, 5.0]]


def test_a_canopy_is_level_from_the_wall_to_its_edge():
    out = [4.3] * 7 + [4.9, 0.1] + [0.0] * 7  # a lip at 3.5 m, the edge at 4 m
    d, h = sf.canopy_depth(out, 4.4)
    assert d == pytest.approx(4.25) and h == pytest.approx(4.3)
    # a tall building's wall: no canopy (nothing low in front)
    assert sf.canopy_depth([18.0] * 4 + [0.0] * 12, 18.0) is None
    # higher than the building behind it: a tree, not its canopy
    assert sf.canopy_depth([4.3] * 4 + [0.0] * 12, 2.0) is None
    # uneven from the wall out: a crown, not a slab
    assert sf.canopy_depth([4.3, 4.3, 6.0] + [0.0] * 13, 6.5) is None
    # level as far as it was sampled: the footprint misses the building
    assert sf.canopy_depth([4.3] * 16, 4.3) is None


def test_canopies_run_along_the_wall_and_bridge_one_miss():
    w = {"a": (0.0, 0.0), "b": (12.0, 0.0), "L": 12.0, "n": (0.0, -1.0)}

    def ndom(x, y):
        if y > 0:
            return 4.4  # the pavilion behind
        if x < 2.0 or 5.0 <= x < 6.0:
            return 0.0  # no canopy there (and one miss at 5–6 m)
        return 4.3 if y > -3.6 else 0.0

    cs = sf.canopies(w, ndom)
    assert cs == [{"at": [2.0, 12.0], "d": 3.75, "h": 4.3}]


def test_the_glass_under_a_canopy_keeps_measured_walls():
    cs = [{"at": [0.0, 20.0], "d": 4.0, "h": 4.3}]
    assert sf.under_canopy(cs, []) == [[0.0, 20.0]]
    assert sf.under_canopy(cs, [[5.0, 7.0], [19.0, 20.0]]) == [[0.0, 5.0], [7.0, 19.0]]


def test_the_tile_lists_photo_shopfronts_and_no_osm_guess(tmp_path):
    city = _city({"A": (0, 0, 12, 10, 12), "B": (30, 0, 42, 10, 12)})
    ws = sf.walls(city)
    wa = next(w for w in ws if w["oid"] == "A" and w["L"] == pytest.approx(12.0))
    recs = [_rec("a", FRONT[:24]), _rec("b", FRONT[:24])]
    by_wall = {(wa["oid"], wa["wi"]): [r | {"oid": "A", "wi": wa["wi"]} for r in recs]}
    ground = lambda x, y: 100.0 + 0.1 * (x - sf_X0)  # noqa: E731 — a slope eastwards
    out, stats = sf.shopfronts(city, by_wall, np.zeros((0, 2)), ground)
    assert stats["photo"] == 1 and set(out) == {"A-root"}
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
        and "canopy" not in a
    )
    path = tmp_path / "s.json"
    sf.write(path, out)
    doc = json.loads(path.read_text())
    assert doc["attribution"] == "Mapillary, CC BY-SA 4.0"


def test_a_canopy_glazes_its_wall_and_runs_on_along_the_object(tmp_path):
    city = _city({"A": (0, 0, 12, 10, 12)})
    ws = sf.walls(city)
    wa = next(w for w in ws if w["oid"] == "A" and w["L"] == pytest.approx(12.0))
    nx, ny = wa["n"]
    recs = [_rec("a", FRONT[:24]), _rec("b", FRONT[:24])]
    by_wall = {(wa["oid"], wa["wi"]): [r | {"oid": "A", "wi": wa["wi"]} for r in recs]}
    (ax, ay) = wa["a"]

    def ndom(x, y):
        out = (x - ax) * nx + (y - ay) * ny  # metres out of wall A's line
        if out < 0:
            return 4.4 if sf_X0 <= x <= sf_X0 + 12 and Y0 <= y <= Y0 + 10 else 0.0
        return 4.3 if out < 3.6 and sf_X0 <= x <= sf_X0 + 12 else 0.0

    out, stats = sf.shopfronts(city, by_wall, np.zeros((0, 2)), lambda x, y: 100.0, ndom)
    a = next(e for e in out["A-root"] if e["wi"] == wa["wi"])
    assert a["row"] and a["canopy"][0]["d"] == pytest.approx(3.75)
    # the glass runs under the whole canopy but for the 2 m both images
    # see as wall (9–11 m; 11–12 m is too narrow a bay)
    assert a["canopy"][0]["at"] == [0.0, 12.0]
    assert a["bays"] == [[0.0, 9.0]]
    assert stats["canopy"] == 1
    sf.write(tmp_path / "s.json", out, "Quelle: GeoSN, dl-de/by-2-0")
    assert "GeoSN" in json.loads((tmp_path / "s.json").read_text())["attribution"]
