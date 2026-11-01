"""OSM's murals whose photo fits → photo textures on their LoD2 walls,
`data/<site>/murals/murals.json` and one WebP per mural beside it, which the
viewer hangs on the wall (app/_components/mural-layer.ts). Site-wide: a
handful per city at most.

One rule for every city, no list of murals:

- **A mural** is an OSM `tourism=artwork` whose `artwork_type` is a mural, a
  mosaic, a graffiti or a sgraffito, mapped as a point on its wall or as a
  line along it (`KINDS`). An area (a painted transformer house) is not:
  its painting goes round the corners, no one photo shows it.
- **Its size is known:** the width from OSM `width`, a line's length along
  the wall, or its own Wikidata item's width (P2049); the height from OSM
  `height` or the item's height (P2048). Its own item is `wikidata`, never
  `subject:wikidata` (the person it shows).
- **A photo shows it straight on:** a Wikimedia Commons file — OSM `image`
  or `wikimedia_commons`, or the item's image (P18) — whose width to height
  is the mural's within `FIT`: a frontal shot of the whole painting. For a
  line, whose length is measured on the wall, a photo wider than that which
  still shows `BAND_MIN` of the height counts as the whole length and a
  band of the height (the Fürstenzug's frieze without the window zone
  above it): the mural is then that band, `width / aspect` high. A
  slanted shot, a detail or a portrait of the artist fits neither and is
  left out. Of several that fit, the one with the most pixels.
- **It hangs on the LoD2 wall** it was mapped on: a line follows its
  footprint's boundary from the projection of its first vertex to that of
  its last; a point takes the straight stretch of wall nearest to it
  (within `SNAP_M`) and centres the width on its projection, kept on that
  stretch — a mural wider than its wall is left out.
- **Its height on the wall:** OSM `min_height` where mapped; else a storey
  up (`STOREY_M`) from the highest ground along it where the wall has room
  for that, lower where it has not, on the ground where the mural is as
  high as the wall below the eaves. Taller than its wall by more than
  `TALLER_M` without a `min_height`: left out.

`bun run fetch` asks for what the rule needs (bake/fetch.py): the items
(Wikidata's `Special:EntityData`, CC0) and the photos' size, licence and
author (the Commons API), cached under `data/_raw/<provider>/murals/`, and
downloads the chosen photo (a standard thumbnail, ≤ 3840 px wide). Wikimedia limits a busy
caller hard: one request at a time, `PAUSE_S` apart, and a 429's
`retry-after` waited out. The bake (`run_site`) reads only those caches,
the extract, the LoD2 and the DGM.

Output `murals.json` (lib/city/murals.ts `MuralFile`): per mural its OSM id
and name, the tile whose buildings hold its wall and that building's id
(`building`: what it hides with), its `path` on the wall (projected, `OFFSET_M`
off it, the wall's outside on its right — the photo's left edge at its
start), `bottom` and `top` (m above sea level), its size, how the photo
fits (`whole` or `band`), the WebP (`image`, `px`) and the photo's credit
(`photo`: Commons title, author, licence, page). The WebP is the photo
stretched to the mural's size, at most `PX_PER_M` pixels a metre and
`MAX_PX` wide, never more than the photo has."""

from __future__ import annotations

import hashlib
import html
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
import shapely
import shapely.ops
from PIL import Image
from pyproj import Transformer

from . import net
from .common import OSM_ATTRIBUTION, Sampler, owns
from .osm import read_extract
from .osm_buildings import footprints, root_of
from .roof_colour import surface_rings

