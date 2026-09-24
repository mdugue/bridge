#!/usr/bin/env bash
#
# extract-trees.sh — bake the Dresden street-tree cadastre (Stadtbaumkataster)
# for one tile into a compact per-tree GeoJSON.
#
# MANUAL, one-off step (mirrors extract-lamps.sh). Source: the city's WFS 2.0,
# feature type cls:L1261 "Stadtbäume" — street trees, parks, schools and other
# municipal land (NOT the Großer Garten, NOT private courtyards). Licence
# dl-de/by-2-0, credit "Landeshauptstadt Dresden"; the derived file carries an
# "attribution" member. EPSG:25833 like everything else here.
#
# Needs: curl, Python 3 (stdlib only; the taxonomy is scripts/tree_archetypes.py).
#
# Pipeline:
#   1. fetch the tile's bbox (+10 m, so a tree on the seam lands in both
#      requests) ONCE as GeoJSON, caching the raw response (gitignored) and a
#      sidecar with the request, the date and the server's numberMatched. The
#      service implements no paging and no count default, so one request
#      returns every tree; the cache is only trusted when its feature count
#      equals numberMatched.
#   2. keep the trees whose gis_x_utm/gis_y_utm (= the geometry, verified to
#      µm) fall in [xmin, xmax) x [ymin, ymax) — each tree in exactly one tile.
#   3. taxon -> archetype / leaf type / foliage colour (tree_archetypes.py);
#      missing height / crown diameter imputed from the genus median height
#      and the archetype's median crown-to-height ratio (this tile's trees).
#
# Output (small, COMMITTED): data/dlm/trees_<tile>_2_sn.geojson — points with
#   h  tree height (m)          d  crown diameter (m)
#   a  archetype id (0 round, 1 oval, 2 columnar, 3 conifer, 4 weeping, 5 small)
#   l  leaf type ("e" evergreen, "d" deciduous)
#   c  foliage colour (0 green, 1 purple, 2 golden)   g  1 = globe cultivar
#   f  1 = stands in DLM forest/copse (class 2/3 of the committed class raster
#      data/dlm/landcover_<tile>.png, extract-dlm.sh): the viewer does not let
#      such a tree veto the canopy trees around it (a park's measured canopy
#      is denser than the municipal register — see docs/transformations.md)
#
# Usage:  bash scripts/extract-trees.sh [tile]      (default 33412_5656)
#   TREES_RAW_DIR overrides the raw cache (default data/_raw/baumkataster).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
OUTDIR="$ROOT/data/dlm"
RAWDIR="${TREES_RAW_DIR:-$ROOT/data/_raw/baumkataster}"
WFS="https://kommisdd.dresden.de/net3/public/ogcsl.ashx"
MARGIN=10

command -v curl >/dev/null || { echo "error: curl not on PATH" >&2; exit 1; }

E="${TILE%_*}"
E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000))
YMIN=$((N * 1000))
XMAX=$((XMIN + 2000))
YMAX=$((YMIN + 2000))
BBOX="$((XMIN - MARGIN)),$((YMIN - MARGIN)),$((XMAX + MARGIN)),$((YMAX + MARGIN)),urn:ogc:def:crs:EPSG::25833"

mkdir -p "$RAWDIR" "$OUTDIR"
RAW="$RAWDIR/stadtbaum_${TILE}_${SUFFIX}.geojson"
META="$RAWDIR/stadtbaum_${TILE}_${SUFFIX}.meta.json"

wfs() {
  curl -sS -m 300 -G "$WFS" \
    --data-urlencode "NODEID=1633" --data-urlencode "Service=WFS" \
    --data-urlencode "Version=2.0.0" --data-urlencode "Request=GetFeature" \
    --data-urlencode "TypeNames=cls:L1261" --data-urlencode "BBOX=$BBOX" "$@"
}

# Valid = parses, is a FeatureCollection, and holds exactly the sidecar's
# numberMatched features (a truncated body or an error page fails this).
is_complete() {
  [ -s "$RAW" ] && [ -s "$META" ] && python3 - "$RAW" "$META" <<'PY' 2>/dev/null
import json, sys
try:
    doc = json.load(open(sys.argv[1]))
    meta = json.load(open(sys.argv[2]))
except Exception:
    sys.exit(1)
feats = doc.get("features")
sys.exit(0 if isinstance(feats, list) and len(feats) == meta.get("numberMatched") else 1)
PY
}

if is_complete; then
  echo "using cached $RAW"
else
  echo "fetching the Stadtbaumkataster for $TILE (bbox $BBOX) …"
  MATCHED="$(wfs --data-urlencode "resultType=hits" | python3 -c '
import re, sys
m = re.search(r"numberMatched=\"(\d+)\"", sys.stdin.read())
print(m.group(1) if m else "")')"
  [ -n "$MATCHED" ] || { echo "error: WFS hits request failed" >&2; exit 2; }
  wfs --data-urlencode "outputFormat=application/geo+json" -o "$RAW"
  python3 - "$META" "$WFS" "$BBOX" "$MATCHED" <<'PY'
