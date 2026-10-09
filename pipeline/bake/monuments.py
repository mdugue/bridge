"""Fountains, statues, memorial stones and columns → one point/footprint
layer per tile.

The official source is the Basis-DLM: `sie03_p` carries AX_SonstigesBauwerk-
OderSonstigeEinrichtung (51009) points with the Bauwerksfunktion 1750
(Denkmal, Standbild, Gedenkstein), 1770 (Säule, Stein) and 1780 (Brunnen),
each with its official name. The DLM does not say which monument is a
fountain, nor how large a basin is, and it carries only the named, notable
ones. So OSM's `amenity=fountain` (points and basin outlines, ODbL) fills in:

- a DLM monument on or next to an OSM fountain is that fountain (the
  Albertplatz's "Stilles Wasser" and "Stürmische Wogen" are DLM Denkmäler)
  and keeps its official name; the fountain carries a figure;
- a DLM monument whose name says fountain (…brunnen, Tränke) is one even
  without an OSM partner (a round basin of the default size);
- every other OSM fountain is added as it is: the DLM does not know it.

The DLM says *that* a monument stands somewhere, not what it is: its
Denkmal, Standbild and Gedenkstein share one code. OSM's memorial and
artwork tags (`memorial=bust`, `artwork_type=statue`, …) say which, and
often who made it and of what: a DLM monument within `TYPE_M` of an OSM
memorial or artwork takes its `form` (a statue on its pedestal, a bust,
a free sculpture, a stele, a stone, an obelisk; a plaque hangs on a wall),
its `height` when tagged, its `artist` and `material`. A free-standing
OSM sculpture or memorial the DLM lacks (most of a city's park
sculptures) is added; one inside a LoD2 footprint is indoors or on a
facade, and is left out.

Where OSM names no material, Wikidata may (`P186`, "made from material"):
the Goldener Reiter is copper under gold leaf, the Bismarck-Denkmal bronze
on granite. The fetch caches the monuments, sculptures and memorials it
knows on the tile (`fetch_wikidata`, never a Stolperstein); a monument
without a material takes the item of its name within `WIKIDATA_NAME_M`,
else the nearest within `WIKIDATA_NEAR_M`, and keeps its id (`wikidata`)
as the material's source.

A basin outline is written as a Polygon ring — the rim, its hole the water
(the outline inset by the rim width); a basin too small to inset is a solid
bowl. Everything else is a Point.

What a monument or a fountain's sculpture *looks* like is in no register,
but its bulk is measured: the DOM1 surface model minus the DGM1 terrain
(the same nDOM the canopy bake reads) shows the sculpture groups of the
Albertplatz fountains as ~4 × 5 m bodies 3.7 m tall, the Goldener Reiter
as 7 m. Where that body stands clear — one connected patch, not merging
into a tree crown or a facade — it is written as `relief`: the patch's
heights above ground on the 1 m grid, which the viewer smooths into a
clay form. A monument too small for a 1 m grid, or lost under a tree, has
none (the viewer draws a marker). Each tile writes only what it owns
(its representative point; west/south edges in, lib/city/tileset.ts
`ownsPoint`), so a fountain on a seam stands once."""

from __future__ import annotations

import json
import re
from collections import deque
from pathlib import Path

import numpy as np
import rasterio
import shapely
from pyproj import Transformer

from .common import (
    OSM_ATTRIBUTION,
    Tile,
    column,
    feature,
    geometry_json,
    owns,
    read_layer,
    write_geojson,
)
from .landmarks import query_box
from .osm import below_ground, has_extract, read_osm, tag
from .osm_buildings import footprints

