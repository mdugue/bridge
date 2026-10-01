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
- `name`, `addr`, `levels` — for the inquiry card (ADR 0041): the `name`,
  `addr:street` + `addr:housenumber` and `building:levels` of the OSM
  building outline that covers most of the footprint (at least half);
  where that outline has no address, the address points inside the
  footprint (else on the nearest within `SNAP_M`), grouped by street
  ("Hauptstraße 1, 3"). These stay on the object itself, never its root:
  one LoD2 Building often spans several houses with an address each.
- `material`, `colour`, `roof_colour` (plan 050): what an OSM building or
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
- `context` (the file's default, and per object where its neighbourhood
  differs): the walls a building without a mapped material wears — brick
  where the mapped walls around it (within `VOTE_REACH_M`, weighted by
  distance) are mostly brick, else plaster; with too few mapped neighbours
  the tile's and its surroundings' vote. So Hamburg's Speicherstadt and a
  Ruhr town's terraces come out in brick and HafenCity or a Saxon old town
  in plaster, without a per-site switch.

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
ADDR_WHERE = "other_tags LIKE '%\"addr:housenumber\"=>%'"
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


def address(other_tags: str | None) -> tuple[str, str] | None:
    """(street, house number) from an OSM feature's tags, or None."""
    number = tag(other_tags, "addr:housenumber")
    if not number:
        return None
    street = tag(other_tags, "addr:street") or tag(other_tags, "addr:place") or ""
    return street.strip(), number.strip()


def _number_key(number: str) -> tuple[int, str]:
    digits = re.match(r"\d+", number)
    return (int(digits.group(0)) if digits else 1 << 30, number)


def address_line(addresses: list[tuple[str, str]]) -> str:
    """Addresses as one line: numbers grouped by street in natural order,
    streets in the order first seen ("Hauptstraße 1, 3 · Am Markt 2")."""
    streets: dict[str, set[str]] = {}
    for street, number in addresses:
        streets.setdefault(street, set()).add(number)
    return " · ".join(
        f"{street} {', '.join(sorted(numbers, key=_number_key))}".strip()
        for street, numbers in streets.items()
    )


def levels_of(other_tags: str | None) -> int | None:
    """`building:levels` as a whole number, or None when unreadable."""
    value = tag(other_tags, "building:levels")
    try:
        levels = round(float((value or "").replace(",", ".")))
    except (ValueError, OverflowError):  # "x" or "nan"; "inf" overflows round()
        return None
    return levels if 0 < levels < 200 else None


def building_outlines(tile: Tile) -> tuple[list, list, list]:
    """Every OSM building outline near the tile: geometries, names, tags."""
    geoms, fields = read_osm(
        tile, "multipolygons", "building IS NOT NULL", ["name", "other_tags"], margin=0.0005
    )
    return list(geoms), column(fields, "name", geoms), column(fields, "other_tags", geoms)


def describe(objects: dict, ids: list[str], polys: list, tree: shapely.STRtree, tile: Tile) -> None:
    """Name, address and storeys per object from the outline covering most
    of its footprint, and the address points on it (see the module doc)."""
    geoms, names, others = building_outlines(tile)
    best: dict[int, tuple[float, int]] = {}
    for j, g in enumerate(geoms):
        g = shapely.make_valid(g)
        for i in tree.query(g, predicate="intersects"):
            i = int(i)
            cover = shapely.intersection(polys[i], g).area / polys[i].area
            if cover >= MIN_COVER and cover > best.get(i, (0.0, -1))[0]:
                best[i] = (cover, j)
    points, fields = read_osm(tile, "points", ADDR_WHERE, ["other_tags"], margin=0.0005)
    on: dict[int, list[tuple[str, str]]] = {}
    tags = column(fields, "other_tags", points)
    for marks, other in zip(points_on(points, tree), tags, strict=True):
        found = address(other)
        for i in marks if found else []:
            on.setdefault(i, []).append(found)
    for i, oid in enumerate(ids):
        facts: dict = {}
        if i in best:
            j = best[i][1]
            if names[j]:
                facts["name"] = str(names[j]).strip()
            if (found := address(others[j])) is not None:
                facts["addr"] = address_line([found])
            if (levels := levels_of(others[j])) is not None:
                facts["levels"] = levels
        if "addr" not in facts and i in on:
            facts["addr"] = address_line(on[i])
        if facts:
            objects.setdefault(oid, {}).update(facts)


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


