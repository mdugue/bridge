"""The LoD2 walls' street side → plinth runs, `data/<site>/dlm/plinths_
<tile>.geojson`, which the building bake (`scripts/bake-city-mesh.ts`,
`lib/city/plinths.ts`) models as a stone band standing proud of the wall:
a front face, a bevelled top and the run's ends, so the plinth casts a real
shadow line instead of a painted one.

Each feature runs along the wall with the street to its right (a→b
counter-clockwise round the footprint), so its outward normal is the
direction turned clockwise. A run is the stretch of a footprint edge whose outside is open ground: a
party wall or a courtyard edge between two footprints (the outside in
another footprint) is no plinth, and a stretch shorter than `MIN_RUN_M` is
dropped. Every `STEP_M` along it the DGM1 is read a step in front of the
wall (the street side; the DGM rounds the plinth into the street) and
smoothed over a few metres. The plinth's top lies `HEIGHT_M` above the
ground: level along a run whose ground falls less than `LEVEL_M`, else
stepped down the slope in level pieces whose ground spans no more than
`LEVEL_M`, the way a plinth on a sloping street is built. A feature is one
piece: its two ends, its top and its foot `g` (the lowest ground read
under it), so the band reaches into the terrain; the file holds one
MultiLineString per object, `g` and `top` one per line.

The geometry is LoD2's (each object's GroundSurface, `footprints`) and the
ground DGM1's: the provider's licence; nothing from OSM. Which buildings
carry it (a town house, not a landmark, a church or a flat-roofed block)
is the building bake's call, from the flags it already holds."""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
import shapely

from .common import Tile, feature, write_geojson
from .doors import object_heights
from .osm_buildings import footprints

HEIGHT_M = 0.9
# a run whose ground falls more than this is stepped
LEVEL_M = 0.45
STEP_M = 1.0
MIN_RUN_M = 1.5
# an object lower than this (a garage, a shed) carries none
MIN_HEIGHT_M = 5.0
# the ground is read this far in front of the wall
FRONT_M = 0.6
# how far out a party wall's other footprint is looked for
PARTY_M = 0.4
SMOOTH_M = 3.0
# a stretch this close to (and along) another object's run is that run's:
# a BuildingPart over its Building, two parts sharing a facade line
TAKEN_M = 0.25


def open_runs(
    a: tuple[float, float],
    b: tuple[float, float],
    outward: tuple[float, float],
    inside,
    taken=lambda x, y: False,
) -> list[tuple[float, float]]:
    """The stretches [t0, t1] (metres from `a`) of the edge a→b whose
    outside is open: `inside(x, y)` says whether a point lies in another
    footprint, `taken(x, y)` whether another object's run already lies
    along it there. Sampled every half metre."""
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length < MIN_RUN_M:
        return []
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    n = max(2, int(length / 0.5) + 1)
    ts = np.linspace(0.0, length, n)
    free = [
        not inside(a[0] + ux * t + outward[0] * PARTY_M, a[1] + uy * t + outward[1] * PARTY_M)
        and not taken(a[0] + ux * t, a[1] + uy * t)
        for t in ts
    ]
    runs: list[tuple[float, float]] = []
    start = last = None
    for t, ok in zip(ts, free, strict=True):
        if ok:
            start = t if start is None else start
            last = t
        elif start is not None:
            runs.append((start, last))
            start = None
    if start is not None:
        runs.append((start, length))
    return [(t0, t1) for t0, t1 in runs if t1 - t0 >= MIN_RUN_M]


def pieces(ground: list[float]) -> list[tuple[int, int]]:
    """The run's level pieces as sample ranges [i, j]: a new piece where the
    ground has fallen or risen more than `LEVEL_M` within the current one.
    Neighbouring pieces share their seam sample, so the band is unbroken."""
    out: list[tuple[int, int]] = []
    first = 0
    high = low = ground[0]
    for i in range(1, len(ground)):
        g = ground[i]
        if max(high, g) - min(low, g) > LEVEL_M:
            out.append((first, i))
            first = i
            high = low = g
        else:
            high, low = max(high, g), min(low, g)
    if first < len(ground) - 1 or not out:
        out.append((first, len(ground) - 1))
    return out


def smooth(values: list[float], step: float) -> list[float]:
    k = max(1, round(SMOOTH_M / step / 2))
    v = np.asarray(values)
    return [float(v[max(0, i - k) : i + k + 1].mean()) for i in range(len(v))]


def run_features(oid, a, ux, uy, nx, ny, t0, t1, dgm) -> list[dict]:
    """One feature per level piece of the run: its two ends, its top
    (`HEIGHT_M` over the piece's highest smoothed ground) and its foot `g`
    (the lowest ground read under it)."""
    n = max(2, math.ceil((t1 - t0) / STEP_M) + 1)
    ts = np.linspace(t0, t1, n)
    pts = [(a[0] + ux * t, a[1] + uy * t) for t in ts]
    samples = [(x + nx * FRONT_M, y + ny * FRONT_M) for x, y in pts]
    raw = [float(v[0]) for v in dgm.sample(samples)]
    if any(v < -1000 or not math.isfinite(v) for v in raw):
        return []
    ground = smooth(raw, (t1 - t0) / (n - 1))
    out = []
    for i, j in pieces(ground):
        foot = min(raw[i : j + 1])
        # over the smoothed ground, and never under the piece's own foot (a
        # short piece beside a drop smooths lower than it stands)
        top = max(max(ground[i : j + 1]), foot) + HEIGHT_M
        out.append(
            feature(
                {
                    "type": "LineString",
                    "coordinates": [[round(p[0], 2), round(p[1], 2)] for p in (pts[i], pts[j])],
                },
                {
                    "of": oid,
                    "g": round(foot, 2),
                    "top": round(top, 2),
                },
            )
        )
    return out


