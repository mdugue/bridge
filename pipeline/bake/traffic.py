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
  3. flags a section whose street is a bridge (its name ends in "brücke"):
     the viewer lifts it onto the deck there, and nowhere else — a road
     passing under a railway bridge stays on the ground;
  4. writes the counts as they are: no smoothing, no gap filling between
     counted sections (a street without a count draws nothing).

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
import re

import shapely

from .common import Tile, feature, geometry_json, write_geojson

ATTRIBUTION = "Verkehrsmengen © Landeshauptstadt Dresden (dl-de/by-2-0)"
METHODS = {"MAN": "man", "PZS": "loop", "TEU": "detector", "HW": "estimate"}
BRIDGE = re.compile(r"brücke$", re.IGNORECASE)
MIN_PIECE_M = 2.0  # a clipped sliver shorter than this is dropped
SIMPLIFY_M = 0.2  # the WFS lines carry millimetre noise


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


def clip_sections(raw: dict, bounds, props_of=None, key: str | None = "sta_id") -> list[dict]:
    """The tile's pieces of every counted section, read through the
    source's mapping (`props_of`; default Dresden's `section_props`) and
    sorted by its key and position (a re-bake diffs by what changed)."""
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
                (str(q.get(key) or "") if key else "", round(x0, 1), round(y0, 1), piece, props)
            )
    rows.sort(key=lambda r: r[:3])
    return [feature(geometry_json(r[3]), dict(r[4])) for r in rows]


def run(tile: Tile) -> None:
    from .traffic_sources import raw_path, source_of

    source = source_of(tile)
    if source is None:
        print(f"{tile.id}: the site names no traffic counts — skipping the traffic layer")
        return
    path = raw_path(tile)
    if not path.exists():
        print(f"{tile.id}: no traffic counts at {path} — skipping the traffic layer")
        return
    features = clip_sections(json.loads(path.read_text()), tile.bounds, source.props, source.key)
    # A tile without a counted road still gets its file, empty (lib/city/
    # tile-data.test.ts holds every tile to the same set of files).
    out = tile.out("dlm", f"traffic_{tile.id}.geojson")
    write_geojson(out, features, tile.epsg, source.attribution)
    print(f"{tile.id}: {len(features)} counted road sections")
