"""Basis-DLM (+ DOM1/DGM1, + OSM) → the rail layer's four inputs (ADR 0013):

- ballast: the railway land `ver03_f` (OBJART 42010) where a track's bed
  lies on it (the baked rails by their count, and OSM's every track above
  ground off a bridge), one non-overlapping surface clipped to the tile;
- rails: heavy-rail `ver03_l` (SPW 1000) with `tracks` and `electrified`,
  fragments merged by shared endpoints (1 m snap);
- bridge decks, driven by every `ver06_l` centreline (BWF 1800): snapped to a
  `ver06_f` footprint within 50 m, else buffered by kind width; per-ring-vertex
  deck height = the abutment ramp lifted to the DOM surface, on a mosaic of
  the tile and its neighbours (a deck across a seam comes out the same in
  both tiles' files); `kind` from the rail/road/path networks under the
  centreline; `structure` from the nearest OSM `man_made=bridge` within
  60 m, else the OSM bridge ways on the deck (their `bridge:structure`, or
  an arch for one built before 1850), or Wikidata; a deck the DLM leaves
  unnamed takes the name of its OSM bridge ways; the DOM1 superstructure,
  the fairway clearance and the main span (bridge.py);
- platforms: OSM `railway=platform`.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from pathlib import Path
from typing import NamedTuple

import numpy as np
import rasterio
import shapely
import shapely.geometry
from rasterio.features import rasterize
from rasterio.merge import merge

from . import rail_osm
from .bridge import (
    MAX_GRADE,
    RAIL_GRADE,
    STANDING,
    STEP,
    deck_axis,
    fairway,
    fairway_marks,
    load_wikidata,
    measured_deck,
    structure_of,
    superstructure,
    wikidata_for,
)
from .common import (
    OSM_ATTRIBUTION,
    Tile,
    above_ground,
    column,
    dlm_tunnels,
    feature,
    geometry_json,
    read_layer,
    write_geojson,
)
from .osm import below_ground, has_extract, read_osm, tag

WIDTH = {"rail": 9.0, "road": 11.0, "path": 3.5, "other": 8.0}
YARD_GAP_M = 4.0  # the ballast closes a gap this narrow between two beds
CAMBER = 0.012


# --- ballast and rails ---------------------------------------------------------


def ballast(tile: Tile, lines: list[dict], yards: bool = True) -> list[dict]:
    """The railway land where a track's bed lies on it. The DLM's parcel
    reaches the fences: it holds the depots and their yards' tarmac, the
    embankments' grass, the station forecourts — on Leipzig's four tiles
    two thirds of it lay off every track, and all of it was drawn as raised
    ballast. So the parcel is cut to the beds of `lines` (the baked rails,
    `rails`, by their track count) and of OSM's tracks above ground and off
    bridges, which map a yard's every siding (`rail_osm.osm_beds`; `yards`
    false without an extract)."""
    geoms, _ = read_layer(tile.dlm / "ver03_f.shp", tile.bounds, where="OBJART='42010'")
    if len(geoms) == 0:
        return []
    beds = [
        rail_osm.bed(shapely.geometry.shape(f["geometry"]), f["properties"]["tracks"])
        for f in lines
    ]
    if yards:
        beds += rail_osm.osm_beds(tile)
    if not beds:
        return []
    parcel = shapely.union_all(shapely.make_valid(geoms))
    # a yard's tracks 4.5–6 m apart: the strips between their beds closed,
    # or each would stand as its own raised strip with its own fascia
    closed = shapely.buffer(
        shapely.buffer(shapely.union_all(beds), YARD_GAP_M / 2, join_style="mitre"),
        -YARD_GAP_M / 2,
        join_style="mitre",
    )
    on_beds = shapely.intersection(parcel, shapely.simplify(closed, 0.1))
    return rail_osm.polygons(shapely.intersection(on_beds, shapely.box(*tile.bounds)))


def _key(p) -> tuple[int, int]:
    return round(p[0]), round(p[1])


def merge_lines(lines: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """Chains fragments whose endpoints meet (to the metre), growing the tail
    and then the head of each chain."""
    used = [False] * len(lines)
    ends: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, line in enumerate(lines):
        ends[_key(line[0])].append(i)
        ends[_key(line[-1])].append(i)
    out = []
    for i in range(len(lines)):
        if used[i]:
            continue
        used[i] = True
        chain = list(lines[i])
        for _ in range(2):
            grew = True
            while grew:
                grew = False
                tail = _key(chain[-1])
                for j in ends.get(tail, []):
                    if used[j]:
                        continue
                    seg = lines[j]
                    if _key(seg[0]) == tail:
                        chain += seg[1:]
                    elif _key(seg[-1]) == tail:
                        chain += list(reversed(seg))[1:]
                    else:
                        continue
                    used[j] = True
                    grew = True
                    break
            chain.reverse()
        out.append(chain)
    return out


# Basis-DLM Bahnkategorie: trams (Straßenbahn) are the tram layer's, from
# OSM — some Länder file them with the standard gauge (Munich).
TRAM_BKT = {"1201"}


def rails(tile: Tile) -> list[dict]:
    geoms, fields = read_layer(
        tile.dlm / "ver03_l.shp",
        tile.bounds,
        where="SPW='1000'",
        columns=["SPW", "GLS", "ELK", "BKT"],
    )
    under = dlm_tunnels(tile)
    groups: dict[tuple[int, int], list] = defaultdict(list)
    for g, gls, elk, bkt in zip(
        geoms,
        column(fields, "GLS", geoms),
        column(fields, "ELK", geoms),
        column(fields, "BKT", geoms),
        strict=True,
    ):
        if set(str(bkt).split("#")) <= TRAM_BKT:
            continue
        tracks = {"2000": 2, "3000": 3}.get(str(gls), 1)
        electrified = 1 if str(elk) == "1000" else 0
        for part in (p for line in shapely.get_parts(g) for p in above_ground(line, under)):
            coords = [(x, y) for x, y, *_ in part.coords]
            if len(coords) >= 2:
                groups[(tracks, electrified)].append(coords)
    features = []
    for (tracks, electrified), lines in groups.items():
        for chain in merge_lines(lines):
            features.append(
                feature(
                    {
                        "type": "LineString",
                        "coordinates": [[round(x, 2), round(y, 2)] for x, y in chain],
                    },
                    {"tracks": tracks, "electrified": electrified},
                )
            )
    return features


# --- bridge decks --------------------------------------------------------------


MARGIN = 700.0  # the ground a tile's decks see reaches this far past it (m)


def mosaic(paths: list[Path], bounds: tuple[float, float, float, float]):
    """The rasters that overlap `bounds`, merged on their 1 m grid (NaN where
    none has data), with the mosaic's transform. None when none overlaps."""
    xmin, ymin, xmax, ymax = bounds
    sources = []
    for path in paths:
        src = rasterio.open(path)
        b = src.bounds
        if b.left < xmax and b.right > xmin and b.bottom < ymax and b.top > ymin:
            sources.append(src)
        else:
            src.close()
    if not sources:
        return None, None
    try:
        arr, transform = merge(sources, bounds=bounds, nodata=NODATA)
    finally:
        for src in sources:
            src.close()
    out = arr[0].astype(np.float64)
    out[out <= NODATA + 1] = np.nan
    return out, transform


