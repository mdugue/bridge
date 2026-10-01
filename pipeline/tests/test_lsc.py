"""The laser scan's class tables and intensity normalisation (lsc.py, and
Bavaria's table in providers/by.py), on synthetic scans."""

from __future__ import annotations

import datetime

import laspy
import numpy as np
import rasterio

from bake import lsc
from bake.providers import by


def scan(path, x, y, z, cls, intensity, returns=None, year=2022):
    header = laspy.LasHeader(point_format=1, version="1.2")
    header.scales = [0.01, 0.01, 0.01]
    header.offsets = [0, 0, 0]
    header.creation_date = datetime.date(year, 6, 1)
    las = laspy.LasData(header)
    las.x, las.y, las.z = np.asarray(x, float), np.asarray(y, float), np.asarray(z, float)
    las.classification = np.asarray(cls, np.uint8)
    las.intensity = np.asarray(intensity, np.uint16)
    n = len(cls)
    las.return_number = np.ones(n, np.uint8)
    las.number_of_returns = np.asarray(returns if returns is not None else [1] * n, np.uint8)
    las.write(path)
    return path


def lowint(folder):
    with rasterio.open(folder / "lowint_050.tif") as ds:
        return ds.read(1), ds.read(2), ds.tags()


def test_the_median_of_a_histogram():
    assert lsc.histogram_median(np.bincount([5, 1, 9])) == 5
    assert lsc.histogram_median(np.zeros(10, np.int64)) == 0


def test_a_scan_is_scaled_to_the_reference_ground_brightness(tmp_path):
    # Ground twice as bright as the reference's (a 16-bit sensor, say), and
    # one shrub return 1 m over it: its intensity is halved in the raster.
    ref = lsc.REFERENCE_GROUND_INTENSITY
    x = [0.1, 0.2, 0.3, 0.1]
    y = [0.1, 0.2, 0.3, 0.2]
    z = [100.0, 100.0, 100.0, 101.0]
    laz = scan(
        tmp_path / "t.laz", x, y, z, [2, 2, 2, 20], [2 * ref - 10, 2 * ref, 2 * ref + 10, 3000]
    )
    scale = lsc.rasterise(laz, tmp_path, (0.0, 0.0, 4.0, 4.0), 25832)
    assert scale == ref / (2 * ref)
    mean, count, tags = lowint(tmp_path)
    assert count[7, 0] == 1
    assert mean[7, 0] == 1500.0
    assert tags["ground_intensity_median"] == str(2 * ref)


def test_the_reference_scan_is_left_as_it_is(tmp_path):
    ref = lsc.REFERENCE_GROUND_INTENSITY
    laz = scan(
        tmp_path / "t.laz",
        [0.1, 0.1],
        [0.1, 0.2],
        [100.0, 101.0],
        [2, 20],
        [ref, 1234],
    )
    assert lsc.rasterise(laz, tmp_path, (0.0, 0.0, 4.0, 4.0), 25833) == 1.0
    assert lowint(tmp_path)[0][7, 0] == 1234.0


def test_a_scan_without_intensities_is_not_scaled():
    assert lsc.intensity_scale(0) == 1.0


def test_bavarias_classes_are_merged_into_the_adv_scheme(tmp_path):
    # ground, building, object point (vegetation), cellar entrance, noise,
    # synthetic ground, water
    cls = [2, 6, 20, 22, 7, 23, 9]
    n = len(cls)
    a = scan(tmp_path / "a.laz", np.arange(n) + 0.5, [0.5] * n, [100.0] * n, cls, [1000] * n)
    out = lsc.merge_laz([a], tmp_path / "m.laz", classes=by.lsc_classes)
    las = laspy.read(out)
    assert list(las.classification) == [2, 20, 20, 30, 8]
    assert list(np.round(las.x, 1)) == [0.5, 1.5, 2.5, 5.5, 6.5]


def test_before_2021_bavarias_class_22_is_a_bridge(tmp_path):
    a = scan(
        tmp_path / "a.laz", [0.5, 1.5], [0.5, 0.5], [100.0, 106.0], [2, 22], [1000, 1000], year=2019
    )
    las = laspy.read(lsc.merge_laz([a], tmp_path / "m.laz", classes=by.lsc_classes))
    assert list(las.classification) == [2, 20]


def test_buildings_and_vegetation_both_stand_on_the_ground_after_the_merge(tmp_path):
    # A Bavarian building return and a vegetation return over one ground
    # cell: after the merge both count as non-ground, as in GeoSN's scan.
    a = scan(
        tmp_path / "a.laz",
        [0.1, 0.2, 0.3],
        [0.1, 0.1, 0.1],
        [100.0, 108.0, 102.0],
        [2, 6, 20],
        [1000, 1000, 1000],
        returns=[1, 1, 2],
    )
    merged = lsc.merge_laz([a], tmp_path / "m.laz", classes=by.lsc_classes)
    lsc.rasterise(merged, tmp_path, (0.0, 0.0, 4.0, 4.0), 25832)
    with rasterio.open(tmp_path / "nonground_count_050.tif") as ds:
        assert ds.read(1)[7, 0] == 2
    with rasterio.open(tmp_path / "nonground_multiecho_count_050.tif") as ds:
        assert ds.read(1)[7, 0] == 1
    with rasterio.open(tmp_path / "dsm_050.tif") as ds:
        assert ds.read(1)[7, 0] == 108.0


def test_nrws_crown_tops_in_class_1_are_read_as_non_ground(tmp_path):
    # NRW keeps a scan's non-last echoes (the crowns) in class 1, roofs and
    # last echoes in 20, a bridge in 17, synthetic ground in 26; noise (18)
    # and points below the ground (24) are dropped
    from bake.providers import nw

    cls = [2, 1, 20, 17, 26, 18, 24]
    n = len(cls)
    a = scan(tmp_path / "a.laz", np.arange(n) + 0.5, [0.5] * n, [100.0] * n, cls, [1000] * n)
    las = laspy.read(lsc.merge_laz([a], tmp_path / "m.laz", classes=lambda _: nw.LSC_CLASSES))
    assert list(las.classification) == [2, 20, 20, 20, 30]
