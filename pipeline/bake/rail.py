"""Basis-DLM (+ DOM1/DGM1, + OSM) → the rail layer's four inputs (ADR 0041):

- ballast: the railway land `ver03_f` (OBJART 42010) where a track's bed
  lies on it (the baked rails by their count, off bridges and off the
  paving), one non-overlapping surface clipped to the tile;
- rails: OSM's every track, one by one (rail_osm.rails: `bridge`, `layer`,
  `paved`, `steep` for a funicular, the catenary masts `m`), and
  heavy-rail `ver03_l` (SPW 1000) with `tracks` and `electrified` only
  where OSM has no track within 6 m, fragments merged by shared endpoints
  (1 m snap); and OSM's monorails as beams (rail_osm.monorails, `mono`);
- bridge decks, driven by every `ver06_l` centreline (BWF 1800): snapped to a
  `ver06_f` footprint within 50 m, else buffered by kind width; per-ring-vertex
  deck height = the abutment ramp lifted to the DOM surface, on a mosaic of
  the tile and its neighbours (a deck across a seam comes out the same in
  both tiles' files); `kind` from the rail/road/path networks under the
  centreline; `structure` from the nearest OSM `man_made=bridge` within
  60 m, else the OSM bridge ways on the deck (their `bridge:structure`, or
  an arch for one built before 1850), or Wikidata; a deck the DLM leaves
  unnamed takes the name of its OSM bridge ways; a deck a funicular runs
  on is a rail deck measured within the funicular's grade
  (rail_osm.STEEP_DECK_GRADE); the DOM1 superstructure,
  the fairway clearance and the main span (bridge.py);
- platforms: OSM `railway=platform`, with their height above the rail top
  by the trains they serve.
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
    EDGE_DROP_M,
    MAX_GRADE,
    RAIL_GRADE,
    STANDING,
    STEP,
    WIDTH_REACH,
    Axis,
    Wet,
    bastion_piers,
    deck_axis,
    deck_halves,
    fairway,
    fairway_marks,
    load_wikidata,
    measured_deck,
    measured_halves,
    structure_of,
    superstructure,
    under_deck,
    water_runs,
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
PAVEMENT_M = 2.0  # a road bridge's pavement either side of the carriageway (m)
YARD_GAP_M = 4.0  # the ballast closes a gap this narrow between two beds
CAMBER = 0.012


# --- ballast and rails ---------------------------------------------------------


def ballast(tile: Tile, lines: list[dict]) -> list[dict]:
    """The railway land where a track's bed lies on it. The DLM's parcel
    reaches the fences: it holds the depots and their yards' tarmac, the
    embankments' grass, the station forecourts — on Leipzig's four tiles
    two thirds of it lay off every track, and all of it was drawn as raised
    ballast. So the parcel is cut to the beds of `lines` (the baked rails,
    `rails`: OSM's every track, a yard's every siding, and the DLM's lines
    OSM has none beside, by their track count), off bridges and where no
    track is set in the paving (`rail_osm.beds`)."""
    geoms, _ = read_layer(tile.dlm / "ver03_f.shp", tile.bounds, where="OBJART='42010'")
    if len(geoms) == 0:
        return []
    beds = rail_osm.beds(lines)
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
# …and the U-Bahn's: its current runs in a third rail, under no overhead line.
SUBWAY_BKT = {"1202"}
# The DLM's line is OSM's tracks where one runs this close (m): a line of
# two tracks lies 2 m from each, one of three 4 m from its outer ones.
OSM_TRACK_REACH_M = 6.0
# What is left of a DLM line beside OSM's tracks, shorter than this (m), is
# where the two draw a curve or a switch apart, not a track OSM lacks.
DLM_REST_M = 20.0


def dlm_rails(tile: Tile) -> list[tuple[shapely.LineString, int, int]]:
    """The Basis-DLM's heavy-rail centrelines above ground (`ver03_l` SPW
    1000, not a tram's, out of the DLM's tunnels): (line, tracks — `GLS`,
    electrified — `ELK`, 2 a U-Bahn's third rail)."""
    geoms, fields = read_layer(
        tile.dlm / "ver03_l.shp",
        tile.bounds,
        where="SPW='1000'",
        columns=["SPW", "GLS", "ELK", "BKT"],
    )
    under = dlm_tunnels(tile)
    out = []
    for g, gls, elk, bkt in zip(
        geoms,
        column(fields, "GLS", geoms),
        column(fields, "ELK", geoms),
        column(fields, "BKT", geoms),
        strict=True,
    ):
        kinds = set(str(bkt).split("#"))
        if kinds <= TRAM_BKT:
            continue
        tracks = {"2000": 2, "3000": 3}.get(str(gls), 1)
        electrified = (2 if kinds & SUBWAY_BKT else 1) if str(elk) == "1000" else 0
        for part in (p for line in shapely.get_parts(g) for p in above_ground(line, under)):
            if isinstance(part, shapely.LineString) and len(part.coords) >= 2:
                out.append((part, tracks, electrified))
    return out


def electrified_near(dlm: list[tuple[shapely.LineString, int, int]]):
    """What an OSM way OSM leaves untagged is electrified with: the DLM's
    line nearest its middle (≤ OSM_TRACK_REACH_M; `ELK`), else nothing."""
    if not dlm:
        return lambda _g: 0
    tree = shapely.STRtree([line for line, *_ in dlm])

    def near(g: shapely.Geometry) -> int:
        mid = shapely.line_interpolate_point(g, 0.5, normalized=True)
        found = tree.query_nearest(mid, max_distance=OSM_TRACK_REACH_M)
        return dlm[int(found[0])][2] if len(found) else 0

    return near


def rails(tile: Tile, osm: bool = False) -> list[dict]:
    """The tile's tracks. With the site's OSM extract (`osm`): OSM's every
    track, one by one (rail_osm.rails; an untagged way electrified as the
    DLM's line beside it), its catenary masts on them, and the DLM's lines
    only where OSM has no track within OSM_TRACK_REACH_M (each rest at
    least DLM_REST_M) — the DLM gives a line one centreline and its `GLS`
    at most three, and drew two tracks for fifteen at Dresden's
    Hauptbahnhof (OSM 195 track-km on the site, the DLM 77). Without: the
    DLM's lines, each as its `GLS` tracks side by side."""
    dlm = dlm_rails(tile)
    if not osm:
        return dlm_features(dlm)
    features = rail_osm.rails(tile, electrified_near(dlm))
    taken = rail_osm.claimed(tile, OSM_TRACK_REACH_M)
    rest = []
    for line, tracks, electrified in dlm:
        left = line if taken is None else shapely.difference(line, taken)
        rest += [
            (part, tracks, electrified)
            for part in shapely.get_parts(left)
            if isinstance(part, shapely.LineString) and part.length >= DLM_REST_M
        ]
    features += dlm_features(rest)
    rail_osm.masts(tile, features)
    return features


def dlm_features(dlm: list[tuple[shapely.LineString, int, int]]) -> list[dict]:
    """The DLM's lines as features, fragments of one kind merged by shared
    endpoints."""
    groups: dict[tuple[int, int], list] = defaultdict(list)
    for line, tracks, electrified in dlm:
        groups[(tracks, electrified)].append([(x, y) for x, y, *_ in line.coords])
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
    path centrelines within `bounds`, and each road's carriageway width
    (`BRF`, m; NaN where the DLM leaves it out) as `road_width`."""
    rail, fields = read_layer(
        tile.dlm / "ver03_l.shp", bounds, where="SPW='1000'", columns=["SPW", "BKT"]
    )
    roads, road_fields = read_layer(tile.dlm / "ver01_l.shp", bounds, columns=["BRF"])
    widths = []
    for brf in column(road_fields, "BRF", roads):
        try:
            widths.append(float(brf) if 2.0 <= float(brf) <= 40.0 else math.nan)
        except (TypeError, ValueError):
            widths.append(math.nan)
    return {
        "rail": [
            g
            for g, bkt in zip(rail, column(fields, "BKT", rail), strict=True)
            if not set(str(bkt).split("#")) <= TRAM_BKT
        ],
        "road": list(roads),
        "path": list(read_layer(tile.dlm / "ver02_l.shp", bounds)[0]),
        "road_width": widths,
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
        self.road_width = list(networks.get("road_width", []))
        # what a deck learns of its surroundings (bridge.py): the water under
        # it, the ways under it (read once a deck asks), the bridges beside it,
        # OSM's ways on the bridges (a funicular's deck is measured steep)
        self.tile = tile
        self.wet = Wet(tile)
        self._under: UnderWays | None = None
        self.beside: Beside | None = None
        self.ways: BridgeWays | None = None

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

    def under(self) -> UnderWays:
        """The OSM highways off any bridge around the tile, with each one's
        passage half-width (rail_osm.under_ways); none without an extract."""
        if self._under is None:
            found = rail_osm.under_ways(self.tile) if self.tile.osm_extract() else []
            self._under = UnderWays(found)
        return self._under

    def mapped_width(self, coords, kind: str) -> float | None:
        """A road bridge's width from the Basis-DLM: the carriageway width
        (`BRF`) of the road that runs along the bridge line, with a
        pavement either side; None where the DLM gives none."""
        tree = self.trees.get(kind)
        if kind != "road" or tree is None or not self.road_width or len(coords) < 2:
            return None
        line = shapely.LineString(coords)
        zone = line.buffer(NETWORK_REACH[kind])
        best, most = None, 0.5 * line.length
        for i in tree.query(zone, predicate="intersects"):
            width = self.road_width[i] if i < len(self.road_width) else math.nan
            inside = self.networks[kind][i].intersection(zone).length
            if not math.isnan(width) and inside > most:
                best, most = width, inside
        return best + 2 * PAVEMENT_M if best is not None else None

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


def deck_line(
    ground: Ground, ring: list[tuple[float, float]], axis, kind: str = "road", steep: bool = False
):
    """The deck height along the axis, t ∈ [0, 1]: the roadway DOM1 measures,
    held near the abutment ramp and within the kind's grade — a
    funicular's (`steep`) far past a railway's (bridge.measured_deck). None
    without ground."""
    ramp = ramp_line(ground, axis)
    if ramp is None:
        return None
    grade = rail_osm.STEEP_DECK_GRADE if steep else RAIL_GRADE if kind == "rail" else MAX_GRADE
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


def buffer_line(coords, half: float, right_half: float | None = None) -> list[tuple[float, float]]:
    """A centreline offset to a deck polygon (left side + reversed right):
    `half` to its left, `right_half` (else `half`) to its right."""
    n = len(coords)
    other = half if right_half is None else right_half
    left, right = [], []
    for i in range(n):
        a, b = coords[max(0, i - 1)], coords[min(n - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        length = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / length, tx / length
        left.append((coords[i][0] + nx * half, coords[i][1] + ny * half))
        right.append((coords[i][0] - nx * other, coords[i][1] - ny * other))
    return left + right[::-1]


class UnderWays:
    """The ways a deck may pass over — (line, passage half-width) — by
    where they run."""

    def __init__(self, ways: list[tuple[shapely.Geometry, float]]) -> None:
        self.ways = ways
        self.tree = shapely.STRtree([g for g, _ in ways]) if ways else None

    def near(self, outline: shapely.Geometry) -> list[tuple[shapely.Geometry, float]]:
        if self.tree is None:
            return []
        return [self.ways[int(i)] for i in self.tree.query(outline, predicate="intersects")]


class Beside:
    """The bridges a deck's sides are measured against (bridge.py
    `section_edges`): every bridge line and footprint of the tile. A deck
    ends where another one's footprint begins, or where a point lies nearer
    another bridge's line than its own: twin bridges with no gap between
    them, a railway beside a road on one structure."""

    def __init__(self, lines: list[shapely.Geometry], footprints: list[shapely.Geometry]) -> None:
        self.lines = lines
        self.tree = shapely.STRtree(lines) if lines else None
        self.footprints = footprints

    def stop(self, own: shapely.Geometry, outline: shapely.Geometry | None = None):
        """For the deck along `own`: whether points stand on another deck.
        The lines on the deck itself (half of them within a metre of `own`
        or of its `outline`: its pavements, its cycle track) and the
        footprint under its middle are its own."""
        zone = own.buffer(WIDTH_REACH + EDGE_DROP_M + 2.0)
        mine = (outline if outline is not None else own).buffer(1.0)
        found = self.tree.query(zone) if self.tree is not None else []
        near = [self.lines[int(i)] for i in found]
        near = [g for g in near if g.intersection(mine).length < LINE_ON_FOOTPRINT * g.length]
        others = shapely.union_all(near) if near else None
        middle = shapely.line_interpolate_point(own, 0.5, normalized=True)
        polys = [
            f for f in self.footprints if f.intersects(zone) and not f.buffer(1.0).contains(middle)
        ]
        foreign = shapely.union_all(polys) if polys else None

        def at(xs, ys):
            xs, ys = np.asarray(xs, dtype=float), np.asarray(ys, dtype=float)
            out = np.zeros(xs.shape, dtype=bool)
            if foreign is not None:
                out |= shapely.contains_xy(foreign, xs, ys)
            if others is not None:
                pts = shapely.points(xs, ys)
                out |= shapely.distance(pts, others) < shapely.distance(pts, own)
            return out

        return at


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
    steep: bool = False  # a funicular runs on it (rail_osm.STEEP)


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


def bridge_way(
    line: shapely.Geometry, name: str | None, other: str | None, railway: str | None = None
) -> BridgeWay | None:
    """What an OSM way on a bridge says of it: its own name (`bridge:name`,
    else a `name` that names a bridge), its structure (`bridge:structure`,
    else an arch for a `start_date` before MASONRY_BEFORE) or its Wikidata
    item; or that a funicular runs on it (`steep`). Nothing: None."""
    if line is None or line.is_empty or tag(other, "bridge") in (None, "no"):
        return None
    own = tag(other, "bridge:name") or (name if name and BRIDGE_NAME.search(name.strip()) else None)
    structure, dated = tag(other, "bridge:structure") or "", False
    year = re.search(r"\d{4}", tag(other, "start_date") or "")
    if not structure and year and int(year.group(0)) < MASONRY_BEFORE:
        structure, dated = "arch", True
    qid = tag(other, "wikidata")
    steep = (railway or tag(other, "railway")) in rail_osm.STEEP
    if own or structure or qid or steep:
        return BridgeWay(line, own, structure, dated, qid, steep)
    return None


def osm_bridge_ways(tile: Tile) -> BridgeWays:
    """The tile's OSM ways on a bridge that say something of it
    (`bridge_way`). No extract: none."""
    if tile.osm_extract() is None:
        return BridgeWays([])
    geoms, fields = read_osm(
        tile, "lines", "other_tags LIKE '%\"bridge\"=>%'", ["name", "railway", "other_tags"]
    )
    names, others = column(fields, "name", geoms), column(fields, "other_tags", geoms)
    railways = column(fields, "railway", geoms)
    found = (
        bridge_way(g, name, other, railway)
        for g, name, other, railway in zip(geoms, names, others, railways, strict=True)
    )
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
    outline = shapely.Polygon(ring)
    on = ways.on(outline) if ways is not None else []
    # a funicular's deck (Dresden's Gerüstviadukt): a rail deck, as steep
    steep = any(w.steep for w in on)
    if steep:
        kind = "rail"
    line = deck_line(ground, ring, axis, kind, steep)
    if line is None:
        return None
    cx = sum(x for x, _ in ring) / len(ring)
    cy = sum(y for _, y in ring) / len(ring)
    around = near(structures, cx, cy)
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
    known_structure = tagged
    if wd:
        props["wikidata"] = wd["id"]
        known_structure = structure_of(wd["types"]) or tagged
        props["structure"] = structure_of(wd["types"]) or structure
        if wd.get("mainSpan"):
            props["span"] = wd["mainSpan"]
    # Only a bridge of a kind that stands above its deck keeps what DOM1 saw
    # there: over a beam bridge it is catenary, trains or trees. An arch of
    # the year's guess (no tag, no Wikidata class) is masonry, its vaults
    # under the deck.
    guessed = not known_structure
    if not guessed and any(kind in props["structure"] for kind in STANDING):
        ribs = superstructure(ground, ring, line, axis)
        if ribs:
            props["ribs"] = ribs
    props.update(below_deck(ground, ring, axis, line, props, wd))
    return props


MASONRY = ("arch", "humpback")  # the `bridge:structure` tokens of a stone bridge


def below_deck(ground, ring, axis: Axis, line, props: dict, wd: dict | None) -> dict:
    """What carries a deck and what passes under it: the stretches over
    water (`water`, where the viewer stands a river pier, not a viaduct's
    columns), a masonry bridge's arches — Wikidata's number of spans
    (`spans`) and DOM1's piers (`piers`, kept where Wikidata's count does
    not say otherwise) — and the passages the terrain opens under it
    (`under`, bridge.py `under_deck`)."""
    out: dict = {}
    if not isinstance(ground, Ground):
        return out  # a stand-in ground (the tests'): nothing around the deck
    water = water_runs(ground.wet, axis)
    if water:
        out["water"] = water
    spans = wd.get("spans") if wd else None
    if spans:
        out["spans"] = spans
    if any(m in props["structure"] for m in MASONRY) and not props.get("ribs"):
        stop = (
            ground.beside.stop(shapely.LineString(axis.pts), shapely.Polygon(ring))
            if ground.beside is not None
            else None
        )
        piers = bastion_piers(ground, axis, line, stop)
        if piers and (not spans or len(piers) == spans - 1):
            out["piers"] = piers
    ways = ground.under().near(shapely.Polygon(ring).buffer(1.0))
    under = under_deck(ground, ring, axis, line, ways, ground.wet)
    if under:
        out["under"] = under
    return out


LINE_ON_FOOTPRINT = 0.5  # a bridge line lies on a footprint when this share of it is inside


def footprint_of(line, polys, claimed: bool = False) -> int:
    """The unclaimed footprint (with `claimed`, any footprint) a bridge line
    runs on, or −1. Nearness is not enough: the Marienbrücke's road line
    runs 16 m beside the rail bridge's footprint (the road bridge has none
    of its own), and matching it by centroid laid the road on the tracks
    and left the road bridge undrawn."""
    best, most = -1, LINE_ON_FOOTPRINT * line.length
    for pi, p in enumerate(polys):
        if claimed or not p[3]:
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
    """Decks from bridge centrelines `(geometry, name, kind or None[, width,
    level])` and footprints. The lines on a footprint make it one deck — or
    one per network they carry, the rails apart from a road
    (`footprint_decks`); a line on none is buffered as wide as DOM1 sees its
    deck (`band`), else at its mapped or its kind's width; a footprint no
    line runs on is a deck of its own. With `merge` (OSM, where a
    carriageway, its pavements and a cycle track are separate ways) the
    buffers of the lines on no footprint merge by level (`merged_decks`)."""
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

    members = []
    for g, name, given, *rest in lines:
        width = rest[0] if rest else None
        level = rest[1] if len(rest) > 1 else 0
        for part in shapely.get_parts(g):
            coords = line_coords(part)
            if len(coords) >= 2:
                kind = given or ground.classify(coords)
                members.append(Member(part, name, kind, width, level))
    ground.beside = Beside([m.line for m in members], [p[4] for p in polys])
    ground.ways = ways
    on: dict[int, list[Member]] = defaultdict(list)
    loose = []
    for m in members:
        best = footprint_of(m.line, polys, claimed=True)
        if best >= 0:
            polys[best][3] = True
            on[best].append(m)
        elif merge:
            loose.append(m)
        else:
            coords = line_coords(m.line)
            fallback = m.width or ground.mapped_width(coords, m.kind) or WIDTH[m.kind]
            ring = band(ground, coords, m.kind, fallback) or buffer_line(coords, fallback / 2)
            emit(ring, m.name, m.kind, coords)
    for pi, found in on.items():
        for deck in footprint_decks(polys[pi][4], found):
            emit(*deck)
    for deck in merged_decks(loose, ground):
        emit(*deck)
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


def line_coords(line) -> list[tuple[float, float]]:
    return [(x, y) for x, y, *_ in line.coords]


class Member(NamedTuple):
    """A bridge line a deck is built from."""

    line: shapely.Geometry
    name: str | None
    kind: str
    width: float | None  # its mapped width (m; OSM `width` or `lanes`)
    level: int


KIND_RANK = {"rail": 0, "road": 1, "path": 2, "other": 3}
SPLIT_MIN_M2 = 20.0  # a network's share of a deck smaller than this is no deck (m²)


def weightiest(members) -> str:
    return min((m.kind for m in members), key=lambda k: KIND_RANK[k])


def carried(members) -> list[list[Member]]:
    """The deck's lines by the network they carry: the rails apart from the
    rest (a road with its pavements is one deck, a railway beside it
    another), each group non-empty."""
    groups = [[m for m in members if m.kind == "rail"], [m for m in members if m.kind != "rail"]]
    return [g for g in groups if g]


def band(ground, coords, kind: str, fallback: float, outline=None):
    """A bridge line's deck as DOM1 sees it: its measured sides (bridge.py
    `measured_halves`; a bridge beside it stops them, `Beside`) offset from
    the line, the side DOM1 lost mirrored, the total WIDTH_MIN..WIDTH_MAX
    (`deck_halves`). None without DOM1 or where it sees neither side. The
    kind's width drew the Elbe's road bridges at half theirs. The sides are
    read at the deck's height, a funicular's within its own grade."""
    if ground.dom is None:
        return None
    first = buffer_line(coords, fallback / 2)
    axis = deck_axis(first, coords)
    on = ground.ways.on(shapely.Polygon(first)) if ground.ways is not None else []
    line = deck_line(ground, first, axis, kind, any(w.steep for w in on))
    if line is None or axis.length <= 0:
        return None
    own = shapely.LineString(axis.pts)
    stop = ground.beside.stop(own, outline) if ground.beside is not None else None
    measured = measured_halves(ground, axis, line, stop)
    if measured == (None, None):
        return None
    left, right = deck_halves(measured, fallback)
    return buffer_line([(float(x), float(y)) for x, y in axis.pts], left, right)


def split_nearest(area, groups: list[list[Member]]) -> list[shapely.Geometry]:
    """`area`'s share nearest each group's lines: a Voronoi of points every
    2 m along them, its cells joined by group."""
    pts, label, seen = [], [], set()
    for k, group in enumerate(groups):
        for m in group:
            for d in np.arange(0.0, m.line.length + 1e-6, 2.0):
                p = m.line.interpolate(d)
                key = (round(p.x, 1), round(p.y, 1))
                if key not in seen:
                    seen.add(key)
                    pts.append(p)
                    label.append(k)
    cells = shapely.get_parts(
        shapely.voronoi_polygons(shapely.MultiPoint(pts), extend_to=area.buffer(10.0))
    )
    tree = shapely.STRtree(pts)
    shares: list[list] = [[] for _ in groups]
    for cell in cells:
        hit = tree.query(cell, predicate="contains")
        if len(hit):
            shares[label[int(hit[0])]].append(cell)
    return [
        shapely.intersection(area, shapely.union_all(c)) if c else shapely.Polygon() for c in shares
    ]


def shared_decks(area, members: list[Member], name: str | None) -> list[tuple]:
    """One deck per network on `area` (`carried`), each its share nearest
    its lines (`split_nearest`): (ring, name, kind, centre). Drawn as one
    deck of its first line's kind, the Lombardsbrücke's road lay under
    ballast and rails, the Oberhafenbrücke's two decks were both railway."""
    groups = carried(members)
    if len(groups) < 2:
        longest = max(members, key=lambda m: m.line.length)
        return [(polygon_ring(area), name, weightiest(members), line_coords(longest.line))]
    out = []
    for group, share in zip(groups, split_nearest(area, groups), strict=True):
        for part in shapely.get_parts(share):
            if isinstance(part, shapely.Polygon) and part.area >= SPLIT_MIN_M2:
                out.append(
                    (
                        polygon_ring(part),
                        next((m.name for m in group if m.name), name),
                        weightiest(group),
                        centre_on(part, group),
                    )
                )
    return out


