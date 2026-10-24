"""The QA corrections of the sky view, the far horizon, the valley's rim
(skyview.py, glo30.py) and the traffic's bridges (traffic.py): the land
beyond the site from Copernicus GLO-30, its edge run on level without it,
the crowns as a half-transparent occluder, and a section on a bridge where
it runs on a road deck."""

import json
import math
from pathlib import Path

import numpy as np
import pytest
import rasterio
import shapely
from rasterio.transform import from_origin
from rasterio.warp import transform

from bake import glo30, traffic
from bake.common import Tile
from bake.skyview import (
    CROWN_TO_HEIGHT,
    FarTerrain,
    Field,
    Roofs,
    burn_crowns,
    extend_edges,
    fields,
    horizon_tan,
    legend,
    ring_horizon,
    sky_view,
    tile_crowns,
)

# A 200 m tile near Meißen (EPSG:25833), so the window in degrees is real.
X0, Y0 = 392000.0, 5668000.0
SIZE = 200
EPSG = 25833


def _dgm(tile: Tile, heights: np.ndarray) -> None:
    path = tile.dgm
    path.parent.mkdir(parents=True, exist_ok=True)
    rows, cols = heights.shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=cols,
        height=rows,
        count=1,
        dtype="float32",
        crs=f"EPSG:{EPSG}",
        transform=from_origin(X0, Y0 + rows, 1.0, 1.0),
    ) as dst:
        dst.write(heights.astype(np.float32), 1)


def _tile(tmp_path: Path, heights: np.ndarray) -> Tile:
    tile = Tile(
        "t",
        (X0, Y0, X0 + SIZE, Y0 + SIZE),
        EPSG,
        tmp_path / "raw" / "sn",
        tmp_path / "data" / "site",
    )
    _dgm(tile, heights)
    return tile


def _glo30(tile: Tile, height_at) -> Path:
    """A cached GLO-30 window over the tile and 3 km around it, its heights
    `height_at(x, y)` in the tile's CRS."""
    w, s, e, n = glo30.lonlat_box(tile.bounds, EPSG, 3000.0)
    rx, ry = 1.5 / 3600, 1.0 / 3600
    cols, rows = int((e - w) / rx) + 1, int((n - s) / ry) + 1
    lon = w + (np.arange(cols) + 0.5) * rx
    lat = n - (np.arange(rows) + 0.5) * ry
    glon, glat = np.meshgrid(lon, lat)
    xs, ys = transform("EPSG:4326", f"EPSG:{EPSG}", glon.ravel(), glat.ravel())
    z = height_at(np.asarray(xs), np.asarray(ys)).reshape(rows, cols)
    path = glo30.site_path(tile.raw, tile.data.name)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=cols,
        height=rows,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(w, n, rx, ry),
        nodata=np.nan,
    ) as dst:
        dst.write(z.astype(np.float32), 1)
    return path


# --- beyond the site ----------------------------------------------------------


def test_without_the_far_terrain_the_edge_runs_on_level_not_at_its_mean(tmp_path):
    # a slope rising 0.5 m per metre eastward: 0 m at the west edge, 100 m east
    heights = np.tile(np.arange(SIZE, dtype=np.float32) * 0.5, (SIZE, 1))
    tile = _tile(tmp_path, heights)
    ground, surface, margin = fields(tile, 100, 60.0, Roofs(tile, tile.neighbours()))
    inner = ground[margin:-margin, margin:-margin]
    # west of the site the ground stays at its west edge's height, east at
    # its east edge's: one mean (50 m) stood a 50 m wall over the low side
    # (within the slope's one cell: the resampled edge cell)
    assert np.allclose(ground[margin:-margin, : margin - 1], inner[:, :1], atol=0.5)
    assert np.allclose(ground[margin:-margin, -margin + 1 :], inner[:, -1:], atol=0.5)
    west = horizon_tan(ground, surface, margin, 2.0, 270.0, 2.0, 60.0)
    assert west[:, 0].max() == 0.0


def test_extend_edges_keeps_what_is_measured():
    a = np.array([[np.nan, 1.0, 2.0], [np.nan, 3.0, np.nan]], np.float32)
    out = extend_edges(a)
    assert out[0, 1] == 1.0 and out[1, 1] == 3.0
    assert out[0, 0] == 1.0 and out[1, 0] == 3.0 and out[1, 2] in (2.0, 3.0)
    assert np.all(extend_edges(np.full((2, 2), np.nan)) == 0.0)


