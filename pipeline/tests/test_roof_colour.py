import numpy as np

from bake.dop_light import sun_vector
from bake.roof_colour import Light, median_colour, ring_slope


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
    assert ring_slope(range(4), _metres(mansard)) > 60


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


def _run(tmp_path, top_z: float, shade_left: bool = False, rgb=None, roof=None):
    import json

    import rasterio
    from rasterio.transform import from_origin

    from bake import roof_colour
    from bake.common import Tile

    tile = Tile("t", (0.0, 0.0, 20.0, 20.0), 25833, tmp_path / "raw", tmp_path / "data")
    if rgb is None:
        rgb = np.zeros((3, 100, 100), np.uint8)
        rgb[:, 10:90, 10:90] = np.array([200, 60, 50])[:, None, None]  # red slopes
        if shade_left:
            rgb[:, 10:90, 10:30] = np.array([30, 40, 70])[:, None, None]  # a slope in shadow
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
    vertices, geometry = roof or _mansard(top_z)
    city = {
        "type": "CityJSON",
        "vertices": vertices,
        "CityObjects": {"b": {"type": "Building", "geometry": [geometry]}},
    }
    tile.cityjson.parent.mkdir(parents=True)
    tile.cityjson.write_text(json.dumps(city))
    roof_colour.run(tile, erode=3)
    return json.loads(tile.out("dop", "roofcolor_t.json").read_text())


def test_run_gives_a_face_its_own_colour(tmp_path):
    out = _run(tmp_path, top_z=20.0)  # slopes 63°, top flat
    red = out["roofs"]["b"]
    assert red[0] > 3 * red[1]
    # the grey top differs from the red building: written apart, as the
    # loader's geometry 0, surface 0
    (face,) = out["faces"]["b"]
    assert face[:2] == [0, 0]
    assert abs(face[2] - face[3]) < 0.05 and face[2] > 0.4
    assert out["meta"]["faces_apart"] == 1


def _split_flat():
    """A flat roof at 12 m in two touching halves (x 2–10 and 10–16) and a
    third piece in the same plane that touches neither (x 17–19)."""
    vertices = [(x, y, 12) for x in (2, 10, 16) for y in (2, 18)]
    vertices += [(17, 2, 12), (19, 2, 12), (19, 18, 12), (17, 18, 12)]
    faces = [[[0, 2, 3, 1]], [[2, 4, 5, 3]], [[6, 7, 8, 9]]]
    geometry = {
        "type": "MultiSurface",
        "boundaries": faces,
        "semantics": {"surfaces": [{"type": "RoofSurface"}], "values": [0] * 3},
    }
    return vertices, geometry


def test_the_pieces_of_one_flat_roof_are_one_roof(tmp_path):
    # red under the west half, grey under the east: read alone each half
    # took its own shade; read as one roof neither is written apart, while
    # the grey piece that touches neither keeps its own
    rgb = np.zeros((3, 100, 100), np.uint8)
    rgb[:, :, :50] = np.array([200, 60, 50])[:, None, None]
    rgb[:, :, 50:] = np.array([190, 195, 195])[:, None, None]
    out = _run(tmp_path, top_z=0.0, rgb=rgb, roof=_split_flat())
    apart = {tuple(f[:2]) for f in out["faces"]["b"]}
    assert apart == {(0, 2)}


def test_run_reads_a_roof_in_sun_only(tmp_path):
    # the west slope lies in shadow: the building stays red, not brown,
    # and the slope takes the building's colour (none of its own)
    out = _run(tmp_path, top_z=20.0, shade_left=True)
    red = out["roofs"]["b"]
    assert red[0] > 3 * red[1] and red[0] > 0.4
    assert all(f[1] != 4 for f in out["faces"].get("b", []))


def test_a_face_turned_from_the_sun_is_read_as_shadow():
    light = Light(np.zeros((1, 1), bool))
    light.sun = sun_vector(180, 35)
    north = (0.0, 0.707, 0.707)  # a 45° slope facing north
    south = (0.0, -0.707, 0.707)
    assert light.faces_away(north)
    assert not light.faces_away(south)
    assert not Light(np.zeros((1, 1), bool)).faces_away(north)


def _rebuilt(tile):
    """Two rebuilt parts over the mansard's west and east halves."""
    import json

    def part(x0, x1):
        ring = [[x0, 2], [x1, 2], [x1, 18], [x0, 18], [x0, 2]]
        return {
            "type": "Feature",
            "properties": {"id": "b", "z": 14.0},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        }

    path = tile.out("dlm", "roofs_t.geojson")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"features": [part(2, 10), part(10, 18)]}))