def polygon_ring(area) -> list[tuple[float, float]]:
    """The outer ring of `area` (its largest polygon), simplified to 0.3 m."""
    polys = [
        p for p in shapely.get_parts(shapely.make_valid(area)) if isinstance(p, shapely.Polygon)
    ]
    biggest = max(polys, key=lambda p: p.area)
    return [(x, y) for x, y, *_ in biggest.simplify(0.3).exterior.coords]


def centre_on(part, group: list[Member]) -> list[tuple[float, float]]:
    """The longest stretch of the group's lines on a deck's share: its
    centre."""
    grown = part.buffer(1.0)
    pieces = [
        piece
        for m in group
        for piece in shapely.get_parts(shapely.intersection(m.line, grown))
        if piece.geom_type == "LineString" and piece.length > 0
    ]
    if not pieces:
        return line_coords(max(group, key=lambda m: m.line.length).line)
    return line_coords(max(pieces, key=lambda p: p.length))


def footprint_decks(poly, members: list[Member]) -> list[tuple]:
    """A footprint's decks: one, of the weightiest kind of the lines on it,
    along the first of them; where rails and a road or a path share it, one
    per network (`shared_decks`)."""
    name = next((m.name for m in members if m.name), None)
    if len(carried(members)) < 2:
        ring = [(x, y) for x, y, *_ in poly.exterior.coords]
        return [(ring, name, weightiest(members), line_coords(members[0].line))]
    return shared_decks(poly, members, name)


