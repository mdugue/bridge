"""What a bridge deck learns beyond its footprint (rail.py builds the decks,
ADR 0030):

- **the deck line** — the roadway as DOM1 sees it along the axis (the lower
  third of the surface across the deck, smoothed), held near the abutment
  ramp; without DOM1 the ramp itself;
- **superstructure** — the steel or masonry that stands *above* the deck
  (the Blaues Wunder's truss and pylons, the Waldschlößchenbrücke's arch)
  measured in DOM1: along the deck's axis, the highest surface in each half
  of the cross-section above the deck line, cleaned of lamps, poles and
  cars (a morphological opening), kept where it rises ≥ 3 m for ≥ 25 m.
  Each half gives one rib: its lateral offset and a rise per 2 m station;
- **clearance** — the navigation clearance of the Elbe fairway from OSM's
  inland-waterway data (`seamark:type=bridge`, ODbL), over the DGM's water
  surface: the soffit height, hence the deck's structural depth there;
- **Wikidata** (CC0) — the structural type and the main span of a named
  bridge, from a file the ingest fetched (`<raw>/wikidata/`).

Everything here is optional: without DOM1 there are no ribs, without OSM no
clearance, without the Wikidata file the OSM `bridge:structure` stays.
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

from .common import Tile
from .osm import read_osm, tag

STEP = 2.0  # rib stations along the axis (m)
SAMPLE = 1.0  # profile sampling along the axis (m)
ACROSS = 0.5  # cross-section sampling (m)
EDGE = 3.0  # the cross-section reaches this far past the deck outline (m)
OPEN_M = 7  # opening window: anything narrower along the axis is clutter (m)
CLOSE_M = 11  # closing window: a gap this short in a member is filled (m)
MIN_RISE = 3.0  # a rib stands at least this far above the deck (m)
MIN_RUN = 25.0  # ... over at least this length (m)
MIN_PEAK = 5.0  # ... and somewhere this high (m)
MERGE_M = 3.0  # two half-ribs closer than this are one central rib (m)
# the kinds whose structure stands above the deck (`bridge:structure` tokens)
STANDING = ("arch", "truss", "suspension", "cantilever", "cable-stayed")
DEPTH_MIN, DEPTH_MAX = 0.6, 5.0  # the deck's structural depth, clamped (m)
CLEARANCE_REACH = 30.0  # a fairway mark belongs to a deck this close (m)
DECK_BELOW, DECK_ABOVE = 6.0, 4.0  # the measured deck stays this close to the ramp (m)
DECK_SMOOTH_M = 15  # along-axis median window for the measured deck (m)
MAX_GRADE = 0.08  # a road or path deck is no steeper than this
RAIL_GRADE = 0.04  # ...a railway deck no steeper than this


# --- the deck axis ---------------------------------------------------------------


class Axis:
    """A deck's centreline, first abutment → last: a polyline with stations
    (m along it) and, across it, offsets (m, + to the left)."""

    def __init__(self, pts):
        self.pts = np.asarray(pts, dtype=float)
        seg = np.diff(self.pts, axis=0)
        self.seg_len = np.hypot(seg[:, 0], seg[:, 1])
        keep = self.seg_len > 1e-6
        self.pts = np.vstack([self.pts[:1], self.pts[1:][keep]])
        seg = seg[keep]
        self.seg_len = self.seg_len[keep]
        self.dirs = seg / self.seg_len[:, None]
        self.cum = np.concatenate([[0.0], np.cumsum(self.seg_len)])
        self.length = float(self.cum[-1])

    def _segment(self, s):
        return np.clip(np.searchsorted(self.cum, s, side="right") - 1, 0, len(self.seg_len) - 1)

    def points(self, s, offset):
        """World (x, y) at stations `s` and offsets `offset` (broadcast)."""
        s = np.asarray(s, dtype=float)
        i = self._segment(s)
        d = self.dirs[i]
        base = self.pts[i] + d * (s - self.cum[i])[..., None]
        offset = np.asarray(offset, dtype=float)
        x = base[..., 0] - d[..., 1] * offset
        y = base[..., 1] + d[..., 0] * offset
        return x, y

    def point(self, s: float) -> tuple[float, float]:
        x, y = self.points(np.float64(s), 0.0)
        return float(x), float(y)

    def project(self, x: float, y: float) -> tuple[float, float]:
        """(station, offset) of the nearest point on the axis; beyond an end
        the station runs on along the end segment."""
        best = None
        last = len(self.seg_len) - 1
        for i, (p, d, n) in enumerate(zip(self.pts[:-1], self.dirs, self.seg_len, strict=True)):
            t = (x - p[0]) * d[0] + (y - p[1]) * d[1]
            tc = t if (i == 0 and t < 0) or (i == last and t > n) else min(max(t, 0.0), n)
            off = -(x - p[0]) * d[1] + (y - p[1]) * d[0]
            px, py = p[0] + d[0] * tc, p[1] + d[1] * tc
            dist = math.hypot(x - px, y - py)
            if best is None or dist < best[0]:
                best = (dist, float(self.cum[i] + tc), float(off))
        return best[1], best[2]

    def coords(self) -> list[list[float]]:
        return [[round(float(x), 2), round(float(y), 2)] for x, y in self.pts]


AXIS_REACH = 60.0  # a centreline is extended at most this far to the outline (m)


def deck_axis(ring, line=None) -> Axis:
    """The deck's centreline. The DLM bridge line where there is one, clipped
    to the outline and run on to its ends; else the long axis of the
    outline's minimum rotated rectangle, through its middle. (The two
    farthest-apart vertices, used before, are the corners of a diagonal:
    everything measured or drawn across the deck came out skewed by up to
    half its width.) Oriented from the end nearer the ring's first vertex."""
    poly = shapely.make_valid(shapely.Polygon(ring))
    pts = _line_axis(poly, line) if line is not None and len(line) >= 2 else None
    if pts is None:
        pts = _rect_axis(poly)
    first = ring[0]
    if math.dist(pts[-1], first) < math.dist(pts[0], first):
        pts = pts[::-1]
    return Axis(pts)


