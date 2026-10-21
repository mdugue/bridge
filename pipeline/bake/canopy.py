"""DOM1 − DGM1 → tree canopy points. One tree per `cell` metres at the
tallest canopy texel between 3 and 45 m, only inside forest, copse or park
(rasterised from the DLM), never on a path or water (the class raster),
nor on a carriageway or a track bed (`ways.traffic`), and never on or beside
a bridge (the DLM's decks, grown by BRIDGE_REACH): where
a bridge lands on a park bank, its steel — the Blaues Wunder's pylons — is
as tall in the nDOM as a crown, and would have become one. Nor on a
building's roof (`roof_mask`): the DLM files a stadium, a fair's halls or a
park's glasshouses as sports or park ground, and over them the nDOM is the
roof's height.

Without a laser scan (Hamburg, Berlin) no step finds the trees outside that
mask — a courtyard's, a garden's, a street tree the cadastre lacks — so
there the canopy also takes the texels the orthophoto shows green and the
surface model rough, where no building stands (`green_mask`).

Nor does any step plant the trees of the transport land beyond the traffic
— the station forecourts, the embankments, the verges, the junction islands
the DLM files as road or railway: there the canopy takes the crowns the
surface model shows, with or without a scan (`verge_mask`).

On transport land a crown is rough but never a plane that the orthophoto
shows bare (`bare_planes`): a freight yard's gravel and ballast heaps —
rough to `rough_mask` for their slope alone — had grown a wood of 22
crowns.

A crown in a needle forest is an evergreen (`l: "e"`), as is one in a mixed
forest that reads green in a leaf-off flight, where the broadleaves are bare
(`leaf_types`): the Dresdner Heide's pines drew as broadleaves, coloured in
autumn and bare in winter. An evergreen whose top the surface model shows
flat is a pine's (`pine: 1`, crown_form.py); the others are the cones of
spruces and firs.

The tree rows' trees (the land-cover step's `vegrows`, the DLM's veg04 or
OSM's tree rows) are the canopy's too (`row: 1`, `row_trees`): one at each
crown peak the surface model shows along the row — at least ROW_SPACING_M
apart, over MIN_H, stood on the row's line, as tall as measured —, none
within ROW_CLEAR_M of a canopy point or a laser-scan crown (`canopyx`),
which is that tree already. The viewer plants a row on its 9 m grid only on
a tile without a canopy (no DOM1). On the grid a Dresden row tree stood
every 9 m where DOM1 shows one every 10 m (7.5–14), 35 % of them beside a
canopy or scan crown (Unna 61 %) and a fifth to three quarters over no tree
at all (nDOM under 3 m).

A tree whose crown reaches over a carriageway (`ways.carriageways`: its
trunk within CLEAR_SHARE of its height of one) carries `c: 1`: its crown
starts high enough to clear the traffic (lib/city/tree-placement.ts
`crownBase`)."""

from __future__ import annotations

import json

import numpy as np
import rasterio
import shapely
import shapely.geometry
from PIL import Image
from rasterio.features import rasterize
from scipy import ndimage as ndi
from scipy.ndimage import uniform_filter
from scipy.spatial import cKDTree
from skimage.feature import peak_local_max

from . import crown_form, landcover_osm, ways
from .common import Tile, column, crs_member, feature, read_layer
from .lowveg import lod2_rings
from .osm import read_osm, tag