def merged_decks(loose, ground=None):
    """One deck per group of touching buffered lines on one level — the
    union of their buffers at their mapped (else their kind's) width,
    widened to DOM1's deck around the longest (`band`) with `ground` — and
    per network it carries (`shared_decks`): its first name, its
    weightiest kind (road over path) and its longest line as its centre."""
    items = [Member(*it) for it in loose]
    by_level: dict = defaultdict(list)
    for item in items:
        by_level[item.level].append(item)
    out = []
    for group in by_level.values():
        shapes = [
            shapely.buffer(m.line, (m.width or WIDTH[m.kind]) / 2, cap_style="flat") for m in group
        ]
        merged = shapely.union_all(shapes)
        for part in shapely.get_parts(merged):
            if not isinstance(part, shapely.Polygon) or part.area < 1.0:
                continue
            members = [m for m, sh in zip(group, shapes, strict=True) if sh.intersects(part)]
            name = next((m.name for m in members if m.name), None)
            out += shared_decks(widened(part, members, ground), members, name)
    return out


def widened(part, members: list[Member], ground):
    """A merged deck widened to DOM1's deck around its longest line (`band`):
    the mapped widths are a carriageway's, its pavements often unmapped."""
    if ground is None:
        return part
    longest = max(members, key=lambda m: m.line.length)
    kind = weightiest(members)
    ring = band(ground, line_coords(longest.line), kind, longest.width or WIDTH[kind], part)
    if ring is None:
        return part
    seen = shapely.make_valid(shapely.Polygon(ring))
    return shapely.union(part, seen) if seen.intersects(part) else part


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


