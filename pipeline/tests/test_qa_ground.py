"""The ground's photo-QA rules (PR #173): water that runs piped is not drawn,
the DLM road land's green is not painted as road, the kerb bits the ground's
kerb band follows, and the visible-band turf test."""

from __future__ import annotations

import numpy as np
import pyogrio.raw
import rasterio
import shapely
from PIL import Image

from bake import edges, landcover, landcover_osm, markings
from bake.common import Tile, feature, geometry_json, write_geojson
from tests.synthetic import SIZE, X0, Y0, osm_tile, read, way
from tests.test_markings import _outputs, _street


def _shapefile(path, geoms, fields: dict[str, list[str]], kind: str = "LineString") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pyogrio.raw.write(
        path,
        np.array([shapely.to_wkb(g) for g in geoms], dtype=object),
        [np.array(v, dtype=object) for v in fields.values()],
        fields=list(fields),
        crs="EPSG:25833",
        geometry_type=kind,
        driver="ESRI Shapefile",
    )


def _line(*xy: tuple[float, float]) -> shapely.LineString:
    return shapely.LineString([(X0 + x, Y0 + y) for x, y in xy])


def _dlm_tile(tmp_path) -> Tile:
    return Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")


# --- water in a culvert ---------------------------------------------------------


def test_a_dlm_stream_is_not_painted_where_it_runs_piped(tmp_path):
    tile = _dlm_tile(tmp_path)
    # an open stream with a culvert from x = 60 to 140 (Durchlass, BWF 2010),
    # and a second axis the DLM flags as lying in a structure (HDU_X)
    _shapefile(
        tile.dlm / "gew01_l.shp",
        [_line((0, 100), (200, 100)), _line((0, 40), (200, 40))],
        {"HDU_X": ["0", "1"]},
    )
    # the culvert, and a road bridge over the stream (another structure)
    _shapefile(
        tile.dlm / "ver06_l.shp",
        [_line((60, 100), (140, 100)), _line((30, 90), (30, 110))],
        {"BWF": ["2010", "1800"]},
    )
    water = shapely.union_all(landcover.stream_buffers(tile))
    assert water.contains(shapely.Point(X0 + 20, Y0 + 100))  # open, under the bridge too
    assert water.contains(shapely.Point(X0 + 30, Y0 + 100))
    assert water.contains(shapely.Point(X0 + 180, Y0 + 100))
    assert not water.intersects(shapely.Point(X0 + 100, Y0 + 100).buffer(3))
    assert not water.intersects(shapely.Point(X0 + 100, Y0 + 40).buffer(3))


def test_a_dlm_stream_without_structures_is_painted_whole(tmp_path):
    tile = _dlm_tile(tmp_path)
    _shapefile(tile.dlm / "gew01_l.shp", [_line((0, 100), (200, 100))], {"HDU_X": ["0"]})
    water = shapely.union_all(landcover.stream_buffers(tile))
    assert abs(water.area - 200 * 2 * landcover.STREAM_HALF_M) < 10


