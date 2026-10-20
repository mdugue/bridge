"""DOM1 − DGM1 → tree canopy points. One tree per `cell` metres at the
tallest canopy texel between 3 and 45 m, only inside forest, copse or park
(rasterised from the DLM), never on rail, path, road or water (the class
raster — the gate that stopped trees growing through bridge decks), and
never on or beside a bridge (the DLM's decks, grown by BRIDGE_REACH): where
a bridge lands on a park bank, its steel — the Blaues Wunder's pylons — is
as tall in the nDOM as a crown, and would have become one. Nor on a
building's roof (`roof_mask`): the DLM files a stadium, a fair's halls or a
park's glasshouses as sports or park ground, and over them the nDOM is the
roof's height.

Without a laser scan (Hamburg, Berlin) no step finds the trees outside that
mask — a courtyard's, a garden's, a street tree the cadastre lacks — so
there the canopy also takes the texels the orthophoto shows green and the
surface model rough, where no building stands (`green_mask`)."""

from __future__ import annotations

import json

import numpy as np
import rasterio
import shapely
import shapely.geometry
from rasterio.features import rasterize
from scipy.ndimage import uniform_filter

from . import landcover_osm, ndvi
from .common import Tile, feature, read_layer, write_geojson
from .lowveg import lod2_rings
from .osm import read_osm

MIN_H, MAX_H = 3.0, 45.0
BLOCKED = (5, 6, 7, 8)  # railway, path, road, water
WOODED = (2, 3)  # forest, copse
PARK = "OBJART_TXT='AX_SportFreizeitUndErholungsflaeche'"
BRIDGE = "BWF='1800'"
BRIDGE_REACH = 10.0  # no tree this close to a bridge's centreline or deck (m)
# A canopy texel this far inside a building's outline, and at most
# ROOF_REACH_M above its roof, is that roof (m): a crown beside a wall may
# peak over its eave, and a tree standing over a low shed rises above it.
ROOF_INSET_M = 1.0
ROOF_REACH_M = 2.0
# The roof's height: this share of the outline's nDOM lies below it — the
# upper quartile, so a stadium's pitch or a hall's skylight wells inside
# one outline do not pull it down to the ground.
ROOF_QUANTILE = 0.75
# Outside the vegetation mask, without a laser scan: a crown is green in the
# orthophoto (NDVI, 0..255) and rough in the surface model — the spread of a
# 3 × 3 window above ROUGH_M on more than half of the 5 × 5 around it — and
# stands clear of every LoD2 outline grown by FOOTPRINT_REACH_M. A roof, a
# lorry, a ship or a crane is grey or smooth.
GREEN = 77  # NDVI 0.3
ROUGH_M = 0.5
FOOTPRINT_REACH_M = 1.0


def vegetation_mask(tile: Tile, px: int) -> np.ndarray:
    """Forest, copse and parks: from the Basis-DLM, or without one from the
    class raster's forest and copse plus OSM's parks."""
    if tile.products.dlm:
        geoms = [
            *read_layer(tile.dlm / "veg02_f.shp", tile.bounds)[0],
            *read_layer(tile.dlm / "veg03_f.shp", tile.bounds)[0],
            *read_layer(tile.dlm / "sie02_f.shp", tile.bounds, where=PARK)[0],
        ]
    else:
        geoms = landcover_osm.parks(tile)
    mask = np.zeros((px, px), dtype=np.uint8)
    if geoms:
        rasterize(((g, 1) for g in geoms), out=mask, transform=tile.transform(px))
    if not tile.products.dlm:
        mask |= np.isin(class_raster_at(tile, (px, px)), WOODED).astype(np.uint8)
    return mask


def bridge_mask(tile: Tile, px: int) -> np.ndarray:
    """The bridges of the DLM (centrelines and deck outlines), grown by
    BRIDGE_REACH; without a DLM the decks the rail step baked from OSM
    (`bridge_<tile>.geojson`, rail_osm.py)."""
    geoms = [
        *read_layer(tile.dlm / "ver06_l.shp", tile.bounds, where=BRIDGE)[0],
        *read_layer(tile.dlm / "ver06_f.shp", tile.bounds, where=BRIDGE)[0],
    ]
    baked = tile.out("dlm", f"bridge_{tile.id}.geojson")
    if not tile.products.dlm and baked.exists():
        geoms += [
            shapely.geometry.shape(f["geometry"]) for f in json.loads(baked.read_text())["features"]
        ]
    mask = np.zeros((px, px), dtype=np.uint8)
    if geoms:
        grown = (shapely.buffer(g, BRIDGE_REACH) for g in geoms)
        rasterize(((g, 1) for g in grown), out=mask, transform=tile.transform(px))
    return mask