KINDS = ("mural", "mosaic", "graffiti", "sgraffito")
WHERE = "other_tags LIKE '%\"artwork_type\"=>%'"
# a photo's width to height may differ from the mural's by this much
FIT = 0.15
# a band photo of a line shows at least this share of the mapped height
BAND_MIN = 0.5
# how far a point or a line's vertex may lie off its footprint's edge
SNAP_M = 3.0
# a line's way along the wall may differ from its own length by this share
LINE_SLACK = 0.25
# edges that turn less than this are one straight stretch of wall
STRAIGHT_DEG = 10.0
# a mural starts this far up where the wall has room above it
STOREY_M = 3.0
# a mural this much taller than its wall below the eaves is a mapping error
TALLER_M = 1.0
# a way that goes round its wall's corner by less than this ends there
CORNER_M = 0.6
# the texture hangs this far in front of the wall (the wall's own clay
# would show through it otherwise)
OFFSET_M = 0.03
# the ground is read this far in front of the wall, every GROUND_STEP_M
FRONT_M = 0.8
GROUND_STEP_M = 2.0
PX_PER_M = 64
MAX_PX = 3840
# the photo the fetch downloads: the widest of Commons' standard thumbnail
# widths the file has (Wikimedia refuses other widths and, from a busy
# caller, the originals)
THUMB_WIDTHS = (3840, 1920, 1280, 960, 500, 330, 250)
PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp", "image/tiff")

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
COMMONS_PAGE = "https://commons.wikimedia.org/wiki/"
ENTITY_URL = "https://www.wikidata.org/wiki/Special:EntityData/{}.json"
PAUSE_S = 1.5
RETRIES = 5
TITLES_PER_ASK = 50
METRE, CENTIMETRE = "Q11573", "Q174728"
ATTRIBUTION = (
    f"{OSM_ATTRIBUTION}; Wikidata (CC0); photos: Wikimedia Commons, each under its own licence"
)


# --- what the rule reads --------------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    """An OSM mural: its id (`n…` a node, `w…` a way), name, kind, its
    geometry in the site's CRS (a point or a line) and its tags."""

    id: str
    name: str
    kind: str
    geom: shapely.Geometry
    tags: dict[str, str]

    @property
    def line(self) -> bool:
        return self.geom.geom_type == "LineString"

    @property
    def item(self) -> str | None:
        qid = (self.tags.get("wikidata") or "").split(";")[0].strip()
        return qid if re.fullmatch(r"Q\d+", qid) else None


@dataclass(frozen=True)
class Photo:
    """A Commons file as the API describes it."""

    title: str
    w: int
    h: int
    mime: str
    author: str
    licence: str
    url: str
    original: str

    @property
    def aspect(self) -> float:
        return self.w / self.h

    @property
    def thumb(self) -> str:
        """The widest standard thumbnail the file has."""
        width = next((t for t in THUMB_WIDTHS if t <= self.w), THUMB_WIDTHS[-1])
        return thumb_url(self.original, width)


def thumb_url(original: str, width: int) -> str:
    """A Commons file's thumbnail `width` pixels wide, from its original's
    URL (`…/commons/a/ab/Name.jpg` → `…/commons/thumb/a/ab/Name.jpg/<w>px-Name.jpg`;
    a TIFF's thumbnail is a JPEG)."""
    base = original.split("?")[0]
    head, _, tail = base.partition("/commons/")
    name = tail.rsplit("/", 1)[-1]
    suffix = ".jpg" if name.lower().endswith((".tif", ".tiff")) else ""
    return f"{head}/commons/thumb/{tail}/{width}px-{name}{suffix}"


