"""A city's landmarks: what Wikidata knows as a building or structure on the
tile, notable enough (at least `MIN_SITELINKS` Wikipedia articles and
`NOTABLE_SHARE` of the tile's most notable one's, at most `MAX_PER_TILE`),
matched to what the viewer draws of it
(plan 050).

- `bun run fetch` asks Wikidata once per tile (`fetch_wikidata`) and caches
  the answer under `data/_raw/<provider>/wikidata/landmarks_<tile>.json`:
  id, German label, position, sitelinks, height (P2048), materials (P186),
  whether it is a building, and whether it still stands (`fetch_status`:
  P576, the date it was dissolved or demolished, and P5816, its state of
  conservation) and whether it is a bridge (P31/P279* Q12280) — asked
  apart, so a cache from before them is completed by the next fetch. The
  bake never goes to the network.
- The bake (`run`) finds the LoD2 objects that are the landmark: those an
  OSM outline tagged `wikidata=<id>` covers by half, else, for a building,
  the LoD2 building under its point (its root and every part), or the
  nearest within `NEAR_M` — within `NAMED_NEAR_M` where OSM names that
  building alike (`same_name`). A building Wikidata knows as demolished
  (`gone`) is the landmark only where an OSM outline is tagged with it:
  Dresden's old town is full of churches, theatres and palaces that stood
  where another building stands now (the Alte Reformierte Kirche under the
  Neues Rathaus, the Gothic Frauenkirche under the new one, the Opernhaus
  am Zwinger), and its point found that one. A landmark that matches
  nothing drawn — a district, a street, a harbour — is left out. So is a
  bridge that is not a building (`is_bridge`): the rail layer draws and
  names it from the Basis-DLM, OSM and Wikidata's bridges, and the LoD2
  objects its outline covers are the ALKIS slabs the city mesh leaves out
  (`TRAFFIC_STRUCTURE`, lib/city/city-mesh.ts) or a weir under a
  footbridge — München's LoD2 carries every Isar bridge as such a slab.
  Those slabs are never matched to any landmark (`drawn_footprints`). Written:
  `data/<site>/dlm/landmarks_<tile>.json`, ranked by sitelinks, owned by
  the tile under the landmark's point.

The build marks the objects (`OBJECT_FLAG_LANDMARK`), gives them the
material Wikidata names where OSM names none, and lists the landmarks for
the HUD, which glides to them."""

from __future__ import annotations

import json
import re
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
# in Unna: a handful), a metropolis has dozens: a low floor, and a floor
# relative to the tile's most notable — so a dense old town keeps its
# second rank (Dresden's Congress Center beside the Frauenkirche, the Zwinger
# and the Semperoper) where a fixed count of 12 cut it — then the most
# notable first, at most MAX_PER_TILE (a safety cap, not the rule).
MIN_SITELINKS = 2
NOTABLE_SHARE = 0.08
MAX_PER_TILE = 40
# How far from a building's point its LoD2 building is looked for (m):
# beside it (Wikidata's point in a courtyard or on the street in front),
# and further where OSM names the building alike.
NEAR_M = 10.0
NAMED_NEAR_M = 25.0
# P5816 (state of conservation): demolished or destroyed; and the states
# of a building that stands although P576 dates its end (Dresden's
# Frauenkirche, destroyed 1945, is "restored"; a war-damaged church
# rebuilt carries P576 alone and is kept by its OSM outline).
DEMOLISHED = "Q56556915"
STANDING = {
    "Q56557591",  # preserved
    "Q75505084",  # restored
    "Q106379705",  # damaged
    "Q60539160",  # partially destroyed
}
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


