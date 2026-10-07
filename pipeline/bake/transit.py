"""The trams by timetable: the site's scheduled tram trips (GTFS from
gtfs.de, built from DELFI's NeTEx; CC BY 4.0) laid onto the site's OSM tram
tracks → one site-wide file the viewer runs the trams from at the scene's
clock (app/_components/tram-cars.ts). Not live positions: what the
timetable says, every trip, at its scheduled times.

The feed has no shapes, so the path between two stops is the shortest way
along the tracks the tram bake drew (data/<site>/dlm/tram_<tile>.geojson, OSM,
ODbL) from the track nearest the one stop's platform to the track nearest
the next's — each platform has its own position in DELFI's stops, so the
nearest track is the one on the platform's side: a tram keeps right on a
double track. A leg whose way along the tracks is more than DETOUR times
the straight distance, or which finds no track near a platform, is left
out (and the trip runs on in pieces), never drawn as a straight line
through the houses.

The feed covers about a month. The bake picks three days within it, one
per kind the viewer tells apart — a working day (Tuesday to Thursday), a
Saturday, a Sunday — each the day of its kind with the most tram trips in
the coming three weeks (a public holiday runs a reduced or a Sunday
service and loses). The viewer runs the trips of the scene's kind of day
(a public holiday is not told apart).

The raw feed (`data/_raw/gtfs/nv_free.zip`, ≈290 MB, all of Germany's
local transport, shared by every site; `bun run fetch` downloads it for a
site with trams) is filtered once to the site's trams and cached beside it
(`trams_<site extent>.json`): streaming its 2 GB of stop times takes a few
minutes. Every operator's trams are the same here: route type 0 (and the
extended 900–906), whoever runs them.

Output `data/<site>/transit/trams.json` (lib/city/features.ts `TramTimetable`):
  routes     the line names ("1", "2", …)
  patterns   one per sequence of stops: `route` (index), `coords` the path
             (projected, decimetres), `at` the distance along it of each
             stop (m), `bridge` [from, to] vertex ranges on a bridge deck
             (the viewer lifts the car onto the deck there)
  profiles   one per pattern and set of running times: `pattern`, `t` the
             arrival and departure of each stop, seconds after the trip's
             start (a, d, a, d, …)
  days       { weekday | saturday | sunday: { date, trips: [[profile,
             start second of the day], …] } } — a start may run past
             midnight (≥ 86 400), as GTFS writes it
"""

from __future__ import annotations

import csv
import datetime
import io
import json
import math
import zipfile
from collections import defaultdict
from pathlib import Path

import networkx as nx
import numpy as np
import shapely
from pyproj import Transformer
from scipy.spatial import cKDTree

from .net import download

ATTRIBUTION = (
    "Fahrplan: DELFI e.V. via gtfs.de (CC BY 4.0); Gleise © OpenStreetMap contributors (ODbL)"
)
# GTFS route types of a tram (the basic type and the extended ones).
TRAM_TYPES = {"0", *(str(t) for t in range(900, 907))}
# A platform this far from every track has no track (m).
PLATFORM_REACH_M = 60.0
# How many track nodes near a platform are tried, and how many metres of
# way a metre between platform and track weighs.
CANDIDATES = 12
PLATFORM_WEIGHT = 3.0
# A leg whose way along the tracks is longer than this times the straight
# distance between its stops took a wrong turn (or the tracks have a gap).
DETOUR = 2.5
# Track vertices closer than this are one node of the graph (m): the tram
# bake cuts a track at the tile edge, both pieces end on the same point.
SNAP_M = 0.3
# A stop left from another track than the one arrived on is joined along
# the tracks when the way across is this short (in track vertices), else
# with a straight step.
JOIN_NODES = 12
# The path is simplified by this much (m) and written in decimetres.
SIMPLIFY_M = 0.25
DAY_KINDS = ("weekday", "saturday", "sunday")
LOOKAHEAD_DAYS = 21


# --- the feed -----------------------------------------------------------------


