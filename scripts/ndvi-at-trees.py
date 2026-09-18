#!/usr/bin/env python3
"""Quantify NDVI sampled AT TREE POSITIONS across all four tiles.

Pure Python + PIL (numpy is not installed). For every canopy point and every
vegrows line vertex, sample ndvi01 at the tile pixel covering it, pool across
all four tiles, and report the distribution + remapped-lushness spread so we can
judge whether a per-tree NDVI crown colour can visibly read.
"""
import json
import math
from PIL import Image

TILES = [
    "33412_5656_2_sn",
    "33410_5656_2_sn",
    "33410_5658_2_sn",
    "33412_5658_2_sn",
]
DLM = "data/dlm"


def tile_extent(tile):
    # "33EEE_NNNN_2_sn" -> XMIN=EEE*1000, YMIN=NNNN*1000, +2000
    parts = tile.split("_")
    e = int(parts[0][2:])  # EEE
    n = int(parts[1])      # NNNN
    xmin = e * 1000
    ymin = n * 1000
    return xmin, ymin, xmin + 2000, ymin + 2000


def _clampget(px, w, h, c, r):
    if c < 0:
        c = 0
    elif c >= w:
        c = w - 1
    if r < 0:
        r = 0
    elif r >= h:
        r = h - 1
    return px[r * w + c]


def sample(px, w, h, xmin, ymax, x, y):
    """ndvi01 at EPSG (x,y) — nearest pixel. row 0 = NORTH."""
    col = int((x - xmin) / 2000.0 * w)
    row = int((ymax - y) / 2000.0 * h)
    return _clampget(px, w, h, col, row) / 255.0


def sample_crown(px, w, h, xmin, ymax, x, y, rad=2):
    """ndvi01 over a small crown footprint: max within a (2*rad+1)^2 window.

    The NDVI raster is ~2 m/px and sparse (many 0 pixels between leaf returns),
    while a real tree crown is several metres wide; a single nearest pixel
    badly undercounts. A small max-window approximates 'is this crown green'
    the way a crown-footprint texture lookup in the renderer would.
    """
    col = int((x - xmin) / 2000.0 * w)
    row = int((ymax - y) / 2000.0 * h)
    m = 0
    for dr in range(-rad, rad + 1):
        for dc in range(-rad, rad + 1):
            v = _clampget(px, w, h, col + dc, row + dr)
            if v > m:
                m = v
    return m / 255.0


def iter_tree_points(tile):
    """Yield (x, y) for every canopy point + every vegrows line vertex."""
    canopy = json.load(open(f"{DLM}/canopy_{tile}.geojson"))
    for f in canopy["features"]:
        x, y = f["geometry"]["coordinates"][:2]
        yield x, y
    veg = json.load(open(f"{DLM}/vegrows_{tile}.geojson"))
    for f in veg["features"]:
        g = f["geometry"]
        coords = g["coordinates"]
        if g["type"] == "LineString":
            lines = [coords]
        elif g["type"] == "MultiLineString":
            lines = coords
        else:
            lines = []
        for line in lines:
            for vert in line:
                yield vert[0], vert[1]


