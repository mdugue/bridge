"""The traffic counts a site can name (`Site.dataLayers.traffic`).

A source is where the counted motor traffic of a place is published and how
one of its rows reads: its fetch (a WFS answering GeoJSON or GML, or a
statewide shapefile) and its mapping onto the bake's section record
(traffic.py: `f`/`b` vehicles per day along / against the line, `t` the
total, the heavy share, the year, the street, the bridge flag). `bun run
fetch` caches the source over each tile (plus a margin) as
`<raw>/traffic/<tile>.geojson`, in the tile's CRS, with a sidecar recording
the request, the date and the count; the `traffic` step reads it through the
mapping.

The sources differ in what they count, and the record says so:

- Dresden counts each direction of a section (the city's own counts, mostly
  every street with traffic of note).
- Berlin, Hamburg and the Länder's road censuses (Saxony's SVZ for the
  federal, state and district roads outside the cities' own networks, NRW's
  Verkehrswerte) count both directions together. A two-way road's total is
  split evenly between its directions (`sp` 1), which a one-way couplet
  would not be; the sources say nothing of one-way roads.
- A census counts its roads only: in a city centre the Land's network
  barely reaches (Leipzig's and Munich's are the cities' own roads), so
  those sites name no source.
"""

from __future__ import annotations

import datetime
import json
import re
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pyogrio
import shapely

from .common import Tile
from .net import download, fetch_text

MARGIN = 50  # m: a section on the seam lands in both requests


def _count(value) -> int | None:
    """A positive count, or None (−1, 0, "" and the like mean "not counted")."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return round(v) if v > 0 else None


def _share(heavy, total: int | None) -> float | None:
    """A heavy-goods count as a share of `total`, clamped to 0..1."""
    h = _count(heavy)
    if total is None or h is None:
        return None
    return round(min(h / total, 1.0), 3)


def _percent(value) -> float | None:
    """A heavy-goods percentage ("6.9", 6) as a share, clamped to 0..1."""
    try:
        v = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None
    return round(min(max(v / 100, 0.0), 1.0), 3) if v >= 0 else None


BRIDGE = re.compile(r"brücke$", re.IGNORECASE)


def split_total(total: int, heavy: float | None, year: int | None, name: str = "") -> dict:
    """A section counted for both directions together: the total split
    evenly between them (`sp` 1), the heavy share the same both ways."""
    props: dict = {"t": total, "f": max(total - total // 2, 1), "b": max(total // 2, 1), "sp": 1}
    if props["f"] + props["b"] > total:  # a total of 1: one direction
        del props["b"]
    if heavy is not None:
        props["hf"] = props["hb"] = heavy
    if year is not None:
        props["y"] = year
    props["m"] = "census"
    if name:
        props["n"] = name
        if BRIDGE.search(name):
            props["br"] = 1
    return props


# --- the mappings: one source row → the section record, or None ------------


def berlin_props(q: dict) -> dict | None:
    """Berlin's Verkehrsmengen 2023: `dtvw_kfz` the vehicles per working
    day (both directions; the lorries are a layer of their own and not
    joined: the share is left out)."""
    total = _count(q.get("dtvw_kfz"))
    if not total:
        return None
    return split_total(total, None, 2023, str(q.get("str_name") or "").strip())


def hamburg_props(q: dict) -> dict | None:
    """Hamburg's Verkehrsmengen 2019 on the main roads: `dtv` (both
    directions, rounded to the thousand), `sv` the heavy share in %."""
    total = _count(q.get("dtv"))
    if not total:
        return None
    return split_total(total, _percent(q.get("sv")), 2019)


def saxony_svz_props(q: dict) -> dict | None:
    """Saxony's road census 2021 (SVZ): `dtv_kfzges` both directions,
    `sv_kfz` the heavy share in %, `strasse` the road's number ("B 107")."""
    total = _count(q.get("dtv_kfzges"))
    if not total:
        return None
    year = _count(q.get("jahr"))
    return split_total(total, _percent(q.get("sv_kfz")), year, str(q.get("strasse") or ""))


def nrw_props(q: dict) -> dict | None:
    """NRW's Verkehrswerte (Straßen.NRW): `DTVKFZA` all days, both
    directions; `DTVSVA` the heavy vehicles of it; `STRBEZ` the road."""
    total = _count(q.get("DTVKFZA"))
    if not total:
        return None
    return split_total(total, _share(q.get("DTVSVA"), total), None, str(q.get("STRBEZ") or ""))


