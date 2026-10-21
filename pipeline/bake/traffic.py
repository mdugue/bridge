"""The counted motor traffic → one line per road section and tile, with the
vehicles per day in each direction and the heavy-goods share.

The site names its source (`Site.dataLayers.traffic`; traffic_sources.py:
the fetch and the mapping of a row). `bun run fetch` caches it as
`<raw>/traffic/<tile>.geojson`; the output carries the source's
`attribution`. Dresden's own table (`section_props`, below — the WFS's
"Kfz/Tag", `cls:L363`, Landeshauptstadt Dresden, dl-de/by-2-0): one
feature is one section between two crossings, both directions on one
line: `dtv_hin` runs the way the line is drawn, `dtv_rueck` against it
(−1 where that direction was not counted — a one-way street, or a count of
one side only), `sv_*` the heavy vehicles (lorries and buses over 3.5 t)
per day. Most sections are counted by hand on one day and scaled to the
year's average day; the induction loops (PZS) and infrared detectors (TEU)
give a yearly mean, a "Hilfswert" (HW) is the office's estimate. The other
sources count both directions together; their total is split evenly
(traffic_sources.py `split_total`, `sp` 1). This step:

  1. clips every section to the tile (a section across a seam is cut there,
     so each tile draws its own piece and nothing twice);
  2. keeps a direction only where its count is positive, and the section
     only where at least one is (or the undirected total is);
  3. flags a section that runs over a bridge: at least DECK_MIN_M of it
     inside a road deck (rail.py's `bridge_<tile>.geojson`, this tile's and
     its neighbours'), within DECK_ANGLE_DEG of the deck's axis there. The
     viewer lifts it onto the deck there, and nowhere else — a road passing
     under a bridge crosses its deck, and stays on the ground. Only a tile
     without a bridge file falls back to the street's name ("…brücke"):
     the name had flagged none of Hamburg's 33 sections on a deck (its
     sources name no streets) and missed 25 of Dresden's, while flagging 14
     that no deck carries (a street named after a bridge it leads to);
  4. writes the counts as they are: no smoothing, no gap filling between
     counted sections (a street without a count draws nothing).

Where the fetch's cache of the counts is gone, a re-bake takes the bridge
flag of the committed sections anew from the decks (`reflag`) and leaves
their counts as they are.

Output `data/<site>/dlm/traffic_<tile>.geojson`, LineStrings with
  f vehicles per day along the line (absent = not counted), b against it,
  t the total (f + b, or the table's own total where neither direction
  is given), hf / hb the heavy share along / against (0..1, absent = not
  counted), y the year of the count, m the method ("man", "loop",
  "detector", "estimate", "census"), sp 1 = a total split evenly between
  the directions, n the street, br 1 = on a bridge
  (lib/city/features.ts `TrafficFeature`).
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import shapely

from .common import Tile, feature, geometry_json, write_geojson

ATTRIBUTION = "Verkehrsmengen © Landeshauptstadt Dresden (dl-de/by-2-0)"
METHODS = {"MAN": "man", "PZS": "loop", "TEU": "detector", "HW": "estimate"}
BRIDGE = re.compile(r"brücke$", re.IGNORECASE)
MIN_PIECE_M = 2.0  # a clipped sliver shorter than this is dropped
SIMPLIFY_M = 0.2  # the WFS lines carry millimetre noise
# A section on this much of a road deck (m), running within DECK_ANGLE_DEG
# of the deck's axis, rides the bridge (step 3).
DECK_MIN_M = 10.0
DECK_ANGLE_DEG = 30.0


def _count(value) -> int | None:
    """A positive count, or None (−1 / −2 / 0 mean "not counted")."""
    return round(value) if isinstance(value, (int, float)) and value > 0 else None


def _share(heavy, total: int | None) -> float | None:
    """The heavy share of one direction, clamped to 0..1 (the table has a
    section or two with more lorries than vehicles)."""
    if total is None or not isinstance(heavy, (int, float)) or heavy < 0:
        return None
    return round(min(heavy / total, 1.0), 3)


def _year(text) -> int | None:
    m = re.search(r"(\d{4})$", str(text or "").strip())
    return int(m.group(1)) if m else None


def section_props(q: dict) -> dict | None:
    """The output properties of one WFS row, or None when it counts nothing."""
    f = _count(q.get("dtv_hin"))
    b = _count(q.get("dtv_rueck"))
    total = (f or 0) + (b or 0) or _count(q.get("dtv_gesamt"))
    if not total:
        return None
    props: dict = {"t": total}
    if f:
        props["f"] = f
        if (hf := _share(q.get("sv_hin"), f)) is not None:
            props["hf"] = hf
    if b:
        props["b"] = b
        if (hb := _share(q.get("sv_rueck"), b)) is not None:
            props["hb"] = hb
    if (year := _year(q.get("zaehldat_text"))) is not None:
        props["y"] = year
    codes = {q.get("zaehlart_h"), q.get("zaehlart_r")}
    # The weakest method of the two directions names the section.
    for code in ("HW", "MAN", "TEU", "PZS"):
        if code in codes:
            props["m"] = METHODS[code]
            break
    name = (q.get("str_bez") or "").strip()
    if name:
        props["n"] = name
        if BRIDGE.search(name):
            props["br"] = 1
    return props


def _pieces(geom: shapely.Geometry) -> list[shapely.LineString]:
    if geom.is_empty:
        return []
    if isinstance(geom, shapely.LineString):
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in _pieces(g)]
    return []


Deck = tuple[shapely.Geometry, shapely.LineString]


def road_decks(paths, bounds) -> list[Deck]:
    """The road decks (outline, axis) of the bridge files that exist,
    those that reach into `bounds`."""
    box = shapely.box(*bounds)
    out: list[Deck] = []
    for path in paths:
        for f in json.loads(path.read_text()).get("features", []):
            p = f.get("properties") or {}
            axis = p.get("axis")
            if p.get("kind") != "road" or not f.get("geometry") or not axis or len(axis) < 2:
                continue
            poly = shapely.geometry.shape(f["geometry"])
            if poly.intersects(box):
                out.append((poly, shapely.LineString(axis)))
    return out


def _axis_direction(axis: shapely.LineString, x: float, y: float) -> tuple[float, float]:
    """The axis's unit direction at the point of it nearest (x, y)."""
    s = axis.project(shapely.Point(x, y))
    a = axis.interpolate(max(s - 1.0, 0.0))
    b = axis.interpolate(min(s + 1.0, axis.length))
    dx, dy = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def on_deck(line: shapely.LineString, decks: list[Deck]) -> bool:
    """Whether DECK_MIN_M of the line lies inside one road deck, each piece
    of it within DECK_ANGLE_DEG of the deck's axis there."""
    cos_max = math.cos(math.radians(DECK_ANGLE_DEG))
    for poly, axis in decks:
        along = 0.0
        for piece in _pieces(shapely.intersection(line, poly)):
            xy = list(piece.coords)
            for (x0, y0), (x1, y1) in zip(xy, xy[1:], strict=False):
                seg = math.hypot(x1 - x0, y1 - y0)
                if seg == 0:
                    continue
                ax, ay = _axis_direction(axis, (x0 + x1) / 2, (y0 + y1) / 2)
                if abs((x1 - x0) * ax + (y1 - y0) * ay) / seg >= cos_max:
                    along += seg
        if along >= DECK_MIN_M:
            return True
    return False


