"""Basis-DLM (+ DOM1/DGM1, + OSM) → the rail layer's four inputs (ADR 0013):

- ballast yards: `ver03_f` (OBJART 42010) dissolved into one non-overlapping
  surface and clipped to the tile;
- rails: heavy-rail `ver03_l` (SPW 1000) with `tracks` and `electrified`,
  fragments merged by shared endpoints (1 m snap);
- bridge decks, driven by every `ver06_l` centreline (BWF 1800): snapped to a
  `ver06_f` footprint within 50 m, else buffered by kind width; per-ring-vertex
  deck height = the abutment ramp lifted to the DOM surface; `kind` from the
  rail/road/path networks under the centreline; `structure` from the nearest
  OSM `man_made=bridge` within 60 m;
- platforms: OSM `railway=platform`.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
import rasterio
import shapely
from rasterio.features import rasterize

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, read_layer, write_geojson
from .osm import read_osm, tag

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


class Ground:
    """DGM1 and DOM1 on the tile's 1 m grid, and the network masks."""

    def __init__(self, tile: Tile):
        self.xmin, _, _, self.ymax = tile.bounds
        with rasterio.open(tile.dgm) as dgm:
            self.dgm = dgm.read(1).astype(np.float64)
        dom_path = tile.raw_raster("dom1")
        if dom_path.exists():
            with rasterio.open(dom_path) as dom:
                self.dom = dom.read(1).astype(np.float64)
        else:
            self.dom = None  # decks fall back to the DGM ramp
        self.size = self.dgm.shape[0]
        self.masks = {
            "rail": self._mask(tile, "ver03_l", 8, "SPW='1000'"),  # heavy rail only
            "road": self._mask(tile, "ver01_l", 8),
            "path": self._mask(tile, "ver02_l", 5),
        }

    def _mask(self, tile: Tile, layer: str, buffer: float, where: str | None = None):
        geoms, _ = read_layer(tile.dlm / f"{layer}.shp", tile.bounds, where=where)
        if len(geoms) == 0:
            return None
        out = np.zeros((self.size, self.size), dtype=np.uint8)
        rasterize(
            ((shapely.buffer(g, buffer), 1) for g in geoms),
            out=out,
            transform=tile.transform(self.size),
        )
        return out

    def px(self, x: float, y: float) -> tuple[int, int]:
        c = min(max(int(x - self.xmin), 0), self.size - 1)
        r = min(max(int(self.ymax - y), 0), self.size - 1)
        return c, r

    def robust(self, arr: np.ndarray | None, x: float, y: float, win: int) -> float | None:
        if arr is None:
            return None
        c, r = self.px(x, y)
        block = arr[max(r - win, 0) : r + win + 1, max(c - win, 0) : c + win + 1]
        vals = np.sort(block[block > -1000], axis=None)
        return float(vals[len(vals) // 2]) if len(vals) else None

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


def deck_profile(ground: Ground, ring: list[tuple[float, float]]) -> list[float] | None:
    """Per-ring-vertex deck height: a ramp between the abutments (the
    farthest-apart ring vertices) plus a midspan camber — never dipping into
    the river. None when there is no valid ground under the deck at all."""
    uniq = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    a, b, best = uniq[0], uniq[-1], -1.0
    for i in range(len(uniq)):
        for j in range(i + 1, len(uniq)):
            d = (uniq[i][0] - uniq[j][0]) ** 2 + (uniq[i][1] - uniq[j][1]) ** 2
            if d > best:
                best, a, b = d, uniq[i], uniq[j]
    h0, h1 = ground.endpoint_h(*a), ground.endpoint_h(*b)
    if h0 is None and h1 is None:
        hs = sorted(h for h in (ground.endpoint_h(x, y) for x, y in uniq) if h is not None)
        if not hs:
            return None
        h0 = h1 = hs[len(hs) // 2]
    h0 = h1 if h0 is None else h0
    h1 = h0 if h1 is None else h1
    ax, ay = b[0] - a[0], b[1] - a[1]
    l2 = ax * ax + ay * ay
    camber = min(math.sqrt(l2) * CAMBER, 1.6)
    deck = []
    for x, y in ring:
        t = ((x - a[0]) * ax + (y - a[1]) * ay) / l2 if l2 > 0 else 0.0
        t = max(0.0, min(1.0, t))
        deck.append(round(h0 + (h1 - h0) * t + camber * math.sin(math.pi * t), 2))
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


def osm_structures(tile: Tile) -> list[tuple[float, float, str]]:
    """(centroid x, y, bridge:structure) of the OSM bridge outlines."""
    out = []
    for layer in ("multipolygons", "lines"):
        geoms, fields = read_osm(tile, layer, "man_made = 'bridge'", ["man_made", "other_tags"])
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            structure = tag(other, "bridge:structure")
            if structure and not g.is_empty:
                c = g.centroid
                out.append((c.x, c.y, structure))
    return out


def bridges(tile: Tile, structures: list[tuple[float, float, str]]) -> list[dict]:
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
                    polys.append([ring, cx, cy, False])

    def structure_at(cx: float, cy: float) -> str:
        best, bd = "", 60.0**2
        for ox, oy, st in structures:
            d = (ox - cx) ** 2 + (oy - cy) ** 2
            if d < bd:
                bd, best = d, st
        return best

    features = []

    def emit(ring, name, kind):
        deck = deck_profile(ground, ring)
        if deck is None:
            return
        cx = sum(x for x, _ in ring) / len(ring)
        cy = sum(y for _, y in ring) / len(ring)
        features.append(
            feature(
                {"type": "Polygon", "coordinates": [[[round(x, 2), round(y, 2)] for x, y in ring]]},
                {"name": name, "kind": kind, "structure": structure_at(cx, cy), "deck": deck},
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
            mx = sum(x for x, _ in coords) / len(coords)
            my = sum(y for _, y in coords) / len(coords)
            best, bd = -1, 50.0**2
            for pi, p in enumerate(polys):
                if not p[3]:
                    d = (p[1] - mx) ** 2 + (p[2] - my) ** 2
                    if d < bd:
                        bd, best = d, pi
            if best >= 0:
                polys[best][3] = True
                emit(polys[best][0], name or None, kind)
            else:
                emit(buffer_line(coords, WIDTH[kind] / 2), name or None, kind)
    for p in polys:
        if not p[3]:
            emit(p[0], None, ground.classify(p[0] + [(p[1], p[2])]))
    return features


# --- platforms ---------------------------------------------------------------------


def platforms(tile: Tile) -> list[dict]:
    where = "railway = 'platform' OR (public_transport = 'platform' AND railway IS NOT NULL)"
    features = []
    for layer in ("multipolygons", "lines"):
        try:
            geoms, _ = read_osm(tile, layer, where, ["railway", "public_transport"], margin=0.0005)
        except Exception:  # a layer without the public_transport column
            geoms, _ = read_osm(tile, layer, "railway = 'platform'", ["railway"], margin=0.0005)
        for g in geoms:
            for part in shapely.get_parts(g):
                if (
                    isinstance(part, shapely.LineString)
                    and part.is_closed
                    and len(part.coords) >= 4
                ):
                    part = shapely.Polygon(part.coords)
                if not part.is_empty:
                    features.append(feature(geometry_json(part)))
    return features


def run(tile: Tile) -> None:
    write_geojson(tile.out("dlm", f"railarea_{tile.id}.geojson"), ballast(tile), tile.epsg)
    write_geojson(tile.out("dlm", f"rail_{tile.id}.geojson"), rails(tile), tile.epsg)
    has_osm = tile.osm_extract() is not None
    if not has_osm:
        print(f"{tile.id}: no .osm.pbf — bridges without structure, no platforms")
    structures = osm_structures(tile) if has_osm else []
    write_geojson(
        tile.out("dlm", f"bridge_{tile.id}.geojson"),
        bridges(tile, structures),
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    write_geojson(
        tile.out("dlm", f"platform_{tile.id}.geojson"),
        platforms(tile) if has_osm else [],
        tile.epsg,
        OSM_ATTRIBUTION,
    )
    print(f"{tile.id}: rail layer written")
