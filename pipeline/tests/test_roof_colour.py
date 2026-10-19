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


def _mansard(top_z: float):
    """A 16 m square roof: a flat 8 m top at `top_z`, four slopes down to
    12 m at the eaves (vertices 0–3 the eaves, 4–7 the top)."""
    eave = [(2, 2, 12), (18, 2, 12), (18, 18, 12), (2, 18, 12)]
    top = [(6, 6, top_z), (14, 6, top_z), (14, 14, top_z), (6, 14, top_z)]
    faces = [[[4, 5, 6, 7]]] + [[[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i]] for i in range(4)]
    geometry = {
        "type": "MultiSurface",
        "boundaries": faces,
        "semantics": {"surfaces": [{"type": "RoofSurface"}], "values": [0] * 5},
    }
    return eave + top, geometry


def _run(tmp_path, top_z: float):
    import json

    import rasterio
    from rasterio.transform import from_origin

    from bake import roof_colour
    from bake.common import Tile

    tile = Tile("t", (0.0, 0.0, 20.0, 20.0), 25833, tmp_path / "raw", tmp_path / "data")
    rgb = np.zeros((3, 100, 100), np.uint8)
    rgb[:, 10:90, 10:90] = np.array([200, 60, 50])[:, None, None]  # red slopes
    rgb[:, 30:70, 30:70] = np.array([190, 195, 195])[:, None, None]  # grey top
    dop = tile.raw_raster("dop")
    dop.parent.mkdir(parents=True)
    with rasterio.open(
        dop,
        "w",
        driver="GTiff",
        width=100,
        height=100,
        count=3,
        dtype="uint8",
        crs="EPSG:25833",
        transform=from_origin(0, 20, 0.2, 0.2),
    ) as out:
        out.write(rgb)
    vertices, geometry = _mansard(top_z)
    city = {
        "type": "CityJSON",
        "vertices": vertices,
        "CityObjects": {"b": {"type": "Building", "geometry": [geometry]}},
    }
    tile.cityjson.parent.mkdir(parents=True)
    tile.cityjson.write_text(json.dumps(city))
    roof_colour.run(tile, erode=3)
    return json.loads(tile.out("dop", "roofcolor_t.json").read_text())


def test_run_splits_a_mansard(tmp_path):
    out = _run(tmp_path, top_z=20.0)  # slopes 63°, top flat
    assert out["meta"]["roofs_split"] == 1
    red, grey = out["pitched"]["b"], out["low"]["b"]
    assert red[0] > 3 * red[1]
    assert abs(grey[0] - grey[1]) < 0.05
    assert "b" in out["roofs"]


def test_run_keeps_one_colour_near_the_boundary(tmp_path):
    # slopes rise 1.45 m over 4 m: 19.9°, too close to call
    out = _run(tmp_path, top_z=13.45)
    assert out["meta"]["roofs_split"] == 0
    assert out["pitched"] == {} and "b" in out["roofs"]
