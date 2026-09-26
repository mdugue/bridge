"""What OSM knows about the LoD2 buildings → flags per CityObject id,
`data/<site>/dlm/osmbuild_<tile>.json`, which the building bake folds into the
object table (like the DOP roof colours):

- `shop`: a shop or a place to eat and drink on the ground floor — an OSM
  point inside the object's footprint (else on the nearest footprint within
  `SNAP_M`: entrances are often mapped on the facade line, which LoD2 and
  OSM do not share to the metre), or an OSM building outline tagged with
  one that covers at least half the footprint. Points tagged on another
  floor (`level` without a 0) are left out.
- `heritage`: an OSM building with `heritage=*` covering at least half
  the footprint.

A marked part marks its root Building too, and the building bake
(`scripts/bake-city-mesh.ts`) hands a root's flags down to every part of it
(the part's own or the root's): a Saxon LoD2 Building with parts has no
geometry of its own, so the whole building shows what one part carries.
OSM's construction dates are too sparse to use (plan 027 phase 3,
rejected): the file carries no era."""

from __future__ import annotations

import json
import re

import numpy as np
import shapely

from .common import OSM_ATTRIBUTION, Tile, column
from .osm import has_extract, read_osm, tag
from .roof_colour import surface_rings

GASTRO = ("cafe", "restaurant", "bar", "pub", "fast_food", "ice_cream", "biergarten")
POINT_WHERE = "other_tags LIKE '%\"shop\"=>%' OR " + " OR ".join(
    f'other_tags LIKE \'%"amenity"=>"{a}"%\'' for a in GASTRO
)
AREA_WHERE = (
    "building IS NOT NULL AND (shop IS NOT NULL OR amenity IN ("
    + ",".join(f"'{a}'" for a in GASTRO)
    + ") OR other_tags LIKE '%\"heritage\"=>%')"
)
SNAP_M = 3.0  # a point this close to a footprint's outline still marks it
MIN_COVER = 0.5  # share of the LoD2 footprint an OSM outline must cover


def on_ground_floor(other_tags: str | None) -> bool:
    """Untagged, or a `level` list that holds the ground floor (0)."""
    level = tag(other_tags, "level")
    if level is None:
        return True
    values = []
    for part in re.split(r"[;,]", level):
        try:
            values.append(float(part.strip()))
        except ValueError:
            continue
    return not values or 0.0 in values


def is_shop(shop: str | None, amenity: str | None) -> bool:
    return bool(shop) and shop != "no" or amenity in GASTRO


def footprints(city: dict) -> tuple[list[str], list[shapely.Geometry]]:
    """Each object's ground footprint in the CityJSON's CRS: its
    GroundSurface rings, else its roof rings seen from above."""
    scale = city.get("transform", {}).get("scale", [1, 1, 1])
    translate = city.get("transform", {}).get("translate", [0, 0, 0])
    xy = np.asarray(city["vertices"], dtype=float)[:, :2] * scale[:2] + translate[:2]
    ids, polys = [], []
    for oid, obj in city["CityObjects"].items():
        geoms = obj.get("geometry", [])
        rings = [r for g in geoms for r in surface_rings(g, "GroundSurface")]
        if not rings:
            rings = [r for g in geoms for r in surface_rings(g, "RoofSurface")]
        parts = [shapely.make_valid(shapely.Polygon(xy[r])) for r in rings if len(r) >= 3]
        poly = shapely.union_all([p for p in parts if p.area > 0]) if parts else None
        if poly is not None and not poly.is_empty and poly.area > 0:
            ids.append(oid)
            polys.append(poly)
    return ids, polys


def root_of(city: dict, oid: str) -> str:
    """Climbs `parents` to the root of the object's building tree."""
    seen = set()
    while oid not in seen:
        seen.add(oid)
        parent = (city["CityObjects"].get(oid, {}).get("parents") or [None])[0]
        if parent is None or parent not in city["CityObjects"]:
            break
        oid = parent
    return oid


def points_on(points, tree: shapely.STRtree) -> list[list[int]]:
    """Per point, the footprint indices it marks: the footprint(s) containing
    it, else the nearest one within SNAP_M, else none."""
    marked = []
    for p in points:
        inside = tree.query(p, predicate="within")
        if len(inside):
            marked.append([int(i) for i in inside])
        else:
            marked.append([int(i) for i in tree.query_nearest(p, max_distance=SNAP_M)[:1]])
    return marked


def covered_by(areas, polys: list[shapely.Geometry], tree: shapely.STRtree) -> list[int]:
    """Footprint indices of which the areas cover at least MIN_COVER."""
    marked = []
    for area in areas:
        area = shapely.make_valid(area)
        for i in tree.query(area, predicate="intersects"):
            poly = polys[int(i)]
            if shapely.intersection(poly, area).area >= MIN_COVER * poly.area:
                marked.append(int(i))
    return marked


def flag(objects: dict, city: dict, oid: str, key: str) -> None:
    """Marks the object and its root Building (the bake hands the root's
    flags down to all its parts)."""
    for target in {oid, root_of(city, oid)}:
        objects.setdefault(target, {})[key] = 1


def shop_points(tile: Tile) -> list[shapely.Geometry]:
    geoms, fields = read_osm(tile, "points", POINT_WHERE, ["other_tags"], margin=0.0005)
    return [
        g
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True)
        if on_ground_floor(other) and is_shop(tag(other, "shop"), tag(other, "amenity"))
    ]


def tagged_outlines(tile: Tile) -> tuple[list, list]:
    """OSM building outlines: (those with a shop, those with heritage)."""
    geoms, fields = read_osm(
        tile, "multipolygons", AREA_WHERE, ["shop", "amenity", "other_tags"], margin=0.0005
    )
    shops, heritage = [], []
    for g, shop, amenity, other in zip(
        geoms,
        column(fields, "shop", geoms),
        column(fields, "amenity", geoms),
        column(fields, "other_tags", geoms),
        strict=True,
    ):
        if is_shop(shop, amenity):
            shops.append(g)
        if tag(other, "heritage") not in (None, "no"):
            heritage.append(g)
    return shops, heritage


def run(tile: Tile) -> None:
    city_path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    if not city_path.exists() or not has_extract(tile, "the OSM building flags"):
        return
    city = json.loads(city_path.read_text())
    ids, polys = footprints(city)
    tree = shapely.STRtree(polys)
    points = shop_points(tile)
    shop_areas, heritage_areas = tagged_outlines(tile)
    objects: dict[str, dict] = {}
    by_point = points_on(points, tree)
    placed = sum(1 for marks in by_point if marks)
    for i in [i for marks in by_point for i in marks] + covered_by(shop_areas, polys, tree):
        flag(objects, city, ids[i], "shop")
    for i in covered_by(heritage_areas, polys, tree):
        flag(objects, city, ids[i], "heritage")
    counts = {
        key: sum(1 for oid in ids if objects.get(oid, {}).get(key)) for key in ("shop", "heritage")
    }
    doc = {
        "attribution": OSM_ATTRIBUTION,
        "meta": {
            "tile": tile.id,
            "shop_points": len(points),
            "shop_points_placed": placed,
            "shop_outlines": len(shop_areas),
            "heritage_outlines": len(heritage_areas),
            "objects_shop": counts["shop"],
            "objects_heritage": counts["heritage"],
        },
        "objects": dict(sorted(objects.items())),
    }
    tile.out("dlm", f"osmbuild_{tile.id}.json").write_text(json.dumps(doc))
    print(
        f"{tile.id}: {counts['shop']} objects with a shop "
        f"({placed} of {len(points)} points placed), {counts['heritage']} listed"
    )
