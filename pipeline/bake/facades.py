"""What street panoramas say about a facade: three coarse readings per
building, from Mapillary's images (CC BY-SA 4.0).

Per LoD2 outer wall (at least `MIN_WALL_M` long, its eave `MIN_EAVE_M` up,
not facing another footprint) the panoramas within `NEAR_M` that see it
with a free line of sight and at most 60° off its normal are picked — the
closest and most frontal first, at most `PER_SEQ` images of each of
`MAX_SEQ` sequences. Each image is rectified onto the wall and measured
(facade_measure.py): the share of the upper wall that is openings
(`open`), that is clearly darker than the render (`dark`), and the
openings' share of the ground floor (`gf_open`).

A wall's value is the median over its sequences of each sequence's median;
a Building's (the root of its LoD2 tree) is the length-weighted median over
its measured walls, graded (`grade`):

  - busy: 1 below `BUSY_CALM`, 2 below `BUSY_BUSY` or with fewer than two
    sequences on any wall (one sequence's light can make a plain wall look
    busy), else 3;
  - dark: 1 below `DARK_LOW`, 2 below `DARK_HIGH`, else 3;
  - shop: 1 when a Mapillary store sign (a map feature, `object--sign--store`)
    stands within `SIGN_M` of one of its walls, or a measured wall's ground
    floor is more than `SHOP_GF_OPEN` open.

A building no image measured has no entry (the runtime reads 0, "not
seen"). On Dresden's spawn tile a third of the street-front length is
measured, courtyards hardly at all (docs/plans, the facade spike).

The fetch (needs `MAPILLARY_TOKEN`) searches the tile's panoramas, plans
the walls, and for each image asks for its pose and its segmentation,
downloads the 2048 px thumbnail, measures it on every wall it serves and
deletes it: only the measurements are cached, one JSON line an image, under
`<raw>/mapillary/facades/<tile>.v2.jsonl` (a tile's thumbnails are ~1 GB;
none is kept). v2 adds each wall's ground-floor profile (shopfronts.py);
the bake reads the first fetch's `<tile>.jsonl` where a tile has no v2
yet. A rerun skips what is measured. `MAPILLARY_FACADE_SOURCE`
may name a folder holding earlier downloads (`img/<id>.jpg`,
`det/<id>.json`), read instead of the network and never deleted.

The glass reading (ADR 0060) plans differently: every photo of any camera
within `GLASS_NEAR_M` (`<raw>/mapillary/facades/<tile>.photos.json`), the
best of each of `GLASS_SEQ` sequences per wall (`plan_glass`), each read by
facade_glass.py into `<tile>.glass.<key>.jsonl`, ended by a line that says
it was read through (`complete`); windows.py decides from it.

The bake writes `dlm/facades_<tile>.json`:
`{"attribution": …, "buildings": {"<gml:id>": [busy, dark, shop]}}`, read
by lib/city/facade-reading.ts. Its own file, credited to Mapillary: the
licence does not mix with the OSM (ODbL) or LoD2 tables."""

from __future__ import annotations

import collections
import concurrent.futures as cf
import datetime
import json
import math
import os
import time
import urllib.error
import urllib.parse
from pathlib import Path

import numpy as np
import shapely
from pyproj import Proj, Transformer

from .common import Tile
from .net import _request
from .osm_buildings import footprints, root_of, surface_rings

ATTRIBUTION = "Mapillary, CC BY-SA 4.0"
GRAPH = "https://graph.mapillary.com"
IMAGE_FIELDS = "id,computed_geometry,captured_at,sequence,is_pano"
SINCE_YEAR = 2016  # older panoramas are left out (Dresden's are nearly all 2025)
LIMIT = 2000  # the API's cap on one answer: a full cell is split in four
GRID = 8  # the tile's search cells per side

MIN_WALL_M = 6.0
MIN_EAVE_M = 6.0
NEAR_M = 30.0  # a panorama this close may see a wall
MIN_DIST_M = 5.0  # closer, the wall is too oblique at its ends
MIN_COS = 0.5  # at most 60° off the wall's normal
PER_SEQ = 2
MAX_SEQ = 3
# the traits' fetch: the window axes' place is the mean of the drives that
# saw the wall (window_axes.py), so as many as there are, up to this
MAX_SEQ_TRAITS = 6

# the glass reading (facade_glass.py): any camera, a little further out
PHOTO_FIELDS = (
    "id,computed_geometry,computed_rotation,captured_at,sequence,is_pano,"
    "camera_type,camera_parameters,width,height"
)
FRAMED = ("perspective", "brown", "fisheye")  # the framed cameras read
GLASS_NEAR_M = 60.0
GLASS_IN_FRAME = 0.3
GLASS_SEQ = 4
THUMB_PX = 2048  # the thumbnail's long side (thumb_2048_url)

BUSY_CALM, BUSY_BUSY = 0.35, 0.7
DARK_LOW, DARK_HIGH = 0.15, 0.25
SHOP_GF_OPEN = 0.8
SIGN_M = 4.0  # a store sign this close to a wall is on it
SIGN_WALL_M = 2.0  # the walls signs are matched to (any eave)

