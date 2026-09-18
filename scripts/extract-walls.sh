#!/usr/bin/env bash
#
# extract-walls.sh — bake OSM retaining/city walls for one tile into a GeoJSON.
#
# MANUAL, one-off step. Monumental retaining walls (e.g. the Brühlsche Terrasse)
# are NOT a clean feature in the terrain data: the DGM1/DOM1/LiDAR all smooth the
# sandstone wall into a gentle bank, and it's not a CityJSON building either — so
# it "goes missing". OSM HAS it as tagged vector lines with heights
# (`barrier=retaining_wall|city_wall|wall`, `man_made=embankment`), which the
# wall-layer renders as vertical geometry and the terrain-conflation burns into
# the heightfield as a step. ODbL → the derived file credits "© OpenStreetMap
# contributors".
#
# SOURCE: a LOCAL Geofabrik regional extract (`data/_raw/osm/*.osm.pbf`), read
# via GDAL's OSM driver — NO Overpass, so no rate limits, fully reproducible, and
# every tile bakes in one pass. Download once from https://download.geofabrik.de
# (e.g. Sachsen ~250 MB) into data/_raw/osm/ (gitignored, like the DGM/DOP raws).
# Override the file with WALLS_PBF=/path/to/extract.osm.pbf.
#
# Why both `lines` AND `multipolygons`: GDAL routes CLOSED ways carrying a
# polygon key (amenity=fountain, natural=scrub, area=yes …) into `multipolygons`
# and open ways into `lines`. Reading both and converting polygon rings → lines
# reproduces the Overpass `way[barrier~…]` result feature-for-feature (verified:
# 403 lines + 33 closed = 436, identical to the old Overpass bake for 33410_5656).
#
# Needs: GDAL on PATH (ogr2ogr with the OSM driver) + Python 3.
#
# Output (small, COMMITTED), always written even when empty:
#   data/dlm/walls_<tile>_2_sn.geojson  LineStrings (EPSG:25833) with kind + "h"
#
# Usage:  bash scripts/extract-walls.sh [tile]      (default 33412_5656)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
OUTDIR="$ROOT/data/dlm"
RAWDIR="$ROOT/data/_raw/osm"

command -v ogr2ogr >/dev/null || { echo "error: GDAL not on PATH" >&2; exit 1; }

# Locate the .pbf (env override, else the newest one in data/_raw/osm/).
PBF="${WALLS_PBF:-$(ls -t "$RAWDIR"/*.osm.pbf 2>/dev/null | head -1 || true)}"
if [ -z "${PBF:-}" ] || [ ! -f "$PBF" ]; then
  echo "error: no .osm.pbf found in $RAWDIR (download a Geofabrik extract, e.g." >&2
  echo "       https://download.geofabrik.de/europe/germany/sachsen.html), or set" >&2
  echo "       WALLS_PBF=/path/to/extract.osm.pbf" >&2
  exit 1
fi
echo "tile $TILE  source $(basename "$PBF")"

E="${TILE%_*}"; E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000)); YMIN=$((N * 1000)); XMAX=$((XMIN + 2000)); YMAX=$((YMIN + 2000))

mkdir -p "$OUTDIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

WHERE="barrier IN ('retaining_wall','city_wall','wall') OR man_made = 'embankment'"

# 1. Pull matching features from BOTH the line and (closed-way) polygon layers,
#    spatially filtered + clipped to the exact tile, reprojected to EPSG:25833.
#    `-spat … -spat_srs EPSG:25833` filters in UTM; `-clipdst` clips in the dest
#    CRS. Each layer → its own intermediate GeoJSON (carrying barrier/man_made +
#    the HSTORE other_tags so Python can read the height tag).
for LAYER in lines multipolygons; do
  ogr2ogr -q -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
    -s_srs EPSG:4326 -t_srs EPSG:25833 \
    -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" -spat_srs EPSG:25833 \
    -clipdst "$XMIN" "$YMIN" "$XMAX" "$YMAX" \
    -select "barrier,man_made,other_tags" \
    -where "$WHERE" \
    "$WORK/$LAYER.geojson" "$PBF" "$LAYER" 2>/dev/null || \
    echo '{"type":"FeatureCollection","features":[]}' > "$WORK/$LAYER.geojson"
done

# 2. Merge both layers → clean LineStrings with (kind, h). Polygon rings are
#    emitted as closed LineStrings; Multi* are split into one feature per part
#    (the wall-layer only renders LineString). Height parsed from the HSTORE
#    other_tags ("height"=>"9 m"); defaults per kind when absent.
OUT="$OUTDIR/walls_${TILE}_${SUFFIX}.geojson"
python3 - "$WORK/lines.geojson" "$WORK/multipolygons.geojson" "$OUT" <<'PY'
import json, re, sys
lines_p, mp_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]

# Default heights (m) per kind when OSM carries no height/est_height tag.
DEFAULT_H = {"city_wall": 6.0, "retaining_wall": 3.0, "wall": 1.5, "embankment": 2.5}

def parse_h(other_tags):
    if not other_tags:
        return None
    for key in ("height", "est_height"):
        m = re.search(r'"%s"=>"([^"]*)"' % key, other_tags)
        if m:
            num = re.search(r"[-+]?\d*\.?\d+", m.group(1))
            if num:
                return max(0.5, min(float(num.group()), 30.0))
    return None

def round2(coords):
    return [[round(x, 2), round(y, 2)] for x, y in coords]

def emit(feats, kind, h, lines):
    """Append one Feature per LineString part."""
    for ln in lines:
        if len(ln) >= 2:
            feats.append({
                "type": "Feature",
                "properties": {"kind": kind, "h": round(h, 1)},
                "geometry": {"type": "LineString", "coordinates": round2(ln)},
            })

def line_parts(geom):
    """Flatten any geometry into a list of coordinate rings/lines."""
    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return c
    if t == "Polygon":               # exterior ring only (holes aren't walls)
        return [c[0]] if c else []
    if t == "MultiPolygon":
        return [poly[0] for poly in c if poly]
    return []

feats = []
for path in (lines_p, mp_p):
    try:
        data = json.load(open(path))
    except Exception:
        continue
    for f in data.get("features", []):
        props = f.get("properties", {}) or {}
        kind = props.get("barrier") or props.get("man_made") or "wall"
        h = parse_h(props.get("other_tags")) or DEFAULT_H.get(kind, 2.0)
        emit(feats, kind, h, line_parts(f.get("geometry") or {}))

out = {
    "type": "FeatureCollection",
    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}},
    "features": feats,
}
json.dump(out, open(out_p, "w"))
from collections import Counter
ck = Counter(f["properties"]["kind"] for f in feats)
print(f"wrote {out_p}: {len(feats)} walls {dict(ck)}")
PY