def _rows(z: zipfile.ZipFile, name: str):
    with z.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def gtfs_seconds(text: str) -> int:
    """ "25:07:00" → 90 420 (GTFS runs past midnight)."""
    h, m, s = text.strip().split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def site_trams(zip_path: Path, bounds, epsg: int) -> dict:
    """The feed cut to the trams that stop inside `bounds` (+ a margin):
    their routes, stops (projected), trips with their services, the stop
    times of those trips, and the services' calendars."""
    to_site = Transformer.from_crs(4326, epsg, always_xy=True)
    xmin, ymin, xmax, ymax = bounds
    margin = 500.0
    with zipfile.ZipFile(zip_path) as z:
        routes = {
            r["route_id"]: r["route_short_name"]
            for r in _rows(z, "routes.txt")
            if r["route_type"] in TRAM_TYPES
        }
        stops = {}
        for s in _rows(z, "stops.txt"):
            try:
                lon, lat = float(s["stop_lon"]), float(s["stop_lat"])
            except ValueError:
                continue
            x, y = to_site.transform(lon, lat)
            if xmin - margin <= x <= xmax + margin and ymin - margin <= y <= ymax + margin:
                stops[s["stop_id"]] = {"x": round(x, 2), "y": round(y, 2), "name": s["stop_name"]}
        trips = {
            t["trip_id"]: {"route": t["route_id"], "service": t["service_id"]}
            for t in _rows(z, "trips.txt")
            if t["route_id"] in routes
        }
        times: dict[str, list] = defaultdict(list)
        with z.open("stop_times.txt") as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            header = next(text).strip().split(",")
            col = {name: i for i, name in enumerate(header)}
            if col["trip_id"] != 0:
                raise ValueError("stop_times.txt: the trip id must be the first column")
            ai, di, si, qi = (
                col["arrival_time"],
                col["departure_time"],
                col["stop_id"],
                col["stop_sequence"],
            )
            for line in text:
                # The trip id is the first column: test it before parsing
                # the rest (2 GB, the tram trips are a fraction of it).
                tid = line[: line.find(",")]
                if tid not in trips:
                    continue
                f = next(csv.reader([line]))
                times[tid].append((int(f[qi]), f[si], gtfs_seconds(f[ai]), gtfs_seconds(f[di])))
        # Only the trips that stop on the site at least once.
        kept = {tid: t for tid, t in trips.items() if any(r[1] in stops for r in times[tid])}
        services = {t["service"] for t in kept.values()}
        calendar = {
            c["service_id"]: c for c in _rows(z, "calendar.txt") if c["service_id"] in services
        }
        exceptions: dict[str, dict[str, str]] = defaultdict(dict)
        for c in _rows(z, "calendar_dates.txt"):
            if c["service_id"] in services:
                exceptions[c["service_id"]][c["date"]] = c["exception_type"]
    return {
        "routes": {rid: routes[rid] for rid in {t["route"] for t in kept.values()}},
        "stops": stops,
        "trips": {tid: {**t, "times": sorted(times[tid])} for tid, t in sorted(kept.items())},
        "calendar": calendar,
        "exceptions": exceptions,
    }


def gtfs_dir(raw: Path) -> Path:
    """Where the feed lives: one folder for every provider (it covers all
    of Germany), beside the providers' raw folders."""
    return raw.parent / "gtfs"


# Germany's local transport timetable as GTFS (gtfs.de, from DELFI's NeTEx;
# CC BY 4.0), ≈290 MB, refreshed weekly by its publisher. Fetched again once
# the copy is a week old (the feed covers about a month ahead).
GTFS_URL = "https://download.gtfs.de/germany/nv_free/latest.zip"
GTFS_MAX_AGE_DAYS = 7


def fetch_gtfs(folder: Path) -> None:
    out = folder / "nv_free.zip"
    if out.exists():
        age = datetime.datetime.now().timestamp() - out.stat().st_mtime
        if age < GTFS_MAX_AGE_DAYS * 86400:
            return
        out.unlink()
    try:
        download(GTFS_URL, out)
        print(f"GTFS feed → {out}")
    except Exception as err:  # noqa: BLE001 — the tiles do not need it
        print(f"GTFS feed not downloaded ({err}); put {GTFS_URL} at {out}")