WORKERS = max(2, (os.cpu_count() or 2) + 2)  # downloads overlap the measuring
WORKERS_ENV = "MAPILLARY_WORKERS"  # fewer, where another fetch shares the line
# each worker of the glass reading holds its own vision model (~0.4 GB with
# its runtime and a 2048 px image): no more than this many
GLASS_WORKERS = min(WORKERS, 4)
SOURCE_ENV = "MAPILLARY_FACADE_SOURCE"


def cache_dir(tile: Tile) -> Path:
    return tile.raw / "mapillary" / "facades"


def cache_path(tile: Tile) -> Path:
    """The measurements with the ground floor's profile (facade_measure.profile)."""
    return cache_dir(tile) / f"{tile.id}.v2.jsonl"


def legacy_cache_path(tile: Tile) -> Path:
    """The first fetch's measurements, without the profile: read while a
    tile has no v2 cache yet."""
    return cache_dir(tile) / f"{tile.id}.jsonl"


def traits_path(tile: Tile) -> Path:
    """The trait profiles (facade_traits.py), measured on the same
    panoramas in a fetch of their own: the v1/v2 caches stay as they are.
    v4 turns each pose onto the grid (`grid_convergence`) and adds the
    jamb profile the drives are registered by (windows.py)."""
    return cache_dir(tile) / f"{tile.id}.v4.jsonl"


def grid_convergence(epsg: int, x: float, y: float) -> float:
    """pyproj's meridian convergence γ (rad) at (x, y): the angle from
    true north to grid north, clockwise positive (Dresden −0.98°: grid
    north lies west of true north; München +1.9°). Mapillary's rotations
    are in a local east-north-up frame, the walls in UTM: 0.25 m along a
    wall 15 m away."""
    lon, lat = Transformer.from_crs(epsg, 4326, always_xy=True).transform(x, y)
    return math.radians(Proj(f"EPSG:{epsg}").get_factors(lon, lat).meridian_convergence)


def onto_grid(rot: np.ndarray, gamma: float) -> np.ndarray:
    """A world → camera rotation in east-north-up as one from the grid:
    a grid vector is first turned clockwise by γ (`grid_convergence`) into
    east-north-up — grid north becomes (sin γ, cos γ)."""
    c, s = math.cos(gamma), math.sin(gamma)
    return rot @ np.array([[c, s, 0.0], [-s, c, 0.0], [0.0, 0.0, 1.0]])


def measured_path(tile: Tile) -> Path:
    v2 = cache_path(tile)
    return v2 if v2.exists() else legacy_cache_path(tile)


def _images_path(tile: Tile) -> Path:
    return cache_dir(tile) / f"{tile.id}.images.json"


def _photos_path(tile: Tile) -> Path:
    """Every photo near the tile, panorama or not, with its camera."""
    return cache_dir(tile) / f"{tile.id}.photos.json"


def glass_path(tile: Tile) -> Path:
    """The glass readings, one JSON line a photo (facade_glass.py), named by
    what they depend on (`facade_glass.reading_key`)."""
    from .facade_glass import reading_key

    return cache_dir(tile) / f"{tile.id}.glass.{reading_key()}.jsonl"


def _signs_path(tile: Tile) -> Path:
    return cache_dir(tile) / f"{tile.id}.signs.json"


# --- walls and the panoramas that see them (pure) ---------------------------


def _heights(city: dict) -> np.ndarray:
    scale = city.get("transform", {}).get("scale", [1, 1, 1])[2]
    shift = city.get("transform", {}).get("translate", [0, 0, 0])[2]
    return np.asarray(city["vertices"], float)[:, 2] * scale + shift


def eave_of(city: dict, oid: str, z: np.ndarray) -> float | None:
    """The object's lowest roof vertex above its lowest wall vertex."""
    geoms = city["CityObjects"][oid].get("geometry", [])
    roof = [i for g in geoms for r in surface_rings(g, "RoofSurface") for i in r]
    wall = [i for g in geoms for r in surface_rings(g, "WallSurface") for i in r]
    if not roof or not wall:
        return None
    return float(z[roof].min() - z[wall].min())


def walls(city: dict, min_len: float = MIN_WALL_M, min_eave: float = MIN_EAVE_M) -> list[dict]:
    """The outer walls of the city's footprints: each edge at least
    `min_len` long, of an object whose eave is `min_eave` up, that does not
    face another footprint (a party wall). `wi` numbers an object's walls;
    `n` is the outward normal."""
    ids, polys = footprints(city)
    tree = shapely.STRtree(polys)
    z = _heights(city)
    out = []
    for k, (oid, poly) in enumerate(zip(ids, polys, strict=True)):
        eave = eave_of(city, oid, z)
        if eave is None or eave < min_eave:
            continue
        wi = 0
        for part in [poly] if poly.geom_type == "Polygon" else poly.geoms:
            if part.geom_type != "Polygon":
                continue
            xy = list(part.exterior.coords)
            for (ax, ay), (bx, by) in zip(xy[:-1], xy[1:], strict=True):
                length = math.hypot(bx - ax, by - ay)
                if length < min_len:
                    continue
                nx, ny = (by - ay) / length, -(bx - ax) / length
                mx, my = (ax + bx) / 2, (ay + by) / 2
                if part.contains(shapely.Point(mx + nx * 0.3, my + ny * 0.3)):
                    nx, ny = -nx, -ny
                front = shapely.Point(mx + nx * 0.6, my + ny * 0.6)
                if len(tree.query(front, predicate="within")):
                    continue
                out.append(
                    {"oid": oid, "k": k, "wi": wi, "a": (ax, ay), "b": (bx, by)}
                    | {"L": length, "n": (nx, ny), "eave": eave}
                )
                wi += 1
    return out