def edges(poly):
    """Each exterior edge of the footprint, walked so that its outside lies
    to the right (counter-clockwise round the footprint): its ends, its
    direction and its outward normal. Consecutive edges share their vertex,
    so the runs of an outer or inner corner meet there and the building
    bake mitres them (`lib/city/plinths.ts`)."""
    # make_valid can leave lines and points beside the polygons
    parts = [g for g in shapely.get_parts(shapely.get_parts(poly)) if g.geom_type == "Polygon"]
    for part in parts:
        ring = shapely.LinearRing(part.exterior)
        xy = np.asarray(ring.coords)[:-1]
        if not ring.is_ccw:
            xy = xy[::-1]
        xy = np.asarray([p for i, p in enumerate(xy) if math.dist(p, xy[i - 1]) > 1e-6])
        n = len(xy)
        if n < 3:
            continue
        for i in range(n):
            a, b = xy[i], xy[(i + 1) % n]
            length = math.dist(a, b)
            ux, uy = float((b[0] - a[0]) / length), float((b[1] - a[1]) / length)
            yield (float(a[0]), float(a[1])), (float(b[0]), float(b[1])), (ux, uy), (uy, -ux)


class Taken:
    """The runs already laid, on a 2 m grid: whether a point lies within
    `TAKEN_M` of one running the same way (either sense)."""

    def __init__(self) -> None:
        self.cells: dict[tuple[int, int], list[tuple]] = {}

    def add(self, a, b, u) -> None:
        length = math.dist(a, b)
        for k in range(int(length / 1.0) + 2):
            t = min(k * 1.0, length)
            key = (int((a[0] + u[0] * t) // 2), int((a[1] + u[1] * t) // 2))
            cell = self.cells.setdefault(key, [])
            if not cell or cell[-1] != (a, b, u):
                cell.append((a, b, u))

    def near(self, x: float, y: float, u) -> bool:
        cx, cy = int(x // 2), int(y // 2)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for a, b, v in self.cells.get((cx + dx, cy + dy), ()):
                    if abs(u[0] * v[0] + u[1] * v[1]) < 0.95:
                        continue
                    t = (x - a[0]) * v[0] + (y - a[1]) * v[1]
                    if (
                        -0.01 <= t <= math.dist(a, b) + 0.01
                        and abs((x - a[0]) * v[1] - (y - a[1]) * v[0]) < TAKEN_M
                    ):
                        return True
        return False


def run(tile: Tile) -> None:
    city_path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    if not city_path.exists() or not tile.dgm.exists():
        return
    city = json.loads(city_path.read_text())
    ids, polys = footprints(city)
    heights = object_heights(city)
    tree = shapely.STRtree(polys)
    out: list[dict] = []
    taken = Taken()
    # the tallest first: where two objects share a facade line the main
    # body carries the plinth, not a part standing in it
    order = sorted(range(len(ids)), key=lambda i: -heights.get(ids[i], 0.0))
    with rasterio.open(tile.dgm) as dgm:
        for i in order:
            oid, poly = ids[i], polys[i]
            # a garage, a shed, a kiosk: no town house's plinth
            if heights.get(oid, 0.0) < MIN_HEIGHT_M:
                continue

            def inside(x: float, y: float, own: int = i) -> bool:
                p = shapely.Point(x, y)
                return any(int(j) != own for j in tree.query(p, predicate="within"))

            laid = []
            for a, b, (ux, uy), (nx, ny) in edges(poly):

                def along(x: float, y: float, u=(ux, uy)) -> bool:
                    return taken.near(x, y, u)

                for t0, t1 in open_runs(a, b, (nx, ny), inside, along):
                    out.extend(run_features(oid, a, ux, uy, nx, ny, t0, t1, dgm))
                    p0 = (a[0] + ux * t0, a[1] + uy * t0)
                    laid.append((p0, (a[0] + ux * t1, a[1] + uy * t1), (ux, uy)))
            # laid once the object is done: its own runs never block each other
            for a, b, u in laid:
                taken.add(a, b, u)
    write_geojson(tile.out("dlm", f"plinths_{tile.id}.geojson"), by_object(out), tile.epsg)
    hosts = len({f["properties"]["of"] for f in out})
    print(f"{tile.id}: {len(out)} plinth pieces on {hosts} objects")


def by_object(pieces_: list[dict]) -> list[dict]:
    """The pieces gathered per object: one MultiLineString, `g` and `top`
    per line."""
    grouped: dict[str, list[dict]] = {}
    for f in pieces_:
        grouped.setdefault(f["properties"]["of"], []).append(f)
    return [
        feature(
            {"type": "MultiLineString", "coordinates": [f["geometry"]["coordinates"] for f in fs]},
            {
                "of": oid,
                "g": [f["properties"]["g"] for f in fs],
                "top": [f["properties"]["top"] for f in fs],
            },
        )
        for oid, fs in grouped.items()
    ]
