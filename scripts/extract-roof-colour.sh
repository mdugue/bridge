#!/usr/bin/env bash
#
# extract-roof-colour.sh — sample real roof colours from a DOP orthophoto.
#
# STATUS: 🧪 EXPERIMENTAL (see docs/transformations.md). This bakes the per-
# building roof-colour LUT; the runtime hook that consumes it + the GPU A/B
# against the synthesized palette are the next step, pending a fetched DOP tile.
#
# Idea: the nadir DOP sees ROOFS well (not facades). Sample the DOP under each
# building's RoofSurface footprint, take a robust median, and emit a LUT that the
# roof-colour transform prefers over the synthesized terracotta/slate palette
# (which stays as the fallback when no DOP exists — see docs/portability.md).
#
# MANUAL, one-off step. Needs (gitignored):
#   - data/_raw/DOP_RGBI/dop20rgbi_<tile>_2_sn_tiff/dop20rgbi_<tile>_2_sn.tif
#       (Saxon DOP, GeoTIFF, 10000² @ 0.2 m, 4-band R/G/B/NIR)
#   - data/cityjson/lod2_<tile>_2_sn.city.json
#   - Python 3 with Pillow.
#
# The DOP is assumed to cover the 2 km tile bounds exactly (same convention as
# extract-canopy.sh — no worldfile read; pixel size = 2000 m / width).
#
# Output (small, COMMITTED):
#   data/dop/roofcolor_<tile>_2_sn.json
#     { "meta": {...}, "roofs": { "<cityobject-id>": [r, g, b], ... } }   # LINEAR rgb
#
# The LUT is keyed by the CityJSON object id STRING (not the loader's integer
# objectid index) so it is robust to loader-version changes; the runtime resolves
# id→index via Object.keys(CityObjects) at load.
#
# Usage:  bash scripts/extract-roof-colour.sh [tile]      (default 33412_5656)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
DOP="$ROOT/data/_raw/DOP_RGBI/dop20rgbi_${TILE}_${SUFFIX}_tiff/dop20rgbi_${TILE}_${SUFFIX}.tif"
CITY="$ROOT/data/cityjson/lod2_${TILE}_${SUFFIX}.city.json"
OUTDIR="$ROOT/data/dop"
ERODE_PX="${ROOF_ERODE_PX:-5}"   # inset (odd) to dodge building-lean over facades

[ -f "$DOP" ]  || { echo "error: missing DOP orthophoto $DOP" >&2; exit 1; }
[ -f "$CITY" ] || { echo "error: missing CityJSON $CITY" >&2; exit 1; }
mkdir -p "$OUTDIR"

# Tile id encodes the SW corner in km: 33412 -> easting 412000, 5656 -> 5656000.
E="${TILE%_*}"; E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000)); YMAX=$(((N * 1000) + 2000))

OUT="$OUTDIR/roofcolor_${TILE}_${SUFFIX}.json"
python3 - "$DOP" "$CITY" "$OUT" "$XMIN" "$YMAX" "$ERODE_PX" "$TILE" <<'PY'
import json, sys
from PIL import Image, ImageDraw, ImageFilter
# DOP tiles are 10000² = 100 MP, above Pillow's default bomb guard (89 MP).
# These are trusted local rasters, so lift the limit rather than hard-fail.
Image.MAX_IMAGE_PIXELS = None

dop_p, city_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
xmin, ymax = float(sys.argv[4]), float(sys.argv[5])
erode = int(sys.argv[6])
tile = sys.argv[7]
TILE_M = 2000.0
MIN_SAMPLES = 12

def srgb_to_linear(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

dop = Image.open(dop_p).convert("RGB")  # drops NIR if RGBI; roof colour is RGB
W, H = dop.size
pxw, pxh = TILE_M / W, TILE_M / H

with open(city_p) as f:
    cj = json.load(f)
scale = cj.get("transform", {}).get("scale", [1, 1, 1])
trans = cj.get("transform", {}).get("translate", [0, 0, 0])
verts = cj["vertices"]

def real_xy(vi):
    v = verts[vi]
    return (v[0] * scale[0] + trans[0], v[1] * scale[1] + trans[1])

def iter_roof_rings(geom):
    """Yield each RoofSurface exterior ring (list of vertex indices)."""
    sem = geom.get("semantics") or {}
    meta = sem.get("surfaces", [])
    values = sem.get("values")
    b = geom.get("boundaries", [])
    gtype = geom.get("type")
    pairs = []  # (surface, semantic_index)
    if gtype == "Solid":
        for shi, shell in enumerate(b):
            vals = values[shi] if values else None
            for si, surface in enumerate(shell):
                pairs.append((surface, vals[si] if vals is not None else None))
    elif gtype in ("MultiSurface", "CompositeSurface"):
        for si, surface in enumerate(b):
            pairs.append((surface, values[si] if values else None))
    # MultiSolid and friends are not used by Saxony LoD2; skip if seen.
    for surface, sidx in pairs:
        if sidx is None or sidx >= len(meta):
            continue
        if meta[sidx].get("type") != "RoofSurface":
            continue
        if surface and surface[0]:
            yield surface[0]  # exterior ring

roofs, sampled, skipped = {}, 0, 0
for oid, obj in cj["CityObjects"].items():
    rings = []
    for geom in obj.get("geometry", []):
        for ring in iter_roof_rings(geom):
            pts = [real_xy(vi) for vi in ring]
            rings.append([((x - xmin) / pxw, (ymax - y) / pxh) for x, y in pts])
    if not rings:
        continue
    cols = [c for ring in rings for c, _ in ring]
    rows = [r for ring in rings for _, r in ring]
    c0, r0 = max(0, int(min(cols))), max(0, int(min(rows)))
    c1, r1 = min(W, int(max(cols)) + 1), min(H, int(max(rows)) + 1)
    if c1 - c0 < 2 or r1 - r0 < 2:
        continue
    mask = Image.new("L", (c1 - c0, r1 - r0), 0)
    md = ImageDraw.Draw(mask)
    for ring in rings:
        md.polygon([(c - c0, r - r0) for c, r in ring], fill=255)
    if erode >= 3 and mask.width > erode and mask.height > erode:
        inset = mask.filter(ImageFilter.MinFilter(erode))
        if inset.getbbox():  # keep the inset only if it didn't erase a thin roof
            mask = inset
    crop = dop.crop((c0, r0, c1, r1))
    mpx, cpx = mask.getdata(), crop.getdata()
    rs, gs, bs = [], [], []
    for i, m in enumerate(mpx):
        if m:
            px = cpx[i]
            rs.append(px[0]); gs.append(px[1]); bs.append(px[2])
    if len(rs) < MIN_SAMPLES:
        skipped += 1
        continue
    def median(xs):
        xs.sort()
        return xs[len(xs) // 2]
    roofs[oid] = [round(srgb_to_linear(median(rs)), 4),
                  round(srgb_to_linear(median(gs)), 4),
                  round(srgb_to_linear(median(bs)), 4)]
    sampled += 1

out = {
    "meta": {
        "tile": tile, "source": "DOP", "space": "linear-rgb",
        "erode_px": erode, "buildings_sampled": sampled, "buildings_skipped": skipped,
    },
    "roofs": roofs,
}
with open(out_p, "w") as f:
    json.dump(out, f)
print(f"wrote {out_p}: {sampled} roofs sampled, {skipped} skipped (too few px)")
PY
