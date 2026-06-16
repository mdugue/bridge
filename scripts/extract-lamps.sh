#!/usr/bin/env bash
#
# extract-lamps.sh — bake OSM street lamps for one tile into a tiny GeoJSON.
#
# MANUAL, one-off step (mirrors extract-canopy.sh). Street furniture is NOT in
# ATKIS Basis-DLM / ALKIS, so OSM `highway=street_lamp` is the source. Licensed
# ODbL → the derived file carries "© OpenStreetMap contributors (ODbL)" and the
# app credits it in the HUD/about.
#
# Needs (GDAL on PATH; Python 3 with Pillow; curl) and, for the land-cover gate:
#   - data/dlm/landcover_<tile>_2_sn.png   (run extract-dlm.sh for the tile first)
#
# Pipeline:
#   1. reproject the tile's UTM33 bbox → WGS84 (gdaltransform)
#   2. fetch lamp nodes once via Overpass, caching the raw response (gitignored)
#   3. WGS84 GeoJSON → EPSG:25833 (ogr2ogr)
#   4. drop lamps that fall on the water class; default h = 5.0 m
#
# Output (small, COMMITTED), ALWAYS written even when empty (prepare-data and
# the loader both tolerate a zero-feature collection):
#   data/dlm/lamps_<tile>_2_sn.geojson   points (EPSG:25833) with an "h" height
#
# Usage:  bash scripts/extract-lamps.sh [tile]      (default 33412_5656)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
OUTDIR="$ROOT/data/dlm"
RAWDIR="$ROOT/data/_raw/osm"
LAMP_HEIGHT="${LAMP_HEIGHT:-5.0}"

command -v ogr2ogr >/dev/null || { echo "error: GDAL not on PATH" >&2; exit 1; }
command -v gdaltransform >/dev/null || { echo "error: GDAL not on PATH" >&2; exit 1; }
command -v curl >/dev/null || { echo "error: curl not on PATH" >&2; exit 1; }

CLS="$OUTDIR/landcover_${TILE}_${SUFFIX}.png"
[ -f "$CLS" ] || { echo "error: run extract-dlm.sh for $TILE first ($CLS missing)" >&2; exit 1; }

E="${TILE%_*}"; E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000)); YMIN=$((N * 1000)); XMAX=$((XMIN + 2000)); YMAX=$((YMIN + 2000))

mkdir -p "$RAWDIR" "$OUTDIR"

# 1. UTM33 bbox -> WGS84 (transform all four corners, take min/max with margin).
bbox_wgs84() {
  printf '%s %s\n%s %s\n%s %s\n%s %s\n' \
    "$XMIN" "$YMIN" "$XMAX" "$YMIN" "$XMIN" "$YMAX" "$XMAX" "$YMAX" \
  | gdaltransform -s_srs EPSG:25833 -t_srs EPSG:4326
}
read -r S W N_ E_ < <(bbox_wgs84 | python3 -c '
import sys
lons=[]; lats=[]
for line in sys.stdin:
    p=line.split()
    if len(p)>=2:
        lons.append(float(p[0])); lats.append(float(p[1]))
m=0.0005  # ~50 m margin so edge lamps are not clipped by projection skew
print(min(lats)-m, min(lons)-m, max(lats)+m, max(lons)+m)
')

echo "tile $TILE  bbox(WGS84) S=$S W=$W N=$N_ E=$E_"

# 2. Fetch lamp nodes ONCE (cache the raw response; never hit the API at runtime).
# Overpass rate-limits bursts with an HTML 429 page — validate the response is
# JSON before trusting the cache, so a retry actually refetches.
RAW="$RAWDIR/lamps_${TILE}_${SUFFIX}.json"
# Valid = parses AND has an "elements" array AND no Overpass "remark" (its
# documented runtime-error/timeout channel) — so a transient error or a
# truncated body fails validation and the next run refetches instead of baking
# (and committing) a silently-empty file.
is_json() {
  [ -s "$1" ] && python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(d.get("elements"), list) and "remark" not in d else 1)' "$1" 2>/dev/null
}
if is_json "$RAW"; then
  echo "using cached $RAW"
else
  echo "fetching OSM street lamps via Overpass …"
  curl -s -m 180 -G "https://overpass-api.de/api/interpreter" \
    --data-urlencode "data=[out:json][timeout:180];node[\"highway\"=\"street_lamp\"]($S,$W,$N_,$E_);out skel qt;" \
    -o "$RAW"
  if ! is_json "$RAW"; then
    rm -f "$RAW"
    echo "error: Overpass returned a non-JSON response (likely rate-limited);" \
         "wait a minute and re-run." >&2
    exit 2
  fi
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 3a. Overpass JSON -> WGS84 GeoJSON points.
python3 - "$RAW" "$WORK/wgs84.geojson" <<'PY'
import json, sys
raw_p, out_p = sys.argv[1], sys.argv[2]
with open(raw_p) as f:
    data = json.load(f)
feats = []
for el in data.get("elements", []):
    if el.get("type") != "node":
        continue
    lon, lat = el.get("lon"), el.get("lat")
    if lon is None or lat is None:
        continue
    feats.append({
        "type": "Feature",
        "properties": {},
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    })
with open(out_p, "w") as f:
    json.dump({"type": "FeatureCollection", "features": feats}, f)
print(f"  {len(feats)} raw lamp nodes")
PY

# 3b. WGS84 -> EPSG:25833.
ogr2ogr -q -f GeoJSON -s_srs EPSG:4326 -t_srs EPSG:25833 \
  "$WORK/utm.geojson" "$WORK/wgs84.geojson"

# 4. Gate against the class raster (drop water hits) + attach height.
OUT="$OUTDIR/lamps_${TILE}_${SUFFIX}.geojson"
python3 - "$WORK/utm.geojson" "$CLS" "$OUT" "$XMIN" "$YMIN" "$XMAX" "$YMAX" "$LAMP_HEIGHT" <<'PY'
import json, sys
from PIL import Image
utm_p, cls_p, out_p, xmin, ymin, xmax, ymax, h = (
    sys.argv[1], sys.argv[2], sys.argv[3],
    float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7]),
    float(sys.argv[8]),
)
WATER = 8  # only land-cover class we reject (OSM lamps are otherwise well-placed)
clsimg = Image.open(cls_p).convert("L")
CW, CH = clsimg.size
cls = list(clsimg.getdata())
with open(utm_p) as f:
    src = json.load(f)
def is_water(x, y):
    if not (xmin <= x <= xmax and ymin <= y <= ymax):
        return False  # off-tile: keep (a neighbour tile owns the gate)
    c = min(int((x - xmin) / (xmax - xmin) * CW), CW - 1)
    r = min(int((ymax - y) / (ymax - ymin) * CH), CH - 1)
    return cls[r * CW + c] == WATER
feats = []
for ft in src.get("features", []):
    x, y = ft["geometry"]["coordinates"][:2]
    if is_water(x, y):
        continue
    feats.append({
        "type": "Feature",
        "properties": {"h": round(h, 1)},
        "geometry": {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
    })
geo = {
    "type": "FeatureCollection",
    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}},
    "features": feats,
}
with open(out_p, "w") as f:
    json.dump(geo, f)
print(f"wrote {out_p}: {len(feats)} lamps")
PY