def candidates(
    wall: dict, images: list[dict], pos: np.ndarray, ptree, ftree, max_seq: int = MAX_SEQ
) -> dict:
    """The images that see `wall` well, by sequence: within NEAR_M, at least
    MIN_DIST_M away, at most 60° off its normal, no other footprint in the
    line of sight; the most frontal and closest first, PER_SEQ of each of
    the MAX_SEQ sequences with the most."""
    (ax, ay), (bx, by) = wall["a"], wall["b"]
    mx, my = (ax + bx) / 2, (ay + by) / 2
    nx, ny = wall["n"]
    scored = []
    for i in ptree.query(shapely.Point(mx, my).buffer(NEAR_M)):
        x, y = pos[i]
        d = math.hypot(mx - x, my - y)
        if d < MIN_DIST_M:
            continue
        cos = (nx * (x - mx) + ny * (y - my)) / d
        if cos < MIN_COS:
            continue
        sight = shapely.LineString([(x, y), (mx + nx * 0.5, my + ny * 0.5)])
        if any(j != wall["k"] for j in ftree.query(sight, predicate="intersects")):
            continue
        scored.append((cos / d, int(i)))
    scored.sort(reverse=True)
    by_seq: dict[str, list[int]] = collections.defaultdict(list)
    for _, i in scored:
        seq = images[i]["sequence"]
        if len(by_seq[seq]) < PER_SEQ:
            by_seq[seq].append(i)
    seqs = sorted(by_seq, key=lambda q: -len(by_seq[q]))[:max_seq]
    return {q: by_seq[q] for q in seqs}


def _posed(images: list[dict], epsg: int, usable) -> tuple[list[dict], np.ndarray]:
    """The images placed (since SINCE_YEAR) that `usable` keeps, and their
    positions in the tile's CRS."""
    since = datetime.datetime(SINCE_YEAR, 1, 1, tzinfo=datetime.UTC).timestamp() * 1000
    keep = [
        o
        for o in images
        if o.get("computed_geometry") and o.get("captured_at", 0) >= since and usable(o)
    ]
    to_tile = Transformer.from_crs(4326, epsg, always_xy=True)
    pos = np.array(
        [to_tile.transform(*o["computed_geometry"]["coordinates"][:2]) for o in keep], float
    ).reshape(-1, 2)
    return keep, pos


def panoramas(images: list[dict], epsg: int) -> tuple[list[dict], np.ndarray]:
    """The usable panoramas (placed, since SINCE_YEAR) and their positions
    in the tile's CRS."""
    return _posed(images, epsg, lambda o: bool(o.get("is_pano")))


def plan(city: dict, images: list[dict], epsg: int, max_seq: int = MAX_SEQ) -> dict[str, dict]:
    """Per image id: its sequence, position and the walls it is to be
    measured on."""
    ws = walls(city)
    _, polys = footprints(city)
    ftree = shapely.STRtree(polys)
    keep, pos = panoramas(images, epsg)
    ptree = shapely.STRtree(shapely.points(pos))
    jobs: dict[str, dict] = {}
    for w in ws:
        for seq, idx in candidates(w, keep, pos, ptree, ftree, max_seq).items():
            for i in idx:
                o = keep[i]
                job = jobs.setdefault(
                    o["id"], {"seq": seq, "xy": [float(pos[i][0]), float(pos[i][1])], "walls": []}
                )
                job["walls"].append({k: w[k] for k in ("oid", "wi", "a", "b", "L", "n", "eave")})
    return jobs


def camera_of(photo: dict) -> dict:
    """A photo's camera model (facade_measure.project)."""
    if photo.get("is_pano"):
        return {"type": "spherical"}
    return {
        "type": photo.get("camera_type") or "perspective",
        "params": photo.get("camera_parameters"),
    }


def photos(images: list[dict], epsg: int) -> tuple[list[dict], np.ndarray]:
    """The usable photos of any camera (posed, since SINCE_YEAR) and their
    positions in the tile's CRS."""
    return _posed(
        images,
        epsg,
        lambda o: (
            bool(o.get("computed_rotation"))
            and (bool(o.get("is_pano")) or o.get("camera_type") in FRAMED)
        ),
    )


def in_frame(wall: dict, photo: dict, xy, rot: np.ndarray) -> float:
    """The share of a coarse grid over the wall's upper part (GROUND_M to the
    eave, the ground taken level) that falls inside the photo's frame —
    1 for a panorama, which sees all round. `rot` is the pose on the grid,
    as the reading turns it (`onto_grid`); the frame is the photo's own
    shape where Mapillary gives it, else 4:3."""
    from .facade_measure import EYE_M, GROUND_M, project

    camera = camera_of(photo)
    if camera["type"] == "spherical":
        return 1.0
    (ax, ay), (bx, by) = wall["a"], wall["b"]
    s = np.linspace(0.05, 0.95, 7)
    z = np.linspace(GROUND_M, max(wall["eave"] - 0.3, GROUND_M + 0.1), 5)
    S, Z = np.meshgrid(s, z)
    P = np.stack([ax + (bx - ax) * S - xy[0], ay + (by - ay) * S - xy[1], Z - EYE_M], -1).reshape(
        -1, 3
    )
    C = P @ rot.T
    _, _, seen, _ = project(C, photo.get("width") or 4, photo.get("height") or 3, camera)
    return float(seen.mean())


