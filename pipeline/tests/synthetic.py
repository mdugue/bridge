"""A synthetic tile for the OSM bakes' tests: 200 m square, a flat DGM, a
class raster painted by the test, and an OSM XML extract built from nodes
given in metres from the tile's south-west corner; and the fixtures more
than one test file builds on that tile (rasters, DLM layers, LoD2 blocks).
Test files share helpers only through this module, never by importing
each other."""

from __future__ import annotations

import json

import numpy as np
import pyogrio.raw
import rasterio
import rasterio.transform
import shapely
import shapely.geometry
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
    tile = Tile(
        "t",
        (X0, Y0, X0 + SIZE, Y0 + SIZE),
        25833,
        tmp_path / "raw",
        tmp_path / "data",
        credit="Quelle: GeoSN, dl-de/by-2-0",
    )
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


def neighbour(tile: Tile, tile_id: str, dx: float = SIZE, dy: float = 0.0) -> Tile:
    """A second tile beside `tile` (sharing its raw and data folders), with a
    flat DGM so the site's tile list (Tile.neighbours) finds it."""
    xmin, ymin, _, _ = tile.bounds
    other = Tile(
        tile_id,
        (xmin + dx, ymin + dy, xmin + dx + SIZE, ymin + dy + SIZE),
        25833,
        tile.raw,
        tile.data,
    )
    other.dgm.parent.mkdir(parents=True)
    with rasterio.open(
        other.dgm,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=other.transform(2),
    ) as dst:
        dst.write(np.full((2, 2), 100.0, dtype="float32"), 1)
    return other


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


def slope_tile(tmp_path, monkeypatch, ways: str):
    """A 200 m tile with a DGM that rises 4 m between y = 80 and y = 100 and
    an OSM XML extract holding `ways` over nodes 1–6: the flight's ends (1, 2),
    and the corners of a 6 m × 30 m outline around it (3–6)."""
    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    tile.dgm.parent.mkdir(parents=True)
    rows = np.arange(200)[:, None] + 0.5  # row 0 = north
    y = 200 - rows
    z = np.broadcast_to(100 + 4 * np.clip((y - 80) / 20, 0, 1), (200, 200)).astype("float32")
    with rasterio.open(
        tile.dgm,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(200),
    ) as dst:
        dst.write(z, 1)
    back = Transformer.from_crs(25833, 4326, always_xy=True)
    pts = [(100, 105), (100, 75), (97, 75), (103, 75), (103, 105), (97, 105)]
    nodes = "".join(
        f'<node id="{i + 1}" lat="{lat:.9f}" lon="{lon:.9f}" version="1"/>'
        for i, (px, py) in enumerate(pts)
        for lon, lat in [back.transform(x0 + px, y0 + py)]
    )
    osm = tmp_path / "raw" / "osm" / "t.osm"
    osm.parent.mkdir(parents=True)
    osm.write_text(f'<?xml version="1.0"?><osm version="0.6">{nodes}{ways}</osm>')
    monkeypatch.setattr(Tile, "osm_extract", lambda self: osm)
    return tile


def osm_nodes(first_id: int, pts) -> str:
    """OSM XML nodes at tile-local metres (the `slope_tile` origin), with tags."""
    back = Transformer.from_crs(25833, 4326, always_xy=True)
    out = []
    for i, (px, py, tags) in enumerate(pts):
        lon, lat = back.transform(411000.0 + px, 5656000.0 + py)
        body = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
        out.append(
            f'<node id="{first_id + i}" lat="{lat:.9f}" lon="{lon:.9f}" version="1">{body}</node>'
        )
    return "".join(out)


def box_solid(x0, y0, x1, y1, z0, z1) -> tuple[list[list[float]], list]:
    """Vertices and faces of an axis-aligned block: ground, roof, four walls."""
    v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]
    v += [[x, y, z1] for x, y, _ in v]
    faces = [[[0, 3, 2, 1]], [[4, 5, 6, 7]], [[0, 1, 5, 4]], [[1, 2, 6, 5]], [[2, 3, 7, 6]]]
    faces += [[[3, 0, 4, 7]]]
    return v, faces


