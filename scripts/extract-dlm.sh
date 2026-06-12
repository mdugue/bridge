#!/usr/bin/env bash
#
# extract-dlm.sh — bake an ATKIS Basis-DLM land-cover "splatmap" for one tile.
#
# MANUAL, one-off step. Needs:
#   - the ~5 GB statewide Basis-DLM Shape download in data/_raw/basis-dlm/
#     (gitignored — a reproducible public download, never committed)
#   - GDAL on PATH (brew install gdal)
#
# Output (small, COMMITTED):
#   data/dlm/landcover_<tile>.png   single-band class raster, 1 byte/pixel
#   data/dlm/landcover_<tile>.json  bounds + class legend
# prepare-data.ts copies the .png to public/data/ at build time, so the build
# server never needs the raw download or GDAL.
#
# Usage:  bash scripts/extract-dlm.sh [tile]      (default tile: 33412_5656)
#
# Class ids (higher id wins where surfaces overlap — water always on top):
#   0 background/unclassified   1 farmland/meadow   2 forest   3 copse
#   4 built-up   5 railway   6 path   7 road   8 water
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/data/_raw/basis-dlm/basisdlm_sn_shape"
OUTDIR="$ROOT/data/dlm"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
RES=2048   # pixels per side over the 2 km tile (~1 m) — crisp roads/paths

if [ ! -d "$SRC" ]; then
  echo "error: raw DLM not found at $SRC" >&2
  echo "Download the Basis-DLM Shape from geodaten.sachsen.de and unzip it there." >&2
  exit 1
fi
command -v gdal_rasterize >/dev/null || { echo "error: GDAL not on PATH (brew install gdal)" >&2; exit 1; }

# Tile extent from the name: 33EEE_NNNN -> [EEE000, NNNN000, +2000] (EPSG:25833).
E="${TILE%_*}"; E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000)); YMIN=$((N * 1000)); XMAX=$((XMIN + 2000)); YMAX=$((YMIN + 2000))

mkdir -p "$OUTDIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
GPKG="$WORK/work.gpkg"
TIF="$WORK/landcover.tif"
NAME="landcover_${TILE}_${SUFFIX}"

echo "Tile $TILE  extent [$XMIN $YMIN $XMAX $YMAX]  ${RES}x${RES}px"

# --- clip the polygon land-cover layers into one working GeoPackage ----------
clip_area() { # layer
  local l="$1"
  [ -f "$SRC/$l.shp" ] || return 0
  ogr2ogr -f GPKG -update -append -nln "$l" -nlt PROMOTE_TO_MULTI \
    -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" "$GPKG" "$SRC/$l.shp" 2>/dev/null || true
}
for l in veg01_f veg02_f veg03_f sie02_f ver03_f ver01_f gew01_f gew02_f; do
  clip_area "$l"
done

# --- buffer the line layers (centerlines) into polygons of realistic width ---
# Roads use the surveyed width BRF when known, else a width by road class WDM.
buffer_lines() { # out_layer  src_shp  src_layer  buffer_expr
  local out="$1" shp="$2" lyr="$3" expr="$4"
  [ -f "$SRC/$shp.shp" ] || return 0
  ogr2ogr -f GPKG -update -append -nln "$out" -nlt PROMOTE_TO_MULTI \
    -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" -dialect SQLITE \
    -sql "SELECT ST_Buffer(geometry, $expr) AS geom FROM $lyr" \
    "$GPKG" "$SRC/$shp.shp" 2>/dev/null || true
}
ROAD_R="CASE WHEN BRF > 0 THEN BRF/2.0
             WHEN WDM='1301' THEN 10.0 WHEN WDM='1303' THEN 5.0
             WHEN WDM='1305' THEN 4.0  WHEN WDM='1306' THEN 3.0
             WHEN WDM='1307' THEN 2.5  ELSE 2.5 END"
buffer_lines road_buf   ver01_l ver01_l "$ROAD_R"
buffer_lines path_buf   ver02_l ver02_l "1.0"
buffer_lines stream_buf gew01_l gew01_l "1.0"

# --- rasterize, lowest priority first; later burns overwrite ----------------
burn() { # layer  classid
  local l="$1" id="$2"
  ogrinfo -so "$GPKG" "$l" >/dev/null 2>&1 || return 0
  if [ ! -f "$TIF" ]; then
    gdal_rasterize -q -burn "$id" -init 0 -ot Byte -a_nodata 255 \
      -te "$XMIN" "$YMIN" "$XMAX" "$YMAX" -ts "$RES" "$RES" \
      -l "$l" "$GPKG" "$TIF"
  else
    gdal_rasterize -q -burn "$id" -l "$l" "$GPKG" "$TIF"
  fi
}
burn veg01_f 1   # farmland / meadow
burn veg02_f 2   # forest
burn veg03_f 3   # copse
burn sie02_f 4   # built-up
burn ver03_f 5   # railway area
burn path_buf 6  # paths
burn ver01_f 7   # road area
burn road_buf 7  # road centerlines (buffered)
burn gew02_f 8   # water area (alt)
burn gew01_f 8   # water area
burn stream_buf 8  # streams (buffered)

