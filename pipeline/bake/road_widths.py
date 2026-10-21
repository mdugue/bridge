"""How wide a Basis-DLM road is where the DLM surveyed no width.

`landcover.road_buffers` buffers each road axis by its surveyed width `BRF`;
most axes have none (-9998: 71–77 % of the road length in Grimma, Meißen and
Unna, 95 % in Dresden) and took one width per road class `WDM` — 5 m for
every Gemeindestraße, a lane and a half, wherever cars park beside it or
not. OpenStreetMap often says more. Along each such axis, in pieces of
PIECE_M, the car way that runs with it (within MATCH_M, at most MATCH_DEG
off its direction) gives the carriageway:

- its `width:carriageway`, else its `width`;
- else its `lanes` (else the DLM's own lane count `FSZ`) × LANE_M, plus per
  side the part of a parking lane that lies on the carriageway
  (`carriageway_share`: PARKING_M, a metre less for bays half on the kerb,
  none for bays on it — 2 m for angled bays too: against Dresden's
  `width` tags their depth made the formula 3 m too wide);
- else, no lane count anywhere, the class's width plus that parking.

Without a matching way the class's width stands. Every width is capped at
MAX_HALF_M a side and floored at MIN_HALF_M; runs of pieces of one width
are buffered as one.
"""

from __future__ import annotations

import numpy as np
import shapely
from shapely.ops import substring

from .osm import read_ways, tag
from .surface import parking_side, parse_width

LANE_M = 3.0
PARKING_M = 2.0  # a parking lane on the carriageway, parallel or angled
PLACE_PAST_KERB_M = {0: 0.0, 1: 1.0}  # carriageway, half on kerb; on kerb: all
PIECE_M = 20.0
MATCH_M = 3.0
MATCH_DEG = 20.0
MAX_HALF_M = 12.0
MIN_HALF_M = 1.5
CAR_WAYS = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "road",
    "busway",
)


def carriageway_share(other_tags: str | None, side: str) -> float:
    """The metres a side's parking lane adds to the carriageway: PARKING_M
    on it, a metre less half on the kerb, nothing on the kerb."""
    code = parking_side(other_tags, side)
    if not code & 3:
        return 0.0
    place = (code >> 2) & 3
    return max(PARKING_M - PLACE_PAST_KERB_M.get(place, PARKING_M), 0.0)


def _lanes(other_tags: str | None) -> int | None:
    value = (tag(other_tags, "lanes") or "").split(";")[0].strip()
    return int(value) if value.isdigit() and 0 < int(value) < 12 else None


def osm_half(other_tags: str | None, fsz: int | None, class_half: float) -> float:
    """A carriageway's half-width from its way's tags (module doc), the
    DLM's lane count `fsz` where the way counts none."""
    width = parse_width(tag(other_tags, "width:carriageway")) or parse_width(
        tag(other_tags, "width")
    )
    if width:
        half = width / 2
    else:
        parked = carriageway_share(other_tags, "left") + carriageway_share(other_tags, "right")
        n = _lanes(other_tags) or fsz
        half = (n * LANE_M + parked) / 2 if n else class_half + parked / 2
    return float(min(max(half, MIN_HALF_M), MAX_HALF_M))


def _fsz(value) -> int | None:
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return n if 0 < n < 12 else None


class OsmCarWays:
    """The car ways on the ground near a tile, for matching DLM axes."""

    def __init__(self, geoms, other_tags):
        keep = [i for i, g in enumerate(geoms) if g is not None and not g.is_empty]
        self.geoms = np.array([geoms[i] for i in keep], dtype=object)
        self.tags = [other_tags[i] for i in keep]
        self.tree = shapely.STRtree(self.geoms)

    @classmethod
    def read(cls, tile) -> OsmCarWays:
        kinds = ", ".join(f"'{k}'" for k in CAR_WAYS)
        geoms, fields = read_ways(tile, f"highway IN ({kinds})", ["highway", "other_tags"])
        return cls(list(geoms), list(fields["other_tags"]))

    def match(self, mids: np.ndarray, dirs: np.ndarray) -> np.ndarray:
        """Per piece (midpoint, unit direction) the index of the nearest way
        within MATCH_M that runs within MATCH_DEG of it, else -1."""
        out = np.full(len(mids), -1, dtype=np.int64)
        if not len(mids) or not len(self.geoms):
            return out
        points = shapely.points(mids)
        piece, way = self.tree.query(shapely.buffer(points, MATCH_M), predicate="intersects")
        if not len(piece):
            return out
        lines = self.geoms[way]
        at = shapely.line_locate_point(lines, points[piece])
        a = shapely.get_coordinates(shapely.line_interpolate_point(lines, at - 1.0))
        b = shapely.get_coordinates(shapely.line_interpolate_point(lines, at + 1.0))
        d = b - a
        norm = np.hypot(d[:, 0], d[:, 1])
        cos = np.abs((d * dirs[piece]).sum(axis=1)) / np.maximum(norm, 1e-9)
        dist = shapely.distance(lines, points[piece])
        ok = (dist <= MATCH_M) & (norm > 1e-6) & (cos >= np.cos(np.radians(MATCH_DEG)))
        best = np.full(len(mids), np.inf)
        for p, w, dd in zip(piece[ok], way[ok], dist[ok], strict=True):
            if dd < best[p]:
                best[p], out[p] = dd, w
        return out


def pieces(line: shapely.LineString) -> tuple[list[tuple[float, float]], np.ndarray, np.ndarray]:
    """A line cut into equal pieces of at most PIECE_M: their (start, end)
    distances along it, midpoints and unit directions."""
    n = max(int(np.ceil(line.length / PIECE_M)), 1)
    cuts = np.linspace(0.0, line.length, n + 1)
    ends = shapely.get_coordinates(shapely.line_interpolate_point(line, cuts))
    d = ends[1:] - ends[:-1]
    norm = np.maximum(np.hypot(d[:, 0], d[:, 1]), 1e-9)
    mids = shapely.get_coordinates(shapely.line_interpolate_point(line, (cuts[1:] + cuts[:-1]) / 2))
    return list(zip(cuts[:-1], cuts[1:], strict=True)), mids, d / norm[:, None]


def buffered(
    line: shapely.LineString, osm: OsmCarWays | None, fsz, class_half: float
) -> list[shapely.Geometry]:
    """One DLM axis without a surveyed width, buffered piece by piece at
    the width OSM gives it (module doc); runs of one width as one."""
    if line.geom_type != "LineString":
        return [b for p in shapely.get_parts(line) for b in buffered(p, osm, fsz, class_half)]
    if osm is None or line.length < 1e-6:
        return [shapely.buffer(line, class_half)]
    spans, mids, dirs = pieces(line)
    ways = osm.match(mids, dirs)
    n = _fsz(fsz)
    halves = [class_half if w < 0 else osm_half(osm.tags[w], n, class_half) for w in ways]
    out, start = [], 0
    for i in range(1, len(spans) + 1):
        if i == len(spans) or abs(halves[i] - halves[start]) > 0.05:
            part = substring(line, spans[start][0], spans[i - 1][1])
            out.append(shapely.buffer(part, halves[start]))
            start = i
    return out
