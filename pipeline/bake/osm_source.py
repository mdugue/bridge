"""Where the site's OSM extract comes from, whether it may be used, and the
record of it.

The extract is Geofabrik's (`Provider.osm`, `Site.osm`: a Land or a
Regierungsbezirk, which holds the site). Where Geofabrik cannot be reached
— a cut connection, a timeout, a 5xx after the fetch's own tries
(`unreachable`); not a 404, a failed checksum or a full disk — the fetch
falls back on BBBike's city extract the site names (`Site.bbbike`).

A BBBike extract is used only where its published boundary (`<City>.poly`,
kept beside it) covers every tile of the site that is about to read it,
with the widest margin a bake reads OSM beyond a tile (`MAX_MARGIN_DEG`):
an extract cut inside that margin would bake a seam's walls, ways and
lamps from half the data without a word. The check is made every time the
extract is taken — by the fetch and by every bake (`usable`) — whoever
fetched the file: a Land's sites share one raw folder, so Dresden's
`Dresden.osm.pbf` is on disk when Meißen, which it does not cover, asks.

Each extract the fetch writes gets a record beside it,
`<extract>.source.json`: the source, its URL, its `Last-Modified` (the
day the data is as of; BBBike rebuilds its extracts weekly from the
planet), the file's md5 and the one its server publishes, and the day it
was fetched. A file that no longer matches its record's md5 is not used.
The bake prints the record and writes, per step and tile it ran, the
extract's day into the site's `provenance.json` (`record_bake`), where the
Open-Data-Wächter and the inquiry card read how old the OSM data is; an
extract with no day (placed by hand, or its server named none) is written
as `unknown`, never as the day of the bake.

Not imported by any step: a bake step reads the extract through `osm.py`
and never needs to know where it came from, so this module changes no
step's cache key (step_cache.code_hash). Which extract a step read is in
its key all the same (`identity`, __main__.py `step_key`).
"""

from __future__ import annotations

import dataclasses
import datetime
import email.utils
import errno
import hashlib
import http.client
import json
import re
import urllib.error
import urllib.request
from collections.abc import Iterable
from pathlib import Path

import shapely

from .common import Tile
from .net import USER_AGENT
from .osm import wgs84_bbox
from .spec import Spec, osm_path

# The widest margin (degrees) any bake reads OSM beyond a tile: the
# monorail's whole chain of ways (rail_osm.py `MONORAIL_MARGIN`).
# tests/test_osm_source.py holds every margin a bake passes to the OSM
# readers to it, so a wider read cannot slip past the coverage check.
MAX_MARGIN_DEG = 0.05

# What a cut connection looks like once net.py has wrapped it in OSError.
_CUT = re.compile(r"\d+ of \d+ bytes|IncompleteRead|RemoteDisconnected|timed out", re.IGNORECASE)


def unreachable(err: BaseException) -> bool:
    """Whether a download failed because the server could not be reached
    or the connection broke — the one failure the fallback is for. A 404
    (the config names a file the server does not have), a checksum that
    does not match, a full disk are not: they would fail the same on any
    source, or hide a wrong config behind a stand-in."""
    if isinstance(err, urllib.error.HTTPError):
        return err.code >= 500
    if isinstance(err, urllib.error.URLError | ConnectionError | TimeoutError):
        return True
    if isinstance(err, http.client.HTTPException):
        return True
    if isinstance(err, OSError) and err.errno == errno.ENOSPC:
        return False
    return isinstance(err, OSError) and bool(_CUT.search(str(err)))


def record_path(pbf: Path) -> Path:
    return pbf.with_name(pbf.name + ".source.json")


def poly_path(pbf: Path) -> Path:
    """Where the extract's boundary is kept: `Dresden.osm.pbf` → `Dresden.poly`."""
    return pbf.with_name(pbf.name.removesuffix(".osm.pbf") + ".poly")


def poly_url(url: str) -> str:
    return url.removesuffix(".osm.pbf") + ".poly"


def source_name(url: str) -> str:
    """The source an extract's URL names, as the logs and records say it."""
    if "bbbike.org" in url:
        return "BBBike"
    if "geofabrik.de" in url:
        return "Geofabrik"
    return url.split("/")[2] if "://" in url else "unknown"