# A platform's height above the rail top (m), by the trains it serves where
# OSM maps no `height`: a main-line station's 0.76 m (a small station's
# 0.55 m OSM does not tell apart), an S-Bahn's 0.96 m (Hamburg's is
# `light_rail`), a U-Bahn's ~1 m, a tram stop's kerb.
PLATFORM_HEIGHT = {
    "rail": 0.76,
    "light_rail": 0.96,
    "subway": 1.0,
    "narrow_gauge": 0.55,
    "tram": 0.25,
}
# A platform serves the track nearest it within this (m), where its own
# tags (`subway`, `light_rail`, `train`, `tram`) do not say.
PLATFORM_TRACK_M = 15.0
TRACK_KINDS = (*rail_osm.RAILWAYS, "tram")


def mapped_height(other: str | None) -> float | None:
    """A platform's mapped `height` (m; a value over 3 read as cm), when
    plausible."""
    m = re.match(r"\d+(\.\d+)?", (tag(other, "height") or "").strip())
    if not m:
        return None
    h = float(m.group())
    h = h / 100 if h > 3 else h
    return h if 0.1 <= h <= 1.4 else None


def platform_kind(other: str | None, nearest: str | None) -> str:
    """The trains a platform serves: its own tags, else the track nearest
    it (`nearest`), else a main line's."""
    for kind in ("subway", "light_rail"):
        if tag(other, kind) == "yes":
            return kind
    if tag(other, "train") == "yes":
        return "rail"
    if tag(other, "tram") == "yes":
        return "tram"
    return nearest if nearest in PLATFORM_HEIGHT else "rail"


