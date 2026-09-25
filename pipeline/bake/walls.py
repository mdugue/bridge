"""OSM walls → wall lines with a kind and a height (retaining walls, city
walls, walls, embankments, cliffs), clipped to the tile. The terrain bake
burns the tall ones into the heightfield as breaklines; the viewer stands a
ribbon on each.

The same file carries the fences and railings (`barrier=fence/handrail`,
`{kind: "fence", type, h}`) and, after them, the gates that stand on a wall
or fence line (`{kind: "gate", w, on}`, points), so the fine terrain bake
can cut each gate's gap. Fences never reshape the ground and never snap to
a step: they stand on their OSM line (plan 029). The walls come first and
in their old order — the terrain study addresses them by index."""

from __future__ import annotations

import re

import shapely

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, owns, write_geojson
from .osm import has_extract, read_osm, tag

CLIFF = 'other_tags LIKE \'%"natural"=>"cliff"%\''
WHERE = f"barrier IN ('retaining_wall','city_wall','wall') OR man_made = 'embankment' OR {CLIFF}"
DEFAULT_H = {
    "city_wall": 6.0,
    "retaining_wall": 3.0,
    "wall": 1.5,
    "embankment": 2.5,
    "cliff": 3.0,
}

FENCE_WHERE = "barrier IN ('fence','handrail')"
# fence_type → the panel the viewer draws; untagged reads as Dresden's
# default wrought-iron railing.
FENCE_TYPES = {
    "railing": "railing",
    "metal": "railing",
    "bars": "railing",
    "metal_bars": "railing",
    "wire": "mesh",
    "chain_link": "mesh",
    "chain": "mesh",
    "temporary": "mesh",
    "wood": "picket",
    "split_rail": "picket",
    "pales": "picket",
}
FENCE_H = 1.2  # m, an untagged fence
HANDRAIL_H = 1.0  # m, a handrail (posts and a rail, no panel)

GATE_WHERE = "barrier IN ('gate','lift_gate','swing_gate','cycle_barrier')"
GATE_W = 1.2  # m, an untagged gate
GATE_W_LIFT = 4.0  # m, a lift gate's boom
GATE_ON_M = 0.5  # a gate this close to a wall or fence line stands on it


def kind_of(barrier: str | None, man_made: str | None, other_tags: str | None) -> str:
    if barrier or man_made:
        return barrier or man_made
    return "cliff" if tag(other_tags, "natural") == "cliff" else "wall"


def number(value: str | None) -> float | None:
    num = re.search(r"[-+]?\d*\.?\d+", value or "")
    return float(num.group()) if num else None


def height(other_tags: str | None) -> float | None:
    for key in ("height", "est_height"):
        value = number(tag(other_tags, key))
        if value is not None:
            return max(0.5, min(value, 30.0))
    return None


def fence_type(barrier: str | None, other_tags: str | None) -> str:
    if barrier == "handrail":
        return "rail"
    return FENCE_TYPES.get(tag(other_tags, "fence_type") or "", "railing")


def fence_height(barrier: str | None, other_tags: str | None) -> float:
    tagged = number(tag(other_tags, "height"))
    if tagged is not None and 0.3 <= tagged <= 4.0:
        return tagged
    return HANDRAIL_H if barrier == "handrail" else FENCE_H


def gate_width(barrier: str | None, other_tags: str | None) -> float:
    tagged = number(tag(other_tags, "width"))
    if tagged is not None and 0.5 <= tagged <= 12.0:
        return tagged
    return GATE_W_LIFT if barrier == "lift_gate" else GATE_W


def lines_of(geom: shapely.Geometry) -> list[shapely.Geometry]:
    """Lines as they are; polygons as their exterior rings (holes are no walls)."""
    out = []
    for part in shapely.get_parts(geom):
        if part.is_empty:  # a polygon clipped away entirely
            continue
        if isinstance(part, shapely.Polygon):
            out.append(part.exterior)
        elif isinstance(part, shapely.LineString) and len(part.coords) >= 2:
            out.append(part)
    return out


def _walls(tile: Tile, box: shapely.Geometry) -> tuple[list[dict], list]:
    """The wall features and every wall line near the tile (for the gates)."""
    features, near = [], []
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, WHERE, ["barrier", "man_made", "other_tags"])
        for g, barrier, man_made, other in zip(
            geoms,
            column(fields, "barrier", geoms),
            column(fields, "man_made", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        ):
            kind = kind_of(barrier, man_made, other)
            h = height(other) or DEFAULT_H.get(kind, 2.0)
            near.extend(lines_of(g))
            for line in lines_of(shapely.intersection(g, box)):
                features.append(
                    feature(
                        geometry_json(shapely.LineString(line.coords)),
                        {"kind": kind, "h": round(h, 1)},
                    )
                )
    return features, near


def _fences(tile: Tile, box: shapely.Geometry) -> tuple[list[dict], list]:
    """The fence features and every fence line near the tile (for the gates)."""
    features, near = [], []
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, FENCE_WHERE, ["barrier", "other_tags"])
        for g, barrier, other in zip(
            geoms,
            column(fields, "barrier", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        ):
            props = {
                "kind": "fence",
                "type": fence_type(barrier, other),
                "h": round(fence_height(barrier, other), 1),
            }
            near.extend(lines_of(g))
            for line in lines_of(shapely.intersection(g, box)):
                features.append(feature(geometry_json(shapely.LineString(line.coords)), props))
    return features, near


def gates_on(points, fields, walls: list, fences: list, bounds) -> list[dict]:
    """The gates the tile owns that stand on a wall or fence line (within
    GATE_ON_M; a fence wins a tie), snapped onto it. Gates on no line are
    dropped: without one there is no gap to cut."""
    fence_tree = shapely.STRtree(fences) if fences else None
    wall_tree = shapely.STRtree(walls) if walls else None
    out = []
    for p, barrier, other in zip(
        points, column(fields, "barrier", points), column(fields, "other_tags", points), strict=True
    ):
        if not owns(bounds, p.x, p.y):
            continue
        on = None
        for name, tree, lines in (("fence", fence_tree, fences), ("wall", wall_tree, walls)):
            hit = tree.query_nearest(p, max_distance=GATE_ON_M) if tree is not None else []
            if len(hit):
                on = (name, lines[int(hit[0])])
                break
        if on is None:
            continue
        line = on[1]
        snapped = line.interpolate(line.project(p))
        props = {"kind": "gate", "w": round(gate_width(barrier, other), 1), "on": on[0]}
        if barrier != "gate":
            props["type"] = barrier
        out.append(feature(geometry_json(snapped), props))
    return out


def run(tile: Tile) -> None:
    if not has_extract(tile, "the walls"):
        return
    box = shapely.box(*tile.bounds)
    walls, wall_lines = _walls(tile, box)
    fences, fence_lines = _fences(tile, box)
    points, fields = read_osm(tile, "points", GATE_WHERE, ["barrier", "other_tags"])
    gates = gates_on(points, fields, wall_lines, fence_lines, tile.bounds)
    write_geojson(
        tile.out("dlm", f"walls_{tile.id}.geojson"),
        walls + fences + gates,
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    print(f"{tile.id}: {len(walls)} walls, {len(fences)} fences, {len(gates)} gates")
