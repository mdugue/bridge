"""Basis-DLM (+ DOM1/DGM1, + OSM) → the rail layer's four inputs (ADR 0013):

- ballast yards: `ver03_f` (OBJART 42010) dissolved into one non-overlapping
  surface and clipped to the tile;
- rails: heavy-rail `ver03_l` (SPW 1000) with `tracks` and `electrified`,
  fragments merged by shared endpoints (1 m snap);
- bridge decks, driven by every `ver06_l` centreline (BWF 1800): snapped to a
  `ver06_f` footprint within 50 m, else buffered by kind width; per-ring-vertex
  deck height = the abutment ramp lifted to the DOM surface, on a mosaic of
  the tile and its neighbours (a deck across a seam comes out the same in
  both tiles' files); `kind` from the rail/road/path networks under the
  centreline; `structure` from the nearest OSM `man_made=bridge` within
  60 m, or Wikidata; the DOM1 superstructure, the fairway clearance and the
  main span (bridge.py);
- platforms: OSM `railway=platform`.
"""

from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio.features import rasterize
from rasterio.merge import merge

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
from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, read_layer, write_geojson
from .osm import has_extract, read_osm, tag

WIDTH = {"rail": 9.0, "road": 11.0, "path": 3.5, "other": 8.0}
CAMBER = 0.012


# --- ballast and rails ---------------------------------------------------------


def ballast(tile: Tile) -> list[dict]:
    geoms, _ = read_layer(tile.dlm / "ver03_f.shp", tile.bounds, where="OBJART='42010'")
    if len(geoms) == 0:
        return []
    merged = shapely.intersection(
        shapely.union_all(shapely.make_valid(geoms)), shapely.box(*tile.bounds)
    )
    return [
        feature(geometry_json(part))
        for part in shapely.get_parts(merged)
        if isinstance(part, shapely.Polygon) and not part.is_empty
    ]


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


def rails(tile: Tile) -> list[dict]:
    geoms, fields = read_layer(
        tile.dlm / "ver03_l.shp", tile.bounds, where="SPW='1000'", columns=["SPW", "GLS", "ELK"]
    )
    groups: dict[tuple[int, int], list] = defaultdict(list)
    for g, gls, elk in zip(
        geoms, column(fields, "GLS", geoms), column(fields, "ELK", geoms), strict=True
    ):
        tracks = {"2000": 2, "3000": 3}.get(str(gls), 1)
        electrified = 1 if str(elk) == "1000" else 0
        for part in shapely.get_parts(g):
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


class Ground:
    """DGM1 and DOM1 around the tile — its own and its neighbours', so a deck
    across a seam gets the same heights from either tile — on a 1 m grid,
    and the network masks."""

    def __init__(self, tile: Tile):
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
        self.masks = {
            "rail": self._mask(tile, "ver03_l", 8, "SPW='1000'"),  # heavy rail only
            "road": self._mask(tile, "ver01_l", 8),
            "path": self._mask(tile, "ver02_l", 5),
        }

    def _mask(self, tile: Tile, layer: str, buffer: float, where: str | None = None):
        geoms, _ = read_layer(tile.dlm / f"{layer}.shp", self.bounds, where=where)
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

    def classify(self, pts) -> str:
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


def near(structures, cx: float, cy: float, reach: float = 60.0):
    """The OSM outlines around a deck centroid, nearest first."""
    hits = [(math.hypot(ox - cx, oy - cy), st, qid) for ox, oy, st, qid in structures]
    return sorted((h for h in hits if h[0] < reach), key=lambda h: h[0])


def bridge_properties(
    ground, ring, name, kind, structures, marks, known, centre=None
) -> dict | None:
    """Everything the viewer draws a deck from (see bridge.py). `centre` is
    the DLM bridge line the deck was built from, if any."""
    axis = deck_axis(ring, centre)
    line = deck_line(ground, ring, axis, kind)
    if line is None:
        return None
    cx = sum(x for x, _ in ring) / len(ring)
    cy = sum(y for _, y in ring) / len(ring)
    around = near(structures, cx, cy)
    structure = next((st for _, st, _ in around if st), "")
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
    outline = shapely.Polygon(ring)
    qids = [qid for _, _, qid in around if qid]
    qids += [m[3] for m in marks if m[3] and outline.distance(shapely.Point(m[0], m[1])) < 30]
    wd = wikidata_for(ring, name, qids, known)
    if wd:
        props["wikidata"] = wd["id"]
        props["structure"] = structure_of(wd["types"]) or structure
        if wd.get("mainSpan"):
            props["span"] = wd["mainSpan"]
    # Only a bridge of a kind that stands above its deck keeps what DOM1 saw
    # there: over a beam bridge it is catenary, trains or trees.
    if any(kind in props["structure"] for kind in STANDING):
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


def bridges(tile: Tile, structures, marks, known) -> list[dict]:
    ground = Ground(tile)
    line_geoms, line_fields = read_layer(
        tile.dlm / "ver06_l.shp", tile.bounds, where="BWF='1800'", columns=["BWF", "NAM"]
    )
    poly_geoms, _ = read_layer(tile.dlm / "ver06_f.shp", tile.bounds, where="BWF='1800'")
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
        props = bridge_properties(ground, ring, name, kind, structures, marks, known, centre)
        if props is None:
            return
        features.append(
            feature(
                {"type": "Polygon", "coordinates": [[[round(x, 2), round(y, 2)] for x, y in ring]]},
                props,
            )
        )

    for g, name in zip(line_geoms, column(line_fields, "NAM", line_geoms), strict=True):
        for part in shapely.get_parts(g):
            coords = [(x, y) for x, y, *_ in part.coords]
            if len(coords) < 2:
                continue
            pts = []
            for i in range(len(coords) - 1):
                a, b = coords[i], coords[i + 1]
                pts += [a, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)]
            pts.append(coords[-1])
            kind = ground.classify(pts)
            best = footprint_of(part, polys)
            if best >= 0:
                polys[best][3] = True
                emit(polys[best][0], name or None, kind, coords)
            else:
                emit(buffer_line(coords, WIDTH[kind] / 2), name or None, kind, coords)
    for p in polys:
        if not p[3]:
            emit(p[0], None, ground.classify(p[0] + [(p[1], p[2])]))
    return features


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
            if not is_platform(railway, other):
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
    if not tile.has_dlm("the rail layer (tracks, ballast, bridges, platforms)"):
        return
    write_geojson(tile.out("dlm", f"railarea_{tile.id}.geojson"), ballast(tile), tile.epsg)
    write_geojson(tile.out("dlm", f"rail_{tile.id}.geojson"), rails(tile), tile.epsg)
    has_osm = has_extract(tile, "bridge structure and platforms")
    structures = osm_structures(tile) if has_osm else []
    marks = fairway_marks(tile) if has_osm else []
    write_geojson(
        tile.out("dlm", f"bridge_{tile.id}.geojson"),
        bridges(tile, structures, marks, load_wikidata(tile)),
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    if has_osm:
        write_geojson(
            tile.out("dlm", f"platform_{tile.id}.geojson"),
            platforms(tile),
            tile.epsg,
            OSM_ATTRIBUTION,
        )
    print(f"{tile.id}: rail layer written")