def parse_tags(other_tags: str | None) -> dict[str, str]:
    """GDAL's `other_tags` hstore string as a dict."""
    pairs = re.findall(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"', other_tags or "")
    return {k.replace('\\"', '"'): v.replace('\\"', '"') for k, v in pairs}


def metres(text: str | None) -> float | None:
    """A length tag in metres ("9.5", "9,5 m", "950 cm"); None for anything
    else or out of reason."""
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(m|cm)?\s*", text or "")
    if not m:
        return None
    value = float(m.group(1).replace(",", "."))
    value = value / 100 if m.group(2) == "cm" else value
    return value if 0.3 <= value <= 300 else None


def commons_titles(value: str | None) -> list[str]:
    """The Commons files a tag names (`File:…`, a Commons or Wikipedia
    media link, an upload URL), `;`-separated; categories and other sites
    are none."""
    out = []
    for part in (value or "").split(";"):
        text = urllib.parse.unquote(part.strip())
        m = re.search(r"(?:^|[/:#])(?:File|Datei|Image|Bild):([^?#]+)", text)
        if m:
            name = m.group(1)
        elif "upload.wikimedia.org" in text:
            segments = text.split("?")[0].split("/")
            # a thumbnail's last segment is "<width>px-<name>"; its file is
            # the one before it
            name = segments[-2] if "/thumb/" in text and len(segments) > 1 else segments[-1]
        else:
            continue
        name = name.replace("_", " ").strip()
        if name:
            out.append(f"File:{name[0].upper()}{name[1:]}")
    return out


def item_facts(entity: dict) -> dict:
    """What the rule reads of a Wikidata item: its images (P18) and its
    height (P2048) and width (P2049) in metres."""
    claims = entity.get("claims", {})

    def quantity(prop: str) -> float | None:
        for claim in claims.get(prop, []):
            value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
            if not isinstance(value, dict) or "amount" not in value:
                continue
            unit = str(value.get("unit", "")).rsplit("/", 1)[-1]
            amount = float(value["amount"])
            if unit == METRE:
                return amount
            if unit == CENTIMETRE:
                return amount / 100
        return None

    images = [
        f"File:{c['mainsnak']['datavalue']['value']}"
        for c in claims.get("P18", [])
        if c.get("mainsnak", {}).get("datavalue", {}).get("value")
    ]
    return {"images": images, "height": quantity("P2048"), "width": quantity("P2049")}


def size_of(c: Candidate, item: dict | None) -> tuple[float | None, float | None]:
    """The mural's width and height (m): OSM's, a line's length, its item's."""
    item = item or {}
    width = metres(c.tags.get("width"))
    if c.line:
        width = c.geom.length
    width = width or item.get("width")
    height = metres(c.tags.get("height")) or item.get("height")
    return width, height


def photo_titles(c: Candidate, item: dict | None) -> list[str]:
    """Every Commons file the mapping names for the mural, OSM's first."""
    titles = [
        *commons_titles(c.tags.get("image")),
        *commons_titles(c.tags.get("wikimedia_commons")),
        *((item or {}).get("images") or []),
    ]
    return list(dict.fromkeys(titles))


def choose(
    width: float, height: float, line: bool, photos: list[Photo]
) -> tuple[Photo, float, float, str] | None:
    """The photo that shows the mural straight on and the size it is drawn
    at: (photo, width, height, "whole" | "band"), or None."""
    usable = [p for p in photos if p.mime in PHOTO_TYPES and p.w > 0 and p.h > 0]
    aspect = width / height
    whole = [p for p in usable if abs(math.log(p.aspect / aspect)) <= math.log(1 + FIT)]
    if whole:
        best = max(whole, key=lambda p: (p.w * p.h, p.title))
        return best, width, height, "whole"
    if line:
        bands = [p for p in usable if p.aspect > aspect and width / p.aspect >= BAND_MIN * height]
        if bands:
            best = max(bands, key=lambda p: (p.w * p.h, p.title))
            return best, width, width / best.aspect, "band"
    return None


# --- reading the extract --------------------------------------------------------------


def site_extent(tiles) -> tuple[float, float, float, float]:
    b = [t.bounds for t in tiles]
    return (min(x[0] for x in b), min(x[1] for x in b), max(x[2] for x in b), max(x[3] for x in b))


def candidates(pbf: Path, extent, epsg: int) -> list[Candidate]:
    """The site's murals in the extract (points and lines), in its CRS."""
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = extent
    lons, lats = back.transform([xmin, xmax, xmin, xmax], [ymin, ymin, ymax, ymax])
    bbox = (min(lons), min(lats), max(lons), max(lats))
    project = Transformer.from_crs(4326, epsg, always_xy=True)
    out = []
    for layer, prefix in (("points", "n"), ("lines", "w")):
        geoms, fields = read_extract(pbf, layer, bbox, WHERE, ["osm_id", "name", "other_tags"])
        for i, g in enumerate(geoms):
            tags = parse_tags(fields["other_tags"][i])
            kind = tags.get("artwork_type", "")
            if tags.get("tourism") != "artwork" or kind not in KINDS:
                continue
            g = shapely.transform(
                g, lambda xy: np.column_stack(project.transform(xy[:, 0], xy[:, 1]))
            )
            centre = g.centroid if g.geom_type != "Point" else g
            if not (xmin <= centre.x < xmax and ymin <= centre.y < ymax):
                continue
            name = fields["name"][i] or tags.get("name") or ""
            out.append(Candidate(f"{prefix}{fields['osm_id'][i]}", str(name), kind, g, tags))
    return sorted(out, key=lambda c: c.id)


# --- the fetch ------------------------------------------------------------------------


def _get(url: str) -> bytes:
    """One request, waited out while Wikimedia asks to (429's retry-after)."""
    for attempt in range(RETRIES):
        time.sleep(PAUSE_S)
        try:
            with net._request(url) as res:
                return res.read()
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt == RETRIES - 1:
                raise
            wait = int(err.headers.get("retry-after") or 30)
            print(f"  Wikimedia asks to wait {wait} s")
            time.sleep(min(wait, 120) + 1)
    raise OSError(f"{url}: no answer")


def _plain(text: str) -> str:
    """Commons' extmetadata HTML as plain text."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text or ""))).strip()


def photo_of(page: dict) -> Photo | None:
    """A Commons API page (prop=imageinfo) as a Photo."""
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        return None
    meta = info.get("extmetadata", {})

    def field(name: str) -> str:
        return _plain(str(meta.get(name, {}).get("value", "")))

    return Photo(
        title=page["title"],
        w=int(info.get("width", 0)),
        h=int(info.get("height", 0)),
        mime=info.get("mime", ""),
        author=field("Artist") or field("Credit"),
        licence=field("LicenseShortName"),
        url=info.get("descriptionurl")
        or COMMONS_PAGE + urllib.parse.quote(page["title"].replace(" ", "_")),
        original=str(info.get("url", "")).split("?")[0],
    )


def _read(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    part.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True))
    part.replace(path)


def cache_dir(raw: Path) -> Path:
    return raw / "murals"


def fetch(spec) -> int:
    """Asks Wikidata and Commons what the rule needs for the site's murals
    and downloads each chosen photo; returns how many have one. What is
    cached already is not asked again."""
    pbf = spec.osm
    if not pbf.exists():
        print(f"{spec.site}: no OSM extract — no murals fetched")
        return 0
    found = candidates(pbf, site_extent(spec.tiles), spec.epsg)
    cache = cache_dir(spec.raw)
    items_path, photos_path = cache / "items.json", cache / "photos.json"
    items, photos = _read(items_path), _read(photos_path)
    for qid in sorted({c.item for c in found if c.item} - items.keys()):
        doc = json.loads(_get(ENTITY_URL.format(qid)))
        entity = doc.get("entities", {}).get(qid) or next(iter(doc.get("entities", {}).values()))
        items[qid] = item_facts(entity)
        _write(items_path, items)
    sized = [c for c in found if all(size_of(c, items.get(c.item or "")))]
    wanted = sorted({t for c in sized for t in photo_titles(c, items.get(c.item or ""))})
    missing = [t for t in wanted if t not in photos]
    for k in range(0, len(missing), TITLES_PER_ASK):
        batch = missing[k : k + TITLES_PER_ASK]
        query = urllib.parse.urlencode(
            {
                "action": "query",
                "format": "json",
                "formatversion": "2",
                "prop": "imageinfo",
                "iiprop": "size|mime|url|extmetadata",
                "iiextmetadatafilter": "Artist|Credit|LicenseShortName",
                "titles": "|".join(batch),
            }
        )
        answer = json.loads(_get(f"{COMMONS_API}?{query}"))
        for page in answer.get("query", {}).get("pages", []):
            photo = photo_of(page)
            photos[page["title"]] = photo.__dict__ if photo else None
        for title in batch:
            # a title Commons does not know (a typo, a deleted file): none
            photos.setdefault(title, None)
        _write(photos_path, photos)
    chosen = 0
    for c in sized:
        pick = pick_photo(c, items, photos)
        if pick is None:
            continue
        dest = photo_file(cache, pick[0])
        if not dest.exists():
            time.sleep(PAUSE_S)
            net.download(pick[0].thumb, dest)
        chosen += 1
    print(f"{spec.site}: {len(found)} murals, {len(sized)} with a size, {chosen} with a photo")
    return chosen


def photo_file(cache: Path, photo: Photo) -> Path:
    """Where the fetch keeps a photo's thumbnail: named by its title and
    width, so a file replaced on Commons under a new size is fetched anew."""
    digest = hashlib.sha1(f"{photo.title} {photo.w}x{photo.h}".encode()).hexdigest()[:16]
    suffix = Path(urllib.parse.urlparse(photo.thumb).path).suffix.lower() or ".jpg"
    return cache / "photos" / f"{digest}{suffix}"


def pick_photo(c: Candidate, items: dict, photos: dict) -> tuple[Photo, float, float, str] | None:
    item = items.get(c.item or "")
    width, height = size_of(c, item)
    if not (width and height):
        return None
    known = [Photo(**photos[t]) for t in photo_titles(c, item) if photos.get(t)]
    return choose(width, height, c.line, known)


# --- on the wall ----------------------------------------------------------------------


@dataclass(frozen=True)
class Placed:
    """Where a mural hangs: its way along the wall (the outside on its
    right), the building, the highest ground in front of it and the lowest
    top of the walls behind it."""

    path: list[tuple[float, float]]
    of: str
    ground: float
    top: float


class Buildings:
    """A tile's LoD2: its footprints (for the wall's line) and walls (for
    their tops)."""

    def __init__(self, city: dict) -> None:
        self.city = city
        self.ids, self.polys = footprints(city)
        self.tree = shapely.STRtree(self.polys)
        scale = city.get("transform", {}).get("scale", [1, 1, 1])
        shift = city.get("transform", {}).get("translate", [0, 0, 0])
        self.vertices = np.asarray(city["vertices"], dtype=float) * scale + shift

    def nearest(self, g: shapely.Geometry) -> int | None:
        near = self.tree.query_nearest(g, max_distance=SNAP_M)
        return int(near[0]) if len(near) else None

    def wall_tops(self, oid: str) -> list[tuple[shapely.LineString, float]]:
        """The object's walls as (their line on the ground, their top)."""
        out = []
        for g in self.city["CityObjects"][oid].get("geometry", []):
            for ring in surface_rings(g, "WallSurface"):
                xyz = self.vertices[ring]
                xy = np.unique(np.round(xyz[:, :2], 2), axis=0)
                if len(xy) < 2:
                    continue
                # a wall's line: its two farthest corners seen from above
                d = np.linalg.norm(xy[:, None, :] - xy[None, :, :], axis=2)
                i, j = np.unravel_index(int(np.argmax(d)), d.shape)
                if d[i, j] < 0.5:
                    continue
                out.append((shapely.LineString([xy[i], xy[j]]), float(xyz[:, 2].max())))
        return out