class Tracks:
    """OSM's tracks around the tile (trams too), by their `railway`, for
    the platform beside them."""

    def __init__(self, tile: Tile) -> None:
        kinds = ",".join(f"'{k}'" for k in TRACK_KINDS)
        geoms, fields = read_osm(tile, "lines", f"railway IN ({kinds})", ["railway"], margin=0.002)
        pairs = [
            (g, k)
            for g, k in zip(geoms, column(fields, "railway", geoms), strict=True)
            if g is not None and not g.is_empty
        ]
        self.kinds = [k for _, k in pairs]
        self.tree = shapely.STRtree([g for g, _ in pairs]) if pairs else None

    def nearest(self, g: shapely.Geometry) -> str | None:
        if self.tree is None:
            return None
        found = self.tree.query_nearest(g, max_distance=PLATFORM_TRACK_M)
        return self.kinds[int(found[0])] if len(found) else None


def platforms(tile: Tile) -> list[dict]:
    """Platform polygons (and the platforms OSM maps as a line), each owned
    by the tile its centroid falls in — read with a margin (so none is
    missed at a seam) but never written twice — with `h`, the platform's
    height above the rail top (`mapped_height`, else PLATFORM_HEIGHT by
    `k`, the trains it serves). The viewer stands it on the solved level of
    the track beside it (a deck, a viaduct; rail-layer.ts): drawn 0.55 m
    over the DGM, which already holds a third to all of a platform, the
    platforms on Hamburg's U3 viaduct stood on the street under it."""
    box = shapely.box(*tile.bounds)
    tracks = Tracks(tile)
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
                    kind = platform_kind(other, tracks.nearest(part))
                    h = mapped_height(other) or PLATFORM_HEIGHT[kind]
                    features.append(feature(geometry_json(part), {"h": round(h, 2), "k": kind}))
    return features


def run(tile: Tile) -> None:
    if not tile.products.dlm:
        run_osm(tile)
        return
    if not tile.has_dlm("the rail layer (tracks, ballast, bridges, platforms)"):
        return
    yards = has_extract(tile, "OSM's tracks, one by one")
    lines = rails(tile, yards)
    credit = f"{tile.credit}; tracks: {OSM_ATTRIBUTION}" if yards else None
    write_geojson(
        tile.out("dlm", f"railarea_{tile.id}.geojson"), ballast(tile, lines), tile.epsg, credit
    )
    beams = rail_osm.monorails(tile) if yards else []
    write_geojson(tile.out("dlm", f"rail_{tile.id}.geojson"), lines + beams, tile.epsg, credit)
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
    lines = rail_osm.rails(tile)
    rail_osm.masts(tile, lines)
    write_geojson(
        tile.out("dlm", f"railarea_{tile.id}.geojson"),
        rail_osm.ballast(tile, lines),
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    write_geojson(
        tile.out("dlm", f"rail_{tile.id}.geojson"),
        lines + rail_osm.monorails(tile),
        tile.epsg,
        OSM_ATTRIBUTION,
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