def look_outlines(tile: Tile, margin: float = 0.0005) -> list[tuple[shapely.Geometry, dict, bool]]:
    """OSM outlines that say what a building looks like: (outline, its look,
    whether it is a building part)."""
    geoms, fields = read_osm(
        tile, "multipolygons", LOOK_WHERE, ["building", "other_tags"], margin=margin
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


# The walls a building without a mapped material wears: what its
# neighbourhood is mapped as. Brick votes brick; plaster, stone, concrete and
# wood vote against it; glass and metal (curtain walls) do not vote.
VOTE_REACH_M = 300.0  # the neighbourhood (m)
VOTE_MIN_LOCAL = 6  # votes a neighbourhood needs to speak for itself
VOTE_MIN_AREA = 20  # ... and the tile with its surroundings
VOTE_SOFT_M = 50.0  # a vote weighs 1 / (distance + this)
VOTE_MARGIN = 0.005  # how far around the tile votes are read (deg, ≈ 350 m)
WALL_VOTES = {"brick": 1.0, "plaster": 0.0, "stone": 0.0, "concrete": 0.0, "wood": 0.0}


def brick_votes(outlines) -> np.ndarray:
    """(x, y, 1 for brick / 0 for other walls) of the outlines that vote."""
    rows = [
        (*g.representative_point().coords[0], WALL_VOTES[look["material"]])
        for g, look, _ in outlines
        if look.get("material") in WALL_VOTES
    ]
    return np.array(rows, dtype=np.float64).reshape(-1, 3)


def area_context(votes: np.ndarray) -> str:
    """The walls of the area as a whole: brick when most votes say so."""
    if len(votes) < VOTE_MIN_AREA:
        return "render"
    return "brick" if votes[:, 2].mean() >= 0.5 else "render"


def local_contexts(centres: np.ndarray, votes: np.ndarray, default: str) -> list[str]:
    """Each centre's walls by its neighbourhood's distance-weighted vote; the
    area's where too few neighbours are mapped."""
    out = []
    for x, y in centres:
        d = np.hypot(votes[:, 0] - x, votes[:, 1] - y) if len(votes) else np.empty(0)
        near = d <= VOTE_REACH_M
        if near.sum() < VOTE_MIN_LOCAL:
            out.append(default)
            continue
        w = 1.0 / (d[near] + VOTE_SOFT_M)
        out.append("brick" if (w * votes[near, 2]).sum() / w.sum() >= 0.5 else "render")
    return out


def apply_contexts(objects: dict, ids, polys, outlines) -> tuple[str, int]:
    """The tile's default walls and, on the objects whose neighbourhood
    differs from it, their own (`context`); objects with a mapped material
    keep theirs. Returns the default and how many objects differ."""
    votes = brick_votes(outlines)
    default = area_context(votes)
    centres = np.array([p.representative_point().coords[0] for p in polys]).reshape(-1, 2)
    differ = 0
    for oid, ctx in zip(ids, local_contexts(centres, votes, default), strict=True):
        if ctx != default and not objects.get(oid, {}).get("material"):
            objects.setdefault(oid, {})["context"] = ctx
            differ += 1
    return default, differ


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
    describe(objects, ids, polys, tree, tile)
    outlines = look_outlines(tile, VOTE_MARGIN)
    looks = apply_looks(objects, city, ids, polys, tree, outlines)
    context, differ = apply_contexts(objects, ids, polys, outlines)
    counts = {
        key: sum(1 for oid in ids if objects.get(oid, {}).get(key))
        for key in ("shop", "heritage", "name", "addr", "levels")
    }
    doc = {
        "attribution": OSM_ATTRIBUTION,
        "context": context,
        "meta": {
            "tile": tile.id,
            "shop_points": len(points),
            "shop_points_placed": placed,
            "shop_outlines": len(shop_areas),
            "heritage_outlines": len(heritage_areas),
            "objects_shop": counts["shop"],
            "objects_heritage": counts["heritage"],
            "objects_named": counts["name"],
            "objects_addressed": counts["addr"],
            "objects_levels": counts["levels"],
            "objects_look": looks,
            "objects_context": differ,
        },
        "objects": dict(sorted(objects.items())),
    }
    tile.out("dlm", f"osmbuild_{tile.id}.json").write_text(json.dumps(doc))
    print(
        f"{tile.id}: {counts['shop']} objects with a shop "
        f"({placed} of {len(points)} points placed), {counts['heritage']} listed, "
        f"{counts['addr']} addressed, {counts['name']} named, {counts['levels']} with storeys, "
        f"{looks} with a material or colour, walls {context} "
        f"({differ} objects with their neighbourhood's own)"
    )