def stats(vals, label):
    n = len(vals)
    s = sorted(vals)

    def pct(p):
        idx = min(n - 1, max(0, int(round(p / 100.0 * (n - 1)))))
        return s[idx]

    median = (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0)
    mean = sum(vals) / n
    std = math.sqrt(sum((v - mean) ** 2 for v in vals) / n)
    pct_dry = 100.0 * sum(1 for v in vals if v < 0.4) / n
    pct_lush = 100.0 * sum(1 for v in vals if v > 0.6) / n

    def remap(v):
        t = (v - 0.3) / 0.4
        return 0.0 if t < 0 else (1.0 if t > 1 else t)

    ts = [remap(v) for v in vals]
    tmean = sum(ts) / n
    tstd = math.sqrt(sum((t - tmean) ** 2 for t in ts) / n)

    print("=" * 64)
    print(f"NDVI AT TREES — {label}  (pooled, n={n})")
    print("=" * 64)
    print(f"ndvi01 min/p05/p25 : {s[0]:.3f} / {pct(5):.3f} / {pct(25):.3f}")
    print(f"ndvi01 median/mean : {median:.3f} / {mean:.3f}")
    print(f"ndvi01 p75/p95/max : {pct(75):.3f} / {pct(95):.3f} / {s[-1]:.3f}")
    print(f"ndvi01 stddev      : {std:.4f}")
    print(f"%dry(<0.4)/%lush(>0.6): {pct_dry:.1f}% / {pct_lush:.1f}%  "
          f"(mid {100-pct_dry-pct_lush:.1f}%)")
    print(f"remapped t mean/std: {tmean:.4f} / {tstd:.4f}  "
          f"({100.0*sum(1 for t in ts if t<=0)/n:.0f}% clamped to 0)")
    print("ndvi01 histogram (0.05 bins):")
    bins = [0] * 20
    for v in vals:
        bins[min(19, int(v * 20))] += 1
    mx = max(bins)
    for i, c in enumerate(bins):
        print(f"  {i*0.05:.2f} {c:6d} {'#' * int(58 * c / mx)}")
    return dict(median=median, std=std, tstd=tstd, pct_dry=pct_dry,
                pct_lush=pct_lush)


def main():
    nearest = []
    crown = []
    canopy_n = 0
    vegrows_n = 0
    per_tile = {}

    for tile in TILES:
        xmin, ymin, xmax, ymax = tile_extent(tile)
        im = Image.open(f"{DLM}/ndvi_{tile}.png").convert("L")
        w, h = im.size
        px = list(im.get_flattened_data())

        tnear = []
        canopy = json.load(open(f"{DLM}/canopy_{tile}.geojson"))
        for f in canopy["features"]:
            x, y = f["geometry"]["coordinates"][:2]
            nearest.append(sample(px, w, h, xmin, ymax, x, y))
            crown.append(sample_crown(px, w, h, xmin, ymax, x, y))
            tnear.append(nearest[-1])
            canopy_n += 1
        veg = json.load(open(f"{DLM}/vegrows_{tile}.geojson"))
        for f in veg["features"]:
            g = f["geometry"]
            coords = g["coordinates"]
            lines = [coords] if g["type"] == "LineString" else (
                coords if g["type"] == "MultiLineString" else [])
            for line in lines:
                for vert in line:
                    nearest.append(sample(px, w, h, xmin, ymax,
                                          vert[0], vert[1]))
                    crown.append(sample_crown(px, w, h, xmin, ymax,
                                              vert[0], vert[1]))
                    tnear.append(nearest[-1])
                    vegrows_n += 1
        per_tile[tile] = tnear

    print(f"canopy points {canopy_n}  vegrows verts {vegrows_n}  "
          f"total {canopy_n + vegrows_n}\n")
    rn = stats(nearest, "NEAREST PIXEL")
    print()
    rc = stats(crown, "CROWN FOOTPRINT (5x5 max ~10m)")

    print()
    print("-" * 64)
    print("per-tile ndvi01 (nearest) median / stddev:")
    for tile, tv in per_tile.items():
        ts2 = sorted(tv)
        m = ts2[len(ts2) // 2]
        mn = sum(tv) / len(tv)
        sd = math.sqrt(sum((v - mn) ** 2 for v in tv) / len(tv))
        print(f"  {tile}: n={len(tv):5d} median={m:.3f} std={sd:.3f}")

    # Amplification recommendation: a per-tree lushness lift only reads if its
    # luminance/hue swing is a few % of the palette. With remapped-t stddev s,
    # a multiplier A makes the typical tree-to-tree swing A*s. To clear a ~8-10%
    # just-noticeable luminance step at +-1 sigma we want A*s ~ 0.30-0.40.
    target = 0.35
    a_near = target / rn["tstd"] if rn["tstd"] else 0
    a_crown = target / rc["tstd"] if rc["tstd"] else 0
    print("-" * 64)
    print("AMPLIFICATION to reach ~0.35 readable +-1sigma swing in t:")
    print(f"  from nearest tstd {rn['tstd']:.3f}  ->  x{a_near:.1f}")
    print(f"  from crown   tstd {rc['tstd']:.3f}  ->  x{a_crown:.1f}")


if __name__ == "__main__":
    main()
