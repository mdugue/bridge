"""OSM's mapped entrances → doors on the LoD2 walls, `data/<site>/dlm/
doors_<tile>.geojson`, which the building bake (`scripts/bake-city-mesh.ts`)
draws as part of the building they open (a surround and a leaf).

An `entrance=*` node is snapped onto the nearest LoD2 footprint edge within
`SNAP_M` (OSM maps entrances on its own facade line, which LoD2 does not
share to the metre); a node farther from every wall, on an edge too short
for the door, on a wall too low for it, or tagged on another floor (`level`
without a 0) is dropped. Each door is a point on the wall with the outward
normal (`nx`, `ny`), its width and height (`w`, `h`, from `width`/`height`
where plausible, else by kind), the ground under its sill (`z`: the lowest
DGM1 sample in front of it) and the LoD2 object it belongs to (`of`).

Only the tile's own entrances (the west and south edges in). One door per
`MIN_GAP_M` of wall: entrances mapped twice on one doorway (a node per
leaf, an `entrance` and a `door`) are one door. Never an invented door: a
building without a mapped entrance gets none, and an edge whose outside
lies in another footprint (a party wall) opens no door."""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
import shapely

from .common import OSM_ATTRIBUTION, Tile, column, feature, owns, write_geojson
from .osm import has_extract, read_osm, tag
from .osm_buildings import footprints

SNAP_M = 3.0
# two entrances closer than this along one wall are one doorway
MIN_GAP_M = 1.2
# the surround's jambs (lib/city/doors.ts DOOR_SURROUND.width)
SURROUND_M = 0.2
# what the door stands clear of: the wall's corners, the eave
CORNER_M = 0.25
HEAD_M = 0.6
# the ground is read this far in front of the wall (the DGM rounds the
# plinth into the street; the street side is where the sill meets it)
FRONT_M = 0.8
WHERE = "other_tags LIKE '%\"entrance\"=>%'"
# (width, height) in metres by `entrance=*`: a main entrance is a portal, a
# garage a wide low door, the rest a house door
SIZES = {
    "main": (1.8, 3.0),
    "garage": (2.6, 2.2),
    "service": (1.1, 2.3),
    "emergency": (1.0, 2.2),
    "exit": (1.0, 2.2),
}
DEFAULT_SIZE = (1.2, 2.5)
SKIP = {"no", "entry_only", "emergency_ward_entrance"}


def on_ground_floor(other_tags: str | None) -> bool:
    level = tag(other_tags, "level")
    if level is None:
        return True
    return "0" in [p.strip() for p in level.replace(",", ";").split(";")]


def measure(other_tags: str | None, key: str, low: float, high: float) -> float | None:
    """A length tag (`1.4`, `1,4 m`) when it lies in [low, high], else None."""
    value = (tag(other_tags, key) or "").replace(",", ".").removesuffix("m").strip()
    try:
        number = float(value)
    except ValueError:
        return None
    return number if low <= number <= high else None


def size_of(other_tags: str | None) -> tuple[float, float]:
    kind = tag(other_tags, "entrance") or "yes"
    w, h = SIZES.get(kind, DEFAULT_SIZE)
    return (
        measure(other_tags, "width", 0.7, 6.0) or w,
        measure(other_tags, "height", 1.8, 5.0) or h,
    )


def snap(
    point: shapely.Point, poly: shapely.Geometry
) -> tuple[float, float, float, float, float] | None:
    """The nearest point on the footprint's boundary: (x, y, outward nx, ny,
    the room along that edge to its nearer corner)."""
    best = None
    rings = [poly] if poly.geom_type == "Polygon" else list(poly.geoms)
    for part in rings:
        for ring in [part.exterior, *part.interiors]:
            xy = np.asarray(ring.coords)
            for (ax, ay), (bx, by) in zip(xy[:-1], xy[1:], strict=True):
                dx, dy = bx - ax, by - ay
                length = math.hypot(dx, dy)
                if length < 1e-6:
                    continue
                t = ((point.x - ax) * dx + (point.y - ay) * dy) / (length * length)
                t = min(max(t, 0.0), 1.0)
                px, py = ax + t * dx, ay + t * dy
                d = math.hypot(point.x - px, point.y - py)
                if best is None or d < best[0]:
                    room = min(t, 1 - t) * length
                    best = (d, px, py, dy / length, -dx / length, room)
    if best is None:
        return None
    _, px, py, nx, ny, room = best
    # outward: the side away from the footprint
    if poly.contains(shapely.Point(px + nx * 0.2, py + ny * 0.2)):
        nx, ny = -nx, -ny
    return px, py, nx, ny, room


