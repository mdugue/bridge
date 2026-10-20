"""No canopy tree on a building's roof: over an OSM building outline the
surface model is the roof's height, and the DLM may file the ground under it
as park or sports ground (Dresden's stadium, a fair's halls, glasshouses)."""

from __future__ import annotations

import numpy as np

from bake.canopy import roof_mask
from tests.synthetic import SIZE, osm_tile, way

# a 100 × 100 m hall with a 20 × 20 m courtyard, and a lone shed
NODES = {
    1: (40, 40, ""),
    2: (140, 40, ""),
    3: (140, 140, ""),
    4: (40, 140, ""),
    5: (80, 80, ""),
    6: (100, 80, ""),
    7: (100, 100, ""),
    8: (80, 100, ""),
    11: (10, 10, ""),
    12: (20, 10, ""),
    13: (20, 20, ""),
    14: (10, 20, ""),
}
WAYS = (
    way(1, [1, 2, 3, 4, 1], {})
    + way(2, [5, 6, 7, 8, 5], {})
    + way(3, [11, 12, 13, 14, 11], {"building": "shed"})
    + '<relation id="9" version="1"><member type="way" ref="1" role="outer"/>'
    '<member type="way" ref="2" role="inner"/>'
    '<tag k="type" v="multipolygon"/><tag k="building" v="yes"/></relation>'
)


def _ndom() -> np.ndarray:
    """1 m texels, row 0 = north: the hall's roof at 20 m with a skylight
    well, a tree in the courtyard, one over the shed, ground elsewhere."""
    ndom = np.zeros((SIZE, SIZE))

    def at(x0, y0, x1, y1, h):
        ndom[SIZE - y1 : SIZE - y0, x0:x1] = h

    at(40, 40, 140, 140, 20.0)
    at(60, 120, 70, 130, 0.5)  # the well: low, but still the roof
    at(80, 80, 100, 100, 0.0)
    at(88, 88, 92, 92, 15.0)  # the courtyard's tree
    at(10, 10, 20, 20, 3.0)
    at(14, 14, 16, 16, 9.0)  # a crown over the shed
    return ndom


def row(y: int) -> int:
    return SIZE - 1 - y


def test_a_roof_inside_an_outline_is_masked_but_not_its_courtyard(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, NODES, WAYS)
    mask = roof_mask(tile, _ndom())
    assert mask[row(60), 60]  # the hall's roof
    assert mask[row(125), 65]  # its skylight well
    assert not mask[row(90), 90]  # the courtyard's tree
    assert not mask[row(40), 40]  # the eave: within ROOF_INSET_M of the wall
    assert not mask[row(150), 150]  # the ground outside


def test_a_crown_well_over_a_low_roof_is_not_the_roof(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, NODES, WAYS)
    mask = roof_mask(tile, _ndom())
    assert mask[row(12), 12]  # the shed's roof
    assert not mask[row(15), 15]  # the crown 6 m above it