import datetime, json, sys
meta_p, wfs, bbox, matched = sys.argv[1:5]
json.dump({
    "service": wfs + "?NODEID=1633&Service=WFS",
    "typeName": "cls:L1261",
    "bbox": bbox,
    "outputFormat": "application/geo+json",
    "numberMatched": int(matched),
    "retrieved": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "licence": "dl-de/by-2-0, Landeshauptstadt Dresden",
}, open(meta_p, "w"), indent=2)
PY
  if ! is_complete; then
    echo "error: the WFS response is not a complete FeatureCollection ($MATCHED expected)" >&2
    rm -f "$RAW"
    exit 2
  fi
fi

OUT="$OUTDIR/trees_${TILE}_${SUFFIX}.geojson"
LANDCOVER="$OUTDIR/landcover_${TILE}_${SUFFIX}.png"
[ -f "$LANDCOVER" ] || { echo "error: $LANDCOVER missing (run extract-dlm.sh first)" >&2; exit 1; }
python3 - "$ROOT/scripts" "$RAW" "$OUT" "$XMIN" "$YMIN" "$XMAX" "$YMAX" "$LANDCOVER" <<'PY'
import json, statistics, sys
from PIL import Image
sys.path.insert(0, sys.argv[1])
import tree_archetypes as ta

raw_p, out_p = sys.argv[2], sys.argv[3]
xmin, ymin, xmax, ymax = (float(v) for v in sys.argv[4:8])
# DLM class raster (row 0 = north): 2 forest, 3 copse — see extract-dlm.sh.
landcover = Image.open(sys.argv[8])
lc_w, lc_h = landcover.size
lc_px = landcover.load()
WOODLAND = {2, 3}


def woodland(x, y):
    c = min(lc_w - 1, int((x - xmin) / (xmax - xmin) * lc_w))
    r = min(lc_h - 1, int((ymax - y) / (ymax - ymin) * lc_h))
    return lc_px[c, r] in WOODLAND
H_MIN, H_MAX, D_MIN, D_MAX = 1.5, 40.0, 0.8, 30.0


def num(v):
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


trees = []
for f in json.load(open(raw_p))["features"]:
    p = f.get("properties") or {}
    x, y = p.get("gis_x_utm"), p.get("gis_y_utm")
    if x is None or y is None or not (xmin <= x < xmax and ymin <= y < ymax):
        continue
    if (p.get("art_botanisch") or "").strip() == "Stammstück":
        continue  # a trunk stump, not a tree
    c = ta.classify(p.get("art_botanisch") or "", p.get("art_deutsch") or "")
    trees.append({"x": x, "y": y, "h": num(p.get("baumhoehe_akt")),
                  "d": num(p.get("kronendurchmesser_akt")), **c})

# Imputation tables from this tile's own measured trees.
by_genus, ratio = {}, {}
for t in trees:
    if t["h"]:
        by_genus.setdefault(t["genus"], []).append(t["h"])
    if t["h"] and t["d"]:
        ratio.setdefault(t["archetype"], []).append(t["d"] / t["h"])
genus_h = {g: statistics.median(v) for g, v in by_genus.items() if len(v) >= 3}
all_h = statistics.median([t["h"] for t in trees if t["h"]] or [8.0])
arch_r = {a: statistics.median(v) for a, v in ratio.items() if v}
imputed_h = imputed_d = 0
feats = []
for t in trees:
    r = arch_r.get(t["archetype"], 0.55)
    h, d = t["h"], t["d"]
    if h is None:
        h = d / r if d else genus_h.get(t["genus"], all_h)
        imputed_h += 1
    if d is None:
        d = h * r
        imputed_d += 1
    h = min(max(h, H_MIN), H_MAX)
    d = min(max(d, D_MIN), D_MAX, max(1.6 * h, 3.0))
    props = {"h": round(h, 1), "d": round(d, 1), "a": t["archetype"], "l": t["leaf"]}
    if t["foliage"]:
        props["c"] = t["foliage"]
    if t["globe"]:
        props["g"] = 1
    if woodland(t["x"], t["y"]):
        props["f"] = 1
    feats.append({
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [round(t["x"], 1), round(t["y"], 1)]},
    })
geo = {
    "type": "FeatureCollection",
    "attribution": "Stadtbaumkataster © Landeshauptstadt Dresden (dl-de/by-2-0)",
    "archetypes": ta.ARCHETYPES,
    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}},
    "features": feats,
}
with open(out_p, "w") as f:
    json.dump(geo, f, separators=(",", ":"))
print(f"wrote {out_p}: {len(feats)} trees "
      f"({imputed_h} heights, {imputed_d} crown diameters imputed)")
PY