# --- the fetches: the source over a tile, as GeoJSON features in its CRS ----


def _bbox(tile: Tile, epsg: int | None = None) -> str:
    xmin, ymin, xmax, ymax = tile.bounds
    m = MARGIN
    crs = epsg or tile.epsg
    return (
        f"{xmin - m:.0f},{ymin - m:.0f},{xmax + m:.0f},{ymax + m:.0f},urn:ogc:def:crs:EPSG::{crs}"
    )


@dataclass(frozen=True)
class Wfs:
    """A WFS 2.0 answering GeoJSON in the tile's CRS (no paging: one
    request a tile, trusted when its count equals the server's
    `numberMatched`)."""

    service: str
    type_name: str
    params: tuple[tuple[str, str], ...] = ()
    output_format: str = "application/geo+json"
    srs_name: bool = False  # ask for the tile's CRS explicitly

    def url(self, tile: Tile, **extra: str) -> str:
        params = {
            **dict(self.params),
            "Service": "WFS",
            "Version": "2.0.0",
            "Request": "GetFeature",
            "TypeNames": self.type_name,
            "BBOX": _bbox(tile),
            **({"srsName": f"urn:ogc:def:crs:EPSG::{tile.epsg}"} if self.srs_name else {}),
            **extra,
        }
        return f"{self.service}?{urllib.parse.urlencode(params)}"

    def __call__(self, tile: Tile, raw: Path) -> tuple[list[dict], dict]:
        hits = fetch_text(self.url(tile, resultType="hits"))
        m = re.search(r'numberMatched="(\d+)"', hits)
        doc = json.loads(fetch_text(self.url(tile, outputFormat=self.output_format)))
        features = doc.get("features") or []
        if m and len(features) != int(m.group(1)):
            raise OSError(f"{len(features)} features of {m.group(1)} — retry later")
        return features, {"service": self.service, "typeName": self.type_name}


@dataclass(frozen=True)
class WfsGml:
    """A WFS 2.0 that answers GML only (MapServer): the answer is read by
    GDAL's GML driver."""

    service: str
    type_name: str

    def __call__(self, tile: Tile, raw: Path) -> tuple[list[dict], dict]:
        params = {
            "Service": "WFS",
            "Version": "2.0.0",
            "Request": "GetFeature",
            "TypeNames": self.type_name,
            "BBOX": _bbox(tile),
        }
        part = raw / "traffic" / f"{tile.id}.gml.part"
        part.parent.mkdir(parents=True, exist_ok=True)
        part.write_text(fetch_text(f"{self.service}?{urllib.parse.urlencode(params)}"))
        try:
            features = _read_vector(str(part), None)
        finally:
            part.unlink(missing_ok=True)
        return features, {"service": self.service, "typeName": self.type_name}


@dataclass(frozen=True)
class Shapefile:
    """A statewide shapefile in a ZIP, downloaded once into the provider's
    `downloads/` and read over the tile's box."""

    url: str
    member: str

    def __call__(self, tile: Tile, raw: Path) -> tuple[list[dict], dict]:
        zip_path = download(self.url, raw / "downloads" / self.url.rsplit("/", 1)[-1])
        xmin, ymin, xmax, ymax = tile.bounds
        box = (xmin - MARGIN, ymin - MARGIN, xmax + MARGIN, ymax + MARGIN)
        features = _read_vector(f"/vsizip/{zip_path}/{self.member}", box)
        return features, {"download": self.url, "member": self.member}


def _plain(value):
    """A numpy scalar (or anything else) as plain JSON."""
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value


def _read_vector(path: str, bbox) -> list[dict]:
    meta, _, geoms, fields = pyogrio.raw.read(path, bbox=bbox)
    names = list(meta["fields"])
    out = []
    for i, wkb in enumerate(geoms):
        if wkb is None:
            continue
        geom = shapely.from_wkb(wkb)
        props = {n: _plain(fields[j][i]) for j, n in enumerate(names)}
        out.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": shapely.geometry.mapping(geom),
            }
        )
    return out


@dataclass(frozen=True)
class Source:
    """A place's traffic counts: how to fetch them over a tile and how a
    row maps onto the section record."""

    fetch: Callable[[Tile, Path], tuple[list[dict], dict]]
    props: Callable[[dict], dict | None]
    attribution: str
    epsg: int  # the CRS the fetch answers in (the tile's)
    # the property that orders the sections (a re-bake diffs by what changed)
    key: str | None = None