def rings_of(poly: shapely.Geometry) -> list[shapely.LinearRing]:
    return [r for p in shapely.get_parts(poly) for r in (p.exterior, *p.interiors)]


def outside_on_right(path: list, poly: shapely.Geometry) -> list:
    """`path` turned so the footprint's outside lies on its right."""
    (ax, ay), (bx, by) = path[0], path[1]
    length = math.hypot(bx - ax, by - ay) or 1.0
    mx, my = (ax + bx) / 2, (ay + by) / 2
    right = shapely.Point(mx + (by - ay) / length * 0.2, my - (bx - ax) / length * 0.2)
    return path[::-1] if poly.contains(right) else path


def ring_way(ring: shapely.LinearRing, s0: float, s1: float) -> list[tuple[float, float]]:
    """The ring's vertices from distance s0 to s1 along it, the shorter way
    round."""
    length = ring.length
    ahead = (s1 - s0) % length
    if ahead <= length / 2:
        if s0 + ahead <= length:
            part = shapely.ops.substring(ring, s0, s0 + ahead)
            return list(part.coords)
        a = shapely.ops.substring(ring, s0, length)
        b = shapely.ops.substring(ring, 0, s0 + ahead - length)
        return [*a.coords, *list(b.coords)[1:]]
    return ring_way(ring, s1, s0)[::-1]


