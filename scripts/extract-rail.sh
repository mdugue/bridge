#!/usr/bin/env bash
#
# extract-rail.sh — bake railway tracks + bridge decks + ballast yards for one tile.
#
# MANUAL, one-off step (mirrors extract-canopy.sh / extract-lamps.sh). The railway
# corridor and bridges used to exist ONLY as a flat land-cover colour on the DGM —
# a brown smear, no tracks, bridges that sank into the Elbe. This bakes real
# geometry from authoritative LOCAL sources (Basis-DLM), OSM as enhancement:
#
#   - Ballast yards: Basis-DLM ver03_f (AX_Bahnverkehr AREA) — DISSOLVED into one
#     clean non-overlapping surface (replaces per-line ribbons that z-fought into
#     ragged edges; the dissolve needs spatialite ST_Union, available via GDAL).
#   - Rails:   Basis-DLM ver03_l (heavy rail, SPW=1000) — centrelines, with short
#     fragments snap-merged into continuous tracks. Carry track count + electrified.
#   - Bridges: Basis-DLM ver06_f (BWF=1800 AREA polygons) — one real deck footprint
#     per span (the parallel Marienbrücke rail + road decks are SEPARATE polygons,
#     which is what kills the "2-story" stacking). Per-ring deck Z from DGM abutments
#     lifted to the DOM deck surface; "kind" (rail/road/path) by rasterising the
#     networks and sampling along the ring; name joined from ver06_l (NAM).
#   - Platforms: OpenStreetMap railway=platform (ODbL) → station structure.
#
# Needs (all gitignored / already present): data/_raw/basis-dlm/…, the DOM1 + DGM1
# rasters, GDAL (with spatialite) on PATH, Python 3 + Pillow, curl (OSM platforms).
#
# Output (small, COMMITTED), always written even when empty:
#   data/dlm/railarea_<tile>_2_sn.geojson  Polygons (dissolved ballast yards)
#   data/dlm/rail_<tile>_2_sn.geojson      LineStrings {tracks, electrified}
#   data/dlm/bridge_<tile>_2_sn.geojson    Polygons {name, kind, deck[] per ring vtx}
#   data/dlm/platform_<tile>_2_sn.geojson  Polygons/LineStrings (OSM, ODbL)
#
# Usage:  bash scripts/extract-rail.sh [tile]      (default 33412_5656)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TILE="${1:-33412_5656}"
SUFFIX="2_sn"
SRC="$ROOT/data/_raw/basis-dlm/basisdlm_sn_shape"
DOM="$ROOT/data/_raw/dom1/dom1_${TILE}_${SUFFIX}_tiff/dom1_${TILE}_${SUFFIX}.tif"
DGM="$ROOT/data/dgm/dgm1_${TILE}_${SUFFIX}_tiff/dgm1_${TILE}_${SUFFIX}.tif"
OUTDIR="$ROOT/data/dlm"
RAWDIR="$ROOT/data/_raw/osm"

command -v ogr2ogr >/dev/null || { echo "error: GDAL not on PATH (brew install gdal)" >&2; exit 1; }
[ -d "$SRC" ] || { echo "error: raw DLM not found at $SRC" >&2; exit 1; }
for f in "$DOM" "$DGM"; do
  [ -f "$f" ] || { echo "error: missing raster $f" >&2; exit 1; }
done

E="${TILE%_*}"; E="${E#33}"
N="${TILE#*_}"
XMIN=$((E * 1000)); YMIN=$((N * 1000)); XMAX=$((XMIN + 2000)); YMAX=$((YMIN + 2000))

mkdir -p "$OUTDIR" "$RAWDIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
EMPTY='{"type":"FeatureCollection","crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::25833"}},"features":[]}'

echo "Tile $TILE  extent [$XMIN $YMIN $XMAX $YMAX]"

# --- 1. Ballast yards: ver03_f (AX_Bahnverkehr) DISSOLVED -> one clean surface --
# The raw area polygons OVERLAP inside yards (z-fight if drawn raw), so ST_Union
# them into non-overlapping parts, then clip to the tile so neighbour tiles abut
# seamlessly (no double-coverage at the border). explodecollections → Polygons.
RAILAREA="$OUTDIR/railarea_${TILE}_${SUFFIX}.geojson"
rm -f "$RAILAREA"
if [ -f "$SRC/ver03_f.shp" ]; then
  ogr2ogr -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
    -explodecollections -clipsrc "$XMIN" "$YMIN" "$XMAX" "$YMAX" \
    -dialect SQLITE \
    -sql "SELECT ST_Union(ST_MakeValid(geometry)) AS geom FROM ver03_f WHERE OBJART='42010'" \
    "$RAILAREA" "$SRC/ver03_f.shp" 2>/dev/null || true
