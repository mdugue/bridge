"""A conifer's crown form as the surface model shows it: a pine's flat top
or a spruce's cone (the canopy's evergreens, canopy.py, and a register or
OSM conifer of no known genus, trees.py).

The canopy marks a crown evergreen (a needle forest's, or green in a mixed
forest on a leaf-off flight) but knows no genus, and in a Central European
forest that crown is a pine as often as a spruce or a fir — the Dresdner
Heide's are mostly Scots pines. A pine's crown is high, rounded and
flat-topped; a spruce's a cone that falls away from its tip. DOM1 at 1 m
shows that much: a fifth of the tree's height out from the top, the surface
of a pine's crown is still near the top, a cone's has fallen a good part of
the height (`ring_drop`). Measured on the registers' conifers that DOM1
sees as recorded (Dresden and Leipzig, 10 m and taller: 668 pines, 382
spruces, firs, thujas, false cypresses, larches, Douglas firs and hemlocks):
the median ring drop is 0.22 of the height for the pines and 0.43 for the
cones; under FLAT_DROP fall 73 % of the pines and 29 % of the cones. Not
the crown's full width over its height: in a closed stand the neighbours'
crowns fill it in, and the 1 m model blurs a cone's flanks (the registers'
pines are 0.47 of their height across, the spruces 0.44).
"""

from __future__ import annotations

from functools import cache

import numpy as np

# The ring's radius (share of the tree's height) and half-width (m).
RING_SHARE = 0.2
RING_HALF_M = 0.7
# A crown whose surface on the ring lies less than this share of its height
# below its top is flat-topped: a pine's.
FLAT_DROP = 0.3


@cache
def _ring(radius_dm: int) -> tuple[np.ndarray, np.ndarray]:
    """The texel offsets (rows, cols) of the ring `radius_dm` decimetres out
    (1 m texels), RING_HALF_M wide either side."""
    radius = radius_dm / 10
    reach = int(np.ceil(radius + RING_HALF_M))
    yy, xx = np.mgrid[-reach : reach + 1, -reach : reach + 1]
    rho = np.hypot(yy, xx)
    on = (rho > radius - RING_HALF_M) & (rho <= radius + RING_HALF_M)
    return yy[on], xx[on]


def ring_drop(ndom: np.ndarray, r: int, c: int, top: float) -> float | None:
    """How far the surface lies below a crown's `top` (m) at (r, c) on the
    ring RING_SHARE of its height out, as a share of the height: the median
    over the ring's texels inside the raster (NaN ones left out); None where
    the ring is not in view."""
    if top <= 0:
        return None
    dr, dc = _ring(max(10, round(RING_SHARE * top * 10)))
    rr, cc = r + dr, c + dc
    inside = (rr >= 0) & (rr < ndom.shape[0]) & (cc >= 0) & (cc < ndom.shape[1])
    vals = ndom[rr[inside], cc[inside]]
    vals = vals[np.isfinite(vals)]
    if vals.size < dr.size / 2:
        return None
    return float((top - np.median(vals)) / top)


def flat_topped(ndom: np.ndarray, r: int, c: int, top: float) -> bool:
    """Whether the crown at (r, c), `top` m tall, is a pine's flat top
    (`ring_drop` under FLAT_DROP); a crown out of view is not."""
    drop = ring_drop(ndom, r, c, top)
    return drop is not None and drop < FLAT_DROP


def mark_pines(
    leaves: list[dict], ndom: np.ndarray, rows: np.ndarray, cols: np.ndarray, tops: np.ndarray
) -> list[dict]:
    """The canopy's leaf properties (canopy.py `leaf_types`) with `pine: 1`
    on each evergreen whose crown, at (rows, cols) of the 1 m nDOM and
    `tops` m tall, is flat-topped (`flat_topped`): the viewer draws it a
    pine's crown, high on its stem, and the rest of the evergreens cones."""
    return [
        {**leaf, "pine": 1}
        if leaf.get("l") == "e" and flat_topped(ndom, int(r), int(c), float(top))
        else leaf
        for leaf, r, c, top in zip(leaves, rows, cols, tops, strict=True)
    ]
