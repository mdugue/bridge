import json

import numpy as np
import pytest

from bake import windows as win
from bake.facade_measure import PX
from bake.facade_traits import STEP_M, traits_of


def _square_wave(period_m: float, dark_m: float, length_m: float) -> list[int]:
    """A column profile (‰) of dark openings `dark_m` wide every `period_m`."""
    xs = np.arange(int(length_m / STEP_M)) * STEP_M
    return [900 if (x % period_m) < dark_m else 50 for x in xs]


def _facade(axis: float = 3.0, w: float = 1.2, storey: float = 3.2, h: float = 1.6):
    """A rendered wall 18 m long, 16 m to the eave, rows from the eave down
    (as facade_measure.rectify lays it out): light plaster, dark windows
    on a grid over a 4 m ground floor."""
    width, eave = 18.0, 16.0
    rgb = np.full((int(eave * PX), int(width * PX), 3), 0.8)
    for z0 in np.arange(4.9, eave - 1.0 - h, storey):
        for x0 in np.arange(0.9, width - w, axis):
            r0, r1 = int((eave - z0 - h) * PX), int((eave - z0) * PX)
            rgb[r0:r1, int(x0 * PX) : int((x0 + w) * PX)] = 0.15
    return rgb, np.ones(rgb.shape[:2], bool), eave


def test_the_period_is_the_first_strong_peak_not_its_double():
    p = win.as_profile(_square_wave(3.0, 1.2, 18))
    got = win.period(p, *win.AXIS_M)
    assert got is not None
    assert got[0] == pytest.approx(3.0, abs=0.06)
    assert got[1] > win.REGULAR


def test_no_period_in_a_flat_or_short_profile():
    assert win.period(win.as_profile([300] * 120), *win.AXIS_M) is None
    assert win.period(win.as_profile(_square_wave(3.0, 1.2, 4)), *win.AXIS_M) is None
    # unseen bins are left out, not read as plaster
    assert np.isnan(win.as_profile([-1, 500])[0])


def test_duty_is_the_dark_share():
    d = win.duty(win.as_profile(_square_wave(3.0, 1.2, 18)))
    assert d == pytest.approx(0.4, abs=0.04)


def test_spearman_ranks():
    assert win.spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1)
    assert win.spearman([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1)
    assert win.spearman([1, 2], [1, 2]) is None


def test_a_synthetic_facade_reads_as_its_grid():
    rgb, valid, eave = _facade()
    r = traits_of(rgb, valid, eave)
    assert r["cov"] == pytest.approx(1, abs=0.01)
    f = win.image_features(r)
    assert f["axis"] == pytest.approx(3.0, abs=0.1)
    assert f["grid"] >= win.REGULAR
    assert f["storey"] == pytest.approx(3.2, abs=0.15)
    assert f["width"] == pytest.approx(1.2, abs=0.25)


def test_the_model_draws_only_what_is_reliable_and_measured():
    traits = {"grid": 0.7, "width": 1.1, "prop": 0.7, "storey": 3.4, "sill": 0.6, "orn": 0.02}
    m = win.model(traits, 3.0)
    # the sill band failed its ρ: measured, not drawn
    assert m == {"axis": 3.0, "grid": "regular", "w": 1.1, "h": 1.57, "storey": 3.4, "orn": True}
    assert "orn" not in win.model(traits | {"orn": 0.005}, 3.0)
    # no axis, an axis outside a window rhythm, or no grid: no windows
    assert win.model(traits, None) is None
    assert win.model(traits, 6.5) is None
    assert win.model(traits | {"grid": 0.1}, 3.0) is None
    assert win.model(traits | {"grid": 0.3}, 3.0)["grid"] == "loose"
    # an unreliable feature falls back to the medians or is left out
    m = win.model(traits | {"frame": 0.5}, 3.0, frozenset({"axis", "grid"}))
    assert m == {
        "axis": 3.0,
        "grid": "regular",
        "w": round(win.WIDTH_SHARE * 3.0, 2),
        "h": round(win.WIDTH_SHARE * 3.0 / win.PROPORTION, 2),
    }
    # the piers keep their width
    assert win.model(traits | {"width": 2.0}, 2.2)["w"] == pytest.approx(2.2 - win.MIN_PIER_M)


def test_a_wall_needs_images_whose_axes_agree():
    agree = {"s1": [{"axis": 3.0}, {"axis": 3.1}], "s2": [{"axis": 2.95}]}
    assert win.axis_agrees(agree) == pytest.approx(3.0)
    assert win.axis_agrees({"s1": [{"axis": 3.0}]}) is None
    assert win.axis_agrees({"s1": [{"axis": 3.0}, {"axis": 6.0}, {"axis": 4.5}]}) is None


def test_blurred_or_partial_images_are_left_out():
    good = {"seq": "a", "cov": 0.8, "res": 0.05, "cd": _square_wave(3.0, 1.2, 18)}
    assert win.by_sequence([good, good | {"res": 0.1}, good | {"cov": 0.3, "seq": "b"}]).keys() == {
        "a"
    }
    assert len(win.by_sequence([good, good | {"res": 0.1}])["a"]) == 1


def test_a_tile_without_traits_writes_an_empty_file(tmp_path):
    out = tmp_path / "windows.json"
    win.write(out, {}, {})
    doc = json.loads(out.read_text())
    assert doc["buildings"] == {} and doc["reliability"] == {}
    assert "Mapillary" in doc["attribution"]