def _rect_axis(poly) -> list[tuple[float, float]]:
    rect = shapely.minimum_rotated_rectangle(poly)
    c = list(rect.exterior.coords)[:4] if rect.geom_type == "Polygon" else None
    if c is None:
        (x0, y0, x1, y1) = poly.bounds
        return [(x0, (y0 + y1) / 2), (x1, (y0 + y1) / 2)]
    mid = [((c[i][0] + c[(i + 1) % 4][0]) / 2, (c[i][1] + c[(i + 1) % 4][1]) / 2) for i in range(4)]
    # the short edges' midpoints: edge 0 and 2 or edge 1 and 3
    if math.dist(c[0], c[1]) < math.dist(c[1], c[2]):
        return [mid[0], mid[2]]
    return [mid[1], mid[3]]


def _line_axis(poly, line) -> list[tuple[float, float]] | None:
    inside = shapely.intersection(shapely.LineString(line), poly.buffer(1.0))
    parts = [g for g in shapely.get_parts(inside) if g.geom_type == "LineString"]
    if not parts:
        return None
    part = max(parts, key=lambda g: g.length)
    pts = [(x, y) for x, y, *_ in part.coords]
    if len(pts) < 2:
        return None
    grown = poly.buffer(0.5)
    for end in (0, -1):
        a, b = (pts[1], pts[0]) if end == 0 else (pts[-2], pts[-1])
        length = math.dist(a, b) or 1.0
        ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        reach = 0.0
        while reach < AXIS_REACH and shapely.contains_xy(
            grown, b[0] + ux * (reach + 0.5), b[1] + uy * (reach + 0.5)
        ):
            reach += 0.5
        tip = (b[0] + ux * reach, b[1] + uy * reach)
        if end == 0:
            pts[0] = tip
        else:
            pts[-1] = tip
    simple = shapely.LineString(pts).simplify(0.3)
    return [(x, y) for x, y, *_ in simple.coords]


def opening(values: np.ndarray, window: int) -> np.ndarray:
    """Morphological opening (min then max over `window` samples; NaN-aware):
    removes everything narrower than the window, keeps the rest's shape."""
    padded = np.where(np.isnan(values), -np.inf, values)
    return _slide(_slide(padded, window, np.min), window, np.max)