def straight_stretch(ring: shapely.LinearRing, s: float) -> tuple[float, float]:
    """The distances along `ring` where the straight stretch of wall
    through `s` begins and ends (edges turning less than STRAIGHT_DEG)."""
    xy = np.asarray(ring.coords)[:-1]
    n = len(xy)
    steps = np.linalg.norm(np.diff(np.vstack([xy, xy[:1]]), axis=0), axis=1)
    starts = np.concatenate([[0.0], np.cumsum(steps)])
    total = float(starts[-1])
    edge = min(int(np.searchsorted(starts, s, side="right")) - 1, n - 1)

    def heading(k: int) -> float:
        a, b = xy[k % n], xy[(k + 1) % n]
        return math.atan2(b[1] - a[1], b[0] - a[0])

    def straight(k: int) -> bool:
        """Whether edge k runs on in edge `edge`'s direction (a zero-length
        edge does)."""
        if steps[k % n] < 1e-6:
            return True
        d = abs(heading(k) - heading(edge)) % (2 * math.pi)
        return math.degrees(min(d, 2 * math.pi - d)) < STRAIGHT_DEG

    lo = hi = edge
    while hi - lo < n - 1 and straight(lo - 1):
        lo -= 1
    while hi - lo < n - 1 and straight(hi + 1):
        hi += 1
    begin = float(starts[lo % n]) - (total if lo < 0 else 0.0)
    end = float(starts[hi % n + 1]) + (total if hi >= n else 0.0)
    return begin, end


