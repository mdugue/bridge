"""A city's landmarks: what Wikidata knows as a building or structure on the
tile, notable enough (at least `MIN_SITELINKS` Wikipedia articles, the most
notable `MAX_PER_TILE` of a tile), matched to what the viewer draws of it
(plan 038).

- `bun run fetch` asks Wikidata once per tile (`fetch_wikidata`) and caches
  the answer under `data/_raw/<provider>/wikidata/landmarks_<tile>.json`:
  id, German label, position, sitelinks, height (P2048), materials (P186)
  and whether it is a building. The bake never goes to the network.
- The bake (`run`) finds the LoD2 objects that are the landmark: those an
  OSM outline tagged `wikidata=<id>` covers by half, else, for a building,
  the LoD2 building under its point (its root and every part), or the
  nearest within `NEAR_M`. A landmark that matches nothing drawn — a
  district, a street, a harbour — is left out. Written:
  `data/<site>/dlm/landmarks_<tile>.json`, ranked by sitelinks, owned by
  the tile under the landmark's point.

The build marks the objects (`OBJECT_FLAG_LANDMARK`), gives them the
material Wikidata names where OSM names none, and lists the landmarks for
the HUD, which glides to them."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

import shapely
from pyproj import Transformer

from .common import OSM_ATTRIBUTION, Tile, column, owns
from .osm import has_extract, read_osm, tag
from .osm_buildings import MATERIALS, covered_by, footprints, root_of

SPARQL = "https://query.wikidata.org/sparql"
# A small town's landmarks have few Wikipedia articles (the Lindenbrauerei
# in Unna: a handful), a metropolis has dozens: a low floor, then the tile's
# most notable first and at most MAX_PER_TILE of them.
MIN_SITELINKS = 2
MAX_PER_TILE = 12
# How far from a building's point its LoD2 building is looked for (m).
NEAR_M = 25.0
QUERY = """
SELECT ?i ?label ?coord ?links (SAMPLE(?h) AS ?height)
       (GROUP_CONCAT(DISTINCT ?mat; separator="|") AS ?materials)
       (MAX(?b) AS ?building) WHERE {
  SERVICE wikibase:box {
    ?i wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(%(w)f %(s)f)"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(%(e)f %(n)f)"^^geo:wktLiteral .
  }
  ?i wikibase:sitelinks ?links . FILTER(?links >= %(min)d)
  ?i wdt:P31/wdt:P279* wd:Q811979 .
  OPTIONAL { ?i wdt:P31/wdt:P279* wd:Q41176 . BIND(1 AS ?b) }
  OPTIONAL { ?i wdt:P2048 ?h . }
  OPTIONAL { ?i wdt:P186 ?m . ?m rdfs:label ?mat . FILTER(LANG(?mat) = "en") }
  ?i rdfs:label ?label . FILTER(LANG(?label) = "de")
} GROUP BY ?i ?label ?coord ?links ORDER BY DESC(?links) LIMIT 80
"""
# Wikidata's material labels (en) → the clay's wall materials, in the order
# the one a facade shows wins (a glass hall on a brick warehouse: glass)
MATERIAL_ORDER = ("glass", "brick", "stone", "metal", "concrete", "wood", "plaster")


# A dense centre's box can time out at the endpoint (a 504 after 60 s):
# then the box is asked again in quarters, down to this depth.
MAX_SPLIT = 2


def query_box(lons: tuple[float, float], lats: tuple[float, float], depth: int = 0) -> list[dict]:
    """Wikidata's answer for a lon/lat box, quartered where it times out."""
    query = QUERY % {
        "w": lons[0],
        "s": lats[0],
        "e": lons[1],
        "n": lats[1],
        "min": MIN_SITELINKS,
    }
    req = urllib.request.Request(
        f"{SPARQL}?{urllib.parse.urlencode({'query': query})}",
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": "bridge-bake/0.1 (city walker; offline bake)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            return json.load(res)["results"]["bindings"]
    except OSError:
        if depth >= MAX_SPLIT:
            raise
    mx = (lons[0] + lons[1]) / 2
    my = (lats[0] + lats[1]) / 2
    rows = []
    for qx in ((lons[0], mx), (mx, lons[1])):
        for qy in ((lats[0], my), (my, lats[1])):
            rows += query_box(qx, qy, depth + 1)
    return rows


def fetch_wikidata(raw: Path, tile_id: str, bounds, epsg: int) -> None:
    """The landmarks Wikidata knows on a tile → `<raw>/wikidata/landmarks_<tile>.json`
    (fetch time only; the bake reads the file, never the network)."""
    dest = raw / "wikidata" / f"landmarks_{tile_id}.json"
    if dest.exists():
        return
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = bounds
    lons, lats = back.transform([xmin, xmax, xmin, xmax], [ymin, ymin, ymax, ymax])
    try:
        rows = query_box((min(lons), max(lons)), (min(lats), max(lats)))
    except OSError as err:
        print(f"{tile_id}: Wikidata landmarks not fetched ({err})")
        return
    items: dict[str, dict] = {}
    for r in rows:
        lon, lat = (float(v) for v in r["coord"]["value"][6:-1].split())
        height = r.get("height", {}).get("value")
        qid = r["i"]["value"].rsplit("/", 1)[-1]
        items.setdefault(
            qid,
            {
                "id": qid,
                "label": r["label"]["value"],
                "lon": lon,
                "lat": lat,
                "links": int(r["links"]["value"]),
                "building": "building" in r,
                "height": float(height) if height else None,
                "materials": sorted(
                    m for m in r.get("materials", {}).get("value", "").split("|") if m
                ),
            },
        )
    ranked = sorted(items.values(), key=lambda i: (-i["links"], i["id"]))
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {"source": "Wikidata (CC0)", "query": SPARQL, "landmarks": ranked}
    dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(f"{tile_id}: {len(ranked)} Wikidata landmarks → {dest}")


def load_wikidata(tile: Tile) -> list[dict]:
    """The fetched landmarks with their position in the tile's CRS."""
    path = tile.raw / "wikidata" / f"landmarks_{tile.id}.json"
    if not path.exists():
        return []
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    out = []
    for item in json.loads(path.read_text())["landmarks"]:
        x, y = to_tile.transform(item["lon"], item["lat"])
        out.append({**item, "x": x, "y": y})
    return out


def material_of(labels: list[str]) -> str | None:
    """The wall material a landmark's Wikidata materials read as."""
    found = {MATERIALS.get(label.lower().replace(" ", "_")) for label in labels}
    found |= {"concrete" for label in labels if "concrete" in label.lower()}
    return next((m for m in MATERIAL_ORDER if m in found), None)


# Only what is built: a district, a park or a harbour carries a `wikidata`
# tag as well, and its outline would cover a whole quarter of LoD2 objects.
TAGGED_WHERE = (
    "other_tags LIKE '%\"wikidata\"=>%' AND (building IS NOT NULL"
    " OR man_made IS NOT NULL OR other_tags LIKE '%\"building:part\"=>%')"
)


def tagged_outlines(tile: Tile) -> dict[str, list[shapely.Geometry]]:
    """OSM outlines (buildings, parts, structures) by their `wikidata` tag."""
    geoms, fields = read_osm(tile, "multipolygons", TAGGED_WHERE, ["other_tags"], margin=0.002)
    out: dict[str, list[shapely.Geometry]] = {}
    for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        qid = tag(other, "wikidata")
        if g is not None and qid:
            out.setdefault(qid, []).append(g)
    return out


def matched_objects(item, city, ids, polys, tree, outlines) -> list[str]:
    """The LoD2 objects that are this landmark (their ids, sorted)."""
    found: set[str] = set()
    for g in outlines.get(item["id"], []):
        found |= {ids[i] for i in covered_by([g], polys, tree)}
    if not found and item["building"]:
        point = shapely.Point(item["x"], item["y"])
        hits = list(tree.query(point, predicate="within"))
        if not hits:
            # Wikidata's point often falls in a courtyard or on the street
            # in front (the Lindenbrauerei's): the nearest building near it
            near = tree.query_nearest(point, max_distance=NEAR_M)
            hits = list(near[:1])
        for i in hits:
            root = root_of(city, ids[int(i)])
            found |= {oid for oid in ids if root_of(city, oid) == root}
    return sorted(found)


def object_heights(city: dict) -> dict[str, tuple[float, float]]:
    """Each object's (lowest, highest) absolute z."""
    sc = city["transform"]["scale"][2]
    tr = city["transform"]["translate"][2]
    zs = [v[2] * sc + tr for v in city["vertices"]]
    out: dict[str, tuple[float, float]] = {}

    def walk(b, acc):
        if isinstance(b, int):
            acc.append(zs[b])
        else:
            for c in b:
                walk(c, acc)

    for oid, obj in city["CityObjects"].items():
        acc: list[float] = []
        for g in obj.get("geometry", []):
            walk(g["boundaries"], acc)
        if acc:
            out[oid] = (min(acc), max(acc))
    return out


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"landmarks_{tile.id}.json")
    items = [i for i in load_wikidata(tile) if owns(tile.bounds, i["x"], i["y"])]
    if not tile.cityjson.exists() or not has_extract(tile, "the landmarks"):
        return
    city = json.loads(tile.cityjson.read_text())
    ids, polys = footprints(city)
    tree = shapely.STRtree(polys)
    outlines = tagged_outlines(tile)
    heights = object_heights(city)
    landmarks = []
    for item in items:
        if len(landmarks) >= MAX_PER_TILE:
            break
        objects = matched_objects(item, city, ids, polys, tree, outlines)
        if not objects:
            continue
        entry = {
            "id": item["id"],
            "name": item["label"],
            "x": round(item["x"], 1),
            "y": round(item["y"], 1),
            "links": item["links"],
            "objects": objects,
        }
        spans = [heights[o] for o in objects if o in heights]
        if spans:
            # the ground and the drawn top: where the HUD's vantage looks
            entry["z"] = round(min(lo for lo, _ in spans), 1)
            entry["h"] = round(max(hi for _, hi in spans) - entry["z"], 1)
        if item["height"]:
            # Wikidata's height (a spire LoD2 may cut short)
            entry["height"] = item["height"]
        material = material_of(item["materials"])
        if material:
            entry["material"] = material
        landmarks.append(entry)
    doc = {
        "attribution": f"Wikidata (CC0); {OSM_ATTRIBUTION}",
        "landmarks": landmarks,
    }
    out.write_text(json.dumps(doc, ensure_ascii=False))
    names = ", ".join(lm["name"] for lm in landmarks[:5])
    print(f"{tile.id}: {len(landmarks)} landmarks{': ' + names if names else ''}")