[ -f "$TIF" ] || { echo "error: nothing rasterized (no features in tile?)" >&2; exit 1; }

# --- export the committed PNG + legend sidecar ------------------------------
gdal_translate -q -of PNG -ot Byte "$TIF" "$OUTDIR/$NAME.png"
rm -f "$OUTDIR/$NAME.png.aux.xml"

# --- hedges & tree rows (veg04 lines) as a small GeoJSON --------------------
# Kept in the native CRS (RFC7946=NO) so the client works in EPSG:25833 like
# the rest of the scene; coordinates rounded to centimetre to stay tiny.
VEGROWS="$OUTDIR/vegrows_${TILE}_${SUFFIX}.geojson"
rm -f "$VEGROWS"
if [ -f "$SRC/veg04_l.shp" ]; then
  ogr2ogr -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
    -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" -dialect SQLITE \
    -sql "SELECT CASE WHEN BWS='1100' THEN 'hedge' ELSE 'treerow' END AS kind, geometry
          FROM veg04_l" \
    "$VEGROWS" "$SRC/veg04_l.shp" 2>/dev/null || true
  echo "wrote $VEGROWS"
fi

# --- pastel RGBA splatmap (the version the terrain + water actually sample) --
# RGB = curated pastel palette; A = water coverage. Both blurred only lightly:
# the terrain and water sample this with LINEAR + mipmaps + anisotropy, so the
# GPU anti-aliases boundaries at grazing angles (no NEAREST stair-steps) WITHOUT
# needing heavy pre-blur — keeping roads crisp. The water plane reads coverage
# from the alpha channel and smoothsteps it for a clean, straight shoreline.
#
# Tune crispness with LANDCOVER_BLUR (px @ ${RES}); water edge with WATER_BLUR:
#   LANDCOVER_BLUR=0.4 WATER_BLUR=1.2 bash scripts/extract-dlm.sh 33412_5656
BLUR="${LANDCOVER_BLUR:-0.8}"
WBLUR="${WATER_BLUR:-1.0}"
RGB="$OUTDIR/landcover_rgb_${TILE}_${SUFFIX}.png"
python3 - "$OUTDIR/$NAME.png" "$RGB" "$BLUR" "$WBLUR" <<'PY'
import sys
from PIL import Image, ImageFilter
src, dst, blur, wblur = (
    sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
)
# Curated pastel earth-tone palette (high value, low saturation, analogous)
PAL = {
    0: (230, 224, 209),  # background  warm pale taupe
    1: (197, 211, 170),  # farmland    soft sage
    2: (150, 176, 138),  # forest      muted moss
    3: (175, 195, 158),  # copse       light moss
    4: (228, 219, 203),  # built-up    warm pale clay
    5: (197, 183, 178),  # railway     dusty mauve
    6: (224, 205, 168),  # path        pale warm sand
    7: (200, 200, 206),  # road        soft grey-lavender
    8: (164, 192, 209),  # water       dusty blue
}
cls = Image.open(src).convert("L")
w, h = cls.size
rgb = Image.new("RGB", (w, h))
alpha = Image.new("L", (w, h))
sp, dp, ap = cls.load(), rgb.load(), alpha.load()
for y in range(h):
    for x in range(w):
        c = sp[x, y]
        dp[x, y] = PAL.get(c, PAL[0])
        ap[x, y] = 255 if c == 8 else 0  # water coverage
if blur > 0:
    rgb = rgb.filter(ImageFilter.GaussianBlur(blur))
if wblur > 0:
    alpha = alpha.filter(ImageFilter.GaussianBlur(wblur))
rgb.putalpha(alpha)
rgb.save(dst)
print(f"wrote {dst} (rgb blur {blur}, water blur {wblur})")
PY

cat > "$OUTDIR/$NAME.json" <<JSON
{
  "tile": "${TILE}_${SUFFIX}",
  "crs": "EPSG:25833",
  "bounds": [$XMIN, $YMIN, $XMAX, $YMAX],
  "size": $RES,
  "classes": {
    "0": "background", "1": "farmland", "2": "forest", "3": "copse",
    "4": "builtup", "5": "railway", "6": "path", "7": "road", "8": "water"
  }
}
JSON

echo "wrote $OUTDIR/$NAME.png + .json"
