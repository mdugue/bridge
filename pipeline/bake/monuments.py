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

OSM maps a memorial or an artwork as a node or as its outline: an outline
up to `AREA_MAX_M2` stands at its representative point (Hamburg's
Bismarck-Denkmal is a 635 m² area); a larger one is a site — a grove, a
field of graves — and is left out. A war memorial (`memorial=war_memorial`)
and a bare `historic=monument` say that a monument stands there, not what
it is: they take the form their measured height says (`default_form`: a
stone, a stele, a column where the surface shows a slim shaft, else a
statue on its pedestal; unmeasured a stele and a statue).

A basin outline is written as a Polygon ring — the rim, its hole the water
(the outline inset by the rim width); a basin too small to inset is a solid
bowl. Everything else is a Point. A drinking fountain or a stone block
(`fountain=drinking|bubbler|stone_block|water_tap`, `drinking_water=yes`)
mapped as a node is ~1 m across (`r`, its radius), not the default basin;
a point fountain inside a LoD2 footprint is on its facade or indoors: it
moves out within `FACADE_M` of the outline, else it is dropped.

What a monument or a fountain's sculpture *looks* like is in no register,
but its bulk is measured: the DOM1 surface model minus the DGM1 terrain
(the same nDOM the canopy bake reads) shows the sculpture groups of the
Albertplatz fountains as ~4 × 5 m bodies 3.7 m tall, the Goldener Reiter
as 7 m. Where that body stands clear — one connected patch, not merging
into a tree crown or a facade — it is written as `relief`: the patch's
heights above ground on the 1 m grid, which the viewer smooths into a
clay form. A monument too small for a 1 m grid, or lost under a tree, has
none (the viewer draws a marker). Where the provider's laser scan lies on
the tile, its surface is read instead (`Surface.of`, its 0.5 m maxima per
1 m cell over DGM1; DOM1 where the scan has no return): München's
image-matched DOM1 rounds the Mariensäule's 13.2 m shaft to 2.4 m.

Three rules keep the measurement honest:

- a slim shaft taller than `RELIEF_MAX_H` (`slim_column`: at most
  `SLIM_CELLS` cells — `NAMED_SLIM_CELLS` where OSM or the DLM calls it a
  column or an obelisk, its form, kind or name —, its neighbours falling
  below `SLIM_RING` of its top, most of it clear of the LoD2 footprints)
  is that column at its measured height; an unformed memorial
  (`default_form`) is one only at the narrower count — the cap is for
  the leafless crowns, which spread, and a bare young tree beside a
  sculpture is as slim (the Friedensengel's 36.6 m over 18 cells, a
  terrace building round its foot; the Karolinenplatz's obelisk 26.5 m);
- on a site flown leaf-off (`winter_flight`: its crowns read bare in the
  photo) a box — a flat top over a densely filled rectangle
  (`winter_cover`) — is the winter housing over a figure, not the figure:
  no relief, the form's default (the Albertplatz's fountains);
- a monument measured no relief but standing in the open (`ring_height`:
  the ring around it low) takes the tallest cell at its point as its
  height (`hm`), raised to its form's least (`FORM_RANGE`); a reading
  above its form's most is a branch or a mast, not the monument: none.

A monument without a relief faces (`a`, a bearing) the centre of the
square it stands on, else its nearest way (`Facing`), not a hashed
direction. An OSM memorial's name states its form as a DLM name does
(`name_form`: "…säule", "…obelisk", "…stele", "…büste").

