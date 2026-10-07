import numpy as np

from bake.mapillary import merged, missing


def test_both_detectors_copies_merge_into_one():
    pts = np.array([[0.0, 0.0], [2.0, 0.0], [30.0, 0.0]])
    out = merged(pts, 4.0)
    assert len(out) == 2
    assert np.allclose(out[0], [1.0, 0.0])


def test_only_what_osm_lacks_is_kept():
    pts = np.array([[0.0, 0.0], [20.0, 0.0]])
    osm = np.array([[5.0, 0.0]])
    assert np.allclose(missing(pts, osm, 8.0), [[20.0, 0.0]])
    assert len(missing(pts, np.zeros((0, 2)), 8.0)) == 2