def cached_site_trams(folder: Path, bounds, epsg: int) -> dict | None:
    zip_path = folder / "nv_free.zip"
    if not zip_path.exists():
        return None
    key = "_".join(f"{v:.0f}" for v in bounds)
    cache = folder / f"trams_{key}.json"
    if cache.exists() and cache.stat().st_mtime >= zip_path.stat().st_mtime:
        try:
            return json.loads(cache.read_text())
        except ValueError:
            pass  # unreadable (an older, interrupted write): derived again
    feed = site_trams(zip_path, bounds, epsg)
    part = cache.with_name(cache.name + ".part")
    part.write_text(json.dumps(feed))
    part.replace(cache)
    return feed


# --- the days -----------------------------------------------------------------


WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def runs_on(service: str, day: datetime.date, feed: dict) -> bool:
    key = day.strftime("%Y%m%d")
    exc = feed["exceptions"].get(service, {}).get(key)
    if exc == "1":
        return True
    if exc == "2":
        return False
    c = feed["calendar"].get(service)
    if not c:
        return False
    return c["start_date"] <= key <= c["end_date"] and c[WEEKDAYS[day.weekday()]] == "1"


def kind_of(day: datetime.date) -> str | None:
    """Which of the viewer's kinds of day a date stands for (Monday and
    Friday are left out: their late and early trips differ)."""
    wd = day.weekday()
    if wd in (1, 2, 3):
        return "weekday"
    return {5: "saturday", 6: "sunday"}.get(wd)


def pick_days(feed: dict, start: datetime.date) -> dict[str, datetime.date]:
    """Per kind of day, the date with the most tram trips in the next
    LOOKAHEAD_DAYS (the earliest of equals)."""
    best: dict[str, tuple[int, datetime.date]] = {}
    services = defaultdict(int)
    for t in feed["trips"].values():
        services[t["service"]] += 1
    for i in range(LOOKAHEAD_DAYS):
        day = start + datetime.timedelta(days=i)
        kind = kind_of(day)
        if kind is None:
            continue
        n = sum(count for s, count in services.items() if runs_on(s, day, feed))
        if n > 0 and (kind not in best or n > best[kind][0]):
            best[kind] = (n, day)
    return {kind: day for kind, (_, day) in best.items()}


# --- the tracks -----------------------------------------------------------------


