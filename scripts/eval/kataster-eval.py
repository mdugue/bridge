#!/usr/bin/env python3
"""Evaluate the Dresden street-tree cadastre against today's tree inputs.

Reproducible analysis behind the 🧪 "tree inventory" entry in
docs/transformations.md. Reads only committed artifacts plus the raw cadastre
cache that `bun run fetch` writes (pipeline/bake/cadastre.py):

  data/_raw/sn/trees/<tile>.geojson            (raw WFS, all attributes)
  data/dresden/dlm/canopy_<tile>.geojson                    (DOM1 canopy points, `h`)
  data/dresden/dlm/vegrows_<tile>.geojson                   (DLM tree rows)
  data/dresden/dlm/landcover_<tile>.png  (+ .json legend)   (DLM class ids, 4096²)
  data/dresden/dlm/ndvi_<tile>.png                          (leaf-off DOP NDVI, 1024²)

Answers:
  a. overlap — cadastre trees that already have a canopy point within
     max(crown radius, 3.5 m); canopy points explained by a cadastre tree;
     the missing trees by land-cover class; DLM row samples that duplicate a
     cadastre tree
  b. height — cadastre height vs the nearest matched canopy point's `h`
  c. leaf-off NDVI as an evergreen/leaf-off classifier, sampled exactly like
     vegetation-layer.ts (5×5 footprint max, byte/255)
  d. archetype coverage (pipeline/bake/tree_archetypes.py)

Run (the system numpy is broken; uv supplies a clean one):
  uv run --with numpy --with scipy --with pillow \
    python scripts/eval/kataster-eval.py [--raw DIR] [--json OUT]
"""

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from bake import tree_archetypes as ta  # noqa: E402

TILES = ["33412_5656_2_sn", "33410_5656_2_sn", "33410_5658_2_sn", "33412_5658_2_sn"]
PRIMARY = TILES[0]
DLM = ROOT / "data" / "dresden" / "dlm"
MIN_MATCH_R = 3.5  # m: the canopy grid is 7 m, so half a cell is the floor
TREE_SPACING = 9.0  # vegetation-layer.ts TREE_SPACING (rows)
CANOPY_MINH = 3.0  # pipeline/bake/canopy.py MIN_H


def tile_bounds(tile):
    e, n = int(tile[2:5]), int(tile[6:10])
    return e * 1000, n * 1000, e * 1000 + 2000, n * 1000 + 2000


def num(v):
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def load_cadastre(raw_dir, tile):
    x0, y0, x1, y1 = tile_bounds(tile)
    doc = json.load(open(raw_dir / f"{tile}.geojson"))
    rows = []
    for f in doc["features"]:
        p = f["properties"]
        x, y = p["gis_x_utm"], p["gis_y_utm"]
        if not (x0 <= x < x1 and y0 <= y < y1):
            continue
        if (p.get("art_botanisch") or "").strip() == "Stammstück":
            continue
        c = ta.classify(p.get("art_botanisch") or "", p.get("art_deutsch") or "")
        rows.append({
            "tile": tile, "x": x, "y": y,
            "h": num(p.get("baumhoehe_akt")), "d": num(p.get("kronendurchmesser_akt")),
            "taxon": " ".join((p.get("art_botanisch") or "").split()),
            **c,
        })
    return rows


def load_points(path):
    doc = json.load(open(path))
    pts, hs = [], []
    for f in doc["features"]:
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        pts.append(g["coordinates"][:2])
        hs.append((f.get("properties") or {}).get("h", math.nan))
    return np.array(pts, dtype=float).reshape(-1, 2), np.array(hs, dtype=float)


def sample_polyline(coords, spacing):
    """lib/city/polyline.ts samplePolyline: a point every `spacing` m, carried
    across vertices, end vertex excluded."""
    out, dist = [], 0.0
    for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg == 0:
            continue
        while dist < seg:
            t = dist / seg
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
            dist += spacing
        dist -= seg
    return out