def test_the_far_terrain_stands_in_beyond_the_site_aligned_on_the_dgm(tmp_path):
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0, np.float32))
    # GLO-30 reads 3 m high on the open ground; a 60 m hill 150–400 m east
    _glo30(tile, lambda x, y: 103.0 + np.where((x > X0 + 350) & (x < X0 + 600), 60.0, 0.0))
    far = FarTerrain.of(tile)
    assert far is not None
    ground, surface, margin = fields(tile, 50, 400.0, Roofs(tile, tile.neighbours()), far=far)
    assert far.offset == pytest.approx(3.0, abs=0.05)
    res = SIZE / 50
    # the hill stands beyond the east edge, at its height over the DGM
    east = ground[margin + 25, margin + 50 + int(250 / res)]
    assert east == pytest.approx(160.0, abs=3.0)
    # the open land west is the DGM's level, not GLO-30's
    assert ground[margin + 25, 2] == pytest.approx(100.0, abs=0.1)
    tan = horizon_tan(ground, surface, margin, res, 90.0, res, 400.0)
    assert math.degrees(math.atan(tan[25, 49])) > 10


def test_no_cached_window_no_far_terrain(tmp_path):
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0, np.float32))
    assert FarTerrain.of(tile) is None
    path = glo30.site_path(tile.raw, "site")
    assert path == tmp_path / "raw" / "glo30" / "site.tif"


def test_the_ring_sees_the_hills_past_the_near_field():
    # observers on a 0 m plain (8 × 8 cells of 10 m), a 100 m ridge 2 km east
    obs = np.zeros((8, 8), np.float32)
    cells, res = 2, 10.0  # coarse cells of 20 m
    margin = 160  # coarse cells: 3.2 km
    terrain = np.zeros((4 + 2 * margin, 4 + 2 * margin), np.float32)
    terrain[:, margin + 2 + 100] = 100.0  # 2 km east of the tile's middle
    angles = ring_horizon(obs, terrain, margin, res, cells, near_m=1500.0, far_m=3000.0)
    east, west = 4, 12
    assert angles[east].max() == pytest.approx(math.degrees(math.atan(100 / 2000)), abs=0.1)
    assert angles[west].max() == 0.0
    # nearer than the ring's start: the near field's, not the ring's
    near = ring_horizon(obs, terrain, margin, res, cells, near_m=2500.0, far_m=3000.0)
    assert near[east].max() == 0.0


def test_the_legend_credits_glo30_and_carries_the_rim():
    plain = legend("Quelle: GeoSN, dl-de/by-2-0")
    assert "valley" not in plain and "terrainFarM" not in plain["bands"][0]
    assert plain["attribution"] == "Quelle: GeoSN, dl-de/by-2-0 (DGM1, LoD2)"
    rim = {"floorM": 90.0, "at": [0.0, 0.0], "rimM": [100.0] * 16}
    doc = legend("Quelle: GeoSN, dl-de/by-2-0", offset=2.2, rim=rim)
    assert doc["attribution"].startswith("Quelle: GeoSN, dl-de/by-2-0 (DGM1, LoD2); ")
    assert glo30.CREDIT in doc["attribution"]
    assert doc["bands"][0]["terrainFarM"] == 10_000.0
    assert doc["valley"]["rimM"] == [100.0] * 16 and doc["valley"]["floorM"] == 90.0
    assert "-2.20 m" in doc["beyond"]


# --- the valley's rim -----------------------------------------------------------


def test_the_rim_is_read_from_the_tile_s_low_ground(tmp_path):
    # the tile slopes 0.1 m per metre down to the south: its low ground is
    # its south edge
    heights = np.repeat((np.arange(SIZE, dtype=np.float32)[::-1] * 0.1)[:, None], SIZE, axis=1)
    tile = _tile(tmp_path, 100.0 + heights)
    floor = glo30.tile_floor(tile.dgm, tile.bounds)
    assert floor is not None
    fx, fy, fz = floor
    assert fy < Y0 + 60 and fz == pytest.approx(103.0, abs=3.0)
    # around it the land climbs 40 m per km northward and stays level south;
    # a 25 m mast-like spike east is no rim
    path = _glo30(
        tile,
        lambda x, y: (
            100.0
            + np.clip(y - fy, 0, None) * 0.04
            + np.where((abs(x - fx - 1500) < 20) & (abs(y - fy) < 20), 25.0, 0.0)
        ),
    )
    az = np.arange(16) * 22.5
    valley = glo30.rims(path, EPSG, floor, 0.0, az)
    assert valley is not None and len(valley["rimM"]) == 16
    assert valley["floorM"] == pytest.approx(fz, abs=0.1)
    north, east, south = valley["rimM"][0], valley["rimM"][4], valley["rimM"][8]
    assert north == pytest.approx(100 + 0.04 * 2900, abs=12)  # the window's reach
    assert south == pytest.approx(100.0, abs=2.0)
    # east: the sector's northern edge climbs a little, the spike adds nothing
    assert 100.0 < east < 100 + 0.04 * 5000 * math.sin(math.radians(11.25))
    assert glo30.rims(tmp_path / "none.tif", EPSG, floor, 0.0, az) is None
    assert glo30.tile_floor(tmp_path / "none.tif", tile.bounds) is None


