"""Municipal street-tree registers a site can name (`Site.treeCadastre`).

A register is data, not code: its WFS query (service, feature types, output
format, CRS) and its field mapping (`Fields`: which property holds the
taxon, the height, the crown, the trunk …). `bun run fetch` caches the
register over each tile (plus a margin) as `<raw>/trees/<tile>.geojson` —
one FeatureCollection, the feature types merged — with a sidecar recording
the request, the date and the server's count; the `trees` step (trees.py)
reads it through the mapping into one record per tree.

Every service here answers a bounding box in one response (no paging: their
CountDefault is unlimited or larger than a tile holds); the cache is trusted
only when its feature count equals the server's `numberMatched` for the
same request, summed over the feature types.
"""

from __future__ import annotations

import datetime
import json
import re
import ssl
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from .common import Tile

MARGIN = 10  # m: a tree on the seam lands in both requests


@dataclass(frozen=True)
class Fields:
    """Where a register keeps what the bake reads. Each name is a feature
    property; a tuple is tried in order, the first non-empty value wins."""

    # the botanical name ("Acer platanoides 'Columnare'"); cultivar first
    taxon: tuple[str, ...]
    # the German name (the archetype table reads "Säulen-", "Kugel-", "Blut-")
    german: tuple[str, ...] = ()
    height: str | None = None  # m; None: the register measures no height
    crown: str | None = None  # crown diameter, m
    trunk_diameter: str | None = None  # at breast height, cm
    trunk_circumference: str | None = None  # cm; read when no diameter is
    planted: str | None = None  # planting year (an int or a numeric string)
    felled: str | None = None  # a value here: the tree is gone
    # for the inquiry card (ADR 0042; trees.py `cadastre_facts`): where the
    # tree stands (a street or a park), its number there, its age in years
    # and the date its record was last changed
    place: str | None = None
    number: str | None = None
    age: str | None = None
    recorded: str | None = None
    # the position as two properties in the tile's CRS; None: the geometry's
    # (first) point, which must then be in the tile's CRS
    position: tuple[str, str] | None = None
    # taxon values that are no tree
    not_trees: frozenset[str] = field(default_factory=lambda: frozenset({"Stammstück"}))


@dataclass(frozen=True)
class Register:
    """A WFS 2.0 service serving the register as GeoJSON."""

    service: str
    params: dict[str, str]
    type_names: tuple[str, ...]
    fields: Fields
    epsg: int  # the CRS the BBOX is asked in and the positions come in
    output_format: str = "application/geo+json"
    # the server's root CA is missing from the system bundle: add certifi's
    certifi: bool = False

    def query(self, type_name: str, bounds: tuple[float, ...], epsg: int, **extra: str) -> str:
        xmin, ymin, xmax, ymax = bounds
        m = MARGIN
        bbox = (
            f"{xmin - m:.0f},{ymin - m:.0f},{xmax + m:.0f},{ymax + m:.0f},"
            f"urn:ogc:def:crs:EPSG::{epsg}"
        )
        params = {
            **self.params,
            "Service": "WFS",
            "Version": "2.0.0",
            "Request": "GetFeature",
            "TypeNames": type_name,
            "BBOX": bbox,
            **extra,
        }
        return f"{self.service}?{urllib.parse.urlencode(params)}"