def row_samples(tile):
    doc = json.load(open(DLM / f"vegrows_{tile}.geojson"))
    pts = []
    for f in doc["features"]:
        if (f.get("properties") or {}).get("kind") != "treerow":
            continue
        pts += sample_polyline(f["geometry"]["coordinates"], TREE_SPACING)
    return pts


class Raster:
    """A tile-covering single-band PNG, row 0 = north (the bakes' layout)."""

    def __init__(self, path, tile):
        self.a = np.asarray(Image.open(path).convert("L"))
        self.h, self.w = self.a.shape
        self.b = tile_bounds(tile)

    def pixel(self, x, y):
        minx, miny, maxx, maxy = self.b
        u = (x - minx) / (maxx - minx)
        v = (maxy - y) / (maxy - miny)
        cx = min(self.w - 1, int(math.floor(u * self.w)))
        cy = min(self.h - 1, int(math.floor(v * self.h)))
        return cx, cy

    def at(self, x, y):
        cx, cy = self.pixel(x, y)
        return int(self.a[cy, cx])

    def max5(self, x, y):
        """vegetation-layer.ts sampleMaxWindow: max over a clamped 5×5 window."""
        cx, cy = self.pixel(x, y)
        ys = np.clip(np.arange(cy - 2, cy + 3), 0, self.h - 1)
        xs = np.clip(np.arange(cx - 2, cx + 3), 0, self.w - 1)
        return int(self.a[np.ix_(ys, xs)].max())


def radius(t, fallback_ratio):
    d = t["d"] if t["d"] else (t["h"] or 8.0) * fallback_ratio
    return max(d / 2.0, MIN_MATCH_R)


def pct(a, b):
    return 100.0 * a / b if b else 0.0


def overlap(trees, canopy_xy, canopy_h, legend):
    """(a) + (b): per-tree match against the block's canopy points."""
    ctree = cKDTree(canopy_xy)
    radii = np.array([radius(t, 0.55) for t in trees])
    txy = np.array([[t["x"], t["y"]] for t in trees])
    dist, idx = ctree.query(txy, k=1)
    covered = dist <= radii
    for t, c, i in zip(trees, covered, idx):
        t["covered"] = bool(c)
        t["canopy_h"] = float(canopy_h[i]) if c else math.nan
    # Canopy points explained by any cadastre tree (per-tree radius).
    ttree = cKDTree(txy)
    explained = np.zeros(len(canopy_xy), dtype=bool)
    near = ttree.query_ball_point(canopy_xy, r=float(radii.max()))
    for ci, cand in enumerate(near):
        if cand:
            dd = np.hypot(txy[cand, 0] - canopy_xy[ci, 0], txy[cand, 1] - canopy_xy[ci, 1])
            explained[ci] = bool((dd <= radii[cand]).any())
    by_class = Counter()
    miss_class = Counter()
    for t in trees:
        k = legend.get(str(t["cls"]), str(t["cls"]))
        by_class[k] += 1
        if not t["covered"]:
            miss_class[k] += 1
    return covered, explained, by_class, miss_class, radii


def height_stats(trees):
    pairs = [(t["h"], t["canopy_h"]) for t in trees
             if t["covered"] and t["h"] and not math.isnan(t["canopy_h"])]
    cad = np.array([p[0] for p in pairs])
    can = np.array([p[1] for p in pairs])
    diff = can - cad
    return {
        "n": len(pairs),
        "median_abs_diff_m": round(float(np.median(np.abs(diff))), 2),
        "median_bias_m": round(float(np.median(diff)), 2),
        "mean_bias_m": round(float(np.mean(diff)), 2),
        "within_3m_pct": round(pct(int((np.abs(diff) <= 3).sum()), len(diff)), 1),
        "pearson_r": round(float(np.corrcoef(cad, can)[0, 1]), 3),
    }