def roof_mask(tile: Tile, ndom: np.ndarray) -> np.ndarray:
    """The texels of `ndom` (DOM1 − DGM1 over the tile, north row first)
    that are a building's roof: inside an OSM building outline, shrunk by
    ROOF_INSET_M, and no more than ROOF_REACH_M above the outline's roof
    height (its ROOF_QUANTILE of the nDOM). A courtyard (the outline's
    hole) is outside. No extract: nothing is a roof."""
    h, w = ndom.shape
    if tile.osm_extract() is None:
        return np.zeros((h, w), dtype=bool)
    geoms, fields = read_osm(tile, "multipolygons", "building IS NOT NULL", ["building"])
    inner = [
        g.buffer(-ROOF_INSET_M)
        for g, b in zip(geoms, fields.get("building", [None] * len(geoms)), strict=True)
        if g is not None and b != "no"
    ]
    inner = [g for g in inner if not g.is_empty]
    if not inner:
        return np.zeros((h, w), dtype=bool)
    labels = np.zeros((h, w), dtype=np.int32)
    rasterize(((g, i + 1) for i, g in enumerate(inner)), out=labels, transform=tile.transform(w))
    inside = labels > 0
    lab, val = labels[inside], ndom[inside]
    order = np.lexsort((val, lab))
    lab, val = lab[order], val[order]
    first = np.searchsorted(lab, np.arange(len(inner) + 1), side="left")
    last = np.searchsorted(lab, np.arange(len(inner) + 1), side="right")
    roof = np.full(len(inner) + 1, -np.inf)
    count = last - first
    has = count > 0
    pick = first[has] + np.floor(ROOF_QUANTILE * (count[has] - 1)).astype(int)
    roof[has] = val[pick]
    return inside & (ndom <= roof[labels] + ROOF_REACH_M)


def green_mask(tile: Tile, dom: np.ndarray, ndom: np.ndarray) -> np.ndarray:
    """The crowns outside the vegetation mask where no laser scan finds them
    (`products.lsc` false): green in the DOP, rough in DOM1, off every LoD2
    outline. A provider with a scan, or no DOP: nothing."""
    h, w = ndom.shape
    if tile.products.lsc or not tile.raw_raster("dop").exists():
        return np.zeros((h, w), dtype=bool)
    with rasterio.open(tile.raw_raster("dop")) as dop:
        bands = dop.count
    if bands < 3:
        return np.zeros((h, w), dtype=bool)
    green = (ndvi.ndvi_raster(tile, w) if bands >= 4 else ndvi.rgb_raster(tile, w)) >= GREEN
    mean = uniform_filter(dom, 3)
    spread = np.sqrt(np.maximum(uniform_filter(dom * dom, 3) - mean * mean, 0.0))
    rough = uniform_filter((spread > ROUGH_M).astype(np.float32), 5) > 0.5
    outlines = [
        shapely.Polygon(ring[:, :2]).buffer(FOOTPRINT_REACH_M) for ring in lod2_rings(tile.cityjson)
    ]
    built = np.zeros((h, w), dtype=np.uint8)
    outlines = [g for g in outlines if g.is_valid and not g.is_empty]
    if outlines:
        rasterize(((g, 1) for g in outlines), out=built, transform=tile.transform(w))
    return green & rough & (built == 0)


def class_raster_at(tile: Tile, shape: tuple[int, int]) -> np.ndarray:
    """The baked class raster, nearest-sampled onto `shape`."""
    cls = tile.classes()
    if cls is None:
        raise FileNotFoundError(
            f"{tile.id}: the canopy is gated on the class raster; bake landcover first"
        )
    rows = np.minimum((np.arange(shape[0]) * cls.shape[0]) // shape[0], cls.shape[0] - 1)
    cols = np.minimum((np.arange(shape[1]) * cls.shape[1]) // shape[1], cls.shape[1] - 1)
    return cls[np.ix_(rows, cols)]


def blocked_mask(tile: Tile, shape: tuple[int, int]) -> np.ndarray:
    """The class raster's blocked classes, nearest-sampled onto `shape`."""
    return np.isin(class_raster_at(tile, shape), BLOCKED)


def canopy_points(tile: Tile, cell: int) -> list[dict]:
    with rasterio.open(tile.raw_raster("dom1")) as src, rasterio.open(tile.dgm) as dgm:
        dom = src.read(1).astype(np.float64)
        ndom = dom - dgm.read(1).astype(np.float64)
    h, w = ndom.shape
    ok = (vegetation_mask(tile, w) == 1) | green_mask(tile, dom, ndom)
    ok &= ~blocked_mask(tile, ndom.shape)
    ok &= bridge_mask(tile, w) == 0
    ok &= ~roof_mask(tile, ndom)
    ok &= (ndom > MIN_H) & (ndom < MAX_H)
    heights = np.where(ok, ndom, -1.0)
    xmin, _, _, ymax = tile.bounds
    features = []
    for r0 in range(0, h, cell):
        for c0 in range(0, w, cell):
            block = heights[r0 : r0 + cell, c0 : c0 + cell]
            # The first maximum in row-major order, like the scan it replaces.
            i = int(np.argmax(block))
            best = block.flat[i]
            if best < 0:
                continue
            r, c = divmod(i, block.shape[1])
            x = xmin + c0 + c + 0.5
            y = ymax - (r0 + r) - 0.5
            features.append(
                feature(
                    {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
                    {"h": round(float(best), 1)},
                )
            )
    return features


def run(tile: Tile, cell: int = 7) -> None:
    if not tile.raw_raster("dom1").exists():
        print(f"{tile.id}: no surface model — skipping the canopy (trees from rows only)")
        return
    features = canopy_points(tile, cell)
    write_geojson(tile.out("dlm", f"canopy_{tile.id}.geojson"), features, tile.epsg)
    print(f"{tile.id}: {len(features)} canopy trees")