def bridge_flag(props: dict, piece: shapely.LineString, decks: list[Deck] | None) -> dict:
    """The piece's properties with `br` from the decks it runs on (step 3);
    without decks, as the source's mapping named it."""
    if decks is None:
        return props
    out = {k: v for k, v in props.items() if k != "br"}
    if on_deck(piece, decks):
        out["br"] = 1
    return out


def clip_sections(
    raw: dict,
    bounds,
    props_of=None,
    key: str | None = "sta_id",
    decks: list[Deck] | None = None,
) -> list[dict]:
    """The tile's pieces of every counted section, read through the
    source's mapping (`props_of`; default Dresden's `section_props`) and
    sorted by its key and position (a re-bake diffs by what changed).
    With `decks` (the tile's road decks) a piece is on a bridge where it
    runs on one; without, where its street is named one."""
    box = shapely.box(*bounds)
    rows = []
    for f in raw.get("features", []):
        q = f.get("properties") or {}
        props = (props_of or section_props)(q)
        geom = f.get("geometry")
        if props is None or not geom:
            continue
        line = shapely.geometry.shape(geom)
        clipped = shapely.intersection(line, box)
        # A section along the seam is merged back into one line per piece
        # (the clip may cut it into several touching segments).
        if isinstance(clipped, shapely.MultiLineString):
            clipped = shapely.line_merge(clipped)
        for piece in _pieces(clipped):
            if piece.length < MIN_PIECE_M:
                continue
            piece = piece.simplify(SIMPLIFY_M)
            x0, y0 = piece.coords[0]
            rows.append(
                (
                    str(q.get(key) or "") if key else "",
                    round(x0, 1),
                    round(y0, 1),
                    piece,
                    bridge_flag(props, piece, decks),
                )
            )
    rows.sort(key=lambda r: r[:3])
    return [feature(geometry_json(r[3]), dict(r[4])) for r in rows]


