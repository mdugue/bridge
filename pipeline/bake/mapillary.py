"""Street lamps OSM lacks, from Mapillary's detected objects.

Mapillary finds objects in its street photos and places each one by
triangulating it across the images that saw it ("map features", CC BY-SA
4.0). Where OSM is thin these fill it in: on Dresden's spawn tile OSM maps
339 lamps, Mapillary detects ~1 500 street lights, most of them standing
along streets where OSM has none; in Grimma OSM maps 74, Mapillary ~1 400.

Its litter bins are not taken: `object--trash-can` is any trash can, and in
street photos that is mostly the household wheelie bins and containers put
out on collection day, which would stand as public litter bins all year
(QA 2026-10-21: of the bins the bake kept, 7 of 10 sampled on Dresden's
spawn tile and 13 of 15 in Grimma, Meißen and Unna were household bins,
none of them clearly public; of those seen on two days or more, still half).
Nothing in a detection tells the two apart.

A detection is taken only when it was seen well (`seen_well`): by an image
within `NEAR_IMAGE_M` of where it was placed — seen only from farther, it
was placed along a long ray (a bridge's lamps came down on the meadow beside
it) or is something far and small taken for a lamp — and by one taken in
the light, the sun above `DARK_SUN_DEG`: at night the detector takes
headlights and lit signs for street lights (Unna's motorway). In the QA
sample (45 kept lamps in Grimma, Meißen and Unna) this kept all 31 real ones
and dropped 5 of the 7 wrong or misplaced ones; that each detection has two
images or more says nothing — 98–100 % have, Mapillary places none from
fewer.

Only what OSM lacks is kept, and only what stands where the viewer could
stand it: a detection seen last before `SEEN_SINCE` is dropped (it may be
gone); the two detectors' copies of one object (Mapillary runs two, each
placing it a little differently) merge within `MERGE_M`, and kept objects
of a kind stand `APART_M` apart; a detection within
`OSM_NEAR_M` of an OSM object of its kind is that object (Mapillary's
positions are 2–6 m off); one inside a LoD2 footprint hangs on the facade or
was placed through it, and is dropped; one in the carriageway moves to the
kerb, one on the railway, water or a bridge deck is dropped, as the OSM
furniture is (furniture.py `Gate`); one nearer a road in a tunnel than any
way on the ground (within `TUNNEL_M`) is the tunnel's lighting, placed on the
ground above it, and is dropped (`Tunnels`). A lamp in the carriageway that hangs by the
untagged rule of the OSM lamps (within `lamps.AXIS_M` of a street's centre
line, facades closing both sides) hangs across the street as they do
(`wire`, `masts`, `h`). The tile writes only what it owns.

The fetch caches the tile's street lights under `<raw>/mapillary/<tile>.v2.json`
(it needs `MAPILLARY_TOKEN` in the environment), each with the images that
saw it as `[lon, lat, captured_at ms]` (v2: the first fetch's `<tile>.json`
had no images and is not read). The bake writes `dlm/mly_<tile>.geojson`
— its own file, credited to Mapillary, never merged into the OSM files: the
two licences (ODbL, CC BY-SA) do not mix in one database. Without a cache
the file is empty and the lamps are OSM's alone."""

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

from . import lamps
from .common import Tile, column, feature, write_geojson
from .dop_light import solar_position
from .furniture import Gate
from .net import _request
from .osm import in_tunnel, read_osm
from .osm_buildings import footprints

