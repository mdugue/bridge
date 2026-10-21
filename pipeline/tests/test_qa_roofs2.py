"""The roof check's second round (2026-10-21): a shed dormer's fall
(dormers.py), the roof colour of the scan's sheds and the structures
beyond LoD2 (roof_colour.py), a shop window a passage runs through
(shopfronts.py), and a shed in shadow held to a cleaner box
(small_buildings.py)."""

import json
import math
from types import SimpleNamespace

import numpy as np
import rasterio
import shapely
from rasterio.transform import from_origin
from scipy import ndimage as ndi

from bake import dormers, roof_colour, shopfronts, small_buildings
from bake.common import Tile
from bake.lowveg import Grid
from bake.skyview import Field

# --- G11: a shed dormer's fall -----------------------------------------------

N = 30
TAN20 = math.tan(math.radians(20))


def roof_with(top) -> SimpleNamespace:
    """A 45° roof over N × N one-metre cells falling east (roof(x) = 100 −
    x), a dormer 5 cells wide (rows 10–14) whose front stands at x = 14:
    the surface over it `top(x)` where that rises over the roof."""
    field = Field((0, 0, N, N), 1.0)
    x = np.arange(N) + 0.5
    roof = np.tile(100.0 - x, (N, 1))
    dom = roof.copy()
    for c in range(N):
        if x[c] < 14:
            dom[10:15, c] = max(roof[0, c], top(x[c]))
    return SimpleNamespace(field=field, roof=roof, dom=dom)