# Bauwerksfunktion of AX_SonstigesBauwerkOderSonstigeEinrichtung (51009).
MONUMENT, COLUMN_OR_STONE, FOUNTAIN = "1750", "1770", "1780"
FOUNTAIN_NAME = re.compile(r"brunnen|tränke|fontäne|wasserspiel", re.IGNORECASE)
COLUMN_NAME = re.compile(r"säule|obelisk", re.IGNORECASE)
STONE_NAME = re.compile(r"stein|stele", re.IGNORECASE)
# A DLM point this close to an OSM fountain (m; 0 inside a basin) is it.
MATCH_M = 6.0
RIM_M = 0.35  # the basin rim's width (m)
MIN_BASIN_M2 = 1.0  # smaller outlines are a spout, drawn as a point fountain
SEAM_M = 50.0  # read margin around the tile (m)
# The relief: nDOM cells taller than this belong to a sculpture (m).
RELIEF_MIN_H = 0.7
RELIEF_MAX_H = 8.5  # taller: a leafless crown reads the same; drop it
RELIEF_MAX_M2 = 60  # cells; larger patches are canopy or buildings
SEED_M = 2.5  # the tallest cell this close to a monument point seeds it
REACH_M = 6  # a monument's patch must end within this radius
# A DLM monument this close to an OSM memorial or artwork (m) is it: the two
# place one object a few metres apart (the DLM at its centre, OSM often at
# its plinth's front).
TYPE_M = 15.0
DUPLICATE_M = 3.0  # two OSM nodes this close are one object, mapped twice
# OSM's `memorial=*` and `artwork_type=*` → the marker's form. A plaque, a
# painting or a mural hangs on a wall: it is a form, but nothing free-standing.
OSM_FORM = {
    "statue": "statue",
    "bust": "bust",
    "sculpture": "sculpture",
    "installation": "sculpture",
    "stele": "stele",
    "relief": "stele",
    "stone": "stone",
    "obelisk": "obelisk",
    "plaque": "plaque",
    "blue_plaque": "plaque",
    "painting": "plaque",
    "mural": "plaque",
    "graffiti": "plaque",
    "street_art": "plaque",
}
# The DLM kind (the viewer's fallback and the card's kicker) of a form.
FORM_KIND = {
    "statue": "statue",
    "bust": "statue",
    "sculpture": "statue",
    "stele": "stone",
    "stone": "stone",
    "obelisk": "column",
}
MATERIALS = {
    "bronze": "Bronze",
    "copper": "Kupfer",
    "brass": "Messing",
    "metal": "Metall",
    "steel": "Stahl",
    "stainless_steel": "Edelstahl",
    "iron": "Eisen",
    "cast_iron": "Gusseisen",
    "stone": "Stein",
    "sandstone": "Sandstein",
    "granite": "Granit",
    "marble": "Marmor",
    "limestone": "Kalkstein",
    "porphyry": "Porphyr",
    "concrete": "Beton",
    "wood": "Holz",
    "glass": "Glas",
    "plastic": "Kunststoff",
    "ceramic": "Keramik",
    "brick": "Ziegel",
    "gold": "Gold",
    "gold_leaf": "Blattgold",
    "porcelain": "Porzellan",
    "diabase": "Diabas",
}


def dlm_kind(bwf: str | None, name: str | None) -> str:
    """What a DLM monument point is, before any OSM fountain claims it."""
    label = name or ""
    if bwf == FOUNTAIN or FOUNTAIN_NAME.search(label):
        return "fountain"
    if COLUMN_NAME.search(label):
        return "column"
    if bwf == COLUMN_OR_STONE or STONE_NAME.search(label):
        return "stone"
    return "statue"


def osm_form(other_tags: str | None) -> str | None:
    """What an OSM memorial or artwork is, as a marker form, or None when the
    tags do not say (a `war_memorial`, a bare `historic=monument`)."""
    for key in ("memorial", "artwork_type"):
        form = OSM_FORM.get((tag(other_tags, key) or "").strip().lower())
        if form:
            return form
    return None