def blocks_city(blocks: dict[str, tuple]) -> dict:
    """A CityJSON of axis-aligned buildings (id → x0, y0, x1, y1, height),
    given in metres from (X0, Y0), each a child of a root `<id>-root`."""
    verts, objs = [], {}
    for oid, (x0, y0, x1, y1, h) in blocks.items():
        v, faces = box_solid(X0 + x0, Y0 + y0, X0 + x1, Y0 + y1, 100.0, 100.0 + h)
        base = len(verts)
        verts += v
        shells = [[[i + base for i in ring] for ring in face] for face in faces]
        objs[oid] = {
            "type": "BuildingPart",
            "parents": [f"{oid}-root"],
            "geometry": [
                {
                    "type": "Solid",
                    "lod": "2",
                    "boundaries": [shells],
                    "semantics": {
                        "surfaces": [
                            {"type": "GroundSurface"},
                            {"type": "RoofSurface"},
                            {"type": "WallSurface"},
                        ],
                        "values": [[0, 1, 2, 2, 2, 2]],
                    },
                }
            ],
        }
        objs[f"{oid}-root"] = {"type": "Building", "children": [oid]}
    return {
        "type": "CityJSON",
        "transform": {"scale": [0.001, 0.001, 0.001], "translate": [0, 0, 0]},
        "CityObjects": objs,
        "vertices": [[round(c * 1000) for c in p] for p in verts],
    }


def write_raster(path, data: np.ndarray, res: float = 1.0, dtype=None) -> None:
    """A GeoTIFF over the synthetic tile from its north-west corner: one band
    from a 2-D array, or one per plane of a 3-D one, at `res` metres."""
    path.parent.mkdir(parents=True, exist_ok=True)
    bands = data[None] if data.ndim == 2 else data
    dtype = dtype or bands.dtype
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=bands.shape[2],
        height=bands.shape[1],
        count=bands.shape[0],
        dtype=dtype,
        crs="EPSG:25833",
        transform=rasterio.transform.from_origin(X0, Y0 + SIZE, res, res),
    ) as dst:
        dst.write(bands.astype(dtype))


def crowns(spots: list[tuple[float, float, float]], radius: float = 2.0) -> np.ndarray:
    """An nDOM of round crowns (x, y, height in EPSG metres) on the tile's
    1 m grid."""
    cx = X0 + np.arange(SIZE) + 0.5
    cy = Y0 + SIZE - np.arange(SIZE) - 0.5
    gx, gy = np.meshgrid(cx, cy)
    out = np.zeros((SIZE, SIZE))
    for x, y, h in spots:
        out = np.maximum(out, h * np.clip(1 - np.hypot(gx - x, gy - y) / (2 * radius), 0, 1))
    return out


def shapefile(path, geoms, fields: dict[str, list[str]], kind: str = "LineString") -> None:
    """A DLM layer as the bakes read it: `geoms` with the given attributes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    pyogrio.raw.write(
        path,
        np.array([shapely.to_wkb(g) for g in geoms], dtype=object),
        [np.array(v, dtype=object) for v in fields.values()],
        fields=list(fields),
        crs="EPSG:25833",
        geometry_type=kind,
        driver="ESRI Shapefile",
    )


def tile_line(*xy: tuple[float, float]) -> shapely.LineString:
    """A line through points in metres from the tile's south-west corner."""
    return shapely.LineString([(X0 + x, Y0 + y) for x, y in xy])


def line_tree(*coords):
    """Lines (in the coordinates given) and the STRtree over them, as the
    lamp bakes index their ways and walls."""
    lines = np.array([shapely.LineString(c) for c in coords], dtype=object)
    return shapely.STRtree(lines), lines


def features(tile: Tile, name: str) -> list[dict]:
    return read(tile, name)["features"]


def feature_line(f: dict) -> shapely.LineString:
    return shapely.geometry.shape(f["geometry"])


def along(feats: list[dict], y: float) -> list[dict]:
    """The features whose line runs along y (m from the tile's corner)."""
    return [f for f in feats if abs(feature_line(f).centroid.y - (Y0 + y)) < 1.0]


def straight(y: float, x0: float = -20, x1: float = SIZE + 20, first: int = 1):
    """Two `osm_tile` nodes for a way along y, by default past both edges."""
    return {first: (x0, y, ""), first + 1: (x1, y, "")}


def dlm_tile(tmp_path) -> Tile:
    """The synthetic tile with nothing written yet."""
    return Tile("t", (X0, Y0, X0 + SIZE, Y0 + SIZE), 25833, tmp_path / "raw", tmp_path / "data")
