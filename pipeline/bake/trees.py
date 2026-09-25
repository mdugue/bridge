"""The Dresden street-tree cadastre (Stadtbaumkataster, WFS `cls:L1261`) →
one point per tree with its height, crown and silhouette archetype.

Street trees, parks, schools and other municipal land (not the Großer
Garten, not private courtyards); licence dl-de/by-2-0, credit
"Landeshauptstadt Dresden" — the output carries an `attribution` member.
The ingest adapter caches the WFS response as `<raw>/trees/<tile>.geojson`
(ingest_sn.py `ingest_trees`); this step:

  1. keeps the trees whose `gis_x_utm`/`gis_y_utm` (= the geometry, verified
     to µm) the tile owns — west/south edges in, so each tree lands in
     exactly one tile;
  2. maps the taxon to archetype / leaf type / foliage colour
     (tree_archetypes.py);
  3. imputes a missing height or crown diameter from this tile's own trees:
     the genus median height and the archetype's median crown-to-height
     ratio;
  4. flags (`f`) a tree standing in DLM forest or copse (class 2/3 of the
     committed class raster): the viewer does not let such a tree veto the
     canopy trees around it — a park's measured canopy is denser than the
     municipal register (docs/transformations.md).

Output `data/dlm/trees_<tile>.geojson`, points with
  h tree height (m), d crown diameter (m), a archetype id (0 round, 1 oval,
  2 columnar, 3 conifer, 4 weeping, 5 small), l leaf type ("e"/"d"),
  c foliage colour (1 purple, 2 golden; absent = green), g 1 = globe
  cultivar, f 1 = in forest/copse (lib/city/features.ts `TreeFeature`).
"""

from __future__ import annotations

import json
import statistics

import numpy as np
from PIL import Image

from . import tree_archetypes as ta
from .common import Tile, crs_member, feature, owns

ATTRIBUTION = "Stadtbaumkataster © Landeshauptstadt Dresden (dl-de/by-2-0)"
H_MIN, H_MAX, D_MIN, D_MAX = 1.5, 40.0, 0.8, 30.0
WOODLAND = (2, 3)  # the class raster's forest and copse (landcover.py)
DEFAULT_RATIO = 0.55  # crown / height where an archetype has no sample
DEFAULT_H = 8.0  # the height of a tile whose trees carry none at all


def _num(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def parse_trees(raw: dict, bounds: tuple[float, float, float, float]) -> list[dict]:
    """The WFS features the tile owns, classified; heights may be None."""
    trees = []
    for f in raw.get("features", []):
        p = f.get("properties") or {}
        x, y = p.get("gis_x_utm"), p.get("gis_y_utm")
        if x is None or y is None or not owns(bounds, x, y):
            continue
        if (p.get("art_botanisch") or "").strip() == "Stammstück":
            continue  # a trunk stump, not a tree
        c = ta.classify(p.get("art_botanisch") or "", p.get("art_deutsch") or "")
        trees.append(
            {
                "x": x,
                "y": y,
                "h": _num(p.get("baumhoehe_akt")),
                "d": _num(p.get("kronendurchmesser_akt")),
                **c,
            }
        )
    return trees


def impute(trees: list[dict]) -> tuple[list[tuple[float, float]], int, int]:
    """(height, crown diameter) per tree, the gaps filled from this tile's own
    measured trees and clamped; plus how many of each were imputed."""
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
        h = min(max(h, H_MIN), H_MAX)
        d = min(max(d, D_MIN), D_MAX, max(1.6 * h, 3.0))
        out.append((h, d))
    return out, imputed_h, imputed_d


def woodland_at(cls: np.ndarray, bounds, x: float, y: float) -> bool:
    """Whether the class raster (row 0 = north) says forest or copse there."""
    xmin, ymin, xmax, ymax = bounds
    h, w = cls.shape
    c = min(w - 1, int((x - xmin) / (xmax - xmin) * w))
    r = min(h - 1, int((ymax - y) / (ymax - ymin) * h))
    return int(cls[r, c]) in WOODLAND


def tree_features(trees: list[dict], sizes, cls: np.ndarray | None, bounds) -> list[dict]:
    features = []
    for t, (h, d) in zip(trees, sizes, strict=True):
        props: dict = {"h": round(h, 1), "d": round(d, 1), "a": t["archetype"], "l": t["leaf"]}
        if t["foliage"]:
            props["c"] = t["foliage"]
        if t["globe"]:
            props["g"] = 1
        if cls is not None and woodland_at(cls, bounds, t["x"], t["y"]):
            props["f"] = 1
        features.append(
            feature({"type": "Point", "coordinates": [round(t["x"], 1), round(t["y"], 1)]}, props)
        )
    return features


def run(tile: Tile) -> None:
    raw_path = tile.raw / "trees" / f"{tile.id}.geojson"
    if not raw_path.exists():
        print(f"{tile.id}: no tree cadastre at {raw_path} — skipping the inventory trees")
        return
    trees = parse_trees(json.loads(raw_path.read_text()), tile.bounds)
    # A tile the cadastre has no tree on (all forest) still gets its file,
    # empty: "baked, nothing here" is not "never baked" (lib/city/tile-data.test.ts
    # holds every tile to the same set of files).
    features = []
    imputed_h = imputed_d = 0
    if trees:
        sizes, imputed_h, imputed_d = impute(trees)
        landcover = tile.out("dlm", f"landcover_{tile.id}.png")
        cls = np.asarray(Image.open(landcover).convert("L")) if landcover.exists() else None
        features = tree_features(trees, sizes, cls, tile.bounds)
    doc = {
        "type": "FeatureCollection",
        "attribution": ATTRIBUTION,
        "archetypes": ta.ARCHETYPES,
        "crs": crs_member(tile.epsg),
        "features": features,
    }
    tile.out("dlm", f"trees_{tile.id}.geojson").write_text(json.dumps(doc, separators=(",", ":")))
    print(
        f"{tile.id}: {len(features)} cadastre trees "
        f"({imputed_h} heights, {imputed_d} crown diameters imputed)"
    )
