"""The dormer bake's pure parts: which way a roof falls, and which blobs
of surface over it are a dormer's shape."""

import math
from types import SimpleNamespace

import numpy as np
from scipy import ndimage as ndi

from bake import dormers
from bake.skyview import Field


def roof_falling_east(n: int = 30) -> SimpleNamespace:
    """A 45° roof over n × n one-metre cells, falling towards +x."""
    field = Field((0, 0, n, n), 1.0)
    cols = np.arange(n) + 0.5
    roof = np.tile(100.0 - cols, (n, 1))
    return SimpleNamespace(field=field, roof=roof)


def dormer_of(s, excess: np.ndarray):
    """The one blob of `excess` over the roof as find() reads it: its
    dormer, its slice and its mask."""
    labels, _ = ndi.label(excess >= dormers.MIN_EXCESS_M)
    sl = ndi.find_objects(labels)[0]
    m = labels[sl] == 1
    gx, gy = dormers.roof_gradient(s.roof, s.field.res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    return dormers.dormer(s, sl, m, excess, gx, gy, slope), sl, m


def blob(s, r0: int, c0: int, rows: int, cols: int, lift: float):
    excess = np.zeros_like(s.roof)
    excess[r0 : r0 + rows, c0 : c0 + cols] = lift
    return dormer_of(s, excess)[0]


def test_gradient_in_epsg_axes():
    s = roof_falling_east()
    gx, gy = dormers.roof_gradient(s.roof, 1.0)
    assert np.allclose(gx, -1) and np.allclose(gy, 0)
    # rows run south: a roof rising with the row index falls to the north
    gx, gy = dormers.roof_gradient(s.roof.T.copy(), 1.0)
    assert np.allclose(gx, 0) and np.allclose(gy, 1)


def test_a_dormer_faces_down_the_slope():
    s = roof_falling_east()
    d = blob(s, 10, 10, 3, 2, 1.5)
    assert d is not None
    assert (d["ax"], d["ay"]) == (1.0, 0.0)
    assert (d["w"], d["d"]) == (3.0, 2.0)
    assert d["slope"] == 45.0
    assert d["top"] - d["z"] == 1.5


def test_what_is_no_dormer():
    s = roof_falling_east()
    # a chimney: too small
    assert blob(s, 10, 10, 1, 2, 1.5) is None
    # a crown: too high over the roof
    assert blob(s, 10, 10, 3, 3, dormers.MAX_TOP_M + 1) is None
    # a long ridge feature: wider than a dormer
    assert blob(s, 2, 10, dormers.MAX_SIDE_M + 2, 2, 1.5) is None


# --- G11: a shed dormer's fall -----------------------------------------------


N = 30
TAN20 = math.tan(math.radians(20))


def roof_with(top) -> SimpleNamespace:
    """`roof_falling_east(N)` (roof(x) = 100 − x) with a dormer 5 cells wide
    (rows 10–14) whose front stands at x = 14: the surface over it `top(x)`
    where that rises over the roof."""
    s = roof_falling_east(N)
    x = np.arange(N) + 0.5
    s.dom = s.roof.copy()
    for c in range(N):
        if x[c] < 14:
            s.dom[10:15, c] = max(s.roof[0, c], top(x[c]))
    return s


def read(s):
    """The one blob's dormer and its roof's fall, as find() reads them."""
    excess = s.dom - s.roof
    d, sl, m = dormer_of(s, excess)
    return d, dormers.roof_fall(s, sl, m, d, excess)


def test_a_shed_dormer_reads_its_fall_and_where_it_meets_the_roof():
    # 3 m over the roof at its front, falling 20° down the slope
    s = roof_with(lambda x: 89.0 + TAN20 * (14 - x))
    d, fall = read(s)
    assert d is not None and fall is not None
    assert abs(fall[0] - 20) < 2
    top = dormers.shed_top(d["z"], d["slope"], d["d"], fall)
    # its roof meets the main roof at x ≈ 9.3, 90.7 m up (the bake's z is
    # the roof at the centre's cell, half a metre off the centre)
    assert top is not None and abs(top - 90.7) < 0.6


def test_a_flat_dormer_stays_flat_though_its_front_cells_read_low():
    s = roof_with(lambda x: 89.7)
    # the front cells half over the front wall read the roof below
    s.dom[10:15, 13] -= 0.6
    d, fall = read(s)
    assert d is not None and fall is not None
    assert abs(fall[0]) < dormers.SHED_MIN_FALL
    assert dormers.shed_top(d["z"], d["slope"], d["d"], fall) is None


def test_a_rise_as_steep_as_the_roof_is_no_shed_dormer():
    # the surface parallel to the roof, 1.5 m over it: LoD2 drew it low
    assert dormers.shed_top(90.0, 45.0, 4.0, (44.0, 91.5)) is None
    # a fall too gentle to tell from a flat roof
    assert dormers.shed_top(90.0, 45.0, 4.0, (5.0, 91.5)) is None
    # a roof that would pass under the main roof before its front
    assert dormers.shed_top(90.0, 45.0, 1.0, (20.0, 89.0)) is None
    # unreadable: no fall
    assert dormers.shed_top(90.0, 45.0, 4.0, None) is None


def test_a_shallow_dormer_has_no_fall_to_read():
    # 2 m deep along the slope: nothing left once the front 1.5 m is out
    s = roof_with(lambda x: 89.0 if x > 12 else 0.0)
    d, fall = read(s)
    assert d is not None
    assert fall is None
