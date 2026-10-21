"""OSM walls → wall lines with a kind, a height and a material (retaining
walls, city walls, walls, embankments, cliffs), clipped to the tile. The
terrain bake burns the tall ones into the heightfield as breaklines; the
viewer stands a ribbon on each, in its material's tone.

An untagged freestanding wall's height is measured (`SurfaceModel`): the
surface model's top over the wall's low side, the median along the way;
where the measure finds too little open wall, its kind's fallback. A wall's
material (`mat`: concrete, brick, stone, metal or wood) is its tag
(`material`, `wall=*`), else the site's majority (`site_material`).

The same file carries the fences and railings (`barrier=fence/handrail`,
`{kind: "fence", type, h}`) and, after them, the gates that stand on a wall
or fence line (`{kind: "gate", w, on}`, points), so the fine terrain bake
can cut each gate's gap. A gate the neighbour owns whose gap reaches over
the seam comes along as `{seam: true}`, so this tile's piece of the line
is cut too. Fences never reshape the ground and never snap to a step: they
stand on their OSM line (plan 029). The walls come first and in their old
order — the terrain study addresses them by index.

Every line is clipped to the tile as a line: an area's outer ring first,
then the ring cut at the tile edge. Clipping the area as a polygon would
close its ring along the tile edge — a ruler-straight wall or fence on the
seam that stands nowhere."""

from __future__ import annotations

import dataclasses
import re
import warnings
from collections import Counter

import numpy as np
import rasterio
import shapely
import shapely.geometry
from PIL import Image
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import from_origin

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, owns, write_geojson
from .osm import below_ground, has_extract, read_osm, tag

CLIFF = 'other_tags LIKE \'%"natural"=>"cliff"%\''
WHERE = f"barrier IN ('retaining_wall','city_wall','wall') OR man_made = 'embankment' OR {CLIFF}"
# The tag-less height per kind (m): what a wall's kind says when nothing is
# measured (lamps.py reads it for a lamp on a wall, too).
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
# An untagged fence that guards something stands taller (PR #173, B9): a
# railway's (within TALL_RAIL_M of a track for at least half its length)
# and the security fence round a pitch, a school or an industrial site
# (within TALL_AREA_M of one, inside it included, for half its length) —
# 2 m mesh, where a garden's fence stands 1.2 m.
TALL_FENCE_H = 2.0
TALL_RAIL_M = 15.0
TALL_AREA_M = 3.0
TALL_SHARE = 0.5
TALL_TRACKS = ("rail", "light_rail", "narrow_gauge", "subway")
TALL_AREAS = "leisure = 'pitch' OR amenity = 'school' OR landuse = 'industrial'"

GATE_WHERE = "barrier IN ('gate','lift_gate','swing_gate','cycle_barrier')"
GATE_W = 1.2  # m, an untagged gate
GATE_W_LIFT = 4.0  # m, a lift gate's boom
GATE_ON_M = 0.5  # a gate this close to a wall or fence line stands on it