ATTRIBUTION = "Mapillary, CC BY-SA 4.0"
API = "https://graph.mapillary.com/map_features"
# Each detection with the images that saw it: where and when each was taken.
FIELDS = "id,object_value,geometry,first_seen_at,last_seen_at,images{geometry,captured_at}"
# The map features each kind keeps, by Mapillary's object value (no
# `object--trash-can`: mostly household bins, see above).
KINDS = {
    "object--street-light": "lamp",
}
SEEN_SINCE = "2020-01-01"  # older sightings may be gone
# Some image that saw a detection stood this close to where it was placed.
# Passing a lamp, the camera comes within 5–15 m of it; the real lamps the QA
# sample saw only from farther were 20–25 m off at most, the misplaced ones
# 25–60 m (Grimma's and Meißen's bridge lamps on the meadow below).
NEAR_IMAGE_M = 25.0
# An image taken with the sun lower than this is a night shot. Nautical dusk,
# not sunset: some cameras keep local time as UTC, and a lamp photographed in
# the last light an hour "later" is still taken.
DARK_SUN_DEG = -12.0
# A lamp this close to a road in a tunnel, and nearer it than any way on the
# ground, was seen in the tunnel: its lights, which the triangulation lays on
# the hill or square above (Meißen: ten lamps in the wood over the B 101's
# Schottenbergtunnel).
TUNNEL_M = 20.0
MERGE_M = 4.0  # one object, seen by both detectors
OSM_NEAR_M = 8.0  # an OSM object of the kind this close is the same one
# Two kept objects of a kind stand at least this far apart: closer, they are
# one object Mapillary placed twice from different sequences (street lamps
# stand 15–30 m apart, across a street 10 m and more).
APART_M = 7.0
GRID = 8  # the tile is asked for in GRID² cells (the API caps one answer)
LIMIT = 2000


def cache_path(tile: Tile):
    """The street lights with their images (v2; the first fetch's
    `<tile>.json` had none, and the gate cannot read it)."""
    return tile.raw / "mapillary" / f"{tile.id}.v2.json"


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


def _cell(url: str, token: str, tries: int = 4) -> list[dict]:
    """One cell's answer; the API drops a connection now and then. The token
    goes in a header, never in the URL (an error message may print it)."""
    for attempt in range(tries):
        try:
            with _request(url, {"Authorization": f"OAuth {token}"}) as r:
                return json.load(r).get("data", [])
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(2**attempt)
    return []


def compact(f: dict) -> dict:
    """A map feature as the cache keeps it: its images as [lon, lat,
    captured_at ms] (about a third of the API's nested answer)."""
    images = (f.get("images") or {}).get("data", [])
    rows = [
        [*(round(c, 7) for c in im["geometry"]["coordinates"][:2]), im.get("captured_at")]
        for im in images
        if im.get("geometry")
    ]
    return {k: v for k, v in f.items() if k != "images"} | {"images": rows}


def fetch(tile: Tile) -> None:
    """The tile's street lights, unless cached. Needs MAPILLARY_TOKEN; without
    it (or for a site that does not use Mapillary) this is a note."""
    if not tile.mapillary_objects:
        return
    path = cache_path(tile)
    if path.exists():
        return
    token = os.environ.get("MAPILLARY_TOKEN")
    if not token:
        print(f"{tile.id}: no MAPILLARY_TOKEN — Mapillary's lamps not fetched")
        return
    features: dict[str, dict] = {}
    for bbox in _cell_bboxes(tile):
        query = {
            "fields": FIELDS,
            "bbox": bbox,
            "limit": LIMIT,
            "object_values": ",".join(KINDS),
        }
        data = _cell(f"{API}?{urllib.parse.urlencode(query)}", token)
        if len(data) >= LIMIT:
            print(f"{tile.id}: a Mapillary cell hit the {LIMIT} limit — some objects missed")
        for f in data:
            if f.get("object_value") in KINDS:
                features[f["id"]] = compact(f)
    path.parent.mkdir(parents=True, exist_ok=True)
    retrieved = datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")
    doc = {"retrieved": retrieved, "licence": ATTRIBUTION, "features": list(features.values())}
    part = path.with_suffix(".part")
    part.write_text(json.dumps(doc))
    part.replace(path)


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


def in_light(lon: float, lat: float, times_ms: list) -> bool:
    """Whether one of the images was taken with the sun above DARK_SUN_DEG;
    an image without a time is not known to be dark."""
    for t in times_ms:
        if t is None:
            return True
        when = datetime.datetime.fromtimestamp(t / 1000, datetime.UTC)
        if solar_position(when, lon, lat)[1] > DARK_SUN_DEG:
            return True
    return False