def osm_height(other_tags: str | None) -> float | None:
    """A tagged `height` (m) within what a monument can be, or None."""
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*m?\s*$", tag(other_tags, "height") or "")
    if not m:
        return None
    h = float(m.group(1).replace(",", "."))
    return h if 0.3 <= h <= 40 else None


def osm_material(other_tags: str | None) -> str | None:
    """The tagged material(s) in German, known ones only ("Bronze, Granit")."""
    names = [
        MATERIALS[v.strip().lower()]
        for v in (tag(other_tags, "material") or "").split(";")
        if v.strip().lower() in MATERIALS
    ]
    return ", ".join(dict.fromkeys(names)) or None


def largest_part(geom: shapely.Geometry) -> shapely.Geometry:
    """A MultiPolygon's largest polygon (GDAL's OSM driver writes every area
    as one); anything else as it is."""
    if geom.geom_type == "MultiPolygon":
        return max(geom.geoms, key=lambda g: g.area)
    return geom


def basin_geometry(geom: shapely.Geometry) -> shapely.Geometry:
    """An OSM fountain's footprint as the rim polygon: the outline with the
    water, the outline inset by the rim, as its hole. A point, or a basin too
    small to have one, stays what it is (the viewer gives it a bowl)."""
    geom = largest_part(geom)
    if geom.geom_type == "Point":
        return geom
    if geom.geom_type != "Polygon" or geom.area < MIN_BASIN_M2:
        return geom.representative_point()
    outer = shapely.Polygon(geom.exterior).simplify(0.1)
    water = outer.buffer(-RIM_M, join_style="mitre")
    if water.is_empty:
        return outer
    water = largest_part(water)
    return shapely.Polygon(outer.exterior, [water.exterior])


def classify_fountain(fountain: str | None, water: str | None) -> str:
    """OSM's fountain/water sub-tag → how the viewer dresses the basin:
    a splash pad has jets on flush paving, a reflecting pool none."""
    if fountain == "splash_pad":
        return "splash"
    if water == "reflecting_pool":
        return "pool"
    return "basin"


def _dlm_points(tile: Tile) -> list[dict]:
    # A margin, so a monument across a seam still claims its OSM fountain
    # (the owner test below keeps each once).
    xmin, ymin, xmax, ymax = tile.bounds
    geoms, fields = read_layer(
        tile.dlm / "sie03_p.shp",
        (xmin - SEAM_M, ymin - SEAM_M, xmax + SEAM_M, ymax + SEAM_M),
        where=f"OBJART = '51009' AND BWF IN ('{MONUMENT}', '{COLUMN_OR_STONE}', '{FOUNTAIN}')",
        columns=["OBJART", "BWF", "NAM"],
    )
    out = []
    for g, bwf, name in zip(
        geoms, column(fields, "BWF", geoms), column(fields, "NAM", geoms), strict=True
    ):
        name = name or None
        out.append({"geom": g, "kind": dlm_kind(bwf, name), "name": name})
    return out


def _osm_fountains(tile: Tile) -> list[dict]:
    wanted = 'other_tags LIKE \'%"amenity"=>"fountain"%\''
    found = []
    for layer, where, cols in (
        ("points", wanted, ["name", "other_tags"]),
        ("multipolygons", "amenity = 'fountain'", ["name", "amenity", "other_tags"]),
    ):
        geoms, fields = read_osm(tile, layer, where, cols, margin=0.0005)
        for g, name, other in zip(
            geoms, column(fields, "name", geoms), column(fields, "other_tags", geoms), strict=True
        ):
            found.append(
                {
                    "geom": g,
                    "name": name or None,
                    "style": classify_fountain(tag(other, "fountain"), tag(other, "water")),
                }
            )
    return found