def place_point(p: shapely.Point, width: float, b: Buildings) -> tuple[list, int] | None:
    """The point's wall: the straight stretch nearest to it, the width
    centred on its projection and kept on the stretch."""
    i = b.nearest(p)
    if i is None:
        return None
    ring = min(rings_of(b.polys[i]), key=lambda r: r.distance(p))
    if ring.distance(p) > SNAP_M:
        return None
    s = ring.project(p)
    begin, end = straight_stretch(ring, s)
    if end - begin < width - 0.5:
        return None
    start = min(max(s - width / 2, begin), end - width) if end - begin >= width else begin
    stop = min(start + width, end)
    way = ring_way(ring, start % ring.length, stop % ring.length)
    return outside_on_right(way, b.polys[i]), i


def place_line(line: shapely.LineString, b: Buildings) -> tuple[list, int] | None:
    """The line's wall: its footprint's boundary from its first vertex's
    projection to its last's — every vertex within SNAP_M of it, the way
    along the wall about as long as the line."""
    i = b.nearest(line.interpolate(0.5, normalized=True))
    if i is None:
        return None
    ring = min(rings_of(b.polys[i]), key=lambda r: r.distance(line))
    if max(ring.distance(shapely.Point(xy)) for xy in line.coords) > SNAP_M:
        return None
    first, last = shapely.Point(line.coords[0]), shapely.Point(line.coords[-1])
    way = ring_way(ring, ring.project(first), ring.project(last))
    length = shapely.LineString(way).length if len(way) > 1 else 0.0
    if abs(length - line.length) > LINE_SLACK * line.length:
        return None
    return outside_on_right(way, b.polys[i]), i


