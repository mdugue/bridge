"""LoD2 roofs that miss the measured surface, rebuilt from DOM1 as stepped
flat blocks the build puts in their place (scripts/bake-city-mesh.ts).

The 2025 LoD2 edition models a complex building it cannot fit to a roof
catalogue as `tdcFreeFormRoof`: often a handful of huge, non-planar facets
over the whole complex. The Westin Bellevue (`DESNATPU1000GHDs`, 160 m
across, a tall slab with lower wings and two courtyards, all flat) is three
facets rising from 117 m at the eaves to a 135 m peak in the middle — a
crumpled tent; 78 % of its roof stands more than 2 m off DOM1. Department
stores, theatres and clinics share the fault, and the odd catalogue roof
misfits just as badly. The footprint is right (it is the cadastre's); only
the roof is wrong. So, per LoD2 object with a roof:

1. its roof is burned into a 1 m grid with each vertex's own height (the
   loader triangulates the rings that way — not the Newell plane skyview
   uses); cells where another object's roof stands higher are not its own
   (a podium under a tower, a part under its building's roof);
2. it is a candidate when its own cells cover ≥ `MIN_AREA_M2`, and more
   than `MISS_SHARE` of them (inside, one cell off the edge, no green: the
   DOP's NDVI marks a crown over the roof) stand more than `MISS_M` off
   DOM1;
3. the stepped model: DOM1 over its cells, 3 × 3-median filtered, crowns and
   the edge row filled from the nearest roof cell; cut into `STEP_M` height
   bands, each band's connected pieces a region; regions under
   `MIN_PART_M2` join the neighbour closest in height, then neighbours
   closer than `MERGE_M` merge (the closest pair first, medians kept
   current) — a flat roof stays one level, a slope becomes one level at its
   median, a storey step stays a step;
4. it replaces the LoD2 roof only when it misses DOM1 on at most half as
   many cells and at most `KEEP_SHARE` of them: the tile keeps the LoD2
   where the scan disagrees for its own reasons (a building site, a crane);
5. the regions are polygonised, simplified as one coverage (shared edges
   stay shared) and clipped to the LoD2 footprint.

Each part is written as its polygon with the object's `id` and `z`, the
roof's absolute height. The build stands every part from the object's own
LoD2 base to `z`. Cross-seam objects are measured on the neighbours' DOM1
too; each tile writes the objects of its own CityJSON.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
import shapely
from PIL import Image
from rasterio import features as rfeatures
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from scipy import ndimage as ndi

from .common import Tile, feature, geometry_json, overlaps, write_geojson
from .skyview import burn_triangles

GEOSN_ATTRIBUTION = "Quelle: GeoSN, dl-de/by-2-0 (LoD2, DOM1)"
RES = 1.0
MIN_AREA_M2 = 150.0
MISS_M = 2.0
MISS_SHARE = 0.4
KEEP_SHARE = 0.3
STEP_M = 1.0
MERGE_M = 1.5
MIN_PART_M2 = 20.0
SIMPLIFY_M = 1.0
GREEN = 0.3  # NDVI over this: a crown over the roof, not the roof
MIN_POLY_M2 = 4.0
COVERED_M = 0.5  # another roof this much higher covers the cell
GROUND_M = 2.0  # a part lower than this over the base is open ground
OPEN_SHARE = 0.15
MARGIN_M = 250.0  # an object reaching further past its tile is left as it is


@dataclass
class LodObject:
    id: str
    function: str | None
    rings: list[list[np.ndarray]]  # roof polygons: exterior + holes, (n, 3)
    base: float


def lod2_objects(path: Path) -> list[LodObject]:
    """Every building object with roof surfaces (its own, not its parts')."""
    d = json.loads(path.read_text())
    sc, tr = d["transform"]["scale"], d["transform"]["translate"]
    V = np.asarray(d["vertices"], dtype=np.float64) * sc + tr
    out = []
    for oid, o in d["CityObjects"].items():
        attrs = o.get("attributes") or {}
        rings, zmin = [], np.inf
        for g in o.get("geometry", []):
            if str(g.get("lod")) != "2" or "semantics" not in g:
                continue
            bounds, values = g["boundaries"], g["semantics"]["values"]
            if g["type"] == "Solid":
                bounds, values = bounds[0], values[0]
            elif g["type"] != "MultiSurface":
                continue
            for b, v in zip(bounds, values, strict=False):
                zmin = min(zmin, min(V[r][:, 2].min() for r in b if len(r)))
                if v is not None and g["semantics"]["surfaces"][v]["type"] == "RoofSurface":
                    rings.append([V[r] for r in b if len(r) >= 3])
        if rings and np.isfinite(zmin):
            out.append(LodObject(oid, attrs.get("function"), rings, float(zmin)))
    return out


def roof_polygons(obj: LodObject) -> list[tuple[shapely.Polygon, dict]]:
    """The roof's rings in plan, each with its vertices' heights by (x, y)."""
    out = []
    for rr in obj.rings:
        poly = shapely.Polygon(rr[0][:, :2], [h[:, :2] for h in rr[1:]])
        if not poly.is_valid or poly.area < 0.05:
            continue
        heights = {(round(p[0], 3), round(p[1], 3)): p[2] for r in rr for p in r}
        out.append((poly, heights))
    return out


def roof_triangles(obj: LodObject) -> np.ndarray:
    """The roof as (n, 3, 3) triangles, each vertex at its own height."""
    tris = []
    for poly, heights in roof_polygons(obj):
        for t in shapely.get_parts(shapely.constrained_delaunay_triangles(poly)):
            xy = np.asarray(t.exterior.coords)[:3]
            z = [heights.get((round(x, 3), round(y, 3))) for x, y in xy]
            if None not in z:
                tris.append(np.column_stack([xy, z]))
    return np.asarray(tris) if tris else np.zeros((0, 3, 3))


class Grid:
    """A north-up 1 m grid over `bounds` (snapped outward to whole metres)."""

    def __init__(self, bounds):
        xmin, ymin, xmax, ymax = bounds
        self.xmin, self.ymax = np.floor(xmin), np.ceil(ymax)
        self.cols = int(np.ceil(xmax) - self.xmin)
        self.rows = int(self.ymax - np.floor(ymin))
        self.xmax = self.xmin + self.cols * RES
        self.ymin = self.ymax - self.rows * RES
        self.res = RES
        self.transform = from_origin(self.xmin, self.ymax, RES, RES)

    @property
    def shape(self):
        return self.rows, self.cols

    @property
    def bounds(self):
        return self.xmin, self.ymin, self.xmax, self.ymax


def read_mosaic(tile: Tile, grid: Grid, product: str, neighbours) -> np.ndarray:
    """A raw raster (DOM1) over the grid from every tile it touches (NaN
    where none reaches)."""
    out = np.full(grid.shape, np.nan, np.float32)
    for tid, b in neighbours:
        path = tile.raw / product / f"{tid}.tif"
        if not overlaps(b, grid.bounds) or not path.exists():
            continue
        with rasterio.open(path) as ds:
            win = from_bounds(*grid.bounds, ds.transform).round_offsets().round_lengths()
            data = ds.read(1, window=win, boundless=True, fill_value=np.nan).astype(np.float32)
            if ds.nodata is not None:
                data[data == ds.nodata] = np.nan
        h, w = min(data.shape[0], grid.rows), min(data.shape[1], grid.cols)
        sub = out[:h, :w]
        np.copyto(sub, data[:h, :w], where=np.isnan(sub))
    return out


def read_ndvi(tile: Tile, grid: Grid, neighbours) -> np.ndarray:
    """The committed NDVI (0..1) over the grid, nearest; 0 where none."""
    out = np.zeros(grid.shape, np.float32)
    ys = grid.ymax - (np.arange(grid.rows) + 0.5) * RES
    xs = grid.xmin + (np.arange(grid.cols) + 0.5) * RES
    for tid, (bx0, by0, bx1, by1) in neighbours:
        path = tile.data / "dlm" / f"ndvi_{tid}.png"
        if not overlaps((bx0, by0, bx1, by1), grid.bounds) or not path.exists():
            continue
        img = np.asarray(Image.open(path).convert("L"), np.float32) / 255.0
        h, w = img.shape
        r = np.floor((by1 - ys) / (by1 - by0) * h).astype(int)
        c = np.floor((xs - bx0) / (bx1 - bx0) * w).astype(int)
        rin, cin = (r >= 0) & (r < h), (c >= 0) & (c < w)
        sub = img[np.ix_(r[rin], c[cin])]
        out[np.ix_(rin, cin)] = sub
    return out


def miss_share(model: np.ndarray, dom: np.ndarray, judged: np.ndarray) -> float:
    """The share of judged cells where the model stands > MISS_M off DOM1."""
    n = judged.sum()
    if n == 0:
        return 0.0
    return float((np.abs(model - dom)[judged] > MISS_M).sum() / n)


def fill_nearest(values: np.ndarray, known: np.ndarray) -> np.ndarray:
    """Every cell takes the value of the nearest known cell."""
    _, (r, c) = ndi.distance_transform_edt(~known, return_indices=True)
    return values[r, c]


def _region_medians(lab: np.ndarray, h: np.ndarray, n: int) -> np.ndarray:
    idx = np.arange(1, n + 1)
    return np.asarray(ndi.median(h, lab, idx), np.float64) if n else np.zeros(0)


def _adjacency(lab: np.ndarray) -> set[tuple[int, int]]:
    pairs = set()
    for a, b in ((lab[:, :-1], lab[:, 1:]), (lab[:-1, :], lab[1:, :])):
        m = (a != b) & (a > 0) & (b > 0)
        for x, y in zip(a[m].tolist(), b[m].tolist(), strict=True):
            pairs.add((min(x, y), max(x, y)))
    return pairs


def _relabel(lab: np.ndarray, roots: np.ndarray) -> np.ndarray:
    """Applies a label → root map (index = old label), renumbered 1..n."""
    kept = np.unique(roots[1:])
    dense = np.zeros(int(roots.max()) + 1, np.int64)
    dense[kept] = np.arange(1, len(kept) + 1)
    return dense[roots][lab]


def _union(parent: np.ndarray, a: int) -> int:
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


def merge_regions(lab: np.ndarray, h: np.ndarray, small_cells: int) -> np.ndarray:
    """Small regions into their closest-height neighbour, then neighbours
    within MERGE_M of each other, the closest pair first."""
    for _ in range(256):
        n = int(lab.max())
        if n <= 1:
            return lab
        med = _region_medians(lab, h, n)
        size = np.bincount(lab.ravel(), minlength=n + 1)[1:]
        pairs = _adjacency(lab)
        parent = np.arange(n + 1)
        merged = False
        # 1. the small ones
        for r in np.argsort(size):
            if size[r] >= small_cells:
                break
            lr = r + 1
            nb = [b if a == lr else a for a, b in pairs if lr in (a, b)]
            if not nb:
                continue
            target = min(nb, key=lambda x: abs(med[x - 1] - med[r]))
            ra, rb = _union(parent, lr), _union(parent, target)
            if ra != rb:
                parent[ra] = rb
                merged = True
        if not merged:
            # 2. the closest pair within MERGE_M
            close = sorted(
                (abs(med[a - 1] - med[b - 1]), a, b)
                for a, b in pairs
                if abs(med[a - 1] - med[b - 1]) < MERGE_M
            )
            if not close:
                return lab
            # each region merges once a round: the medians stay current
            touched: set[int] = set()
            for _, a, b in close:
                if a not in touched and b not in touched:
                    parent[a] = b
                    touched.update((a, b))
        roots = np.array([0] + [_union(parent, i) for i in range(1, n + 1)])
        lab = _relabel(lab, roots)
    return lab


def stepped_model(
    dom: np.ndarray, own: np.ndarray, roof: np.ndarray, green: np.ndarray, small_cells: int
):
    """The stepped roof over `own` cells: (labels, heights per label)."""
    smooth = ndi.median_filter(np.nan_to_num(dom, nan=-1e4), size=3)
    known = roof & ~green & np.isfinite(dom)
    if known.sum() < small_cells:
        return None
    h = fill_nearest(smooth, known)
    bands = np.round(h / STEP_M).astype(np.int64)
    lab = np.zeros(h.shape, np.int64)
    n = 0
    for level in np.unique(bands[own]):
        part, k = ndi.label(own & (bands == level))
        lab[part > 0] = part[part > 0] + n
        n += k
    lab = merge_regions(lab, h, small_cells)
    count = int(lab.max())
    heights = _region_medians(lab, h, count)
    return lab, heights


def region_polygons(
    lab: np.ndarray, heights: np.ndarray, grid: Grid, footprint
) -> list[tuple[shapely.Geometry, float]]:
    """The regions in plan: polygonised, simplified as one coverage, clipped
    to the footprint."""
    # every footprint point under a region: the labels grown outward a cell
    grown = fill_nearest(lab, lab > 0)
    near = ndi.binary_dilation(lab > 0, iterations=2)
    grown = np.where(near, grown, 0).astype(np.int32)
    polys, ids = [], []
    for geom, value in rfeatures.shapes(grown, mask=grown > 0, transform=grid.transform):
        polys.append(shapely.geometry.shape(geom))
        ids.append(int(value))
    if not polys:
        return []
    cover = shapely.coverage_simplify(
        np.asarray(polys, dtype=object), SIMPLIFY_M, simplify_boundary=False
    )
    out = []
    for poly, rid in zip(cover, ids, strict=True):
        # on the centimetre grid the file is written on, so it stays valid
        clipped = shapely.set_precision(
            shapely.make_valid(shapely.intersection(poly, footprint)), 0.01
        )
        for part in shapely.get_parts(clipped):
            if part.geom_type == "Polygon" and part.area >= MIN_POLY_M2:
                out.append((part, float(heights[rid - 1])))
    return out


@dataclass
class Rebuilt:
    id: str
    parts: list[tuple[shapely.Geometry, float]]
    miss_lod2: float
    miss_model: float


class Area:
    """The tile and `MARGIN_M` around it, read once: DOM1, the crowns
    (NDVI) and the highest LoD2 roof of every object."""

    def __init__(self, tile: Tile, objects: list[LodObject]):
        xmin, ymin, xmax, ymax = tile.bounds
        self.grid = Grid((xmin - MARGIN_M, ymin - MARGIN_M, xmax + MARGIN_M, ymax + MARGIN_M))
        neighbours = tile.neighbours()
        self.dom = read_mosaic(tile, self.grid, "dom1", neighbours)
        self.green = read_ndvi(tile, self.grid, neighbours) > GREEN
        self.tris = {o.id: roof_triangles(o) for o in objects}
        all_tris = [t for t in self.tris.values() if len(t)]
        self.top = (
            burn_triangles(self.grid, np.concatenate(all_tris))
            if all_tris
            else np.full(self.grid.shape, np.nan)
        )

    def window(self, bounds) -> tuple[Grid, tuple[slice, slice]] | None:
        """The sub-grid over `bounds` (grown 3 m) and its slices in the area."""
        g = self.grid
        c0 = int(np.floor((bounds[0] - 3 - g.xmin) / RES))
        c1 = int(np.ceil((bounds[2] + 3 - g.xmin) / RES))
        r0 = int(np.floor((g.ymax - bounds[3] - 3) / RES))
        r1 = int(np.ceil((g.ymax - bounds[1] + 3) / RES))
        if c0 < 0 or r0 < 0 or c1 > g.cols or r1 > g.rows:
            return None
        sub = Grid((g.xmin + c0 * RES, g.ymax - r1 * RES, g.xmin + c1 * RES, g.ymax - r0 * RES))
        return sub, (slice(r0, r1), slice(c0, c1))


def rebuild(area: Area, obj: LodObject) -> Rebuilt | None:
    polys = roof_polygons(obj)
    if not polys:
        return None
    footprint = shapely.make_valid(shapely.union_all([p for p, _ in polys]))
    if footprint.area < MIN_AREA_M2:
        return None
    win = area.window(footprint.bounds)
    if win is None:
        return None
    grid, at = win
    roof = burn_triangles(grid, area.tris[obj.id])
    covered = area.top[at] > np.nan_to_num(roof, nan=-1e9) + COVERED_M
    own = np.isfinite(roof) & ~covered
    if own.sum() * RES * RES < MIN_AREA_M2:
        return None
    dom, green = area.dom[at], area.green[at]
    inner = ndi.binary_erosion(own, iterations=1)
    judged = inner & ~green & np.isfinite(dom)
    if judged.sum() * RES * RES < MIN_AREA_M2 / 2:
        return None
    miss_lod2 = miss_share(roof, dom, judged)
    if miss_lod2 <= MISS_SHARE:
        return None
    # the scan sees open ground over much of it: the footprint is out of date
    # (a block torn down since), not just the roof
    if float((dom[judged] < obj.base + GROUND_M).mean()) > OPEN_SHARE:
        return None
    model = stepped_model(dom, own, inner, green, int(MIN_PART_M2 / (RES * RES)))
    if model is None:
        return None
    lab, heights = model
    stepped = np.where(lab > 0, np.concatenate([[np.nan], heights])[lab], np.nan)
    miss_model = miss_share(stepped, dom, judged & (lab > 0))
    if miss_model > KEEP_SHARE or miss_model > miss_lod2 / 2:
        return None
    # the footprint's own outline, less what another roof covers
    if (covered & np.isfinite(roof)).any():
        mask = covered & np.isfinite(roof)
        shapes = rfeatures.shapes(mask.astype(np.uint8), mask=mask, transform=grid.transform)
        footprint = shapely.difference(
            footprint, shapely.union_all([shapely.geometry.shape(g) for g, _ in shapes])
        )
    parts = [
        (p, z)
        for p, z in region_polygons(lab, heights, grid, footprint)
        if z >= obj.base + GROUND_M
    ]
    if not parts:
        return None
    return Rebuilt(obj.id, parts, miss_lod2, miss_model)


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"roofs_{tile.id}.geojson")
    if not tile.raw_raster("dom1").exists():
        print(f"{tile.id}: no DOM1 — skipping the measured roofs (the LoD2 roofs stay)")
        return
    cityjson = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    objects = lod2_objects(cityjson)
    area = Area(tile, objects)
    # buildings only: a bridge's slab (53001) is the rail layer's
    found = [
        r
        for o in objects
        if (o.function or "31001").startswith("31001") and (r := rebuild(area, o))
    ]
    found.sort(key=lambda r: r.id)
    feats = [
        feature(geometry_json(poly), {"id": r.id, "z": round(z, 2)})
        for r in found
        for poly, z in sorted(r.parts, key=lambda p: (-p[1], p[0].bounds))
    ]
    write_geojson(out, feats, tile.epsg, GEOSN_ATTRIBUTION)
    print(f"{tile.id}: {len(found)} of {len(objects)} roofs rebuilt from DOM1 ({len(feats)} parts)")
