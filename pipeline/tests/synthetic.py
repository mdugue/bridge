"""A synthetic tile for the OSM bakes' tests: 200 m square, a flat DGM, a
class raster painted by the test, and an OSM XML extract built from nodes
given in metres from the tile's south-west corner."""

from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer

from bake.common import Tile

X0, Y0 = 411000.0, 5656000.0
SIZE = 200


def osm_tile(
    tmp_path,
    monkeypatch,
    nodes: dict[int, tuple[float, float, str]],
    ways: str = "",
    classes: np.ndarray | None = None,
    dgm: float = 100.0,
) -> Tile:
    """`nodes` maps an id to (x, y, tags as `<tag .../>` XML); `classes` is
    the 200 × 200 class raster (row 0 = north), all 0 when omitted."""
    tile = Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")
    tile.dgm.parent.mkdir(parents=True)
    with rasterio.open(
        tile.dgm,
        "w",
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(SIZE),
    ) as dst:
        dst.write(np.full((SIZE, SIZE), dgm, dtype="float32"), 1)
    cls = classes if classes is not None else np.zeros((SIZE, SIZE), np.uint8)
    Image.fromarray(cls.astype(np.uint8)).save(tile.out("dlm", "landcover_t.png"))
    back = Transformer.from_crs(25833, 4326, always_xy=True)
    xml = []
    for i, (px, py, tags) in nodes.items():
        lon, lat = back.transform(X0 + px, Y0 + py)
        xml.append(f'<node id="{i}" lat="{lat:.9f}" lon="{lon:.9f}" version="1">{tags}</node>')
    osm = tmp_path / "raw" / "osm" / "t.osm"
    osm.parent.mkdir(parents=True)
    osm.write_text(f'<?xml version="1.0"?><osm version="0.6">{"".join(xml)}{ways}</osm>')
    monkeypatch.setattr(Tile, "osm_extract", lambda self: osm)
    return tile


def way(way_id: int, refs: list[int], tags: dict[str, str]) -> str:
    nds = "".join(f'<nd ref="{r}"/>' for r in refs)
    kv = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
    return f'<way id="{way_id}" version="1">{nds}{kv}</way>'


def tags(**kv: str) -> str:
    return "".join(f'<tag k="{k.replace("__", ":")}" v="{v}"/>' for k, v in kv.items())


def read(tile: Tile, name: str) -> dict:
    return json.loads((tile.data / "dlm" / f"{name}_t.geojson").read_text())


def local(coords) -> tuple[float, float]:
    """A written coordinate back in metres from the tile's corner."""
    return round(coords[0] - X0, 1), round(coords[1] - Y0, 1)
