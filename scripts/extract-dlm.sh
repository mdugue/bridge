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
