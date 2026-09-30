"""Municipal street-tree registers a site can name (`Site.treeCadastre`).

`bun run fetch` caches the register over each tile (plus a margin) as
`<raw>/trees/<tile>.geojson`, with a sidecar recording the request, the
date and the server's count; the `trees` step (trees.py) turns it into the
tile's inventory trees. A register is its WFS query and, in trees.py, its
field mapping — trees.py reads Dresden's schema (`gis_x_utm`,
`art_botanisch`, …), so another city needs both.
"""

from __future__ import annotations

import datetime
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .common import Tile

MARGIN = 10  # m: a tree on the seam lands in both requests


@dataclass(frozen=True)
class Register:
    """A WFS 2.0 feature type serving the register as GeoJSON."""

    service: str
    params: dict[str, str]
    type_name: str

    def query(self, bounds: tuple[float, ...], epsg: int, **extra: str) -> str:
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
            "TypeNames": self.type_name,
            "BBOX": bbox,
            **extra,
        }
        return f"{self.service}?{urllib.parse.urlencode(params)}"


REGISTERS = {
    # Dresden's "Stadtbäume" (dl-de/by-2-0, Landeshauptstadt Dresden). The
    # service implements no paging and no count default, so one request
    # returns every tree; the cache is trusted only when its feature count
    # equals the server's numberMatched.
    "dresden": Register(
        "https://kommisdd.dresden.de/net3/public/ogcsl.ashx",
        {"NODEID": "1633"},
        "cls:L1261",
    ),
}


def _complete(raw_path: Path, meta_path: Path) -> bool:
    try:
        doc = json.loads(raw_path.read_text())
        meta = json.loads(meta_path.read_text())
    except (OSError, ValueError):
        return False
    feats = doc.get("features")
    return isinstance(feats, list) and len(feats) == meta.get("numberMatched")


def fetch(tile: Tile) -> None:
    """The site's register over the tile, unless a complete copy is cached.
    A failure is a note: without it the `trees` step writes nothing."""
    if tile.tree_cadastre is None:
        return
    register = REGISTERS[tile.tree_cadastre.id]
    out = tile.raw / "trees"
    raw_path = out / f"{tile.id}.geojson"
    meta_path = out / f"{tile.id}.meta.json"
    if _complete(raw_path, meta_path):
        return
    out.mkdir(parents=True, exist_ok=True)
    try:
        hits = register.query(tile.bounds, tile.epsg, resultType="hits")
        with urllib.request.urlopen(hits, timeout=300) as res:
            m = re.search(r'numberMatched="(\d+)"', res.read().decode("utf-8", "replace"))
        if not m:
            print(f"{tile.id}: tree cadastre hits request failed — no inventory trees")
            return
        query = register.query(tile.bounds, tile.epsg, outputFormat="application/geo+json")
        with urllib.request.urlopen(query, timeout=300) as res:
            raw_path.write_bytes(res.read())
    except OSError as err:
        print(f"{tile.id}: tree cadastre not downloaded ({err})")
        return
    meta_path.write_text(
        json.dumps(
            {
                "service": register.service,
                "typeName": register.type_name,
                "bounds": list(tile.bounds),
                "outputFormat": "application/geo+json",
                "numberMatched": int(m.group(1)),
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
    print(f"{tile.id}: tree cadastre → {raw_path}")
