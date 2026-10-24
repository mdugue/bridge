"""The road edges' bake (pipeline/bake/edges.py): the signed edge distances, the
kerb lines and the verges."""

import numpy as np
import rasterio
import shapely
from PIL import Image

from bake import edges
from bake.common import Tile
from tests.synthetic import SIZE, X0, Y0, osm_tile, read, shapefile, tile_line, way


def _box(x0: float, x1: float, y0: float, y1: float, n: int = 400) -> np.ndarray:
    """A mask over the 200 m tile at 0.5 m (row 0 = north)."""
    m = np.zeros((n, n), dtype=bool)
    k = n / SIZE
    m[int((SIZE - y1) * k) : int((SIZE - y0) * k), int(x0 * k) : int(x1 * k)] = True
    return m


# --- the road land's green: verges, embankments, islands (B12) ------------------


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
    shapefile(
        tile.dlm / "ver01_l.shp",
        [tile_line((0, 90), (200, 90)), tile_line((0, 110), (200, 110))],
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


def test_edge_distances_are_signed_and_smooth_across_a_diagonal():
    from bake.edges import distance_px, edge_field, signed_distance_px

    mask = np.zeros((9, 9), dtype=bool)
    mask[4, 4] = True
    d = distance_px(mask, 6)
    assert d[4, 4] == 0 and d[4, 5] == 1 and d[4, 8] == 4
    sd = signed_distance_px(np.arange(8)[None, :].repeat(8, 0) < 4, 6)
    assert sd[0, 3] == 0.5 and sd[0, 4] == -0.5  # the edge between cols 3 and 4
    # A diagonal road edge: the smoothed field's 0-isoline runs straight.
    n = 64
    rows, cols = np.mgrid[0:n, 0:n]
    cls = np.where(cols > rows, 7, 4).astype(np.uint8)
    field = edge_field(cls, 7, 1.0, n)
    diag = field[np.arange(8, 56), np.arange(8, 56)]
    assert np.all(np.abs(diag) < 0.6)


def test_kerb_lines_follow_the_road_edge_with_the_road_on_their_left(tmp_path):
    from bake.common import Tile
    from bake.edges import edge_field, kerb_lines

    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    cls = np.full((64, 64), 4, dtype=np.uint8)
    cls[20:30, :] = 7  # an east-west road, rows 20–29 (y 34–44 m)
    lines = kerb_lines(tile, edge_field(cls, 7, 1.0, 64), cls)
    assert len(lines) == 2
    for line in lines:
        xy = np.asarray(line.coords)
        d = xy[-1] - xy[0]
        left = xy[len(xy) // 2] + np.array([-d[1], d[0]]) / np.hypot(*d)
        assert 34.0 < left[1] < 44.0  # the road is on the left
    # Water beside the road: no kerb on that side.
    cls[30:, :] = 8
    assert len(kerb_lines(tile, edge_field(cls, 7, 1.0, 64), cls)) == 1


def test_a_road_out_of_town_has_no_kerb(tmp_path):
    from bake.common import Tile
    from bake.edges import Roads, edge_field, kerb_lines, on_ground, out_of_town

    assert out_of_town("motorway_link", None)
    assert out_of_town("secondary", '"source:maxspeed"=>"DE:rural"')
    assert out_of_town("secondary", '"maxspeed"=>"70"')
    assert not out_of_town("primary", '"maxspeed"=>"70","zone:traffic"=>"DE:urban"')
    assert not out_of_town("residential", '"maxspeed"=>"30"')
    assert not out_of_town("tertiary", '"maxspeed"=>"walk"')
    assert out_of_town("secondary", '"maxspeed"=>"DE:rural"')
    assert not out_of_town("primary", '"maxspeed"=>"DE:urban"')
    # A motorway bridge over a town street is not the street's road.
    assert not on_ground("motorway", '"bridge"=>"yes"')
    assert on_ground("residential", '"bridge"=>"no"')
    assert not on_ground("footway", None)

    tile = Tile("t", (0.0, 0.0, 64.0, 64.0), 25833, tmp_path, tmp_path)
    cls = np.full((64, 64), 1, dtype=np.uint8)
    cls[20:30, :] = 7  # an east-west road through fields, y 34–44 m
    field = edge_field(cls, 7, 1.0, 64)
    axis = shapely.LineString([(0, 39), (64, 39)])
    town = Roads([axis], [False])
    assert len(kerb_lines(tile, field, cls, town)) == 2
    assert kerb_lines(tile, field, cls, Roads([axis], [True])) == []
    # A town street joining it: its kerbs are the street's, not the road's.
    street = shapely.LineString([(32, 0), (32, 34)])
    roads = Roads([shapely.LineString([(0, 39), (24, 39)]), street], [True, False])
    assert roads.rural_at(np.array([[2.0, 34.0], [33.0, 10.0], [200.0, 200.0]])).tolist() == [
        True,
        False,
        False,
    ]
