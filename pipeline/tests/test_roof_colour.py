import numpy as np

from bake.roof_colour import PITCHED_DEG, median_colour, ring_slope


def _metres(points):
    return lambda vi: points[vi]


def test_ring_slope_flat_and_pitched():
    flat = [(0, 0, 10), (4, 0, 10), (4, 4, 10), (0, 4, 10)]
    assert ring_slope(range(4), _metres(flat)) < 1
    # 45°: rises 4 m over 4 m
    slope = [(0, 0, 10), (4, 0, 10), (4, 4, 14), (0, 4, 14)]
    assert abs(ring_slope(range(4), _metres(slope)) - 45) < 1e-6
    # a mansard's lower slope reads as pitched, its top as low
    mansard = [(0, 0, 10), (4, 0, 10), (4, 2, 16), (0, 2, 16)]
    assert ring_slope(range(4), _metres(mansard)) >= PITCHED_DEG


def test_median_colour_reads_only_its_rings():
    rgb = np.zeros((20, 20, 3), np.uint8)
    rgb[:, :10] = (200, 60, 50)  # red tiles on the left
    rgb[:, 10:] = (190, 195, 195)  # grey zinc on the right
    box = (0, 0, 20, 20)
    left = [[(0, 0), (10, 0), (10, 20), (0, 20)]]
    right = [[(10, 0), (20, 0), (20, 20), (10, 20)]]
    red = median_colour(rgb, left, box, erode=3)
    grey = median_colour(rgb, right, box, erode=3)
    assert red is not None and grey is not None
    assert red[0] > 3 * red[1]
    assert abs(grey[0] - grey[1]) < 0.05


def test_median_colour_needs_enough_texels():
    rgb = np.full((20, 20, 3), 128, np.uint8)
    tiny = [[(0, 0), (2, 0), (2, 2), (0, 2)]]
    assert median_colour(rgb, tiny, (0, 0, 20, 20), erode=0) is None