def read(s):
    """The one blob's dormer and its roof's fall, as find() reads them."""
    excess = s.dom - s.roof
    labels, _ = ndi.label(excess >= dormers.MIN_EXCESS_M)
    sl = ndi.find_objects(labels)[0]
    m = labels[sl] == 1
    gx, gy = dormers.roof_gradient(s.roof, s.field.res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    d = dormers.dormer(s, sl, m, excess, gx, gy, slope)
    return d, dormers.roof_fall(s, sl, m, d, excess)


def test_a_shed_dormer_reads_its_fall_and_where_it_meets_the_roof():
    # 3 m over the roof at its front, falling 20° down the slope
    s = roof_with(lambda x: 89.0 + TAN20 * (14 - x))
    d, fall = read(s)
    assert d is not None and fall is not None
    assert abs(fall[0] - 20) < 2
    top = dormers.shed_top(d["z"], d["slope"], d["d"], fall)
    # its roof meets the main roof at x ≈ 9.3, 90.7 m up (the bake's z is
    # the roof at the centre's cell, half a metre off the centre)
    assert top is not None and abs(top - 90.7) < 0.6


def test_a_flat_dormer_stays_flat_though_its_front_cells_read_low():
    s = roof_with(lambda x: 89.7)
    # the front cells half over the front wall read the roof below
    s.dom[10:15, 13] -= 0.6
    d, fall = read(s)
    assert d is not None and fall is not None
    assert abs(fall[0]) < dormers.SHED_MIN_FALL
    assert dormers.shed_top(d["z"], d["slope"], d["d"], fall) is None


def test_a_rise_as_steep_as_the_roof_is_no_shed_dormer():
    # the surface parallel to the roof, 1.5 m over it: LoD2 drew it low
    assert dormers.shed_top(90.0, 45.0, 4.0, (44.0, 91.5)) is None
    # a fall too gentle to tell from a flat roof
    assert dormers.shed_top(90.0, 45.0, 4.0, (5.0, 91.5)) is None
    # a roof that would pass under the main roof before its front
    assert dormers.shed_top(90.0, 45.0, 1.0, (20.0, 89.0)) is None
    # unreadable: no fall
    assert dormers.shed_top(90.0, 45.0, 4.0, None) is None


def test_a_shallow_dormer_has_no_fall_to_read():
    # 2 m deep along the slope: nothing left once the front 1.5 m is out
    s = roof_with(lambda x: 89.0 if x > 12 else 0.0)
    d, fall = read(s)
    assert d is not None
    assert fall is None


# --- G5: the roof colour of the appended roofs ----------------------------------


def test_an_appended_roof_is_read_at_its_top_a_pent_one_by_its_corners():
    ring = [[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]]
    flat, base = roof_colour.appended_face(
        {"z": 10.0, "h": 2.5}, {"type": "Polygon", "coordinates": [ring]}
    )
    assert base == 10.0 and flat[0].normal == (0.0, 0.0, 1.0)
    assert {p[2] for p in flat[0].rings[0]} == {12.5}
    pent, _ = roof_colour.appended_face(
        {"z": 10.0, "h": 2.5, "hc": [2.0, 3.0, 3.0, 2.0]},
        {"type": "Polygon", "coordinates": [ring]},
    )
    outer = pent[0].rings[0]
    assert [p[2] for p in outer] == [12.0, 13.0, 13.0, 12.0, 12.0]
    # rising to the east: its normal leans west
    assert pent[0].normal[0] < -0.1 and pent[0].normal[2] > 0.9
    multi, _ = roof_colour.appended_face(
        {"z": 0.0, "h": 3.0}, {"type": "MultiPolygon", "coordinates": [[ring], [ring]]}
    )
    assert len(multi) == 2
    assert roof_colour.appended_face({"z": 0.0, "h": 3.0}, {"type": "Point"}) is None


def _colour_tile(tmp_path, rgb: np.ndarray) -> Tile:
    """A 20 m tile with a 0.2 m DOP `rgb` (3 × 100 × 100), no LoD2 building,
    a shed at (5–9, 5–9) and the structures file: a building at (12–17,
    12–17), a mast and a relief."""
    tile = Tile("t", (0.0, 0.0, 20.0, 20.0), 25833, tmp_path / "raw", tmp_path / "data")
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
    city = {"type": "CityJSON", "vertices": [], "CityObjects": {}}
    tile.cityjson.parent.mkdir(parents=True)
    tile.cityjson.write_text(json.dumps(city))

    def square(x0, y0, x1, y1):
        return {
            "type": "Polygon",
            "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
        }

    def fc(features):
        return json.dumps({"type": "FeatureCollection", "features": features})

    dlm = tile.data / "dlm"
    dlm.mkdir(parents=True)
    shed = {"type": "Feature", "properties": {"z": 100.0, "h": 2.5}, "geometry": square(5, 5, 9, 9)}
    (dlm / "smallbuild_t.geojson").write_text(fc([shed]))
    gaps = [
        {
            "type": "Feature",
            "properties": {"kind": "mast", "z": 100.0, "h": 20.0},
            "geometry": {"type": "Point", "coordinates": [2.0, 2.0]},
        },
        {
            "type": "Feature",
            "properties": {"kind": "relief", "z": 100.0, "h": 5.0, "of": "x"},
            "geometry": square(1, 12, 4, 15),
        },
        {
            "type": "Feature",
            "properties": {"kind": "building", "z": 100.0, "h": 9.0},
            "geometry": square(12, 12, 17, 17),
        },
    ]
    (dlm / "structures_t.geojson").write_text(fc(gaps))
    return tile


def test_the_scans_sheds_and_the_missing_buildings_get_their_photos_colour(tmp_path):
    rgb = np.full((3, 100, 100), 120, np.uint8)
    rgb[:, 55:75, 25:45] = np.array([200, 60, 50])[:, None, None]  # the shed's red
    rgb[:, 15:40, 60:85] = np.array([140, 150, 160])[:, None, None]  # the building's zinc
    tile = _colour_tile(tmp_path, rgb)
    roof_colour.run(tile, erode=3)
    out = json.loads(tile.out("dop", "roofcolor_t.json").read_text())
    (scan,) = out["scan"]
    lin = [round(roof_colour.srgb_to_linear(c), 4) for c in (200.0, 60.0, 50.0)]
    assert scan == [0, 100.0, *lin]
    # the mast and the relief are not read, the building is (its index kept)
    (gap,) = out["gaps"]
    assert gap[:2] == [2, 100.0]
    assert gap[2] < gap[4]
    assert out["meta"]["scan_sampled"] == 1 and out["meta"]["gaps_sampled"] == 1


def test_a_shed_in_shadow_keeps_the_palettes_roof(tmp_path):
    rgb = np.full((3, 100, 100), 120, np.uint8)
    rgb[:, 50:80, 20:50] = np.array([30, 40, 70])[:, None, None]  # in shade
    tile = _colour_tile(tmp_path, rgb)
    roof_colour.run(tile, erode=3)
    out = json.loads(tile.out("dop", "roofcolor_t.json").read_text())
    assert out["scan"] == []


# --- G20: a passage through a shop window ------------------------------------------


def wall(bays):
    # a 10 m wall along the x axis, its outside to the south
    return {
        "oid": "o",
        "wi": 0,
        "a": [0.0, 0.0],
        "b": [10.0, 0.0],
        "L": 10.0,
        "n": [0.0, -1.0],
        "bays": bays,
    }


def test_a_bays_band_reaches_behind_the_wall_and_a_little_before_it():
    band = shopfronts.bay_band(wall([]), 2.0, 4.0)
    assert band.bounds == (2.0, -shopfronts.PASSAGE_OUT_M, 4.0, shopfronts.PASSAGE_IN_M)


def test_a_passage_or_an_arcade_takes_the_bay_it_crosses():
    buildings = {"b": [wall([[1.0, 3.0], [5.0, 7.0], [8.0, 9.5]])]}
    ways = np.array(
        [
            # a passage through the ground floor at x = 6
            shapely.LineString([(6.0, -3.0), (6.0, 12.0)]),
            # an arcade 2 m behind the wall along its first metres
            shapely.LineString([(0.0, 2.0), (2.0, 2.0)]),
            # a way 6 m inside the block: no bay's
            shapely.LineString([(8.0, 6.0), (9.5, 6.0)]),
        ]
    )
    assert shopfronts.without_passages(buildings, ways) == 2
    assert buildings["b"][0]["bays"] == [[8.0, 9.5]]
    assert shopfronts.without_passages(buildings, np.array([], dtype=object)) == 0


def test_without_its_photos_cache_a_tile_keeps_its_committed_shopfronts(tmp_path):
    tile = Tile(
        "t", (0.0, 0.0, 20.0, 20.0), 25833, tmp_path / "raw", tmp_path / "data", mapillary=True
    )
    out = tile.out("dlm", "shopfronts_t.json")
    shopfronts.write(out, {"b": [wall([[1.0, 3.0]])]})
    before = out.read_text()
    shopfronts.run(tile)
    # no extract: nothing crosses, nothing is emptied
    assert json.loads(out.read_text()) == json.loads(before)


# --- G28: a shed in shadow -----------------------------------------------------------

X0, Y0, M = 400000.0, 5600000.0, 200  # 100 m at 0.5 m
GROUND = 100.0


def shed_scene(lum: float, rough: float = 0.0, notch: bool = False):
    """A 4 × 5 m shed 2.5 m tall, its top `rough` (± per cell), with a
    notch out of its corner where `notch` (fill 0.7), under an orthophoto of
    luminance `lum`."""
    grid = Grid(X0, Y0, X0 + 100, Y0 + 100)
    dsm = np.full((M, M), np.nan)
    top = GROUND + 2.5 + rough * np.where(np.indices((8, 10)).sum(0) % 2, 1, -1)
    dsm[20:28, 20:30] = top
    if notch:
        dsm[20:24, 20:26] = np.nan
    r = small_buildings.Rasters(
        dsm=dsm,
        dtm=np.full((M, M), GROUND),
        multiecho=np.zeros((M, M)),
        cls=np.full((M, M), 4, np.uint8),
        ndvi=np.zeros((M, M), np.float32),
        masked=np.zeros((M, M), bool),
        lum=np.full((M, M), lum, np.float32),
    )
    return r, grid


def test_a_clean_shed_in_shadow_stays():
    assert len(small_buildings.find_structures(*shed_scene(lum=30.0))) == 1


def test_a_rough_top_in_shadow_is_no_shed_in_sun_it_is():
    assert len(small_buildings.find_structures(*shed_scene(lum=120.0, rough=0.25))) == 1
    assert small_buildings.find_structures(*shed_scene(lum=30.0, rough=0.25)) == []


def test_a_ragged_outline_in_shadow_is_no_shed_in_sun_it_is():
    assert len(small_buildings.find_structures(*shed_scene(lum=120.0, notch=True))) == 1
    assert small_buildings.find_structures(*shed_scene(lum=30.0, notch=True)) == []


def test_without_an_orthophoto_nothing_is_in_shadow():
    r, grid = shed_scene(lum=30.0, rough=0.25)
    r.lum = None
    assert len(small_buildings.find_structures(r, grid)) == 1
    r.lum = np.full_like(r.dsm, np.nan, dtype=np.float32)
    assert len(small_buildings.find_structures(r, grid)) == 1


def test_the_orthophotos_luminance_on_the_scans_grid(tmp_path):
    tile = Tile("t", (X0, Y0, X0 + 100, Y0 + 100), 25833, tmp_path / "raw", tmp_path / "data")
    assert small_buildings.dop_luminance(tile) is None
    dop = tile.raw_raster("dop")
    dop.parent.mkdir(parents=True)
    rgb = np.zeros((3, 500, 500), np.uint8)
    rgb[:, :250] = 200  # the north half bright
    with rasterio.open(
        dop,
        "w",
        driver="GTiff",
        width=500,
        height=500,
        count=3,
        dtype="uint8",
        crs="EPSG:25833",
        transform=from_origin(X0, Y0 + 100, 0.2, 0.2),
    ) as out:
        out.write(rgb)
    lum = small_buildings.dop_luminance(tile)
    assert lum.shape == (200, 200)
    assert abs(float(lum[0, 0]) - 200) < 0.5 and float(lum[-1, -1]) == 0.0