def test_osm_land_cover_draws_no_covered_water(tmp_path, monkeypatch):
    nodes = {
        1: (10, 50, ""),
        2: (190, 50, ""),
        3: (10, 150, ""),
        4: (190, 150, ""),
        11: (80, 80, ""),
        12: (120, 80, ""),
        13: (120, 120, ""),
        14: (80, 120, ""),
    }
    ways = (
        way(10, [1, 2], {"waterway": "stream"})
        + way(11, [3, 4], {"waterway": "stream", "covered": "yes"})
        + way(12, [11, 12, 13, 14, 11], {"natural": "water", "covered": "yes"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    order, _ = landcover_osm.burn_order(tile)
    raster = landcover.class_raster(tile, SIZE, order)
    assert raster[200 - 50, 100] == 8  # the open stream
    assert raster[200 - 150, 100] != 8  # the covered one
    assert raster[200 - 100, 100] != 8  # the covered pond


def test_hidden_water_reads_culverts_covers_and_underground():
    hidden = landcover_osm.hidden_water
    assert hidden('"covered"=>"yes"')
    assert hidden('"tunnel"=>"culvert"')
    assert hidden('"location"=>"underground"')
    assert not hidden('"covered"=>"no"')
    assert not hidden('"name"=>"Kortelbach"')
    assert not hidden(None)


# --- the kerb band follows the kerb lines --------------------------------------


def test_the_kerb_bit_lies_round_a_kerb_line_out_to_its_reach(tmp_path):
    tile = _dlm_tile(tmp_path)
    bits = markings.kerb_bits(tile, SIZE, [_line((20, 100), (180, 100))])
    reach = markings.KERB_REACH_M + np.sqrt(2)
    rows = [r for r in range(SIZE) if bits[r, 100]]
    # row r's centre lies at y = SIZE - r - 0.5
    ys = [SIZE - r - 0.5 for r in rows]
    assert min(ys) >= 100 - reach and max(ys) <= 100 + reach
    assert bits[SIZE - 101, 100] == markings.KERB  # on the line
    assert not bits[SIZE - 101, 10] and not bits[SIZE - 101, 190]  # past its ends
    assert not markings.kerb_bits(tile, SIZE, []).any()


def test_the_markings_raster_carries_the_kerb_bit_only_where_edges_kept_a_kerb(
    tmp_path, monkeypatch
):
    # the carriageway along y = 95–105: edges.py kept the kerb on its north
    # side only (the south side runs out of town, say)
    tile = _street(tmp_path, monkeypatch, '<tag k="lanes" v="2"/>')
    x0, y0 = tile.bounds[:2]
    kerb = shapely.LineString([(x0 + 10, y0 + 105), (x0 + 190, y0 + 105)])
    write_geojson(tile.out("dlm", "kerbs_t.geojson"), [feature(geometry_json(kerb))], tile.epsg)
    markings.run(tile, px=200)
    _, raster = _outputs(tile, 200)
    bits = raster[..., 1]
    col = 60
    assert bits[94, col] & markings.KERB  # y 105.5, on the north kerb
    assert bits[97, col] & markings.KERB  # y 102.5, its gutter and shadow
    assert not bits[105, col] & markings.KERB  # y 94.5: the south edge, no kerb
    assert not bits[85, col] & markings.KERB  # y 114.5: far from any kerb
    assert bits[100, col] & 4  # the lane bits are kept
    low = np.asarray(Image.open(tile.data / "dlm" / "markings_low_t.png"))
    low = low.reshape(100, 100, 4)[..., 1]
    assert low[47, 30] & markings.KERB and not low[60, 30] & markings.KERB


# --- the road land's green: verges, embankments, islands (B12) ------------------


def _box(x0: float, x1: float, y0: float, y1: float, n: int = 400) -> np.ndarray:
    """A mask over the 200 m tile at 0.5 m (row 0 = north)."""
    m = np.zeros((n, n), dtype=bool)
    k = n / SIZE
    m[int((SIZE - y1) * k) : int((SIZE - y0) * k), int(x0 * k) : int(x1 * k)] = True
    return m


def _verge_tile(tmp_path, monkeypatch) -> Tile:
    """A dual carriageway's road parcel (class 7, y 80–120): the DLM's two
    7 m carriageways along y = 90 and 110 and, between and beside them:
    - the central strip (y 94–106), green and low, with a 6 m crown at
      x 100–106 and an unmapped gravel patch at x 60–66 (low, not green);
    - the south band (y 80–86) green under crowns all along (street trees
      over a pavement);
    - the north band (y 114–120): a car park (x 150–190) that is green,
      and a green speck of a few m² at x 10–12;
    and, apart, road land (no carriageway) 20 m across: a wooded
    embankment (y 20–40, leaf-off: a third of it reads green) and a grey
    deck standing 6 m over the ground (y 50–70)."""
    nodes = {1: (150, 113, ""), 2: (190, 113, ""), 3: (190, 121, ""), 4: (150, 121, "")}
    parking = way(20, [1, 2, 3, 4, 1], {"amenity": "parking"})
    road_land = _box(0, 200, 80, 120) | _box(0, 200, 20, 40) | _box(0, 200, 50, 70)
    cls = np.where(road_land, 7, 0).astype(np.uint8)
    tile = osm_tile(tmp_path, monkeypatch, nodes, parking, classes=cls)
    _shapefile(
        tile.dlm / "ver01_l.shp",
        [_line((0, 90), (200, 90)), _line((0, 110), (200, 110))],
        {"BRF": ["7", "7"], "WDM": ["", ""]},
    )
    green = _box(0, 200, 94, 106) & ~_box(60, 66, 97, 103)
    green |= _box(0, 200, 80, 86) | _box(150, 190, 114, 120) | _box(10, 12, 115, 119)
    green |= _box(0, 200, 20, 40) & (np.arange(400)[None, :] % 30 < 10)  # patches
    Image.fromarray((green * 255).astype(np.uint8)).save(tile.out("dlm", "ndvi_t.png"))
    crowns = _box(0, 200, 80, 86, SIZE) | _box(100, 106, 97, 103, SIZE) | _box(0, 200, 20, 40, SIZE)
    top = 100.0 + 8.0 * crowns + 6.0 * _box(0, 200, 50, 70, SIZE)
    dom = tile.raw_raster("dom1")
    dom.parent.mkdir(parents=True)
    with rasterio.open(
        dom, "w", driver="GTiff", width=SIZE, height=SIZE, count=1, dtype="float32",
        crs="EPSG:25833", transform=tile.transform(SIZE),
    ) as dst:  # fmt: skip
        dst.write(top.astype("float32"), 1)
    return tile


def _at(mask: np.ndarray, x: float, y: float) -> bool:
    k = mask.shape[0] / SIZE
    return bool(mask[int((SIZE - y) * k), int(x * k)])


def test_a_verge_is_the_green_low_road_land_clear_of_everything_paved(tmp_path, monkeypatch):
    tile = _verge_tile(tmp_path, monkeypatch)
    cls = tile.classes()
    n = cls.shape[0]
    verge = edges.verge_green(tile, cls, edges.green_ground(tile, n), edges.low_ground(tile, n))
    assert _at(verge, 30, 100)  # the central strip
    assert _at(verge, 103, 100)  # the tree on it
    assert not _at(verge, 63, 100)  # the gravel patch: low and grey
    assert not _at(verge, 30, 90) and not _at(verge, 30, 110)  # the carriageways
    assert not _at(verge, 30, 93.8)  # their margin
    assert not _at(verge, 50, 83)  # green under a row of crowns only
    assert _at(verge, 50, 30) and _at(verge, 62, 30)  # the wooded embankment
    assert not _at(verge, 50, 60)  # the deck
    assert not _at(verge, 170, 117)  # the car park
    assert not _at(verge, 11, 117)  # too small a patch
    assert not _at(verge, 50, 150)  # not road land


def test_no_verge_without_the_surface_model_or_the_dlm_road_axes(tmp_path, monkeypatch):
    tile = _verge_tile(tmp_path, monkeypatch)
    cls = tile.classes()
    green = edges.green_ground(tile, cls.shape[0])
    assert not edges.verge_green(tile, cls, green, None).any()
    low = edges.low_ground(tile, cls.shape[0])
    for part in tile.dlm.glob("ver01_l.*"):
        part.unlink()
    assert not edges.verge_green(tile, cls, green, low).any()


def test_a_verge_is_meadow_in_the_edge_raster_and_its_carriageway_side_a_kerb(
    tmp_path, monkeypatch
):
    tile = _verge_tile(tmp_path, monkeypatch)
    edges.run(tile, px=200)
    grey = np.asarray(Image.open(tile.out("dlm", "edges_t.png")).convert("L"))
    raster = grey.reshape(200, 200, 2).astype(float)
    road, meadow = (raster[..., 0] - 128) / 20, (raster[..., 1] - 128) / 20
    row = lambda y: int(SIZE - y)  # noqa: E731
    assert road[row(100), 30] < 0 and meadow[row(100), 30] > 0  # the strip: meadow
    assert road[row(90), 30] > 0  # the carriageway stays road
    assert road[row(83), 50] > 0  # the crowned band too
    kerbs = read(tile, "kerbs")["features"]
    lines = shapely.union_all([shapely.geometry.shape(f["geometry"]) for f in kerbs])
    assert lines.distance(shapely.Point(X0 + 30, Y0 + 94)) < 1.0
    assert lines.distance(shapely.Point(X0 + 30, Y0 + 106)) < 1.0
