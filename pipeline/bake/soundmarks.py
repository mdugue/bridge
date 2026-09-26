"""Churches with a bell tower → `data/dlm/soundmarks_<tile>.geojson`, the
points the hidden soundscape (plan 035) strikes the full hour from.

OSM says which buildings are churches — `building=church|cathedral|chapel`,
or an outline tagged `amenity=place_of_worship` + `religion=christian` —
and which stand-alone towers carry bells (`man_made=tower` with
`tower:type=bell_tower`, `building=bell_tower`). It does not say where on a
church the tower stands, nor how tall it is; the committed LoD2 does: the
highest LoD2 vertex inside the outline (1 m around it) is the tower's tip,
and its height above the DGM1 is the tower's height. A church whose tip
stands less than `TOWER_MIN_M` above the ground has no tower worth a bell
(a chapel, a hall church with a ridge turret); a church outside the LoD2
(no vertex inside) keeps its outline's point with no height and is left
out too — nothing is invented.

The size class follows the height (the deeper bell hangs in the taller
tower): `large` from `LARGE_M`, `medium` from `MEDIUM_M`, else `small`. A
bell tower within `SAME_TOWER_M` of a church's tip is that church's. Each
tile writes what it owns (the tip; west/south edges in), so a church on a
seam rings once. A tile without a church writes an empty collection."""

from __future__ import annotations

import json

import numpy as np
import rasterio
import shapely

from .common import OSM_ATTRIBUTION, Tile, column, feature, owns, write_geojson
from .osm import has_extract, read_osm, tag
from .skyview import overlaps, site_sources

GEOSN_HEIGHTS = "tower heights: Quelle: GeoSN, dl-de/by-2-0"
CHURCH_BUILDINGS = ("church", "cathedral", "chapel")
CHURCH_WHERE = (
    "building IN ('church', 'cathedral', 'chapel', 'bell_tower') "
    "OR amenity = 'place_of_worship' "
    "OR (man_made = 'tower' AND other_tags LIKE '%\"tower:type\"=>\"bell_tower\"%')"
)
TOWER_POINT_WHERE = "man_made = 'tower' AND other_tags LIKE '%\"tower:type\"=>\"bell_tower\"%'"
TOWER_MIN_M = 22.0  # a tip lower than this above the ground carries no bell worth hearing
MEDIUM_M = 40.0
LARGE_M = 65.0
REACH_M = 1.0  # LoD2 vertices this far outside the OSM outline still count
SAME_TOWER_M = 30.0
MARGIN_DEG = 0.001  # read margin around the tile (≈ 70–110 m)


def size_class(height: float) -> str:
    if height >= LARGE_M:
        return "large"
    return "medium" if height >= MEDIUM_M else "small"


def is_church(building: str | None, amenity: str | None, other: str | None) -> bool:
    if building in CHURCH_BUILDINGS:
        return True
    return amenity == "place_of_worship" and tag(other, "religion") == "christian"


def is_bell_tower(building: str | None, man_made: str | None, other: str | None) -> bool:
    return building == "bell_tower" or (
        man_made == "tower" and tag(other, "tower:type") == "bell_tower"
    )


class Lod2:
    """Every committed tile's LoD2 vertices (absolute coordinates, read when
    an outline first reaches the tile) and DGMs, to find a tower's tip and
    its height above the ground — a church on a seam finds its tip in the
    neighbour's LoD2."""

    def __init__(self, tile: Tile) -> None:
        self.data = tile.data
        self.sources = site_sources(tile)
        self._xyz: dict[str, np.ndarray] = {}

    def _vertices(self, tid: str) -> np.ndarray:
        if tid not in self._xyz:
            path = self.data / "cityjson" / f"lod2_{tid}.city.json"
            xyz = np.zeros((0, 3))
            if path.exists():
                city = json.loads(path.read_text())
                t = city.get("transform", {})
                scale = np.asarray(t.get("scale", [1, 1, 1]), dtype=float)
                translate = np.asarray(t.get("translate", [0, 0, 0]), dtype=float)
                xyz = np.asarray(city["vertices"], dtype=float) * scale + translate
            self._xyz[tid] = xyz
        return self._xyz[tid]

    def ground(self, x: float, y: float) -> float | None:
        for tid, b in self.sources:
            if not owns(b, x, y):
                continue
            path = self.data / "dgm" / f"dgm1_{tid}_tiff" / f"dgm1_{tid}.tif"
            with rasterio.open(path) as ds:
                value = float(next(ds.sample([(x, y)]))[0])
                nodata = ds.nodata
            return None if nodata is not None and value == nodata else value
        return None

    def tip(self, outline: shapely.Geometry) -> tuple[float, float, float] | None:
        """The highest vertex inside the outline (REACH_M around it)."""
        area = outline.buffer(REACH_M)
        xmin, ymin, xmax, ymax = area.bounds
        best: np.ndarray | None = None
        for tid, b in self.sources:
            if not overlaps(b, area.bounds):
                continue
            xyz = self._vertices(tid)
            box = (
                (xyz[:, 0] >= xmin)
                & (xyz[:, 0] <= xmax)
                & (xyz[:, 1] >= ymin)
                & (xyz[:, 1] <= ymax)
            )
            near = xyz[box]
            inside = near[shapely.contains_xy(area, near[:, 0], near[:, 1])] if len(near) else near
            if len(inside) == 0:
                continue
            top = inside[int(np.argmax(inside[:, 2]))]
            if best is None or top[2] > best[2]:
                best = top
        return None if best is None else (float(best[0]), float(best[1]), float(best[2]))


