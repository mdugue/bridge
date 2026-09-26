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

DLM = Path(__file__).resolve().parents[2] / "data" / "dlm"


def _tile(path: Path, kind: str) -> str:
    return path.name.removeprefix(f"{kind}_").removesuffix(".geojson")


def _features(path: Path) -> list[dict]:
    return json.loads(path.read_text())["features"] if path.exists() else []


@pytest.mark.parametrize(
    "canopyx", sorted(DLM.glob("canopyx_*.geojson")), ids=lambda p: _tile(p, "canopyx")
)
def test_no_committed_scan_tree_stands_on_a_cadastre_or_osm_tree(canopyx):
    extra = _features(canopyx)
    kept, dropped = cadastre_filter(extra, DLM / f"trees_{_tile(canopyx, 'canopyx')}.geojson")
    assert dropped == 0, f"re-bake lowveg: {dropped} of {len(extra)} scan trees are claimed"


@pytest.mark.parametrize(
    "walls", sorted(DLM.glob("walls_*.geojson")), ids=lambda p: _tile(p, "walls")
)
def test_every_committed_gate_stands_on_a_line_of_its_kind(walls):
    features = _features(walls)
    kept = on_written_lines(features)
    lost = [f["geometry"]["coordinates"] for f in features if f not in kept]
    assert lost == []


def _measured(tile: str) -> tuple[np.ndarray, np.ndarray]:
    xy, r = [], []
    for kind in ("canopy", "canopyx", "trees"):
        for f in _features(DLM / f"{kind}_{tile}.geojson"):
            if f.get("geometry"):
                xy.append(f["geometry"]["coordinates"][:2])
                p = f.get("properties") or {}
                r.append(float(p.get("r") or p.get("d", 0) / 2 or 0))
    return np.asarray(xy, np.float64).reshape(-1, 2), np.asarray(r)


@pytest.mark.parametrize(
    "cultivated",
    sorted(DLM.glob("cultivated_*.geojson")),
    ids=lambda p: _tile(p, "cultivated"),
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
    assert unclaimed(trees, _measured(_tile(cultivated, "cultivated"))) == trees