def pixel_angle(photo: dict) -> float:
    """The radians a pixel of the photo's thumbnail spans ahead (its long
    side THUMB_PX)."""
    from .facade_measure import project

    return float(project(np.array([[0.0, 0.0, 1.0]]), THUMB_PX, THUMB_PX, camera_of(photo))[3])


def _to_segment(x: float, y: float, a, b) -> float:
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    t = min(1.0, max(0.0, ((x - ax) * dx + (y - ay) * dy) / max(dx * dx + dy * dy, 1e-9)))
    return math.hypot(ax + t * dx - x, ay + t * dy - y)


def glass_candidates(
    wall: dict, images: list[dict], pos: np.ndarray, rots: list, angles: list, ptree, ftree
) -> dict:
    """The photos that see `wall` for its glass reading, by sequence: within
    GLASS_NEAR_M (a glass front stands back from the street, behind a
    forecourt or a plaza), at least MIN_DIST_M away, at most 60° off its
    normal, near enough that its nearest part is resolved finer than
    MAX_RES_M (a panorama's pixel spans 9 cm at 30 m: the reading masks
    what is coarser), no other footprint in the line of sight, and — a
    framed photo — at least GLASS_IN_FRAME of the wall in its frame; the
    best seen first, one of each of the GLASS_SEQ sequences that see it
    best. `rots` the photos' poses on the grid, `angles` their
    `pixel_angle`s."""
    from .facade_measure import MAX_RES_M

    (ax, ay), (bx, by) = wall["a"], wall["b"]
    mx, my = (ax + bx) / 2, (ay + by) / 2
    nx, ny = wall["n"]
    best: dict[str, tuple[float, int]] = {}
    for i in ptree.query(shapely.Point(mx, my).buffer(GLASS_NEAR_M)):
        x, y = pos[i]
        d = math.hypot(mx - x, my - y)
        if d < MIN_DIST_M or d > GLASS_NEAR_M:
            continue
        cos = (nx * (x - mx) + ny * (y - my)) / d
        if cos < MIN_COS:
            continue
        if _to_segment(x, y, wall["a"], wall["b"]) * angles[i] > MAX_RES_M:
            continue
        sight = shapely.LineString([(x, y), (mx + nx * 0.5, my + ny * 0.5)])
        if any(j != wall["k"] for j in ftree.query(sight, predicate="intersects")):
            continue
        frame = in_frame(wall, images[i], (x, y), rots[i])
        if frame < GLASS_IN_FRAME:
            continue
        score = frame * cos / max(d, MIN_DIST_M)
        seq = images[i]["sequence"]
        if seq not in best or score > best[seq][0]:
            best[seq] = (score, int(i))
    ranked = sorted(best.items(), key=lambda kv: -kv[1][0])[:GLASS_SEQ]
    return {seq: [i] for seq, (_, i) in ranked}


def plan_glass(city: dict, images: list[dict], epsg: int, gamma: float = 0.0) -> dict[str, dict]:
    """Per photo id: its sequence, position, camera and the walls it is to
    read for glass (`glass_candidates`); `gamma` the grid convergence the
    reading turns each pose by."""
    from .facade_measure import rotation_matrix

    ws = walls(city)
    _, polys = footprints(city)
    ftree = shapely.STRtree(polys)
    keep, pos = photos(images, epsg)
    rots = [onto_grid(rotation_matrix(o["computed_rotation"]), gamma) for o in keep]
    angles = [pixel_angle(o) for o in keep]
    ptree = shapely.STRtree(shapely.points(pos))
    jobs: dict[str, dict] = {}
    for w in ws:
        for seq, idx in glass_candidates(w, keep, pos, rots, angles, ptree, ftree).items():
            for i in idx:
                o = keep[i]
                job = jobs.setdefault(
                    o["id"],
                    {
                        "seq": seq,
                        "xy": [float(pos[i][0]), float(pos[i][1])],
                        "camera": camera_of(o),
                        "walls": [],
                    },
                )
                job["walls"].append({k: w[k] for k in ("oid", "wi", "a", "b", "L", "n", "eave")})
    return jobs


# --- grading (pure) ---------------------------------------------------------


