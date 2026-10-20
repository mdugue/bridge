"""The street lamps' post heights, measured in DOM1 street by street.

Every post lamp stood 5 m tall. The surface model says otherwise: at a lamp
clear of trees and facades its highest texel within a metre is the post's
head where the scan caught it — Leipzig's primary roads' lamps read 10 m
(their median; quartiles 7.6–12.6 m), its residential streets' and
footpaths' 5 m, Dresden's Ostra-Allee 8.3 m and the Sarrasanistraße 3.4 m.
One lamp is a poor reading: the scan misses a thin post as often as it hits
it (a quarter of Leipzig's read under a metre), and a van or a branch reads
as a post. Lamps along one street are alike, so a street's lamps take the
median of its readings, and a lamp on a street with too few readings the
median of its kind of street on the tile — or the 5 m it had.

A reading counts (`peak`) when the highest DOM1 − DGM1 texel within
PEAK_M of the lamp lies between MIN_M and MAX_M, stands alone (no more
than ALONE_M2 within ALONE_M over half its height: a crown over the lamp
reads as tall over metres — Hamburg's footpath lamps read 7.4 m without
this, 6.8 m with it; a post's arm and head stay under it) and the ground
RING_M around it stands clear (median under CLEAR_M): no tree, roof or bus
over it. A lamp's street is the nearest OSM highway within STREET_M, by its
name (else the way) and its class. Hung lamps keep their wire's height; the lamps of `lamps.py` and
Mapillary's (`mapillary.py`) are measured together and both files
rewritten (`h`, and `hs`: "street" or "class").

Where the scan rarely shows a post (Grimma: six readings on one street),
the lamps keep 5 m."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio.enums import Resampling

from .common import Tile, column
from .lamps import LAMP_H
from .osm import has_extract, read_ways

PEAK_M = 1.0  # the post's head within this of the lamp's point
ALONE_M, ALONE_M2 = 2.0, 5.0  # within this, at most this much over half its height (m, m²)
RING_M = (3.0, 5.0)  # the ground around it, clear of everything
CLEAR_M = 1.0  # ... its median nDOM below this
MIN_M, MAX_M = 3.0, 14.0  # a reading between these is a post
STREET_M = 25.0  # a lamp's street: the nearest highway within this
STREET_MIN = 3  # readings a street needs for its own median
KIND_MIN = 10  # readings a kind of street needs on the tile
STEP_M = 0.5  # heights are rounded to this (the viewer draws one set each)
# the kinds of street whose lamps are alike
KINDS = {
    kind: group
    for group, kinds in {
        "main": ("motorway", "trunk", "primary", "secondary"),
        "mid": ("tertiary", "unclassified"),
        "res": ("residential", "living_street", "service"),
        "walk": ("pedestrian", "footway", "path", "cycleway", "steps", "track", "bridleway"),
    }.items()
    for base in kinds
    for kind in (base, f"{base}_link")
}


class Surface:
    """The tile's nDOM (DOM1 − DGM1) and its transform."""

    def __init__(self, tile: Tile) -> None:
        with rasterio.open(tile.raw_raster("dom1")) as dom:
            top = dom.read(1).astype(np.float64)
            self.transform = dom.transform
        with rasterio.open(tile.dgm) as dgm:
            ground = dgm.read(1, out_shape=top.shape, resampling=Resampling.bilinear)
        self.ndom = top - ground.astype(np.float64)
        self.res = abs(self.transform.a)
        r = int(np.ceil(RING_M[1] / self.res))
        yy, xx = np.mgrid[-r : r + 1, -r : r + 1] * self.res
        d = np.hypot(xx, yy)
        self.r, self.near, self.disk = r, d <= PEAK_M, d <= ALONE_M
        self.ring = (d >= RING_M[0]) & (d <= RING_M[1])

    def peak(self, x: float, y: float) -> float | None:
        """The post's height at (x, y), or None where it does not show."""
        c, r = (int(v) for v in ~self.transform * (x, y))
        n = self.r
        if not (n <= r < self.ndom.shape[0] - n and n <= c < self.ndom.shape[1] - n):
            return None
        w = self.ndom[r - n : r + n + 1, c - n : c + n + 1]
        top = float(np.nanmax(np.where(self.near, w, np.nan)))
        if not MIN_M <= top <= MAX_M or not np.nanmedian(w[self.ring]) < CLEAR_M:
            return None
        # a post is a spike: a crown over the lamp is as high over metres
        if np.count_nonzero(w[self.disk] > top / 2) * self.res**2 > ALONE_M2:
            return None
        return top