fi
[ -s "$RAILAREA" ] || echo "$EMPTY" > "$RAILAREA"
echo "wrote $RAILAREA"

# --- 2. Rails: ver03_l heavy rail (SPW=1000), then snap-merge fragments ---------
# SPW=1000 = standard-gauge heavy rail; trams (SPW=3000/BKT=1201) run embedded in
# the street, not on ballast, so they are excluded. GLS = track count.
RAIL_RAW="$WORK/rail_raw.geojson"
rm -f "$RAIL_RAW"
if [ -f "$SRC/ver03_l.shp" ]; then
  ogr2ogr -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
    -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" -dialect SQLITE \
    -sql "SELECT CASE WHEN GLS='2000' THEN 2 WHEN GLS='3000' THEN 3 ELSE 1 END AS tracks,
                 CASE WHEN ELK='1000' THEN 1 ELSE 0 END AS electrified,
                 geometry
          FROM ver03_l WHERE SPW='1000'" \
    "$RAIL_RAW" "$SRC/ver03_l.shp" 2>/dev/null || true
fi
RAIL="$OUTDIR/rail_${TILE}_${SUFFIX}.geojson"
python3 - "$RAIL_RAW" "$RAIL" <<'PY' || echo "$EMPTY" > "$RAIL"
import json, sys
from collections import defaultdict
raw_p, out_p = sys.argv[1], sys.argv[2]
try:
    src = json.load(open(raw_p))
except Exception:
    src = {"features": []}

def key(p):  # 1 m snap so abutting fragment endpoints match
    return (round(p[0]), round(p[1]))

# Greedy endpoint-chain merge within each (tracks, electrified) group so the many
# short ATKIS stubs become continuous tracks (no "random" starts/ends).
def merge(lines):
    used = [False] * len(lines)
    ep = defaultdict(list)
    for i, ln in enumerate(lines):
        ep[key(ln[0])].append(i)
        ep[key(ln[-1])].append(i)
    out = []
    for i in range(len(lines)):
        if used[i]:
            continue
        used[i] = True
        chain = list(lines[i])
        for _ in range(2):  # extend tail, then head (reverse handles both ends)
            grew = True
            while grew:
                grew = False
                tail = key(chain[-1])
                for j in ep.get(tail, []):
                    if used[j]:
                        continue
                    seg = lines[j]
                    if key(seg[0]) == tail:
                        chain += seg[1:]
                    elif key(seg[-1]) == tail:
                        chain += list(reversed(seg))[1:]
                    else:
                        continue
                    used[j] = True
                    grew = True
                    break
            chain.reverse()  # flip and run the same loop on the other end
        out.append(chain)
    return out

groups = defaultdict(list)
for ft in src.get("features", []):
    g = ft.get("geometry") or {}
    if g.get("type") != "LineString":
        continue
    coords = [(c[0], c[1]) for c in g["coordinates"] if len(c) >= 2]
    if len(coords) >= 2:
        p = ft.get("properties") or {}
        groups[(p.get("tracks", 1), p.get("electrified", 0))].append(coords)

feats = []
for (tracks, electrified), lines in groups.items():
    for chain in merge(lines):
        feats.append({
            "type": "Feature",
            "properties": {"tracks": tracks, "electrified": electrified},
            "geometry": {"type": "LineString",
                         "coordinates": [[round(x, 2), round(y, 2)] for x, y in chain]},
        })
json.dump({"type": "FeatureCollection",
           "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}},
           "features": feats}, open(out_p, "w"))
print(f"wrote {out_p}: {len(feats)} rail lines (merged)")
PY

