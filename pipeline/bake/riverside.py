"""OSM on the Elbe → one layer per tile: landing stages, groynes, ferry lines.

- **Piers** (`man_made=pier`: ways, buffered by their `width`, else 3 m;
  areas as mapped) → `k: pier` with `deck`, the bank's DGM height at the
  landward end + 0.4 m. A floating one (`floating=yes`, or a pier whose
  far end lies more than 25 m out on the water class) is a **pontoon**
  (`k: pontoon`), cut to the part that lies on the water class (OSM draws
  many up the bank; the DGM's river surface is flat, the bank is not): its
  height is the drawn water's, which the runtime reads from the ground the
  water sheet lies on; the bake gives it `bank`, the
  nearest point of the bank for its gangway, unless a fixed pier already
  reaches it, and `len`, its length. The paddle steamers themselves are
  not drawn: no dataset has them.
- **Groynes** (`man_made=groyne` ways) → `k: groyne` lines.
- **Ferries** (`route=ferry` ways) → `k: ferry` lines with the `name`, cut to
  the stretches over the water class (a route runs on into the next
  tile's river and ashore at its landings).

Each tile writes what it owns: a pier or pontoon by its representative
point, a groyne or ferry stretch cut at the tile edge.
"""

from __future__ import annotations

import math

import numpy as np
import rasterio
import shapely
from rasterio.features import shapes
from rasterio.windows import Window

from .common import (
    OSM_ATTRIBUTION,
    Tile,
    column,
    feature,
    geometry_json,
    owns,
    pixel_of,
    write_geojson,
)
from .osm import has_extract, read_osm, tag

WATER = 8  # landcover.py CLASSES
PIER_WIDTH_M = 3.0
PIER_WIDTH_MAX_M = 30.0
DECK_ABOVE_BANK_M = 0.4
OUT_ON_WATER_M = 25.0
BANK_MAX_M = 30.0  # a pontoon's gangway reaches at most this far
SAMPLE_M = 2.0
MIN_FERRY_M = 10.0


class River:
    """The committed class raster (where the water is) and the DGM."""

    def __init__(self, tile: Tile) -> None:
        self.bounds = tile.bounds
        cls = tile.classes()
        if cls is None:
            raise FileNotFoundError(f"{tile.id}: no class raster — bake landcover first")
        self.cls = cls
        with rasterio.open(tile.dgm) as dgm:
            self.dgm = dgm.read(1).astype(np.float64)

    def _px(self, raster: np.ndarray, x: float, y: float) -> tuple[int, int] | None:
        return pixel_of(raster.shape, self.bounds, x, y)

    def wet_part(self, shape: shapely.Polygon) -> shapely.Polygon | None:
        """The largest part of a shape over the water class."""
        xmin, ymin, xmax, ymax = self.bounds
        h, w = self.cls.shape
        sx, sy = (xmax - xmin) / w, (ymax - ymin) / h
        bx0, by0, bx1, by1 = shape.bounds
        c0 = max(int((bx0 - xmin) / sx) - 1, 0)
        c1 = min(int((bx1 - xmin) / sx) + 2, w)
        r0 = max(int((ymax - by1) / sy) - 1, 0)
        r1 = min(int((ymax - by0) / sy) + 2, h)
        if c1 <= c0 or r1 <= r0:
            return None
        mask = (self.cls[r0:r1, c0:c1] == WATER).astype(np.uint8)
        transform = rasterio.windows.transform(
            Window(c0, r0, c1 - c0, r1 - r0), rasterio.transform.from_bounds(*self.bounds, w, h)
        )
        water = shapely.union_all(
            [shapely.geometry.shape(g) for g, v in shapes(mask, transform=transform) if v == 1]
        )
        part = shape.intersection(water)
        polys = [p for p in shapely.get_parts(part) if p.geom_type == "Polygon" and p.area > 1.0]
        if not polys:
            return None
        return shapely.Polygon(max(polys, key=lambda p: p.area).exterior).simplify(0.25)

    def wet(self, x: float, y: float) -> bool:
        at = self._px(self.cls, x, y)
        return at is not None and self.cls[at] == WATER

    def ground(self, x: float, y: float) -> float | None:
        at = self._px(self.dgm, x, y)
        if at is None:
            return None
        v = float(self.dgm[at])
        return v if v > -1000 else None

    def bank_near(self, geom: shapely.Geometry) -> shapely.Point | None:
        """The nearest dry point within BANK_MAX_M of a shape, searched on
        rings of 1 m around its outline."""
        ring = geom.exterior if geom.geom_type == "Polygon" else geom.boundary
        pts = [ring.interpolate(d) for d in np.arange(0, ring.length, SAMPLE_M)]
        for r in range(1, int(BANK_MAX_M) + 1):
            best = None
            for p in pts:
                for k in range(16):
                    a = k * math.pi / 8
                    q = shapely.Point(p.x + r * math.cos(a), p.y + r * math.sin(a))
                    if geom.contains(q) or self.wet(q.x, q.y):
                        continue
                    if self._px(self.cls, q.x, q.y) is None:
                        continue
                    if best is None or geom.distance(q) < geom.distance(best):
                        best = q
            if best is not None:
                return best
        return None


def width_of(other: str | None) -> float:
    try:
        w = float((tag(other, "width") or "").split()[0])
    except (ValueError, IndexError):
        return PIER_WIDTH_M
    return min(max(w, 1.0), PIER_WIDTH_MAX_M)


