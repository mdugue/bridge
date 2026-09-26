"""The small-structure bake on a synthetic 100 m tile: a shed, a pent-roofed
shed, a shrub, a van on the road, a clipped evergreen hedge block."""

import numpy as np
import shapely

from bake.lowveg import Grid
from bake.small_buildings import (
    Rasters,
    Structure,
    find_structures,
    is_excluded_area,
    is_vehicle_sized,
    keep,
)

X0, Y0, N = 400000.0, 5600000.0, 200  # 100 m at 0.5 m
GROUND = 100.0


def box(a, r0, c0, rows, cols, value):
    a[r0 : r0 + rows, c0 : c0 + cols] = value


def scene():
    grid = Grid(X0, Y0, X0 + 100, Y0 + 100)
    dsm = np.full((N, N), np.nan)
    dtm = np.full((N, N), GROUND)
    me = np.zeros((N, N))
    cls = np.full((N, N), 4, np.uint8)
    ndvi = np.zeros((N, N), np.float32)
    # a 4 × 5 m shed, 2.5 m tall, one echo per pulse
    box(dsm, 20, 20, 8, 10, GROUND + 2.5)
    # a 4 × 4 m pent-roofed shed rising 15° to the east
    rise = np.tan(np.radians(15)) * 0.5 * np.arange(8)
    dsm[20:28, 60:68] = GROUND + 2.2 + rise[None, :]
    # a shrub: 3 m across, 2.4 m, every cell multi-echo
    yy, xx = np.mgrid[:N, :N]
    shrub = np.hypot(yy - 120, xx - 30) <= 3
    dsm[shrub] = GROUND + 2.4
    me[shrub] = 2
    # a van on the road
    cls[100:110, 100:120] = 7
    box(dsm, 103, 105, 4, 10, GROUND + 2.6)
    # a clipped evergreen block, flat and single-echo but green
    box(dsm, 150, 150, 8, 8, GROUND + 2.2)
    box(ndvi, 150, 150, 8, 8, 0.5)
    masked = np.zeros((N, N), bool)
    return grid, Rasters(dsm=dsm, dtm=dtm, multiecho=me, cls=cls, ndvi=ndvi, masked=masked)


def centres(found):
    """(x from the west, y from the north) of each structure, in whole metres."""
    out = []
    for s in found:
        c = shapely.Polygon(s.ring).centroid
        out.append((round(c.x - X0), round(Y0 + 100 - c.y)))
    return sorted(out)


def test_a_shed_and_a_pent_roof_are_found_the_shrub_van_and_hedge_are_not():
    grid, r = scene()
    found = find_structures(r, grid)
    # (x from the west, y from the north) in metres: the two sheds only
    assert centres(found) == [(12, 12), (32, 12)]
    flat = next(s for s in found if s.corners is None)
    assert abs(flat.h - 2.5) < 0.05
    assert flat.z == GROUND
    assert abs(shapely.Polygon(flat.ring).area - 20.0) < 0.5


def test_a_tilted_top_is_a_pent_roof_with_its_corner_heights():
    grid, r = scene()
    pent = next(s for s in find_structures(r, grid) if s.corners is not None)
    lo, hi = min(pent.corners), max(pent.corners)
    assert 2.0 < lo < 2.4
    assert hi - lo > 0.8  # 15° over 4 m ≈ 1.07 m
    assert lo <= pent.h <= hi


def test_a_blob_under_the_lod2_mask_is_left_to_lod2():
    grid, r = scene()
    r.masked[15:35, 15:35] = True
    assert centres(find_structures(r, grid)) == [(32, 12)]


def test_markets_building_sites_and_car_parks_are_excluded_areas():
    assert is_excluded_area(None, None, None, '"highway"=>"pedestrian","area"=>"yes"')
    assert is_excluded_area(None, None, "square", None)
    assert is_excluded_area("marketplace", None, None, None)
    assert is_excluded_area(None, "construction", None, None)
    assert is_excluded_area("parking", None, None, '"parking"=>"surface"')
    assert is_excluded_area("parking", None, None, None)
    # a carport is a structure worth keeping
    assert not is_excluded_area("parking", None, None, '"parking"=>"carports"')
    assert not is_excluded_area(None, "allotments", None, None)


def rect(w, length, h):
    ring = [(0.0, 0.0), (length, 0.0), (length, w), (0.0, w), (0.0, 0.0)]
    return Structure(ring, 100.0, h, None)


def test_vehicle_sized_boxes_need_an_osm_building_to_stay():
    van, shed = rect(2.4, 5.5, 2.6), rect(3.5, 4.0, 2.6)
    assert is_vehicle_sized(van)
    assert not is_vehicle_sized(shed)
    assert not is_vehicle_sized(rect(2.4, 5.5, 4.5))  # too tall for a van
    assert not keep(van, None, None, None)
    assert keep(shed, None, None, None)
    outline = shapely.box(-1, -1, 10, 10)
    assert keep(van, None, None, outline)
    assert not keep(shed, outline, None, None)  # inside an excluded area
    assert not keep(shed, None, shapely.box(3, 1, 5, 2), None)  # a shelter is drawn there