# --- 3. Rasterise rail/road/path networks (buffered) for bridge "kind" ---------
mask() { # out_tif  layer  buffer_m  [where]
  local out="$1" lyr="$2" buf="$3" where="${4:-}"
  [ -f "$SRC/$lyr.shp" ] || return 0
  local sql="SELECT ST_Buffer(geometry, $buf) AS geom FROM $lyr"
  [ -n "$where" ] && sql="SELECT ST_Buffer(geometry, $buf) AS geom FROM $lyr WHERE $where"
  ogr2ogr -f GPKG -nln m -nlt PROMOTE_TO_MULTI -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" \
    -dialect SQLITE -sql "$sql" "$WORK/$lyr.gpkg" "$SRC/$lyr.shp" 2>/dev/null || return 0
  gdal_rasterize -q -burn 1 -init 0 -ot Byte \
    -te "$XMIN" "$YMIN" "$XMAX" "$YMAX" -ts 2000 2000 \
    -l m "$WORK/$lyr.gpkg" "$out" 2>/dev/null || return 0
}
mask "$WORK/m_rail.tif" ver03_l 8 "SPW='1000'"   # heavy rail only (tram bridges → road)
mask "$WORK/m_road.tif" ver01_l 8
mask "$WORK/m_path.tif" ver02_l 5