class Streets:
    """The OSM highways a lamp lights, by name (else the way) and class: the
    ways on the ground (`read_ways`), so a lamp on the square over a road
    tunnel is not the tunnel's."""

    def __init__(self, tile: Tile) -> None:
        geoms, fields = read_ways(tile, "highway IS NOT NULL", ["highway", "name"])
        kinds, names = column(fields, "highway", geoms), column(fields, "name", geoms)
        self.ways = [
            (g, f"{name or i}", KINDS[kind])
            for i, (g, kind, name) in enumerate(zip(geoms, kinds, names, strict=True))
            if g is not None and kind in KINDS
        ]
        self.tree = shapely.STRtree([g for g, _, _ in self.ways]) if self.ways else None

    def of(self, x: float, y: float) -> tuple[str, str] | None:
        """(street, kind) of the highway nearest (x, y) within STREET_M."""
        if self.tree is None:
            return None
        i = self.tree.nearest(shapely.Point(x, y))
        g, name, kind = self.ways[int(i)]
        return (name, kind) if g.distance(shapely.Point(x, y)) <= STREET_M else None


def heights(
    points: list[tuple[float, float]], surface: Surface, streets: Streets
) -> list[tuple[float, str] | None]:
    """Each point's post height and how it was found ("street", "class"),
    or None where neither has enough readings."""
    where = [streets.of(x, y) for x, y in points]
    by_street, by_kind = defaultdict(list), defaultdict(list)
    for (x, y), at in zip(points, where, strict=True):
        h = surface.peak(x, y) if at else None
        if h is not None:
            by_street[at].append(h)
            by_kind[at[1]].append(h)
    out: list[tuple[float, str] | None] = []
    for at in where:
        if at and len(by_street[at]) >= STREET_MIN:
            out.append((_step(by_street[at]), "street"))
        elif at and len(by_kind[at[1]]) >= KIND_MIN:
            out.append((_step(by_kind[at[1]]), "class"))
        else:
            out.append(None)
    return out


def _step(values: list[float]) -> float:
    return round(float(np.median(values)) / STEP_M) * STEP_M


def _posts(doc: dict, mapillary: bool) -> list[dict]:
    """The file's lamps that stand on a post (not hung)."""
    return [
        f
        for f in doc["features"]
        if not (f["properties"] or {}).get("wire")
        and (not mapillary or (f["properties"] or {}).get("k") == "lamp")
    ]


def run(tile: Tile) -> None:
    files = [(tile.out("dlm", f"lamps_{tile.id}.geojson"), False)]
    files.append((tile.out("dlm", f"mly_{tile.id}.geojson"), True))
    docs = [(p, json.loads(p.read_text()), m) for p, m in files if p.exists()]
    if not docs:
        print(f"{tile.id}: no lamps — skipping their heights")
        return
    if not tile.raw_raster("dom1").exists() or not has_extract(tile, "the lamps' streets"):
        print(f"{tile.id}: no DOM1 — the lamps keep {LAMP_H:g} m")
        return
    posts = [f for _, doc, m in docs for f in _posts(doc, m)]
    points = [tuple(f["geometry"]["coordinates"][:2]) for f in posts]
    found = heights(points, Surface(tile), Streets(tile))
    counts: dict[str, int] = defaultdict(int)
    for f, h in zip(posts, found, strict=True):
        props = f["properties"] = dict(f["properties"] or {})
        props.pop("hs", None)
        if h is None:
            props["h"] = LAMP_H
            counts["kept"] += 1
            continue
        props["h"], props["hs"] = h
        counts[h[1]] += 1
    for path, doc, _ in docs:
        _write(path, doc)
    print(f"{tile.id}: lamp heights {dict(counts)}")


def _write(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc))
