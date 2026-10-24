"""The shared class-raster reader and the raster bakes that had no test:
lamps, canopy, NDVI and roof colours, each on a synthetic 200 m tile."""

from __future__ import annotations

import json

import numpy as np
import pytest
import rasterio
from PIL import Image
from synthetic import SIZE, X0, Y0, neighbour, osm_tile, read, tags

from bake import canopy, lamps, ndvi, roof_colour
from bake.common import Tile, overlaps, pixel_of, value_at

WATER, ROAD, MEADOW = 8, 7, 3


def _raster(tile: Tile, product: str, bands: list[np.ndarray], dtype: str) -> None:
    """A raw raster (DOM1, DOP) over the tile, one array per band."""
    path = tile.raw_raster(product)
    path.parent.mkdir(parents=True, exist_ok=True)
    h, w = bands[0].shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=w,
        height=h,
        count=len(bands),
        dtype=dtype,
        crs="EPSG:25833",
        transform=tile.transform(w),
    ) as dst:
        for i, band in enumerate(bands, start=1):
            dst.write(band.astype(dtype), i)


# --- common --------------------------------------------------------------------


def test_the_pixel_under_a_point_counts_rows_from_the_north():
    bounds = (0.0, 0.0, 100.0, 100.0)
    assert pixel_of((10, 10), bounds, 5.0, 95.0) == (0, 0)
    assert pixel_of((10, 10), bounds, 95.0, 5.0) == (9, 9)
    # Half-open like `owns`: the east and north edges are the neighbour's.
    assert pixel_of((10, 10), bounds, 100.0, 50.0) is None
    assert pixel_of((10, 10), bounds, 50.0, 100.0) is None
    assert pixel_of((10, 10), bounds, 0.0, 0.0) == (9, 0)


def test_value_at_reads_the_class_under_a_point():
    raster = np.zeros((4, 4), np.uint8)
    raster[0, 3] = WATER
    bounds = (0.0, 0.0, 40.0, 40.0)
    assert value_at(raster, bounds, 35.0, 35.0) == WATER
    assert value_at(raster, bounds, 5.0, 5.0) == 0
    assert value_at(raster, bounds, -1.0, 5.0) is None


def test_a_tile_reads_its_own_and_its_neighbours_class_raster(tmp_path, monkeypatch):
    cls = np.full((SIZE, SIZE), MEADOW, np.uint8)
    tile = osm_tile(tmp_path, monkeypatch, {}, classes=cls)
    other = neighbour(tile, "u")
    assert tile.classes() is not None
    assert int(tile.classes()[0, 0]) == MEADOW
    assert tile.classes("u") is None  # not baked yet
    found = dict(tile.neighbours())
    assert set(found) == {"t", "u"}
    assert found["u"] == other.bounds
    assert overlaps(found["t"], (X0 + 10, Y0 + 10, X0 + 20, Y0 + 20))
    assert not overlaps(found["t"], found["u"])  # edge to edge


# --- lamps ---------------------------------------------------------------------


def test_lamps_stand_where_the_ground_allows_and_credit_osm(tmp_path, monkeypatch):
    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[:, 100:] = WATER  # the eastern half is river
    lamp = tags(highway="street_lamp")
    tile = osm_tile(tmp_path, monkeypatch, {1: (50, 50, lamp), 2: (150, 50, lamp)}, classes=cls)
    lamps.run(tile, lamp_height=6.0)
    doc = read(tile, "lamps")
    assert "OpenStreetMap" in doc["attribution"]
    assert len(doc["features"]) == 1
    (only,) = doc["features"]
    assert only["properties"] == {"h": 6.0}
    assert abs(only["geometry"]["coordinates"][0] - (X0 + 50)) < 0.2


def test_lamps_without_a_class_raster_write_nothing(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, {1: (50, 50, tags(highway="street_lamp"))})
    (tile.data / "dlm" / "landcover_t.png").unlink()
    lamps.run(tile)
    assert not (tile.data / "dlm" / "lamps_t.geojson").exists()


# --- canopy --------------------------------------------------------------------


def test_the_canopy_plants_the_tallest_texel_off_the_blocked_classes(tmp_path, monkeypatch):
    cls = np.full((SIZE, SIZE), MEADOW, np.uint8)
    cls[:, 100:] = WATER
    tile = osm_tile(tmp_path, monkeypatch, {}, classes=cls, dgm=100.0)
    dom = np.full((SIZE, SIZE), 100.0)
    dom[50, 50] = 112.0  # a 12 m crown on the meadow
    dom[50, 51] = 110.0  # its shoulder, in the same 7 m cell
    dom[50, 150] = 115.0  # a mooring post in the river: blocked
    dom[20, 20] = 160.0  # 60 m: above MAX_H, a mast, not a tree
    _raster(tile, "dom1", [dom], "float32")
    # The DLM's forest/park mask everywhere (no shapefiles in the fixture).
    monkeypatch.setattr(canopy, "vegetation_mask", lambda t, px: np.ones((px, px), np.uint8))
    canopy.run(tile, cell=7)
    features = read(tile, "canopy")["features"]
    assert len(features) == 1
    (tree,) = features
    assert tree["properties"]["h"] == 12.0
    x, y = tree["geometry"]["coordinates"]
    assert (round(x - X0, 1), round(y - Y0, 1)) == (50.5, 149.5)