NODATA = -9999.0
# how far either side of a network's centreline a deck point counts as on it (m)
NETWORK_REACH = {"rail": 8.0, "road": 8.0, "path": 5.0}
# A network line runs on a deck when it follows the deck's axis within this
# angle (deg). A railway or road under the deck crosses it, and adds nothing.
ALONG_DEG = 30.0
# A footprint no bridge line runs on carries the network whose lines leave it
# at the deck's height: the ground EXIT_M past the outline, where a line
# leaves it, lies within CARRIED_M of the deck's top (an abutment, a ramp); a
# road or railway passing under it leaves at its own level, a clearance below.
EXIT_M = 4.0
CARRIED_M = 2.0


def dlm_networks(tile: Tile, bounds) -> dict[str, list]:
    """The Basis-DLM's rail (heavy rail only: a line the DLM files as a tram
    alone runs on a road bridge — Munich's Maximiliansbrücke), road and
    path centrelines within `bounds`."""
    rail, fields = read_layer(
        tile.dlm / "ver03_l.shp", bounds, where="SPW='1000'", columns=["SPW", "BKT"]
    )
    return {
        "rail": [
            g
            for g, bkt in zip(rail, column(fields, "BKT", rail), strict=True)
            if not set(str(bkt).split("#")) <= TRAM_BKT
        ],
        "road": list(read_layer(tile.dlm / "ver01_l.shp", bounds)[0]),
        "path": list(read_layer(tile.dlm / "ver02_l.shp", bounds)[0]),
    }


def _bearing(a, b) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0