def wmedian(pairs: list[tuple[float, float]]) -> float:
    """The weighted median of (value, weight) pairs: the first value whose
    cumulative weight reaches half the total."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= total / 2:
            return v
    return pairs[-1][0]


def _median(values: list[float]) -> float | None:
    return float(np.median(values)) if values else None


def wall_values(records: list[dict]) -> dict[tuple[str, int], dict]:
    """Per wall (oid, wi): length, the number of sequences that measured it,
    and open, dark and gf_open as the median of its sequences' medians.
    Records are per image and wall; only those that measured `open` count."""
    by: dict[tuple[str, int], dict[str, list[dict]]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    length: dict[tuple[str, int], float] = {}
    for r in records:
        if r.get("open") is None:
            continue
        key = (r["oid"], r["wi"])
        by[key][r["seq"]].append(r)
        length[key] = r["L"]
    out = {}
    for key, seqs in by.items():
        d = {"L": length[key], "seqs": len(seqs)}
        for name in ("open", "dark", "gf_open"):
            meds = [
                m
                for rs in seqs.values()
                if (m := _median([r[name] for r in rs if r.get(name) is not None])) is not None
            ]
            d[name] = _median(meds)
        out[key] = d
    return out


def grade(ws: list[dict], signed: bool) -> list[int]:
    """[busy, dark, shop] of a building from its measured walls (wall_values)."""
    busy = wmedian([(w["open"], w["L"]) for w in ws])
    dark = wmedian([(w["dark"], w["L"]) for w in ws])
    seqs = max(w["seqs"] for w in ws)
    b = 1 if busy < BUSY_CALM else 2 if busy < BUSY_BUSY or seqs < 2 else 3
    d = 1 if dark < DARK_LOW else 2 if dark < DARK_HIGH else 3
    open_ground = any(w["gf_open"] is not None and w["gf_open"] > SHOP_GF_OPEN for w in ws)
    return [b, d, int(signed or open_ground)]


def signed_roots(city: dict, signs: np.ndarray) -> set[str]:
    """The Buildings with a store sign within SIGN_M of one of their outer
    walls (the nearest wall within 1.5 × SIGN_M takes it)."""
    ws = walls(city, min_len=SIGN_WALL_M, min_eave=0.0)
    if len(signs) == 0 or not ws:
        return set()
    tree = shapely.STRtree(shapely.linestrings([[w["a"], w["b"]] for w in ws]))
    idx, dist = tree.query_nearest(
        shapely.points(signs), return_distance=True, max_distance=1.5 * SIGN_M, all_matches=False
    )
    return {
        root_of(city, ws[int(j)]["oid"]) for j, d in zip(idx[1], dist, strict=True) if d <= SIGN_M
    }


def readings(city: dict, records: list[dict], signs: np.ndarray) -> dict[str, list[int]]:
    """Per Building gml:id: [busy, dark, shop], for those an image measured."""
    by_root: dict[str, list[dict]] = collections.defaultdict(list)
    for (oid, _), w in wall_values(records).items():
        by_root[root_of(city, oid)].append(w)
    signed = signed_roots(city, signs)
    return {root: grade(ws, root in signed) for root, ws in sorted(by_root.items())}


def write_readings(path: Path, buildings: dict[str, list[int]]) -> None:
    doc = {"attribution": ATTRIBUTION, "buildings": dict(sorted(buildings.items()))}
    path.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True))


# --- the network ------------------------------------------------------------


class Transient(OSError):
    """A request that failed after its retries; the next run tries again."""


def _get(url: str, *, auth: bool = True, tries: int = 5) -> bytes:
    """GET with retries and backoff on a dropped connection, a timeout, a
    429 or a 5xx; another HTTP error raises at once. The token goes in a
    header, never in the URL (an error message may print the URL)."""
    headers = {}
    if auth:
        headers["Authorization"] = "OAuth " + os.environ["MAPILLARY_TOKEN"]
    err: Exception | None = None
    for attempt in range(tries):
        try:
            with _request(url, headers) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
            err = e
        except (OSError, TimeoutError) as e:
            err = e
        time.sleep(min(60, 2 ** (attempt + 1)))
    raise Transient(f"{type(err).__name__}: {err}")


def _cells(tile: Tile, margin: float) -> list[tuple[float, float, float, float]]:
    xmin, ymin, xmax, ymax = tile.bounds
    xmin, ymin, xmax, ymax = xmin - margin, ymin - margin, xmax + margin, ymax + margin
    sx, sy = (xmax - xmin) / GRID, (ymax - ymin) / GRID
    return [
        (xmin + i * sx, ymin + j * sy, xmin + (i + 1) * sx, ymin + (j + 1) * sy)
        for i in range(GRID)
        for j in range(GRID)
    ]


def _bbox(cell, to_wgs) -> str:
    x0, y0, x1, y1 = cell
    lons, lats = to_wgs.transform([x0, x1, x0, x1], [y0, y0, y1, y1])
    return f"{min(lons):.7f},{min(lats):.7f},{max(lons):.7f},{max(lats):.7f}"


def _search(path: str, query: dict, cell, to_wgs, depth: int = 0) -> list[dict]:
    """A cell's answer; a full one is split in four (to 1/64 of a cell), and
    so is one the API keeps failing on: a dense cell (Leipzig's centre) can
    answer 500 every time where its quarters answer at once."""
    q = urllib.parse.urlencode(query | {"bbox": _bbox(cell, to_wgs), "limit": LIMIT})
    try:
        data = json.loads(_get(f"{GRAPH}/{path}?{q}", tries=3)).get("data", [])
    except Transient:
        if depth >= 3:
            raise
        data = None
    if data is not None and len(data) >= LIMIT and depth >= 3:
        print(f"WARNING {path}: a cell still holds {LIMIT} or more at 1/64 — some are left out")
    if data is not None and (len(data) < LIMIT or depth >= 3):
        return data
    x0, y0, x1, y1 = cell
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    quads = [(x0, y0, xm, ym), (xm, y0, x1, ym), (x0, ym, xm, y1), (xm, ym, x1, y1)]
    return [d for c in quads for d in _search(path, query, c, to_wgs, depth + 1)]


def _search_tile(tile: Tile, path: str, query: dict, margin: float) -> list[dict]:
    to_wgs = Transformer.from_crs(tile.epsg, 4326, always_xy=True)
    found: dict[str, dict] = {}
    with cf.ThreadPoolExecutor(6) as ex:
        for data in ex.map(lambda c: _search(path, query, c, to_wgs), _cells(tile, margin)):
            for d in data:
                found[d["id"]] = d
    return list(found.values())


def _cached_json(path: Path, make) -> list[dict]:
    if path.exists():
        return json.loads(path.read_text())["data"]
    data = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    retrieved = datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")
    tmp = path.with_suffix(".part")
    tmp.write_text(json.dumps({"retrieved": retrieved, "licence": ATTRIBUTION, "data": data}))
    tmp.replace(path)
    return data


def _poses(ids: list[str]) -> dict[str, dict]:
    """Each image's computed rotation, thumbnail URL (fetched just before
    use: the URLs expire) and EXIF orientation (`raw_frame`)."""
    chunks = [ids[i : i + 50] for i in range(0, len(ids), 50)]

    def one(chunk):
        q = urllib.parse.urlencode(
            {
                "ids": ",".join(chunk),
                "fields": "computed_rotation,thumb_2048_url,exif_orientation",
            }
        )
        return json.loads(_get(f"{GRAPH}/?{q}"))

    out: dict[str, dict] = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for d in ex.map(one, chunks):
            out.update(d)
    return out


# --- one image, in a worker process -----------------------------------------

_dgm = None


def _init_worker(dgm: str) -> None:
    import rasterio

    global _dgm
    _dgm = rasterio.open(dgm)


def _ground(x: float, y: float) -> float | None:
    left, bottom, right, top = _dgm.bounds
    if not (left <= x < right and bottom <= y < top):
        return None
    z = float(next(_dgm.sample([(x, y)]))[0])
    return z if np.isfinite(z) and z > -1000 else None


def _detections(iid: str, source: Path | None) -> list[dict]:
    if source and (source / "det" / f"{iid}.json").exists():
        return json.loads((source / "det" / f"{iid}.json").read_text())
    q = urllib.parse.urlencode({"fields": "value,geometry"})
    return json.loads(_get(f"{GRAPH}/{iid}/detections?{q}")).get("data", [])


def _thumbnail(iid: str, url: str, scratch: Path, source: Path | None) -> tuple[Path, bool]:
    """The image's file and whether it is ours to delete."""
    if source and (source / "img" / f"{iid}.jpg").exists():
        return source / "img" / f"{iid}.jpg", False
    path = scratch / f"{iid}.jpg"
    path.write_bytes(_get(url, auth=False, tries=4))
    return path, True


