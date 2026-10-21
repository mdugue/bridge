"""OSM on the Elbe → one layer per tile: landing stages, groynes, ferry lines.

- **Piers** (`man_made=pier`: ways, buffered by their `width`, else 3 m;
  areas as mapped) → `k: pier` with `deck`: the surface model's (DOM1)
  median over the part of the pier that is on the water or the low ground
  beside it (≤ 1 m over the water), read only off the cells the deck
  itself shows in (≥ 0.3 m over the water or the ground there, ≤ 2.5 m:
  no tree, no roof); without DOM1, or for a pier wholly on the bank, the
  bank's DGM height at its landward end + 0.4 m. That rule alone put one
  Dresden pier 5.7 m over the river, for the bank it met was a high quay.
  A floating one (`floating=yes`, or a pier whose far end lies more than
  25 m out on the water class) is a **pontoon** (`k: pontoon`), cut to
  the part that lies on the water class (OSM draws many up the bank; the
  DGM's river surface is flat, the bank is not): its height is the drawn
  water's, which the runtime reads from the ground the water sheet lies
  on, plus `fb`, its freeboard: DOM1 over the hull against DOM1 over the
  open water around it (3–12 m out) — never against the DGM's water,
  which is another day's (Hamburg's DGM holds the river at 2.0 m, its
  scan at −0.6 m with the tide) — clamped to 0.4–1.5 m, 0.9 m without
  DOM1. The bake gives it `bank`, the nearest point of the bank for its
  gangway, unless a fixed pier already reaches it, and `len`, its length.
  A fixed pier wholly on the water that touches a pontoon is a finger pier
  floating with it: a pontoon too (`finger: 1`, its pontoon's `fb`, no
  hut, no gangway). So is a fixed pier DOM1 has under the river's surface
  the DGM keeps (Hamburg's DGM holds the Elbe at 2.0 m, about its high
  water, which no fixed pier lies under: it is a pontoon OSM maps as a
  pier), at its measured freeboard. A pier or pontoon is drawn only where
  DOM1 shows it:
  a quarter of its cells with something at least 0.3 m over the water — a
  steamer moored over a landing stage hides its deck, not the stage, and
  then the deck falls back as without DOM1 — while one mapped Dresden
  pontoon of 145 m lies under the river. The paddle steamers themselves
  are not drawn: no dataset has them.
- **Groynes** (`man_made=groyne` ways) → `k: groyne` lines, cut to where
  the DGM along the axis stands at least 0.3 m over the water beside it
  (the DGM's median over the water class 3–15 m out, written as `w`; a
  stretch under 4 m is dropped): a groyne under the river is not drawn,
  and the runtime lays the crest on the DGM, its flanks down to `w`.
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
from rasterio.features import rasterize, shapes
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
SHOWN_M = 0.3  # DOM1 shows a deck where it stands this far over the water
SHOWN_SHARE = 0.25  # a pier or pontoon is drawn where this share of its cells shows it
TALL_M = 2.5  # a cell this far over the water or the ground holds a tree, a roof
LOW_GROUND_M = 1.0  # ground this little over the water is the foreshore a pier spans
MIN_CELLS = 3
FREEBOARD = (0.4, 1.5)  # a pontoon's deck over the water (m), from DOM1
FREEBOARD_FALLBACK = 0.9
WATER_RING = (3.0, 12.0)  # the open water a pontoon's freeboard is read against (m out)
FINGER_WET = 0.9  # a pier this much on the water touching a pontoon floats with it
GROYNE_SHOWN_M = 0.3  # a groyne is drawn where the DGM stands this far over the water
GROYNE_WATER = (3.0, 15.0)  # where the water beside a groyne is read (m out)
GROYNE_MIN_M = 4.0


class River:
    """The committed class raster (where the water is), the DGM and, where
    the provider has one, the surface model (DOM1, on the DGM's grid)."""

    def __init__(self, tile: Tile) -> None:
        self.bounds = tile.bounds
        cls = tile.classes()
        if cls is None:
            raise FileNotFoundError(f"{tile.id}: no class raster — bake landcover first")
        self.cls = cls
        with rasterio.open(tile.dgm) as dgm:
            self.dgm = dgm.read(1).astype(np.float64)
            self.transform = dgm.transform
        self.dom: np.ndarray | None = None
        dom_path = tile.raw_raster("dom1")
        if tile.products.dom and dom_path.exists():
            with rasterio.open(dom_path) as dom:
                if dom.shape == self.dgm.shape and dom.transform == self.transform:
                    d = dom.read(1).astype(np.float64)
                    nodata = dom.nodata if dom.nodata is not None else -9999.0
                    self.dom = np.where((d == nodata) | (d < -1000), np.nan, d)
        h, w = self.dgm.shape
        # the class of each DGM cell (the class raster is finer)
        rows = (np.arange(h) * cls.shape[0] // h).clip(0, cls.shape[0] - 1)
        cols = (np.arange(w) * cls.shape[1] // w).clip(0, cls.shape[1] - 1)
        self.wet_cells = cls[np.ix_(rows, cols)] == WATER

    def cells(self, shape: shapely.Geometry) -> np.ndarray:
        """The DGM cells whose centres lie inside a shape, as a mask."""
        mask = rasterize(
            [(shape, 1)], out_shape=self.dgm.shape, transform=self.transform, all_touched=False
        )
        return mask.astype(bool)

    def open_water(self, shape: shapely.Geometry, ring: tuple[float, float], others) -> np.ndarray:
        """The water cells between `ring` metres around a shape, off every
        other pier or pontoon (`others`, a mask)."""
        band = shape.buffer(ring[1]).difference(shape.buffer(ring[0]))
        return self.cells(band) & self.wet_cells & ~others

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


def _median(values: np.ndarray) -> float | None:
    values = values[np.isfinite(values)]
    return float(np.median(values)) if values.size else None


def water_level(
    shape: shapely.Polygon, river: River, others: np.ndarray
) -> tuple[float | None, float | None]:
    """The water around a shape as DOM1 and as the DGM read it (the
    medians over the open water 3–12 m out), None where there is none."""
    ring = river.open_water(shape, WATER_RING, others)
    if ring.sum() < MIN_CELLS:
        return None, None
    dom = _median(river.dom[ring]) if river.dom is not None else None
    return dom, _median(river.dgm[ring])


def shown(
    shape: shapely.Polygon, river: River, water: float | None, wet_only: bool
) -> tuple[np.ndarray, float] | None:
    """The DOM1 heights of the cells a deck shows in — on the water (and,
    unless `wet_only`, on low ground ≤ 1 m over it), standing 0.3–2.5 m over
    the water or the ground beneath — and the share of those cells where
    anything stands 0.3 m over it: a steamer moored over a landing stage,
    a hut or a tree hide its deck, not the stage itself (Dresden's
    Terrassenufer). None without DOM1 or such cells to read."""
    if river.dom is None or water is None:
        return None
    inside = river.cells(shape)
    g, d, wet = river.dgm[inside], river.dom[inside], river.wet_cells[inside]
    part = wet if wet_only else wet | (g <= water + LOW_GROUND_M)
    part &= np.isfinite(d)
    if part.sum() < MIN_CELLS:
        return None
    base = np.where(wet, water, np.maximum(g, water))
    over = d - base
    deck = part & (over >= SHOWN_M) & (over <= TALL_M)
    return d[deck], float((part & (over >= SHOWN_M)).sum() / part.sum())


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


def wet_share(shape: shapely.Polygon, river: River) -> float:
    inside = river.cells(shape)
    return float(river.wet_cells[inside].mean()) if inside.any() else 0.0


def freeboard(shape: shapely.Polygon, river: River, others: np.ndarray) -> tuple[float, bool]:
    """A pontoon's freeboard (m, clamped to FREEBOARD) and whether DOM1
    shows it; FREEBOARD_FALLBACK where DOM1 cannot tell (none, or its deck
    hidden under a moored ship)."""
    water, _ = water_level(shape, river, others)
    seen = shown(shape, river, water, wet_only=True)
    if seen is None or water is None:
        return FREEBOARD_FALLBACK, True
    decks, share = seen
    if share < SHOWN_SHARE:
        return FREEBOARD_FALLBACK, False
    if decks.size < MIN_CELLS:
        return FREEBOARD_FALLBACK, True
    lo, hi = FREEBOARD
    return round(min(max(float(np.median(decks)) - water, lo), hi), 2), True


def pier_deck(
    shape: shapely.Polygon, river: River, others: np.ndarray
) -> tuple[float | None, bool, float | None]:
    """A fixed pier's deck height (`deck_height` where DOM1 cannot tell),
    whether DOM1 shows it, and — where DOM1 has its deck under the river's
    surface the DGM keeps, which no fixed pier is (Hamburg's DGM holds the
    Elbe at 2.0 m, about its high water; the scan caught it at −0.6 m) —
    the freeboard it floats at instead (deck None)."""
    water, dgm_water = water_level(shape, river, others)
    seen = shown(shape, river, water, wet_only=False)
    if seen is None:
        return deck_height(shape, river), True, None
    decks, share = seen
    if share < SHOWN_SHARE:
        return None, False, None
    if decks.size < MIN_CELLS:
        return deck_height(shape, river), True, None
    deck = float(np.median(decks))
    if water is not None and dgm_water is not None and deck < dgm_water:
        lo, hi = FREEBOARD
        return None, True, round(min(max(deck - water, lo), hi), 2)
    return round(deck, 2), True, None


def _pontoon(
    shape: shapely.Polygon,
    river: River,
    others: np.ndarray,
    parent: shapely.Polygon | None,
    fixed: list[shapely.Polygon],
    floats_at: float | None,
) -> tuple[shapely.Polygon | None, dict, bool]:
    """A pontoon's outline on the water and its properties — `parent` the
    pontoon a finger pier floats with, `floats_at` the freeboard of a pier
    that floats by its deck (`pier_deck`) — and whether DOM1 hides it."""
    wet = river.wet_part(shape)
    if wet is None:
        return None, {}, False
    fb, seen = (floats_at, True) if floats_at is not None else freeboard(wet, river, others)
    if parent is not None:
        whole = river.wet_part(parent)
        if whole is not None:
            fb = freeboard(whole, river, others)[0]
    if not seen:
        return None, {}, True
    props: dict = {"k": "pontoon", "len": round(_length(wet), 1), "fb": fb}
    if parent is not None:
        props["finger"] = 1
    elif not any(wet.distance(f) < 1.0 for f in fixed):
        bank = river.bank_near(wet)
        if bank is not None:
            props["bank"] = [round(bank.x, 2), round(bank.y, 2)]
    return wet, props, False


def piers(tile: Tile, river: River) -> tuple[list[dict], int]:
    """The tile's piers and pontoons, and how many the surface model does
    not show (not drawn)."""
    items = []
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, "man_made = 'pier'", ["man_made", "other_tags"])
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            shape = pier_shape(g, other)
            if shape is None:
                continue
            floating = tag(other, "floating") == "yes" or far_out(g, river)
            items.append((shape, floating))
    all_shapes = river.cells(shapely.union_all([s for s, _ in items])) if items else None
    others = all_shapes if all_shapes is not None else np.zeros(river.dgm.shape, bool)
    floats = [shape for shape, floating in items if floating]
    # a fixed pier on the water touching a pontoon is its finger, floating with it
    finger_of = {}
    for i, (shape, floating) in enumerate(items):
        if floating:
            continue
        touched = [f for f in floats if shape.distance(f) < 1.0]
        if touched and wet_share(shape, river) >= FINGER_WET:
            finger_of[i] = touched[0]
    # the fixed piers' decks first: a pontoon only a drawn pier reaches keeps its gangway
    decks = {
        i: pier_deck(shape, river, others)
        for i, (shape, floating) in enumerate(items)
        if not floating and i not in finger_of
    }
    fixed = [items[i][0] for i, (deck, seen, _) in decks.items() if seen and deck is not None]
    out, hidden = [], 0
    for i, (shape, floating) in enumerate(items):
        anchor = shape.representative_point()
        if not owns(tile.bounds, anchor.x, anchor.y):
            continue
        deck, seen, floats_at = decks.get(i, (None, True, None))
        if floating or i in finger_of or floats_at is not None:
            parent = finger_of.get(i)
            drawn, props, hid = _pontoon(shape, river, others, parent, fixed, floats_at)
        else:
            drawn, props, hid = (shape if deck is not None else None), {"k": "pier"}, not seen
            props["deck"] = deck
        hidden += hid
        if drawn is not None and not hid:
            out.append(feature(geometry_json(drawn), props))
    return out, hidden


def _length(shape: shapely.Polygon) -> float:
    rect = shape.minimum_rotated_rectangle
    xs = list(rect.exterior.coords)
    a = math.dist(xs[0], xs[1])
    b = math.dist(xs[1], xs[2])
    return max(a, b)


def groyne_runs(
    line: shapely.LineString, river: River
) -> tuple[list[shapely.LineString], float | None]:
    """The stretches of a groyne the DGM shows standing ≥ 0.3 m over the
    water beside it (2 m samples; none shorter than GROYNE_MIN_M), and that
    water's level — the whole line and None where no water lies beside it
    (nothing to tell it from)."""
    band = line.buffer(GROYNE_WATER[1]).difference(line.buffer(GROYNE_WATER[0]))
    water = _median(river.dgm[river.cells(band) & river.wet_cells])
    if water is None:
        return [line], None
    n = max(int(line.length / SAMPLE_M), 1)
    runs, run = [], []
    for i in range(n + 1):
        p = line.interpolate(i / n, normalized=True)
        g = river.ground(p.x, p.y)
        if g is not None and g >= water + GROYNE_SHOWN_M:
            run.append((p.x, p.y))
            continue
        if len(run) >= 2:
            runs.append(shapely.LineString(run))
        run = []
    if len(run) >= 2:
        runs.append(shapely.LineString(run))
    return [r for r in runs if r.length >= GROYNE_MIN_M], water


def groynes(tile: Tile, river: River | None = None) -> tuple[list[dict], int]:
    """The groynes cut to the tile and to where the DGM shows them, and how
    many metres of mapped groyne it does not (not drawn)."""
    geoms, _ = read_osm(tile, "lines", "man_made = 'groyne'", ["man_made"])
    box = shapely.box(*tile.bounds)
    out, under = [], 0.0
    for g in geoms:
        for part in shapely.get_parts(g.intersection(box)):
            if part.geom_type != "LineString" or part.length < 2.0:
                continue
            runs, water = groyne_runs(part, river) if river is not None else ([part], None)
            under += part.length - sum(r.length for r in runs)
            for run in runs:
                props: dict = {"k": "groyne"}
                if water is not None:
                    props["w"] = round(water, 2)
                out.append(feature(geometry_json(run), props))
    return out, round(under)


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
    stages, hidden = piers(tile, river)
    groyne_features, under = groynes(tile, river)
    features = stages + groyne_features + ferries(tile, river)
    write_geojson(
        tile.out("dlm", f"riverside_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    counts: dict[str, int] = {}
    for f in features:
        counts[f["properties"]["k"]] = counts.get(f["properties"]["k"], 0) + 1
    dom = "" if river.dom is not None else " (no DOM1: decks from the bank, freeboard 0.9 m)"
    print(
        f"{tile.id}: riverside {dict(sorted(counts.items()))}, {hidden} piers or pontoons "
        f"DOM1 does not show, {under} m of groyne under the water{dom}"
    )