Each tile writes only what it owns (its representative point; west/south
edges in, lib/city/tileset.ts `ownsPoint`), so a fountain on a seam stands
once."""

from __future__ import annotations

import json
import math
import re
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
import shapely
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage as ndi

from . import step_cache
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
from .furniture import bearing, facing
from .landmarks import query_box
from .lowveg import lsc_rasters
from .lsc import NODATA as LSC_NODATA
from .osm import below_ground, has_extract, read_osm, read_ways, tag
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
# An OSM memorial or artwork mapped as an outline larger than this (m²) is a
# site — a grove, a cemetery's field of graves —, not one object.
AREA_MAX_M2 = 1000.0
# A slim shaft over RELIEF_MAX_H (`slim_column`): its cells are those above
# SHAFT_SHARE of its top (and RELIEF_MAX_H), at most SLIM_CELLS of them, and
# the cells round it reach at most SLIM_RING of its top at their median — a
# crown's flanks stand at 0.6–0.8 of its top, a column's pedestal below 0.3
# (the Mariensäule's 0.25, the Friedensengel's terrace 0.24 of 32.8 m). Its
# pedestal is what stands round it within PEDESTAL_CELLS. A monument OSM or
# the DLM names a column or an obelisk may spread to NAMED_SLIM_CELLS (the
# Friedensengel's angel and capital: 18 cells of the laser scan's maxima).
SHAFT_SHARE = 0.3
SLIM_CELLS = 12
NAMED_SLIM_CELLS = 24
SLIM_RING = 0.45
PEDESTAL_CELLS = 2
# A winter housing (`winter_cover`): the cells above COVER_CORE of the top
# reach the top within COVER_FLAT of it (their 10th percentile) and fill
# COVER_FILL of their rectangle along the cells' axes, COVER_MIN of them at
# least (the Albertplatz's two: 3.6–3.9 m over 16 of 20 cells).
COVER_CORE = 0.75
COVER_FLAT = 0.15
COVER_FILL = 0.75
COVER_MIN = 6
# A site is flown leaf-off where its crowns' median on the calibrated
# index (ndvi.py, 0..1) is below WINTER_NDVI, told from WINTER_MIN of them:
# the Saxon flights' 0.13–0.43 per tile, Hamburg's, München's and Unna's
# 0.54–1.0.
WINTER_NDVI = 0.4
WINTER_MIN = 500
# A monument's height without a relief (`ring_height`): the tallest cell
# within INNER_M of its point, where at least RING_OPEN of the cells
# RING_M[0]–RING_M[1] round it stay below RELIEF_MIN_H.
INNER_M = 1.5
RING_M = (2.5, 4.5)
RING_OPEN = 0.8
# What such a monument can measure (m): a lower reading is raised to the
# least, a higher one is something else (`measured_props`).
FORM_RANGE = {
    "statue": (1.5, 9.0),
    "bust": (1.0, 3.5),
    "sculpture": (0.8, 9.0),
    "stele": (0.8, 4.0),
    "stone": (0.4, 2.5),
    "obelisk": (2.0, 35.0),
    "column": (3.0, 40.0),
}
KIND_RANGE = {"statue": (1.0, 9.0), "stone": (0.4, 2.5), "column": (2.0, 40.0)}
# A war memorial's or a bare monument's form by its measured top (m): a
# stone below STONE_TOP_M, a stele below STELE_TOP_M, else a statue (a
# column where `slim_column` found the shaft); unmeasured, these.
STONE_TOP_M, STELE_TOP_M = 1.5, 3.0
UNMEASURED_FORM = {"war_memorial": "stele", "monument": "statue"}
# What a monument without a relief faces: the centre of the square it
# stands on (a pedestrian area or `place=square` of at least SQUARE_M2,
# SQUARE_CENTRE_M off its centre), else its nearest way within FACE_M.
SQUARE_M2 = 200.0
SQUARE_CENTRE_M = 3.0
FACE_M = 25.0
SQUARES = "place = 'square' OR other_tags LIKE '%\"highway\"=>\"pedestrian\"%'"
# A point fountain this small (m, its radius): a drinking fountain, a stone
# block. Inside a LoD2 footprint one moves out when the outline is within
# FACADE_M (it is mapped on its facade), CLEAR_M past it; else it is indoors.
SMALL_FOUNTAIN_R = 0.5
SMALL_FOUNTAINS = {"drinking", "bubbler", "stone_block", "water_tap", "drinking_fountain"}
FACADE_M = 3.0
CLEAR_M = 0.3
POINT_BASIN_R = 2.2  # a point fountain's basin (lib/city/monuments.ts POINT_BASIN_R)
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
    "column": "column",
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
    "column": "column",
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
                    "small": small_fountain(other),
                }
            )
    return found


def small_fountain(other_tags: str | None) -> bool:
    """A drinking fountain or a stone block: ~1 m across, not a basin."""
    return (tag(other_tags, "fountain") or "") in SMALL_FOUNTAINS or (
        tag(other_tags, "drinking_water") == "yes"
    )


def unformed(historic: str | None, other_tags: str | None) -> str | None:
    """What OSM says of a memorial whose form it does not name, when that is
    a monument that stands: "war_memorial", or "monument" for a bare
    `historic=monument`; else None."""
    if tag(other_tags, "memorial") == "war_memorial":
        return "war_memorial"
    if historic == "monument" and not (
        tag(other_tags, "memorial") or tag(other_tags, "artwork_type")
    ):
        return "monument"
    return None


def default_form(said: str, top: float | None, slim: bool) -> str:
    """The form of a war memorial or a bare monument (`unformed`) by its
    measured top (m): a column where the surface shows a slim shaft, a
    stone, a stele, else a statue on its pedestal; unmeasured, a war
    memorial is a stele, a monument a statue (`UNMEASURED_FORM`)."""
    if slim:
        return "column"
    if top is None:
        return UNMEASURED_FORM[said]
    if top < STONE_TOP_M:
        return "stone"
    return "stele" if top < STELE_TOP_M else "statue"


def _osm_monuments(tile: Tile, surface: Surface | None = None) -> list[dict]:
    """OSM's memorials and artworks near the tile, as `{geom, name, form,
    height, material, artist}` (a Stolperstein, a plaque without a form
    and anything underground left out): the nodes, and the outlines up to
    AREA_MAX_M2 without a node inside at their representative point. A war memorial or a bare
    monument takes the form its measured height says (`default_form`)."""
    wanted = (
        'other_tags LIKE \'%"historic"=>"memorial"%\''
        ' OR other_tags LIKE \'%"historic"=>"monument"%\''
        ' OR other_tags LIKE \'%"tourism"=>"artwork"%\''
    )
    geoms, fields = read_osm(tile, "points", wanted, ["name", "other_tags"], margin=0.0005)
    others = column(fields, "other_tags", geoms)
    rows = [
        (g, n, tag(o, "historic"), o)
        for g, n, o in zip(geoms, column(fields, "name", geoms), others, strict=True)
    ]
    areas, fields = read_osm(
        tile,
        "multipolygons",
        "historic IN ('memorial', 'monument') OR tourism = 'artwork'",
        ["name", "historic", "other_tags"],
        margin=0.0005,
    )
    # An outline with a node inside it is mapped twice: the node is the object.
    nodes = shapely.STRtree([r[0] for r in rows]) if rows else None
    for g, n, h, o in zip(
        areas,
        column(fields, "name", areas),
        column(fields, "historic", areas),
        column(fields, "other_tags", areas),
        strict=True,
    ):
        if g is None or g.is_empty or g.area > AREA_MAX_M2:
            continue
        if nodes is None or len(nodes.query(g, predicate="contains")) == 0:
            rows.append((g.representative_point(), n, h, o))
    found: list[dict] = []
    for g, name, historic, other in rows:
        if tag(other, "memorial") == "stolperstein" or below_ground(other):
            continue
        form = name_form(name) or osm_form(other)
        said = unformed(historic, other) if form is None else None
        if said is not None:
            top, slim = surface.top(g) if surface is not None else (None, False)
            form = default_form(said, top, slim)
        found.append(
            {
                "geom": g,
                "name": name or None,
                "form": form,
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
    """A form the DLM's official name states ("…-Obelisk", "…stele",
    "…säule")."""
    label = (name or "").lower()
    for word, form in (
        ("obelisk", "obelisk"),
        ("stele", "stele"),
        ("büste", "bust"),
        ("säule", "column"),
    ):
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
                "small": bool(o.get("small")),
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
        if item.get("small") and item["geom"].geom_type == "Point":
            props["r"] = SMALL_FOUNTAIN_R
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


def _grow(patch: np.ndarray) -> np.ndarray:
    """The patch grown by one cell, its 8 neighbours."""
    grown = patch.copy()
    grown[1:, :] |= patch[:-1, :]
    grown[:-1, :] |= patch[1:, :]
    grown[:, 1:] |= grown[:, :-1].copy()
    grown[:, :-1] |= grown[:, 1:].copy()
    return grown


def _touches(patch: np.ndarray, other: np.ndarray) -> bool:
    """Whether `patch` is 8-adjacent to (or overlaps) any `other` cell."""
    return bool((_grow(patch) & other).any())


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


def slim_column(
    heights: np.ndarray,
    near: np.ndarray,
    built: np.ndarray | None = None,
    cells: int = SLIM_CELLS,
) -> np.ndarray | None:
    """The cells of a column or an obelisk taller than RELIEF_MAX_H whose top
    lies in `near`, with its pedestal round it, or None: the tallest cell
    there is lower, or what stands there spreads like a crown (more than
    `cells` cells above SHAFT_SHARE of its top, or the cells round them
    standing above SLIM_RING of it at their median) or is a building (a
    LoD2 footprint, `built`, under most of the shaft — a column standing
    in a terrace building's courtyard overlaps its edge)."""
    seeded = np.where(near, heights, -1.0)
    if seeded.max() < RELIEF_MAX_H:
        return None
    seed = np.unravel_index(int(np.argmax(seeded)), heights.shape)
    top = float(heights[seed])
    shaft = _flood(heights >= max(RELIEF_MAX_H, SHAFT_SHARE * top), seed)
    n = int(shaft.sum())
    if n > cells or (built is not None and 2 * int((shaft & built).sum()) > n):
        return None
    ring = _grow(shaft) & ~shaft
    if not ring.any() or float(np.median(heights[ring])) > SLIM_RING * top:
        return None
    base = shaft
    for _ in range(PEDESTAL_CELLS):
        base = _grow(base)
    return shaft | (base & (heights > RELIEF_MIN_H))


def winter_cover(heights: np.ndarray, patch: np.ndarray) -> bool:
    """Whether a measured patch is a box — the winter housing a figure
    stands under when the surface is flown in winter, not the figure: the
    cells above COVER_CORE of its top (COVER_MIN of them at least) reach
    the top within COVER_FLAT of it and fill COVER_FILL of their smallest
    rectangle."""
    if not patch.any():
        return False
    top = float(heights[patch].max())
    core = patch & (heights >= COVER_CORE * top)
    n = int(core.sum())
    if n < COVER_MIN or top - float(np.percentile(heights[core], 10)) > COVER_FLAT * top:
        return False
    rows, cols = np.nonzero(core)
    cells = shapely.union_all(
        [shapely.box(c, -r - 1, c + 1, -r) for r, c in zip(rows, cols, strict=True)]
    )
    return n / shapely.minimum_rotated_rectangle(cells).area >= COVER_FILL


def ring_height(heights: np.ndarray, xs, ys, ax: float, ay: float) -> float | None:
    """A monument's height where no relief was measured but it stands in the
    open: the tallest cell within INNER_M of its point, where RING_OPEN of
    the cells RING_M round it stay below RELIEF_MIN_H (no crown, no facade
    beside it); None where the ring is not open or nothing stands."""
    d = np.hypot(xs - ax, ys - ay)
    inner = d <= INNER_M
    ring = (d >= RING_M[0]) & (d <= RING_M[1])
    if not inner.any() or not ring.any():
        return None
    if float((heights[ring] < RELIEF_MIN_H).mean()) < RING_OPEN:
        return None
    top = float(heights[inner].max())
    return top if top > RELIEF_MIN_H else None


@dataclass
class Measured:
    """What the surface shows of a monument: its relief (or None), whether
    that is a slim column's, whether a winter housing stood over it
    (`cover`: no relief), its height in the open without one (`hm`, m), and
    whether the laser scan measured it (`scan`)."""

    relief: dict | None = None
    slim: bool = False
    cover: bool = False
    hm: float | None = None
    scan: bool = False


@dataclass
class Surface:
    """What a monument is measured on: the heights above DGM1 on the tile's
    1 m grid (`ndom`; its north-west corner `origin`) — the laser scan's
    where the provider has one (`scan`, the cells it measured), else DOM1's
    —, the LoD2 footprints on that grid (`built`), and whether the site was
    flown leaf-off (`winter`)."""

    ndom: np.ndarray
    origin: tuple[float, float]
    built: np.ndarray | None = None
    scan: np.ndarray | None = None
    winter: bool = False

    @classmethod
    def of(cls, tile: Tile, footprints: list[shapely.Geometry]) -> Surface | None:
        if not tile.raw_raster("dom1").exists():
            return None
        with rasterio.open(tile.raw_raster("dom1")) as dom, rasterio.open(tile.dgm) as dgm:
            ground = dgm.read(1).astype(np.float64)
            ndom = dom.read(1).astype(np.float64) - ground
        origin = (tile.bounds[0], tile.bounds[3])
        scan = _scan_heights(tile, ground)
        measured = None
        if scan is not None and scan.shape == ndom.shape:
            measured = np.isfinite(scan)
            ndom = np.where(measured, scan, ndom)
        built = None
        if footprints:
            built = rasterize(
                footprints,
                out_shape=ndom.shape,
                transform=from_origin(origin[0], origin[1], 1.0, 1.0),
                dtype=np.uint8,
            ).astype(bool)
        return cls(ndom, origin, built, measured, winter_flight(tile))

    def measure(self, geom: shapely.Geometry, kind: str, slim: int = 0) -> Measured:
        """The monument's relief (`measure_relief`) — a slim shaft's above
        the cap where it may be a column (`slim`: the most cells its shaft
        may cover, NAMED_SLIM_CELLS where OSM or the DLM says column or
        obelisk; 0, no shaft is looked for) —, and without one its height
        in the open (`ring_height`)."""
        area = largest_part(geom)
        if area.geom_type == "Polygon":
            return self._basin(area)
        anchor = area.representative_point() if area.geom_type != "Point" else area
        ax, ay = shapely.get_x(anchor), shapely.get_y(anchor)
        win = self._window(ax, ay, REACH_M)
        if win is None:
            return Measured()
        window, heights, xs, ys = win
        built = self._cut(self.built, window)
        near = np.hypot(xs - ax, ys - ay) <= SEED_M
        column = slim_column(heights, near, built, slim) if slim else None
        if column is not None:
            return self._measured(heights, column, window, slim=True)
        patch = _seeded_patch(heights, near)
        if patch is not None and self.winter and winter_cover(heights, patch):
            return Measured(cover=True)
        if patch is not None:
            m = self._measured(heights, patch, window)
            if m.relief is not None:
                return m  # else one cell: too small for a relief, not for a height
        hm = ring_height(heights, xs, ys, ax, ay)
        inner = np.hypot(xs - ax, ys - ay) <= INNER_M
        return Measured(hm=hm, scan=hm is not None and self._scanned(window, inner))

    def top(self, geom: shapely.Geometry) -> tuple[float | None, bool]:
        """The measured top (m) of what stands at `geom`, and whether it is a
        slim column."""
        m = self.measure(geom, "statue", slim=SLIM_CELLS)
        if m.relief is not None:
            return max(m.relief["dm"]) / 10, m.slim
        return m.hm, False

    def _basin(self, area: shapely.Polygon) -> Measured:
        """A basin's sculpture, searched inside its water (the jets are off
        in the November flight): the largest body there."""
        water = shapely.Polygon(area.interiors[0]) if area.interiors else area
        xmin, ymin, xmax, ymax = water.bounds
        # The window is centred on the water, not on a point of the rim.
        reach = int(max(xmax - xmin, ymax - ymin) / 2) + 2
        win = self._window((xmin + xmax) / 2, (ymin + ymax) / 2, reach)
        if win is None:
            return Measured()
        window, heights, xs, ys = win
        tall = heights >= RELIEF_MAX_H
        ok = (heights > RELIEF_MIN_H) & ~tall & shapely.contains_xy(water.buffer(-0.3), xs, ys)
        best, patch = 0, None
        seen = np.zeros_like(ok)
        for seed in zip(*np.nonzero(ok), strict=True):
            if seen[seed]:
                continue
            p = _flood(ok, seed)
            seen |= p
            if p.sum() > best:
                best, patch = int(p.sum()), p
        # Branches under a crown: the body leans on something too tall.
        if patch is None or best > max(RELIEF_MAX_M2, 0.6 * water.area) or _touches(patch, tall):
            return Measured()
        if self.winter and winter_cover(heights, patch):
            return Measured(cover=True)
        return self._measured(heights, patch, window)

    def _window(self, ax: float, ay: float, reach: int):
        west, north = self.origin
        ac, ar = int(ax - west), int(north - ay)
        window = (ar - reach, ac - reach, ar + reach + 1, ac + reach + 1)
        rows, cols = self.ndom.shape
        if window[0] < 0 or window[1] < 0 or window[2] > rows or window[3] > cols:
            return None  # on the tile's edge: the neighbour's surface is not read
        heights = self.ndom[window[0] : window[2], window[1] : window[3]]
        xs, ys = _cell_centres(window, self.origin)
        return window, heights, xs, ys

    @staticmethod
    def _cut(grid: np.ndarray | None, window) -> np.ndarray | None:
        return None if grid is None else grid[window[0] : window[2], window[1] : window[3]]

    def _scanned(self, window, cells: np.ndarray) -> bool:
        scan = self._cut(self.scan, window)
        return scan is not None and bool(cells.any()) and float(scan[cells].mean()) > 0.5

    def _measured(self, heights, patch, window, slim: bool = False) -> Measured:
        relief = _patch_to_relief(heights, patch, window, self.origin)
        return Measured(relief, slim and relief is not None, scan=self._scanned(window, patch))


def _seeded_patch(heights: np.ndarray, near: np.ndarray) -> np.ndarray | None:
    """A point monument's body: the tallest cell within SEED_M (`near`)
    grown through every touching cell above RELIEF_MIN_H — None when it
    runs out of the window (REACH_M), grows past RELIEF_MAX_M2 cells or
    touches one RELIEF_MAX_H tall: then it is a tree or a facade the
    monument stands under or beside."""
    tall = heights >= RELIEF_MAX_H
    ok = (heights > RELIEF_MIN_H) & ~tall
    candidates = np.where(ok & near, heights, -1.0)
    if candidates.max() <= 0:
        return None
    seed = np.unravel_index(int(np.argmax(candidates)), candidates.shape)
    patch = _flood(ok, seed)
    edge = patch[0, :].any() or patch[-1, :].any() or patch[:, 0].any() or patch[:, -1].any()
    if edge or patch.sum() > RELIEF_MAX_M2 or _touches(patch, tall):
        return None
    return patch


def measure_relief(
    ndom: np.ndarray, origin: tuple[float, float], geom: shapely.Geometry, kind: str
) -> dict | None:
    """The sculpture's measured bulk as a `relief` grid, or None
    (`Surface.measure` on DOM1 − DGM1 alone, `ndom`, on the 1 m grid whose
    north-west corner is `origin`). A basin is searched inside its water; a
    column's point is a slim shaft (`slim_column`), any point else the
    patch grown from the tallest cell within SEED_M (`_seeded_patch`)."""
    slim = NAMED_SLIM_CELLS if kind == "column" else 0
    return Surface(ndom, origin).measure(geom, kind, slim).relief


def _scan_heights(tile: Tile, ground: np.ndarray) -> np.ndarray | None:
    """The laser scan's surface over DGM1 on the 1 m grid — each cell the
    highest of its four 0.5 m maxima (lsc.py `dsm_050.tif`), NaN where the
    scan has no return —, or None without a scan."""
    if not tile.products.lsc:
        return None
    der = lsc_rasters(tile)
    if der is None:
        return None
    with rasterio.open(der / "dsm_050.tif") as ds:
        dsm = ds.read(list(ds.descriptions).index("max") + 1).astype(np.float64)
    n = dsm.shape[0] // 2
    if dsm.shape != (2 * n, 2 * n) or (n, n) != ground.shape:
        return None
    dsm = np.where(dsm > LSC_NODATA + 1, dsm, -np.inf)
    top = dsm.reshape(n, 2, n, 2).max(axis=(1, 3))
    return np.where(np.isfinite(top), top - ground, np.nan)


def winter_flight(tile: Tile) -> bool:
    """Whether the site was flown leaf-off: its crowns (the canopy bake's,
    on every tile of the site) read bare on the calibrated index — the
    median of their greenest texel at ~2 m below WINTER_NDVI, from
    WINTER_MIN crowns at least."""
    key = (tile.data, tuple(tile.neighbours()))
    return step_cache.memo(_WINTER, key, lambda: _winter(*key))


_WINTER: dict = {}


def _winter(data: Path, tiles: tuple) -> bool:
    values = []
    for tid, (xmin, _, xmax, ymax) in tiles:
        canopy = data / "dlm" / f"canopy_{tid}.geojson"
        png = data / "dlm" / f"ndvi_{tid}.png"
        if not canopy.exists() or not png.exists():
            continue
        xy = np.array(
            [f["geometry"]["coordinates"][:2] for f in json.loads(canopy.read_text())["features"]],
            dtype=float,
        ).reshape(-1, 2)
        green = ndi.maximum_filter(np.asarray(Image.open(png).convert("L")), 3) / 255.0
        k = green.shape[0]
        size = xmax - xmin
        c = np.clip(((xy[:, 0] - xmin) / size * k).astype(int), 0, k - 1)
        r = np.clip(((ymax - xy[:, 1]) / size * k).astype(int), 0, k - 1)
        values.append(green[r, c])
    found = np.concatenate(values) if values else np.zeros(0)
    return len(found) >= WINTER_MIN and float(np.median(found)) < WINTER_NDVI


class Facing:
    """Which way a monument without a relief faces: the centre of the square
    it stands on (a pedestrian area or `place=square` of SQUARE_M2 or more,
    SQUARE_CENTRE_M off its centre), else its nearest way within FACE_M —
    as the furniture's benches face theirs (furniture.py `facing`)."""

    def __init__(self, tile: Tile) -> None:
        geoms, _ = read_ways(tile, "highway IS NOT NULL", ["highway"])
        self.lines = np.array(
            [g for g in geoms if g is not None and g.geom_type == "LineString"], dtype=object
        )
        self.ways = shapely.STRtree(self.lines) if len(self.lines) else None
        squares, _ = read_osm(tile, "multipolygons", SQUARES, ["place", "other_tags"])
        self.squares = [g for g in squares if g is not None and g.area >= SQUARE_M2]
        self.tree = shapely.STRtree(self.squares) if self.squares else None

    def bearing(self, p: shapely.Point) -> float | None:
        if self.tree is not None:
            for i in self.tree.query(p, predicate="within"):
                c = self.squares[int(i)].centroid
                if p.distance(c) >= SQUARE_CENTRE_M:
                    return bearing(c.x - p.x, c.y - p.y)
        return facing(p, self.ways, self.lines) if self.ways is not None else None


def out_of_buildings(item: dict, buildings: shapely.STRtree | None) -> shapely.Geometry | None:
    """Where a point fountain stands clear of the LoD2 footprints: where it is
    mapped, or — inside one, within FACADE_M of its outline (mapped on its
    facade) — CLEAR_M past the outline with its basin; None deeper inside
    (indoors, in a passage)."""
    g = item["geom"]
    if buildings is None or item["kind"] != "fountain" or g.geom_type != "Point":
        return g
    hit = buildings.query(g, predicate="within")
    if len(hit) == 0:
        return g
    poly = buildings.geometries[int(hit[0])]
    q = shapely.get_point(shapely.shortest_line(g, poly.boundary), 1)
    d = g.distance(q)
    if d > FACADE_M:
        return None
    ox, oy = (q.x - g.x, q.y - g.y) if d > 1e-3 else (q.x - poly.centroid.x, q.y - poly.centroid.y)
    norm = math.hypot(ox, oy) or 1.0
    out = (SMALL_FOUNTAIN_R if item.get("small") else POINT_BASIN_R) + CLEAR_M
    moved = shapely.Point(q.x + ox / norm * out, q.y + oy / norm * out)
    return None if len(buildings.query(moved, predicate="within")) > 0 else moved


def measured_props(surface: Surface, item: dict) -> dict:
    """What the surface adds to a monument's properties: its relief (a slim
    shaft's makes it a column, unless it is an obelisk), that a winter
    housing covered it (`cover`), its height in the open without a relief
    (`hm`, raised to its form's least; none above its form's most, nor a
    fountain's), and `hs: "lsc"` where the laser scan measured it."""
    named = item["kind"] == "column" or item.get("form") in ("column", "obelisk")
    m = surface.measure(item["geom"], item["kind"], NAMED_SLIM_CELLS if named else 0)
    props: dict = {}
    if m.relief is not None:
        props["relief"] = m.relief
    if m.slim and item.get("form") not in ("obelisk", "column"):
        props["form"] = "column"
    if m.cover:
        props["cover"] = True
    if m.hm is not None and item["kind"] != "fountain":
        lo, hi = FORM_RANGE.get(item.get("form") or "") or KIND_RANGE[item["kind"]]
        # Taller than such a monument can be: a branch over it or a mast
        # beside it, not the monument (the Eselsbrunnen's 9 m donkey).
        if m.hm <= hi:
            props["hm"] = round(max(m.hm, lo), 1)
    if m.scan and ("relief" in props or "hm" in props):
        props["hs"] = "lsc"
    return props


def _footprints(tile: Tile) -> list[shapely.Geometry]:
    if not tile.cityjson.exists():
        return []
    _, polys = footprints(json.loads(tile.cityjson.read_text()))
    return polys


def run(tile: Tile) -> None:
    # Without an open Basis-DLM (Hamburg, Berlin) the OSM fountains stand
    # alone; a DLM provider whose package is missing keeps its files.
    if tile.products.dlm and not tile.has_dlm("the monuments"):
        return
    dlm = _dlm_points(tile) if tile.products.dlm else []
    extract = has_extract(tile, "the OSM fountains and memorials")
    polys = _footprints(tile)
    surface = Surface.of(tile, polys)
    if surface is None:
        print(f"{tile.id}: no DOM1 — monuments without their measured relief")
    osm = _osm_fountains(tile) if extract else []
    memorials = _osm_monuments(tile, surface) if extract else []
    if not dlm and not osm and not tile.products.dlm:
        return
    buildings = shapely.STRtree(polys) if polys else None
    items = type_monuments(conflate(dlm, osm), memorials, buildings)
    moved = dropped = 0
    for item in items:
        g = out_of_buildings(item, buildings)
        moved += g is not None and g is not item["geom"]
        dropped += g is None
        item["geom"] = g
    items = [i for i in items if i["geom"] is not None]
    wikidata_materials(items, load_wikidata(tile))
    view = Facing(tile) if extract else None
    features = []
    for item in items:
        anchor = item["geom"].representative_point()
        if not owns(tile.bounds, shapely.get_x(anchor), shapely.get_y(anchor)):
            continue
        props = properties(item)
        # A fountain without a monument in it has no sculpture to measure.
        if surface is not None and (item["kind"] != "fountain" or item["figure"]):
            props.update(measured_props(surface, item))
        if view is not None and item["kind"] != "fountain" and "relief" not in props:
            a = view.bearing(item["geom"]) if item["geom"].geom_type == "Point" else None
            if a is not None:
                props["a"] = round(a)
        features.append(feature(geometry_json(item["geom"]), props))
    # Stable order: the committed file diffs by feature, not by read order.
    features.sort(key=lambda f: (f["properties"]["kind"], _anchor_key(f["geometry"])))
    osm_credit = OSM_ATTRIBUTION if osm or memorials else ""
    credit = "; ".join(c for c in (tile.credit if dlm else "", osm_credit) if c)
    write_geojson(tile.out("dlm", f"monuments_{tile.id}.geojson"), features, tile.epsg, credit)
    kinds = {k: sum(f["properties"]["kind"] == k for f in features) for k in KINDS}
    count = lambda key: sum(key in f["properties"] for f in features)  # noqa: E731
    print(
        f"{tile.id}: monuments "
        + ", ".join(f"{n} {k}" for k, n in kinds.items())
        + f"; {count('relief')} with a measured relief, {count('form')} with a form,"
        + f" {count('hm')} measured in the open, {count('cover')} under a winter housing,"
        + f" {count('wikidata')} with Wikidata's material; {moved} point fountains"
        + f" moved off a facade, {dropped} indoors dropped"
        + (" (laser scan)" if surface is not None and surface.scan is not None else "")
        + (" (leaf-off flight)" if surface is not None and surface.winter else "")
    )


KINDS = ("fountain", "statue", "stone", "column")


def _anchor_key(geometry: dict) -> tuple[float, float]:
    coords = np.asarray(
        geometry["coordinates"] if geometry["type"] == "Point" else geometry["coordinates"][0][0]
    )
    return float(coords[0]), float(coords[1])
