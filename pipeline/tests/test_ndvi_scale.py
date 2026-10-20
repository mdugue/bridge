"""Every flight's vegetation index on one scale: a site's carriageways and
its mown lawns go to Dresden's medians, so a threshold tuned there means the
same green in every city."""

from __future__ import annotations

import dataclasses

import numpy as np
import rasterio
from PIL import Image

from bake import ndvi
from bake.common import Products
from tests.synthetic import SIZE, osm_tile, way

PX = 400  # 0.5 m texels: enough lawn and carriageway for MIN_SAMPLES


def _nir(red: float, index: float) -> float:
    """The infrared value that gives `index` beside `red` (DOP numbers)."""
    return (red * (1 + index) + index) / (1 - index)


def _tile(tmp_path, monkeypatch, road: float, lawn: float, crown: float):
    """A 200 m tile, row 0 = north, from a flight whose raw index reads
    `road` on the primary road along y = 100, `lawn` on the grass west of
    x = 80 (y 120–180) and `crown` on a tree east of it."""
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (10, 120, ""),
        4: (80, 120, ""),
        5: (80, 180, ""),
        6: (10, 180, ""),
    }
    ways = way(1, [1, 2], {"highway": "primary"}) + way(2, [3, 4, 5, 6, 3], {"landuse": "grass"})
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    tile = dataclasses.replace(tile, products=Products(dom=True, dop="rgbi", dlm=False))
    red = np.full((PX, PX), 100.0)
    nir = np.full((PX, PX), 100.0)
    m = PX // SIZE  # texels a metre

    def at(x0, y0, x1, y1):
        return np.s_[(SIZE - y1) * m : (SIZE - y0) * m, x0 * m : x1 * m]

    nir[at(0, 94, 200, 106)] = _nir(100, road)
    nir[at(10, 120, 80, 180)] = _nir(100, lawn)
    nir[at(120, 140, 140, 160)] = _nir(100, crown)
    path = tile.raw_raster("dop")
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=PX,
        height=PX,
        count=4,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(PX),
    ) as dst:
        for i, band in enumerate((red, red, red, nir), start=1):
            dst.write(band.astype("float32"), i)
    return tile


def _index(tile, x: float, y: float) -> float:
    img = np.asarray(Image.open(tile.data / "dlm" / "ndvi_t.png"))
    m = img.shape[0] / SIZE
    return img[int((SIZE - y) * m), int(x * m)] / 255.0


def test_a_flight_s_road_and_lawn_go_to_the_reference_medians(tmp_path, monkeypatch):
    # Leipzig's flight: asphalt −0.15, a mown lawn 0.12 — a crown 0.40
    tile = _tile(tmp_path, monkeypatch, road=-0.15, lawn=0.12, crown=0.40)
    ndvi.run(tile, px=PX)
    assert abs(_index(tile, 40, 150) - ndvi.REF_LAWN) < 0.01
    assert _index(tile, 150, 100) == 0.0  # the road, at −0.30 on Dresden's scale
    gain = (ndvi.REF_LAWN - ndvi.REF_ROAD) / (0.12 + 0.15)
    want = ndvi.REF_ROAD + (0.40 + 0.15) * gain
    assert abs(_index(tile, 130, 150) - min(want, 1.0)) < 0.01


def test_a_reference_flight_keeps_its_index(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch, road=ndvi.REF_ROAD, lawn=ndvi.REF_LAWN, crown=0.40)
    ndvi.run(tile, px=PX)
    assert abs(_index(tile, 130, 150) - 0.40) < 0.01
    assert abs(_index(tile, 40, 150) - ndvi.REF_LAWN) < 0.01


def test_the_site_shares_one_scale():
    flight = ndvi.Anchors(road=np.full(3000, -0.15), lawn=np.full(3000, 0.12))
    bare = ndvi.Anchors(road=np.full(10, 0.0), lawn=np.zeros(0))
    # a tile without lawns takes its neighbours' scale
    assert ndvi.scale([flight, bare, None]) == (-0.15, 0.12)
    # too few texels over the whole site: the raw index
    assert ndvi.scale([bare]) is None
    flat = ndvi.Anchors(road=np.full(3000, 0.1), lawn=np.full(3000, 0.12))
    assert ndvi.scale([flat]) is None  # no contrast to scale by
