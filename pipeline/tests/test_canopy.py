"""The canopy bake (pipeline/bake/canopy.py): the trees DOM1 shows, the tree
rows' trees at its crown peaks, and the planes that are no crown."""

import json

import numpy as np
import pytest
import rasterio
import shapely
from PIL import Image

from bake import canopy
from bake.common import Tile
from tests.synthetic import SIZE, X0, Y0, crowns, osm_tile, read, write_raster


def _tile(tmp_path, slope_north: float = 0.0) -> Tile:
    """A flat (or north-rising) 200 m tile with its DGM at 100 m."""
    tile = Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")
    rows = np.arange(SIZE)[:, None] + 0.5
    z = 100 + slope_north * (SIZE - rows) + np.zeros((1, SIZE))
    write_raster(tile.dgm, z.astype("float32"))
    return tile


# ---- P7: the tree rows' trees -------------------------------------------


def test_thinning_keeps_the_tallest_and_drops_its_neighbours():
    xy = np.array([[0.0, 0.0], [2.0, 0.0], [5.0, 0.0], [6.5, 0.0]])
    tops = np.array([8.0, 12.0, 9.0, 10.0])
    # 12 m at 2 drops 0 (2 m off); 10 m at 6.5 drops 5 (1.5 m off)
    assert canopy.thinned(xy, tops, 3.0).tolist() == [1, 3]


def _rows(tile: Tile, line: list[tuple[float, float]]) -> None:
    path = tile.out("dlm", f"vegrows_{tile.id}.geojson")
    feats = [
        {"type": "Feature", "properties": {"kind": kind}, "geometry": geom}
        for kind, geom in (
            ("treerow", {"type": "LineString", "coordinates": line}),
            # a hedge is no tree row
            (
                "hedge",
                {"type": "LineString", "coordinates": [[X0 + 10, Y0 + 40], [X0 + 190, Y0 + 40]]},
            ),
        )
    ]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))


def test_a_rows_trees_stand_at_its_crown_peaks_as_tall_as_measured(tmp_path):
    tile = _tile(tmp_path)
    y = Y0 + 100
    _rows(tile, [(X0 + 20, y), (X0 + 180, y)])
    # crowns every 10 m, 1 m off the line, 8–16 m tall; one 9 m off it
    # (another row's), one beside the canopy's crown, one on the hedge
    spots = [(X0 + 30.5 + 10 * i, y + 1.5, 8.0 + i) for i in range(9)]
    ndom = crowns([*spots, (X0 + 60.5, y + 9.5, 14.0), (X0 + 100.5, Y0 + 40.5, 10.0)])
    taken = np.array([[X0 + 72.0, y + 2.0]])  # 2–3 m from the crown at x = 70
    xy, tops, n = canopy.row_trees(tile, ndom, ndom > 0, taken)
    assert n == 1
    xs = sorted(float(x) for x in xy[:, 0])
    assert xs == pytest.approx([X0 + 30.5 + 10 * i for i in range(9) if i != 4], abs=0.01)
    assert np.allclose(xy[:, 1], y)  # on the line
    assert sorted(tops.tolist()) == pytest.approx([8.0 + i for i in range(9) if i != 4], abs=0.6)


def test_without_tree_rows_there_are_no_row_trees(tmp_path):
    tile = _tile(tmp_path)
    xy, tops, n = canopy.row_trees(tile, np.zeros((SIZE, SIZE)), np.ones((SIZE, SIZE), bool), [])
    assert (len(xy), len(tops), n) == (0, 0, 0)


def test_a_tree_by_a_carriageway_reaches_over_it(tmp_path, monkeypatch):
    tile = _tile(tmp_path)
    lane = shapely.box(X0 + 100, Y0, X0 + 106, Y0 + SIZE)
    monkeypatch.setattr(canopy.ways, "carriageways", lambda _tile: [lane])
    rows = np.array([100, 100, 100])
    # 2.5 m, 6.5 m and 20 m from the lane's west edge (x = 100)
    cols = np.array([97, 93, 80])
    tops = np.array([10.0, 10.0, 30.0])
    # reach: 0.29 · h + 0.5 → 3.4 m, 3.4 m, 9.2 m
    assert canopy.over_carriageway(tile, rows, cols, tops, SIZE).tolist() == [True, False, False]


RAILWAY, MEADOW = 5, 1


def _heap(dom: np.ndarray, x: int, y: int, h: float = 8.0, grade: float = 0.7) -> None:
    """A smooth gravel cone `h` m tall at (x, y) m from the tile's
    south-west corner (row 0 = north), its flanks `grade` m per m."""
    rr, cc = np.mgrid[0:SIZE, 0:SIZE]
    d = np.hypot(cc + 0.5 - x, SIZE - rr - 0.5 - y)
    dom[:] = np.maximum(dom, 100.0 + h - grade * d)