def auc(pos, neg):
    """Mann-Whitney AUC, ties counted half."""
    allv = np.concatenate([pos, neg])
    order = allv.argsort(kind="mergesort")
    ranks = np.empty(len(allv))
    sv = allv[order]
    i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2.0 + 1
        i = j + 1
    rp = ranks[: len(pos)].sum()
    return (rp - len(pos) * (len(pos) + 1) / 2.0) / (len(pos) * len(neg))


def classifier(values, truth):
    """Threshold sweep for `value >= thr => evergreen`."""
    values = np.asarray(values, dtype=float)
    truth = np.asarray(truth, dtype=bool)
    best_bal = best_acc = None
    for thr in np.unique(np.concatenate([values, [256.0]])):
        pred = values >= thr
        tp = int((pred & truth).sum())
        fp = int((pred & ~truth).sum())
        fn = int((~pred & truth).sum())
        tn = int((~pred & ~truth).sum())
        tpr = tp / max(tp + fn, 1)
        tnr = tn / max(tn + fp, 1)
        bal = (tpr + tnr) / 2
        acc = (tp + tn) / len(truth)
        row = {"threshold": float(thr) / 255.0, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
               "balanced_acc": round(bal, 3), "accuracy": round(acc, 3),
               "precision": round(tp / max(tp + fp, 1), 3), "recall": round(tpr, 3)}
        if best_bal is None or bal > best_bal["balanced_acc"]:
            best_bal = row
        if best_acc is None or acc > best_acc["accuracy"]:
            best_acc = row
    return {
        "n": len(truth), "evergreen": int(truth.sum()),
        "auc": round(auc(values[truth], values[~truth]), 3),
        "median_evergreen": round(float(np.median(values[truth])) / 255, 3),
        "median_leafoff": round(float(np.median(values[~truth])) / 255, 3),
        "best_balanced": best_bal, "best_accuracy": best_acc,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(ROOT / "data" / "_raw" / "sn" / "trees"))
    ap.add_argument("--json", default=None)
    args = ap.parse_args()
    raw = Path(args.raw)

    trees, canopy_xy, canopy_h, rows = [], [], [], []
    canopy_tile = []
    ndvi_canopy = []
    legend = json.load(open(DLM / f"landcover_{PRIMARY}.json"))["classes"]
    for tile in TILES:
        cls = Raster(DLM / f"landcover_{tile}.png", tile)
        ndvi = Raster(DLM / f"ndvi_{tile}.png", tile)
        tt = load_cadastre(raw, tile)
        for t in tt:
            t["cls"] = cls.at(t["x"], t["y"])
            t["ndvi5"] = ndvi.max5(t["x"], t["y"])
            t["ndvi1"] = ndvi.at(t["x"], t["y"])
        trees += tt
        xy, h = load_points(DLM / f"canopy_{tile}.geojson")
        canopy_xy.append(xy)
        canopy_h.append(h)
        canopy_tile += [tile] * len(xy)
        ndvi_canopy += [ndvi.max5(x, y) for x, y in xy]
        rows += [(tile, x, y) for x, y in row_samples(tile)]
    canopy_xy = np.concatenate(canopy_xy)
    canopy_h = np.concatenate(canopy_h)
    canopy_tile = np.array(canopy_tile)

    covered, explained, by_class, miss_class, radii = overlap(trees, canopy_xy, canopy_h, legend)
    prim = np.array([t["tile"] == PRIMARY for t in trees])
    prim_c = canopy_tile == PRIMARY
    low = [t for t in trees if not t["covered"] and t["h"] and t["h"] <= CANOPY_MINH]

    # DLM tree-row samples that sit on a cadastre tree (would double it).
    txy = np.array([[t["x"], t["y"]] for t in trees])
    rxy = np.array([[r[1], r[2]] for r in rows]).reshape(-1, 2)
    rdup = 0
    if len(rxy):
        d, i = cKDTree(txy).query(rxy, k=1)
        rdup = int((d <= radii[i]).sum())

    out = {
        "trees": {"block": len(trees), "primary": int(prim.sum())},
        "a_overlap": {
            "trees_with_canopy_point_pct": {
                "block": round(pct(int(covered.sum()), len(trees)), 1),
                "primary": round(pct(int(covered[prim].sum()), int(prim.sum())), 1),
            },
            "canopy_points": {"block": int(len(canopy_xy)), "primary": int(prim_c.sum())},
            "canopy_points_explained_pct": {
                "block": round(pct(int(explained.sum()), len(explained)), 1),
                "primary": round(pct(int(explained[prim_c].sum()), int(prim_c.sum())), 1),
            },
            "missing_by_landcover": {
                k: {"trees": by_class[k], "missing": miss_class[k],
                    "missing_pct": round(pct(miss_class[k], by_class[k]), 1)}
                for k, _ in by_class.most_common()
            },
            "missing_total": int((~covered).sum()),
            "missing_below_canopy_minh": len(low),
            "median_height_m": {
                "covered": float(np.median([t["h"] for t in trees if t["covered"] and t["h"]])),
                "missing": float(np.median([t["h"] for t in trees if not t["covered"] and t["h"]])),
            },
            "missing_at_least_8m": sum(1 for t in trees if not t["covered"] and (t["h"] or 0) >= 8),
            "row_samples": {"total": int(len(rxy)), "on_a_cadastre_tree": rdup},
        },
        "b_height": height_stats(trees),
    }

    # (c) leaf-off NDVI -> evergreen?
    known = [t for t in trees if t["known"]]
    truth = [t["leaf"] == "e" for t in known]
    out["c_ndvi"] = {
        "max5": classifier([t["ndvi5"] for t in known], truth),
        "single_pixel": classifier([t["ndvi1"] for t in known], truth),
    }
    # Same classifier restricted to trees over a vegetated class (forest,
    # copse, farmland/meadow) — the setting the canopy points live in.
    veg = [t for t in known if t["cls"] in (1, 2, 3)]
    out["c_ndvi"]["max5_vegetated_classes"] = classifier(
        [t["ndvi5"] for t in veg], [t["leaf"] == "e" for t in veg])
    thr = out["c_ndvi"]["max5"]["best_balanced"]["threshold"] * 255
    cn = np.array(ndvi_canopy)
    out["c_ndvi"]["canopy_points_flagged_evergreen_pct"] = round(
        pct(int((cn >= thr).sum()), len(cn)), 1)
    # by genus group: which leaf-off trees read "evergreen" (false positives)?
    fp = Counter(t["genus"] for t in known if t["leaf"] == "d" and t["ndvi5"] >= thr)
    out["c_ndvi"]["top_false_positive_genera"] = fp.most_common(8)

    # (d) archetypes
    arch = Counter(ta.ARCHETYPES[t["archetype"]] for t in trees)
    arch_p = Counter(ta.ARCHETYPES[t["archetype"]] for t in trees if t["tile"] == PRIMARY)
    out["d_archetypes"] = {
        "block": dict(arch.most_common()), "primary": dict(arch_p.most_common()),
        "leaf": dict(Counter(t["leaf"] for t in trees)),
        "foliage": dict(Counter({0: "green", 1: "purple", 2: "gold"}[t["foliage"]] for t in trees)),
        "globe": sum(1 for t in trees if t["globe"]),
        "unknown_taxon": sum(1 for t in trees if not t["known"]),
        "height_missing": sum(1 for t in trees if not t["h"]),
        "crown_missing": sum(1 for t in trees if not t["d"]),
    }
    text = json.dumps(out, indent=2, ensure_ascii=False)
    print(text)
    if args.json:
        Path(args.json).write_text(text)


if __name__ == "__main__":
    main()