def object_heights(city: dict) -> dict[str, float]:
    """Each object's height from its lowest vertex to its highest: what a
    door with its head room must fit under."""
    scale = city.get("transform", {}).get("scale", [1, 1, 1])[2]
    shift = city.get("transform", {}).get("translate", [0, 0, 0])[2]
    z = np.asarray(city["vertices"], dtype=float)[:, 2] * scale + shift
    out: dict[str, float] = {}
    for oid, obj in city["CityObjects"].items():
        idx = [i for g in obj.get("geometry", []) for i in _indices(g["boundaries"])]
        if idx:
            out[oid] = float(z[idx].max() - z[idx].min())
    return out


def _indices(nested) -> list[int]:
    if isinstance(nested, int):
        return [nested]
    return [i for item in nested for i in _indices(item)]


def ground(dgm, x: float, y: float, nx: float, ny: float, w: float) -> float | None:
    """The lowest DGM1 sample in front of the door, across its surround: at
    the wall's foot and a step out into the street."""
    tx, ty = -ny, nx
    reach = w / 2 + SURROUND_M
    samples = [
        (x + nx * d + tx * s, y + ny * d + ty * s)
        for d in (0.1, FRONT_M)
        for s in (-reach, 0.0, reach)
    ]
    values = [float(v[0]) for v in dgm.sample(samples)]
    values = [v for v in values if v > -1000 and math.isfinite(v)]
    return min(values) if values else None


def run(tile: Tile) -> None:
    city_path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    if not city_path.exists() or not tile.dgm.exists() or not has_extract(tile, "the doors"):
        return
    city = json.loads(city_path.read_text())
    ids, polys = footprints(city)
    tree = shapely.STRtree(polys)
    heights = object_heights(city)
    geoms, fields = read_osm(tile, "points", WHERE, ["other_tags"], margin=0.0005)
    placed: list[tuple[float, float, dict]] = []
    dropped = 0
    with rasterio.open(tile.dgm) as dgm:
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            door = place(g, other, ids, polys, tree, heights, dgm)
            if door is None or not owns(tile.bounds, door[0], door[1]):
                dropped += door is None
                continue
            if any(math.hypot(door[0] - x, door[1] - y) < MIN_GAP_M for x, y, _ in placed):
                continue
            placed.append(door)
    placed.sort(key=lambda d: (round(d[1], 2), round(d[0], 2)))
    features = [
        feature({"type": "Point", "coordinates": [round(x, 2), round(y, 2)]}, props)
        for x, y, props in placed
    ]
    write_geojson(tile.out("dlm", f"doors_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    print(f"{tile.id}: {len(features)} doors ({dropped} entrances on no LoD2 wall)")


def place(g, other, ids, polys, tree, heights, dgm) -> tuple[float, float, dict] | None:
    kind = tag(other, "entrance")
    if g.geom_type != "Point" or kind in SKIP or not on_ground_floor(other):
        return None
    near = tree.query_nearest(g, max_distance=SNAP_M)
    if len(near) == 0:
        return None
    i = int(near[0])
    snapped = snap(g, polys[i])
    if snapped is None:
        return None
    x, y, nx, ny, room = snapped
    # a party wall or a courtyard edge between two footprints opens onto
    # another building, not the street
    if len(tree.query(shapely.Point(x + nx * 0.5, y + ny * 0.5), predicate="within")):
        return None
    w, h = size_of(other)
    # a door narrower than its wall's room to the corner, never past it
    w = min(w, 2 * (room - CORNER_M))
    eave = heights.get(ids[i], 0.0)
    if w < 0.7 or h + HEAD_M > eave:
        return None
    z = ground(dgm, x, y, nx, ny, w)
    if z is None:
        return None
    props = {
        "of": ids[i],
        "kind": kind or "yes",
        "nx": round(nx, 4),
        "ny": round(ny, 4),
        "w": round(w, 2),
        "h": round(h, 2),
        "z": round(z, 2),
    }
    return x, y, props
