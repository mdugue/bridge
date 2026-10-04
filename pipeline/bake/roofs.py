"""LoD2 roofs that miss the measured surface, rebuilt from DOM1 in the
shape the scan shows — flat levels where it is flat, the measured surface
where it slopes or curves — for the build to put in their place
(scripts/bake-city-mesh.ts).

The 2025 LoD2 edition models a complex building it cannot fit to a roof
catalogue as `tdcFreeFormRoof`: often a handful of huge, non-planar facets
over the whole complex. The Westin Bellevue (`DESNATPU1000GHDs`, 160 m
across, a tall slab with lower wings and two courtyards) is three facets
rising from 117 m at the eaves to a 135 m peak in the middle — a crumpled
tent; 78 % of its roof stands more than 2 m off DOM1. Department stores,
theatres and clinics share the fault, and the odd catalogue roof misfits
just as badly. The footprint is right (it is the cadastre's); only the roof
is wrong. So, per LoD2 object with a roof:

1. its roof is burned into a 1 m grid with each vertex's own height (the
   loader triangulates the rings that way — not the Newell plane skyview
   uses); cells where another object's roof stands higher are not its own
   (a podium under a tower, a part under its building's roof);
2. it is a candidate when its own cells cover ≥ `MIN_AREA_M2`, and more
   than `MISS_SHARE` of them (inside, one cell off the edge, no green: the
   DOP's NDVI marks a crown over the roof) stand more than `MISS_M` off
   DOM1 — unless only its level is off (`form_holds`: a form the scan
   follows, misplaced by less than its own height; the Frauenkirche's
   modelled dome stands ~5 m under the scan);
3. the scan over its cells, 3 × 3-median filtered, crowns and the edge row
   filled from the nearest roof cell, is split into its **faces** — where
   it rises by more than `SLOPE` over a patch at least `FACE_M` (10 m)
   across, a ridge or valley between two slopes included
   (`inclined_cells`): a hall's vault, a large pitched roof, a dome — and
   the rest, cut into `STEP_M`
   height bands, each band's connected pieces a region (a step's flank, a
   few metres wide however steep, is no face: it stays the step between two
   levels). Regions under `MIN_PART_M2` join the neighbour closest in
   height, then flat neighbours closer than `MERGE_M` merge (the closest
   pair first, medians kept current) — a flat roof stays one level, a
   storey step stays a step, a face stays one face;
4. it replaces the LoD2 roof only when the flat model of the same cells
   (no faces: every region at its median, the decision ADR 0036 was made
   with) misses DOM1 on at most half as many cells and at most
   `KEEP_SHARE` of them: the tile keeps the LoD2 where the scan disagrees
   for its own reasons (a building site, a crane). What is drawn is the
   model with its faces, which fits the scan better still;
5. the regions are polygonised, simplified as one coverage (shared edges
   stay shared) and clipped to the LoD2 footprint.

Each part is written as its polygon with the object's `id` and `z`, the
roof's absolute height (a face's: its median); a face also carries its
measured `surface`, heights in centimetres from `z` on the 1 m grid,
smoothed with its edges kept. The build stands every part from the
object's own LoD2 base to its roof — flat at `z`, or the surface as an
error-bounded TIN (scripts/measured-roofs.ts). Cross-seam objects are
measured on the neighbours' DOM1 too; each tile writes the objects of its
own CityJSON.
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
SLOPE = 0.15  # m per m (≈ 8.5°): a roof cell rising faster than this is inclined
# A face must hold a disk this wide. Narrower, it is a step's flank, a
# dormer, or a slope the scan's metre of blur at each edge would round into
# a blanket (the Westin Bellevue's slab), where its few levels read better.
FACE_M = 10.0
STEP_EDGE_M = 2.0  # two neighbouring cells further apart than this: a step, not a face
SURFACE_SMOOTH = 1.0  # σ (cells) of a face's edge-preserving blur
SURFACE_STEP_M = 1.0  # σ of the height difference it still mixes
SURFACE_PASSES = 2
EXTEND_CELLS = 4  # how far past its cells a face's surface runs on its plane
FORM_SPAN_M = 3.0  # a LoD2 roof rising less than this has no form to keep
FORM_R = 0.85  # the scan follows a LoD2 roof's form this closely (Pearson r)
FORM_MISS_SHARE = 0.2  # ... and misses it on at most this share, once level


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


def form_holds(model: np.ndarray, dom: np.ndarray) -> bool:
    """Whether a LoD2 roof's form is right and only its level is off (both
    over the judged cells): it has a form (it rises FORM_SPAN_M or more —
    not a flat roof, not a 3 m placeholder), the scan follows it (Pearson r
    ≥ FORM_R), it misses on at most FORM_MISS_SHARE once shifted by its
    median offset, and that offset is smaller than the form's own height (a
    larger one is another building on the footprint). A modelled dome or a
    pitched roof the scan confirms a few metres off stays: the scan's 1 m
    cells on a steep curve are no better a form."""
    if len(model) < 2:
        return False
    span = float(np.percentile(model, 95) - np.percentile(model, 5))
    if span < FORM_SPAN_M or model.std() < 1e-6 or dom.std() < 1e-6:
        return False
    shift = float(np.median(model - dom))
    if abs(shift) > span:
        return False
    if float(np.corrcoef(model, dom)[0, 1]) < FORM_R:
        return False
    return float((np.abs(model - dom - shift) > MISS_M).mean()) <= FORM_MISS_SHARE


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


def _relabel(lab: np.ndarray, roots: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Applies a label → root map (index = old label), renumbered 1..n; also
    the new label of each old root (index = old label, 0 where not a root)."""
    kept = np.unique(roots[1:])
    dense = np.zeros(int(roots.max()) + 1, np.int64)
    dense[kept] = np.arange(1, len(kept) + 1)
    return dense[roots][lab], dense