MIN_H, MAX_H = 3.0, 45.0
BLOCKED = (6, 8)  # path, water
TRANSPORT = (5, 7)  # railway, road: the DLM's parcels, to their fences
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
# orthophoto (the baked index, 0..255 on Dresden's scale) and rough in the
# surface model — the spread of a 3 × 3 window above ROUGH_M on more than
# half of the 5 × 5 around it — and stands clear of every LoD2 outline grown
# by FOOTPRINT_REACH_M. A roof, a lorry, a ship or a crane is grey or smooth.
GREEN = 77  # NDVI 0.3
ROUGH_M = 0.5
FOOTPRINT_REACH_M = 1.0
# On transport land beyond the traffic a crown is a rough blob in DOM1 of
# this many m² after a 3 × 3 opening (a mast, a gantry, a fence are thinner).
# Not the orthophoto's green: Saxony's is flown leaf-off, where 1–4 % of a
# crown's texels are green (Leipzig; Unna's summer flight 19 %).
VERGE_MIN_M2 = 15
# On transport land, a texel that is a plane in DOM1 and bare in the
# orthophoto is no crown: the residual of its 3 × 3 window about the
# least-squares plane is at most PLANE_M on more than half of the 5 × 5
# around it, and the crown green (`crown_green`) is below BARE. A gravel or
# ballast heap's flank is such a plane however steep (residual 0.05–0.15 m
# on Leipzig's freight-yard heaps, which `rough_mask` passed for their
# slope alone), and so is a platform's or a shed's roof. Bare: asphalt,
# gravel, sand and roofs read 0.0–0.05 on that scale, a mown lawn 0.33.
# Not in the forests and parks: there the DLM says the crowns are trees,
# and a leaf-off crown can read as bare and as smooth (Dresden's DOM1
# under bare limes; München's visible-band index under green ones).
PLANE_M = 0.25
BARE = 0.1
# The forest's kind: the Basis-DLM's AX_Wald `VEG`, without a DLM OSM's
# `leaf_type` on a forest or wood.
BROADLEAF, NEEDLE, MIXED = 1100, 1200, 1300
OSM_LEAF = {"broadleaved": BROADLEAF, "needleleaved": NEEDLE, "mixed": MIXED}
FORESTS = "landuse = 'forest' OR natural = 'wood'"
# In a mixed forest a crown is an evergreen where a leaf-off flight shows it
# this green (the baked index, 0..1 on Dresden's scale, its 3 × 3 maximum
# at ~2 m): Dresden's needle and broadleaf stands part best there (the
# Heide's four tiles: 42 000 and 14 000 crowns, medians 0.39 and 0.16).
CONIFER_NDVI = 0.35
# A flight is leaf-off where the crowns of the tile's broadleaf forest read
# less green than this — less than a mown lawn (0.33 on that scale; Dresden
# 0.16–0.20, Meißen 0.25, but Unna's summer flight 0.5) —, told from at
# least LEAF_OFF_MIN of them. Else a mixed forest stays broadleaf.
LEAF_OFF_NDVI = 0.30
LEAF_OFF_MIN = 200
# A tree row's trees (`row_trees`): a crown peak of the nDOM smoothed by
# ROW_SIGMA_M within ROW_REACH_M of the row's line is one, stood on the line
# (the row's geometry is where the trunks stand; a crown leans off it);
# peaks closer than ROW_SPACING_M along the rows are one crown; one within
# ROW_CLEAR_M of a canopy point or a scan crown is that crown.
ROW_REACH_M = 3.0
ROW_SIGMA_M = 1.0
ROW_SPACING_M = 3.0
ROW_CLEAR_M = 4.5
# A crown reaches over a carriageway when its trunk stands within this share
# of its height of one: half the drawn crown's width (CROWN_TO_HEIGHT, 0.58,
# lib/city/tree-placement.ts) and the kerb's margin.
CLEAR_SHARE = 0.29
CLEAR_MARGIN_M = 0.5


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


def rough_mask(dom: np.ndarray) -> np.ndarray:
    """A crown's texture in the surface model: the spread of a 3 × 3 window
    above ROUGH_M on more than half of the 5 × 5 around it."""
    mean = uniform_filter(dom, 3)
    spread = np.sqrt(np.maximum(uniform_filter(dom * dom, 3) - mean * mean, 0.0))
    return uniform_filter((spread > ROUGH_M).astype(np.float32), 5) > 0.5


def plane_residual(dom: np.ndarray) -> np.ndarray:
    """The RMS residual (m) of each texel's 3 × 3 window about its
    least-squares plane: the spread `rough_mask` measures, less what a tilt
    explains (on the window's x, y in −1..1, var(x) = 2/3)."""
    mean = uniform_filter(dom, 3)
    var = uniform_filter(dom * dom, 3) - mean * mean
    kx = np.tile([-1.0, 0.0, 1.0], (3, 1)) / 9.0
    cov_x, cov_y = ndi.correlate(dom, kx), ndi.correlate(dom, kx.T)
    return np.sqrt(np.maximum(var - (cov_x * cov_x + cov_y * cov_y) * 1.5, 0.0))