def seen_well(f: dict, to_tile: Transformer) -> bool:
    """Whether a cached detection was seen from near (an image within
    NEAR_IMAGE_M of where it was placed) and in the light (`in_light`)."""
    images = np.asarray(f.get("images") or [], dtype=object).reshape(-1, 3)
    if len(images) == 0:
        return False
    lon, lat = f["geometry"]["coordinates"][:2]
    x, y = to_tile.transform(lon, lat)
    ix, iy = to_tile.transform(images[:, 0].astype(float), images[:, 1].astype(float))
    if np.hypot(np.asarray(ix) - x, np.asarray(iy) - y).min() > NEAR_IMAGE_M:
        return False
    return in_light(lon, lat, list(images[:, 2]))


def detections(tile: Tile, doc: dict) -> dict[str, np.ndarray]:
    """Each kind's recent, well-seen detections in the tile's CRS."""
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    by_kind: dict[str, list] = {k: [] for k in KINDS.values()}
    for f in doc["features"]:
        kind = KINDS.get(f.get("object_value", ""))
        if kind is None or str(f.get("last_seen_at", "")) < SEEN_SINCE:
            continue
        if not seen_well(f, to_tile):
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


class Tunnels:
    """The tile's OSM highways in tunnels and on the ground, read once."""

    def __init__(self, tile: Tile) -> None:
        geoms, fields = read_osm(tile, "lines", "highway IS NOT NULL", ["other_tags"], 0.001)
        under = np.array([in_tunnel(t) for t in column(fields, "other_tags", geoms)], dtype=bool)
        self.under = shapely.STRtree(geoms[under]) if under.any() else None
        self.ground = shapely.STRtree(geoms[~under]) if (~under).any() else None

    def lit(self, p: shapely.Point) -> bool:
        """Whether a detection at p is a tunnel's lighting: within TUNNEL_M of
        a way in a tunnel and nearer it than to any way on the ground."""
        if self.under is None:
            return False
        _, d = self.under.query_nearest(p, max_distance=TUNNEL_M, return_distance=True)
        if len(d) == 0:
            return False
        if self.ground is None:
            return True
        _, g = self.ground.query_nearest(p, return_distance=True)
        return float(d.min()) < float(g.min())


class Hangers:
    """The streets and facades a detected lamp may hang across, read once
    the first lamp in the carriageway needs them."""

    def __init__(self, tile: Tile, gate: Gate) -> None:
        self.tile, self.gate, self.read = tile, gate, None

    def hang(self, p: shapely.Point) -> dict | None:
        if self.read is None:
            ways, lines = lamps.streets(self.tile)
            self.read = (ways, lines, lamps.Facades(self.tile))
        ways, lines, facades = self.read
        return lamps.hang(p, False, ways, lines, facades, self.gate)


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"mly_{tile.id}.geojson")
    path = cache_path(tile)
    if not tile.mapillary_objects or not path.exists():
        if tile.mapillary_objects:
            print(f"{tile.id}: no Mapillary cache (v2) — the lamps are OSM's alone")
        write_geojson(out, [], tile.epsg, ATTRIBUTION)
        return
    gate = Gate(tile)
    _, polys = footprints(json.loads(tile.cityjson.read_text()))
    buildings = shapely.STRtree(polys)
    osm = {"lamp": _osm_points(tile, "lamps", None)}
    hangers, tunnels = Hangers(tile, gate), Tunnels(tile)
    features, counts = [], {}
    for kind, pts in detections(tile, json.loads(path.read_text())).items():
        kept: list[shapely.Point] = []
        for x, y in missing(merged(pts, MERGE_M), osm[kind], OSM_NEAR_M):
            p, props = shapely.Point(x, y), {"k": kind}
            if tunnels.lit(p):
                continue
            hung = hangers.hang(p) if kind == "lamp" and gate.on_road(p) else None
            if hung is not None and gate.open(p):
                props.update(hung)
            else:
                p = placed(p, gate, buildings)
            if p is None or any(p.distance(q) < APART_M for q in kept):
                continue
            kept.append(p)
            point = {"type": "Point", "coordinates": [round(p.x, 2), round(p.y, 2)]}
            features.append(feature(point, props))
        counts[kind] = len(kept)
    write_geojson(out, features, tile.epsg, ATTRIBUTION)
    print(f"{tile.id}: Mapillary objects OSM lacks {counts}")