def _dresden_props(q: dict) -> dict | None:
    from .traffic import section_props  # the city's own record, traffic.py

    return section_props(q)


SOURCES: dict[str, Source] = {
    # Dresden's counted traffic (Verkehrsbelegung, Straßen- und Tiefbauamt;
    # dl-de/by-2-0): each direction of each section. The city's WFS, asked
    # for in the tile's CRS (its default answer is WGS84).
    "dresden": Source(
        Wfs(
            "https://kommisdd.dresden.de/net3/public/ogcsl.ashx",
            "cls:L363",
            (("NODEID", "0"),),
            srs_name=True,
        ),
        _dresden_props,
        "Verkehrsmengen © Landeshauptstadt Dresden (dl-de/by-2-0)",
        25833,
        key="sta_id",
    ),
    # Berlin's Verkehrsmengen 2023 (Senatsverwaltung für Mobilität,
    # Verkehr, Klimaschutz und Umwelt; dl-de/zero-2-0): the main road
    # network, vehicles per working day, both directions together.
    "berlin": Source(
        Wfs(
            "https://gdi.berlin.de/services/wfs/verkehrsmengen_2023",
            "verkehrsmengen_2023:dtvw2023kfz",
            output_format="application/json",
        ),
        berlin_props,
        "Verkehrsmengen 2023 © Senatsverwaltung für Mobilität, Verkehr, Klimaschutz"
        " und Umwelt Berlin (dl-de/zero-2-0)",
        25833,
        key="link_id",
    ),
    # Hamburg's Verkehrsmengen 2019 on the main roads (Behörde für Verkehr
    # und Mobilitätswende; dl-de/by-2-0), both directions together.
    "hamburg": Source(
        Wfs(
            "https://geodienste.hamburg.de/HH_WFS_Verkehrsmengen",
            "de.hh.up:verkehrsmengen_dtv_hvs_2019",
        ),
        hamburg_props,
        "Verkehrsmengen 2019 © Freie und Hansestadt Hamburg, Behörde für Verkehr"
        " und Mobilitätswende (dl-de/by-2-0)",
        25832,
    ),
    # Saxony's road census 2021 (SVZ; Landesamt für Straßenbau und Verkehr;
    # dl-de/by-2-0): the federal, state and district roads outside the
    # cities' own networks, both directions together.
    "saxony-svz": Source(
        Shapefile(
            "https://www.list.smwa.sachsen.de/gdi/download/DE-SN-SBV-SVZ2021.zip", "SVZ2021.shp"
        ),
        saxony_svz_props,
        "Straßenverkehrszählung 2021 © Freistaat Sachsen, LASuV (dl-de/by-2-0)",
        25833,
        key="nummer",
    ),
    # NRW's Verkehrswerte (Straßen.NRW; dl-de/by-2-0): the federal, state
    # and district roads, both directions together.
    "nrw": Source(
        WfsGml("https://www.wfs.nrw.de/wfs/strassen_nrw", "ms:Verkehrswerte"),
        nrw_props,
        "Verkehrswerte © Straßen.NRW (dl-de/by-2-0)",
        25832,
        key="ABS",
    ),
}


def source_of(tile: Tile) -> Source | None:
    return SOURCES[tile.traffic] if tile.traffic else None


def raw_path(tile: Tile) -> Path:
    return tile.raw / "traffic" / f"{tile.id}.geojson"


def fetch(tile: Tile) -> None:
    """The site's traffic counts over the tile, unless a copy is cached. A
    failure is a note: without it the `traffic` step writes nothing."""
    source = source_of(tile)
    if source is None:
        return
    if source.epsg != tile.epsg:
        print(f"{tile.id}: the traffic counts are in EPSG:{source.epsg}, the tile is not")
        return
    path = raw_path(tile)
    meta_path = path.with_suffix(".meta.json")
    if path.exists() and meta_path.exists():
        return
    try:
        features, request = source.fetch(tile, tile.raw)
    except (OSError, ValueError) as err:
        print(f"{tile.id}: traffic counts not downloaded ({err})")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    meta_path.write_text(
        json.dumps(
            {
                "source": tile.traffic,
                **request,
                "bounds": list(tile.bounds),
                "count": len(features),
                "retrieved": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
                "licence": source.attribution,
            },
            indent=2,
        )
    )
    print(f"{tile.id}: traffic counts → {path} ({len(features)} sections)")