def bare_planes(dom: np.ndarray, green: np.ndarray | None) -> np.ndarray:
    """The texels no crown on transport land stands on: a plane in DOM1
    (residual at most PLANE_M on more than half of the 5 × 5 around) and
    bare in the crown green (`crown_green`, any grid) — nothing without the
    index."""
    if green is None:
        return np.zeros(dom.shape, dtype=bool)
    plane = uniform_filter((plane_residual(dom) > PLANE_M).astype(np.float32), 5) <= 0.5
    return plane & (raster_at(green, dom.shape) < BARE)


def built_mask(tile: Tile, px: int) -> np.ndarray:
    """Every LoD2 outline, grown by FOOTPRINT_REACH_M: the rings buffered in
    one vectorised call (55 000 on Dresden's spawn tile in 0.7 s; one by one
    they took 9 s). Grown on the grid instead, by a distance transform from
    the texel centres inside, the mask came out 1.7 % smaller there and a
    ring too small to hold a texel centre vanished."""
    rings = [shapely.Polygon(ring[:, :2]) for ring in lod2_rings(tile.cityjson)]
    built = np.zeros((px, px), dtype=np.uint8)
    if not rings:
        return built == 1
    grown = shapely.buffer(np.array(rings, dtype=object), FOOTPRINT_REACH_M)
    grown = grown[~shapely.is_empty(grown) & shapely.is_valid(grown)]
    if len(grown):
        rasterize(((g, 1) for g in grown), out=built, transform=tile.transform(px))
    return built == 1


def green_mask(tile: Tile, rough: np.ndarray, built: np.ndarray) -> np.ndarray:
    """The crowns outside the vegetation mask where no laser scan finds them
    (`products.lsc` false): green in the baked vegetation index (`ndvi.py`,
    on Dresden's scale whatever the flight), rough in DOM1, off every LoD2
    outline. A provider with a scan, or no index: nothing."""
    png = tile.out("dlm", f"ndvi_{tile.id}.png")
    if tile.products.lsc or not png.exists():
        return np.zeros(rough.shape, dtype=bool)
    green = raster_at(np.asarray(Image.open(png).convert("L")), rough.shape) >= GREEN
    return green & rough & ~built


def verge_mask(
    cls: np.ndarray, ndom: np.ndarray, rough: np.ndarray, built: np.ndarray, traffic: np.ndarray
) -> np.ndarray:
    """The crowns on transport land beyond the traffic: rough (and no bare
    plane, `bare_planes`: the caller's `rough`), 3–45 m, off every LoD2
    outline, in blobs of VERGE_MIN_M2 after a 3 × 3 opening (1 m texels)."""
    crown = np.isin(cls, TRANSPORT) & ~traffic & rough & ~built
    crown &= (ndom > MIN_H) & (ndom < MAX_H)
    crown = ndi.binary_opening(crown, np.ones((3, 3), bool))
    labels, n = ndi.label(crown)
    big = np.bincount(labels.ravel(), minlength=n + 1) >= VERGE_MIN_M2
    big[0] = False
    return big[labels]


def traffic_mask(tile: Tile, px: int) -> np.ndarray:
    """The carriageways and track beds (`ways.traffic`) on the tile's grid."""
    mask = np.zeros((px, px), dtype=np.uint8)
    geoms = ways.traffic(tile)
    if geoms:
        rasterize(((g, 1) for g in geoms), out=mask, transform=tile.transform(px))
    return mask == 1