def test_the_alignment_is_the_median_over_open_ground_both_cover():
    dgm = np.full((30, 30), 100.0)
    far = dgm + 2.0
    far[:10] += 25.0  # a town in the surface model
    open_ground = np.ones_like(dgm, bool)
    open_ground[:10] = False  # its roofs: not open
    assert glo30.align(far, dgm, open_ground) == pytest.approx(2.0)
    assert glo30.align(far[:5, :5], dgm[:5, :5], open_ground[:5, :5]) == 0.0


def test_a_cell_is_named_and_snapped_as_the_bucket_has_it():
    assert glo30.cell_url(51, 13).endswith(
        "Copernicus_DSM_COG_10_N51_00_E013_00_DEM/Copernicus_DSM_COG_10_N51_00_E013_00_DEM.tif"
    )
    assert "S01_00_W002_00" in glo30.cell_url(-1, -2)
    r = 1.0 / 3600
    w, s, e, n = glo30._snap((13.1, 51.1, 13.2, 51.2), (r, r))
    assert w <= 13.1 and e >= 13.2 and s <= 51.1 and n >= 51.2
    # the edges lie half a pixel off the whole degree
    assert (w / r - 0.5) == pytest.approx(round(w / r - 0.5), abs=1e-6)


def test_a_cached_window_that_covers_the_site_is_not_fetched_again(tmp_path, monkeypatch):
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0, np.float32))
    path = _glo30(tile, lambda x, y: np.full(np.shape(x), 100.0))

    def no_network(*_a, **_k):
        raise AssertionError("fetched again")

    monkeypatch.setattr(glo30, "_open_cell", no_network)
    monkeypatch.setattr(glo30, "REACH_M", 1000.0)
    monkeypatch.setattr(glo30, "PAD_M", 0.0)
    assert glo30.fetch(tile.raw, "site", [tile.bounds], EPSG) == path


# --- the crowns -----------------------------------------------------------------


def _points(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


def _pt(x, y, **props) -> dict:
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [x, y]},
    }


def test_a_tile_s_crowns_are_as_wide_as_the_viewer_draws_them(tmp_path):
    dlm = tmp_path / "dlm"
    _points(dlm / "canopy_t.geojson", [_pt(0, 0, h=10.0)])
    _points(dlm / "canopyx_t.geojson", [_pt(10, 0, h=20.0, r=1.0), _pt(20, 0, h=10.0, r=3.0)])
    _points(dlm / "trees_t.geojson", [_pt(30, 0, h=12.0, d=7.5)])
    rows = {
        "type": "Feature",
        "properties": {"kind": "treerow"},
        "geometry": {"type": "LineString", "coordinates": [[0, 50], [27, 50]]},
    }
    hedge = {**rows, "properties": {"kind": "hedge"}}
    _points(dlm / "vegrows_t.geojson", [rows, hedge])
    crowns = tile_crowns(tmp_path, "t")
    widths = {(round(c[0]), round(c[1])): c[3] for c in crowns}
    assert widths[(0, 0)] == pytest.approx(10 * CROWN_TO_HEIGHT)
    assert widths[(10, 0)] == pytest.approx(0.4 * 20)  # a narrow scan radius, clamped up
    assert widths[(20, 0)] == pytest.approx(6.0)
    assert widths[(30, 0)] == pytest.approx(7.5)
    # a row tree every 9 m, the hedge none
    assert sorted(round(c[0], 1) for c in crowns if c[1] == 50) == [4.5, 13.5, 22.5]