def closing(values: np.ndarray, window: int) -> np.ndarray:
    """Morphological closing (max then min): fills dips narrower than the
    window — the gaps the 1 m raster leaves in a slender steel member."""
    return _slide(_slide(values, window, np.max), window, np.min)


def _slide(values: np.ndarray, window: int, reduce) -> np.ndarray:
    half = window // 2
    n = len(values)
    return np.array([reduce(values[max(0, i - half) : i + half + 1]) for i in range(n)])


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) index ranges where `mask` is true."""
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        elif not m and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def clean_rise(rise: np.ndarray) -> np.ndarray:
    """The rib's rise per 1 m sample: opened (lamps, poles, cars go), closed
    (small gaps in the member fill), then only the runs that are long and
    high enough to be structure (0 elsewhere)."""
    opened = closing(opening(rise, OPEN_M), CLOSE_M)
    keep = np.zeros(len(rise))
    for s, e in runs(opened >= MIN_RISE):
        if (e - s) * SAMPLE >= MIN_RUN and opened[s:e].max() >= MIN_PEAK:
            keep[s:e] = opened[s:e]
    return keep


def cross_sections(ground, ring, edge: float, axis: Axis | None = None):
    """DOM1 over the deck, one row per SAMPLE along the axis and one column
    per ACROSS: (stations, across offsets, heights) — NaN outside the
    outline grown by `edge`. None without DOM1 or for a stub."""
    if ground.dom is None:
        return None
    axis = axis or deck_axis(ring)
    length = axis.length
    if length < 2 * SAMPLE:
        return None
    outline = shapely.make_valid(shapely.Polygon(ring))
    if edge > 0:
        outline = outline.buffer(edge)
    offs = [axis.project(x, y)[1] for x, y in ring]
    across = np.arange(min(offs) - edge, max(offs) + edge + 1e-6, ACROSS)
    stations = np.arange(0.0, length + 1e-6, SAMPLE)
    xs, ys = axis.points(stations[:, None], across[None, :])
    top = ground.sample(ground.dom, xs, ys)
    top[~shapely.contains_xy(outline, xs, ys)] = np.nan
    return stations, across, top


def rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    half = window // 2
    return np.array(
        [np.median(values[max(0, i - half) : i + half + 1]) for i in range(len(values))]
    )


def limit_grade(deck: np.ndarray, step: float, grade: float) -> np.ndarray:
    """The deck line no steeper than `grade`: anchored on the median of its
    middle third, walked out to both ends. A deck's end over a street below
    (the DOM sees the street there) ramps instead of dropping off a cliff."""
    n = len(deck)
    if n < 3:
        return deck
    out = deck.copy()
    mid = n // 2
    out[mid] = float(np.median(deck[n // 3 : max(n // 3 + 1, 2 * n // 3)]))
    rise = grade * step
    for i in range(mid + 1, n):
        out[i] = min(max(deck[i], out[i - 1] - rise), out[i - 1] + rise)
    for i in range(mid - 1, -1, -1):
        out[i] = min(max(deck[i], out[i + 1] - rise), out[i + 1] + rise)
    return out


def measured_deck(ground, ring, ramp, grade: float = MAX_GRADE, axis: Axis | None = None):
    """The deck line as DOM1 sees the roadway: per station the lower third
    of the surface across the deck (parapets, cars and lamps stand above
    it), held within DECK_BELOW/DECK_ABOVE of the abutment ramp (a train or
    a canopy over the deck is not the deck), smoothed along the axis and
    no steeper than `grade`. Returns deck(t), or the ramp itself without
    DOM1."""
    section = cross_sections(ground, ring, 0.0, axis)
    if section is None:
        return ramp
    stations, _, top = section
    length = stations[-1]
    base = np.array([ramp(s / length) for s in stations])
    with np.errstate(all="ignore"):
        seen = np.nanpercentile(np.where(np.isnan(top), np.inf, top), 30, axis=1)
    seen[~np.isfinite(seen)] = np.nan
    deck = np.where(np.isnan(seen), base, np.clip(seen, base - DECK_BELOW, base + DECK_ABOVE))
    deck = limit_grade(rolling_median(deck, DECK_SMOOTH_M), SAMPLE, grade)
    return lambda t: float(np.interp(t * length, stations, deck))


def superstructure(ground, ring, deck_at, axis: Axis | None = None) -> list[dict]:
    """The deck's ribs from DOM1: [{offset, rise}] — `offset` the signed
    distance from the axis (m, + to its left), `rise` the height above the
    deck line per STEP from the first abutment (m, 0 where there is none)."""
    section = cross_sections(ground, ring, EDGE, axis)
    if section is None or section[0][-1] < MIN_RUN:
        return []
    stations, across, top = section
    length = stations[-1]
    deck = np.array([deck_at(s / length) for s in stations])
    ribs = []
    for side in (across < 0, across >= 0):
        half = np.where(side[None, :], top, np.nan)
        valid = ~np.all(np.isnan(half), axis=1)
        high = np.full(len(stations), np.nan)
        where = np.full(len(stations), np.nan)
        high[valid] = np.nanmax(half[valid], axis=1)
        where[valid] = across[np.nanargmax(half[valid], axis=1)]
        rise = clean_rise(high - deck)
        if rise.max() <= 0:
            continue
        offset = float(np.nanmedian(where[rise > 0]))
        every = max(1, round(STEP / SAMPLE))
        stations_out = [round(float(r), 1) for r in rise[::every]]
        ribs.append({"offset": round(offset, 1), "rise": stations_out})
    if len(ribs) == 2 and abs(ribs[0]["offset"] - ribs[1]["offset"]) < MERGE_M:
        merged = [max(p, q) for p, q in zip(ribs[0]["rise"], ribs[1]["rise"], strict=True)]
        ribs = [{"offset": round((ribs[0]["offset"] + ribs[1]["offset"]) / 2, 1), "rise": merged}]
    return ribs


# --- navigation clearance (OSM seamarks) -------------------------------------------


def fairway_marks(tile: Tile) -> list[tuple[float, float, float, str | None]]:
    """(x, y, clearance m, wikidata) of the OSM inland-waterway bridge marks."""
    geoms, fields = read_osm(
        tile,
        "points",
        "other_tags LIKE '%seamark:bridge:clearance_height%'",
        ["other_tags"],
        margin=0.01,
    )
    out = []
    for g, other in zip(geoms, fields.get("other_tags", [None] * len(geoms)), strict=True):
        if tag(other, "seamark:type") != "bridge":
            continue
        try:
            clearance = float(tag(other, "seamark:bridge:clearance_height") or "")
        except ValueError:
            continue
        out.append((g.x, g.y, clearance, tag(other, "wikidata")))
    return out


def fairway(ground, ring, deck_at, marks, axis: Axis | None = None) -> dict:
    """{fairway, clearance, depth} for a deck a fairway mark belongs to:
    `fairway` where along the axis (0..1), `depth` = deck − (water +
    clearance)."""
    poly = shapely.Polygon(ring)
    best, bd = None, CLEARANCE_REACH
    for mark in marks:
        d = poly.distance(shapely.Point(mark[0], mark[1]))
        if d <= bd:
            best, bd = mark, d
    if best is None:
        return {}
    axis = axis or deck_axis(ring)
    s_at, _ = axis.project(best[0], best[1])
    t = min(max(s_at / axis.length, 0.0), 1.0) if axis.length > 0 else 0.5
    water = ground.lowest(best[0], best[1], 15)
    if water is None:
        return {}
    depth = deck_at(t) - (water + best[2])
    return {
        "fairway": round(t, 3),
        "clearance": best[2],
        "depth": round(min(max(depth, DEPTH_MIN), DEPTH_MAX), 2),
    }


# --- Wikidata ------------------------------------------------------------------------

SPARQL = "https://query.wikidata.org/sparql"
QUERY = """
SELECT ?b ?label ?coord (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (SAMPLE(?span) AS ?mainSpan) (SAMPLE(?len) AS ?length) WHERE {
  SERVICE wikibase:box {
    ?b wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(%(w)f %(s)f)"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(%(e)f %(n)f)"^^geo:wktLiteral .
  }
  ?b wdt:P31/wdt:P279* wd:Q12280 .
  ?b wdt:P31 ?type . ?type rdfs:label ?typeLabel FILTER(lang(?typeLabel) = "de")
  ?b rdfs:label ?label FILTER(lang(?label) = "de")
  OPTIONAL { ?b wdt:P2787 ?span } OPTIONAL { ?b wdt:P2043 ?len }
} GROUP BY ?b ?label ?coord
"""

# German Wikidata classes → the OSM `bridge:structure` vocabulary the viewer reads
STRUCTURES = [
    ("Bogenbrücke", "arch"),
    ("Steinbrücke", "arch"),
    ("Gewölbebrücke", "arch"),
    ("Hängebrücke", "suspension"),
    ("Kettenbrücke", "suspension"),
    ("Gerberträger", "cantilever"),
    ("Fachwerkbrücke", "truss"),
    ("Schrägseilbrücke", "cable-stayed"),
    ("Balkenbrücke", "beam"),
    ("Spannbetonbrücke", "beam"),
]


def structure_of(types: list[str]) -> str:
    """Wikidata classes → `bridge:structure` tokens (";"-joined, in order)."""
    out: list[str] = []
    for word, token in STRUCTURES:
        if any(word in t for t in types) and token not in out:
            out.append(token)
    return ";".join(out)


def fetch_wikidata(raw: Path, tile_id: str, bounds, epsg: int, margin: float = 500.0) -> None:
    """The bridges Wikidata knows around a tile → `<raw>/wikidata/bridges_<tile>.json`
    (ingest time only; the bake reads the file, never the network)."""
    dest = raw / "wikidata" / f"bridges_{tile_id}.json"
    if dest.exists():
        return
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = bounds
    lons, lats = back.transform(
        [xmin - margin, xmax + margin, xmin - margin, xmax + margin],
        [ymin - margin, ymin - margin, ymax + margin, ymax + margin],
    )
    query = QUERY % {"w": min(lons), "s": min(lats), "e": max(lons), "n": max(lats)}
    req = urllib.request.Request(
        f"{SPARQL}?{urllib.parse.urlencode({'query': query})}",
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": "bridge-bake/0.1 (city walker; offline bake)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            rows = json.load(res)["results"]["bindings"]
    except OSError as err:
        print(f"{tile_id}: Wikidata not fetched ({err}); bridges keep the OSM structure")
        return
    bridges = []
    for r in rows:
        lon, lat = (float(v) for v in r["coord"]["value"][6:-1].split())
        bridges.append(
            {
                "id": r["b"]["value"].rsplit("/", 1)[-1],
                "label": r["label"]["value"],
                "lon": lon,
                "lat": lat,
                "types": sorted(r["types"]["value"].split("|")),
                "mainSpan": float(r["mainSpan"]["value"]) if "mainSpan" in r else None,
                "length": float(r["length"]["value"]) if "length" in r else None,
            }
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {"source": "Wikidata (CC0)", "query": SPARQL, "bridges": bridges}
    dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(f"{tile_id}: {len(bridges)} Wikidata bridges → {dest}")


def load_wikidata(tile: Tile) -> list[dict]:
    """The fetched Wikidata bridges, with their position in the tile's CRS."""
    path = tile.raw / "wikidata" / f"bridges_{tile.id}.json"
    if not path.exists():
        return []
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    out = []
    for b in json.loads(path.read_text())["bridges"]:
        x, y = to_tile.transform(b["lon"], b["lat"])
        out.append({**b, "x": x, "y": y})
    return out


def wikidata_for(ring, name, wikidata_ids: list[str], known: list[dict]) -> dict | None:
    """The Wikidata bridge a deck is: one an OSM `wikidata` tag on or near the
    deck names, else the one whose label is the deck's DLM name and whose
    point lies within 150 m of it."""
    by_id = {b["id"]: b for b in known}
    for qid in wikidata_ids:
        if qid in by_id:
            return by_id[qid]
    if not name:
        return None
    poly = shapely.Polygon(ring)
    for b in known:
        if b["label"] == name and poly.distance(shapely.Point(b["x"], b["y"])) <= 150.0:
            return b
    return None