def offset_path(path: list, by: float) -> list[tuple[float, float]]:
    """`path` moved `by` to its right (the wall's outside), each vertex
    along the mean of its segments' normals."""
    xy = np.asarray(path, dtype=float)
    seg = np.diff(xy, axis=0)
    seg /= np.linalg.norm(seg, axis=1)[:, None]
    normals = np.column_stack([seg[:, 1], -seg[:, 0]])
    at = np.vstack([normals[:1], normals[:-1] + normals[1:], normals[-1:]])
    at /= np.linalg.norm(at, axis=1)[:, None]
    moved = xy + at * by
    return [(round(float(x), 2), round(float(y), 2)) for x, y in moved]


def clean(path: list) -> list[tuple[float, float]]:
    """Without repeated vertices, and ending at a corner where it went round
    it by less than CORNER_M (a line mapped a little past its wall's end)."""
    out: list[tuple[float, float]] = []
    for x, y in path:
        if not out or math.hypot(x - out[-1][0], y - out[-1][1]) > 0.05:
            out.append((float(x), float(y)))

    def turned(a, b, c) -> bool:
        u = (b[0] - a[0], b[1] - a[1])
        v = (c[0] - b[0], c[1] - b[1])
        cos = (u[0] * v[0] + u[1] * v[1]) / ((math.hypot(*u) * math.hypot(*v)) or 1.0)
        return cos < math.cos(math.radians(45))

    while len(out) > 2 and math.dist(out[0], out[1]) < CORNER_M and turned(*out[:3]):
        out.pop(0)
    while len(out) > 2 and math.dist(out[-1], out[-2]) < CORNER_M and turned(*out[-3:][::-1]):
        out.pop()
    return out


def ground_along(path: list, dgm: Sampler) -> float | None:
    """The highest DGM1 sample in front of the wall along the path."""
    line = shapely.LineString(path)
    steps = max(2, int(line.length / GROUND_STEP_M) + 1)
    samples = []
    for k in range(steps):
        d = line.length * k / (steps - 1)
        a = line.interpolate(max(d - 0.5, 0))
        b = line.interpolate(min(d + 0.5, line.length))
        dx, dy = b.x - a.x, b.y - a.y
        n = math.hypot(dx, dy) or 1.0
        p = line.interpolate(d)
        samples.append((p.x + dy / n * FRONT_M, p.y - dx / n * FRONT_M))
    values = [float(v[0]) for v in dgm.sample(samples)]
    values = [v for v in values if v > -1000 and math.isfinite(v)]
    return max(values) if values else None


def wall_top(path: list, b: Buildings, oid: str) -> float | None:
    """The lowest top of the object's walls behind the path."""
    line = shapely.LineString(path)
    tops = [
        top
        for wall, top in b.wall_tops(oid)
        if wall.distance(line) < 0.5 and line.buffer(0.5).intersection(wall).length > 0.5
    ]
    return min(tops) if tops else None


def place(c: Candidate, width: float, b: Buildings, dgm: Sampler) -> Placed | None:
    placed = place_line(c.geom, b) if c.line else place_point(c.geom, width, b)
    if placed is None:
        return None
    path, i = placed
    path = clean(path)
    if len(path) < 2:
        return None
    ground = ground_along(path, dgm)
    top = wall_top(path, b, b.ids[i])
    if ground is None or top is None:
        return None
    return Placed(path, root_of(b.city, b.ids[i]), ground, top)


def heights_on(
    placed: Placed, height: float, min_height: float | None
) -> tuple[float, float] | None:
    """The mural's bottom and top (m above sea level)."""
    if min_height is not None:
        bottom = placed.ground + min_height
        return bottom, bottom + height
    room = placed.top - placed.ground
    if height > room + TALLER_M:
        return None
    bottom = placed.ground + min(max(room - height, 0.0), STOREY_M)
    return bottom, bottom + height


# --- the bake -------------------------------------------------------------------------


