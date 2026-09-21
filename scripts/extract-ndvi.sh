#!/usr/bin/env bash
#
# extract-ndvi.sh — bake a vegetation-vigour (NDVI) raster from the 4-band DOP.
#
# NDVI = (NIR − Red) / (NIR + Red), the standard greenness index. The Saxon DOP
# is RGB+NIR (band 4 = near-infrared), so healthy canopy lights up while roads,
# roofs and water stay low. The runtime samples this per tree to push crown
# colour lush↔dry (and the meadow tint, HUD "Wiesenfärbung"). See docs/transformations.md.
#
# MANUAL, one-off step. Needs (gitignored):
#   - data/_raw/DOP_RGBI/dop20rgbi_<tile>_2_sn_tiff/dop20rgbi_<tile>_2_sn.tif
#   - GDAL on PATH (Pillow silently drops the 4th band of an RGBI TIFF, so the
#     Red + NIR bands are extracted with gdal_translate) and Python 3 + Pillow.
#
# Output (small, COMMITTED): data/dlm/ndvi_<tile>_2_sn.png
#   single-channel L; pixel = clamp(NDVI,0..1) × 255 (0 = non-veg, 255 = lush).
#   Covers the 2 km tile exactly (row 0 = north), so EPSG→pixel reuses the
#   tile bounds — no worldfile needed.
#
# Usage:  bash scripts/extract-ndvi.sh [tile]      (default 33412_5656)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
DOP="$ROOT/data/_raw/DOP_RGBI/dop20rgbi_${TILE}_${SUFFIX}_tiff/dop20rgbi_${TILE}_${SUFFIX}.tif"
OUTDIR="$ROOT/data/dlm"
RES="${NDVI_RES:-1024}"   # output grid (~2 m/px at 1024) — plenty for soft sampling

[ -f "$DOP" ] || { echo "error: missing DOP orthophoto $DOP" >&2; exit 1; }
command -v gdal_translate >/dev/null || { echo "error: GDAL not on PATH" >&2; exit 1; }
mkdir -p "$OUTDIR"

OUT="$OUTDIR/ndvi_${TILE}_${SUFFIX}.png"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# GDAL reads the 4-band TIFF (PIL can't see band 4) and downsamples in one pass:
# band 1 = Red, band 4 = NIR, resampled to RES².
gdal_translate -q -b 1 -outsize "$RES" "$RES" -r bilinear -ot Byte "$DOP" "$WORK/r.tif"
gdal_translate -q -b 4 -outsize "$RES" "$RES" -r bilinear -ot Byte "$DOP" "$WORK/nir.tif"

python3 - "$WORK/r.tif" "$WORK/nir.tif" "$OUT" <<'PY'
import sys
from PIL import Image, ImageMath
r = Image.open(sys.argv[1]).convert("F")
nir = Image.open(sys.argv[2]).convert("F")
# Pillow ≥10.3 renamed ImageMath.eval → unsafe_eval; support both.
ev = getattr(ImageMath, "unsafe_eval", None) or ImageMath.eval
# +1 guards the all-black div-by-zero; (x+|x|)/2 clamps negatives to 0; ×255.
ndvi = ev("(nir - r) / (nir + r + 1.0)", nir=nir, r=r)
byte = ev("convert((ndvi + abs(ndvi)) * 127.5, 'L')", ndvi=ndvi)
byte.save(sys.argv[3])
print(f"wrote {sys.argv[3]}")
PY
