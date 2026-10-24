"""The vegetation's photo-QA rules (PR #173): on transport land a heap's
smooth flank or a bare roof is no crown, however steep or high
(`canopy.bare_planes`); in a forest or park the DLM's say-so stands."""

from __future__ import annotations

import numpy as np
import rasterio
from PIL import Image

from bake import canopy
from tests.synthetic import SIZE, X0, Y0, osm_tile, read

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
