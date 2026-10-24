"""A deck's kind is the network that runs on it, not the one it crosses: a
bridge line's kind from the lines following its axis, a footprint's from the
lines leaving it at the deck's height, and never from a tram the Basis-DLM
files as a railway."""

from __future__ import annotations

import numpy as np
import rasterio

from bake.common import Tile
from bake.rail import Ground, dlm_networks
from tests.synthetic import SIZE, X0, Y0, shapefile, tile_line


def _tile(tmp_path, dgm: np.ndarray, dom: np.ndarray | None = None) -> Tile:
    """A 200 m tile with the given DGM (and DOM1), row 0 = north."""
    tile = Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")
    for path, arr in ((tile.dgm, dgm), (tile.raw_raster("dom1"), dom)):
        if arr is None:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=SIZE,
            height=SIZE,
            count=1,
            dtype="float32",
            crs="EPSG:25833",
            transform=tile.transform(SIZE),
        ) as dst:
            dst.write(arr.astype("float32"), 1)
    return tile


def test_tracks_under_a_footbridge_do_not_make_it_a_rail_deck(tmp_path):
    # a 40 m footbridge along y = 100 over five tracks across it; counted
    # point by point, every point of its axis lay within reach of a track
    tracks = [tile_line((x, 0), (x, 200)) for x in (85, 92, 100, 108, 115)]
    footway = tile_line((60, 100), (140, 100))
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0))
    ground = Ground(tile, {"rail": tracks, "road": [], "path": [footway]})
    assert ground.classify([(X0 + 80, Y0 + 100), (X0 + 120, Y0 + 100)]) == "path"
    # along the tracks, the same lines make a rail deck
    assert ground.classify([(X0 + 100, Y0 + 80), (X0 + 100, Y0 + 120)]) == "rail"


def test_a_footprint_carries_the_lines_that_leave_it_at_the_deck_height(tmp_path):
    # A railway bridge of five tracks over a road: 40 m across the tracks and
    # 20 m along them, so its long axis runs along the road beneath. The
    # tracks reach it on an embankment at the deck's 106 m; the road passes
    # under it at 100 m.
    dgm = np.full((SIZE, SIZE), 100.0)
    dgm[: SIZE - 110, 75:125] = 106.0  # the embankment, north of the bridge
    dgm[SIZE - 90 :, 75:125] = 106.0  # and south of it
    dom = dgm.copy()
    dom[SIZE - 110 : SIZE - 90, 80:120] = 106.0  # the deck
    tile = _tile(tmp_path, dgm, dom)
    tracks = [tile_line((x, 0), (x, 200)) for x in (84, 92, 100, 108, 116)]
    road = tile_line((0, 100), (200, 100))
    ground = Ground(tile, {"rail": tracks, "road": [road], "path": []})
    ring = [(X0 + x, Y0 + y) for x, y in ((80, 90), (120, 90), (120, 110), (80, 110), (80, 90))]
    kind, axis = ground.carried(ring)
    assert kind == "rail"
    assert abs(axis[0][0] - axis[-1][0]) < 1.0  # the deck runs along a track
    # the road alone, under it, is carried by nothing
    ground = Ground(tile, {"rail": [], "road": [road], "path": []})
    assert ground.carried(ring) is None


def test_a_line_the_dlm_files_as_a_tram_alone_is_no_railway(tmp_path):
    # Bavaria files its trams as standard-gauge railways (SPW 1000) of the
    # tram kind (BKT 1201): on Munich's Maximiliansbrücke they made a road
    # bridge a rail deck
    tile = _tile(tmp_path, np.full((SIZE, SIZE), 100.0))
    tram, railway = tile_line((0, 50), (200, 50)), tile_line((0, 150), (200, 150))
    shapefile(
        tile.dlm / "ver03_l.shp",
        [tram, railway, tile_line((0, 100), (200, 100))],
        {"SPW": ["1000", "1000", "3000"], "BKT": ["1201", "1100", "1201"]},
    )
    shapefile(tile.dlm / "ver01_l.shp", [tile_line((0, 10), (200, 10))], {"WDM": ["1303"]})
    shapefile(tile.dlm / "ver02_l.shp", [tile_line((0, 20), (200, 20))], {"ART": ["1103"]})
    networks = dlm_networks(tile, tile.bounds)
    assert [g.equals(railway) for g in networks["rail"]] == [True]
    assert len(networks["road"]) == 1
    assert len(networks["path"]) == 1