def _union(parent: np.ndarray, a: int) -> int:
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


def _thin(lab: np.ndarray, n: int) -> np.ndarray:
    """Per region (index = label - 1), whether no cell of it has its whole
    3 × 3 neighbourhood in it: a strip a cell or two wide."""
    interior = (ndi.minimum_filter(lab, 3) == lab) & (ndi.maximum_filter(lab, 3) == lab)
    return np.bincount(lab[interior & (lab > 0)], minlength=n + 1)[1:] == 0


def merge_regions(
    lab: np.ndarray,
    h: np.ndarray,
    small_cells: int,
    faces: np.ndarray | None = None,
    thin: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """Small regions (and with `thin`, strips a cell or two wide: a step's
    flank between a face and its neighbour) into their closest-height
    neighbour, taking its kind, then flat neighbours within MERGE_M of each
    other, the closest pair first. `faces[label]` marks the inclined
    regions (none when omitted); returns the labels and the faces of the
    merged regions."""
    if faces is None:
        faces = np.zeros(int(lab.max()) + 1, bool)
    for _ in range(256):
        n = int(lab.max())
        if n <= 1:
            break
        med = _region_medians(lab, h, n)
        size = np.bincount(lab.ravel(), minlength=n + 1)[1:]
        if thin:
            # a strip counts as small, whatever its length
            size = np.where(_thin(lab, n), 0, size)
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
            # 2. the closest flat pair within MERGE_M (a face stays a face)
            close = sorted(
                (abs(med[a - 1] - med[b - 1]), a, b)
                for a, b in pairs
                if abs(med[a - 1] - med[b - 1]) < MERGE_M and not faces[a] and not faces[b]
            )
            if not close:
                break
            # each region merges once a round: the medians stay current
            touched: set[int] = set()
            for _, a, b in close:
                if a not in touched and b not in touched:
                    parent[a] = b
                    touched.update((a, b))
        roots = np.array([0] + [_union(parent, i) for i in range(1, n + 1)])
        lab, dense = _relabel(lab, roots)
        kept = np.flatnonzero(dense)
        merged_faces = np.zeros(int(lab.max()) + 1, bool)
        merged_faces[dense[kept]] = faces[kept]
        faces = merged_faces
    return lab, faces


def step_cells(h: np.ndarray) -> np.ndarray:
    """The cells beside a step: a neighbour more than STEP_EDGE_M higher or
    lower. A roof face rises less between two cells (a 60° pitch: 1.7 m);
    a storey, a parapet's drop, a mansard's near-vertical lower slope rise
    more — those are walls."""
    out = np.zeros(h.shape, bool)
    dx = np.abs(np.diff(h, axis=1)) > STEP_EDGE_M
    dy = np.abs(np.diff(h, axis=0)) > STEP_EDGE_M
    out[:, :-1] |= dx
    out[:, 1:] |= dx
    out[:-1, :] |= dy
    out[1:, :] |= dy
    return out


def inclined_cells(h: np.ndarray, own: np.ndarray) -> np.ndarray:
    """The cells on a roof face: steeper than SLOPE over a patch FACE_M
    across, and the ridge or valley between two such slopes, but never a
    step's edge (`step_cells`): a face ends at a step, which stays a wall. A
    step's flank is as steep but only a cell or two wide, a dormer or a
    chimney small: neither holds the patch."""
    gx = ndi.sobel(h, axis=1) / (8 * RES)
    gy = ndi.sobel(h, axis=0) / (8 * RES)
    step = step_cells(h)
    steep = own & ~step & (np.hypot(gx, gy) > SLOPE)
    # a disk FACE_M across: a face must hold one, whichever way it points
    r = FACE_M / RES / 2
    k = int(np.floor(r))
    disk = np.hypot(*np.mgrid[-k : k + 1, -k : k + 1]) <= r
    faces = ndi.binary_opening(steep, structure=disk)
    # where a slope turns (a ridge, a valley, a dome's crown) it is flat for
    # a cell or two
    faces = ndi.binary_closing(faces, structure=np.ones((3, 3), bool))
    return faces & own & ~step


@dataclass
class Model:
    """A roof measured in DOM1 over an object's cells."""

    lab: np.ndarray  # region per cell, 0 outside
    level: np.ndarray  # per region (index = label - 1), its median height
    faces: np.ndarray  # per label, whether the region is drawn as its surface
    surface: np.ndarray  # per cell, the measured surface the faces show

    def heights(self) -> np.ndarray:
        """The model's roof per cell (NaN outside)."""
        flat = np.concatenate([[np.nan], self.level])[self.lab]
        return np.where(self.faces[self.lab] & (self.lab > 0), self.surface, flat)


def _edge_preserving(v: np.ndarray, w: np.ndarray) -> np.ndarray:
    """A Gaussian (σ SURFACE_SMOOTH cells) normalised over the cells `w`,
    each neighbour also weighed by how close it stands in height (σ
    SURFACE_STEP_M): the scan's noise is smoothed, a step inside a face
    stays sharp."""
    r = int(np.ceil(2 * SURFACE_SMOOTH))
    pad = np.pad(v, r, mode="edge")
    wpad = np.pad(w, r)
    num = np.zeros_like(v)
    den = np.zeros_like(v)
    rows, cols = v.shape
    for dr in range(-r, r + 1):
        for dc in range(-r, r + 1):
            g = np.exp(-(dr * dr + dc * dc) / (2 * SURFACE_SMOOTH**2))
            nv = pad[r + dr : r + dr + rows, r + dc : r + dc + cols]
            nw = wpad[r + dr : r + dr + rows, r + dc : r + dc + cols]
            k = g * nw * np.exp(-((nv - v) ** 2) / (2 * SURFACE_STEP_M**2))
            num += k * nv
            den += k
    return num / np.maximum(den, 1e-9)


def _face_surface(h: np.ndarray, lab: np.ndarray, faces: np.ndarray, face: np.ndarray):
    """Each face's surface: the scan on its face cells (the pieces it took in
    are filled from them: a dormer or a crane stays off the roof), blurred
    over the face SURFACE_PASSES times, edges kept (`_edge_preserving`): the
    tiles, skylights and snow guards of a 1 m scan smoothed out, a dome's
    or a vault's curve kept."""
    out = h.copy()
    for rid in np.flatnonzero(faces):
        mine = lab == rid
        if not mine.any():
            continue
        rows, cols = np.nonzero(ndi.binary_dilation(mine, iterations=3))
        win = (slice(rows.min(), rows.max() + 1), slice(cols.min(), cols.max() + 1))
        m, src = mine[win], mine[win] & face[win]
        v = fill_nearest(h[win], src if src.any() else m)
        w = m.astype(np.float64)
        for _ in range(SURFACE_PASSES):
            v = _edge_preserving(v, w)
        sub = out[win]
        sub[m] = v[m]
    return out


def measured_model(
    dom: np.ndarray,
    own: np.ndarray,
    roof: np.ndarray,
    green: np.ndarray,
    small_cells: int,
    with_faces: bool = True,
) -> Model | None:
    """The roof over `own` cells: flat levels and (unless `with_faces` is
    off, the flat model) the measured faces."""
    smooth = ndi.median_filter(np.nan_to_num(dom, nan=-1e4), size=3)
    known = roof & ~green & np.isfinite(dom)
    if known.sum() < small_cells:
        return None
    h = fill_nearest(smooth, known)
    face = inclined_cells(h, own) if with_faces else np.zeros_like(own)
    bands = np.round(h / STEP_M).astype(np.int64)
    lab = np.zeros(h.shape, np.int64)
    n = 0
    flat = own & ~face
    for level in np.unique(bands[flat]):
        part, k = ndi.label(flat & (bands == level))
        lab[part > 0] = part[part > 0] + n
        n += k
    part, k = ndi.label(face)
    lab[part > 0] = part[part > 0] + n
    faces = np.zeros(n + k + 1, bool)
    faces[n + 1 :] = True
    lab, faces = merge_regions(lab, h, small_cells, faces, thin=with_faces)
    count = int(lab.max())
    level = _region_medians(lab, h, count)
    surface = _face_surface(h, lab, faces, face) if faces.any() else h
    return Model(lab, level, faces, surface)


def _local_slopes(v: np.ndarray, w: np.ndarray, r: int = 2):
    """Per cell, the slopes (d/dcol, d/drow) of the plane fitted to the
    cells `w` within `r` of it (least squares)."""
    dy, dx = np.mgrid[-r : r + 1, -r : r + 1].astype(np.float64)

    def conv(a, k):
        return ndi.correlate(a, k, mode="constant")

    wz = w * v
    one = np.ones_like(dx)
    s = {
        "1": conv(w, one),
        "x": conv(w, dx),
        "y": conv(w, dy),
        "xx": conv(w, dx * dx),
        "xy": conv(w, dx * dy),
        "yy": conv(w, dy * dy),
        "z": conv(wz, one),
        "xz": conv(wz, dx),
        "yz": conv(wz, dy),
    }
    m = np.stack(
        [
            np.stack([s["1"], s["x"], s["y"]], -1),
            np.stack([s["x"], s["xx"], s["xy"]], -1),
            np.stack([s["y"], s["xy"], s["yy"]], -1),
        ],
        -2,
    )
    rhs = np.stack([s["z"], s["xz"], s["yz"]], -1)
    ok = np.abs(np.linalg.det(m)) > 1e-6
    sol = np.zeros(rhs.shape)
    sol[ok] = np.linalg.solve(m[ok], rhs[ok][..., None])[..., 0]
    return sol[..., 1], sol[..., 2]


def extend_face(surface: np.ndarray, mine: np.ndarray) -> np.ndarray:
    """The face's surface carried past its cells: each outside cell on the
    plane of the face cells nearest it, at most EXTEND_CELLS out, level
    beyond — so the face's TIN runs on across its outline instead of
    bending there."""
    if not mine.any():
        return surface
    gx, gy = _local_slopes(surface, mine.astype(np.float64))
    _, (r, c) = ndi.distance_transform_edt(~mine, return_indices=True)
    rows, cols = np.indices(mine.shape)
    dr, dc = rows - r, cols - c
    far = np.hypot(dr, dc)
    scale = np.minimum(1.0, EXTEND_CELLS / np.maximum(far, 1e-9))
    out = surface[r, c] + (gx[r, c] * dc + gy[r, c] * dr) * scale
    return np.where(mine, surface, out)


def surface_grid(model: Model, rid: int, grid: Grid, poly: shapely.Geometry, z: float) -> dict:
    """A face's measured surface over its polygon and two cells around it
    (the build's TIN spans the cell centres), carried on past the face
    (`extend_face`), on a north-up grid from its north-west corner, in
    centimetres from `z`."""
    x0, y0, x1, y1 = poly.bounds
    c0 = max(int(np.floor((x0 - grid.xmin) / RES)) - 2, 0)
    r0 = max(int(np.floor((grid.ymax - y1) / RES)) - 2, 0)
    c1 = min(int(np.ceil((x1 - grid.xmin) / RES)) + 2, grid.cols)
    r1 = min(int(np.ceil((grid.ymax - y0) / RES)) + 2, grid.rows)
    mine = model.lab[r0:r1, c0:c1] == rid
    sub = extend_face(model.surface[r0:r1, c0:c1], mine)
    return {
        "x": round(grid.xmin + c0 * RES, 2),
        "y": round(grid.ymax - r0 * RES, 2),
        "res": RES,
        "cols": int(sub.shape[1]),
        "rows": int(sub.shape[0]),
        "dz": np.round((sub - z) * 100).astype(int).ravel().tolist(),
    }


@dataclass
class Part:
    poly: shapely.Geometry
    z: float
    surface: dict | None = None


def region_polygons(
    lab: np.ndarray, heights: np.ndarray, grid: Grid, footprint
) -> list[tuple[shapely.Geometry, float, int]]:
    """The regions in plan: polygonised, simplified as one coverage, clipped
    to the footprint; each with its height and label."""
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
                out.append((part, float(heights[rid - 1]), rid))
    return out


@dataclass
class Rebuilt:
    id: str
    parts: list[Part]
    miss_lod2: float
    miss_model: float  # the flat model's, the one the decision is made on


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
    if miss_lod2 <= MISS_SHARE or form_holds(roof[judged], dom[judged]):
        return None
    # the scan sees open ground over much of it: the footprint is out of date
    # (a block torn down since), not just the roof
    if float((dom[judged] < obj.base + GROUND_M).mean()) > OPEN_SHARE:
        return None
    small = int(MIN_PART_M2 / (RES * RES))
    flat = measured_model(dom, own, inner, green, small, with_faces=False)
    if flat is None:
        return None
    miss_model = miss_share(flat.heights(), dom, judged & (flat.lab > 0))
    if miss_model > KEEP_SHARE or miss_model > miss_lod2 / 2:
        return None
    model = measured_model(dom, own, inner, green, small)
    if model is None:
        return None
    # the footprint's own outline, less what another roof covers
    if (covered & np.isfinite(roof)).any():
        mask = covered & np.isfinite(roof)
        shapes = rfeatures.shapes(mask.astype(np.uint8), mask=mask, transform=grid.transform)
        footprint = shapely.difference(
            footprint, shapely.union_all([shapely.geometry.shape(g) for g, _ in shapes])
        )
    parts = []
    for poly, z, rid in region_polygons(model.lab, model.level, grid, footprint):
        if z < obj.base + GROUND_M:
            continue
        z = round(z, 2)
        face = surface_grid(model, rid, grid, poly, z) if model.faces[rid] else None
        parts.append(Part(poly, z, face))
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
        feature(
            geometry_json(p.poly),
            {"id": r.id, "z": p.z} | ({"surface": p.surface} if p.surface else {}),
        )
        for r in found
        for p in sorted(r.parts, key=lambda p: (-p.z, p.poly.bounds))
    ]
    # the provider's LoD2 and DOM1, under its credit line
    write_geojson(out, feats, tile.epsg, f"{tile.credit} (LoD2, DOM1)")
    faces = sum(1 for r in found for p in r.parts if p.surface)
    print(
        f"{tile.id}: {len(found)} of {len(objects)} roofs rebuilt from DOM1 "
        f"({len(feats)} parts, {faces} of them measured faces)"
    )