def test_the_canopy_without_dom1_leaves_committed_files_alone(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, {})
    out = tile.data / "dlm"
    out.mkdir(parents=True, exist_ok=True)
    (out / "canopy_t.geojson").write_text('{"features": [1]}')
    before = sorted(p.name for p in out.iterdir())
    canopy.run(tile)
    assert (out / "canopy_t.geojson").read_text() == '{"features": [1]}'
    assert sorted(p.name for p in out.iterdir()) == before


# --- NDVI ----------------------------------------------------------------------


def test_ndvi_is_one_byte_of_vigour_clamped_at_zero(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, {})
    red = np.full((64, 64), 40.0)
    nir = np.full((64, 64), 200.0)
    red[:, 32:], nir[:, 32:] = 200.0, 40.0  # the eastern half: bare, negative NDVI
    green = np.zeros((64, 64))
    _raster(tile, "dop", [red, green, green, nir], "uint8")
    ndvi.run(tile, px=32)
    img = Image.open(tile.data / "dlm" / "ndvi_t.png")
    assert img.mode == "L"  # the viewer inflates it as one grey byte
    data = np.asarray(img)
    assert data.shape == (32, 32)
    expected = int((200 - 40) / (200 + 40 + 1) * 255)
    assert abs(int(data[5, 5]) - expected) <= 1
    assert int(data[5, 25]) == 0


def test_without_infrared_green_reads_as_vegetation_and_grey_does_not(tmp_path, monkeypatch):
    # a DOP of three bands (Bavaria's): the visible-band index stands in,
    # on the NDVI's scale — a lawn, a grey road and a dull verge in thirds
    tile = osm_tile(tmp_path, monkeypatch, {})
    red, green, blue = (np.zeros((48, 48)) for _ in range(3))
    for col, (r, g, b) in enumerate(((60, 110, 50), (120, 120, 120), (90, 95, 85))):
        part = np.s_[:, col * 16 : col * 16 + 16]
        red[part], green[part], blue[part] = r, g, b
    _raster(tile, "dop", [red, green, blue], "uint8")
    ndvi.run(tile, px=24)
    data = np.asarray(Image.open(tile.data / "dlm" / "ndvi_t.png")) / 255.0
    lawn, road, dull = data[12, 4], data[12, 12], data[12, 20]
    assert lawn > 0.3  # on the NDVI's "vegetated" side
    assert road < 0.2
    assert road < dull < lawn


# --- roof colours ----------------------------------------------------------------


def test_a_roof_takes_the_median_orthophoto_colour_in_linear_rgb(tmp_path, monkeypatch):
    tile = osm_tile(tmp_path, monkeypatch, {})
    r = np.full((SIZE, SIZE), 30.0)
    g = np.full((SIZE, SIZE), 30.0)
    b = np.full((SIZE, SIZE), 30.0)
    # A red roof over x 40..80, y 120..160 (rows 40..80 from the north).
    r[40:80, 40:80] = 200.0
    nir = np.zeros((SIZE, SIZE))
    _raster(tile, "dop", [r, g, b, nir], "uint8")
    square = [
        [X0 + 40, Y0 + 120, 0],
        [X0 + 80, Y0 + 120, 0],
        [X0 + 80, Y0 + 160, 0],
        [X0 + 40, Y0 + 160, 0],
    ]
    city = {
        "type": "CityJSON",
        "vertices": square,
        "CityObjects": {
            "house": {
                "type": "Building",
                "geometry": [
                    {
                        "type": "MultiSurface",
                        "boundaries": [[[0, 1, 2, 3]]],
                        "semantics": {"surfaces": [{"type": "RoofSurface"}], "values": [0]},
                    }
                ],
            },
            "shed": {"type": "Building", "geometry": []},
        },
    }
    path = tile.data / "cityjson" / "lod2_t.city.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(city))
    roof_colour.run(tile)
    out = json.loads((tile.data / "dop" / "roofcolor_t.json").read_text())
    assert set(out["roofs"]) == {"house"}
    red, green, blue = out["roofs"]["house"]
    # sRGB 200 and 30 in linear light (IEC 61966-2-1), taken on to grey
    kr, kg, kb = (float(k) for k in roof_colour._TO_GREY)
    assert red == pytest.approx(0.577580 * kr, abs=1e-4)
    assert green == pytest.approx(0.012983 * kg, abs=1e-4)
    assert blue == pytest.approx(0.012983 * kb, abs=1e-4)
    assert out["meta"]["buildings_sampled"] == 1
