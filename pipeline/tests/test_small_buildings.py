"""The small-structure bake on a synthetic 100 m tile: a shed, a pent-roofed
shed, a shrub, a van on the road, a clipped evergreen hedge block."""

import numpy as np
import rasterio
import shapely
from PIL import Image

from bake.common import Tile
from bake.lowveg import LSC_RASTERS, Grid
from bake.small_buildings import (
    SEAM_MARGIN_M,
    Rasters,
    Structure,
    find_structures,
    is_excluded_area,
    is_vehicle_sized,
    keep,
    load_rasters,
    owned,
    without_overlaps,
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
    # the roof rises to the east: the two eastern corners are the high ones
    xs = [x for x, _ in pent.ring[:4]]
    east = sorted(range(4), key=lambda k: -xs[k])[:2]
    assert sorted(pent.corners[k] for k in east) == sorted(pent.corners)[2:]
    assert (
        min(pent.corners[k] for k in east) - max(pent.corners[k] for k in range(4) if k not in east)
        > 0.8
    )


def test_a_box_on_falling_ground_stands_on_its_lowest_point_or_not_at_all():
    grid, r = scene()
    # the flat shed's ground falls 1 m to the east under it: z is the low side
    r.dtm[:, 25:40] = GROUND - 1.0
    r.dsm[20:28, 20:30] = GROUND + 2.5
    flat = next(s for s in find_structures(r, grid) if s.corners is None)
    assert flat.z == GROUND - 1.0
    assert abs(flat.h - 3.5) < 0.05
    # an embankment's edge: 2 m of fall under the rectangle, no box
    r.dtm[:, 25:40] = GROUND - 2.0
    assert all(s.corners is not None for s in find_structures(r, grid))


def test_of_two_overlapping_rectangles_the_larger_stays():
    big = rect(4.0, 5.0, 2.5)
    small = Structure(
        [(4.0, 3.0), (7.0, 3.0), (7.0, 6.0), (4.0, 6.0), (4.0, 3.0)], 100.0, 2.5, None
    )
    touch = Structure(
        [(5.0, 0.0), (8.0, 0.0), (8.0, 3.0), (5.0, 3.0), (5.0, 0.0)], 100.0, 2.5, None
    )
    assert without_overlaps([small, big]) == [big]  # 1 m² in common
    assert without_overlaps([big, touch]) == [big, touch]  # edge to edge


def _scan_tile(tmp_path, tid: str, dx: float, dsm: np.ndarray) -> Tile:
    """A 100 m tile with flat ground, its 0.5 m scan rasters and a class
    raster, `dx` m east of X0."""
    tile = Tile(
        tid, (X0 + dx, Y0, X0 + dx + 100, Y0 + 100), 25833, tmp_path / "raw", tmp_path / "data"
    )
    der = tile.raw / "lsc" / tid
    der.mkdir(parents=True)
    bands = {
        "dsm_050.tif": {"max": dsm, "count": np.ones((N, N))},
        "dtm_050.tif": {"min": np.full((N, N), GROUND), "idw": np.full((N, N), GROUND)},
        "nonground_multiecho_count_050.tif": {"count": np.zeros((N, N))},
    }
    for name in LSC_RASTERS:
        layers = bands.get(name, {"count": np.zeros((N, N))})
        with rasterio.open(
            der / name,
            "w",
            driver="GTiff",
            width=N,
            height=N,
            count=len(layers),
            dtype="float32",
            crs="EPSG:25833",
            transform=tile.transform(N),
            nodata=-9999,
        ) as dst:
            for i, (desc, a) in enumerate(layers.items(), start=1):
                dst.write(np.nan_to_num(a, nan=-9999).astype("float32"), i)
                dst.set_band_description(i, desc)
    tile.dgm.parent.mkdir(parents=True)
    with rasterio.open(
        tile.dgm,
        "w",
        driver="GTiff",
        width=100,
        height=100,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(100),
    ) as dst:
        dst.write(np.full((100, 100), GROUND, np.float32), 1)
    Image.fromarray(np.full((N, N), 4, np.uint8)).save(tile.out("dlm", f"landcover_{tid}.png"))
    return tile


def test_a_shed_on_the_seam_is_found_whole_and_written_once(tmp_path):
    west_dsm, east_dsm = np.full((N, N), np.nan), np.full((N, N), np.nan)
    # a 6 × 4 m shed at x 96–102 m, y 40–44 m from the south: 4 m of it on
    # the west tile, 2 m on the east one
    west_dsm[112:120, 192:200] = GROUND + 2.5
    east_dsm[112:120, 0:4] = GROUND + 2.5
    west = _scan_tile(tmp_path, "t", 0.0, west_dsm)
    east = _scan_tile(tmp_path, "u", 100.0, east_dsm)
    found = {}
    for tile in (west, east):
        xmin, ymin, xmax, ymax = tile.bounds
        m = SEAM_MARGIN_M
        grid = Grid(xmin - m, ymin - m, xmax + m, ymax + m)
        found[tile.id] = find_structures(load_rasters(tile, grid), grid)
    for tid in ("t", "u"):
        (shed,) = found[tid]  # each side sees it whole
        assert abs(shapely.Polygon(shed.ring).area - 24.0) < 0.5
    assert len(owned(west, found["t"])) == 1  # its centroid (x 99 m) is west's
    assert owned(east, found["u"]) == []


def test_a_shed_cut_by_the_sites_edge_is_dropped(tmp_path):
    dsm = np.full((N, N), np.nan)
    dsm[112:120, 192:200] = GROUND + 2.5  # runs into the east edge; no tile there
    west = _scan_tile(tmp_path, "t", 0.0, dsm)
    xmin, ymin, xmax, ymax = west.bounds
    grid = Grid(
        xmin - SEAM_MARGIN_M, ymin - SEAM_MARGIN_M, xmax + SEAM_MARGIN_M, ymax + SEAM_MARGIN_M
    )
    assert find_structures(load_rasters(west, grid), grid) == []


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