# Mapillary's pose (OpenSfM's) is in the frame the photo was stored in; its
# thumbnail and its segmentation are upright, the EXIF orientation applied.
# Each orientation's turn back, as np.rot90's k; a mirrored one is not read.
TO_STORED = {1: 0, 3: 2, 6: 1, 8: -1}


def raw_frame(a: np.ndarray, orientation: int | None) -> np.ndarray | None:
    """An upright raster (the thumbnail, the class map) turned back into the
    stored frame the pose is in; None for a mirrored orientation (2, 4, 5,
    7)."""
    k = TO_STORED.get(orientation or 1)
    if k is None:
        return None
    return np.ascontiguousarray(np.rot90(a, k)) if k else a


def measure_image(job: dict) -> dict:
    """One image measured on its walls: {"img", "seq", "walls": [...]}, or
    {"img", "skip"} when it cannot be (no pose), or {"img", "fail"} on a
    network failure (not cached: the next run tries again)."""
    from . import facade_glass, facade_measure, facade_traits
    from .facade_measure import EYE_M, class_map, load_image, rotation_matrix

    kind = job.get("kind")
    measure = facade_traits.measure if kind == "traits" else facade_measure.measure
    iid = job["img"]
    if not job.get("rot") or not job.get("url"):
        return {"img": iid, "skip": "no pose or thumbnail"}
    # only a framed photo is turned back: a panorama's thumbnail is
    # equirectangular in the frame its pose is in
    framed = kind == "glass" and job["camera"]["type"] != "spherical"
    exif = job.get("exif") if framed else None
    if TO_STORED.get(exif or 1) is None:
        return {"img": iid, "skip": f"mirrored (EXIF orientation {exif})"}
    if kind == "glass":
        try:
            facade_glass.model(*job["model"])
        except Exception as err:  # noqa: BLE001 — not this photo's fault: read it again later
            return {"img": iid, "fail": f"model: {type(err).__name__}: {err}"[:200]}
    source = Path(job["source"]) if job.get("source") else None
    try:
        dets = _detections(iid, source)
        path, ours = _thumbnail(iid, job["url"], Path(job["scratch"]), source)
    except (OSError, ValueError) as err:
        return {"img": iid, "fail": f"{type(err).__name__}: {err}"[:200]}
    try:
        img = raw_frame(load_image(path), exif)
        cls = raw_frame(class_map(dets), exif)
    except Exception as err:  # noqa: BLE001 — a broken file is skipped, not fatal
        return {"img": iid, "skip": f"unreadable ({type(err).__name__})"}
    finally:
        if ours:
            path.unlink(missing_ok=True)
    rot = onto_grid(rotation_matrix(job["rot"]), job.get("gamma", 0.0))
    x, y = job["xy"]
    out = []
    for w in job["walls"]:
        (ax, ay), (bx, by) = w["a"], w["b"]
        mx, my = (ax + bx) / 2 + w["n"][0] * 1.5, (ay + by) / 2 + w["n"][1] * 1.5
        dist = math.hypot(x - (ax + bx) / 2, y - (ay + by) / 2)
        head = {"oid": w["oid"], "wi": w["wi"], "L": round(w["L"], 2), "dist": round(dist, 1)}
        zg = _ground(mx, my)
        if zg is None:
            # off the terrain model: tried, so a later plan does not ask again
            out.append(head | {"off": "ground"})
            continue
        zc = _ground(x, y)
        cam = (x, y, (zc if zc is not None else zg) + EYE_M)
        try:
            if kind == "glass":
                m = facade_glass.measure(
                    w | {"zg": zg}, img, cls, rot, cam, job["camera"], tuple(job["model"])
                )
            else:
                m = measure(w | {"zg": zg}, img, cls, rot, cam)
        except facade_glass.ModelError as err:  # not this photo's fault: read it again later
            return {"img": iid, "fail": f"model: {err}"[:200]}
        except Exception as err:  # noqa: BLE001 — record it, measure the rest
            m = {"err": repr(err)[:100]}
        out.append(head | m)
    return {"img": iid, "seq": job["seq"], "walls": out}