class Tracks:
    """The site's tram tracks as a graph: nodes at the track vertices
    (snapped across the tile seams), edges weighted by length, each edge
    knowing whether it lies on a bridge deck."""

    def __init__(self, lines: list[tuple[list[list[float]], bool]]):
        pts = np.array([p for coords, _ in lines for p in coords], np.float64).reshape(-1, 2)
        tree = cKDTree(pts)
        # One representative per cluster of vertices within SNAP_M.
        rep = np.arange(len(pts))
        for i, j in sorted(tree.query_pairs(SNAP_M)):
            ri, rj = _find(rep, i), _find(rep, j)
            if ri != rj:
                rep[max(ri, rj)] = min(ri, rj)
        self.node_of = np.array([_find(rep, i) for i in range(len(pts))])
        self.xy = pts
        self.graph = nx.Graph()
        k = 0
        for coords, bridge in lines:
            ids = self.node_of[k : k + len(coords)]
            k += len(coords)
            for a, b in zip(ids[:-1], ids[1:], strict=True):
                if a != b:
                    w = float(np.hypot(*(pts[a] - pts[b])))
                    self.graph.add_edge(int(a), int(b), weight=w, bridge=bridge)
        nodes = np.array(sorted(self.graph.nodes), np.int64)
        self.nodes = nodes
        self.tree = cKDTree(pts[nodes]) if len(nodes) else None

    def nearest(self, x: float, y: float) -> int | None:
        if self.tree is None:
            return None
        d, i = self.tree.query((x, y))
        return int(self.nodes[i]) if d <= PLATFORM_REACH_M else None

    def candidates(self, x: float, y: float) -> list[tuple[int, float]]:
        """The track nodes within reach of a platform, nearest first, as
        (node, distance) — a few, on as many tracks as are near."""
        if self.tree is None:
            return []
        d, i = self.tree.query((x, y), k=CANDIDATES, distance_upper_bound=PLATFORM_REACH_M)
        return [
            (int(self.nodes[j]), float(dist))
            for dist, j in zip(np.atleast_1d(d), np.atleast_1d(i), strict=True)
            if np.isfinite(dist)
        ]

    def leg(self, a: tuple[float, float], b: tuple[float, float]) -> list[int] | None:
        """The way along the tracks from platform `a` to platform `b`: of
        the tracks near each, the pair whose way is shortest, a metre of
        platform distance weighing PLATFORM_WEIGHT metres of way (so of two
        parallel tracks the one beside the platform wins: a tram keeps
        right). None when no way is shorter than DETOUR × the straight
        distance."""
        straight = math.hypot(a[0] - b[0], a[1] - b[1])
        cutoff = DETOUR * max(straight, 50.0)
        targets = dict(self.candidates(*b))
        best: tuple[float, int, int] | None = None
        for na, da in self.candidates(*a):
            lengths = nx.single_source_dijkstra_path_length(
                self.graph, na, cutoff=cutoff, weight="weight"
            )
            for nb, db in targets.items():
                if nb in lengths and nb != na:
                    cost = lengths[nb] + PLATFORM_WEIGHT * (da + db)
                    if best is None or cost < best[0]:
                        best = (cost, na, nb)
        if best is None:
            return None
        return self.path(best[1], best[2])

    def path(self, a: int, b: int) -> list[int] | None:
        try:
            return nx.shortest_path(self.graph, a, b, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None


def _find(rep: np.ndarray, i: int) -> int:
    while rep[i] != i:
        rep[i] = rep[rep[i]]
        i = rep[i]
    return int(i)


def read_tracks(data: Path) -> Tracks:
    lines = []
    for path in sorted((data / "dlm").glob("tram_*.geojson")):
        for f in json.loads(path.read_text())["features"]:
            p = f.get("properties") or {}
            g = f.get("geometry") or {}
            if p.get("k") == "track" and g.get("type") == "LineString":
                lines.append((g["coordinates"], p.get("bridge") == 1))
    return Tracks(lines)


# --- the patterns -------------------------------------------------------------


def _leg(tracks: Tracks, a: dict, b: dict, cache: dict) -> list[int] | None:
    """The node path between two stops, or None (see the module comment)."""
    key = (a["x"], a["y"], b["x"], b["y"])
    if key not in cache:
        cache[key] = tracks.leg((a["x"], a["y"]), (b["x"], b["y"]))
    return cache[key]


def runs_of(trip: dict, feed: dict, tracks: Tracks, cache: dict) -> list[list]:
    """A trip's runs: the stretches of consecutive stops whose legs all
    found their way, as [(stop id, arrival, departure, node path to the
    next stop)…]; a stop off the site or a leg without a way ends a run."""
    rows = [r for r in trip["times"]]
    runs: list[list] = []
    run: list = []
    for (_, sid, arr, dep), nxt in zip(rows, [*rows[1:], None], strict=True):
        stop = feed["stops"].get(sid)
        if stop is None:
            if len(run) >= 2:
                runs.append(run)
            run = []
            continue
        leg = None
        if nxt is not None and nxt[1] in feed["stops"]:
            leg = _leg(tracks, stop, feed["stops"][nxt[1]], cache)
        run.append((sid, arr, dep, leg))
        if leg is None:
            if len(run) >= 2:
                runs.append(run)
            run = []
    if len(run) >= 2:
        runs.append(run)
    return runs


def pattern_geometry(run: list, tracks: Tracks) -> tuple[list, list[float], list[list[int]]]:
    """A run's path (projected), the distance along it of each stop, and
    the vertex ranges on a bridge."""
    nodes: list[int] = []
    at_node: list[int] = []
    for _, _, _, leg in run[:-1]:
        if not nodes:
            nodes.append(leg[0])
        elif leg[0] != nodes[-1]:
            # The leg leaves the stop from another of its tracks than the
            # last one arrived on (a platform between two): the short way
            # across, along the tracks where there is one, else a step.
            across = tracks.path(nodes[-1], leg[0])
            if across is not None and len(across) <= JOIN_NODES:
                nodes.extend(across[1:-1])
            nodes.append(leg[0])
        at_node.append(len(nodes) - 1)
        nodes.extend(leg[1:])
    at_node.append(len(nodes) - 1)
    xy = tracks.xy[nodes]
    edges = tracks.graph.edges
    on_bridge = [
        bool(edges[u, v]["bridge"]) if edges.get((u, v)) is not None else False
        for u, v in zip(nodes[:-1], nodes[1:], strict=True)
    ]
    # Simplify, but keep every stop's vertex and every bridge end.
    keep = set(at_node) | {0, len(nodes) - 1}
    for i in range(1, len(on_bridge)):
        if on_bridge[i] != on_bridge[i - 1]:
            keep.add(i)
    line = shapely.LineString(xy)
    simple = shapely.simplify(line, SIMPLIFY_M, preserve_topology=False)
    near = cKDTree(xy)
    for p in simple.coords:
        keep.add(int(near.query(p)[1]))
    order = sorted(keep)
    new_index = {old: i for i, old in enumerate(order)}
    coords = [[round(float(xy[i][0]), 1), round(float(xy[i][1]), 1)] for i in order]
    # The stops' distances along the simplified path the viewer measures.
    kept = np.asarray(coords, np.float64)
    kept_dist = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(kept, axis=0).T))])
    at = [round(float(kept_dist[new_index[at_node[k]]]), 1) for k in range(len(at_node))]
    ranges: list[list[int]] = []
    start = None
    for i, b in enumerate(on_bridge):
        if b and start is None:
            start = i
        if not b and start is not None:
            ranges.append([new_index[start], new_index[i]])
            start = None
    if start is not None:
        ranges.append([new_index[start], new_index[len(nodes) - 1]])
    return coords, at, ranges