def last_modified(url: str) -> str | None:
    """The server's `Last-Modified` for `url` (ISO, UTC), or None."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            value = res.headers.get("Last-Modified")
    except (OSError, http.client.HTTPException):
        return None
    if not value:
        return None
    return email.utils.parsedate_to_datetime(value).astimezone(datetime.UTC).isoformat()


def file_md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def write_record(
    pbf: Path, url: str, modified: str | None, md5: str, published: str | None
) -> dict:
    """The extract's record: `md5` is the file's, `published` the server's
    (None where it published none; the download checked the two agree)."""
    record = {
        "source": source_name(url),
        "url": url,
        "lastModified": modified,
        "md5": md5,
        "publishedMd5": published,
        "fetched": datetime.date.today().isoformat(),
    }
    part = record_path(pbf).with_suffix(".part")
    part.write_text(json.dumps(record, indent=2) + "\n")
    part.replace(record_path(pbf))
    return record


def read_record(pbf: Path) -> dict | None:
    path = record_path(pbf)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def intact(pbf: Path) -> str | None:
    """None when the extract is the file its record names (or has no
    record: one placed by hand); else what is wrong."""
    record = read_record(pbf)
    if record is None or not record.get("md5"):
        return None
    if file_md5(pbf) != record["md5"]:
        return f"{pbf.name} is not the file its record names (md5 differs)"
    return None


def data_day(record: dict | None) -> str | None:
    """The day the extract's data is as of (its `Last-Modified`), or None."""
    modified = (record or {}).get("lastModified")
    return modified[:10] if isinstance(modified, str) and len(modified) >= 10 else None


def describe(pbf: Path) -> str:
    """One line on an extract: which source, which day."""
    record = read_record(pbf)
    if record is None:
        return f"{pbf.name} (no record of its source: placed by hand)"
    day = data_day(record) or "an unknown day"
    return f"{pbf.name} from {record['source']} ({record['url']}), data as of {day}"


def parse_poly(text: str) -> shapely.Geometry:
    """An Osmosis polygon file (BBBike's `<City>.poly`): a name line, then
    rings of `lon lat` lines each closed by END (a ring whose name starts
    with `!` is a hole), the file closed by END."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    shells: list[shapely.Polygon] = []
    holes: list[shapely.Polygon] = []
    i = 1  # past the file's name
    while i < len(lines) and lines[i] != "END":
        name, ring = lines[i], []
        i += 1
        while i < len(lines) and lines[i] != "END":
            lon, lat = (float(v) for v in lines[i].split()[:2])
            ring.append((lon, lat))
            i += 1
        i += 1  # the ring's END
        if len(ring) >= 3:
            (holes if name.startswith("!") else shells).append(shapely.Polygon(ring))
    if not shells:
        raise ValueError("the polygon file holds no ring")
    area = shapely.union_all(shells)
    return shapely.difference(area, shapely.union_all(holes)) if holes else area


def needed_area(tiles: Iterable[Tile]) -> shapely.Geometry:
    """What an extract must hold for the site: every tile's WGS84 box with
    `MAX_MARGIN_DEG` around it (`osm.wgs84_bbox`, as the bakes read it)."""
    return shapely.union_all([shapely.box(*wgs84_bbox(t, MAX_MARGIN_DEG)) for t in tiles])


def shortfall(boundary: shapely.Geometry, tiles: Iterable[Tile]) -> str | None:
    """None when `boundary` covers the site; else by how much it does not,
    side by side of the boundary's box ("west by 0.025°")."""
    need = needed_area(tiles)
    if boundary.covers(need):
        return None
    nx0, ny0, nx1, ny1 = need.bounds
    bx0, by0, bx1, by1 = boundary.bounds
    sides = [
        (name, gap)
        for name, gap in (
            ("west", bx0 - nx0),
            ("south", by0 - ny0),
            ("east", nx1 - bx1),
            ("north", ny1 - by1),
        )
        if gap > 0
    ]
    if not sides:
        return "its boundary leaves out part of the site"
    return ", ".join(f"{name} by {gap:.3f}°" for name, gap in sides)


def usable(spec: Spec, pbf: Path) -> str | None:
    """None when the site may read the fallback extract `pbf`; else why not:
    its kept boundary (`poly_path`) does not cover the site's tiles with
    `MAX_MARGIN_DEG`, there is no boundary to tell, or the file is not the
    one its record names. Asked every time the extract is taken, for the
    site taking it."""
    poly = poly_path(pbf)
    if not poly.exists():
        return f"no boundary beside it ({poly.name}) to tell whether it covers {spec.site}"
    try:
        short = shortfall(parse_poly(poly.read_text()), spec.tiles)
    except (OSError, ValueError) as err:
        return f"its boundary {poly.name} is not readable ({err})"
    if short is not None:
        return (
            f"it does not cover {spec.site} with the bakes' {MAX_MARGIN_DEG}° margin "
            f"({poly.name}: short {short})"
        )
    return intact(pbf)


