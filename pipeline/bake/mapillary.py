"""Street lamps and litter bins OSM lacks, from Mapillary's detected objects.

Mapillary finds objects in its street photos and places each one by
triangulating it across the images that saw it ("map features", CC BY-SA
4.0). Where OSM is thin these fill it in: on Dresden's spawn tile OSM maps
339 lamps and 203 bins, Mapillary detects ~1 500 street lights and ~600
bins, most of them standing along streets where OSM has none.

Only what OSM lacks is kept, and only what stands where the viewer could
stand it: a detection seen last before `SEEN_SINCE` is dropped (it may be
gone); the two detectors' copies of one object (Mapillary runs two, each
placing it a little differently) merge within `MERGE_M`, and kept objects
of a kind stand `APART_M` apart; a detection within
`OSM_NEAR_M` of an OSM object of its kind is that object (Mapillary's
positions are 2–6 m off); one inside a LoD2 footprint hangs on the facade or
was placed through it, and is dropped; one in the carriageway moves to the
kerb, one on the railway, water or a bridge deck is dropped, as the OSM
furniture is (furniture.py `Gate`). The tile writes only what it owns.

The fetch caches the tile's map features under `<raw>/mapillary/` (it needs
`MAPILLARY_TOKEN` in the environment). The bake writes `dlm/mly_<tile>.geojson`
— its own file, credited to Mapillary, never merged into the OSM files: the
two licences (ODbL, CC BY-SA) do not mix in one database. Without a cache
the file is empty and the lamps and bins are OSM's alone."""

from __future__ import annotations

import datetime
import json
import os
import time
import urllib.parse
import urllib.request

import numpy as np
import shapely
from pyproj import Transformer

from .common import Tile, feature, write_geojson
from .furniture import Gate
from .net import _request
from .osm_buildings import footprints

ATTRIBUTION = "Mapillary, CC BY-SA 4.0"
API = "https://graph.mapillary.com/map_features"
FIELDS = "id,object_value,geometry,last_seen_at"
# The map features each kind keeps, by Mapillary's object value.
KINDS = {
    "object--street-light": "lamp",
    "object--trash-can": "bin",
}
SEEN_SINCE = "2020-01-01"  # older sightings may be gone
MERGE_M = 4.0  # one object, seen by both detectors
OSM_NEAR_M = 8.0  # an OSM object of the kind this close is the same one
# Two kept objects of a kind stand at least this far apart: closer, they are
# one object Mapillary placed twice from different sequences (street lamps
# stand 15–30 m apart, across a street 10 m and more).
APART_M = 7.0
GRID = 8  # the tile is asked for in GRID² cells (the API caps one answer)
LIMIT = 2000


def cache_path(tile: Tile):
    return tile.raw / "mapillary" / f"{tile.id}.json"