def run_site(spec) -> None:
    """Every mural of the site the rule takes, on its wall, from the fetch's
    caches; an empty file where it takes none."""
    out_dir = spec.data / "murals"
    pbf = spec.osm
    if not pbf.exists():
        print(f"{spec.site}: no OSM extract — murals left as they are (`bun run fetch`)")
        return
    cache = cache_dir(spec.raw)
    items, photos = _read(cache / "items.json"), _read(cache / "photos.json")
    found = candidates(pbf, site_extent(spec.tiles), spec.epsg)
    loaded: dict[str, Buildings | None] = {}
    murals, images = [], set()
    for c in found:
        pick = pick_photo(c, items, photos)
        if pick is None:
            continue
        photo, width, height, how = pick
        source = photo_file(cache, photo)
        if not source.exists():
            print(f"  {c.id} {c.name}: its photo is not fetched (`bun run fetch`)")
            continue
        hung = hang(c, width, spec.tiles, loaded)
        if hung is None:
            print(f"  {c.id} {c.name}: on no LoD2 wall")
            continue
        tile, placed = hung
        if c.line:
            width = shapely.LineString(placed.path).length
            height = width / photo.aspect if how == "band" else height
        span = heights_on(placed, height, metres(c.tags.get("min_height")))
        if span is None:
            print(f"  {c.id} {c.name}: taller than its wall")
            continue
        image, px = write_image(source, out_dir / f"{c.id}.webp", width, height, photo)
        images.add(image)
        murals.append(
            {
                "id": c.id,
                "name": c.name,
                "kind": c.kind,
                "tile": tile,
                "building": placed.of,
                "path": [list(p) for p in offset_path(placed.path, OFFSET_M)],
                "bottom": round(span[0], 2),
                "top": round(span[1], 2),
                "size": [round(width, 2), round(height, 2)],
                "how": how,
                "image": image,
                "px": px,
                "photo": {
                    "title": photo.title,
                    "author": photo.author,
                    "licence": photo.licence,
                    "url": photo.url,
                },
            }
        )
    for old in out_dir.glob("*.webp") if out_dir.exists() else []:
        if old.name not in images:
            old.unlink()
    _write_file(out_dir / "murals.json", {"attribution": ATTRIBUTION, "murals": murals})
    names = ", ".join(m["name"] or m["id"] for m in murals) or "none"
    print(f"{spec.site}: {len(murals)} of {len(found)} murals on their walls ({names})")


def _write_file(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")


def hang(c: Candidate, width: float, tiles, loaded: dict) -> tuple[str, Placed] | None:
    """The mural on a wall of the tile that owns it, else of a tile beside
    it (a building whose LoD2 the neighbour holds)."""
    centre = c.geom.centroid
    near = sorted(
        (t for t in tiles if shapely.box(*t.bounds).distance(centre) <= SNAP_M + width),
        key=lambda t: not owns(t.bounds, centre.x, centre.y),
    )
    for tile in near:
        if tile.id not in loaded:
            loaded[tile.id] = (
                Buildings(json.loads(tile.cityjson.read_text())) if tile.cityjson.exists() else None
            )
        b = loaded[tile.id]
        if b is None or not tile.dgm.exists():
            continue
        with rasterio.open(tile.dgm) as ds:
            placed = place(c, width, b, Sampler(ds))
        if placed is not None:
            return tile.id, placed
    return None


def write_image(source: Path, dest: Path, width: float, height: float, photo: Photo):
    """The photo stretched to the mural's size as a WebP: (file name,
    [width, height] in pixels)."""
    with Image.open(source) as img:
        rgb = img.convert("RGB")
        px_w = int(min(MAX_PX, round(width * PX_PER_M), rgb.width))
        px_h = max(1, round(px_w * height / width))
        # a band photo already has the mural's shape; a whole one is
        # stretched by at most FIT
        rgb = rgb.resize((px_w, px_h), Image.Resampling.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        rgb.save(dest, "WEBP", quality=85, method=6)
    return dest.name, [px_w, px_h]