REGISTERS = {
    # Dresden's "Stadtbäume" (dl-de/by-2-0, Landeshauptstadt Dresden). The
    # geometry comes in WGS84; the UTM position is in two properties
    # (verified to µm against the geometry). The trunk is a diameter.
    "dresden": Register(
        "https://kommisdd.dresden.de/net3/public/ogcsl.ashx",
        {"NODEID": "1633"},
        ("cls:L1261",),
        Fields(
            taxon=("art_botanisch",),
            german=("art_deutsch",),
            height="baumhoehe_akt",
            crown="kronendurchmesser_akt",
            trunk_diameter="stammdurchmesser_akt",
            position=("gis_x_utm", "gis_y_utm"),
            place="name",
            number="standort_nr",
            age="jalter",
            recorded="aend_dat",
        ),
        25833,
    ),
    # Hamburg's Straßenbaumkataster (dl-de/by-2-0, BUKEA): street trees only,
    # MultiPoint geometry. It records no height — trees.py measures one in
    # the surface model. GeoJSON only as application/geo+json.
    "hamburg": Register(
        "https://geodienste.hamburg.de/HH_WFS_Strassenbaumkataster",
        {},
        ("de.hh.up:strassenbaumkataster",),
        Fields(
            taxon=("sorte_latein", "art_latein", "gattung_latein"),
            german=("sorte_deutsch", "art_deutsch", "gattung_deutsch"),
            crown="kronendurchmesser",
            trunk_circumference="stammumfang",
            planted="pflanzjahr",
        ),
        25832,
    ),
    # Leipzig's Baumkataster (dl-de/by-2-0, Amt für Stadtgrün und Gewässer):
    # street and park trees, felled ones kept with a date.
    "leipzig": Register(
        "https://geodienste.leipzig.de/l3/OpenData/Baeume/wfs",
        {},
        ("OpenData:Baeume",),
        Fields(
            taxon=("ga_lang_wiss", "gattung"),
            german=("ga_lang_deutsch",),
            height="baumhoehe",
            crown="kr_durchm",
            trunk_diameter="st_durchm",
            trunk_circumference="st_umfang",
            planted="pflanzjahr",
            felled="gefaellt_am",
            # a stand of trees mapped as one point: the canopy draws it
            not_trees=frozenset({"Stammstück", "Bestandsfläche", "waldartiger Bestand"}),
        ),
        25833,
        output_format="application/json",
    ),
    # Berlin's Baumbestand (dl-de/zero-2-0, Geoportal Berlin): street trees
    # and the trees of the parks ("Anlagen"), two feature types.
    "berlin": Register(
        "https://gdi.berlin.de/services/wfs/baumbestand",
        {},
        ("baumbestand:strassenbaeume", "baumbestand:anlagenbaeume"),
        Fields(
            taxon=("art_bot", "gattung"),
            german=("art_dtsch", "gattung_deutsch"),
            height="baumhoehe",
            crown="kronedurch",
            trunk_circumference="stammumfg",
            planted="pflanzjahr",
        ),
        25833,
        output_format="application/json",
        certifi=True,
    ),
}


def register_of(tile: Tile) -> Register | None:
    return REGISTERS[tile.tree_cadastre.id] if tile.tree_cadastre else None


@cache
def _ssl_context(certifi: bool) -> ssl.SSLContext:
    """The system trust (with the proxy's CA where there is one), plus
    certifi's bundle for a server whose root only that has. Verification
    stays on either way."""
    ctx = ssl.create_default_context()
    if certifi:
        import certifi as bundle  # rasterio's and pyproj's dependency

        ctx.load_verify_locations(bundle.where())
    return ctx


def _open(register: Register, url: str):
    return urllib.request.urlopen(url, timeout=300, context=_ssl_context(register.certifi))


def _complete(raw_path: Path, meta_path: Path) -> bool:
    try:
        doc = json.loads(raw_path.read_text())
        meta = json.loads(meta_path.read_text())
    except (OSError, ValueError):
        return False
    feats = doc.get("features")
    return isinstance(feats, list) and len(feats) == meta.get("numberMatched")


def _hits(register: Register, type_name: str, tile: Tile) -> int | None:
    with _open(register, register.query(type_name, tile.bounds, tile.epsg, resultType="hits")) as r:
        m = re.search(r'numberMatched="(\d+)"', r.read().decode("utf-8", "replace"))
    return int(m.group(1)) if m else None


def _features(register: Register, type_name: str, tile: Tile) -> list:
    url = register.query(type_name, tile.bounds, tile.epsg, outputFormat=register.output_format)
    with _open(register, url) as res:
        return json.loads(res.read()).get("features") or []


def fetch(tile: Tile) -> None:
    """The site's register over the tile, unless a complete copy is cached.
    A failure is a note: without it the `trees` step writes nothing."""
    register = register_of(tile)
    if register is None:
        return
    if register.epsg != tile.epsg:
        print(f"{tile.id}: the tree cadastre is in EPSG:{register.epsg}, the tile is not")
        return
    out = tile.raw / "trees"
    raw_path = out / f"{tile.id}.geojson"
    meta_path = out / f"{tile.id}.meta.json"
    if _complete(raw_path, meta_path):
        return
    out.mkdir(parents=True, exist_ok=True)
    matched, features = 0, []
    try:
        for type_name in register.type_names:
            n = _hits(register, type_name, tile)
            if n is None:
                print(f"{tile.id}: tree cadastre hits request failed — no inventory trees")
                return
            matched += n
            features += _features(register, type_name, tile)
    except (OSError, ValueError) as err:
        print(f"{tile.id}: tree cadastre not downloaded ({err})")
        return
    raw_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    meta_path.write_text(
        json.dumps(
            {
                "service": register.service,
                "typeNames": list(register.type_names),
                "bounds": list(tile.bounds),
                "outputFormat": register.output_format,
                "numberMatched": matched,
                "retrieved": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
                "licence": tile.tree_cadastre.credit,
            },
            indent=2,
        )
    )
    if not _complete(raw_path, meta_path):
        raw_path.unlink(missing_ok=True)
        print(f"{tile.id}: the tree cadastre response is incomplete — retry later")
        return
    print(f"{tile.id}: tree cadastre → {raw_path} ({matched} trees)")
