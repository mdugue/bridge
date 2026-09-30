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
- `material`, `colour`, `roof_colour` (plan 038): what an OSM building or
  building part covering at least half the footprint says its walls are
  made of (`building:material`, `building:facade:material`,
  `facade:material`, normalised to glass, metal, brick, stone, concrete,
  wood or plaster) and what colour its walls and roof are
  (`building:colour`, `roof:colour`, a name or hex, as `#rrggbb`). A part's
  own tags win over its building's. The build turns them into the clay's
  palette (lib/city/building-tint.ts), never into a raw colour.

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
LOOK_KEYS = (
    "building:material",
    "building:facade:material",
    "facade:material",
    "building:colour",
    "roof:colour",
)
LOOK_WHERE = (
    "(building IS NOT NULL OR other_tags LIKE '%\"building:part\"=>%') AND ("
    + " OR ".join(f"other_tags LIKE '%\"{k}\"=>%'" for k in LOOK_KEYS)
    + ")"
)
# OSM material values → the handful the clay tells apart
MATERIALS = {
    "glass": "glass",
    "metal": "metal",
    "steel": "metal",
    "aluminium": "metal",
    "copper": "metal",
    "zinc": "metal",
    "brick": "brick",
    "clinker": "brick",
    "stone": "stone",
    "sandstone": "stone",
    "limestone": "stone",
    "granite": "stone",
    "marble": "stone",
    "concrete": "concrete",
    "reinforced_concrete": "concrete",
    "wood": "wood",
    "timber_framing": "wood",
    "plaster": "plaster",
    "render": "plaster",
    "stucco": "plaster",
}
# the colour names OSM mappers use (CSS names), as sRGB
COLOUR_NAMES = {
    "white": "#ffffff",
    "black": "#000000",
    "grey": "#808080",
    "gray": "#808080",
    "silver": "#c0c0c0",
    "lightgrey": "#d3d3d3",
    "lightgray": "#d3d3d3",
    "darkgrey": "#a9a9a9",
    "darkgray": "#a9a9a9",
    "red": "#ff0000",
    "darkred": "#8b0000",
    "maroon": "#800000",
    "brown": "#a52a2a",
    "sienna": "#a0522d",
    "orange": "#ffa500",
    "yellow": "#ffff00",
    "beige": "#f5f5dc",
    "tan": "#d2b48c",
    "wheat": "#f5deb3",
    "ivory": "#fffff0",
    "cream": "#fffdd0",
    "green": "#008000",
    "darkgreen": "#006400",
    "olive": "#808000",
    "blue": "#0000ff",
    "lightblue": "#add8e6",
    "navy": "#000080",
    "teal": "#008080",
    "pink": "#ffc0cb",
    "purple": "#800080",
    "gold": "#ffd700",
}
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


def material_of(other_tags: str | None) -> str | None:
    for key in ("building:material", "building:facade:material", "facade:material"):
        value = (tag(other_tags, key) or "").split(";")[0].strip().lower()
        if value in MATERIALS:
            return MATERIALS[value]
    return None


def colour_of(value: str | None) -> str | None:
    """An OSM colour (a CSS name or #rgb / #rrggbb) as `#rrggbb`, or None."""
    if not value:
        return None
    v = value.split(";")[0].strip().lower().replace(" ", "")
    v = COLOUR_NAMES.get(v, v)
    if re.fullmatch(r"#[0-9a-f]{3}", v):
        v = "#" + "".join(c * 2 for c in v[1:])
    return v if re.fullmatch(r"#[0-9a-f]{6}", v) else None


def look_outlines(tile: Tile) -> list[tuple[shapely.Geometry, dict, bool]]:
    """OSM outlines that say what a building looks like: (outline, its look,
    whether it is a building part)."""
    geoms, fields = read_osm(
        tile, "multipolygons", LOOK_WHERE, ["building", "other_tags"], margin=0.0005
    )
    out = []
    for g, building, other in zip(
        geoms, column(fields, "building", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        look = {
            "material": material_of(other),
            "colour": colour_of(tag(other, "building:colour")),
            "roof_colour": colour_of(tag(other, "roof:colour")),
        }
        look = {k: v for k, v in look.items() if v}
        if look and g is not None:
            out.append((g, look, building is None and tag(other, "building:part") is not None))
    return out


def apply_looks(objects: dict, city: dict, ids, polys, tree, outlines) -> int:
    """Writes the looks onto the objects they cover: buildings first, then
    parts, so a part's own tags win. Returns how many objects got one."""
    touched = set()
    for want_part in (False, True):
        for g, look, is_part in outlines:
            if is_part != want_part:
                continue
            for i in covered_by([g], polys, tree):
                objects.setdefault(ids[i], {}).update(look)
                touched.add(ids[i])
    return len(touched)


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
    looks = apply_looks(objects, city, ids, polys, tree, look_outlines(tile))
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
            "objects_look": looks,
        },
        "objects": dict(sorted(objects.items())),
    }
    tile.out("dlm", f"osmbuild_{tile.id}.json").write_text(json.dumps(doc))
    print(
        f"{tile.id}: {counts['shop']} objects with a shop "
        f"({placed} of {len(points)} points placed), {counts['heritage']} listed, "
        f"{looks} with a material or colour"
    )