# --- fetch and run ----------------------------------------------------------


def _done(path: Path) -> dict[str, set[tuple[str, int, float]] | None]:
    """Per image already in the cache the walls it was read on; None for
    one that could not be read at all (a skip: it is not asked again)."""
    if not path.exists():
        return {}
    done: dict[str, set[tuple[str, int, float]] | None] = {}
    for line in path.read_text().splitlines():
        try:
            r = json.loads(line)
            iid = r["img"]
        except (ValueError, KeyError):
            continue  # a line cut by a killed run
        if "skip" in r:
            done[iid] = None
        elif (have := done.setdefault(iid, set())) is not None:
            have.update(wall_key(w) for w in r.get("walls", []))
    return done


def _todo(jobs: dict[str, dict], done: dict, by_wall: bool) -> list[str]:
    """The images still to read: those not in the cache and — `by_wall`,
    the glass reading, whose plan picks a photo per wall — those a wall was
    since planned on that they were not read on."""

    def read(i: str) -> bool:
        if i not in done:
            return False
        have = done[i]
        return not by_wall or have is None or all(wall_key(w) in have for w in jobs[i]["walls"])

    return sorted(i for i in jobs if not read(i))


def wall_key(w: dict) -> tuple[str, int, float]:
    """A wall as a cached reading names it: its object, its number and its
    length — a new LoD2 edition numbering an object's walls anew does not
    pass one wall's readings to another."""
    return (w["oid"], w["wi"], round(w["L"], 2))