def _cell_bboxes(tile: Tile) -> list[str]:
    to_wgs = Transformer.from_crs(tile.epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = tile.bounds
    sx, sy = (xmax - xmin) / GRID, (ymax - ymin) / GRID
    out = []
    for i in range(GRID):
        for j in range(GRID):
            # a cell's corners, and a metre's margin for the reprojection
            x0, y0 = xmin + i * sx - 1, ymin + j * sy - 1
            lons, lats = to_wgs.transform([x0, x0 + sx + 2], [y0, y0 + sy + 2])
            out.append(f"{min(lons)},{min(lats)},{max(lons)},{max(lats)}")
    return out


def _cell(url: str, tries: int = 4) -> list[dict]:
    """One cell's answer; the API drops a connection now and then."""
    for attempt in range(tries):
        try:
            with _request(url) as r:
                return json.load(r).get("data", [])
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(2**attempt)
    return []


def fetch(tile: Tile) -> None:
    """The tile's map features, unless cached. Needs MAPILLARY_TOKEN; without
    it (or for a site that does not use Mapillary) this is a note."""
    if not tile.mapillary:
        return
    path = cache_path(tile)
    if path.exists():
        return
    token = os.environ.get("MAPILLARY_TOKEN")
    if not token:
        print(f"{tile.id}: no MAPILLARY_TOKEN — Mapillary's lamps and bins not fetched")
        return
    features: dict[str, dict] = {}
    for bbox in _cell_bboxes(tile):
        query = {"access_token": token, "fields": FIELDS, "bbox": bbox, "limit": LIMIT}
        data = _cell(f"{API}?{urllib.parse.urlencode(query)}")
        if len(data) >= LIMIT:
            print(f"{tile.id}: a Mapillary cell hit the {LIMIT} limit — some objects missed")
        for f in data:
            if f.get("object_value") in KINDS:
                features[f["id"]] = f
    path.parent.mkdir(parents=True, exist_ok=True)
    retrieved = datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")
    doc = {"retrieved": retrieved, "licence": ATTRIBUTION, "features": list(features.values())}
    path.write_text(json.dumps(doc))


def merged(points: np.ndarray, radius: float) -> np.ndarray:
    """Points within `radius` of a kept one fold into it (their mean)."""
    if len(points) == 0:
        return points
    tree = shapely.STRtree(shapely.points(points))
    used = np.zeros(len(points), bool)
    out = []
    for i in range(len(points)):
        if used[i]:
            continue
        near = tree.query(shapely.Point(points[i]).buffer(radius))
        near = near[~used[near]]
        used[near] = True
        out.append(points[near].mean(axis=0))
    return np.array(out)


def missing(points: np.ndarray, osm: np.ndarray, radius: float) -> np.ndarray:
    """The points farther than `radius` from every OSM point."""
    if len(points) == 0 or len(osm) == 0:
        return points
    tree = shapely.STRtree(shapely.points(osm))
    _, dist = tree.query_nearest(shapely.points(points), return_distance=True, all_matches=False)
    return points[dist > radius]


def detections(tile: Tile, doc: dict) -> dict[str, np.ndarray]:
    """Each kind's recent detections in the tile's CRS."""
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    by_kind: dict[str, list] = {k: [] for k in KINDS.values()}
    for f in doc["features"]:
        kind = KINDS.get(f.get("object_value", ""))
        if kind is None or str(f.get("last_seen_at", "")) < SEEN_SINCE:
            continue
        by_kind[kind].append(to_tile.transform(*f["geometry"]["coordinates"][:2]))
    return {k: np.array(v, float).reshape(-1, 2) for k, v in by_kind.items()}


def _osm_points(tile: Tile, name: str, kind: str | None) -> np.ndarray:
    path = tile.out("dlm", f"{name}_{tile.id}.geojson")
    if not path.exists():
        return np.zeros((0, 2))
    feats = json.loads(path.read_text())["features"]
    pts = [
        f["geometry"]["coordinates"][:2]
        for f in feats
        if f["geometry"]["type"] == "Point" and (kind is None or f["properties"].get("k") == kind)
    ]
    return np.array(pts, float).reshape(-1, 2)


def placed(p: shapely.Point, gate: Gate, buildings: shapely.STRtree) -> shapely.Point | None:
    """Where a detection stands: at the kerb when it is in the carriageway,
    None inside a building or where nothing is stood."""
    if gate.on_road(p):
        p = gate.nearest_kerb(p)
        if p is None:
            return None
    if len(buildings.query(p, predicate="intersects")) > 0 or not gate.open(p):
        return None
    return p


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"mly_{tile.id}.geojson")
    path = cache_path(tile)
    if not tile.mapillary or not path.exists():
        if tile.mapillary:
            print(f"{tile.id}: no Mapillary cache — lamps and bins are OSM's alone")
        write_geojson(out, [], tile.epsg, ATTRIBUTION)
        return
    gate = Gate(tile)
    _, polys = footprints(json.loads(tile.cityjson.read_text()))
    buildings = shapely.STRtree(polys)
    osm = {"lamp": _osm_points(tile, "lamps", None), "bin": _osm_points(tile, "furniture", "bin")}
    features, counts = [], {}
    for kind, pts in detections(tile, json.loads(path.read_text())).items():
        kept: list[shapely.Point] = []
        for x, y in missing(merged(pts, MERGE_M), osm[kind], OSM_NEAR_M):
            p = placed(shapely.Point(x, y), gate, buildings)
            if p is None or any(p.distance(q) < APART_M for q in kept):
                continue
            kept.append(p)
            point = {"type": "Point", "coordinates": [round(p.x, 2), round(p.y, 2)]}
            features.append(feature(point, {"k": kind}))
        counts[kind] = len(kept)
    write_geojson(out, features, tile.epsg, ATTRIBUTION)
    print(f"{tile.id}: Mapillary objects OSM lacks {counts}")
