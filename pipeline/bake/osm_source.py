"""Where the site's OSM extract comes from, and the record of it.

The extract is Geofabrik's (`Provider.osm`, `Site.osm`). Where Geofabrik
cannot be reached — a cut connection or a timeout after the fetch's own
tries, not a 404 (then the config names a file Geofabrik does not have) —
the fetch falls back on BBBike's city extract the site names
(`Site.bbbike`), and only if BBBike's published boundary (`<City>.poly`)
covers every tile of the site with the widest margin a bake reads OSM
beyond a tile (`MAX_MARGIN_DEG`): an extract cut inside that margin would
bake a seam's walls, ways and lamps from half the data without a word.
Where it does not cover the site the fetch says by how much and takes
nothing (docs/data-pipeline.md, "Where the OSM extract comes from").

Each extract the fetch writes gets a record beside it,
`<extract>.source.json`: the source, its URL, its `Last-Modified` (the
day the data is as of; BBBike rebuilds its extracts weekly from the
planet), its md5 and the day it was fetched. The bake prints it, and
writes the day into the site's `provenance.json` for every step it ran
that reads OSM (`record_bake`), where the Open-Data-Wächter reads how old
the OSM data of the committed files is.

Not imported by any step: a bake step reads the extract through `osm.py`
and never needs to know where it came from, so this module changes no
step's cache key (step_cache.code_hash).
"""

from __future__ import annotations

import dataclasses
import datetime
import email.utils
import json
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


def candidates(spec: Spec, fallback: str | None) -> list[Path]:
    """Where the site's extract may be, in the order it is taken:
    Geofabrik's (the spec's), then the BBBike fallback's — each under its
    own name, so a Saxon site never reads another city's BBBike extract."""
    return [spec.osm, *([osm_path(spec.raw, fallback)] if fallback else [])]


def resolve(spec: Spec, fallback: str | None) -> Spec:
    """The spec reading the extract that is there: Geofabrik's, else the
    fallback's. Done here, not in spec.py, which a step's code reaches
    (allometry.py): the fallback is no step's business, and a change to it
    re-keys no step's cache."""
    if fallback is None or spec.osm.exists():
        return spec
    pbf = osm_path(spec.raw, fallback)
    if not pbf.exists():
        return spec
    tiles = [dataclasses.replace(t, osm=pbf) for t in spec.tiles]
    return dataclasses.replace(spec, osm_url=fallback, tiles=tiles)


def record_path(pbf: Path) -> Path:
    return pbf.with_name(pbf.name + ".source.json")


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
    except OSError:
        return None
    if not value:
        return None
    return email.utils.parsedate_to_datetime(value).astimezone(datetime.UTC).isoformat()


def write_record(pbf: Path, url: str, modified: str | None, md5: str | None) -> dict:
    record = {
        "source": source_name(url),
        "url": url,
        "lastModified": modified,
        "md5": md5,
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


def provenance_line(record: dict | None, pbf: Path, today: str) -> str:
    """The `dataAsOf` a baked step's provenance carries: the data's day
    first (what the Open-Data-Wächter reads), then where it came from."""
    if record is None:
        return f"unknown ({pbf.name} placed by hand, no record of its source; baked {today})"
    day = data_day(record) or "unknown"
    return (
        f"{day} ({record['source']} extract {pbf.name}, {record['url']}, "
        f"Last-Modified {record.get('lastModified') or '?'}; baked {today})"
    )


def record_bake(provenance: Path, pbf: Path, steps: Iterable[str]) -> None:
    """Writes into the site's `provenance.json` which extract each of
    `steps` was baked from (`openstreetmap.baked.<step>.dataAsOf`), leaving
    every other member as it is. A site without a provenance file yet gets
    none: it is written when the site is first committed."""
    steps = sorted(set(steps))
    if not steps or not provenance.exists():
        return
    doc = json.loads(provenance.read_text())
    osm = doc.setdefault("openstreetmap", {})
    baked = osm.setdefault("baked", {})
    line = provenance_line(read_record(pbf), pbf, datetime.date.today().isoformat())
    if all(baked.get(step) == {"dataAsOf": line} for step in steps):
        return  # nothing new: a hand-formatted file stays as it is
    for step in steps:
        baked[step] = {"dataAsOf": line}
    osm["baked"] = dict(sorted(baked.items()))
    provenance.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"{provenance}: OSM steps {', '.join(steps)} recorded as baked from {pbf.name}")