def candidates(spec: Spec, fallback: str | None) -> list[Path]:
    """Where the site's extract may be, in the order it is taken:
    Geofabrik's (the spec's), then the BBBike fallback's — each under its
    own name, so a Saxon site never reads another city's BBBike extract."""
    return [spec.osm, *([osm_path(spec.raw, fallback)] if fallback else [])]


def resolve(spec: Spec, fallback: str | None, say=print) -> Spec:
    """The spec reading the extract the site may use: Geofabrik's where it
    is there (and is the file its record names), else the fallback's where
    it covers the site (`usable`), else none (the spec's own, absent or
    refused: the OSM steps then find no extract). Done here, not in
    spec.py, which a step's code reaches (allometry.py)."""
    if spec.osm.exists():
        problem = intact(spec.osm)
        if problem is None:
            return spec
        say(f"OSM extract: {problem} — not used")
        return _without_extract(spec)
    if fallback is None:
        return spec
    pbf = osm_path(spec.raw, fallback)
    if not pbf.exists():
        return spec
    problem = usable(spec, pbf)
    if problem is not None:
        say(f"OSM extract: {pbf.name} is not used for {spec.site}: {problem}")
        return spec
    tiles = [dataclasses.replace(t, osm=pbf) for t in spec.tiles]
    return dataclasses.replace(spec, osm_url=fallback, tiles=tiles)


def _without_extract(spec: Spec) -> Spec:
    """The spec pointing at an extract that is not there: the steps skip."""
    absent = spec.raw / "osm" / "refused" / spec.osm.name
    tiles = [dataclasses.replace(t, osm=absent) for t in spec.tiles]
    return dataclasses.replace(spec, osm_url=f"refused/{spec.osm.name}", tiles=tiles)


def identity(spec: Spec, primary: Path) -> dict | str | None:
    """Which extract the bake reads, for the cache key of every step that
    reads OSM (__main__.py `step_key`): None for the provider's own
    Geofabrik extract (the key every recorded run already has: its content
    is in each run's recorded reads), "none" without one, else its file,
    source and md5 — so a step baked on BBBike's runs again when
    Geofabrik's comes, and one baked on none when any comes."""
    if spec.osm == primary and primary.exists():
        return None
    if not spec.osm.exists():
        return "none"
    record = read_record(spec.osm) or {}
    return {
        "file": spec.osm.name,
        "source": record.get("source", "unrecorded"),
        "md5": record.get("md5"),
    }


def provenance_entry(record: dict | None, pbf: Path, today: str) -> dict:
    """What a baked step's provenance carries for a tile: `dataAsOf`, the
    data's day first (what the Open-Data-Wächter and the inquiry card
    read) or `unknown` where the extract names none, and `on`, the day of
    the bake — apart, so the bake's day is never read as the data's."""
    day = data_day(record)
    if record is None:
        what = f"unknown ({pbf.name} placed by hand, no record of its source)"
    elif day is None:
        what = f"unknown ({record['source']} extract {pbf.name}, {record['url']}: no Last-Modified)"
    else:
        what = (
            f"{day} ({record['source']} extract {pbf.name}, {record['url']}, "
            f"Last-Modified {record.get('lastModified')})"
        )
    return {"dataAsOf": what, "on": today}


def record_bake(provenance: Path, pbf: Path, ran: Iterable[tuple[str, str]]) -> None:
    """Writes into the site's `provenance.json` which extract each step was
    baked from on each tile it ran on (`openstreetmap.baked.<step>.<tile>`),
    leaving every other member as it is. A site without a provenance file
    yet gets none: it is written when the site is first committed."""
    ran = sorted(set(ran))
    if not ran or not provenance.exists():
        return
    doc = json.loads(provenance.read_text())
    osm = doc.setdefault("openstreetmap", {})
    baked = osm.setdefault("baked", {})
    entry = provenance_entry(read_record(pbf), pbf, datetime.date.today().isoformat())
    if all(baked.get(step, {}).get(tile) == entry for step, tile in ran):
        return  # nothing new: a hand-formatted file stays as it is
    for step, tile in ran:
        baked.setdefault(step, {})[tile] = entry
    osm["baked"] = {s: dict(sorted(t.items())) for s, t in sorted(baked.items())}
    provenance.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    steps = sorted({s for s, _ in ran})
    print(f"{provenance}: {', '.join(steps)} recorded as baked from {pbf.name}")