def candidates(tile: Tile) -> tuple[list[dict], list[shapely.Geometry]]:
    """The church outlines (with their names) and the bell towers (outlines
    or points) around the tile."""
    geoms, fields = read_osm(
        tile,
        "multipolygons",
        CHURCH_WHERE,
        ["name", "building", "amenity", "man_made", "other_tags"],
        margin=MARGIN_DEG,
    )
    churches, towers = [], []
    for g, name, building, amenity, man_made, other in zip(
        geoms,
        column(fields, "name", geoms),
        column(fields, "building", geoms),
        column(fields, "amenity", geoms),
        column(fields, "man_made", geoms),
        column(fields, "other_tags", geoms),
        strict=True,
    ):
        if g is None or g.is_empty:
            continue
        if is_bell_tower(building, man_made, other):
            towers.append(g)
        elif is_church(building, amenity, other):
            churches.append({"geom": shapely.make_valid(g), "name": name or None})
    points, _ = read_osm(tile, "points", TOWER_POINT_WHERE, ["man_made"], margin=MARGIN_DEG)
    towers.extend(p for p in points if p is not None and not p.is_empty)
    return churches, towers


def dedupe_outlines(churches: list[dict]) -> list[dict]:
    """A place_of_worship outline over a church building is the same church:
    keep the larger outline (and the first name seen)."""
    kept: list[dict] = []
    for c in sorted(churches, key=lambda c: -c["geom"].area):
        twin = next(
            (k for k in kept if k["geom"].intersection(c["geom"]).area >= 0.5 * c["geom"].area),
            None,
        )
        if twin is None:
            kept.append(dict(c))
        elif twin["name"] is None:
            twin["name"] = c["name"]
    return kept


def soundmark(
    tip: tuple[float, float, float], ground: float | None, name: str | None
) -> dict | None:
    if ground is None:
        return None
    height = tip[2] - ground
    if height < TOWER_MIN_M:
        return None
    props: dict = {"k": "bell", "h": round(height, 1), "size": size_class(height)}
    if name:
        props["name"] = name
    return {"x": tip[0], "y": tip[1], "props": props}


def towers_of(tile: Tile, lod2: Lod2) -> list[dict]:
    churches, bell_towers = candidates(tile)
    marks: list[dict] = []
    for church in dedupe_outlines(churches):
        tip = lod2.tip(church["geom"])
        if tip is not None:
            mark = soundmark(tip, lod2.ground(tip[0], tip[1]), church["name"])
            if mark:
                marks.append(mark)
    for tower in bell_towers:
        outline = tower if tower.geom_type != "Point" else tower.buffer(4.0)
        tip = lod2.tip(outline)
        if tip is None:
            continue
        if any(np.hypot(m["x"] - tip[0], m["y"] - tip[1]) <= SAME_TOWER_M for m in marks):
            continue
        mark = soundmark(tip, lod2.ground(tip[0], tip[1]), None)
        if mark:
            marks.append(mark)
    return marks


def run(tile: Tile) -> None:
    if not has_extract(tile, "the soundmarks"):
        return
    marks = [m for m in towers_of(tile, Lod2(tile)) if owns(tile.bounds, m["x"], m["y"])]
    marks.sort(key=lambda m: (-m["props"]["h"], m["x"]))
    features = [
        feature(
            {"type": "Point", "coordinates": [round(m["x"], 2), round(m["y"], 2)]},
            m["props"],
        )
        for m in marks
    ]
    write_geojson(
        tile.out("dlm", f"soundmarks_{tile.id}.geojson"),
        features,
        tile.epsg,
        f"{OSM_ATTRIBUTION}; {GEOSN_HEIGHTS}",
    )
    sizes = {
        s: sum(1 for m in marks if m["props"]["size"] == s) for s in ("large", "medium", "small")
    }
    print(
        f"{tile.id}: {len(marks)} bell towers ({sizes['large']} large, "
        f"{sizes['medium']} medium, {sizes['small']} small)"
    )
