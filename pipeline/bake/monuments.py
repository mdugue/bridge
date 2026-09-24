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

A basin outline is written as a Polygon ring — the rim, its hole the water
(the outline inset by the rim width); a basin too small to inset is a solid
bowl. Everything else is a Point. Each tile writes only what it owns
(its representative point; west/south edges in, lib/city/tileset.ts
`ownsPoint`), so a fountain on a seam stands once."""

from __future__ import annotations

import re

import numpy as np
import shapely

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
from .osm import has_extract, read_osm, tag

GEOSN_ATTRIBUTION = "Quelle: GeoSN, dl-de/by-2-0"
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
    return props


def run(tile: Tile) -> None:
    if not tile.has_dlm("the monuments"):
        return
    dlm = _dlm_points(tile)
    osm = _osm_fountains(tile) if has_extract(tile, "the OSM fountains") else []
    features = []
    for item in conflate(dlm, osm):
        anchor = item["geom"].representative_point()
        if not owns(tile.bounds, shapely.get_x(anchor), shapely.get_y(anchor)):
            continue
        features.append(feature(geometry_json(item["geom"]), properties(item)))
    # Stable order: the committed file diffs by feature, not by read order.
    features.sort(key=lambda f: (f["properties"]["kind"], _anchor_key(f["geometry"])))
    credit = GEOSN_ATTRIBUTION + (f"; {OSM_ATTRIBUTION}" if osm else "")
    write_geojson(tile.out("dlm", f"monuments_{tile.id}.geojson"), features, tile.epsg, credit)
    kinds = {k: sum(f["properties"]["kind"] == k for f in features) for k in KINDS}
    print(f"{tile.id}: monuments " + ", ".join(f"{n} {k}" for k, n in kinds.items()))


KINDS = ("fountain", "statue", "stone", "column")


def _anchor_key(geometry: dict) -> tuple[float, float]:
    coords = np.asarray(
        geometry["coordinates"] if geometry["type"] == "Point" else geometry["coordinates"][0][0]
    )
    return float(coords[0]), float(coords[1])
