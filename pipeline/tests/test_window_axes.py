import math

import numpy as np

from bake import facades, window_axes
from bake.facade_traits import JX_M, STEP_M, decode_profile, jamb_profile


def _facade(n: int, axis: float, at: float, w: float, step: float) -> np.ndarray:
    """1 over each window, 0 on the plaster, a bin each `step` metres."""
    x = (np.arange(n) + 0.5) * step
    d = np.abs(((x - at + axis / 2) % axis) - axis / 2)
    return (d < w / 2).astype(float)


def _jambs(n: int, axis: float, at: float, w: float, off: float, rng) -> np.ndarray:
    """A jamb profile as a drive `off` metres out along the wall sees it:
    edges at each window's sides, some noise, a shadow's ramp."""
    x = (np.arange(n) + 0.5) * JX_M
    p = np.zeros(n)
    for c in np.arange(at % axis, n * JX_M + axis, axis):
        for e in (c - w / 2 + off, c + w / 2 + off):
            p += np.exp(-0.5 * ((x - e) / 0.06) ** 2)
    return p * 0.1 + rng.normal(0, 0.004, n) + 0.002 * x / x[-1]


def _record(seq: str, off: float, rng, axis=2.9, at=1.3, w=1.1, length=24.0) -> dict:
    jx = _jambs(int(length / JX_M), axis, at, w, off, rng)
    seen = np.ones((5, len(jx)), bool)
    ch = _facade(int(length / STEP_M), axis, at + off, w, STEP_M)
    return {
        "seq": seq,
        "jx": jamb_profile(np.tile(jx, (5, 1)), seen),
        "ch": [int(round(1000 * v)) for v in ch],
    }


def test_a_jamb_profile_survives_its_packing():
    g = np.array([[0.0, 0.1, 0.2, 0.3]] * 4)
    seen = np.ones_like(g, bool)
    seen[:, 3] = False
    p = decode_profile(jamb_profile(g, seen))
    assert np.allclose(p[:3], [0, 0.1, 0.2], atol=1e-3)
    assert np.isnan(p[3])


def test_two_strips_register_at_their_drives_difference():
    rng = np.random.default_rng(1)
    a = decode_profile(_record("a", 0.35, rng)["jx"])
    b = decode_profile(_record("b", -0.2, rng)["jx"])
    shift, r = window_axes.register(a, b)
    assert abs(shift - 0.55) <= JX_M
    assert r > 0.8


def test_a_plain_wall_does_not_register():
    rng = np.random.default_rng(2)
    a = rng.normal(0, 0.01, 400)
    b = rng.normal(0, 0.01, 400)
    assert window_axes.register(a, b) is None


def test_the_drives_errors_average_out_and_place_the_axes():
    rng = np.random.default_rng(3)
    # three drives, two images each; their errors average to +0.05 m
    errs = {"s1": 0.4, "s2": -0.3, "s3": 0.05}
    recs = [_record(s, e + rng.normal(0, 0.02), rng) for s, e in errs.items() for _ in range(2)]
    offs = window_axes.offsets(recs)
    assert offs is not None and len(offs) == 6
    for i, r in enumerate(recs):
        assert abs(offs[i] - (errs[r["seq"]] - 0.05)) < 0.08
    got = window_axes.wall_phase(recs, 2.9)
    assert got is not None and got["drives"] == 3
    # the true axes stand at 1.3 + k·2.9; the mean of the drives at +0.05
    assert abs(got["phase"] - (1.3 + 0.05)) < 0.12


def test_one_drive_places_its_axes_with_its_own_error():
    rng = np.random.default_rng(4)
    recs = [_record("s1", 0.1, rng), _record("s1", 0.12, rng)]
    got = window_axes.wall_phase(recs, 2.9)
    # the gauge puts the drive's mean on the wall: its ~0.1 m error stays
    assert got is not None and got["drives"] == 1
    assert abs(got["phase"] - (1.3 + 0.11)) < 0.08


def test_images_that_do_not_register_place_nothing():
    rng = np.random.default_rng(5)
    seen = np.ones((5, 400), bool)
    plain = [
        {"seq": s, "jx": jamb_profile(rng.normal(0, 0.01, (5, 400)), seen)} for s in ("s1", "s2")
    ]
    assert window_axes.offsets(plain) is None


def test_the_phase_needs_windows_that_agree():
    assert window_axes.phase([1.0], 3.0) is None
    assert window_axes.phase([1.0, 2.4, 3.7], 3.0) is None
    assert abs(window_axes.phase([1.0, 4.05, 6.95], 3.0) - 1.0) < 0.05
    # an axis near the wrap point
    ph = window_axes.phase([2.95, 6.02, 8.98], 3.0)
    assert min(ph, 3.0 - ph) < 0.05


def test_window_centres_skip_runs_cut_by_the_strip_end():
    p = np.full(60, 0.05)
    p[:6] = 0.9  # cut at the start: not a whole window
    p[20:31] = 0.8
    p[45:55] = 0.85
    assert np.allclose(window_axes.window_centres(p), [2.55, 5.0])


def test_the_grid_turns_from_true_north_by_the_convergence():
    # Dresden lies west of zone 33's central meridian (15° E): grid north
    # turns west of true north, by about (λ − λ0)·sin φ
    g = facades.grid_convergence(25833, 413000, 5657000)
    assert math.isclose(math.degrees(g), (13.74 - 15) * math.sin(math.radians(51.05)), abs_tol=0.05)
    # a grid vector pointing north is east-north-up's north turned by g
    rot = facades.onto_grid(np.eye(3), g)
    v = rot @ np.array([0.0, 1.0, 0.0])
    assert math.isclose(math.atan2(-v[0], v[1]), -g, abs_tol=1e-9)
