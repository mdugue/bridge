"""Basis-DLM → the land-cover class raster (one byte per texel, 4096² over a
2 km tile), its legend, and the hedge / tree-row lines.

The client paints the classes with the palette in lib/city/landcover.ts; this
bake writes ids only. Classes burn lowest priority first, so water (8) wins
over everything. Roads are centrelines buffered by their surveyed width
`BRF`, else by a width per road class `WDM`.
"""

from __future__ import annotations

import json

import numpy as np
import shapely
from PIL import Image
from rasterio.features import rasterize

from .common import Tile, column, feature, geometry_json, read_layer, write_geojson

# id → key: the legend the client's palette is keyed by (lib/city/landcover.ts).
CLASSES = {
    0: "background",
    1: "farmland",
    2: "forest",
    3: "copse",
    4: "builtup",
    5: "railway",
    6: "path",
    7: "road",
    8: "water",
}

# Road half-width (m) by WDM when the surveyed width BRF is unknown.
ROAD_HALF_WIDTH = {"1301": 10.0, "1303": 5.0, "1305": 4.0, "1306": 3.0, "1307": 2.5}
DEFAULT_ROAD_HALF_WIDTH = 2.5


def _road_buffers(tile: Tile) -> list[shapely.Geometry]:
    geoms, fields = read_layer(tile.dlm / "ver01_l.shp", tile.bounds, columns=["BRF", "WDM"])
    out = []
    for g, brf, wdm in zip(
        geoms, column(fields, "BRF", geoms), column(fields, "WDM", geoms), strict=True
    ):
        width = float(brf) if brf not in (None, "") else 0.0
        half = width / 2 if width > 0 else ROAD_HALF_WIDTH.get(str(wdm), DEFAULT_ROAD_HALF_WIDTH)
        out.append(shapely.buffer(g, half))
    return out


def _areas(tile: Tile, layer: str) -> list[shapely.Geometry]:
    return list(read_layer(tile.dlm / f"{layer}.shp", tile.bounds)[0])


def _lines(tile: Tile, layer: str, half: float) -> list[shapely.Geometry]:
    return [shapely.buffer(g, half) for g in read_layer(tile.dlm / f"{layer}.shp", tile.bounds)[0]]


def burn_order(tile: Tile) -> list[tuple[int, list[shapely.Geometry]]]:
    """(class id, geometries) in burn order: later burns overwrite earlier."""
    return [
        (1, _areas(tile, "veg01_f")),  # farmland / meadow
        (2, _areas(tile, "veg02_f")),  # forest
        (3, _areas(tile, "veg03_f")),  # copse
        (4, _areas(tile, "sie02_f")),  # built-up
        (5, _areas(tile, "ver03_f")),  # railway area
        (6, _lines(tile, "ver02_l", 1.0)),  # paths
        (7, _areas(tile, "ver01_f")),  # road area
        (7, _road_buffers(tile)),  # road centrelines, buffered
        (8, _areas(tile, "gew02_f")),  # water area (alt)
        (8, _areas(tile, "gew01_f")),  # water area
        (8, _lines(tile, "gew01_l", 1.0)),  # streams, buffered
    ]


def class_raster(tile: Tile, px: int) -> np.ndarray:
    raster = np.zeros((px, px), dtype=np.uint8)
    transform = tile.transform(px)
    for cls, geoms in burn_order(tile):
        valid = [g for g in geoms if g is not None and not g.is_empty]
        if valid:
            rasterize(
                ((g, cls) for g in valid),
                out=raster,
                transform=transform,
                dtype=np.uint8,
            )
    return raster


def veg_rows(tile: Tile) -> list[dict]:
    """ATKIS veg04 lines: hedges (BWS = 1100) and tree rows."""
    geoms, fields = read_layer(tile.dlm / "veg04_l.shp", tile.bounds, columns=["BWS"])
    features = []
    for g, bws in zip(geoms, column(fields, "BWS", geoms), strict=True):
        kind = "hedge" if str(bws) == "1100" else "treerow"
        for part in shapely.get_parts(g):
            features.append(feature(geometry_json(part), {"kind": kind}))
    return features


def run(tile: Tile, px: int = 4096) -> None:
    if not any(tile.dlm.glob("*.shp")):
        raise SystemExit(
            f"{tile.id}: no Basis-DLM under {tile.dlm} — the land cover is required; "
            "run `bun run bake --ingest` first"
        )
    raster = class_raster(tile, px)
    if not raster.any():
        raise SystemExit(f"{tile.id}: nothing rasterized (no DLM features in the tile?)")
    Image.fromarray(raster, mode="L").save(
        tile.out("dlm", f"landcover_{tile.id}.png"), optimize=True
    )
    legend = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "classes": {str(k): v for k, v in CLASSES.items()},
    }
    tile.out("dlm", f"landcover_{tile.id}.json").write_text(json.dumps(legend, indent=2) + "\n")
    write_geojson(tile.out("dlm", f"vegrows_{tile.id}.geojson"), veg_rows(tile), tile.epsg)
    print(f"{tile.id}: land cover {px}², {int(np.count_nonzero(raster))} classified texels")