def test_a_crown_lets_half_the_sky_it_covers_through(tmp_path):
    res = 1.0
    ground = np.zeros((81, 81), np.float32)
    field = Field((0, 0, 81, 81), res)
    crowns = burn_crowns(field, np.array([[40.5, 40.5, 12.0, 10.0]]), ground)
    assert np.isfinite(crowns[40, 40]) and crowns[40, 40] == 12.0
    assert np.isnan(crowns[40, 50])  # 10 m off: past its 5 m radius
    margin = 30
    open_sky = sky_view(ground, ground, margin, res, reach_m=30)
    half = sky_view(ground, ground, margin, res, reach_m=30, crowns=crowns)
    solid = sky_view(ground, ground, margin, res, reach_m=30, crowns=crowns, transmission=0.0)
    c = 40 - margin
    assert open_sky[c, c] == pytest.approx(1.0)
    # under the crown the solid canopy hides nearly all; half of it lets half through
    assert solid[c, c] < 0.1
    assert half[c, c] == pytest.approx((1.0 + solid[c, c]) / 2, abs=1e-5)
    # far from it, the sky is whole either way
    assert half[0, 0] == pytest.approx(1.0, abs=0.02)


# --- the traffic's bridges --------------------------------------------------------


def _deck(axis, half_width=6.0) -> dict:
    line = shapely.LineString(axis)
    return {
        "type": "Feature",
        "properties": {"kind": "road", "axis": axis},
        "geometry": shapely.geometry.mapping(line.buffer(half_width, cap_style="flat")),
    }


def test_a_section_runs_on_a_bridge_where_it_runs_along_a_road_deck(tmp_path):
    path = tmp_path / "bridge_t.geojson"
    rail = {
        **_deck([[0, 200], [100, 200]]),
        "properties": {"kind": "rail", "axis": [[0, 200], [100, 200]]},
    }
    path.write_text(json.dumps({"features": [_deck([[20, 50], [80, 50]]), rail]}))
    decks = traffic.road_decks([path], (0, 0, 100, 300))
    assert len(decks) == 1  # the rail deck carries no traffic
    along = shapely.LineString([[0, 51], [100, 51]])
    under = shapely.LineString([[50, 0], [50, 100]])  # crosses the deck: 12 m, at 90°
    short = shapely.LineString([[0, 50], [28, 50]])  # 8 m on it
    oblique = shapely.LineString([[30, 45], [70, 55]])  # 14° off the axis
    assert traffic.on_deck(along, decks)
    assert not traffic.on_deck(under, decks)
    assert not traffic.on_deck(short, decks)
    assert traffic.on_deck(oblique, decks)
    # the name no longer decides where the decks are known…
    named = {"t": 10, "n": "Albertbrücke", "br": 1}
    assert "br" not in traffic.bridge_flag(named, under, decks)
    assert traffic.bridge_flag({"t": 10}, along, decks)["br"] == 1
    # …and still does where no bridge file is
    assert traffic.bridge_flag(named, under, None)["br"] == 1


def test_a_committed_file_is_re_flagged_without_the_counts_cache(tmp_path):
    tile = Tile(
        "t", (0.0, 0.0, 100.0, 100.0), EPSG, tmp_path / "raw", tmp_path / "data", traffic="dresden"
    )
    dlm = tile.data / "dlm"
    dlm.mkdir(parents=True)
    (dlm / "bridge_t.geojson").write_text(json.dumps({"features": [_deck([[20, 50], [80, 50]])]}))
    sections = [
        {
            "type": "Feature",
            "properties": {"t": 900, "f": 900, "n": "Brückenstraße"},
            "geometry": {"type": "LineString", "coordinates": [[0, 50], [100, 50]]},
        },
        {
            "type": "Feature",
            "properties": {"t": 500, "n": "Elbbrücke", "br": 1},
            "geometry": {"type": "LineString", "coordinates": [[50, 0], [50, 100]]},
        },
    ]
    doc = {"type": "FeatureCollection", "attribution": "x", "features": sections}
    (dlm / "traffic_t.geojson").write_text(json.dumps(doc))
    traffic.run(tile)
    out = json.loads((dlm / "traffic_t.geojson").read_text())
    assert out["attribution"] == "x"
    assert out["features"][0]["properties"] == {"t": 900, "f": 900, "n": "Brückenstraße", "br": 1}
    assert out["features"][1]["properties"] == {"t": 500, "n": "Elbbrücke"}
