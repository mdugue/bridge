#!/usr/bin/env bash
#
# extract-lowveg.sh — bake the OSM hedges (at their laser-scan height) and the
# trees outside the canopy mask for one tile, from the GeoSN laser scan (LSC)
# + OSM. The viewer draws both by default (low-vegetation-layer.ts, and the
# extra trees join the canopy). The laser-scan-only hedges and the shrubs the
# bake also finds are NOT shipped (docs/transformations.md, "Low vegetation":
# ~30 % crown-rim false positives, faceted "boulders" up close) — set
# LOWVEG_ALL=1 to write every candidate to
# data/_raw/lsc/derived/<tile>/lowveg_all_<tile>.geojson for research.
#
# MANUAL, one-off step. Needs (all gitignored, under data/_raw/ — override the
# root with RAW_ROOT=/path/to/data/_raw, e.g. from a git worktree):
#   - lsc/lsc_<tile>_2_sn_laz/lsc_<tile>_2_sn.laz   the LSC tile (≈380 MB; the
#     only raw input with heights below 3 m that tells vegetation apart)
#   - the committed bakes this one depends on: data/dlm/landcover_<tile>.png
#     (extract-dlm.sh), ndvi_<tile>.png (extract-ndvi.sh), walls_<tile>.geojson
#     (extract-walls.sh), bridge_<tile>.geojson (extract-rail.sh),
#     canopy_<tile>.geojson (extract-canopy.sh), trees_<tile>.geojson
#     (extract-trees.sh — the extra trees are thinned against it: the
#     cadastre wins within max(4 m, its crown radius)), data/cityjson/, data/dgm/
#   - PDAL ≥ 2.10 and GDAL on PATH; `uv` (the bake needs numpy, scipy,
#     scikit-image, shapely, rasterio — the system Python has none of them)
#   - curl, for the one Overpass query (cached; OVERPASS_URL overrides the
#     endpoint when overpass-api.de is overloaded)
#
# Without the LAZ the tile falls back to OSM only: mapped hedges at their tagged
# (or a default) height, and no extra trees — see docs/portability.md. The
# three neighbour tiles are baked that way (RAW_ROOT pointed at a raw root that
# holds only the Overpass caches), which is what is committed.
#
# Pipeline:
#   1. PDAL → 0.5 m rasters under data/_raw/lsc/derived/<tile>/ (skipped when
#      present): ground (classes 2/8/30: min, idw, count), surface (classes
#      2/20: max, count), non-ground point count, its multi-echo share, and the
#      mean intensity + count of the LOW non-ground returns (0.25–4 m above
#      ground) in lowveg/lowint_050.tif
#   2. Overpass: barrier=hedge, natural=scrub|shrubbery|shrub for the tile
#   3. scripts/extract-lowveg.py: nDOM band + vegetation cue + exclusions →
#      components → hedge polylines / shrub points, merged with OSM
#
# Output (small, COMMITTED):
#   data/dlm/lowveg_<tile>_2_sn.geojson   OSM hedges {kind, h, w, src: osm|osm+lsc}
#   data/dlm/canopyx_<tile>_2_sn.geojson  extra trees {h, r} (LSC only)
#
# Usage:  bash scripts/extract-lowveg.sh [tile]      (default 33412_5656)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
T="${TILE}_${SUFFIX}"
RAW="${RAW_ROOT:-$ROOT/data/_raw}"
OUTDIR="$ROOT/data/dlm"
LAZ="$RAW/lsc/lsc_${T}_laz/lsc_${T}.laz"
DER="$RAW/lsc/derived/$T"
LV="$DER/lowveg"
OSM="$RAW/osm/lowveg_${T}.json"
OVERPASS_URL="${OVERPASS_URL:-https://overpass-api.de/api/interpreter}"

command -v uv >/dev/null || { echo "error: uv not on PATH" >&2; exit 1; }
command -v gdaltransform >/dev/null || { echo "error: GDAL not on PATH" >&2; exit 1; }

E="${TILE%_*}"; E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000)); YMIN=$((N * 1000)); XMAX=$((XMIN + 2000)); YMAX=$((YMIN + 2000))
mkdir -p "$RAW/osm"

# --- 1. laser-scan rasters ----------------------------------------------------
# writers.gdal needs binmode:true (else it bins with a 0.71 m radius), and a
# pipeline with several writers runs only the first — hence one run per raster.
gdal_run() { # out  ranges  dimension  output_type  window  [extra stages json]
  local out="$1" ranges="$2" dim="$3" otype="$4" win="$5" extra="${6:-}"
  [ -f "$out" ] && return 0
  echo "PDAL → $(basename "$out") …"
  pdal pipeline --stdin <<JSON
{"pipeline":[
  "$LAZ",
  {"type":"filters.range","limits":"$ranges"}${extra},
  {"type":"writers.gdal","filename":"$out","dimension":"$dim","output_type":"$otype",
   "window_size":$win,"resolution":0.5,"origin_x":$XMIN,"origin_y":$YMIN,
   "width":4000,"height":4000,"data_type":"float32","nodata":-9999,"binmode":true,
   "gdalopts":"COMPRESS=DEFLATE,PREDICTOR=3,TILED=YES"}
]}
JSON
}

