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


# --- the deck axis ---------------------------------------------------------------


def long_axis(ring):
    """The two farthest-apart vertices: the abutment ends (as deck_profile)."""
    uniq = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    a, b, best = uniq[0], uniq[-1], -1.0
    for i in range(len(uniq)):
        for j in range(i + 1, len(uniq)):
            d = (uniq[i][0] - uniq[j][0]) ** 2 + (uniq[i][1] - uniq[j][1]) ** 2
            if d > best:
                best, a, b = d, uniq[i], uniq[j]
    return a, b


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


def cross_sections(ground, ring, edge: float):
    """DOM1 over the deck, one row per SAMPLE along a→b and one column per
    ACROSS: (stations, across offsets, heights) — NaN outside the outline
    grown by `edge`. None without DOM1 or for a stub."""
    if ground.dom is None:
        return None
    a, b = long_axis(ring)
    length = math.dist(a, b)
    if length < 2 * SAMPLE:
        return None
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    nx, ny = -uy, ux
    outline = shapely.Polygon(ring)
    if edge > 0:
        outline = outline.buffer(edge)
    offs = [(x - a[0]) * nx + (y - a[1]) * ny for x, y in ring]
    across = np.arange(min(offs) - edge, max(offs) + edge + 1e-6, ACROSS)
    stations = np.arange(0.0, length + 1e-6, SAMPLE)
    xs = a[0] + ux * stations[:, None] + nx * across[None, :]
    ys = a[1] + uy * stations[:, None] + ny * across[None, :]
    top = ground.sample(ground.dom, xs, ys)
    top[~shapely.contains_xy(outline, xs, ys)] = np.nan
    return stations, across, top


def rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    half = window // 2
    return np.array(
        [np.median(values[max(0, i - half) : i + half + 1]) for i in range(len(values))]
    )


def measured_deck(ground, ring, ramp):
    """The deck line as DOM1 sees the roadway: per station the lower third
    of the surface across the deck (parapets, cars and lamps stand above
    it), held within DECK_BELOW/DECK_ABOVE of the abutment ramp (a train or
    a canopy over the deck is not the deck), smoothed along the axis.
    Returns deck(t), or the ramp itself without DOM1."""
    section = cross_sections(ground, ring, 0.0)
    if section is None:
        return ramp
    stations, _, top = section
    length = stations[-1]
    base = np.array([ramp(s / length) for s in stations])
    with np.errstate(all="ignore"):
        seen = np.nanpercentile(np.where(np.isnan(top), np.inf, top), 30, axis=1)
    seen[~np.isfinite(seen)] = np.nan
    deck = np.where(np.isnan(seen), base, np.clip(seen, base - DECK_BELOW, base + DECK_ABOVE))
    deck = rolling_median(deck, DECK_SMOOTH_M)
    return lambda t: float(np.interp(t * length, stations, deck))


def superstructure(ground, ring, deck_at) -> list[dict]:
    """The deck's ribs from DOM1: [{offset, rise}] — `offset` the signed
    distance from the axis (m, + to the left of a→b), `rise` the height above
    the deck line per STEP from `a` (m, 0 where there is none)."""
    section = cross_sections(ground, ring, EDGE)
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


def fairway(ground, ring, deck_at, marks) -> dict:
    """{fairway, clearance, depth} for a deck a fairway mark belongs to:
    `fairway` where along a→b (0..1), `depth` = deck − (water + clearance)."""
    poly = shapely.Polygon(ring)
    best, bd = None, CLEARANCE_REACH
    for mark in marks:
        d = poly.distance(shapely.Point(mark[0], mark[1]))
        if d <= bd:
            best, bd = mark, d
    if best is None:
        return {}
    a, b = long_axis(ring)
    ax, ay = b[0] - a[0], b[1] - a[1]
    l2 = ax * ax + ay * ay
    t = ((best[0] - a[0]) * ax + (best[1] - a[1]) * ay) / l2 if l2 > 0 else 0.5
    t = min(max(t, 0.0), 1.0)
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
