"""The street-tree cadastre → one Point per tree the viewer draws at its
surveyed spot, height and crown (lib/city/tree-inventory.ts). Reads the
canonical raw layout a cadastre adapter writes (ingest_trees_<id>.py:
`<raw>/trees/<tile>.geojson`, properties {taxon, name, h, d}); a tile without
one is skipped and keeps its committed file.

Per tree, in the committed `trees_<tile>.geojson`:
  h  height (m)          d  crown diameter (m)
  a  archetype id (tree_archetypes.ARCHETYPES)
  l  leaf type ("e" evergreen, "d" deciduous)
  c  foliage colour (1 purple, 2 golden; absent = green)   g  1 = globe cultivar
  f  1 = stands in DLM forest/copse (class 2/3 of the class raster): the
     viewer does not let such a tree veto the canopy trees around it (a
     park's measured canopy is denser than the municipal register)
A missing height or crown diameter is imputed from this tile's own trees: the
genus median height, and the archetype's median crown-to-height ratio. Each
tree belongs to the one tile that owns its position (common.owns)."""

from __future__ import annotations

import json
import statistics

import numpy as np
from PIL import Image

from . import tree_archetypes as ta
from .common import Tile, crs_member, feature, owns

H_RANGE = (1.5, 40.0)
D_RANGE = (0.8, 30.0)
WOODLAND = (2, 3)  # forest, copse (landcover.CLASSES)
DEFAULT_RATIO = 0.55
DEFAULT_H = 8.0


def woodland_test(tile: Tile):
    """Whether a point stands in DLM forest/copse, on the committed class
    raster (row 0 = north)."""
    cls = np.asarray(Image.open(tile.out("dlm", f"landcover_{tile.id}.png")).convert("L"))
    rows, cols = cls.shape
    xmin, ymin, xmax, ymax = tile.bounds

    def test(x: float, y: float) -> bool:
        c = min(cols - 1, int((x - xmin) / (xmax - xmin) * cols))
        r = min(rows - 1, int((ymax - y) / (ymax - ymin) * rows))
        return int(cls[r, c]) in WOODLAND

    return test


def classified(tile: Tile, raw: dict) -> list[dict]:
    trees = []
    for f in raw.get("features", []):
        x, y = f["geometry"]["coordinates"][:2]
        if not owns(tile.bounds, x, y):
            continue
        p = f.get("properties") or {}
        c = ta.classify(p.get("taxon") or "", p.get("name") or "")
        trees.append({"x": x, "y": y, "h": p.get("h"), "d": p.get("d"), **c})
    return trees


def sized(trees: list[dict]) -> tuple[list[tuple[float, float]], int, int]:
    """(height, crown) per tree, imputed where unsurveyed, and the counts."""
    by_genus: dict[str, list[float]] = {}
    ratio: dict[int, list[float]] = {}
    for t in trees:
        if t["h"]:
            by_genus.setdefault(t["genus"], []).append(t["h"])
        if t["h"] and t["d"]:
            ratio.setdefault(t["archetype"], []).append(t["d"] / t["h"])
    genus_h = {g: statistics.median(v) for g, v in by_genus.items() if len(v) >= 3}
    all_h = statistics.median([t["h"] for t in trees if t["h"]] or [DEFAULT_H])
    arch_r = {a: statistics.median(v) for a, v in ratio.items() if v}
    out, imputed_h, imputed_d = [], 0, 0
    for t in trees:
        r = arch_r.get(t["archetype"], DEFAULT_RATIO)
        h, d = t["h"], t["d"]
        if h is None:
            h = d / r if d else genus_h.get(t["genus"], all_h)
            imputed_h += 1
        if d is None:
            d = h * r
            imputed_d += 1
        h = min(max(h, H_RANGE[0]), H_RANGE[1])
        d = min(max(d, D_RANGE[0]), D_RANGE[1], max(1.6 * h, 3.0))
        out.append((h, d))
    return out, imputed_h, imputed_d


def properties(t: dict, h: float, d: float, in_woodland: bool) -> dict:
    props = {"h": round(h, 1), "d": round(d, 1), "a": t["archetype"], "l": t["leaf"]}
    if t["foliage"]:
        props["c"] = t["foliage"]
    if t["globe"]:
        props["g"] = 1
    if in_woodland:
        props["f"] = 1
    return props


def run(tile: Tile) -> None:
    source = tile.raw / "trees" / f"{tile.id}.geojson"
    if not source.exists():
        print(f"{tile.id}: no cadastre under {source.parent} — skipping the trees")
        return
    raw = json.loads(source.read_text())
    trees = classified(tile, raw)
    sizes, imputed_h, imputed_d = sized(trees)
    woodland = woodland_test(tile)
    features = [
        feature(
            {"type": "Point", "coordinates": [round(t["x"], 1), round(t["y"], 1)]},
            properties(t, h, d, woodland(t["x"], t["y"])),
        )
        for t, (h, d) in zip(trees, sizes, strict=True)
    ]
    # The archetype names ride along for readers of the file (the viewer
    # keys them by id, lib/city/tree-inventory.ts).
    doc = {
        "type": "FeatureCollection",
        "attribution": raw.get("attribution"),
        "archetypes": ta.ARCHETYPES,
        "crs": crs_member(tile.epsg),
        "features": features,
    }
    tile.out("dlm", f"trees_{tile.id}.geojson").write_text(json.dumps(doc))
    print(
        f"{tile.id}: {len(features)} cadastre trees "
        f"({imputed_h} heights, {imputed_d} crown diameters imputed)"
    )