if [ -f "$LAZ" ]; then
  command -v pdal >/dev/null || { echo "error: PDAL not on PATH" >&2; exit 1; }
  mkdir -p "$LV"
  gdal_run "$DER/dtm_050.tif" "Classification[2:2],Classification[8:8],Classification[30:30]" Z "idw,min,count" 3
  gdal_run "$DER/dsm_050.tif" "Classification[2:2],Classification[20:20]" Z "max,count" 0
  gdal_run "$DER/nonground_count_050.tif" "Classification[20:20]" Z count 0
  gdal_run "$DER/nonground_multiecho_count_050.tif" "Classification[20:20]" Z count 0 \
    ',{"type":"filters.range","limits":"NumberOfReturns[2:]"}'
  gdal_run "$LV/lowint_050.tif" "Classification[20:20]" Intensity "mean,count" 0 \
    ",{\"type\":\"filters.hag_dem\",\"raster\":\"$DER/dtm_050.tif\",\"band\":2},{\"type\":\"filters.range\",\"limits\":\"HeightAboveGround[0.25:4.0]\"}"
  LSC_ARGS=(--lsc "$DER" --lowveg-dir "$LV")
else
  echo "no LAZ at $LAZ — OSM-only fallback"
  LSC_ARGS=()
fi

# --- 2. OSM (fetched once, cached; validated like extract-lamps.sh) -----------
read -r S W N_ E_ < <(printf '%s %s\n%s %s\n%s %s\n%s %s\n' \
  "$XMIN" "$YMIN" "$XMAX" "$YMIN" "$XMIN" "$YMAX" "$XMAX" "$YMAX" \
  | gdaltransform -s_srs EPSG:25833 -t_srs EPSG:4326 | python3 -c '
import sys
lons=[]; lats=[]
for line in sys.stdin:
    p=line.split()
    if len(p)>=2:
        lons.append(float(p[0])); lats.append(float(p[1]))
m=0.0005
print(min(lats)-m, min(lons)-m, max(lats)+m, max(lons)+m)
')
is_json() {
  [ -s "$1" ] && python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(d.get("elements"), list) and "remark" not in d else 1)' "$1" 2>/dev/null
}
if is_json "$OSM"; then
  echo "using cached $OSM"
else
  echo "fetching OSM hedges/scrub via Overpass ($OVERPASS_URL) …"
  B="$S,$W,$N_,$E_"
  curl -s -m 200 -A "city-walker-bake" --data-urlencode \
    "data=[out:json][timeout:180];(way[\"barrier\"=\"hedge\"]($B);way[\"natural\"~\"^(scrub|shrubbery)\$\"]($B);relation[\"natural\"~\"^(scrub|shrubbery)\$\"]($B);node[\"natural\"=\"shrub\"]($B););out geom;" \
    "$OVERPASS_URL" -o "$OSM"
  if ! is_json "$OSM"; then
    rm -f "$OSM"
    echo "error: Overpass returned no valid JSON (busy/rate-limited); retry, or set OVERPASS_URL" >&2
    exit 2
  fi
fi

# --- 3. the bake ----------------------------------------------------------------
# Exact pins, like the three.js stack: a skeletonize/peak_local_max change in a
# minor release would move every hedge and shrub. Python 3.14 (uv's default).
uv run --quiet --with numpy==2.5.3 --with scipy==1.18.1 \
  --with scikit-image==0.26.0 --with shapely==2.1.2 --with rasterio==1.5.1 \
  --with pillow==12.2.0 python "$ROOT/scripts/extract-lowveg.py" \
  --tile "$T" --xmin "$XMIN" --ymin "$YMIN" ${LSC_ARGS[@]+"${LSC_ARGS[@]}"} \
  --dgm "$ROOT/data/dgm/dgm1_${T}_tiff/dgm1_${T}.tif" \
  --landcover "$OUTDIR/landcover_${T}.png" --ndvi "$OUTDIR/ndvi_${T}.png" \
  --cityjson "$ROOT/data/cityjson/lod2_${T}.city.json" \
  --walls "$OUTDIR/walls_${T}.geojson" --bridge "$OUTDIR/bridge_${T}.geojson" \
  --osm "$OSM" --canopy "$OUTDIR/canopy_${T}.geojson" \
  --trees "$OUTDIR/trees_${T}.geojson" \
  --out "$OUTDIR/lowveg_${T}.geojson" --out-canopyx "$OUTDIR/canopyx_${T}.geojson" \
  ${LOWVEG_ALL:+--out-all "$DER/lowveg_all_${T}.geojson"}