def query_box(
    lons: tuple[float, float], lats: tuple[float, float], depth: int = 0, template: str = QUERY
) -> list[dict]:
    """Wikidata's answer for a lon/lat box, quartered where it times out
    (`template`: a query with the box's corners as `%(w)f` … `%(n)f`; the
    monuments bake asks its own)."""
    query = template % {
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
            rows += query_box(qx, qy, depth + 1, template)
    return rows


STATUS_QUERY = """
SELECT ?i (MIN(?end) AS ?dissolved) (GROUP_CONCAT(DISTINCT ?st; separator="|") AS ?states)
WHERE {
  VALUES ?i { %(ids)s }
  OPTIONAL { ?i wdt:P576 ?end . }
  OPTIONAL { ?i wdt:P5816 ?st . }
} GROUP BY ?i
"""
# its own query: the subclass walk is the slow part, and a timeout here must
# not cost the items their state
BRIDGE_QUERY = """
SELECT DISTINCT ?i WHERE {
  VALUES ?i { %(ids)s }
  ?i wdt:P31/wdt:P279* wd:Q12280 .
}
"""
STATUS_BATCH = 200


def _ask(query: str) -> list[dict]:
    req = urllib.request.Request(
        SPARQL,
        data=urllib.parse.urlencode({"query": query}).encode(),
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": "bridge-bake/0.1 (city walker; offline bake)",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as res:
        return json.load(res)["results"]["bindings"]


def fetch_status(ids: list[str]) -> dict[str, dict]:
    """Whether each item still stands, as Wikidata states it: `dissolved`
    (P576, the earliest date, or None) and `states` (P5816's items); and
    `bridge`, whether it is one (an instance of a subclass of Q12280)."""
    out: dict[str, dict] = {}
    for k in range(0, len(ids), STATUS_BATCH):
        batch = ids[k : k + STATUS_BATCH]
        values = " ".join(f"wd:{i}" for i in batch)
        bridges = _bridges(values)
        for r in _ask(STATUS_QUERY % {"ids": values}):
            qid = r["i"]["value"].rsplit("/", 1)[-1]
            end = r.get("dissolved", {}).get("value")
            states = r.get("states", {}).get("value", "")
            out[qid] = {
                # a date, or a blank node where Wikidata knows only that it ended
                "dissolved": (end[:10] if end[:4].isdigit() else "unknown") if end else None,
                "states": sorted(s.rsplit("/", 1)[-1] for s in states.split("|") if s),
            }
            if bridges is not None:
                out[qid]["bridge"] = qid in bridges
    return out


def _bridges(values: str) -> set[str] | None:
    """The bridges among a batch, or None when Wikidata did not answer: the
    items then carry no `bridge` member, and the next fetch asks again."""
    try:
        rows = _ask(BRIDGE_QUERY % {"ids": values})
    except (OSError, ValueError, KeyError) as e:
        print(f"Wikidata bridge query failed ({e}); fetch again to complete it")
        return None
    return {r["i"]["value"].rsplit("/", 1)[-1] for r in rows}


def _with_status(items: list[dict]) -> list[dict]:
    status = fetch_status([i["id"] for i in items])
    unknown = {"dissolved": None, "states": []}
    return [{**i, **status.get(i["id"], unknown)} for i in items]


def _write(dest: Path, ranked: list[dict]) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {"source": "Wikidata (CC0)", "query": SPARQL, "landmarks": ranked}
    # through a `.part` file: a run killed mid-write leaves no truncated
    # cache that every later fetch would keep
    part = dest.with_name(dest.name + ".part")
    part.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    part.replace(dest)


def complete_status(dest: Path) -> bool:
    """Adds `fetch_status` to a cache fetched before it (or before its
    `bridge` member); True when it did."""
    doc = json.loads(dest.read_text())
    items = doc.get("landmarks", [])
    if all("states" in i and "bridge" in i for i in items):
        return False
    _write(dest, _with_status(items))
    return True


def fetch_wikidata(raw: Path, tile_id: str, bounds, epsg: int) -> None:
    """The landmarks Wikidata knows on a tile → `<raw>/wikidata/landmarks_<tile>.json`
    (fetch time only; the bake reads the file, never the network). A cache
    from before `fetch_status` gets it added."""
    dest = raw / "wikidata" / f"landmarks_{tile_id}.json"
    if dest.exists():
        if complete_status(dest):
            print(f"{tile_id}: Wikidata landmarks' state of conservation → {dest}")
        return
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = bounds
    lons, lats = back.transform([xmin, xmax, xmin, xmax], [ymin, ymin, ymax, ymax])
    try:
        rows = query_box((min(lons), max(lons)), (min(lats), max(lats)))
    except (OSError, ValueError, KeyError) as err:
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
    try:
        ranked = _with_status(ranked)
    except (OSError, ValueError, KeyError) as err:
        # written without: the next fetch completes it (complete_status)
        print(f"{tile_id}: Wikidata landmarks' state of conservation not fetched ({err})")
    _write(dest, ranked)
    print(f"{tile_id}: {len(ranked)} Wikidata landmarks → {dest}")


def load_wikidata(tile: Tile) -> list[dict]:
    """The fetched landmarks with their position in the tile's CRS."""
    path = tile.raw / "wikidata" / f"landmarks_{tile.id}.json"
    if not path.exists():
        return []
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    out = []
    try:
        doc = json.loads(path.read_text())
    except ValueError as err:
        path.unlink()
        raise OSError(f"{path}: not JSON — deleted; run bun run fetch again") from err
    for item in doc["landmarks"]:
        x, y = to_tile.transform(item["lon"], item["lat"])
        out.append({**item, "x": x, "y": y})
    return out


def gone(item: dict) -> bool | None:
    """Whether Wikidata knows the item as demolished or destroyed: P5816
    says so, or P576 dates its end and no state says it stands. None for a
    cache fetched before the state was (`complete_status`)."""
    if "states" not in item:
        return None
    states = set(item["states"])
    if DEMOLISHED in states:
        return True
    return bool(item.get("dissolved")) and not states & STANDING


def is_bridge(item: dict) -> bool:
    """A bridge that is not a building: the rail layer's, never a landmark
    (a bridge house or a covered landing stage Wikidata knows as a building
    stays one)."""
    return bool(item.get("bridge")) and not item["building"]


# ALKIS "Bauwerk im Verkehrsbereich": the bridge slabs the city mesh leaves
# out (`isTrafficStructure`, lib/city/city-mesh.ts).
TRAFFIC_STRUCTURE = "53001_"


def drawn_footprints(city: dict) -> tuple[list[str], list[shapely.Geometry]]:
    """`footprints` of the objects the city mesh draws: without the traffic
    structures and their parts."""
    objects = city["CityObjects"]
    left_out = {
        oid
        for oid, o in objects.items()
        if str((o.get("attributes") or {}).get("function", "")).startswith(TRAFFIC_STRUCTURE)
    }
    left_out |= {c for oid in left_out for c in objects[oid].get("children") or []}
    ids, polys = footprints(city)
    kept = [(i, p) for i, p in zip(ids, polys, strict=True) if i not in left_out]
    return [i for i, _ in kept], [p for _, p in kept]


# Words that name a kind of building, not this one: "Altes Rathaus" is not
# the "Neues Rathaus", the "Reformierte Kirche" not every church.
GENERIC_WORDS = {
    "alte", "alter", "altes", "neue", "neuer", "neues", "ehemalige", "ehemaliges",
    "kirche", "haus", "rathaus", "schloss", "palais", "theater", "synagoge",
    "villa", "kaserne", "bahnhof", "brücke", "turm", "museum", "schule", "halle",
    "kapelle", "dresden", "leipzig", "hamburg", "münchen", "meißen", "grimma",
    "unna", "berlin",
}  # fmt: skip


def _words(name: str) -> set[str]:
    bare = re.sub(r"\(.*?\)", " ", name.lower())
    return {w for w in re.split(r"[\s\-–.,’'/]+", bare) if len(w) >= 4} - GENERIC_WORDS


def same_name(label: str | None, name: str | None) -> bool:
    """Whether OSM's name for a building names the landmark: they share a
    word that is not a kind of building ("Lindenbrauerei" and
    "Kulturzentrum Lindenbrauerei")."""
    return bool(label and name and _words(label) & _words(name))


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


def matched_objects(item, city, ids, polys, tree, outlines, names=None) -> list[str]:
    """The LoD2 objects that are this landmark (their ids, sorted). `names`:
    OSM's name per LoD2 object (osm_buildings.py), for a point
    beside its building."""
    found: set[str] = set()
    for g in outlines.get(item["id"], []):
        found |= {ids[i] for i in covered_by([g], polys, tree)}
    if not found and item["building"] and not gone(item):
        point = shapely.Point(item["x"], item["y"])
        hits = list(tree.query(point, predicate="within"))
        if not hits:
            hits = _beside(item, point, city, ids, polys, tree, names or {})
        for i in hits:
            root = root_of(city, ids[int(i)])
            found |= {oid for oid in ids if root_of(city, oid) == root}
    return sorted(found)


def _beside(item, point, city, ids, polys, tree, names) -> list[int]:
    """Wikidata's point often falls in a courtyard or on the street in front
    (the Lindenbrauerei's): the nearest building within NEAR_M, else the
    nearest within NAMED_NEAR_M that OSM names alike (any object of its
    building tree)."""
    near = tree.query(point, predicate="dwithin", distance=NAMED_NEAR_M)
    for d, i in sorted((shapely.distance(point, polys[int(i)]), int(i)) for i in near):
        if d <= NEAR_M:
            return [int(i)]
        root = root_of(city, ids[int(i)])
        tree_names = (names.get(o) for o in ids if root_of(city, o) == root)
        if any(same_name(item["label"], n) for n in tree_names):
            return [int(i)]
    return []


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


def osm_names(tile: Tile) -> dict[str, str]:
    """OSM's name per LoD2 object, as the osm-buildings step wrote it."""
    path = tile.out("dlm", f"osmbuild_{tile.id}.json")
    if not path.exists():
        return {}
    objects = json.loads(path.read_text()).get("objects", {})
    return {oid: o["name"] for oid, o in objects.items() if o.get("name")}


def notable_floor(items: list[dict]) -> float:
    """The sitelinks a landmark needs on its tile: `NOTABLE_SHARE` of the
    most notable one's, never below `MIN_SITELINKS`."""
    top = max((i["links"] for i in items), default=0)
    return max(MIN_SITELINKS, NOTABLE_SHARE * top)


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"landmarks_{tile.id}.json")
    items = sorted(
        (i for i in load_wikidata(tile) if owns(tile.bounds, i["x"], i["y"])),
        key=lambda i: -i["links"],
    )
    if not tile.cityjson.exists() or not has_extract(tile, "the landmarks"):
        return
    city = json.loads(tile.cityjson.read_text())
    ids, polys = drawn_footprints(city)
    tree = shapely.STRtree(polys)
    outlines = tagged_outlines(tile)
    heights = object_heights(city)
    names = osm_names(tile)
    if any(gone(i) is None or "bridge" not in i for i in items):
        print(f"{tile.id}: Wikidata cache lacks state or bridges — run bun run fetch")
    landmarks = []
    floor = notable_floor(items)
    for item in items:
        if len(landmarks) >= MAX_PER_TILE or item["links"] < floor:
            break
        if is_bridge(item):
            continue
        objects = matched_objects(item, city, ids, polys, tree, outlines, names)
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
