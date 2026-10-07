"""The dormer bake's pure parts: which way a roof falls, and which blobs
of surface over it are a dormer's shape."""

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


def blob(s, r0: int, c0: int, rows: int, cols: int, lift: float):
    excess = np.zeros_like(s.roof)
    excess[r0 : r0 + rows, c0 : c0 + cols] = lift
    labels, _ = ndi.label(excess >= dormers.MIN_EXCESS_M)
    sl = ndi.find_objects(labels)[0]
    gx, gy = dormers.roof_gradient(s.roof, s.field.res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    return dormers.dormer(s, sl, labels[sl] == 1, excess, gx, gy, slope)


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