def raster_at(raster: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """A baked raster over the tile, nearest-sampled onto `shape`."""
    rows = np.minimum((np.arange(shape[0]) * raster.shape[0]) // shape[0], raster.shape[0] - 1)
    cols = np.minimum((np.arange(shape[1]) * raster.shape[1]) // shape[1], raster.shape[1] - 1)
    return raster[np.ix_(rows, cols)]


def class_raster_at(tile: Tile, shape: tuple[int, int]) -> np.ndarray:
    """The baked class raster, nearest-sampled onto `shape`."""
    cls = tile.classes()
    if cls is None:
        raise FileNotFoundError(
            f"{tile.id}: the canopy is gated on the class raster; bake landcover first"
        )
    return raster_at(cls, shape)


def stands(tile: Tile, px: int) -> np.ndarray:
    """The forest's kind under every texel (BROADLEAF, NEEDLE, MIXED; 0
    elsewhere or untold): the DLM's forests, without a DLM OSM's."""
    if tile.products.dlm:
        geoms, fields = read_layer(tile.dlm / "veg02_f.shp", tile.bounds, columns=["VEG"])
        kinds = [
            int(v) if v in ("1100", "1200", "1300") else 0 for v in column(fields, "VEG", geoms)
        ]
    elif tile.osm_extract() is not None:
        geoms, fields = read_osm(tile, "multipolygons", FORESTS, ["other_tags"])
        kinds = [
            OSM_LEAF.get(tag(t, "leaf_type") or "", 0) for t in column(fields, "other_tags", geoms)
        ]
    else:
        geoms, kinds = [], []
    out = np.zeros((px, px), dtype=np.uint16)
    shapes = [(g, k) for g, k in zip(geoms, kinds, strict=True) if g is not None and k]
    if shapes:
        rasterize(shapes, out=out, transform=tile.transform(px))
    return out


def crown_green(tile: Tile) -> np.ndarray | None:
    """The baked index (0..1), its 3 × 3 maximum — a crown's greenest texel
    at ~2 m; None without it."""
    png = tile.out("dlm", f"ndvi_{tile.id}.png")
    if not png.exists():
        return None
    return ndi.maximum_filter(np.asarray(Image.open(png).convert("L")), 3) / 255.0


def leaf_types(
    tile: Tile, rows: np.ndarray, cols: np.ndarray, shape: tuple[int, int]
) -> list[dict]:
    """For each crown at (rows, cols) of the 1 m grid, its leaf properties:
    `l: "e"` for an evergreen — a needle forest's, or with `ls: "dop"` a
    mixed forest's that a leaf-off flight shows green —, none for a
    broadleaf."""
    kind = stands(tile, shape[1])[rows, cols]
    out = [{"l": "e"} if k == NEEDLE else {} for k in kind]
    green = crown_green(tile)
    mixed = kind == MIXED
    if green is None or not mixed.any():
        return out
    k = green.shape[0]
    g = green[(rows * k) // shape[0], (cols * k) // shape[1]]
    broad = g[kind == BROADLEAF]
    if len(broad) < LEAF_OFF_MIN or float(np.median(broad)) >= LEAF_OFF_NDVI:
        return out
    for i in np.flatnonzero(mixed & (g >= CONIFER_NDVI)):
        out[i] = {"l": "e", "ls": "dop"}
    return out


def row_lines(tile: Tile) -> list[shapely.LineString]:
    """The tile's tree rows (the land-cover step's `vegrows`, its hedges
    left out); none before that step has run."""
    path = tile.out("dlm", f"vegrows_{tile.id}.geojson")
    if not path.exists():
        return []
    out = []
    for f in json.loads(path.read_text())["features"]:
        if (f.get("properties") or {}).get("kind") != "treerow" or not f.get("geometry"):
            continue
        g = shapely.geometry.shape(f["geometry"])
        out.extend(p for p in shapely.get_parts(g) if p.geom_type == "LineString" and p.length > 0)
    return out


def thinned(xy: np.ndarray, tops: np.ndarray, spacing: float) -> np.ndarray:
    """The indices of the points kept, tallest first, none within `spacing`
    of a taller one kept."""
    order = np.argsort(-tops, kind="stable")
    tree = cKDTree(xy) if len(xy) else None
    gone = np.zeros(len(xy), bool)
    keep = []
    for i in order:
        if gone[i]:
            continue
        keep.append(i)
        if tree is not None:
            gone[tree.query_ball_point(xy[i], spacing - 1e-6)] = True
    return np.array(sorted(keep), dtype=int)


def row_trees(
    tile: Tile, ndom: np.ndarray, eligible: np.ndarray, taken: np.ndarray
) -> tuple[np.ndarray, np.ndarray, int]:
    """The tree rows' trees (see the module docstring): their positions
    (n × 2, EPSG) and measured heights, and how many rows there were. A
    crown peak is a local maximum of the `eligible` nDOM smoothed by
    ROW_SIGMA_M (1 m texels) within ROW_REACH_M of a row, its height the
    unsmoothed 3 × 3 maximum; `taken` (m × 2) are the canopy's and the
    scan's crowns, which stand in for a peak within ROW_CLEAR_M."""
    lines = row_lines(tile)
    none = (np.zeros((0, 2)), np.zeros(0), len(lines))
    if not lines:
        return none
    h, w = ndom.shape
    near = rasterize(
        ((shapely.buffer(ln, ROW_REACH_M), 1) for ln in lines),
        out_shape=(h, w),
        transform=tile.transform(w),
        dtype=np.uint8,
    )
    crown = np.where(eligible, ndom, 0.0)
    chm = ndi.gaussian_filter(crown, ROW_SIGMA_M)
    pk = peak_local_max(
        chm,
        min_distance=2,
        threshold_abs=MIN_H / 2,
        labels=(eligible & (near == 1)).astype(np.uint8),
        exclude_border=False,
    ).reshape(-1, 2)
    tops = ndi.maximum_filter(crown, 3)[pk[:, 0], pk[:, 1]] if len(pk) else np.zeros(0)
    pk, tops = pk[tops > MIN_H], tops[tops > MIN_H]
    if not len(pk):
        return none
    xmin, _, _, ymax = tile.bounds
    peaks = shapely.points(xmin + pk[:, 1] + 0.5, ymax - pk[:, 0] - 0.5)
    which, line = shapely.STRtree(lines).query_nearest(peaks, max_distance=ROW_REACH_M)
    # one line per peak (a tie between two lines takes the first)
    which, first = np.unique(which, return_index=True)
    line = line[first]
    on = shapely.line_interpolate_point(
        np.array(lines, dtype=object)[line],
        shapely.line_locate_point(np.array(lines, dtype=object)[line], peaks[which]),
    )
    xy, tops = shapely.get_coordinates(on), tops[which]
    keep = thinned(xy, tops, ROW_SPACING_M)
    xy, tops = xy[keep], tops[keep]
    if len(taken) and len(xy):
        d, _ = cKDTree(taken).query(xy)
        xy, tops = xy[d > ROW_CLEAR_M], tops[d > ROW_CLEAR_M]
    return xy, tops, len(lines)


def carriageway_mask(tile: Tile, px: int) -> np.ndarray:
    """The carriageways (`ways.carriageways`, without the traffic's margin)
    on the tile's grid."""
    mask = np.zeros((px, px), dtype=np.uint8)
    geoms = [g for g in ways.carriageways(tile) if g is not None and not g.is_empty]
    if geoms:
        rasterize(((g, 1) for g in geoms), out=mask, transform=tile.transform(px))
    return mask == 1


def over_carriageway(
    tile: Tile, rows: np.ndarray, cols: np.ndarray, tops: np.ndarray, px: int
) -> np.ndarray:
    """Which trees at (rows, cols) of the 1 m grid, `tops` m tall, reach
    over a carriageway: one stands within CLEAR_SHARE of its height (and
    CLEAR_MARGIN_M) of their trunk."""
    lanes = carriageway_mask(tile, px)
    if not lanes.any() or not len(rows):
        return np.zeros(len(rows), bool)
    dist = ndi.distance_transform_edt(~lanes) * (tile.bounds[2] - tile.bounds[0]) / px
    return dist[rows, cols] <= CLEAR_SHARE * tops + CLEAR_MARGIN_M


def scan_crowns(tile: Tile) -> np.ndarray:
    """The laser scan's crowns outside the canopy mask (`canopyx`, the
    lowveg step's), n × 2; none before that step has run."""
    path = tile.out("dlm", f"canopyx_{tile.id}.geojson")
    if not path.exists():
        return np.zeros((0, 2))
    pts = [
        f["geometry"]["coordinates"][:2]
        for f in json.loads(path.read_text())["features"]
        if f.get("geometry")
    ]
    return np.asarray(pts, np.float64).reshape(-1, 2)


def grid_peaks(heights: np.ndarray, cell: int) -> list[tuple[int, int, float]]:
    """The tallest texel of every `cell` × `cell` block with one (heights
    below 0 are none): (row, col, height)."""
    h, w = heights.shape
    peaks = []
    for r0 in range(0, h, cell):
        for c0 in range(0, w, cell):
            block = heights[r0 : r0 + cell, c0 : c0 + cell]
            # The first maximum in row-major order, like the scan it replaces.
            i = int(np.argmax(block))
            best = block.flat[i]
            if best < 0:
                continue
            r, c = divmod(i, block.shape[1])
            peaks.append((r0 + r, c0 + c, float(best)))
    return peaks


def canopy_points(tile: Tile, cell: int) -> tuple[list[dict], dict]:
    """The canopy's trees and the tree rows' (`row: 1`) as features, and
    what the rows came to (`{"lines", "trees"}`)."""
    with rasterio.open(tile.raw_raster("dom1")) as src, rasterio.open(tile.dgm) as dgm:
        dom = src.read(1).astype(np.float64)
        ndom = dom - dgm.read(1).astype(np.float64)
    h, w = ndom.shape
    cls = class_raster_at(tile, ndom.shape)
    rough, built, traffic = rough_mask(dom), built_mask(tile, w), traffic_mask(tile, w)
    # anywhere: no bridge, no roof, 3–45 m
    tree = (bridge_mask(tile, w) == 0) & ~roof_mask(tile, ndom) & (ndom > MIN_H) & (ndom < MAX_H)
    ok = (vegetation_mask(tile, w) == 1) | green_mask(tile, rough, built)
    # on transport land a crown is rough, and a bare plane is no crown
    crown = rough & ~bare_planes(dom, crown_green(tile))
    ok |= verge_mask(cls, ndom, crown, built, traffic)
    ok &= ~np.isin(cls, BLOCKED) & ~traffic & tree
    peaks = grid_peaks(np.where(ok, ndom, -1.0), cell)
    xmin, _, _, ymax = tile.bounds
    grid = np.array([(xmin + c + 0.5, ymax - r - 0.5) for r, c, _ in peaks]).reshape(-1, 2)
    # A row's crown peak stands off every LoD2 outline and off the traffic
    # (a van in a parking lane); a mast or a post is none (crowns at least
    # 2 m across). Not off the bare planes: a leaf-off street lime reads
    # bare and smooth.
    eligible = ndi.binary_opening(tree & ~built & ~traffic, np.ones((2, 2), bool))
    rxy, rtops, n_lines = row_trees(tile, ndom, eligible, np.vstack([grid, scan_crowns(tile)]))
    rr = np.clip((ymax - rxy[:, 1]).astype(int), 0, h - 1)
    rc = np.clip((rxy[:, 0] - xmin).astype(int), 0, w - 1)
    rows = np.concatenate([np.array([p[0] for p in peaks], int), rr])
    cols = np.concatenate([np.array([p[1] for p in peaks], int), rc])
    tops = np.concatenate([np.array([p[2] for p in peaks]), rtops])
    xy = np.vstack([grid, rxy])
    if not len(xy):
        return [], {"lines": n_lines, "trees": 0}
    leaves = crown_form.mark_pines(leaf_types(tile, rows, cols, (h, w)), ndom, rows, cols, tops)
    clear = over_carriageway(tile, rows, cols, tops, w)
    row = np.arange(len(xy)) >= len(grid)
    features = [
        feature(
            {"type": "Point", "coordinates": [round(float(x), 1), round(float(y), 1)]},
            {
                "h": round(float(top), 1),
                **leaf,
                **({"row": 1} if is_row else {}),
                **({"c": 1} if over else {}),
            },
        )
        for (x, y), top, leaf, is_row, over in zip(xy, tops, leaves, row, clear, strict=True)
    ]
    return features, {"lines": n_lines, "trees": int(row.sum())}


def write_canopy(tile: Tile, features: list[dict], rows: dict) -> None:
    """The canopy file: a FeatureCollection with the named-CRS member and
    `rows` — that the tree rows' trees are in it (`canopy_points`)."""
    doc = {"type": "FeatureCollection", "crs": crs_member(tile.epsg), "rows": rows}
    doc["features"] = features
    tile.out("dlm", f"canopy_{tile.id}.geojson").write_text(json.dumps(doc))


def run(tile: Tile, cell: int = 7) -> None:
    if not tile.raw_raster("dom1").exists():
        print(f"{tile.id}: no surface model — skipping the canopy (trees from rows only)")
        return
    features, rows = canopy_points(tile, cell)
    write_canopy(tile, features, rows)
    evergreen = sum(1 for f in features if f["properties"].get("l") == "e")
    over = sum(1 for f in features if f["properties"].get("c"))
    print(
        f"{tile.id}: {len(features)} canopy trees, {evergreen} of them evergreen,"
        f" {rows['trees']} on {rows['lines']} tree rows, {over} over a carriageway"
    )