# --- 4a. OSM bridge:structure (arch / beam / cable-stayed) for arch synthesis ---
# Basis-DLM carries no structure type, so tag each deck from OSM man_made=bridge
# (ODbL). Prefer a block-wide cache, else a per-tile cache, else fetch (mirrors);
# reproject to EPSG so the bridge step can match by centroid. Non-fatal → no tags.
OSMBR="$WORK/osmbr_epsg.geojson"
echo "$EMPTY" > "$OSMBR"
brvalid() { [ -s "$1" ] && python3 -c 'import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit(1)
sys.exit(0 if isinstance(d.get("elements"),list) and "remark" not in d else 1)' "$1" 2>/dev/null; }
BRSRC="$(ls "$RAWDIR"/bridges_block_*.json 2>/dev/null | head -1)"
if [ -z "${BRSRC:-}" ] || ! brvalid "$BRSRC"; then
  BRSRC="$RAWDIR/bridges_${TILE}_${SUFFIX}.json"
  if ! brvalid "$BRSRC" && command -v gdaltransform >/dev/null && command -v curl >/dev/null; then
    read -r bS bW bN bE < <(printf '%s %s\n%s %s\n%s %s\n%s %s\n' \
        "$XMIN" "$YMIN" "$XMAX" "$YMIN" "$XMIN" "$YMAX" "$XMAX" "$YMAX" \
      | gdaltransform -s_srs EPSG:25833 -t_srs EPSG:4326 | python3 -c '
import sys
lo=[]; la=[]
for ln in sys.stdin:
    p=ln.split()
    if len(p)>=2: lo.append(float(p[0])); la.append(float(p[1]))
m=0.001
print(min(la)-m, min(lo)-m, max(la)+m, max(lo)+m)')
    BRQ="[out:json][timeout:180];way[\"man_made\"=\"bridge\"]($bS,$bW,$bN,$bE);out geom;"
    for EP in "https://overpass-api.de/api/interpreter" \
              "https://overpass.kumi.systems/api/interpreter" \
              "https://overpass.private.coffee/api/interpreter"; do
      curl -s -m 180 -G "$EP" --data-urlencode "data=$BRQ" -o "$BRSRC" || true
      brvalid "$BRSRC" && break
      rm -f "$BRSRC"
    done
  fi
fi
if [ -n "${BRSRC:-}" ] && brvalid "$BRSRC"; then
  python3 - "$BRSRC" "$WORK/osmbr_wgs84.geojson" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
feats = []
for e in d.get("elements", []):
    t = e.get("tags", {})
    g = e.get("geometry")
    if e.get("type") != "way" or t.get("man_made") != "bridge" or not g or len(g) < 3:
        continue
    c = [[p["lon"], p["lat"]] for p in g]
    if c[0] != c[-1]:
        c.append(c[0])
    feats.append({"type": "Feature",
                  "properties": {"structure": t.get("bridge:structure") or ""},
                  "geometry": {"type": "Polygon", "coordinates": [c]}})
json.dump({"type": "FeatureCollection", "features": feats}, open(sys.argv[2], "w"))
PY
  ogr2ogr -q -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
    -s_srs EPSG:4326 -t_srs EPSG:25833 "$OSMBR" "$WORK/osmbr_wgs84.geojson" 2>/dev/null \
    || echo "$EMPTY" > "$OSMBR"
fi

# --- 4. Bridge DECKS: ver06_l centrelines (complete) + ver06_f footprints -------
# ver06_l carries ALL bridges (rail/road/path) + names; ver06_f has clean AREA
# footprints but ONLY for (mostly rail) major spans. So drive the set from the
# complete ver06_l, snap each to a ver06_f polygon footprint where one matches
# (real outline), else buffer the centreline by kind-width. One slab per deck.
BR_LINES="$WORK/bridge_lines.geojson"
if [ -f "$SRC/ver06_l.shp" ]; then
  ogr2ogr -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
    -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" -dialect SQLITE \
    -sql "SELECT NAM AS name, geometry FROM ver06_l WHERE BWF='1800'" \
    "$BR_LINES" "$SRC/ver06_l.shp" 2>/dev/null || true
fi
[ -f "$BR_LINES" ] || echo "$EMPTY" > "$BR_LINES"
BR_POLY="$WORK/bridge_poly.geojson"
if [ -f "$SRC/ver06_f.shp" ]; then
  ogr2ogr -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
    -spat "$XMIN" "$YMIN" "$XMAX" "$YMAX" -dialect SQLITE \
    -sql "SELECT geometry FROM ver06_f WHERE BWF='1800'" \
    "$BR_POLY" "$SRC/ver06_f.shp" 2>/dev/null || true
fi
[ -f "$BR_POLY" ] || echo "$EMPTY" > "$BR_POLY"

BRIDGE="$OUTDIR/bridge_${TILE}_${SUFFIX}.geojson"
python3 - "$BR_LINES" "$BR_POLY" "$DGM" "$DOM" "$WORK/m_rail.tif" "$WORK/m_road.tif" \
  "$WORK/m_path.tif" "$OSMBR" "$BRIDGE" "$XMIN" "$YMAX" <<'PY' || echo "$EMPTY" > "$BRIDGE"
import json, math, sys
from PIL import Image
(lines_p, poly_p, dgm_p, dom_p, rail_p, road_p, path_p, osmbr_p, out_p, xmin, ymax) = (
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6],
    sys.argv[7], sys.argv[8], sys.argv[9], float(sys.argv[10]), float(sys.argv[11]))
WIDTH = {"rail": 9.0, "road": 11.0, "path": 3.5, "other": 8.0}
SIZE = 2000
CAMBER = 0.012
dgm = list(Image.open(dgm_p).getdata())
dom = list(Image.open(dom_p).getdata())

def load_mask(p):
    try:
        return list(Image.open(p).convert("L").getdata())
    except Exception:
        return None
m_rail, m_road, m_path = load_mask(rail_p), load_mask(road_p), load_mask(path_p)

def px(x, y):
    return min(max(int(x - xmin), 0), SIZE - 1), min(max(int(ymax - y), 0), SIZE - 1)

def robust(arr, x, y, win):
    c, r = px(x, y)
    vals = []
    for dr in range(-win, win + 1):
        rr = min(max(r + dr, 0), SIZE - 1)
        for dc in range(-win, win + 1):
            cc = min(max(c + dc, 0), SIZE - 1)
            v = arr[rr * SIZE + cc]
            if v is not None and v > -1000:
                vals.append(v)
    if not vals:
        return None
    vals.sort()
    return vals[len(vals) // 2]

def endpoint_h(x, y):
    g = robust(dgm, x, y, 3)
    s = robust(dom, x, y, 2)
    if g is None:
        return s
    if s is None:
        return g
    return max(g, min(s, g + 25.0))  # cap DOM spikes (trees/wires on the bank)

def mask_hit(m, x, y):
    if m is None:
        return False
    c, r = px(x, y)
    return m[r * SIZE + c] > 0

def classify(pts):
    rail = road = path = 0
    for x, y in pts:
        if mask_hit(m_rail, x, y):
            rail += 1
        elif mask_hit(m_road, x, y):
            road += 1
        elif mask_hit(m_path, x, y):
            path += 1
    if rail >= road and rail >= path and rail > 0:
        return "rail"
    if road >= path and road > 0:
        return "road"
    if path > 0:
        return "path"
    return "other"

def deck_profile(ring):
    """Per-ring-vertex deck Z: an abutment-to-abutment ramp along the deck's long
    axis (the farthest-apart ring vertices) + a midspan camber — never dips into
    the river. Returns None if no valid ground anywhere under the deck."""
    uniq = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    a, b, bd = uniq[0], uniq[-1], -1.0
    for i in range(len(uniq)):
        for j in range(i + 1, len(uniq)):
            d = (uniq[i][0] - uniq[j][0]) ** 2 + (uniq[i][1] - uniq[j][1]) ** 2
            if d > bd:
                bd, a, b = d, uniq[i], uniq[j]
    h0, h1 = endpoint_h(*a), endpoint_h(*b)
    if h0 is None and h1 is None:
        # fall back to the median valid deck height over the whole ring
        hs = [h for h in (endpoint_h(x, y) for x, y in uniq) if h is not None]
        if not hs:
            return None
        hs.sort()
        h0 = h1 = hs[len(hs) // 2]
    h0 = h1 if h0 is None else h0
    h1 = h0 if h1 is None else h1
    ax, ay = b[0] - a[0], b[1] - a[1]
    L2 = ax * ax + ay * ay
    span = math.sqrt(L2)
    camber = min(span * CAMBER, 1.6)
    deck = []
    for x, y in ring:
        t = ((x - a[0]) * ax + (y - a[1]) * ay) / L2 if L2 > 0 else 0.0
        t = max(0.0, min(1.0, t))
        deck.append(round(h0 + (h1 - h0) * t + camber * math.sin(math.pi * t), 2))
    return deck

def classify_line(coords):
    """Kind from sampling the masks along the centreline (carries what the bridge
    actually carries, unlike the deck-edge ring of a road bridge)."""
    pts = []
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        pts.append(a)
        pts.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
    pts.append(coords[-1])
    return classify(pts)

def buffer_line(coords, half):
    """Offset a centreline to a deck polygon (left side + reversed right side)."""
    n = len(coords)
    left, right = [], []
    for i in range(n):
        a = coords[max(0, i - 1)]
        b = coords[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        left.append((coords[i][0] + nx * half, coords[i][1] + ny * half))
        right.append((coords[i][0] - nx * half, coords[i][1] - ny * half))
    return left + right[::-1]

# ver06_f deck footprints (real outlines; mostly the rail / major spans).
polys = []
for ft in json.load(open(poly_p)).get("features", []):
    g = ft.get("geometry") or {}
    if g.get("type") == "Polygon" and g.get("coordinates"):
        ring = [(c[0], c[1]) for c in g["coordinates"][0] if len(c) >= 2]
        if len(ring) >= 4:
            cx = sum(x for x, _ in ring) / len(ring)
            cy = sum(y for _, y in ring) / len(ring)
            polys.append([ring, cx, cy, False])

# OSM bridge:structure footprints (EPSG) → (cx, cy, structure) for nearest-match.
osm_struct = []
try:
    for ft in json.load(open(osmbr_p)).get("features", []):
        g = ft.get("geometry") or {}
        st = (ft.get("properties") or {}).get("structure") or ""
        if g.get("type") == "Polygon" and g.get("coordinates") and st:
            r = g["coordinates"][0]
            cx = sum(p[0] for p in r) / len(r)
            cy = sum(p[1] for p in r) / len(r)
            osm_struct.append((cx, cy, st))
except Exception:
    pass

def structure_at(cx, cy):
    best, bd = "", 60.0 ** 2  # nearest OSM bridge centroid within 60 m
    for ox, oy, st in osm_struct:
        d = (ox - cx) ** 2 + (oy - cy) ** 2
        if d < bd:
            bd, best = d, st
    return best

feats = []

def emit(ring, name, kind):
    deck = deck_profile(ring)
    if deck is None:
        return
    cx = sum(x for x, _ in ring) / len(ring)
    cy = sum(y for _, y in ring) / len(ring)
    feats.append({
        "type": "Feature",
        "properties": {"name": name, "kind": kind,
                       "structure": structure_at(cx, cy), "deck": deck},
        "geometry": {"type": "Polygon",
                     "coordinates": [[[round(x, 2), round(y, 2)] for x, y in ring]]},
    })

# Drive from the COMPLETE ver06_l centreline set: snap each to a footprint where
# one matches (real outline), else buffer it by kind-width. Names come straight
# from ver06_l, so road/path bridges (which often lack a ver06_f polygon) survive.
for ft in json.load(open(lines_p)).get("features", []):
    g = ft.get("geometry") or {}
    if g.get("type") != "LineString":
        continue
    coords = [(c[0], c[1]) for c in g["coordinates"] if len(c) >= 2]
    if len(coords) < 2:
        continue
    name = (ft.get("properties") or {}).get("name") or None
    kind = classify_line(coords)
    mx = sum(x for x, _ in coords) / len(coords)
    my = sum(y for _, y in coords) / len(coords)
    best, bd = -1, 50.0 ** 2  # match line midpoint to an unused footprint centroid
    for pi, p in enumerate(polys):
        if p[3]:
            continue
        d = (p[1] - mx) ** 2 + (p[2] - my) ** 2
        if d < bd:
            bd, best = d, pi
    if best >= 0:
        polys[best][3] = True
        emit(polys[best][0], name, kind)
    else:
        emit(buffer_line(coords, WIDTH[kind] / 2), name, kind)

# Footprints with no matching centreline (unnamed rail spans) — keep them too.
for p in polys:
    if not p[3]:
        emit(p[0], None, classify(p[0] + [(p[1], p[2])]))

json.dump({"type": "FeatureCollection",
           "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}},
           "features": feats}, open(out_p, "w"))
named = sum(1 for x in feats if x["properties"]["name"])
from collections import Counter
kinds = dict(Counter(x["properties"]["kind"] for x in feats))
print(f"wrote {out_p}: {len(feats)} bridge decks ({named} named) {kinds}")
PY

# --- 5. OSM platforms (station structure) — non-fatal, cached like lamps -------
# railway=platform (+ public_transport=platform) gives a station its shape; this
# is the OSM half of the blend (Basis-DLM has no platform geometry). ODbL.
PLAT="$OUTDIR/platform_${TILE}_${SUFFIX}.geojson"
RAW="$RAWDIR/platforms_${TILE}_${SUFFIX}.json"
emit_empty_platforms() { echo "$EMPTY" > "$PLAT"; }

if ! command -v gdaltransform >/dev/null || ! command -v curl >/dev/null; then
  echo "note: curl/gdaltransform absent — skipping OSM platforms"
  emit_empty_platforms
else
  read -r S W N_ E_ < <(printf '%s %s\n%s %s\n%s %s\n%s %s\n' \
      "$XMIN" "$YMIN" "$XMAX" "$YMIN" "$XMIN" "$YMAX" "$XMAX" "$YMAX" \
    | gdaltransform -s_srs EPSG:25833 -t_srs EPSG:4326 | python3 -c '
import sys
lo=[]; la=[]
for ln in sys.stdin:
    p=ln.split()
    if len(p)>=2: lo.append(float(p[0])); la.append(float(p[1]))
m=0.0005
print(min(la)-m, min(lo)-m, max(la)+m, max(lo)+m)')

  is_json() { [ -s "$1" ] && python3 -c 'import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit(1)
sys.exit(0 if isinstance(d.get("elements"),list) and "remark" not in d else 1)' "$1" 2>/dev/null; }

  if is_json "$RAW"; then
    echo "using cached $RAW"
  else
    # Overpass mirrors rotate: the main endpoint rate-limits bursts with an HTML
    # 429 page, so fall through a list until one returns valid JSON.
    Q="[out:json][timeout:180];(way[\"railway\"=\"platform\"]($S,$W,$N_,$E_);way[\"public_transport\"=\"platform\"][\"railway\"]($S,$W,$N_,$E_););out geom;"
    for EP in \
      "https://overpass-api.de/api/interpreter" \
      "https://overpass.kumi.systems/api/interpreter" \
      "https://overpass.private.coffee/api/interpreter"; do
      echo "fetching OSM platforms via Overpass ($EP) …"
      curl -s -m 180 -G "$EP" --data-urlencode "data=$Q" -o "$RAW" || true
      is_json "$RAW" && break
      rm -f "$RAW"
    done
  fi

  if is_json "$RAW"; then
    # Overpass `out geom` → WGS84 GeoJSON (closed way = Polygon, else LineString).
    python3 - "$RAW" "$WORK/plat_wgs84.geojson" <<'PY'
import json, sys
raw_p, out_p = sys.argv[1], sys.argv[2]
data = json.load(open(raw_p))
feats = []
for el in data.get("elements", []):
    g = el.get("geometry")
    if not g or len(g) < 2:
        continue
    coords = [[p["lon"], p["lat"]] for p in g]
    closed = coords[0] == coords[-1] and len(coords) >= 4
    feats.append({
        "type": "Feature", "properties": {},
        "geometry": ({"type": "Polygon", "coordinates": [coords]} if closed
                     else {"type": "LineString", "coordinates": coords}),
    })
json.dump({"type": "FeatureCollection", "features": feats}, open(out_p, "w"))
print(f"  {len(feats)} OSM platform ways")
PY
    ogr2ogr -q -f GeoJSON -lco RFC7946=NO -lco COORDINATE_PRECISION=2 \
      -s_srs EPSG:4326 -t_srs EPSG:25833 "$PLAT" "$WORK/plat_wgs84.geojson" 2>/dev/null \
      || emit_empty_platforms
    echo "wrote $PLAT"
  else
    rm -f "$RAW"
    echo "note: Overpass returned no usable platforms (rate-limited?) — writing empty"
    emit_empty_platforms
  fi
fi