# --- heights (PR #173, B5) -----------------------------------------------------
# An untagged wall stood at its kind's default — 1.5 m for every wall, 6 m
# for every city wall — and the surface model disagrees: the median
# untagged freestanding wall stands 1.9 m in Dresden, 2.2 in Leipzig, 2.6
# in München and Grimma, 1.6 in Meißen and 1.0 in Hamburg (57 % under
# 1.2 m), the noise barriers 2.9–4.8 m, and of the "city walls" Grimma's
# flood wall 2.3–4.2 and Dresden's remnants 0.3–1.1 (2026-10-21). So an
# untagged wall of a kind that stands free (MEASURED_KINDS) is measured:
# every STATION_M along the whole way (its neighbours' rasters too, so both
# tiles of a wall across a seam read the same), the surface model's highest
# cell within TOP_REACH of the line (an OSM line lies within a metre of its
# wall) over the lower of the ground at LOW_REACH (the foot of the taller
# face). A station counts where the wall stands open: on one side at least
# the surface model OPEN_AT_M out lies within OPEN_M of the ground (a crown
# or a roof over both sides hides the wall), no OSM building within
# BUILDING_M (a facade's eaves) and below its class's MAX_STATION_H (a
# crown over one side). With MIN_STATIONS and MIN_SHARE of its stations
# counting, the wall's height is their median; otherwise its class's
# fallback (FALLBACK_H; a plain wall the tile's median measured wall, from
# TILE_MEDIAN_MIN of them). The laser scan's 0.5 m highest return
# (lsc.py's `dsm_050`, where every tile read has one) sees a thin wall's
# coping better than DOM1's 1 m cell, and is preferred. A crown over the
# line reads as a wall as tall as the tree where one side lies open (a
# city wall with a road on one side and its trees on the other measured
# 12 m in Unna): a cell the committed NDVI (ndvi.py, ≈ 2 m) calls a crown,
# CROWN_NDVI or more — a mown lawn reads about 0.33 on its scale — is not
# the wall's top.
MEASURED_KINDS = ("wall", "city_wall")
STATION_M = 1.0
TOP_REACH = (-1.0, -0.5, 0.0, 0.5, 1.0)
LOW_REACH = (-1.5, 0.0, 1.5)
OPEN_AT_M = 2.5
OPEN_M = 0.5
BUILDING_M = 1.0
MIN_STATIONS = 3
MIN_SHARE = 0.3
MIN_MEASURED_H = 0.3
MAX_STATION_H = {"wall": 6.0, "noise_barrier": 8.0, "flood_wall": 8.0, "city_wall": 15.0}
FALLBACK_H = {"noise_barrier": 4.0, "flood_wall": 2.5, "city_wall": 6.0}
TILE_MEDIAN_MIN = 10
MEASURE_REACH_M = 150.0  # how far past the tile a way's stations are read
HISTORIC_WALLS = ("citywalls", "city_wall", "castle_wall")
CROWN_NDVI = 0.45

# --- materials (PR #173, B6) ---------------------------------------------------
# Every wall was drawn in one warm sandstone: right for Dresden's terraces,
# wrong for Hamburg's concrete flood walls, München's and Leipzig's brick,
# Unna's concrete. A wall's tags name its material (`material`, then the
# `wall=*` type); an untagged wall takes the site's majority of its tagged
# walls (`site_material`, by count over the site's tiles: one long wall
# does not decide), and a site with fewer than MIN_TAGGED tagged walls the
# commonest wall material, concrete; an untagged historic city wall
# (`wall_class`) is stone. Glass and plastic (noise barriers'
# panes) say nothing about the tone and count as untagged. The viewer's
# tones are lib/city/walls.ts `WALL_TONES`.
MATERIAL_KINDS = ("wall", "retaining_wall", "city_wall")
MATERIALS = {
    "concrete": "concrete",
    "reinforced_concrete": "concrete",
    "concrete_block": "concrete",
    "brick": "brick",
    "bricks": "brick",
    "clinker": "brick",
    "stone": "stone",
    "sandstone": "stone",
    "granite": "stone",
    "limestone": "stone",
    "masonry": "stone",
    "natural_stone": "stone",
    "rock": "stone",
    "syenite": "stone",
    "porphyry": "stone",
    "steel": "metal",
    "metal": "metal",
    "iron": "metal",
    "aluminium": "metal",
    "wood": "wood",
    "timber": "wood",
}
WALL_TYPES = {
    "flood_wall": "concrete",
    "concrete": "concrete",
    "concrete_panel": "concrete",
    "jersey_barrier": "concrete",
    "brick": "brick",
    "stone": "stone",
    "dry_stone": "stone",
    "stone_wall": "stone",
    "stone_bank": "stone",
    "gabion": "stone",
    "castle_wall": "stone",
}
MIN_TAGGED = 8
DEFAULT_MATERIAL = "concrete"


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


def wall_class(kind: str, other_tags: str | None) -> str:
    """What a freestanding wall is for its measure's cap and its fallback: a
    noise barrier, a flood wall, a historic city wall, or a plain wall (a
    `city_wall` that is no historic one included)."""
    sub = tag(other_tags, "wall") or ""
    if sub in ("noise_barrier", "flood_wall"):
        return sub
    if kind == "city_wall" and (
        (tag(other_tags, "historic") or "") in HISTORIC_WALLS
        or tag(other_tags, "heritage") is not None
    ):
        return "city_wall"
    return "wall"


def material_of(other_tags: str | None) -> str | None:
    """A wall's material from its tags: `material` (or `wall:material`; the
    first known of a list), else its `wall=*` type; None when they say
    nothing about it."""
    for key in ("material", "wall:material"):
        for value in (tag(other_tags, key) or "").lower().split(";"):
            if value.strip() in MATERIALS:
                return MATERIALS[value.strip()]
    return WALL_TYPES.get((tag(other_tags, "wall") or "").lower())