def build_timetable(feed: dict, tracks: Tracks, days: dict[str, datetime.date]) -> dict:
    route_names = sorted(set(feed["routes"].values()), key=lambda r: (len(r), r))
    route_index = {name: i for i, name in enumerate(route_names)}
    patterns: list[dict] = []
    pattern_of: dict[tuple, int] = {}
    profiles: list[dict] = []
    profile_of: dict[tuple, int] = {}
    cache: dict = {}
    trips_by_day: dict[str, list] = {kind: [] for kind in days}
    runs_cache: dict[str, list] = {}
    for tid, trip in feed["trips"].items():
        kinds = [k for k, day in days.items() if runs_on(trip["service"], day, feed)]
        if not kinds:
            continue
        if tid not in runs_cache:
            runs_cache[tid] = runs_of(trip, feed, tracks, cache)
        route = route_index[feed["routes"][trip["route"]]]
        for run in runs_cache[tid]:
            key = (route, tuple(sid for sid, *_ in run))
            if key not in pattern_of:
                coords, at, bridge = pattern_geometry(run, tracks)
                pattern_of[key] = len(patterns)
                patterns.append({"route": route, "coords": coords, "at": at, "bridge": bridge})
            p = pattern_of[key]
            start = run[0][1]
            t = []
            for _, arr, dep, _ in run:
                t += [arr - start, dep - start]
            pkey = (p, tuple(t))
            if pkey not in profile_of:
                profile_of[pkey] = len(profiles)
                profiles.append({"pattern": p, "t": t})
            for kind in kinds:
                trips_by_day[kind].append([profile_of[pkey], start])
    return {
        "routes": route_names,
        "patterns": patterns,
        "profiles": profiles,
        "days": {
            kind: {
                "date": days[kind].isoformat(),
                "trips": sorted(trips_by_day[kind], key=lambda r: (r[1], r[0])),
            }
            for kind in DAY_KINDS
            if kind in days
        },
    }


def run_site(raw: Path, data: Path, bounds, epsg: int, today: datetime.date | None = None) -> None:
    folder = gtfs_dir(raw)
    feed = cached_site_trams(folder, bounds, epsg)
    if feed is None:
        print(f"no GTFS feed at {folder / 'nv_free.zip'} — skipping the timetable trams")
        return
    tracks = read_tracks(data)
    days = pick_days(feed, today or datetime.date.today())
    doc = {
        "attribution": ATTRIBUTION,
        "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{epsg}"}},
        **build_timetable(feed, tracks, days),
    }
    out = data / "transit" / "trams.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")))
    counts = {k: len(v["trips"]) for k, v in doc["days"].items()}
    print(
        f"timetable trams: {len(doc['routes'])} lines, {len(doc['patterns'])} patterns, "
        f"{len(doc['profiles'])} running-time profiles, trips per day {counts}"
    )