def tile_decks(tile: Tile) -> list[Deck] | None:
    """The road decks reaching into the tile, from its bridge file and its
    neighbours'; None where the tile has no bridge file (rail.py not run):
    the sections then keep the name's flag."""
    own = tile.data / "dlm" / f"bridge_{tile.id}.geojson"
    if not own.exists():
        return None
    files = {own, *(tile.data / "dlm" / f"bridge_{tid}.geojson" for tid, _ in tile.neighbours())}
    return road_decks(sorted(f for f in files if f.exists()), tile.bounds)


def reflag(path: Path, decks: list[Deck]) -> list[dict]:
    """A committed traffic file's sections, their bridge flag taken anew
    from the decks (the counts as they were): what a re-bake can do where
    the fetch's cache of the counts is gone."""
    doc = json.loads(path.read_text())
    for f in doc.get("features", []):
        line = shapely.geometry.shape(f["geometry"])
        f["properties"] = bridge_flag(f.get("properties") or {}, line, decks)
    path.write_text(json.dumps(doc))
    return doc.get("features", [])


def _report(tile: Tile, features: list[dict], decks: list[Deck] | None, what: str) -> None:
    bridges = sum(1 for f in features if f["properties"].get("br"))
    rule = "by name (no bridge file)" if decks is None else f"on {len(decks)} road decks"
    print(f"{tile.id}: {len(features)} {what}, {bridges} on a bridge ({rule})")


def run(tile: Tile) -> None:
    from .traffic_sources import raw_path, source_of

    source = source_of(tile)
    if source is None:
        print(f"{tile.id}: the site names no traffic counts — skipping the traffic layer")
        return
    path = raw_path(tile)
    decks = tile_decks(tile)
    out = tile.data / "dlm" / f"traffic_{tile.id}.geojson"
    if not path.exists():
        if decks is not None and out.exists():
            _report(tile, reflag(out, decks), decks, "committed sections re-flagged")
            return
        print(f"{tile.id}: no traffic counts at {path} — skipping the traffic layer")
        return
    features = clip_sections(
        json.loads(path.read_text()), tile.bounds, source.props, source.key, decks
    )
    # A tile without a counted road still gets its file, empty (lib/city/
    # tile-data.test.ts holds every tile to the same set of files).
    write_geojson(tile.out("dlm", out.name), features, tile.epsg, source.attribution)
    _report(tile, features, decks, "counted road sections")
