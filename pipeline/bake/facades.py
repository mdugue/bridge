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
from pyproj import Transformer

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

BUSY_CALM, BUSY_BUSY = 0.35, 0.7
DARK_LOW, DARK_HIGH = 0.15, 0.25
SHOP_GF_OPEN = 0.8
SIGN_M = 4.0  # a store sign this close to a wall is on it
SIGN_WALL_M = 2.0  # the walls signs are matched to (any eave)

WORKERS = max(2, (os.cpu_count() or 2) + 2)  # downloads overlap the measuring
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


def measured_path(tile: Tile) -> Path:
    v2 = cache_path(tile)
    return v2 if v2.exists() else legacy_cache_path(tile)


def _images_path(tile: Tile) -> Path:
    return cache_dir(tile) / f"{tile.id}.images.json"


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


def candidates(wall: dict, images: list[dict], pos: np.ndarray, ptree, ftree) -> dict:
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
    seqs = sorted(by_seq, key=lambda q: -len(by_seq[q]))[:MAX_SEQ]
    return {q: by_seq[q] for q in seqs}


def panoramas(images: list[dict], epsg: int) -> tuple[list[dict], np.ndarray]:
    """The usable panoramas (posed, since SINCE_YEAR) and their positions in
    the tile's CRS."""
    since = datetime.datetime(SINCE_YEAR, 1, 1, tzinfo=datetime.UTC).timestamp() * 1000
    keep = [
        o
        for o in images
        if o.get("is_pano") and o.get("computed_geometry") and o.get("captured_at", 0) >= since
    ]
    to_tile = Transformer.from_crs(4326, epsg, always_xy=True)
    pos = np.array(
        [to_tile.transform(*o["computed_geometry"]["coordinates"][:2]) for o in keep], float
    ).reshape(-1, 2)
    return keep, pos


def plan(city: dict, images: list[dict], epsg: int) -> dict[str, dict]:
    """Per image id: its sequence, position and the walls it is to be
    measured on."""
    ws = walls(city)
    _, polys = footprints(city)
    ftree = shapely.STRtree(polys)
    keep, pos = panoramas(images, epsg)
    ptree = shapely.STRtree(shapely.points(pos))
    jobs: dict[str, dict] = {}
    for w in ws:
        for seq, idx in candidates(w, keep, pos, ptree, ftree).items():
            for i in idx:
                o = keep[i]
                job = jobs.setdefault(
                    o["id"], {"seq": seq, "xy": [float(pos[i][0]), float(pos[i][1])], "walls": []}
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
    """A cell's answer; a full one is split in four (to 1/64 of a cell)."""
    q = urllib.parse.urlencode(query | {"bbox": _bbox(cell, to_wgs), "limit": LIMIT})
    data = json.loads(_get(f"{GRAPH}/{path}?{q}")).get("data", [])
    if len(data) < LIMIT or depth >= 3:
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
    """Each image's computed rotation and thumbnail URL (fetched just before
    use: the URLs expire)."""
    chunks = [ids[i : i + 50] for i in range(0, len(ids), 50)]

    def one(chunk):
        q = urllib.parse.urlencode(
            {"ids": ",".join(chunk), "fields": "computed_rotation,thumb_2048_url"}
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


def measure_image(job: dict) -> dict:
    """One image measured on its walls: {"img", "seq", "walls": [...]}, or
    {"img", "skip"} when it cannot be (no pose), or {"img", "fail"} on a
    network failure (not cached: the next run tries again)."""
    from .facade_measure import EYE_M, class_map, load_image, measure, rotation_matrix

    iid = job["img"]
    if not job.get("rot") or not job.get("url"):
        return {"img": iid, "skip": "no pose or thumbnail"}
    source = Path(job["source"]) if job.get("source") else None
    try:
        dets = _detections(iid, source)
        path, ours = _thumbnail(iid, job["url"], Path(job["scratch"]), source)
    except (OSError, ValueError) as err:
        return {"img": iid, "fail": f"{type(err).__name__}: {err}"[:200]}
    try:
        img = load_image(path)
        cls = class_map(dets)
    except Exception as err:  # noqa: BLE001 — a broken file is skipped, not fatal
        return {"img": iid, "skip": f"unreadable ({type(err).__name__})"}
    finally:
        if ours:
            path.unlink(missing_ok=True)
    rot = rotation_matrix(job["rot"])
    x, y = job["xy"]
    out = []
    for w in job["walls"]:
        (ax, ay), (bx, by) = w["a"], w["b"]
        mx, my = (ax + bx) / 2 + w["n"][0] * 1.5, (ay + by) / 2 + w["n"][1] * 1.5
        zg = _ground(mx, my)
        if zg is None:
            continue
        zc = _ground(x, y)
        cam = (x, y, (zc if zc is not None else zg) + EYE_M)
        try:
            m = measure(w | {"zg": zg}, img, cls, rot, cam)
        except Exception as err:  # noqa: BLE001 — record it, measure the rest
            m = {"err": repr(err)[:100]}
        dist = math.hypot(x - (ax + bx) / 2, y - (ay + by) / 2)
        out.append(
            {"oid": w["oid"], "wi": w["wi"], "L": round(w["L"], 2), "dist": round(dist, 1)} | m
        )
    return {"img": iid, "seq": job["seq"], "walls": out}


# --- fetch and run ----------------------------------------------------------


def _done(path: Path) -> set[str]:
    if not path.exists():
        return set()
    done = set()
    for line in path.read_text().splitlines():
        try:
            done.add(json.loads(line)["img"])
        except (ValueError, KeyError):
            continue  # a line cut by a killed run
    return done


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


def fetch(tile: Tile) -> None:
    """Measure the tile's facades on its panoramas, caching per image."""
    if not tile.mapillary:
        return
    if not os.environ.get("MAPILLARY_TOKEN"):
        print(f"{tile.id}: no MAPILLARY_TOKEN — the facades not measured")
        return
    _fetch_signs(tile)
    images = _cached_json(
        _images_path(tile),
        lambda: _search_tile(tile, "images", {"fields": IMAGE_FIELDS, "is_pano": "true"}, NEAR_M),
    )
    jobs = plan(json.loads(tile.cityjson.read_text()), images, tile.epsg)
    out = cache_path(tile)
    done = _done(out)
    todo = sorted(set(jobs) - done)
    print(f"{tile.id}: {len(jobs)} panoramas see its walls, {len(todo)} to measure")
    if not todo:
        return
    scratch = cache_dir(tile) / ".img"
    scratch.mkdir(parents=True, exist_ok=True)
    source = os.environ.get(SOURCE_ENV)
    counts = collections.Counter()
    t0 = last = time.time()
    with (
        open(out, "a") as f,
        cf.ProcessPoolExecutor(WORKERS, initializer=_init_worker, initargs=(str(tile.dgm),)) as ex,
    ):
        for start in range(0, len(todo), 400):
            batch = todo[start : start + 400]
            poses = _poses(batch)
            work = [
                jobs[i]
                | {"img": i, "rot": poses.get(i, {}).get("computed_rotation")}
                | {
                    "url": poses.get(i, {}).get("thumb_2048_url"),
                    "scratch": str(scratch),
                    "source": source,
                }
                for i in batch
            ]
            for r in ex.map(measure_image, work, chunksize=1):
                kind = "fail" if "fail" in r else "skip" if "skip" in r else "measured"
                counts[kind] += 1
                if kind != "fail":
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
