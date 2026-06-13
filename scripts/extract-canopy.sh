#!/usr/bin/env bash
#
# extract-canopy.sh — derive an area tree canopy from DOM1 for one tile.
#
# MANUAL, one-off step. Needs (all gitignored / already present):
#   - data/_raw/dom1/<tile>/dom1_<tile>.tif   (Digital Surface Model, 1 m)
#   - data/dgm/<tile>/dgm1_<tile>.tif         (Digital Terrain Model, 1 m)
#   - data/_raw/basis-dlm/…                    (ATKIS shapes for the veg mask)
#   - GDAL on PATH; Python 3 with Pillow.
#
# Pipeline:
#   nDOM = DOM1 - DGM1            (object height above ground, gdal_calc)
#   mask = forest+copse+park      (rasterised from the DLM)
#   then grid-sample the masked nDOM: one tree per CELL metres at the highest
#   canopy pixel above MINH, carrying that pixel's height.
#
# Output (small, COMMITTED):
#   data/dlm/canopy_<tile>.geojson   points with an "h" (height) property
#
# Usage:  bash scripts/extract-canopy.sh [tile]      (default 33412_5656)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
SRC="$ROOT/data/_raw/basis-dlm/basisdlm_sn_shape"
DOM="$ROOT/data/_raw/dom1/dom1_${TILE}_${SUFFIX}_tiff/dom1_${TILE}_${SUFFIX}.tif"
DGM="$ROOT/data/dgm/dgm1_${TILE}_${SUFFIX}_tiff/dgm1_${TILE}_${SUFFIX}.tif"
OUTDIR="$ROOT/data/dlm"
CELL="${CANOPY_SPACING:-7}"  # metres between sampled trees

for f in "$DOM" "$DGM"; do
  [ -f "$f" ] || { echo "error: missing raster $f" >&2; exit 1; }
done
command -v gdal_rasterize >/dev/null || { echo "error: GDAL not on PATH" >&2; exit 1; }

E="${TILE%_*}"; E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000)); YMIN=$((N * 1000)); XMAX=$((XMIN + 2000)); YMAX=$((YMIN + 2000))

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "vegetation mask (forest + copse + park) …"
gdal_rasterize -q -burn 1 -init 0 -ot Byte \
  -te "$XMIN" "$YMIN" "$XMAX" "$YMAX" -ts 2000 2000 \
  -l veg02_f "$SRC/veg02_f.shp" "$WORK/veg.tif"
gdal_rasterize -q -burn 1 -l veg03_f "$SRC/veg03_f.shp" "$WORK/veg.tif"
gdal_rasterize -q -burn 1 -l sie02_f \
  -where "OBJART_TXT='AX_SportFreizeitUndErholungsflaeche'" \
  "$SRC/sie02_f.shp" "$WORK/veg.tif" 2>/dev/null || true

# The land-cover class raster (from extract-dlm.sh) is used below to reject any
# tree sitting on a road / bridge deck / water / rail / path surface — that is
# what produced trees growing through the bridge (nDOM there = the deck height).
CLS="$OUTDIR/landcover_${TILE}_${SUFFIX}.png"
[ -f "$CLS" ] || { echo "error: run extract-dlm.sh for $TILE first ($CLS missing)" >&2; exit 1; }

OUT="$OUTDIR/canopy_${TILE}_${SUFFIX}.geojson"
# nDOM = DOM - DGM is computed here in Python (PIL), avoiding gdal_calc's numpy
# dependency. DOM/DGM are pixel-aligned (same origin, size, 1 m grid).
python3 - "$DOM" "$DGM" "$WORK/veg.tif" "$CLS" "$OUT" "$XMIN" "$YMAX" "$CELL" <<'PY'
import json, sys
from PIL import Image
dom_p, dgm_p, veg_p, cls_p, out_p, xmin, ymax, cell = (
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5],
    float(sys.argv[6]), float(sys.argv[7]), int(sys.argv[8]),
)
MINH, MAXH = 3.0, 45.0
# No tree on these land-cover classes: railway(5), path(6), road(7), water(8).
BLOCKED = {5, 6, 7, 8}
dom = list(Image.open(dom_p).getdata())   # float32, row-major, row0 = north
dgm = list(Image.open(dgm_p).getdata())
vg = list(Image.open(veg_p).getdata())    # byte 0/1
W, H = Image.open(veg_p).size
clsimg = Image.open(cls_p).convert("L")
CW, CH = clsimg.size                       # class raster may differ (e.g. 2048)
cls = list(clsimg.getdata())
def blocked(c, r):
    cc = min(int(c * CW / W), CW - 1)
    cr = min(int(r * CH / H), CH - 1)
    return cls[cr * CW + cc] in BLOCKED
feats = []
for r0 in range(0, H, cell):
    for c0 in range(0, W, cell):
        best_h, best_c, best_r = -1.0, -1, -1
        for r in range(r0, min(r0 + cell, H)):
            base = r * W
            for c in range(c0, min(c0 + cell, W)):
                if vg[base + c] == 0 or blocked(c, r):
                    continue
                h = dom[base + c] - dgm[base + c]
                if MINH < h < MAXH and h > best_h:
                    best_h, best_c, best_r = h, c, r
        if best_c < 0:
            continue
        x = xmin + best_c + 0.5
        y = ymax - best_r - 0.5
        feats.append({
            "type": "Feature",
            "properties": {"h": round(best_h, 1)},
            "geometry": {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
        })
geo = {
    "type": "FeatureCollection",
    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}},
    "features": feats,
}
with open(out_p, "w") as f:
    json.dump(geo, f)
print(f"wrote {out_p}: {len(feats)} canopy trees")
PY