def test_a_rebuilt_roof_is_read_part_by_part(tmp_path):
    # red west of x = 10 m, grey east of it: the LoD2 mansard's faces would
    # mix them, the rebuilt halves read each its own
    from bake.common import Tile

    tile = Tile("t", (0.0, 0.0, 20.0, 20.0), 25833, tmp_path / "raw", tmp_path / "data")
    _rebuilt(tile)
    rgb = np.zeros((3, 100, 100), np.uint8)
    rgb[:, :, :50] = np.array([200, 60, 50])[:, None, None]
    rgb[:, :, 50:] = np.array([190, 195, 195])[:, None, None]
    out = _run(tmp_path, top_z=20.0, rgb=rgb)
    assert out["meta"]["rebuilt"] == 1
    assert "b" not in out["faces"]
    parts = {p[0]: p[2:] for p in out["parts"]["b"]}
    assert all(p[1] == 14.0 for p in out["parts"]["b"])
    # the halves together are neither colour: each is written apart
    west, east = parts[0], parts[1]
    assert west[0] > 3 * west[1]
    assert abs(east[0] - east[1]) < 0.05 and east[0] > 0.4


def test_a_face_is_read_only_where_the_surface_model_shows_the_roof():
    from bake.roof_colour import Frame, on_the_roof

    dgm = np.full((20, 20), 100.0, np.float32)
    dom = dgm.copy()
    dom[:, :10] = 118.0  # the roof stands west of x = 10 m, 18 m up
    frame = Frame(0.0, 20.0, 0.2, (100, 100), dom, dgm)
    x = np.array([5.0, 15.0])
    y = np.array([10.0, 10.0])
    # a face 18 m up: on the roof in the west, the square in the east
    assert on_the_roof(frame, x, y, 118.0).tolist() == [True, False]
    # a face 3 m up is not tested (the scan cannot tell a shed from a car)
    assert on_the_roof(frame, x, y, 103.0).tolist() == [True, True]
    # nor anywhere without the models
    assert on_the_roof(Frame(0.0, 20.0, 0.2, (100, 100)), x, y, 118.0).all()


def test_gains_agree_with_the_single_gain():
    light = Light(np.zeros((1, 1), bool), (180, 35), 7.5)
    normals = np.array([(0.0, 0.0, 1.0), (0.0, -0.6, 0.8), (0.0, 0.707, 0.707), (0.5, 0.0, 0.866)])
    gains = light.gains(normals)
    assert gains[2] == 0  # turned from the sun
    for n, g in zip(normals, gains, strict=True):
        if g:
            assert abs(g - light.gain(tuple(n))) < 1e-9


def test_a_flight_s_cast_is_taken_out_of_its_roofs(tmp_path, monkeypatch):
    # the photo under a cyan cast, its carriageways (round the building)
    # telling it: the grey top comes out in Dresden's grey
    from PIL import Image

    from bake import dop_balance
    from bake.common import Tile

    def srgb8(linear):
        c = np.clip(np.asarray(linear, float), 0, 1)
        return np.round(255 * np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055))

    cyan = np.array([0.79, 1.0, 1.15])
    rgb = np.zeros((3, 100, 100), np.uint8)
    rgb[:] = srgb8(0.3 * cyan)[:, None, None]  # the road round it
    rgb[:, 10:90, 10:90] = srgb8(np.array([0.55, 0.05, 0.03]) * cyan)[:, None, None]
    rgb[:, 30:70, 30:70] = srgb8(0.5 * cyan)[:, None, None]  # the grey top
    cls = np.full((100, 100), dop_balance.ROAD, np.uint8)
    cls[10:90, 10:90] = 0
    tile = Tile("t", (0.0, 0.0, 20.0, 20.0), 25833, tmp_path / "raw", tmp_path / "data")
    Image.fromarray(cls).save(tile.out("dlm", "landcover_t.png"))
    monkeypatch.setattr(dop_balance, "MIN_TEXELS", 100)
    out = _run(tmp_path, top_z=20.0, rgb=rgb)
    (face,) = out["faces"]["b"]
    r, g, b = face[2:]
    assert abs(r / g - dop_balance.REF_ROAD[0]) < 0.03
    assert abs(b / g - dop_balance.REF_ROAD[2]) < 0.03
    assert out["meta"]["balance"][0] > 1.15 > 0.85 > out["meta"]["balance"][2]