def mark_complete(path: Path) -> None:
    """Ends the glass cache with the line that says every photo its plan
    picked was read (`complete`), unless it already does."""
    if not complete(path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as f:
            f.write('{"complete":true}\n')


def complete(path: Path) -> bool:
    """Whether a glass cache was read through: its last line says so — a
    run killed or with failures since added image lines after it, or none
    (`mark_complete`)."""
    if not path.exists():
        return False
    lines = path.read_text().splitlines()
    try:
        return bool(lines) and json.loads(lines[-1]).get("complete") is True
    except ValueError:
        return False


def _unread(job: dict, have: set[tuple[str, int, float]] | None) -> dict:
    """The job on the walls its image was not yet read on (`_done`)."""
    if not have:
        return job
    return job | {"walls": [w for w in job["walls"] if wall_key(w) not in have]}


def _fetch_signs(tile: Tile) -> None:
    _cached_json(
        _signs_path(tile),
        lambda: [
            f
            for f in _search_tile(
                tile,
                "map_features",
                {
                    "fields": "id,object_value,geometry,last_seen_at",
                    "object_values": "object--sign--store",
                },
                0.0,
            )
            if f.get("object_value") == "object--sign--store"
        ],
    )


def _workers(kind: str) -> int:
    """The fetch's worker processes: MAPILLARY_WORKERS or WORKERS, at most
    GLASS_WORKERS for the glass reading (each holds the CLIP model)."""
    n = int(os.environ.get(WORKERS_ENV) or WORKERS)
    return min(n, GLASS_WORKERS) if kind == "glass" else n


def fetch(tile: Tile, kind: str = "facades") -> None:
    """Measure the tile's facades on its photos, caching per image:
    `kind` "facades" the readings and the ground floor's profile on the
    panoramas (facade_measure.py, the v2 cache), "traits" their trait
    profiles (facade_traits.py, the v4 cache), "glass" the glass readings
    on the photos of every camera (facade_glass.py, `glass_path`)."""
    if not tile.mapillary:
        return
    if not os.environ.get("MAPILLARY_TOKEN"):
        print(f"{tile.id}: no MAPILLARY_TOKEN — the facades not measured")
        return
    city = json.loads(tile.cityjson.read_text())
    model: list[str] = []
    x0, y0, x1, y1 = tile.bounds
    # the poses turned onto the grid in the traits (v4) and glass caches:
    # the facades cache keeps its measurements as they were taken
    gamma = (
        grid_convergence(tile.epsg, (x0 + x1) / 2, (y0 + y1) / 2)
        if kind in ("traits", "glass")
        else 0.0
    )
    if kind == "glass":
        every = _cached_json(
            _photos_path(tile),
            lambda: _search_tile(tile, "images", {"fields": PHOTO_FIELDS}, GLASS_NEAR_M),
        )
        jobs = plan_glass(city, every, tile.epsg, gamma)
        out = glass_path(tile)
    else:
        _fetch_signs(tile)
        images = _cached_json(
            _images_path(tile),
            lambda: _search_tile(
                tile, "images", {"fields": IMAGE_FIELDS, "is_pano": "true"}, NEAR_M
            ),
        )
        jobs = plan(city, images, tile.epsg, MAX_SEQ_TRAITS if kind == "traits" else MAX_SEQ)
        out = traits_path(tile) if kind == "traits" else cache_path(tile)
    done = _done(out)
    todo = _todo(jobs, done, kind == "glass")
    seen_by = "photos" if kind == "glass" else "panoramas"
    print(f"{tile.id}: {len(jobs)} {seen_by} see its walls, {len(todo)} to measure ({kind})")
    if not todo:
        if kind == "glass":
            mark_complete(out)
        return
    if kind == "glass":
        from . import facade_glass

        # the model only where there is something to read
        root = facade_glass.fetch_model(tile.raw)
        model = [str(root), str(facade_glass.write_classes(root))]
    scratch = cache_dir(tile) / ".img"
    scratch.mkdir(parents=True, exist_ok=True)
    source = os.environ.get(SOURCE_ENV)
    counts = collections.Counter()
    t0 = last = time.time()
    with (
        open(out, "a") as f,
        cf.ProcessPoolExecutor(
            _workers(kind),
            initializer=_init_worker,
            initargs=(str(tile.dgm),),
        ) as ex,
    ):
        for start in range(0, len(todo), 400):
            batch = todo[start : start + 400]
            poses = _poses(batch)
            work = [
                _unread(jobs[i], done.get(i))
                | {"img": i, "rot": poses.get(i, {}).get("computed_rotation")}
                | {"exif": poses.get(i, {}).get("exif_orientation")}
                | {
                    "url": poses.get(i, {}).get("thumb_2048_url"),
                    "scratch": str(scratch),
                    "source": source,
                    "kind": kind,
                    "gamma": gamma,
                    "model": model,
                }
                for i in batch
            ]
            for r in ex.map(measure_image, work, chunksize=1):
                outcome = "fail" if "fail" in r else "skip" if "skip" in r else "measured"
                counts[outcome] += 1
                if outcome != "fail":
                    f.write(json.dumps(r, separators=(",", ":")) + "\n")
                    f.flush()
            if time.time() - last > 60 or start + 400 >= len(todo):
                last = time.time()
                n = sum(counts.values())
                print(
                    f"{tile.id}: {n}/{len(todo)} images {dict(counts)} ({last - t0:.0f} s)",
                    flush=True,
                )
    for leftover in scratch.glob("*.jpg"):
        leftover.unlink()
    if counts["fail"]:
        print(f"{tile.id}: {counts['fail']} images failed on the network — rerun the fetch")
    elif kind == "glass":
        mark_complete(out)


def _records(path: Path) -> list[dict]:
    out = []
    for line in path.read_text().splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        out.extend(w | {"seq": r["seq"]} for w in r.get("walls", []))
    return out


def _signs(tile: Tile) -> np.ndarray:
    path = _signs_path(tile)
    if not path.exists():
        print(f"{tile.id}: no store-sign cache — the shop reading from the ground floor alone")
        return np.zeros((0, 2))
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    pts = [
        to_tile.transform(*f["geometry"]["coordinates"][:2])
        for f in json.loads(path.read_text())["data"]
    ]
    return np.array(pts, float).reshape(-1, 2)


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"facades_{tile.id}.json")
    path = measured_path(tile)
    if not tile.mapillary or not path.exists():
        if tile.mapillary:
            print(f"{tile.id}: no facade measurements — no building has a facade reading")
        write_readings(out, {})
        return
    city = json.loads(tile.cityjson.read_text())
    buildings = readings(city, _records(path), _signs(tile))
    write_readings(out, buildings)
    grades = [collections.Counter(v[k] for v in buildings.values()) for k in range(3)]
    print(
        f"{tile.id}: {len(buildings)} buildings with a facade reading"
        f" (busy {dict(sorted(grades[0].items()))}, dark {dict(sorted(grades[1].items()))},"
        f" shop {grades[2][1]})"
    )