def _crown(dom: np.ndarray, rng, x: int, y: int, size: int = 8) -> None:
    """A rough 12 m crown, `size` m across, centred at (x, y)."""
    r, c = SIZE - y - size // 2, x - size // 2
    dom[r : r + size, c : c + size] = 112.0 + rng.normal(0.0, 1.5, (size, size))


def test_a_tilted_plane_has_no_residual_and_a_crown_has():
    rr, cc = np.mgrid[0:40, 0:40].astype(float)
    slope = 100.0 + 0.9 * cc - 0.4 * rr
    assert canopy.plane_residual(slope)[1:-1, 1:-1].max() < 1e-3  # float round-off
    # (the roughness gate reads such a tilt as spread: a flank passes it)
    crown = 112.0 + np.random.default_rng(0).normal(0.0, 1.5, (40, 40))
    assert np.median(canopy.plane_residual(crown)) > 1.0


def test_only_a_plane_that_is_bare_is_vetoed():
    rr, cc = np.mgrid[0:40, 0:40].astype(float)
    flank = 100.0 + 0.7 * cc
    bare = np.zeros((20, 20))
    lawn = np.full((20, 20), 0.33)
    assert canopy.bare_planes(flank, bare)[5:-5, 5:-5].all()
    assert not canopy.bare_planes(flank, lawn).any()  # green: a hedge's top, a lawn
    assert not canopy.bare_planes(flank, None).any()  # no index: no veto
    crown = 112.0 + np.random.default_rng(1).normal(0.0, 1.5, (40, 40))
    assert not canopy.bare_planes(crown, bare)[5:-5, 5:-5].any()  # a leaf-off crown


def _yard(tmp_path, monkeypatch, with_index: bool = True, park: bool = False):
    """A railway parcel (no traffic on it) holding a gravel heap at (60, 100)
    and a leaf-off crown at (140, 100); the orthophoto bare all over."""
    tile = osm_tile(tmp_path, monkeypatch, {}, classes=np.full((SIZE, SIZE), RAILWAY, np.uint8))
    dom = np.full((SIZE, SIZE), 100.0)
    _heap(dom, 60, 100)
    _crown(dom, np.random.default_rng(0), 140, 100)
    path = tile.raw_raster("dom1")
    path.parent.mkdir(parents=True, exist_ok=True)
    profile = {"driver": "GTiff", "width": SIZE, "height": SIZE, "count": 1}
    with rasterio.open(
        path, "w", **profile, dtype="float32", crs="EPSG:25833", transform=tile.transform(SIZE)
    ) as dst:
        dst.write(dom.astype("float32"), 1)
    if with_index:
        png = tile.out("dlm", f"ndvi_{tile.id}.png")
        png.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.full((SIZE, SIZE), 5, np.uint8)).save(png)
    mask = np.ones if park else np.zeros
    monkeypatch.setattr(canopy, "vegetation_mask", lambda t, px: mask((px, px), np.uint8))
    return tile


def _near(tile, x: float, y: float, reach: float = 9.0) -> list:
    trees = [f["geometry"]["coordinates"] for f in read(tile, "canopy")["features"]]
    return [t for t in trees if abs(t[0] - X0 - x) < reach and abs(t[1] - Y0 - y) < reach]


def test_a_heap_on_transport_land_grows_no_wood(tmp_path, monkeypatch):
    tile = _yard(tmp_path, monkeypatch)
    canopy.run(tile, cell=7)
    assert not _near(tile, 60, 100)  # the heap: a plane, bare
    assert _near(tile, 140, 100)  # the crown: bare too, but no plane


def test_without_an_index_the_heap_stays(tmp_path, monkeypatch):
    """No orthophoto index: nothing tells the heap's gravel from a crown's
    leaves, and the canopy keeps what the masks admit."""
    tile = _yard(tmp_path, monkeypatch, with_index=False)
    canopy.run(tile, cell=7)
    assert _near(tile, 60, 100)


def test_in_a_park_a_smooth_bare_crown_stays_a_tree(tmp_path, monkeypatch):
    """A leaf-off crown can read as smooth and bare (a bare lime under
    Dresden's DOM1, a green one under München's visible-band index): where
    the DLM says forest or park, the veto does not reach."""
    tile = _yard(tmp_path, monkeypatch, park=True)
    canopy.run(tile, cell=7)
    assert _near(tile, 60, 100)
    assert _near(tile, 140, 100)