def _osm_monuments(tile: Tile) -> list[dict]:
    """OSM's memorials and artworks near the tile, as `{geom, name, form,
    height, material, artist}` (a Stolperstein, a plaque without a form
    and anything underground left out)."""
    wanted = (
        'other_tags LIKE \'%"historic"=>"memorial"%\''
        ' OR other_tags LIKE \'%"historic"=>"monument"%\''
        ' OR other_tags LIKE \'%"tourism"=>"artwork"%\''
    )
    geoms, fields = read_osm(tile, "points", wanted, ["name", "other_tags"], margin=0.0005)
    found: list[dict] = []
    for g, name, other in zip(
        geoms, column(fields, "name", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        if tag(other, "memorial") == "stolperstein" or below_ground(other):
            continue
        found.append(
            {
                "geom": g,
                "name": name or None,
                "form": osm_form(other),
                "height": osm_height(other),
                "material": osm_material(other),
                "artist": tag(other, "artist_name") or None,
            }
        )
    return found


GENERIC_WORDS = {"denkmal", "gedenkstein", "mahnmal", "monument", "ehrenmal", "statue", "skulptur"}


def _words(name: str) -> set[str]:
    return {w for w in re.split(r"[\s\-–.,]+", name.lower()) if len(w) >= 4} - GENERIC_WORDS


def same_name(a: str | None, b: str | None) -> bool:
    """Whether two names plausibly name one monument: they share a word that
    is not just "Denkmal" ("Schiller-Denkmal", "Friedrich-Schiller-Denkmal")."""
    return bool(a and b and _words(a) & _words(b))


def name_form(name: str | None) -> str | None:
    """A form the DLM's official name states ("…-Obelisk", "…stele")."""
    label = (name or "").lower()
    for word, form in (("obelisk", "obelisk"), ("stele", "stele"), ("büste", "bust")):
        if word in label:
            return form
    return None


def _partner(m: dict, osm: list[dict], claimed: set[int]) -> int | None:
    """The OSM memorial or artwork that is this DLM monument: the one of its
    name within `TYPE_M`, else the nearest. A plaque is never it — a DLM
    monument stands free, the plaque beside it explains it."""
    near = []
    for i, o in enumerate(osm):
        if i in claimed or o["form"] == "plaque":
            continue
        d = shapely.distance(m["geom"], o["geom"])
        if d <= TYPE_M:
            near.append((not same_name(m["name"], o["name"]), d, i))
    return min(near)[2] if near else None


def type_monuments(
    items: list[dict], osm: list[dict], buildings: shapely.STRtree | None
) -> list[dict]:
    """The conflated monuments, each DLM one typed by its OSM memorial or
    artwork (`_partner`), and the free-standing OSM ones the DLM lacks
    added (`source` "osm"). A plaque the DLM does not know is not added."""
    claimed: set[int] = set()
    for m in items:
        if m["kind"] == "fountain":
            continue
        i = _partner(m, osm, claimed)
        if i is not None:
            claimed.add(i)
            o = osm[i]
            m.update({k: o[k] for k in ("form", "height", "material", "artist")})
            m["name"] = m["name"] or o["name"]
            m["source"] = "dlm+osm"
        m["form"] = name_form(m["name"]) or m.get("form")
    kept = [m["geom"] for m in items]
    for i, o in enumerate(osm):
        if i in claimed or FORM_KIND.get(o["form"] or "") is None:
            continue
        if any(shapely.distance(o["geom"], g) <= DUPLICATE_M for g in kept):
            continue
        if buildings is not None and len(buildings.query(o["geom"], "within")) > 0:
            continue  # indoors, or on a facade
        kept.append(o["geom"])
        items.append(
            {
                "geom": o["geom"],
                "kind": FORM_KIND[o["form"]],
                "name": o["name"],
                "style": None,
                "figure": False,
                "source": "osm",
                **{k: o[k] for k in ("form", "height", "material", "artist")},
            }
        )
    return items


# How far a Wikidata item may stand from the monument it describes (m): of
# its name, or the nearest of any name. Wikidata's coordinates are often a
# map pin, not the plinth.
WIKIDATA_NAME_M = 40.0
WIKIDATA_NEAR_M = 10.0
WIKIDATA_QUERY = """
SELECT ?i ?label ?coord (GROUP_CONCAT(DISTINCT ?mat; separator="|") AS ?materials) WHERE {
  SERVICE wikibase:box {
    ?i wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(%(w)f %(s)f)"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(%(e)f %(n)f)"^^geo:wktLiteral .
  }
  VALUES ?cls { wd:Q4989906 wd:Q860861 wd:Q179700 wd:Q5003624 wd:Q575759 }
  ?i wdt:P31/wdt:P279* ?cls .
  MINUS { ?i wdt:P31 wd:Q26703203 }
  ?i wdt:P186 ?m . ?m rdfs:label ?mat . FILTER(LANG(?mat) = "en")
  ?i rdfs:label ?label . FILTER(LANG(?label) = "de")
} GROUP BY ?i ?label ?coord LIMIT 500
"""


def wikidata_material(labels: list[str]) -> str | None:
    """Wikidata's material labels (en) in German, known ones only: a label
    the table lacks is read by its last word ("Carrara marble": Marmor,
    "high-quality steel": Stahl, "Meissen porcelain": Porzellan)."""
    names = []
    for label in labels:
        key = label.strip().lower().replace(" ", "_").replace("-", "_")
        name = MATERIALS.get(key) or MATERIALS.get(key.rsplit("_", 1)[-1])
        if name:
            names.append(name)
    return ", ".join(dict.fromkeys(names)) or None


def fetch_wikidata(raw: Path, tile_id: str, bounds, epsg: int) -> None:
    """The monuments Wikidata knows a material of on a tile →
    `<raw>/wikidata/monuments_<tile>.json` (fetch time only; the bake reads
    the file, never the network). A Stolperstein (Q26703203) is left out:
    thousands of them, none a monument that stands."""
    dest = raw / "wikidata" / f"monuments_{tile_id}.json"
    if dest.exists():
        return
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = bounds
    lons, lats = back.transform([xmin, xmax, xmin, xmax], [ymin, ymin, ymax, ymax])
    rows = query_box((min(lons), max(lons)), (min(lats), max(lats)), template=WIKIDATA_QUERY)
    items: dict[str, dict] = {}
    for r in rows:
        lon, lat = (float(v) for v in r["coord"]["value"][6:-1].split())
        qid = r["i"]["value"].rsplit("/", 1)[-1]
        materials = sorted(m for m in r["materials"]["value"].split("|") if m)
        items.setdefault(
            qid,
            {
                "id": qid,
                "label": r["label"]["value"],
                "lon": lon,
                "lat": lat,
                "materials": materials,
            },
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {"source": "Wikidata (CC0)", "monuments": sorted(items.values(), key=lambda i: i["id"])}
    part = dest.with_name(dest.name + ".part")
    part.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    part.replace(dest)
    print(f"{tile_id}: {len(items)} Wikidata monuments with a material → {dest}")


def load_wikidata(tile: Tile) -> list[dict]:
    """The fetched items as `{geom, id, name, material}` in the tile's CRS."""
    path = tile.raw / "wikidata" / f"monuments_{tile.id}.json"
    if not path.exists():
        return []
    try:
        doc = json.loads(path.read_text())
    except ValueError as err:
        path.unlink()
        raise OSError(f"{path}: not JSON — deleted; run bun run fetch again") from err
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    out = []
    for item in doc["monuments"]:
        material = wikidata_material(item["materials"])
        # a Stolperschwelle is a Stolperstein's longer sibling, set in the pavement
        if material and not item["label"].startswith("Stolper"):
            x, y = to_tile.transform(item["lon"], item["lat"])
            out.append(
                {
                    "geom": shapely.Point(x, y),
                    "id": item["id"],
                    "name": item["label"],
                    "material": material,
                }
            )
    return out


def wikidata_materials(items: list[dict], wikidata: list[dict]) -> None:
    """A monument OSM names no material of takes Wikidata's: the item of
    its name within `WIKIDATA_NAME_M`, else the nearest within
    `WIKIDATA_NEAR_M` — each item for one monument only."""
    claimed: set[int] = set()
    for m in items:
        if m["kind"] == "fountain" or m.get("material"):
            continue
        near = []
        for i, w in enumerate(wikidata):
            if i in claimed:
                continue
            d = shapely.distance(m["geom"], w["geom"])
            named = same_name(m["name"], w["name"])
            if d <= (WIKIDATA_NAME_M if named else WIKIDATA_NEAR_M):
                near.append((not named, d, i))
        if near:
            i = min(near)[2]
            claimed.add(i)
            m["material"] = wikidata[i]["material"]
            m["wikidata"] = wikidata[i]["id"]


def _buildings(tile: Tile) -> shapely.STRtree | None:
    if not tile.cityjson.exists():
        return None
    _, polys = footprints(json.loads(tile.cityjson.read_text()))
    return shapely.STRtree(polys)


def conflate(dlm: list[dict], osm: list[dict]) -> list[dict]:
    """The DLM monuments and the OSM fountains as one list of
    `{geom, kind, name, style, figure, source}`: each DLM point on an OSM
    fountain names that fountain and gives it a figure; the rest stand alone."""
    claimed: dict[int, dict] = {}
    out = []
    for m in dlm:
        dist = [shapely.distance(m["geom"], o["geom"]) for o in osm]
        free = [(d, i) for i, d in enumerate(dist) if d <= MATCH_M and i not in claimed]
        if free:
            claimed[min(free)[1]] = m
            continue
        out.append(
            {
                "geom": m["geom"],
                "kind": m["kind"],
                "name": m["name"],
                "style": "basin" if m["kind"] == "fountain" else None,
                "figure": m["kind"] == "fountain",
                "source": "dlm",
            }
        )
    for i, o in enumerate(osm):
        m = claimed.get(i)
        out.append(
            {
                "geom": basin_geometry(o["geom"]),
                "kind": "fountain",
                "name": (m or {}).get("name") or o["name"],
                "style": o["style"],
                "figure": m is not None,
                "source": "dlm+osm" if m else "osm",
            }
        )
    return out


def properties(item: dict) -> dict:
    props: dict = {"kind": item["kind"], "source": item["source"]}
    if item["name"]:
        props["name"] = item["name"]
    if item["kind"] == "fountain":
        props["style"] = item["style"]
        props["figure"] = bool(item["figure"])
    for key in ("form", "height", "material", "artist", "wikidata"):
        if item.get(key):
            props[key] = item[key]
    return props


def _flood(ok: np.ndarray, seed: tuple[int, int]) -> np.ndarray:
    """The 8-connected patch of `ok` cells around `seed`."""
    patch = np.zeros_like(ok)
    todo = deque([seed])
    patch[seed] = True
    rows, cols = ok.shape
    while todo:
        r, c = todo.popleft()
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                rr, cc = r + dr, c + dc
                if 0 <= rr < rows and 0 <= cc < cols and ok[rr, cc] and not patch[rr, cc]:
                    patch[rr, cc] = True
                    todo.append((rr, cc))
    return patch


def _cell_centres(window: tuple[int, int, int, int], origin: tuple[float, float]):
    r0, c0, r1, c1 = window
    west, north = origin
    xs = west + np.arange(c0, c1) + 0.5
    ys = north - np.arange(r0, r1) - 0.5
    return np.meshgrid(xs, ys)


def _touches(patch: np.ndarray, other: np.ndarray) -> bool:
    """Whether `patch` is 8-adjacent to (or overlaps) any `other` cell."""
    grown = patch.copy()
    grown[1:, :] |= patch[:-1, :]
    grown[:-1, :] |= patch[1:, :]
    grown[:, 1:] |= grown[:, :-1].copy()
    grown[:, :-1] |= grown[:, 1:].copy()
    return bool((grown & other).any())


def _patch_to_relief(heights: np.ndarray, patch: np.ndarray, window, origin) -> dict | None:
    """The patch's bounding box (+1 empty cell round it, so the smoothed
    form settles into the ground) as heights above ground in decimetres."""
    if patch.sum() < 2:
        return None
    rows = np.flatnonzero(patch.any(axis=1))
    cols = np.flatnonzero(patch.any(axis=0))
    ra, rb = rows[0] - 1, rows[-1] + 2
    ca, cb = cols[0] - 1, cols[-1] + 2
    grid = np.zeros((rb - ra, cb - ca))
    inner = np.where(patch, heights, 0.0)
    src = inner[max(ra, 0) : rb, max(ca, 0) : cb]
    grid[max(-ra, 0) : max(-ra, 0) + src.shape[0], max(-ca, 0) : max(-ca, 0) + src.shape[1]] = src
    west, north = origin
    r0, c0 = window[0], window[1]
    return {
        "west": round(float(west + c0 + ca), 1),
        "north": round(float(north - r0 - ra), 1),
        "cols": int(grid.shape[1]),
        "rows": int(grid.shape[0]),
        "dm": [int(round(v * 10)) for v in grid.ravel()],
    }


def measure_relief(
    ndom: np.ndarray, origin: tuple[float, float], geom: shapely.Geometry, kind: str
) -> dict | None:
    """The sculpture's measured bulk as a `relief` grid, or None.

    `ndom` is DOM1 − DGM1 on the 1 m grid whose north-west corner is
    `origin`. A basin is searched inside its water (the jets are off in the
    November flight); a point is seeded by the tallest cell within
    `SEED_M` and grown through every touching cell above `RELIEF_MIN_H`.
    The patch is dropped when it runs out of the `REACH_M` radius, grows
    past `RELIEF_MAX_M2` cells or `RELIEF_MAX_H` metres: then it is a tree
    or a facade the monument stands under or beside."""
    area = largest_part(geom)
    west, north = origin
    reach = REACH_M
    if area.geom_type == "Polygon":
        water = shapely.Polygon(area.interiors[0]) if area.interiors else area
        xmin, ymin, xmax, ymax = water.bounds
        # The window is centred on the water, not on a point of the rim.
        ax, ay = (xmin + xmax) / 2, (ymin + ymax) / 2
        reach = int(max(xmax - xmin, ymax - ymin) / 2) + 2
    else:
        anchor = area.representative_point() if area.geom_type != "Point" else area
        ax, ay = shapely.get_x(anchor), shapely.get_y(anchor)
    ac, ar = int(ax - west), int(north - ay)
    window = (ar - reach, ac - reach, ar + reach + 1, ac + reach + 1)
    if window[0] < 0 or window[1] < 0 or window[2] > ndom.shape[0] or window[3] > ndom.shape[1]:
        return None  # on the tile's edge: the neighbour's DOM1 is not read
    heights = ndom[window[0] : window[2], window[1] : window[3]]
    xs, ys = _cell_centres(window, origin)
    tall = heights >= RELIEF_MAX_H
    ok = (heights > RELIEF_MIN_H) & ~tall
    if area.geom_type == "Polygon":
        inside = shapely.contains_xy(water.buffer(-0.3), xs, ys)
        ok &= inside
        if not ok.any():
            return None
        # The largest body in the basin: the sculpture group, not a stray cell.
        best, patch = 0, None
        seen = np.zeros_like(ok)
        for seed in zip(*np.nonzero(ok), strict=True):
            if seen[seed]:
                continue
            p = _flood(ok, seed)
            seen |= p
            if p.sum() > best:
                best, patch = int(p.sum()), p
        assert patch is not None
        # Branches under a crown: the body leans on something too tall.
        if best > max(RELIEF_MAX_M2, 0.6 * water.area) or _touches(patch, tall):
            return None
        return _patch_to_relief(heights, patch, window, origin)
    near = np.hypot(xs - ax, ys - ay) <= SEED_M
    candidates = np.where(ok & near, heights, -1.0)
    if candidates.max() <= 0:
        return None
    seed = np.unravel_index(int(np.argmax(candidates)), candidates.shape)
    patch = _flood(ok, seed)
    edge = patch[0, :].any() or patch[-1, :].any() or patch[:, 0].any() or patch[:, -1].any()
    if edge or patch.sum() > RELIEF_MAX_M2 or _touches(patch, tall):
        return None
    return _patch_to_relief(heights, patch, window, origin)


def _ndom(tile: Tile) -> np.ndarray | None:
    if not tile.raw_raster("dom1").exists():
        return None
    with rasterio.open(tile.raw_raster("dom1")) as dom, rasterio.open(tile.dgm) as dgm:
        return dom.read(1).astype(np.float64) - dgm.read(1).astype(np.float64)


def run(tile: Tile) -> None:
    # Without an open Basis-DLM (Hamburg, Berlin) the OSM fountains stand
    # alone; a DLM provider whose package is missing keeps its files.
    if tile.products.dlm and not tile.has_dlm("the monuments"):
        return
    dlm = _dlm_points(tile) if tile.products.dlm else []
    extract = has_extract(tile, "the OSM fountains and memorials")
    osm = _osm_fountains(tile) if extract else []
    memorials = _osm_monuments(tile) if extract else []
    if not dlm and not osm and not tile.products.dlm:
        return
    ndom = _ndom(tile)
    if ndom is None:
        print(f"{tile.id}: no DOM1 — monuments without their measured relief")
    origin = (tile.bounds[0], tile.bounds[3])
    features = []
    items = type_monuments(conflate(dlm, osm), memorials, _buildings(tile))
    wikidata_materials(items, load_wikidata(tile))
    for item in items:
        anchor = item["geom"].representative_point()
        if not owns(tile.bounds, shapely.get_x(anchor), shapely.get_y(anchor)):
            continue
        props = properties(item)
        # A fountain without a monument in it has no sculpture to measure.
        if ndom is not None and (item["kind"] != "fountain" or item["figure"]):
            relief = measure_relief(ndom, origin, item["geom"], item["kind"])
            if relief:
                props["relief"] = relief
        features.append(feature(geometry_json(item["geom"]), props))
    # Stable order: the committed file diffs by feature, not by read order.
    features.sort(key=lambda f: (f["properties"]["kind"], _anchor_key(f["geometry"])))
    osm_credit = OSM_ATTRIBUTION if osm or memorials else ""
    credit = "; ".join(c for c in (tile.credit if dlm else "", osm_credit) if c)
    write_geojson(tile.out("dlm", f"monuments_{tile.id}.geojson"), features, tile.epsg, credit)
    kinds = {k: sum(f["properties"]["kind"] == k for f in features) for k in KINDS}
    reliefs = sum("relief" in f["properties"] for f in features)
    typed = sum("form" in f["properties"] for f in features)
    wd = sum("wikidata" in f["properties"] for f in features)
    print(
        f"{tile.id}: monuments "
        + ", ".join(f"{n} {k}" for k, n in kinds.items())
        + f"; {reliefs} with a measured relief, {typed} with an OSM form,"
        + f" {wd} with Wikidata's material"
    )


KINDS = ("fountain", "statue", "stone", "column")


def _anchor_key(geometry: dict) -> tuple[float, float]:
    coords = np.asarray(
        geometry["coordinates"] if geometry["type"] == "Point" else geometry["coordinates"][0][0]
    )
    return float(coords[0]), float(coords[1])