def majority(found: Counter, minimum: int = MIN_TAGGED, default: str = DEFAULT_MATERIAL) -> str:
    """The commonest material of `found` (a tie to the alphabetically first),
    or `default` under `minimum` tagged features."""
    if sum(found.values()) < minimum:
        return default
    return min(found, key=lambda m: (-found[m], m))


def site_extent(tile: Tile) -> Tile:
    """The tile stretched over every tile of its site (`Tile.neighbours`):
    what a site-wide reading (the majority material) reads."""
    bounds = [b for _, b in tile.neighbours()] or [tile.bounds]
    box = (
        min(b[0] for b in bounds),
        min(b[1] for b in bounds),
        max(b[2] for b in bounds),
        max(b[3] for b in bounds),
    )
    return dataclasses.replace(tile, bounds=box)


def site_material(tile: Tile) -> str:
    """The site's majority wall material (`majority` over every tagged wall,
    retaining and city walls included, on the site's tiles)."""
    site = site_extent(tile)
    found: Counter = Counter()
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(site, layer, WHERE, ["barrier", "man_made", "other_tags"])
        for barrier, man_made, other in zip(
            column(fields, "barrier", geoms),
            column(fields, "man_made", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        ):
            if kind_of(barrier, man_made, other) in MATERIAL_KINDS:
                mat = material_of(other)
                if mat:
                    found[mat] += 1
    return majority(found)


def fence_type(barrier: str | None, other_tags: str | None) -> str:
    if barrier == "handrail":
        return "rail"
    return FENCE_TYPES.get(tag(other_tags, "fence_type") or "", "railing")


def fence_height(barrier: str | None, other_tags: str | None, tall: bool = False) -> float:
    """A fence's tagged height (when plausible), else its default: a
    handrail's, a guarding fence's (`tall`: TALL_FENCE_H) or a plain one's."""
    tagged = number(tag(other_tags, "height"))
    if tagged is not None and 0.3 <= tagged <= 4.0:
        return tagged
    if barrier == "handrail":
        return HANDRAIL_H
    return TALL_FENCE_H if tall else FENCE_H


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


def clipped_lines(geom: shapely.Geometry, box: shapely.Geometry) -> list[shapely.Geometry]:
    """The lines of `geom` (its lines, its areas' outer rings) inside the tile.
    Each is cut at the tile edge as a line, and the pieces of one ring that
    meet at its closing vertex are merged back into one line."""
    out = []
    for line in lines_of(geom):
        out.extend(lines_of(shapely.line_merge(shapely.intersection(line, box))))
    return out


# --- the surface model -------------------------------------------------------------


@dataclasses.dataclass
class Grid:
    """A raster over an extent (row 0 = north), NaN where there is no data."""

    z: np.ndarray
    x0: float
    y1: float
    res: float

    def at(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        col = np.floor((x - self.x0) / self.res).astype(np.int64)
        row = np.floor((self.y1 - y) / self.res).astype(np.int64)
        ok = (col >= 0) & (row >= 0) & (row < self.z.shape[0]) & (col < self.z.shape[1])
        out = np.full(np.shape(x), np.nan, dtype=np.float64)
        out[ok] = self.z[row[ok], col[ok]]
        return out


def _mosaic(paths: list, bounds: tuple[float, float, float, float], res: float) -> Grid:
    """The rasters at `paths` mosaicked over `bounds` (band 1, the laser
    scan's `max`), NoData as NaN."""
    sources = [rasterio.open(p) for p in paths]
    try:
        z, _ = merge(sources, bounds=bounds, res=res, nodata=-9999.0, indexes=[1])
    finally:
        for s in sources:
            s.close()
    z = z[0].astype(np.float32)
    z[z < -1000] = np.nan
    return Grid(z, bounds[0], bounds[3], res)


class SurfaceModel:
    """What a wall's measure reads (see the heights' comment above): the
    surface model and the ground over the tile and MEASURE_REACH_M around
    it, and where an OSM building stands (grown by BUILDING_M)."""

    def __init__(
        self, top: Grid, ground: Grid, blocked: Grid, source: str, green: list | None = None
    ) -> None:
        self.top, self.ground, self.blocked, self.source = top, ground, blocked, source
        self.green: list[Grid] = green or []  # the tiles' NDVI rasters

    def greenness(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        """The NDVI at each point (NaN off every raster)."""
        out = np.full(np.shape(x), np.nan)
        for grid in self.green:
            out = np.fmax(out, grid.at(x, y))
        return out

    @classmethod
    def of(cls, tile: Tile) -> SurfaceModel | None:
        """The tile's surface model, or None without DOM1 (or the DGM)."""
        x0, y0, x1, y1 = tile.bounds
        r = MEASURE_REACH_M
        reach = (x0 - r, y0 - r, x1 + r, y1 + r)
        near = [
            (tid, b)
            for tid, b in tile.neighbours() or [(tile.id, tile.bounds)]
            if b[0] < reach[2] and b[2] > reach[0] and b[1] < reach[3] and b[3] > reach[1]
        ] or [(tile.id, tile.bounds)]
        dgms = [tile.data / "dgm" / f"dgm1_{tid}_tiff" / f"dgm1_{tid}.tif" for tid, _ in near]
        lsc = [tile.raw / "lsc" / tid / "dsm_050.tif" for tid, _ in near]
        dom = [tile.raw / "dom1" / f"{tid}.tif" for tid, _ in near]
        if not tile.raw_raster("dom1").exists() and not lsc[0].exists():
            print(f"{tile.id}: no DOM1 — untagged walls keep their kind's height")
            return None
        if all(p.exists() for p in lsc):
            source, top = "lsc", _mosaic(lsc, reach, 0.5)
        else:
            source, top = "dom1", _mosaic([p for p in dom if p.exists()], reach, 1.0)
        ground = _mosaic([p for p in dgms if p.exists()], reach, 1.0)
        n = ground.z.shape
        mask = np.zeros(n, dtype=np.uint8)
        geoms, _ = read_osm(tile, "multipolygons", "building IS NOT NULL", ["building"], 0.003)
        shapes = [shapely.buffer(g, BUILDING_M) for g in geoms if g is not None and not g.is_empty]
        if shapes:
            rasterize(
                ((g, 1) for g in shapes),
                out=mask,
                transform=from_origin(reach[0], reach[3], 1.0, 1.0),
            )
        green = []
        for tid, b in near:
            png = tile.data / "dlm" / f"ndvi_{tid}.png"
            if png.exists():
                z = np.asarray(Image.open(png).convert("L"), dtype=np.float32) / 255.0
                green.append(Grid(z, b[0], b[3], (b[2] - b[0]) / z.shape[1]))
        return cls(top, ground, Grid(mask, reach[0], reach[3], 1.0), source, green)

    def stations(self, line: shapely.Geometry) -> np.ndarray:
        """Each station's height (top over the low side; NaN where it does not
        count by the open-side and building tests)."""
        length = line.length
        if length < STATION_M:
            return np.empty(0)
        at = np.arange(STATION_M / 2, length, STATION_M)
        p = shapely.get_coordinates(shapely.line_interpolate_point(line, at))
        a = shapely.get_coordinates(shapely.line_interpolate_point(line, np.maximum(at - 0.5, 0)))
        b = shapely.get_coordinates(
            shapely.line_interpolate_point(line, np.minimum(at + 0.5, length))
        )
        d = b - a
        d /= np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)[:, None]
        nx, ny = -d[:, 1], d[:, 0]

        def read(grid: Grid, off: float) -> np.ndarray:
            return grid.at(p[:, 0] + nx * off, p[:, 1] + ny * off)

        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # a station off every raster
            tops = np.stack([read(self.top, o) for o in TOP_REACH])
            if self.green:  # a crown is not the wall's top
                at = [(p[:, 0] + nx * o, p[:, 1] + ny * o) for o in TOP_REACH]
                tops[np.stack([self.greenness(x, y) for x, y in at]) >= CROWN_NDVI] = np.nan
            top = np.nanmax(tops, axis=0)
            low = np.nanmin(np.stack([read(self.ground, o) for o in LOW_REACH]), axis=0)
            sides = [read(self.top, o) - read(self.ground, o) for o in (-OPEN_AT_M, OPEN_AT_M)]
            open_side = np.nanmin(np.stack(sides), axis=0) < OPEN_M
        h = top - low
        h[~open_side | (read(self.blocked, 0.0) > 0)] = np.nan
        return h

    def measure(self, lines: list[shapely.Geometry], cls: str) -> float | None:
        """A wall's measured height (m): the median of its counting stations
        over all its lines, or None when too few count."""
        h = np.concatenate([self.stations(line) for line in lines] or [np.empty(0)])
        if len(h) == 0:
            return None
        ok = np.isfinite(h) & (h < MAX_STATION_H.get(cls, MAX_STATION_H["wall"]))
        if ok.sum() < max(MIN_STATIONS, MIN_SHARE * len(h)):
            return None
        return max(MIN_MEASURED_H, float(np.median(h[ok])))


def fallback_height(kind: str, cls: str, measured: dict[str, list[float]]) -> float:
    """An unmeasured wall's height: its class's (FALLBACK_H), a plain wall's
    the tile's median measured one (from TILE_MEDIAN_MIN walls), else its
    kind's default."""
    if cls in FALLBACK_H:
        return FALLBACK_H[cls]
    seen = measured.get(cls, [])
    if kind in MEASURED_KINDS and len(seen) >= TILE_MEDIAN_MIN:
        return float(np.median(seen))
    # a city wall that is no historic one stands as a plain wall
    return DEFAULT_H["wall"] if kind == "city_wall" else DEFAULT_H.get(kind, 2.0)


def _walls(tile: Tile, box: shapely.Geometry) -> tuple[list[dict], list, str]:
    """The wall features, every wall line near the tile (for the gates) and
    a note on how their heights were found."""
    rows = []
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, WHERE, ["barrier", "man_made", "other_tags"])
        for g, barrier, man_made, other in zip(
            geoms,
            column(fields, "barrier", geoms),
            column(fields, "man_made", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        ):
            rows.append((g, kind_of(barrier, man_made, other), other))
    model = SurfaceModel.of(tile) if any(k in MEASURED_KINDS for _, k, _ in rows) else None
    common = site_material(tile) if any(k in MATERIAL_KINDS for _, k, _ in rows) else None
    # First every measurable wall, so an unmeasured one can take the tile's median.
    found: list[float | None] = []
    measured: dict[str, list[float]] = {}
    for g, kind, other in rows:
        h = height(other)
        if h is None and model is not None and kind in MEASURED_KINDS:
            cls = wall_class(kind, other)
            h = model.measure(lines_of(g), cls)
            if h is not None:
                measured.setdefault(cls, []).append(h)
        found.append(h)
    features, near = [], []
    stats: Counter = Counter()
    for (g, kind, other), h in zip(rows, found, strict=True):
        source = "tag" if height(other) is not None else ("measured" if h is not None else "kind")
        if h is None:
            h = fallback_height(kind, wall_class(kind, other), measured)
        props: dict = {"kind": kind, "h": round(h, 1)}
        if kind in MATERIAL_KINDS:
            # a historic city wall is masonry whatever the site's garden walls are
            historic = wall_class(kind, other) == "city_wall"
            props["mat"] = material_of(other) or ("stone" if historic else common)
        near.extend(lines_of(g))
        for line in clipped_lines(g, box):
            stats[source] += 1
            features.append(feature(geometry_json(shapely.LineString(line.coords)), props))
    note = ", ".join(f"{n} {k}" for k, n in sorted(stats.items()))
    return features, near, f"{note}; measured in {model.source}" if model else note


def tall_guards(tile: Tile) -> tuple[shapely.Geometry | None, shapely.Geometry | None]:
    """What makes an untagged fence a tall one (TALL_FENCE_H): the railways'
    reach (TALL_RAIL_M round every track above ground) and the guarded
    areas' (pitches, schools, industrial sites grown by TALL_AREA_M)."""
    kinds = ", ".join(f"'{k}'" for k in TALL_TRACKS)
    rails, fields = read_osm(tile, "lines", f"railway IN ({kinds})", ["other_tags"])
    near = [
        shapely.buffer(g, TALL_RAIL_M)
        for g, other in zip(rails, column(fields, "other_tags", rails), strict=True)
        if g is not None and not g.is_empty and not below_ground(other)
    ]
    areas, _ = read_osm(tile, "multipolygons", TALL_AREAS, ["leisure", "amenity", "landuse"])
    guarded = [shapely.buffer(g, TALL_AREA_M) for g in areas if g is not None and not g.is_empty]
    return (
        shapely.union_all(near) if near else None,
        shapely.union_all(guarded) if guarded else None,
    )


def is_tall(line: shapely.Geometry, guards: tuple) -> bool:
    """Whether TALL_SHARE of a fence's length lies within a guard's reach."""
    length = line.length
    if length <= 0:
        return False
    return any(
        zone is not None and shapely.intersection(line, zone).length >= TALL_SHARE * length
        for zone in guards
    )


def _fences(tile: Tile, box: shapely.Geometry) -> tuple[list[dict], list, int]:
    """The fence features, every fence line near the tile (for the gates) and
    how many untagged ones stand tall."""
    features, near = [], []
    guards = None
    tall_count = 0
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, FENCE_WHERE, ["barrier", "other_tags"])
        for g, barrier, other in zip(
            geoms,
            column(fields, "barrier", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        ):
            tall = False
            if barrier == "fence" and number(tag(other, "height")) is None:
                guards = guards or tall_guards(tile)
                tall = any(is_tall(line, guards) for line in lines_of(g))
                tall_count += tall
            props = {
                "kind": "fence",
                "type": fence_type(barrier, other),
                "h": round(fence_height(barrier, other, tall), 1),
            }
            near.extend(lines_of(g))
            for line in clipped_lines(g, box):
                features.append(feature(geometry_json(shapely.LineString(line.coords)), props))
    return features, near, tall_count


def reaches_in(bounds, p: shapely.Point, w: float) -> bool:
    """Whether a gate outside the tile cuts a gap reaching into it: within
    half its width of the tile (the gap runs along the line, never shorter
    than the straight distance)."""
    return shapely.distance(shapely.box(*bounds), p) <= w / 2


def gates_on(points, fields, walls: list, fences: list, bounds) -> list[dict]:
    """The gates that stand on a wall or fence line (within GATE_ON_M; a
    fence wins a tie), snapped onto it: those the tile owns, and those of a
    neighbour whose gap reaches into the tile (`seam`: they cut this tile's
    piece of the line too). Gates on no line are dropped: without one there
    is no gap to cut."""
    fence_tree = shapely.STRtree(fences) if fences else None
    wall_tree = shapely.STRtree(walls) if walls else None
    out = []
    for p, barrier, other in zip(
        points, column(fields, "barrier", points), column(fields, "other_tags", points), strict=True
    ):
        w = gate_width(barrier, other)
        seam = not owns(bounds, p.x, p.y)
        if seam and not reaches_in(bounds, p, w):
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
        props = {"kind": "gate", "w": round(w, 1), "on": on[0]}
        if barrier != "gate":
            props["type"] = barrier
        if seam:
            props["seam"] = True
        out.append(feature(geometry_json(snapped), props))
    return out


def on_written_lines(features: list[dict]) -> list[dict]:
    """The file's features less every gate whose line of its kind (`on`) the
    file does not carry within GATE_ON_M. A fresh bake reads walls, fences and
    gates from one extract and drops nothing (bar a gate that snapped to a
    line's piece past the tile edge); it is the committed walls, kept from an
    older extract while the gates came from a newer one, that left two
    `on: "wall"` gates 70–73 m from any committed wall (2026-09-26): a gate
    whose gap cuts nothing."""
    lines: dict[str, list] = {"wall": [], "fence": []}
    for f in features:
        kind = f["properties"].get("kind")
        if kind != "gate":
            lines["fence" if kind == "fence" else "wall"].append(
                shapely.geometry.shape(f["geometry"])
            )
    trees = {k: shapely.STRtree(v) if v else None for k, v in lines.items()}
    out = []
    for f in features:
        p = f["properties"]
        if p.get("kind") == "gate" and not p.get("seam"):
            tree = trees.get(p.get("on"))
            point = shapely.geometry.shape(f["geometry"])
            if tree is None or not len(tree.query_nearest(point, max_distance=GATE_ON_M)):
                continue
        out.append(f)
    return out


def run(tile: Tile) -> None:
    if not has_extract(tile, "the walls"):
        return
    box = shapely.box(*tile.bounds)
    walls, wall_lines, heights = _walls(tile, box)
    fences, fence_lines, tall = _fences(tile, box)
    points, fields = read_osm(tile, "points", GATE_WHERE, ["barrier", "other_tags"])
    gates = gates_on(points, fields, wall_lines, fence_lines, tile.bounds)
    gates = on_written_lines(walls + fences + gates)[len(walls) + len(fences) :]
    write_geojson(
        tile.out("dlm", f"walls_{tile.id}.geojson"),
        walls + fences + gates,
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    seam = sum(1 for g in gates if g["properties"].get("seam"))
    print(
        f"{tile.id}: {len(walls)} walls (heights: {heights}), {len(fences)} fences "
        f"({tall} tall), {len(gates) - seam} gates (+{seam} of a neighbour's over the seam)"
    )
