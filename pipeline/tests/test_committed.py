"""The committed artifacts under data/dlm agree with the bakes that read
each other: a file baked before an input it depends on changed shows here
(the scan trees were once older than the OSM trees in the trees files, and
1 518 of them stood on a cadastre or OSM tree)."""

import json
from pathlib import Path

import numpy as np
import pytest

from bake.cultivated import unclaimed
from bake.lowveg import cadastre_filter
from bake.walls import on_written_lines

# Every site whose data is on disk (Dresden's is committed; another site's
# is there once it is fetched and baked).
DLMS = sorted(p for p in (Path(__file__).resolve().parents[2] / "data").glob("*/dlm"))


def _glob(pattern: str) -> list[Path]:
    return sorted(p for dlm in DLMS for p in dlm.glob(pattern))


def _tile(path: Path, kind: str) -> str:
    return path.name.removeprefix(f"{kind}_").removesuffix(".geojson")


def _id(path: Path, kind: str) -> str:
    return f"{path.parent.parent.name}/{_tile(path, kind)}"


def _features(path: Path) -> list[dict]:
    return json.loads(path.read_text())["features"] if path.exists() else []


@pytest.mark.parametrize("canopyx", _glob("canopyx_*.geojson"), ids=lambda p: _id(p, "canopyx"))
def test_no_committed_scan_tree_stands_on_a_cadastre_or_osm_tree(canopyx):
    extra = _features(canopyx)
    kept, dropped = cadastre_filter(
        extra, canopyx.parent / f"trees_{_tile(canopyx, 'canopyx')}.geojson"
    )
    assert dropped == 0, f"re-bake lowveg: {dropped} of {len(extra)} scan trees are claimed"


@pytest.mark.parametrize("walls", _glob("walls_*.geojson"), ids=lambda p: _id(p, "walls"))
def test_every_committed_gate_stands_on_a_line_of_its_kind(walls):
    features = _features(walls)
    kept = on_written_lines(features)
    lost = [f["geometry"]["coordinates"] for f in features if f not in kept]
    assert lost == []


def _measured(dlm: Path, tile: str) -> tuple[np.ndarray, np.ndarray]:
    xy, r = [], []
    for kind in ("canopy", "canopyx", "trees"):
        for f in _features(dlm / f"{kind}_{tile}.geojson"):
            if f.get("geometry"):
                xy.append(f["geometry"]["coordinates"][:2])
                p = f.get("properties") or {}
                r.append(float(p.get("r") or p.get("d", 0) / 2 or 0))
    return np.asarray(xy, np.float64).reshape(-1, 2), np.asarray(r)


@pytest.mark.parametrize(
    "cultivated",
    _glob("cultivated_*.geojson"),
    ids=lambda p: _id(p, "cultivated"),
)
def test_no_committed_orchard_tree_stands_by_a_measured_tree(cultivated):
    trees = [
        tuple(f["geometry"]["coordinates"])
        for f in _features(cultivated)
        if f["properties"].get("k") == "tree"
    ]
    if not trees:
        return
    # the tile's own measured trees (the bake reads the neighbours' too)
    assert unclaimed(trees, _measured(cultivated.parent, _tile(cultivated, "cultivated"))) == trees


DGMS = sorted(
    p
    for site in (Path(__file__).resolve().parents[2] / "data").glob("*/dgm")
    for p in site.glob("*/*.tif")
)
# A 2 km tile of any German city spans more than this (m): the lowest
# Hamburg tile, harbour to Binnenalster, 25 m.
MIN_DGM_RANGE_M = 2.0


@pytest.mark.parametrize("dgm", DGMS, ids=lambda p: p.stem)
def test_every_committed_dgm_holds_real_heights(dgm):
    """A DGM once committed as zeros everywhere (Hamburg's, a mosaic that
    kept the float-min NoData) put the ground at 0 m under houses standing
    on their true 5–10 m: every building floated. Each tile must vary."""
    import rasterio

    with rasterio.open(dgm) as ds:
        a = ds.read(1, masked=True, out_shape=(ds.height // 8, ds.width // 8))
    values = a.compressed()
    assert values.size > 0.9 * a.size, "mostly NoData"
    lo, hi = np.percentile(values, [1, 99])
    assert hi - lo >= MIN_DGM_RANGE_M, f"flat: {lo:.2f}..{hi:.2f} m"