def along(lines, tree, axis: shapely.LineString, reach: float) -> float:
    """How many metres of `lines` lie within `reach` of `axis` and follow it:
    each segment within ALONG_DEG of the axis segment nearest to it."""
    if tree is None:
        return 0.0
    zone = axis.buffer(reach)
    pts = list(axis.coords)
    spans = [shapely.LineString([a, b]) for a, b in zip(pts, pts[1:], strict=False)]
    total = 0.0
    for i in tree.query(zone, predicate="intersects"):
        for part in shapely.get_parts(lines[i].intersection(zone)):
            if part.geom_type != "LineString":
                continue
            cs = list(part.coords)
            for a, b in zip(cs, cs[1:], strict=False):
                mid = shapely.Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                j = min(range(len(spans)), key=lambda k: spans[k].distance(mid))
                d = abs(_bearing(a, b) - _bearing(pts[j], pts[j + 1]))
                if min(d, 180.0 - d) < ALONG_DEG:
                    total += math.dist(a[:2], b[:2])
    return total


class Ground:
    """DGM1 and DOM1 around the tile — its own and its neighbours', so a deck
    across a seam gets the same heights from either tile — on a 1 m grid,
    and the rail, road and path networks a deck's kind is read from."""

    def __init__(self, tile: Tile, networks: dict[str, list] | None = None):
        xmin, ymin, xmax, ymax = tile.bounds
        self.bounds = (xmin - MARGIN, ymin - MARGIN, xmax + MARGIN, ymax + MARGIN)
        dgms = sorted((tile.data / "dgm").glob("dgm1_*_tiff/dgm1_*.tif"))
        self.dgm, self.transform = mosaic(dgms, self.bounds)
        if self.dgm is None:
            raise SystemExit(f"{tile.id}: no DGM1 under {tile.data / 'dgm'}")
        self.dom = None  # decks fall back to the DGM ramp
        if tile.raw_raster("dom1").exists():
            dom, dom_transform = mosaic(sorted((tile.raw / "dom1").glob("*.tif")), self.bounds)
            if dom is not None and dom.shape == self.dgm.shape and dom_transform == self.transform:
                self.dom = dom
        if networks is None:  # the Basis-DLM's networks
            networks = dlm_networks(tile, self.bounds)
        self.networks = {kind: list(networks.get(kind, [])) for kind in ("rail", "road", "path")}
        self.trees = {
            kind: shapely.STRtree(lines) if lines else None for kind, lines in self.networks.items()
        }
        self.masks = {
            kind: self._mask(self.networks[kind], NETWORK_REACH[kind])
            for kind in ("rail", "road", "path")
        }

    def _mask(self, geoms, buffer: float):
        if len(geoms) == 0:
            return None
        out = np.zeros(self.dgm.shape, dtype=np.uint8)
        rasterize(
            ((shapely.buffer(g, buffer), 1) for g in geoms),
            out=out,
            transform=self.transform,
        )
        return out

    def px(self, x: float, y: float) -> tuple[int, int]:
        h, w = self.dgm.shape
        c = min(max(int(x - self.transform.c), 0), w - 1)
        r = min(max(int(self.transform.f - y), 0), h - 1)
        return c, r

    def sample(self, arr: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        """`arr` at many points (NaN outside the mosaic or without data)."""
        h, w = arr.shape
        c = np.floor(xs - self.transform.c).astype(int)
        r = np.floor(self.transform.f - ys).astype(int)
        inside = (c >= 0) & (c < w) & (r >= 0) & (r < h)
        out = np.full(xs.shape, np.nan)
        out[inside] = arr[r[inside], c[inside]]
        return out

    def robust(self, arr: np.ndarray | None, x: float, y: float, win: int) -> float | None:
        if arr is None:
            return None
        c, r = self.px(x, y)
        block = arr[max(r - win, 0) : r + win + 1, max(c - win, 0) : c + win + 1]
        vals = np.sort(block[~np.isnan(block)], axis=None)
        return float(vals[len(vals) // 2]) if len(vals) else None

    def lowest(self, x: float, y: float, win: int) -> float | None:
        """The DGM's low tenth around a point: the water surface under a mark."""
        c, r = self.px(x, y)
        block = self.dgm[max(r - win, 0) : r + win + 1, max(c - win, 0) : c + win + 1]
        vals = block[~np.isnan(block)]
        return float(np.percentile(vals, 10)) if len(vals) else None

    def endpoint_h(self, x: float, y: float) -> float | None:
        g = self.robust(self.dgm, x, y, 3)
        s = self.robust(self.dom, x, y, 2)
        if g is None:
            return s
        if s is None:
            return g
        return max(g, min(s, g + 25.0))  # cap DOM spikes (trees/wires on the bank)

    def classify(self, axis) -> str:
        """The deck's kind from what runs along its `axis` (≥ 2 points): the
        network with the longest stretch within its reach that follows the
        axis (`along`), rail before road before path on a tie. A railway or
        road the deck crosses meets the axis at an angle and adds nothing:
        counted point by point, the tracks under a footbridge (Leipzig's
        Bennigsenbrücke) or a road bridge made it a rail deck. Where nothing
        runs along it, a network merely under its points decides
        (`classify_points`)."""
        if len(axis) >= 2:
            line = shapely.LineString(axis)
            runs = {
                kind: along(self.networks[kind], self.trees[kind], line, NETWORK_REACH[kind])
                for kind in ("rail", "road", "path")
            }
            if max(runs.values()) > 0:
                return max(("rail", "road", "path"), key=lambda k: runs[k])
        return self.classify_points(midpoints(axis))

    def carried(self, ring) -> tuple[str, list] | None:
        """For a footprint no bridge line runs on: the kind of network it
        carries (the most metres of lines leaving it at the deck's height,
        rail before road before path on a tie) and that kind's longest line
        across it, which the deck's axis then follows. None without DOM1 or
        where no line leaves it at the deck's height. The footprint's long
        axis is no guide: a railway bridge of many tracks over a road is
        wider than long, and the road under it runs along that axis (the
        bridges over Dresden's Weißeritz)."""
        if self.dom is None:
            return None
        poly = shapely.make_valid(shapely.Polygon(ring))
        x0, y0, x1, y1 = poly.bounds
        xs, ys = np.meshgrid(np.arange(x0 + 0.5, x1, 1.0), np.arange(y0 + 0.5, y1, 1.0))
        inside = shapely.contains_xy(poly, xs, ys)
        tops = self.sample(self.dom, xs[inside], ys[inside])
        tops = tops[~np.isnan(tops)]
        if len(tops) == 0:
            return None
        top = float(np.median(tops))
        metres = {"rail": 0.0, "road": 0.0, "path": 0.0}
        longest: dict[str, shapely.LineString] = {}
        for kind in metres:
            tree = self.trees[kind]
            if tree is None:
                continue
            for i in tree.query(poly, predicate="intersects"):
                for part in shapely.get_parts(self.networks[kind][i].intersection(poly)):
                    if part.geom_type != "LineString" or part.length < 2.0:
                        continue
                    if self._leaves_at(part, poly, top):
                        metres[kind] += part.length
                        if kind not in longest or part.length > longest[kind].length:
                            longest[kind] = part
        kind = max(metres, key=lambda k: metres[k])
        if metres[kind] == 0.0:
            return None
        return kind, [(x, y) for x, y, *_ in longest[kind].coords]

    def _leaves_at(self, part, poly, top: float) -> bool:
        """Whether a line across a footprint leaves it, at either end, onto
        ground within CARRIED_M of the deck's `top`."""
        cs = list(part.coords)
        edge = poly.exterior if isinstance(poly, shapely.Polygon) else poly.boundary
        for end, prev in ((cs[0], cs[1]), (cs[-1], cs[-2])):
            if edge.distance(shapely.Point(end)) > 0.5:
                continue  # the line ends on the deck
            d = math.dist(end[:2], prev[:2])
            if d == 0:
                continue
            x = end[0] + (end[0] - prev[0]) / d * EXIT_M
            y = end[1] + (end[1] - prev[1]) / d * EXIT_M
            if poly.contains(shapely.Point(x, y)):
                continue
            g = self.robust(self.dgm, x, y, 1)
            if g is not None and abs(top - g) <= CARRIED_M:
                return True
        return False

    def classify_points(self, pts) -> str:
        counts = {"rail": 0, "road": 0, "path": 0}
        for x, y in pts:
            c, r = self.px(x, y)
            for kind in ("rail", "road", "path"):
                mask = self.masks[kind]
                if mask is not None and mask[r, c] > 0:
                    counts[kind] += 1
                    break
        rail, road, path = counts["rail"], counts["road"], counts["path"]
        if rail >= road and rail >= path and rail > 0:
            return "rail"
        if road >= path and road > 0:
            return "road"
        return "path" if path > 0 else "other"


def ramp_line(ground: Ground, axis):
    """A ramp between the abutments (the axis's ends) plus a midspan camber —
    never dipping into the river — as a function of t ∈ [0, 1] along the
    axis. None when there is no valid ground at all."""
    a, b = axis.point(0.0), axis.point(axis.length)
    h0, h1 = ground.endpoint_h(*a), ground.endpoint_h(*b)
    if h0 is None and h1 is None:
        stations = np.linspace(0.0, axis.length, 9)
        hs = sorted(
            h for h in (ground.endpoint_h(*axis.point(s)) for s in stations) if h is not None
        )
        if not hs:
            return None
        h0 = h1 = hs[len(hs) // 2]
    h0 = h1 if h0 is None else h0
    h1 = h0 if h1 is None else h1
    camber = min(axis.length * CAMBER, 1.6)
    return lambda t: h0 + (h1 - h0) * t + camber * math.sin(math.pi * t)


def deck_line(ground: Ground, ring: list[tuple[float, float]], axis, kind: str = "road"):
    """The deck height along the axis, t ∈ [0, 1]: the roadway DOM1 measures,
    held near the abutment ramp and within the kind's grade
    (bridge.measured_deck). None without ground."""
    ramp = ramp_line(ground, axis)
    if ramp is None:
        return None
    grade = RAIL_GRADE if kind == "rail" else MAX_GRADE
    return measured_deck(ground, ring, ramp, grade, axis)


def deck_profile(line, ring: list[tuple[float, float]], axis) -> list[float]:
    """Per-ring-vertex deck height (the deck line where each vertex projects
    onto the axis)."""
    deck = []
    for x, y in ring:
        s, _ = axis.project(x, y)
        t = s / axis.length if axis.length > 0 else 0.0
        deck.append(round(line(max(0.0, min(1.0, t))), 2))
    return deck


def buffer_line(coords, half: float) -> list[tuple[float, float]]:
    """A centreline offset to a deck polygon (left side + reversed right)."""
    n = len(coords)
    left, right = [], []
    for i in range(n):
        a, b = coords[max(0, i - 1)], coords[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        length = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / length, tx / length
        left.append((coords[i][0] + nx * half, coords[i][1] + ny * half))
        right.append((coords[i][0] - nx * half, coords[i][1] - ny * half))
    return left + right[::-1]


def osm_structures(tile: Tile) -> list[tuple[float, float, str, str | None]]:
    """(centroid x, y, bridge:structure, wikidata) of the OSM bridge outlines."""
    out = []
    for layer in ("multipolygons", "lines"):
        geoms, fields = read_osm(tile, layer, "man_made = 'bridge'", ["man_made", "other_tags"])
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            if not g.is_empty:
                c = g.centroid
                structure = tag(other, "bridge:structure") or ""
                out.append((c.x, c.y, structure, tag(other, "wikidata")))
    return out


# A bridge's own name says it is one: the ways on a bridge are as often named
# for their street (the Budapester Straße over the Hauptbahnhof's tracks).
BRIDGE_NAME = re.compile(r"(brücke|bruecke|steg|viadukt|bridge)$", re.IGNORECASE)
# Built before this year and of no known structure, a bridge is masonry: an
# arch (Meißen's Schloßbrücke, 1221; iron came after it, prestressed
# concrete a century later).
MASONRY_BEFORE = 1850


class BridgeWay(NamedTuple):
    line: shapely.Geometry
    name: str | None  # the bridge's own name
    structure: str  # `bridge:structure`, or "arch" by its year
    dated: bool  # the structure is the year's guess, not a tag
    wikidata: str | None


class BridgeWays:
    """OSM's ways on a bridge, looked up by the deck they run on."""

    def __init__(self, ways: list[BridgeWay]) -> None:
        self.ways = ways
        self.tree = shapely.STRtree([w.line for w in ways]) if ways else None

    def on(self, outline: shapely.Polygon) -> list[BridgeWay]:
        """The ways that run on a deck: half their length within 1 m of it."""
        if self.tree is None:
            return []
        grown = shapely.buffer(outline, 1.0)
        found = (self.ways[i] for i in self.tree.query(grown))
        return [
            w
            for w in found
            if w.line.length > 0
            and w.line.intersection(grown).length >= LINE_ON_FOOTPRINT * w.line.length
        ]


def bridge_way(line: shapely.Geometry, name: str | None, other: str | None) -> BridgeWay | None:
    """What an OSM way on a bridge says of it: its own name (`bridge:name`,
    else a `name` that names a bridge), its structure (`bridge:structure`,
    else an arch for a `start_date` before MASONRY_BEFORE) or its Wikidata
    item. Nothing: None."""
    if line is None or line.is_empty or tag(other, "bridge") in (None, "no"):
        return None
    own = tag(other, "bridge:name") or (name if name and BRIDGE_NAME.search(name.strip()) else None)
    structure, dated = tag(other, "bridge:structure") or "", False
    year = re.search(r"\d{4}", tag(other, "start_date") or "")
    if not structure and year and int(year.group(0)) < MASONRY_BEFORE:
        structure, dated = "arch", True
    qid = tag(other, "wikidata")
    return BridgeWay(line, own, structure, dated, qid) if own or structure or qid else None


def osm_bridge_ways(tile: Tile) -> BridgeWays:
    """The tile's OSM ways on a bridge that say something of it
    (`bridge_way`). No extract: none."""
    if tile.osm_extract() is None:
        return BridgeWays([])
    geoms, fields = read_osm(
        tile, "lines", "other_tags LIKE '%\"bridge\"=>%'", ["name", "other_tags"]
    )
    names, others = column(fields, "name", geoms), column(fields, "other_tags", geoms)
    found = (bridge_way(*way) for way in zip(geoms, names, others, strict=True))
    return BridgeWays([w for w in found if w is not None])


def near(structures, cx: float, cy: float, reach: float = 60.0):
    """The OSM outlines around a deck centroid, nearest first."""
    hits = [(math.hypot(ox - cx, oy - cy), st, qid) for ox, oy, st, qid in structures]
    return sorted((h for h in hits if h[0] < reach), key=lambda h: h[0])


def bridge_properties(
    ground, ring, name, kind, structures, marks, known, centre=None, ways=None
) -> dict | None:
    """Everything the viewer draws a deck from (see bridge.py). `centre` is
    the DLM bridge line the deck was built from, if any; `ways` OSM's
    bridge ways (`osm_bridge_ways`)."""
    axis = deck_axis(ring, centre)
    line = deck_line(ground, ring, axis, kind)
    if line is None:
        return None
    cx = sum(x for x, _ in ring) / len(ring)
    cy = sum(y for _, y in ring) / len(ring)
    around = near(structures, cx, cy)
    outline = shapely.Polygon(ring)
    on = ways.on(outline) if ways is not None else []
    tagged = next((st for _, st, _ in around if st), "") or next(
        (w.structure for w in on if w.structure and not w.dated), ""
    )
    structure = tagged or next((w.structure for w in on if w.dated), "")
    name = name or next((w.name for w in on if w.name), None)
    props: dict = {
        "name": name,
        "kind": kind,
        "structure": structure,
        "deck": deck_profile(line, ring, axis),
    }
    props["axis"] = axis.coords()
    length = axis.length
    stations = [i * STEP for i in range(int(length // STEP) + 1)]
    props["line"] = [round(line(s / length), 2) if length > 0 else 0.0 for s in stations]
    props.update(fairway(ground, ring, line, marks, axis))
    qids = [qid for _, _, qid in around if qid] + [w.wikidata for w in on if w.wikidata]
    qids += [m[3] for m in marks if m[3] and outline.distance(shapely.Point(m[0], m[1])) < 30]
    wd = wikidata_for(ring, name, qids, known)
    if wd:
        props["wikidata"] = wd["id"]
        props["structure"] = structure_of(wd["types"]) or structure
        if wd.get("mainSpan"):
            props["span"] = wd["mainSpan"]
    # Only a bridge of a kind that stands above its deck keeps what DOM1 saw
    # there: over a beam bridge it is catenary, trains or trees. An arch of
    # the year's guess is masonry, its vaults under the deck.
    guessed = not tagged and props["structure"] == structure
    if not guessed and any(kind in props["structure"] for kind in STANDING):
        ribs = superstructure(ground, ring, line, axis)
        if ribs:
            props["ribs"] = ribs
    return props


LINE_ON_FOOTPRINT = 0.5  # a bridge line lies on a footprint when this share of it is inside


def footprint_of(line, polys) -> int:
    """The unclaimed footprint a bridge line runs on, or −1. Nearness is not
    enough: the Marienbrücke's road line runs 16 m beside the rail bridge's
    footprint (the road bridge has none of its own), and matching it by
    centroid laid the road on the tracks and left the road bridge undrawn."""
    best, most = -1, LINE_ON_FOOTPRINT * line.length
    for pi, p in enumerate(polys):
        if not p[3]:
            inside = line.intersection(shapely.buffer(p[4], 1.0)).length
            if inside > most:
                most, best = inside, pi
    return best


def bridges(tile: Tile, structures, marks, known, ways=None) -> list[dict]:
    """The decks of the Basis-DLM's bridges (`ver06`, BWF 1800)."""
    line_geoms, line_fields = read_layer(
        tile.dlm / "ver06_l.shp", tile.bounds, where="BWF='1800'", columns=["BWF", "NAM"]
    )
    poly_geoms, _ = read_layer(tile.dlm / "ver06_f.shp", tile.bounds, where="BWF='1800'")
    lines = [
        (g, name or None, None)
        for g, name in zip(line_geoms, column(line_fields, "NAM", line_geoms), strict=True)
    ]
    return decks(Ground(tile), lines, list(poly_geoms), structures, marks, known, ways=ways)


def decks(
    ground: Ground, lines: list, poly_geoms: list, structures, marks, known, merge=False, ways=None
) -> list[dict]:
    """Decks from bridge centrelines `(geometry, name, kind or None)` and
    footprints: a line runs on the footprint it lies on, else is buffered by
    its kind's width; a footprint no line claimed is a deck of its own.
    With `merge` (OSM, where a carriageway, its pavements and a cycle track
    are separate ways), a line on a footprint already claimed adds nothing,
    and the buffers of the remaining lines on one level merge into one deck."""
    polys = []
    for g in poly_geoms:
        for part in shapely.get_parts(g):
            if isinstance(part, shapely.Polygon):
                ring = [(x, y) for x, y, *_ in part.exterior.coords]
                if len(ring) >= 4:
                    cx = sum(x for x, _ in ring) / len(ring)
                    cy = sum(y for _, y in ring) / len(ring)
                    polys.append([ring, cx, cy, False, part])

    features = []

    def emit(ring, name, kind, centre=None):
        props = bridge_properties(ground, ring, name, kind, structures, marks, known, centre, ways)
        if props is None:
            return
        features.append(
            feature(
                {"type": "Polygon", "coordinates": [[[round(x, 2), round(y, 2)] for x, y in ring]]},
                props,
            )
        )

    loose = []
    for g, name, given, *rest in lines:
        width = rest[0] if rest else None
        level = rest[1] if len(rest) > 1 else 0
        for part in shapely.get_parts(g):
            coords = [(x, y) for x, y, *_ in part.coords]
            if len(coords) < 2:
                continue
            kind = given or ground.classify(coords)
            best = footprint_of(part, polys)
            if best >= 0:
                polys[best][3] = True
                emit(polys[best][0], name, kind, coords)
            elif merge and on_claimed(part, polys):
                continue
            elif merge:
                loose.append((part, name, kind, width or WIDTH[kind], level))
            else:
                emit(buffer_line(coords, WIDTH[kind] / 2), name, kind, coords)
    for ring, name, kind, centre in merged_decks(loose):
        emit(ring, name, kind, centre)
    for p in polys:
        if not p[3]:
            found = ground.carried(p[0])
            if found is None:
                emit(p[0], None, ground.classify(deck_axis(p[0]).pts))
            else:
                emit(p[0], None, *found)
    return features


def midpoints(coords):
    """A line's vertices and the midpoints between them."""
    pts = []
    for a, b in zip(coords, coords[1:], strict=False):
        pts += [a, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)]
    return [*pts, coords[-1]]


def on_claimed(line, polys) -> bool:
    """Whether a line lies on a footprint another line already runs on."""
    share = LINE_ON_FOOTPRINT * line.length
    return any(p[3] and line.intersection(shapely.buffer(p[4], 1.0)).length > share for p in polys)


KIND_RANK = {"rail": 0, "road": 1, "path": 2, "other": 3}


def merged_decks(loose):
    """One deck per group of touching buffered lines on one level: its
    outline, the first name, the weightiest kind (rail over road over path)
    and the longest line as its centre."""
    by_level: dict = defaultdict(list)
    for item in loose:
        by_level[item[4]].append(item)
    out = []
    for items in by_level.values():
        shapes = [shapely.buffer(line, width / 2, cap_style="flat") for line, *_, width, _ in items]
        merged = shapely.union_all(shapes)
        for part in shapely.get_parts(merged):
            if not isinstance(part, shapely.Polygon) or part.area < 1.0:
                continue
            members = [it for it, sh in zip(items, shapes, strict=True) if sh.intersects(part)]
            longest = max(members, key=lambda it: it[0].length)
            kind = min((it[2] for it in members), key=lambda k: KIND_RANK[k])
            name = next((it[1] for it in members if it[1]), None)
            ring = [(x, y) for x, y, *_ in part.simplify(0.3).exterior.coords]
            centre = [(x, y) for x, y, *_ in longest[0].coords]
            out.append((ring, name, kind, centre))
    return out


# --- platforms ---------------------------------------------------------------------


# GDAL's OSM driver gives `railway` a column only on `lines`; on
# `multipolygons` it and `public_transport` sit in the `other_tags` hstore.
# Pre-filter on the hstore text, then decide with the parsed tags.
PLATFORM_WHERE = (
    'other_tags LIKE \'%"railway"=>"platform"%\' '
    'OR other_tags LIKE \'%"public_transport"=>"platform"%\''
)


def is_platform(railway: str | None, other_tags: str | None) -> bool:
    """railway=platform, or public_transport=platform on a railway feature."""
    railway = railway or tag(other_tags, "railway")
    if railway == "platform":
        return True
    return tag(other_tags, "public_transport") == "platform" and railway is not None


def platforms(tile: Tile) -> list[dict]:
    """Platform polygons, each owned by the tile its centroid falls in — read
    with a margin (so none is missed at a seam) but never written twice."""
    box = shapely.box(*tile.bounds)
    features = []
    for layer in ("multipolygons", "lines"):
        if layer == "lines":
            where = f"railway = 'platform' OR {PLATFORM_WHERE}"
            columns = ["railway", "other_tags"]
        else:
            where, columns = PLATFORM_WHERE, ["other_tags"]
        geoms, fields = read_osm(tile, layer, where, columns, margin=0.0005)
        for g, railway, other in zip(
            geoms,
            column(fields, "railway", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        ):
            if not is_platform(railway, other) or below_ground(other):
                continue
            for part in shapely.get_parts(g):
                if (
                    isinstance(part, shapely.LineString)
                    and part.is_closed
                    and len(part.coords) >= 4
                ):
                    part = shapely.Polygon(part.coords)
                if not part.is_empty and box.contains(part.representative_point()):
                    features.append(feature(geometry_json(part)))
    return features


def run(tile: Tile) -> None:
    if not tile.products.dlm:
        run_osm(tile)
        return
    if not tile.has_dlm("the rail layer (tracks, ballast, bridges, platforms)"):
        return
    lines = rails(tile)
    yards = has_extract(tile, "the yards' tracks under the ballast")
    write_geojson(
        tile.out("dlm", f"railarea_{tile.id}.geojson"),
        ballast(tile, lines, yards),
        tile.epsg,
        f"{tile.credit}; tracks: {OSM_ATTRIBUTION}" if yards else None,
    )
    write_geojson(tile.out("dlm", f"rail_{tile.id}.geojson"), lines, tile.epsg)
    has_osm = has_extract(tile, "bridge structure and platforms")
    structures = osm_structures(tile) if has_osm else []
    marks = fairway_marks(tile) if has_osm else []
    write_geojson(
        tile.out("dlm", f"bridge_{tile.id}.geojson"),
        bridges(
            tile, structures, marks, load_wikidata(tile), osm_bridge_ways(tile) if has_osm else None
        ),
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    write_platforms(tile, has_osm)
    print(f"{tile.id}: rail layer written")


def run_osm(tile: Tile) -> None:
    """Without a Basis-DLM: the same four files from OSM (rail_osm.py)."""
    if not has_extract(tile, "the rail layer from OSM"):
        return
    print(f"{tile.id}: no Basis-DLM — rails, ballast and bridges from OSM")
    write_geojson(
        tile.out("dlm", f"railarea_{tile.id}.geojson"),
        rail_osm.ballast(tile),
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    write_geojson(
        tile.out("dlm", f"rail_{tile.id}.geojson"), rail_osm.rails(tile), tile.epsg, OSM_ATTRIBUTION
    )
    ground = Ground(tile, rail_osm.networks(tile))
    found = decks(
        ground,
        rail_osm.bridge_lines(tile),
        rail_osm.footprints(tile),
        osm_structures(tile),
        fairway_marks(tile),
        load_wikidata(tile),
        merge=True,
        ways=osm_bridge_ways(tile),
    )
    write_geojson(tile.out("dlm", f"bridge_{tile.id}.geojson"), found, tile.epsg, OSM_ATTRIBUTION)
    write_platforms(tile, True)
    print(f"{tile.id}: rail layer written from OSM ({len(found)} decks)")


def write_platforms(tile: Tile, has_osm: bool) -> None:
    if has_osm:
        write_geojson(
            tile.out("dlm", f"platform_{tile.id}.geojson"),
            platforms(tile),
            tile.epsg,
            OSM_ATTRIBUTION,
        )