def pier_shape(g: shapely.Geometry, other: str | None) -> shapely.Polygon | None:
    """A pier way buffered to its width (flat ends); an area as mapped."""
    if g.geom_type == "LineString" and not g.is_ring:
        shape = g.buffer(width_of(other) / 2, cap_style="flat", join_style="mitre")
    elif g.geom_type == "LineString":
        shape = shapely.Polygon(g.coords)
    elif g.geom_type == "MultiPolygon":
        shape = max(g.geoms, key=lambda p: p.area)
    else:
        shape = g
    if shape.geom_type != "Polygon" or shape.is_empty or shape.area < 1.0:
        return None
    return shapely.Polygon(shape.exterior).simplify(0.1)


def far_out(line: shapely.Geometry, river: River) -> bool:
    """Whether a pier reaches more than OUT_ON_WATER_M out over the water."""
    if line.geom_type != "LineString":
        return False
    wet = 0.0
    n = max(int(line.length / SAMPLE_M), 1)
    for i in range(n):
        p = line.interpolate((i + 0.5) / n, normalized=True)
        if river.wet(p.x, p.y):
            wet += line.length / n
    return wet > OUT_ON_WATER_M


def deck_height(shape: shapely.Polygon, river: River) -> float | None:
    """The bank's height at the landward end (its highest dry DGM sample
    along the outline) + DECK_ABOVE_BANK_M; the outline's highest sample
    where it touches no dry ground."""
    ring = shape.exterior
    dry, every = [], []
    for d in np.arange(0, ring.length, SAMPLE_M / 2):
        p = ring.interpolate(d)
        h = river.ground(p.x, p.y)
        if h is None:
            continue
        every.append(h)
        if not river.wet(p.x, p.y):
            dry.append(h)
    if not every:
        return None
    return round(max(dry or every) + DECK_ABOVE_BANK_M, 2)


def piers(tile: Tile, river: River) -> list[dict]:
    items = []
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, "man_made = 'pier'", ["man_made", "other_tags"])
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            shape = pier_shape(g, other)
            if shape is None:
                continue
            floating = tag(other, "floating") == "yes" or far_out(g, river)
            items.append((shape, floating))
    fixed = [shape for shape, floating in items if not floating]
    out = []
    for shape, floating in items:
        anchor = shape.representative_point()
        if not owns(tile.bounds, anchor.x, anchor.y):
            continue
        if floating:
            shape = river.wet_part(shape)
            if shape is None:
                continue
            props: dict = {"k": "pontoon", "len": round(_length(shape), 1)}
            reached = any(shape.distance(f) < 1.0 for f in fixed)
            bank = None if reached else river.bank_near(shape)
            if bank is not None:
                props["bank"] = [round(bank.x, 2), round(bank.y, 2)]
        else:
            deck = deck_height(shape, river)
            if deck is None:
                continue
            props = {"k": "pier", "deck": deck}
        out.append(feature(geometry_json(shape), props))
    return out


def _length(shape: shapely.Polygon) -> float:
    rect = shape.minimum_rotated_rectangle
    xs = list(rect.exterior.coords)
    a = math.dist(xs[0], xs[1])
    b = math.dist(xs[1], xs[2])
    return max(a, b)


def groynes(tile: Tile) -> list[dict]:
    geoms, _ = read_osm(tile, "lines", "man_made = 'groyne'", ["man_made"])
    box = shapely.box(*tile.bounds)
    out = []
    for g in geoms:
        for part in shapely.get_parts(g.intersection(box)):
            if part.geom_type == "LineString" and part.length >= 2.0:
                out.append(feature(geometry_json(part), {"k": "groyne"}))
    return out


def wet_runs(line: shapely.LineString, river: River) -> list[shapely.LineString]:
    """The stretches of a line over the water class (2 m samples)."""
    runs, run = [], []
    n = max(int(line.length / SAMPLE_M), 1)
    for i in range(n + 1):
        p = line.interpolate(i / n, normalized=True)
        if river.wet(p.x, p.y):
            run.append((p.x, p.y))
        else:
            if len(run) >= 2:
                runs.append(shapely.LineString(run))
            run = []
    if len(run) >= 2:
        runs.append(shapely.LineString(run))
    return [r.simplify(0.5) for r in runs if r.length >= MIN_FERRY_M]


def ferries(tile: Tile, river: River) -> list[dict]:
    geoms, fields = read_osm(
        tile, "lines", 'other_tags LIKE \'%"route"=>"ferry"%\'', ["name", "other_tags"]
    )
    box = shapely.box(*tile.bounds)
    out = []
    for g, name, other in zip(
        geoms, column(fields, "name", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        if tag(other, "route") != "ferry":
            continue
        for part in shapely.get_parts(g.intersection(box)):
            if part.geom_type != "LineString":
                continue
            for run in wet_runs(part, river):
                props: dict = {"k": "ferry"}
                if name:
                    props["name"] = name
                out.append(feature(geometry_json(run), props))
    return out


def run(tile: Tile) -> None:
    if not has_extract(tile, "the landing stages, groynes and ferries"):
        return
    river = River(tile)
    features = piers(tile, river) + groynes(tile) + ferries(tile, river)
    write_geojson(
        tile.out("dlm", f"riverside_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    counts: dict[str, int] = {}
    for f in features:
        counts[f["properties"]["k"]] = counts.get(f["properties"]["k"], 0) + 1
    print(f"{tile.id}: riverside {dict(sorted(counts.items()))}")
