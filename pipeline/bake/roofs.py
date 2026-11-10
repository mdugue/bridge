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
   modelled dome stands ~5 m under the scan). Missing on less, down to
   `LEVEL_MISS_SHARE`, it is a candidate only where the scan is level under
   at least `LEVEL_SHARE` of its misses (`level_share`): the low hipped
   roof the 2025 edition models over a department store's flat roof misses
   on a quarter of it, along its ridges, where the store is level — a
   pitched roof the scan shows off by a storey misses on a slope, a gable's
   flank beside a step. Nor where the scan confirms the LoD2's pitch over
   half of it (`pitch_holds`): a row house's gable, a barrel vault, too
   narrow for faces (step 3), would be drawn flat for an annex the LoD2
   left out;
3. the scan over its cells, 3 × 3-median filtered, crowns and the edge row
   filled from the nearest roof cell, is split into its **faces** — where
   it rises by more than `SLOPE` over a patch at least `FACE_M` (10 m)
   across, or by more than `STEEP` over one `STEEP_FACE_M` (5 m) across,
   a ridge or valley between two slopes included (`inclined_cells`): a
   hall's vault, a pitched roof, a mansard's flank, a dome — or where it
   lies on an inclined plane holding a disk a few metres across
   (`roof_planes.planar_faces`: a gable ring's narrow, gentle flanks); each
   face is then drawn in a form roofs are built in or goes back to the
   rest (`roof_planes.plausible_fit`: first the roof's flanks — a gable's
   or a hipped roof's, section by section, ridges and valleys where their
   planes cross (`flank_cells` finds them past their dormers) —, then
   planes, an extruded profile, the scan itself only on a landmark); a
   face drawn as flanks ends along its eaves against a lower level
   (`_straight_eaves`) — and the rest, cut into `STEP_M`
   height bands, each band's connected pieces a region (a step's flank, a
   cell or two wide however steep, is no face: it stays the step between two
   levels). Regions under `MIN_PART_M2`, and those holding no disk
   `NARROW_M` across within `NARROW_DZ` of a neighbour (a flank, a parapet
   run, a plant room: drawn alone, each a box), join the neighbour closest
   in height, then flat neighbours closer than `MERGE_M` merge (the
   closest pair first, medians kept current) — a flat roof stays one
   level, a storey step stays a step, a face stays one face;
4. it replaces the LoD2 roof only when the flat model of the same cells
   (no faces: every region at its median, the decision ADR 0036 was made
   with) misses DOM1 on at most half as many cells and at most
   `KEEP_SHARE` of them: the tile keeps the LoD2 where the scan disagrees
   for its own reasons (a building site, a crane). What is drawn is the
   model with its faces, which fits the scan better still — and is held
   to the same bar: where merging its narrow parts makes it miss more, they
   stay apart;
5. the regions are polygonised from their labels smoothed by a majority
   (a border diagonal to the grid is no staircase), simplified as one
   coverage (shared edges stay shared) and clipped to the LoD2 footprint
   less what another roof covers; then built of the building's walls
   (`regular_cover`: each edge turned onto the nearest wall, the parts
   tiled again highest first, the gaps to the lowest part beside them)
   and made one coverage again (`clean_cover`).

Each part is written as its polygon with the object's `id` and `z`, the
roof's absolute height (a face's: its median); a face also carries its
`surface` (`roof_planes.py`), heights in centimetres from `z` on the 1 m
grid. The build stands every part from the
object's own LoD2 base to its roof — flat at `z`, or the surface as an
error-bounded TIN (scripts/measured-roofs.ts). Cross-seam objects are
measured on the neighbours' DOM1 too; each tile writes the objects of its
own CityJSON.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
import shapely
from PIL import Image
from rasterio import features as rfeatures
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from scipy import ndimage as ndi

from . import roof_planes
from .common import Tile, feature, geometry_json, overlaps, write_geojson
from .roof_planes import fill_nearest
from .skyview import burn_triangles

RES = 1.0
MIN_AREA_M2 = 150.0
MISS_M = 2.0
MISS_SHARE = 0.4
LEVEL_MISS_SHARE = 0.2
LEVEL_SHARE = 0.6
PITCH_SHARE = 0.5  # ... unless the scan confirms the LoD2's pitch (`pitch_holds`)
KEEP_SHARE = 0.3
STEP_M = 1.0
MERGE_M = 1.5
MIN_PART_M2 = 20.0
# A drawn part must hold a disk this wide; a narrower one joins the
# neighbour closest in height (the flat model the decision is made on keeps
# them all).
NARROW_M = 7.0
NARROW_DZ = 3.0
SIMPLIFY_M = 2.0
OUTLINE_M = 2.0  # the radius over which a part's outline is smoothed (`_majority`)
MAJORITY_PASSES = 2
# An outline's edge at least REGULAR_MIN_M long and turned within REGULAR_DEG
# of a wall of the footprint (one at least WALL_MIN_M long) runs parallel to
# it; one off every wall and shorter than REGULAR_KEEP_M (a rounded corner's
# chamfer) is left out, and the lines meet at corners where they cross,
# unless a corner then stands more than REGULAR_MOVE_M off the outline: an
# outline is built of walls, not of the scan's rounded blur.
REGULAR_DEG = 15.0
REGULAR_MIN_M = 2.0
REGULAR_KEEP_M = 4.0
REGULAR_MOVE_M = 1.5
REGULAR_JOG_M = 1.0  # two parallel edges further apart than this meet at a jog
WALL_MIN_M = 4.0
WALL_GROUP_DEG = 2.0  # walls this close in direction are one front's
WALL_ON_M = 1.0  # an outline's edge this near a wall runs on it
WALL_LINE_M = 0.1  # a footprint vertex this near the line of its neighbours splits no wall
STRAIGHT_M = 0.01  # a point within the file's grid of the line of its neighbours is no corner
CLEAN_M = 0.3  # the tiled parts' borders simplified this much (√ of the area dropped)
GAP_FACE_M2 = 1.0  # a sliver no part holds, this small, goes to a part beside it
TILE_GRID_M = 0.01  # the parts are tiled again on the file's centimetre grid
GAP_TOUCH_M = 1.0  # a gap between regularised parts lies beside a part along this much
GREEN = 0.3  # NDVI over this: a crown over the roof, not the roof
MIN_POLY_M2 = 4.0
COVERED_M = 0.5  # another roof this much higher covers the cell
CUT_SMOOTH_M = 0.75  # the covered cells' outline cut from a footprint, simplified this much
GROUND_M = 2.0  # a part lower than this over the base is open ground
OPEN_SHARE = 0.15
MARGIN_M = 250.0  # an object reaching further past its tile is left as it is
SLOPE = 0.15  # m per m (≈ 8.5°): a roof cell rising faster than this is inclined
# A face must hold a disk this wide. Narrower, a gentle slope is a step's
# flank, a dormer, or a slope the scan's metre of blur at each edge would round into
# a blanket (the Westin Bellevue's slab), where its few levels read better.
FACE_M = 10.0
# A steeper slope is a face from a narrower patch: a mansard's or a hipped
# roof's flank, 30–50° and a few metres wide, read as a flight of 1 m
# terraces (the Schauspielhaus). Blur at a slab's edge is a step
# (`step_cells`), never this steep over a patch this wide.
STEEP = 0.5  # m per m (≈ 27°)
STEEP_FACE_M = 5.0
STEP_EDGE_M = 2.0  # two neighbouring cells further apart than this: a step, not a face
PLAUSIBLE_ROUNDS = 3  # faces dropped as implausible, the levels re-cut, at most this often
EXTEND_CELLS = 4  # how far past its cells a face's surface runs on its plane
EAVE_WALL_M = 1.0  # a level this far under a flank's eave meets it at a wall along the eave
EAVE_REACH = 3  # ... the cells either side within this of the face (the scan's blur) moved
EAVE_DOWNHILL_COS = 0.5  # ... only where the plane falls toward them (60°): not a gable's end
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


def scan_surface(dom: np.ndarray, known: np.ndarray) -> np.ndarray:
    """DOM1 3 × 3-median filtered, every cell not `known` (a crown, the
    edge row) filled from the nearest known one."""
    return fill_nearest(ndi.median_filter(np.nan_to_num(dom, nan=-1e4), size=3), known)


def _rise(h: np.ndarray) -> np.ndarray:
    """Per cell, how many metres the surface rises per metre (Sobel)."""
    return np.hypot(ndi.sobel(h, axis=1) / (8 * RES), ndi.sobel(h, axis=0) / (8 * RES))


def level_share(roof: np.ndarray, dom: np.ndarray, h: np.ndarray, judged: np.ndarray) -> float:
    """Of the judged cells where a LoD2 roof misses DOM1 by more than
    MISS_M, a step's edge aside, the share on which the scan (`h`, its
    `scan_surface`) rises less than SLOPE: where the LoD2 models a pitch,
    or a level, over a level roof."""
    missed = judged & (np.abs(roof - dom) > MISS_M) & ~step_cells(h)
    n = missed.sum()
    return float((missed & (_rise(h) <= SLOPE)).sum() / n) if n else 0.0


def pitch_holds(roof: np.ndarray, h: np.ndarray, own: np.ndarray, judged: np.ndarray) -> bool:
    """Whether the scan (`h`, its `scan_surface`) confirms a LoD2 roof's
    pitch: the LoD2 rises more than SLOPE on at least PITCH_SHARE of the
    judged cells (either's steps aside), and the scan on at least
    PITCH_SHARE of those. A narrow gable, a barrel vault: where the scan's
    faces are too narrow to be drawn as faces, a rebuild would flatten what
    the LoD2 has right."""
    lod2 = fill_nearest(np.nan_to_num(roof), own)
    pitched = judged & ~step_cells(h) & ~step_cells(lod2) & (_rise(lod2) > SLOPE)
    n = pitched.sum()
    if n == 0 or n < PITCH_SHARE * judged.sum():
        return False
    return bool((pitched & (_rise(h) > SLOPE)).sum() >= PITCH_SHARE * n)


def _region_medians(lab: np.ndarray, h: np.ndarray, n: int) -> np.ndarray:
    idx = np.arange(1, n + 1)
    return np.asarray(ndi.median(h, lab, idx), np.float64) if n else np.zeros(0)


def _adjacency(lab: np.ndarray) -> set[tuple[int, int]]:
    return set(roof_planes.label_borders(lab))


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


def _narrow(lab: np.ndarray, n: int) -> np.ndarray:
    """Per region (index = label - 1), whether it holds no disk NARROW_M
    across: a strip a few metres wide — a step's blurred flank, a parapet,
    the gutter between two vaults, a dormer's row, a plant room. Drawn on
    its own, each stands as a box of its own height between its neighbours'
    walls (the "blocks" on the Hauptbahnhof, the Prager Spitze, the roofs
    around the Neumarkt)."""
    cross = ndi.generate_binary_structure(2, 1)
    # (the grid's edge is a border too)
    border = (ndi.minimum_filter(lab, footprint=cross, mode="constant") != lab) | (
        ndi.maximum_filter(lab, footprint=cross) != lab
    )
    # the widest disk: twice the farthest cell's distance from the region's
    # border cells, plus the cell itself (a strip w cells wide: w, or w - 1
    # for an even w, whose middle is two cells)
    depth = ndi.distance_transform_edt(~border)
    widest = np.asarray(ndi.maximum(depth, lab, np.arange(1, n + 1)), np.float64)
    return (2 * widest + 1) * RES < NARROW_M


def merge_regions(
    lab: np.ndarray,
    h: np.ndarray,
    small_cells: int,
    faces: np.ndarray | None = None,
    thin: bool = False,
    narrow: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """Small regions (with `thin`, also strips a cell or two wide: a
    step's flank; with `narrow`, strips narrower than NARROW_M within
    NARROW_DZ of a neighbour: `_narrow`) into their closest-height
    neighbour, taking its kind, then flat neighbours within MERGE_M of each
    other, the closest pair first.
    `faces[label]` marks the inclined regions (none when omitted); returns
    the labels and the faces of the merged regions."""
    if faces is None:
        faces = np.zeros(int(lab.max()) + 1, bool)
    for _ in range(256):
        n = int(lab.max())
        if n <= 1:
            break
        med = _region_medians(lab, h, n)
        cells = np.bincount(lab.ravel(), minlength=n + 1)[1:]
        # a strip counts as small, whatever its length
        strip = _thin(lab, n) if thin else np.zeros(n, bool)
        # a face is never narrow: a steep one holds STEEP_FACE_M, less than
        # NARROW_M, and stays the slope it measures
        wide = _narrow(lab, n) & ~strip & ~faces[1:] if narrow else np.zeros(n, bool)
        size = np.where(strip | wide, 0, cells)
        pairs = _adjacency(lab)
        parent = np.arange(n + 1)
        merged = False
        # a narrow strip merges once a round, into a region not merging
        # itself: the NARROW_DZ cap holds against the medians it was
        # measured with, never along a chain
        touched: set[int] = set()
        # 1. the small ones
        for r in np.argsort(size):
            if size[r] >= small_cells:
                break
            lr = r + 1
            nb = [b if a == lr else a for a, b in pairs if lr in (a, b)]
            if not nb:
                continue
            target = min(nb, key=lambda x: abs(med[x - 1] - med[r]))
            # a narrow strip further than NARROW_DZ from every neighbour is
            # a wing or a storey of its own, not a flank
            capped = wide[r] and cells[r] >= small_cells
            if capped and (abs(med[target - 1] - med[r]) > NARROW_DZ or {lr, target} & touched):
                continue
            if capped:
                touched.update((lr, target))
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


def _disk(width_m: float) -> np.ndarray:
    r = width_m / RES / 2
    k = int(np.floor(r))
    return np.hypot(*np.mgrid[-k : k + 1, -k : k + 1]) <= r


def inclined_cells(h: np.ndarray, own: np.ndarray) -> np.ndarray:
    """The cells on a roof face: steeper than SLOPE over a patch FACE_M
    across or than STEEP over one STEEP_FACE_M across, and the ridge or
    valley between two such slopes, but never a step's edge (`step_cells`):
    a face ends at a step, which stays a wall. A step's flank is as steep
    but only a cell or two wide, a dormer or a chimney small: neither holds
    the patch."""
    step = step_cells(h)
    rise = _rise(h)
    # a disk FACE_M across: a face must hold one, whichever way it points;
    # a steep one, a disk STEEP_FACE_M across
    faces = ndi.binary_opening(own & ~step & (rise > SLOPE), structure=_disk(FACE_M))
    faces |= ndi.binary_opening(own & ~step & (rise > STEEP), structure=_disk(STEEP_FACE_M))
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


def _regions(h, own, face, small_cells, with_faces, narrow):
    """The levels (`own` less `face`, in STEP_M bands) and the faces, merged
    (`merge_regions`)."""
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
    return merge_regions(lab, h, small_cells, faces, thin=with_faces, narrow=with_faces and narrow)


def _plausible_faces(h, lab, faces, face, landmark, flank_only, fits=None):
    """The surface the faces are drawn with — each as flanks, planes or one
    curve (`roof_planes.plausible_fit`), fitted on its own face cells
    (what it took in follows it) —, the faces that are none of them, and
    per face drawn as flanks its window, fit and eaves (`_straight_eaves`).
    A face most of whose cells only the flank rule found (`flank_only`) is
    drawn as flanks or not at all. `fits`: the fits of earlier rounds, by
    the face's cells (a face no round changed is not fitted again)."""
    fits = {} if fits is None else fits
    surface = h.copy()
    implausible = []
    gables = {}
    for rid in np.flatnonzero(faces):
        mine = lab == rid
        if not mine.any():
            continue
        rows, cols = np.nonzero(ndi.binary_dilation(mine, iterations=EXTEND_CELLS + 2))
        win = (slice(rows.min(), rows.max() + 1), slice(cols.min(), cols.max() + 1))
        src = mine[win] & face[win]
        own = mine & face
        flanks = (own & flank_only).sum() > 0.5 * max(int(own.sum()), 1)
        cells = src if src.any() else mine[win]
        key = (rows.min(), cols.min(), cells.shape, cells.tobytes(), flanks, landmark)
        if key not in fits:
            fits[key] = roof_planes.plausible_fit(
                h[win], cells, SLOPE, RES, EXTEND_CELLS, landmark, flanks
            )
        fit = fits[key]
        if fit is None:
            implausible.append(int(rid))
            continue
        sub = surface[win]
        sub[mine[win]] = fit[0][mine[win]]
        if fit[1] is not None:
            gables[int(rid)] = (win, *fit)
    return surface, implausible, gables


def _straight_eaves(h, lab, faces, surface, gables, small_cells: int) -> None:
    """A face drawn as flanks ends where its flanks reach their eaves: the
    cells of a level well below an eave (EAVE_WALL_M, a courtyard's roof)
    that the flank's plane still stands over join the face, within
    EAVE_REACH of it and downhill of it (`_downhill`) — with the level's
    pockets the joined cells close off —, and the face's cells past the
    eave where the scan lies on that level go to it: the wall between them
    runs along the eave's level line, not along the scan's blur. A step
    below the eave the scan shows (a terrace, a mansard's foot) stays the
    face's; so does a level all the gables together would leave smaller
    than `small_cells` or narrower than NARROW_M (`_kept_whole`). The
    gables are judged together, on the levels as merged; in place."""
    if not gables:
        return
    level = np.concatenate([[np.nan], _region_medians(lab, h, int(lab.max()))])
    plans = []
    for rid, (win, fit, eave) in gables.items():
        sub = lab[win]
        mine = sub == rid
        isface = faces[sub] & (sub > 0)
        # a cell whose centre lies within half a cell's fall of the eave
        # line is on it: every column along a flank turned off the grid
        # by a fraction of a degree ends the same way
        gy, gx = np.gradient(fit)
        with np.errstate(invalid="ignore"):
            lower = (sub > 0) & ~mine & ~isface & (level[sub] < eave - EAVE_WALL_M)
            reach = fit >= eave - 0.5 * np.hypot(gx, gy)
        take = lower & reach & ndi.binary_dilation(mine, iterations=EAVE_REACH)
        take &= _downhill(fit, mine)
        take |= _pockets(lower & ~take, mine | take, small_cells)
        give = mine & np.isfinite(eave) & ~reach
        give &= ndi.binary_dilation(lower, iterations=EAVE_REACH)
        to = fill_nearest(np.where(lower, sub, 0), lower) if give.any() else sub
        give &= np.abs(h[win] - level[to]) <= EAVE_WALL_M
        plans.append((rid, win, fit, take, give, to))
    taken = np.zeros(lab.shape, bool)
    for _, win, _, take, _, _ in plans:
        taken[win] |= take
    kept = _kept_whole(lab, taken, small_cells)
    for rid, win, fit, take, give, to in plans:
        sub, top = lab[win], surface[win]
        take &= ~np.isin(sub, kept)
        sub[give] = to[give]
        sub[take] = rid
        top[take] = fit[take]


def _pockets(rest: np.ndarray, closed: np.ndarray, small_cells: int) -> np.ndarray:
    """The pieces of `rest` under `small_cells` that `closed` shuts in: a
    level's pocket in the scan's wavy eave whose ends the face took."""
    shut = ndi.binary_fill_holes(closed) & rest
    pieces, n = ndi.label(shut)
    if not n:
        return shut
    small = np.bincount(pieces.ravel(), minlength=n + 1) < small_cells
    small[0] = False
    return small[pieces]


def _kept_whole(lab: np.ndarray, take: np.ndarray, small_cells: int) -> list[int]:
    """The regions `take` would leave — any piece of them — smaller than
    `small_cells` or narrower than NARROW_M where they were not: a strip
    between two wings' eaves, a corner pinched off by one, would stand as a
    box between their walls."""
    kept = []
    for r in np.unique(lab[take]):
        box = roof_planes.grown_box(lab == r, 1)
        region = lab[box] == r
        pieces, n = ndi.label(region & ~take[box])
        if not n:
            kept.append(int(r))
            continue
        sizes = np.bincount(pieces.ravel(), minlength=n + 1)[1:]
        thin = _narrow(pieces, n) & ~_narrow(region.astype(np.int64), 1)[0]
        if (sizes < small_cells).any() or thin.any():
            kept.append(int(r))
    return kept


def _downhill(fit: np.ndarray, mine: np.ndarray) -> np.ndarray:
    """The cells the surface `fit` falls to from the face's nearest cell,
    within EAVE_DOWNHILL_COS of its steepest way down: past an eave, not
    past a gable's end, where a flank's plane runs on level along its
    ridge over the roof beside it."""
    _, (nr, nc) = ndi.distance_transform_edt(~mine, return_indices=True)
    rows, cols = np.indices(fit.shape)
    dist = np.hypot(rows - nr, cols - nc)
    gy, gx = np.gradient(fit)
    return fit[nr, nc] - fit >= EAVE_DOWNHILL_COS * np.hypot(gx, gy) * dist


def measured_model(
    dom: np.ndarray,
    own: np.ndarray,
    roof: np.ndarray,
    green: np.ndarray,
    small_cells: int,
    with_faces: bool = True,
    narrow: bool = True,
    landmark: bool = False,
    scan: Scan | None = None,
) -> Model | None:
    """The roof over `own` cells: flat levels and (unless `with_faces` is
    off, the flat model) the measured faces; with them, unless `narrow` is
    off, no part narrower than NARROW_M. `scan`: the scan over `roof` and
    its faces' cells, when one model of the same cells was made before."""
    known = roof & ~green & np.isfinite(dom)
    if known.sum() < small_cells:
        return None
    scan = scan or Scan(scan_surface(dom, known), own)
    h = scan.h
    face, flank_only = np.zeros_like(own), np.zeros_like(own)
    if with_faces:
        face, flank_only = (c.copy() for c in scan.cells())
    for rounds in range(PLAUSIBLE_ROUNDS + 1):
        lab, faces = _regions(h, own, face, small_cells, with_faces, narrow)
        surface, implausible, gables = _plausible_faces(
            h, lab, faces, face, landmark, flank_only, scan.fits
        )
        if not implausible:
            break
        if rounds == PLAUSIBLE_ROUNDS:
            # still none after the last re-cut: drawn flat at its median
            faces[implausible] = False
            break
        # a face the scan shows no roof's shape on goes back to the levels,
        # its flank cells too: they no longer make a face flank-only
        face &= ~np.isin(lab, implausible)
        flank_only &= face
    drawn = {k: v for k, v in gables.items() if faces[k]}
    _straight_eaves(h, lab, faces, surface, drawn, small_cells)
    level = _region_medians(lab, h, int(lab.max()))
    return Model(lab, level, faces, surface)


@dataclass
class Scan:
    """The scan's surface over an object's roof (`scan_surface`) and, once
    asked for, the cells of `own` it draws as faces (`cells`)."""

    h: np.ndarray
    own: np.ndarray
    found: tuple[np.ndarray, np.ndarray] | None = None
    # the faces' fits by window and cells (`_plausible_faces`): a face no
    # round and no second model changed is not fitted again
    fits: dict = field(default_factory=dict)

    def cells(self) -> tuple[np.ndarray, np.ndarray]:
        """The face cells and those only the flank rule found (`_face_cells`)."""
        if self.found is None:
            self.found = _face_cells(self.h, self.own)
        return self.found


def _face_cells(h: np.ndarray, own: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    step = step_cells(h)
    sloped = inclined_cells(h, own) | roof_planes.planar_faces(h, own, step, SLOPE, RES)
    flanks = roof_planes.flank_cells(h, own, step, SLOPE, RES)
    # the ridge between two flanks is level for a cell or two
    found = sloped | flanks
    face = (ndi.binary_closing(found, structure=np.ones((3, 3), bool)) | found) & own & ~step
    return face, flanks & ~sloped


def extend_face(surface: np.ndarray, mine: np.ndarray) -> np.ndarray:
    """The face's surface carried past its cells: each outside cell on the
    plane of the face cells nearest it, at most EXTEND_CELLS out, level
    beyond — so the face's TIN runs on across its outline instead of
    bending there."""
    if not mine.any():
        return surface
    gx, gy, _ = roof_planes.local_planes(surface, mine, r=2)
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


def _majority(lab: np.ndarray) -> np.ndarray:
    """Each labelled cell takes the label most cells within OUTLINE_M of it
    carry (MAJORITY_PASSES times): a border between two parts runs as the
    scan's edge does, not along the grid's rows and columns — a diagonal
    one drawn cell by cell is a staircase of 1 m teeth, which no
    simplification below the stair's own size straightens."""
    r = int(OUTLINE_M / RES)
    disk = (np.hypot(*np.mgrid[-r : r + 1, -r : r + 1]) <= r).astype(np.float64)
    inside = lab > 0
    for _ in range(MAJORITY_PASSES):
        ids = np.unique(lab[inside])
        if len(ids) < 2:
            break
        # a cell's own label wins a tie
        votes = np.stack(
            [ndi.correlate((lab == i).astype(np.float64), disk) + 0.5 * (lab == i) for i in ids]
        )
        voted = np.where(inside, ids[np.argmax(votes, axis=0)], 0).astype(lab.dtype)
        # a part the vote would wipe out keeps its cells: every region of
        # the model is drawn
        lost = np.setdiff1d(ids, np.unique(voted[inside]))
        lab = np.where(np.isin(lab, lost), lab, voted)
    return lab


@dataclass
class Walls:
    """A building's walls at least WALL_MIN_M long: each one's line and its
    direction (radians, modulo π; `building_walls`)."""

    lines: np.ndarray
    dirs: np.ndarray

    def __len__(self) -> int:
        return len(self.dirs)


def building_walls(footprint) -> Walls:
    """The footprint's walls at least WALL_MIN_M long — a straight front
    split by vertices off it by under WALL_LINE_M (roof faces' corners in
    the union, the cadastre's nodes) one wall —, each wall within
    WALL_GROUP_DEG of a longer one taking their length-weighted mean
    direction: two walls of one front a fraction of a degree apart would
    snap its edges two ways, a step between them."""
    lines, theta, length = [], [], []
    for poly in shapely.get_parts(_polygonal(shapely.simplify(footprint, WALL_LINE_M))):
        if poly.geom_type != "Polygon":
            continue
        for ring in (poly.exterior, *poly.interiors):
            xy = np.asarray(ring.coords)[:, :2]
            d = np.diff(xy, axis=0)
            n = np.hypot(d[:, 0], d[:, 1])
            for k in np.flatnonzero(n >= WALL_MIN_M):
                lines.append(shapely.LineString(xy[k : k + 2]))
                theta.append(float(np.arctan2(d[k, 1], d[k, 0]) % np.pi))
                length.append(float(n[k]))
    tol = np.deg2rad(WALL_GROUP_DEG)
    groups: list[list] = []  # [first direction, weighted sum of e^2iθ, members]
    for i in np.argsort(length)[::-1]:
        for g in groups:
            if abs((theta[i] - g[0] + np.pi / 2) % np.pi - np.pi / 2) <= tol:
                g[1] += length[i] * np.exp(2j * theta[i])
                g[2].append(i)
                break
        else:
            groups.append([theta[i], length[i] * np.exp(2j * theta[i]), [i]])
    dirs = np.zeros(len(theta))
    for g in groups:
        dirs[g[2]] = np.angle(g[1]) / 2 % np.pi
    return Walls(np.asarray(lines, dtype=object), dirs)


def _cross(a, b) -> float:
    return float(a[0] * b[1] - a[1] * b[0])


def _snapped(theta: float, mid: np.ndarray, walls: Walls) -> tuple[float, np.ndarray | None] | None:
    """`theta` turned onto the direction of the nearest wall (in plan)
    among those within REGULAR_DEG of it — a wing's inner edge runs along
    its own outer wall, not along whichever wall of a bending block is
    closest in direction (a courtyard's side cut into teeth) — and, where
    the edge lies within WALL_ON_M of that wall, on the wall itself (its
    own line, not its group's mean direction): an edge along the outline
    is the outline, no sliver and no jog beside it. None off every wall."""
    if not len(walls):
        return None
    dev = (theta - walls.dirs + np.pi / 2) % np.pi - np.pi / 2
    ok = np.flatnonzero(np.abs(dev) <= np.deg2rad(REGULAR_DEG))
    if not len(ok):
        return None
    gap = shapely.distance(walls.lines[ok], shapely.Point(mid))
    k = ok[int(np.argmin(gap))]
    snap = float(theta - dev[k])
    if gap.min() > WALL_ON_M:
        return snap, None
    a, b = np.asarray(walls.lines[k].coords)[:, :2]
    u = (b - a) / np.hypot(*(b - a))
    if u @ np.array([np.cos(theta), np.sin(theta)]) < 0:
        u = -u
    return float(np.arctan2(u[1], u[0])), a + u * float(u @ (mid - a))


def _ring_lines(pts: np.ndarray, walls: Walls) -> list[list]:
    """The ring's edges as lines [point, direction, snapped, first, last
    corner index, length, on a wall]: an edge near a wall's direction
    turned onto it (`_snapped`),
    a run of them in one line merged where they lie within REGULAR_JOG_M,
    a short edge off every wall (a rounded corner's chamfer) left out."""
    n = len(pts)
    lines: list[list] = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        d = b - a
        length = float(np.hypot(*d))
        theta = float(np.arctan2(d[1], d[0]))
        snap = _snapped(theta, (a + b) / 2, walls) if length >= REGULAR_MIN_M else None
        if snap is None and length < REGULAR_KEEP_M:
            continue
        if snap is None:
            line = [(a + b) / 2, d / length, False, i, (i + 1) % n, length, False]
        else:
            u = np.array([np.cos(snap[0]), np.sin(snap[0])])
            on = snap[1] is not None
            line = [snap[1] if on else (a + b) / 2, u, True, i, (i + 1) % n, length, on]
        if lines and _one_line(lines[-1], line):
            lines[-1] = _joined(lines[-1], line)
            continue
        lines.append(line)
    # a ring that starts along a wall: its first line and its last are one
    if len(lines) > 3 and _one_line(lines[-1], lines[0]):
        lines[0] = _joined(lines.pop(), lines[0])
    return lines


def _one_line(prev: list, line: list) -> bool:
    """Two of `_ring_lines`' lines on one wall's direction within
    REGULAR_JOG_M of each other — two on walls only on one wall's line
    (a jog in the footprint stays a jog)."""
    jog = STRAIGHT_M if prev[6] and line[6] else REGULAR_JOG_M
    return (
        prev[2]
        and line[2]
        and abs(abs(float(prev[1] @ line[1])) - 1) < 1e-9
        and abs(_cross(prev[1], line[0] - prev[0])) <= jog
    )


def _joined(prev: list, line: list) -> list:
    """`prev` and the `line` after it as one line, through their
    length-weighted middle — or on the wall where one of them lies on it."""
    w0, w1 = prev[5], line[5]
    if prev[6] != line[6]:
        mid = prev[0] if prev[6] else line[0]
    else:
        mid = (prev[0] * w0 + line[0] * w1) / (w0 + w1)
    return [mid, prev[1], True, prev[3], line[4], w0 + w1, prev[6] or line[6]]


def _regular_ring(coords, walls: Walls) -> list:
    """The ring with its edges on the walls' directions and its corners
    where their lines cross (`_ring_lines`); a corner that would stand more
    than REGULAR_MOVE_M off the points it stands for keeps them."""
    pts = np.asarray(coords)[:-1, :2]
    lines = _ring_lines(pts, walls) if len(pts) >= 4 else []
    if len(lines) < 3 or not any(line[2] for line in lines):
        return list(coords)
    out = []
    n = len(pts)
    for j, line in enumerate(lines):
        prev = lines[j - 1]
        # the points between the two lines this corner stands for
        span = [(prev[4] + k) % n for k in range((line[3] - prev[4]) % n + 1)]
        p, u, q, v = prev[0], prev[1], line[0], line[1]
        det = _cross(u, v)
        if abs(det) < np.sin(np.deg2rad(REGULAR_DEG)):
            # parallel: a jog, each line's foot of the point between them
            c = pts[span[len(span) // 2]]
            corners = [p + u * float(u @ (c - p)), q + v * float(v @ (c - q))]
        else:
            t = _cross(q - p, v) / det
            corners = [p + u * t]
        # off the stretch of the ring it stands for, not the ring anywhere:
        # across a narrow part every point lies near the other side
        here = shapely.LineString(pts[span]) if len(span) > 1 else shapely.Point(pts[span[0]])
        if max(here.distance(shapely.Point(c)) for c in corners) > REGULAR_MOVE_M:
            corners = [pts[k] for k in span]
        out.extend(corners)
    out.append(out[0])
    return [tuple(map(float, c)) for c in out]


def regular_polygon(poly: shapely.Geometry, walls: Walls) -> shapely.Geometry:
    """`poly` with its rings regularised (`_regular_ring`), each of its
    parts on its own; itself where that makes it invalid or changes its
    area by a fifth."""
    if not len(walls):
        return poly
    if poly.geom_type == "MultiPolygon":
        return shapely.union_all([regular_polygon(p, walls) for p in poly.geoms])
    if poly.geom_type != "Polygon":
        return poly
    out = shapely.Polygon(
        _regular_ring(poly.exterior.coords, walls),
        [_regular_ring(r.coords, walls) for r in poly.interiors],
    )
    if not out.is_valid or abs(out.area - poly.area) > 0.2 * poly.area:
        out = _polygonal(out)
        if out.is_empty or abs(out.area - poly.area) > 0.2 * poly.area:
            return poly
    return out


def _polygonal(g: shapely.Geometry) -> shapely.Geometry:
    """The polygons in `g`, made valid, however nested (a difference's
    slivers and lines dropped)."""
    g = shapely.make_valid(g)
    parts = [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon")]
    nested = [q for p in parts for q in shapely.get_parts(p)]
    return shapely.union_all(nested) if nested else shapely.Polygon()


def regular_cover(polys: list, order: list[int], footprint, walls: Walls) -> list:
    """The coverage's parts regularised against the building's `walls`
    (`regular_polygon`), within `footprint`, and tiled again in `order` (a
    higher roof's walls first, so a step runs along its outline): each
    takes what its new outline holds that no part before it took; a gap
    none took goes to a part beside it (`_gap_owner`)."""
    if not len(walls):
        return polys
    try:
        return _retiled(polys, order, footprint, walls)
    except shapely.errors.GEOSException:
        # an overlay GEOS cannot settle even on the centimetre grid: as simplified
        return polys


def _retiled(polys: list, order: list[int], footprint, walls: Walls) -> list:
    """`regular_cover`'s tiling, every overlay on the centimetre grid the
    file is written on (snap-rounded, so slivers between nearly equal
    edges do not trip GEOS)."""
    g = TILE_GRID_M
    taken = shapely.Polygon()
    out: list = [None] * len(polys)
    for i in order:
        new = _polygonal(
            shapely.intersection(regular_polygon(polys[i], walls), footprint, grid_size=g)
        )
        out[i] = _polygonal(shapely.difference(new, taken, grid_size=g))
        taken = _polygonal(shapely.union(taken, out[i], grid_size=g))
    left = _polygonal(shapely.difference(shapely.union_all(polys, grid_size=g), taken, grid_size=g))
    rank = {i: n for n, i in enumerate(order)}
    # each old part's share of the gaps on its own: a gap strip running
    # along several borders is several gaps
    near = {i: shapely.buffer(out[i], 3 * g) for i in rank if not out[i].is_empty}
    for i in order:
        share = _polygonal(shapely.intersection(left, polys[i], grid_size=g))
        for piece in shapely.get_parts(share):
            k = _gap_owner(piece, near, rank, i)
            out[k] = _polygonal(shapely.union(out[k], piece, grid_size=g))
            near[k] = shapely.buffer(out[k], 3 * g)
        left = _polygonal(shapely.difference(left, share, grid_size=g))
    return out


def _gap_owner(piece, near: dict, rank: dict, old: int) -> int:
    """Which part a gap the regularised outlines left takes: the lowest of
    the parts it lies beside along GAP_TOUCH_M or more (and a quarter of
    its longest contact) — between a higher roof's straight wall and a
    lower one's the lower runs on up to that wall, not back to the scan's
    wavy border — else `old`, whose outline held it. `near`: each
    non-empty part grown by a few grid steps (on the centimetre grid a gap
    and a part seldom share a line exactly)."""
    edge = piece.boundary
    touch = {i: shapely.length(shapely.intersection(edge, q)) for i, q in near.items()}
    least = max(GAP_TOUCH_M, 0.25 * max(touch.values(), default=0.0))
    beside = [i for i, n in touch.items() if n >= least]
    return max(beside, key=rank.get) if beside else old


def clean_cover(polys: list) -> list:
    """The tiled parts as one coverage again — their borders noded, a
    sliver no part holds (the overlays' centimetre grid) given to the part
    beside it along most of its outline — and its inner borders simplified
    by CLEAN_M (`coverage_simplify`; the footprint's outline kept): the
    notches where two regularised borders meet a centimetre or a few
    apart, each a wall and a vertex more in the mesh, gone."""
    if len(polys) < 2:
        return polys
    try:
        cover = _noded_cover(polys)
        if cover is None or not shapely.coverage_is_valid(cover):
            return polys
        return list(shapely.coverage_simplify(cover, CLEAN_M, simplify_boundary=False))
    except shapely.errors.GEOSException:
        # as in `regular_cover`: an overlay GEOS cannot settle, the parts as tiled
        return polys


def _noded_cover(polys: list) -> np.ndarray | None:
    """`clean_cover`'s coverage before its simplification: the parts'
    borders noded, each face to the part holding it, a small one none
    holds to the part along most of its outline."""
    lines = shapely.union_all([shapely.boundary(p) for p in polys if not p.is_empty])
    faces = np.asarray(shapely.get_parts(shapely.polygonize(shapely.get_parts(lines))))
    if not len(faces):
        return None
    inner = shapely.point_on_surface(faces)
    owner = np.full(len(faces), -1)
    for i, p in enumerate(polys):
        owner[(owner < 0) & shapely.contains(p, inner)] = i
    slivers = np.flatnonzero((owner < 0) & (shapely.area(faces) < GAP_FACE_M2))
    if len(slivers):
        near = shapely.buffer(np.asarray(polys), TILE_GRID_M)
        for f in slivers:
            touch = shapely.length(shapely.intersection(faces[f].boundary, near))
            owner[f] = int(np.argmax(touch))
    return np.asarray([_polygonal(shapely.union_all(faces[owner == i])) for i in range(len(polys))])


def _straightened(polys: list) -> list:
    """The parts with the points on their straight edges dropped (within
    STRAIGHT_M of their neighbours' line: where a border met an edge in the
    tiling, each one more wall in the mesh) — as one coverage, so two
    neighbours drop the same points of the border they share and no crack
    or overlap opens along it; each part alone only where they are none."""
    try:
        cover = np.asarray(polys, dtype=object)
        if len(polys) > 1 and shapely.coverage_is_valid(cover):
            return list(shapely.coverage_simplify(cover, STRAIGHT_M, simplify_boundary=True))
    except shapely.errors.GEOSException:
        pass
    return [shapely.simplify(shapely.make_valid(p), STRAIGHT_M) for p in polys]


def region_polygons(
    lab: np.ndarray, heights: np.ndarray, grid: Grid, footprint, outline=None
) -> list[tuple[shapely.Geometry, float, int]]:
    """The regions in plan: polygonised, simplified as one coverage, its
    edges along the walls of `outline` (the building's own, uncut by
    another roof's cells; the footprint where None: `regular_cover`),
    clipped to the footprint; each with its height and label."""
    # every footprint point under a region: the labels grown outward a cell
    grown = fill_nearest(lab, lab > 0)
    near = ndi.binary_dilation(lab > 0, iterations=2)
    grown = _majority(np.where(near, grown, 0).astype(np.int32))
    polys, ids = [], []
    for geom, value in rfeatures.shapes(grown, mask=grown > 0, transform=grid.transform):
        polys.append(shapely.geometry.shape(geom))
        ids.append(int(value))
    if not polys:
        return []
    cover = shapely.coverage_simplify(
        np.asarray(polys, dtype=object), SIMPLIFY_M, simplify_boundary=False
    )
    cover = [_polygonal(shapely.intersection(p, footprint)) for p in cover]
    order = sorted(range(len(cover)), key=lambda i: -heights[ids[i] - 1])
    walls = building_walls(footprint if outline is None else outline)
    cover = _straightened(clean_cover(regular_cover(cover, order, footprint, walls)))
    out = []
    for poly, rid in zip(cover, ids, strict=True):
        # on the centimetre grid the file is written on, so it stays valid
        clipped = shapely.set_precision(shapely.make_valid(poly), 0.01)
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


def landmark_objects(tile: Tile) -> set[str]:
    """The LoD2 objects of the landmarks of this tile and the tiles it
    touches within MARGIN_M (landmarks.py: a landmark is listed by the tile
    under its point, its objects may be a neighbour's)."""
    xmin, ymin, xmax, ymax = tile.bounds
    out: set[str] = set()
    for tid, (left, bottom, right, top) in tile.neighbours():
        if (
            left > xmax + MARGIN_M
            or right < xmin - MARGIN_M
            or bottom > ymax + MARGIN_M
            or top < ymin - MARGIN_M
        ):
            continue
        path = tile.data / "dlm" / f"landmarks_{tid}.json"
        if path.exists():
            for lm in json.loads(path.read_text()).get("landmarks", []):
                out.update(lm.get("objects", []))
    return out


class Area:
    """The tile and `MARGIN_M` around it, read once: DOM1, the crowns
    (NDVI), the highest LoD2 roof of every object and the site's landmarks'
    objects."""

    def __init__(self, tile: Tile, objects: list[LodObject]):
        self.landmarks = landmark_objects(tile)
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
    if miss_lod2 <= LEVEL_MISS_SHARE or form_holds(roof[judged], dom[judged]):
        return None
    # one scan for every judgement and model of these cells (the models'
    # `known` cells are the judged ones)
    scan = Scan(scan_surface(dom, judged), own)
    if miss_lod2 <= MISS_SHARE and (
        level_share(roof, dom, scan.h, judged) < LEVEL_SHARE
        or pitch_holds(roof, scan.h, own, judged)
    ):
        return None
    # the scan sees open ground over much of it: the footprint is out of date
    # (a block torn down since), not just the roof
    if float((dom[judged] < obj.base + GROUND_M).mean()) > OPEN_SHARE:
        return None
    small = int(MIN_PART_M2 / (RES * RES))
    flat = measured_model(dom, own, inner, green, small, with_faces=False, scan=scan)
    if flat is None:
        return None
    miss_model = miss_share(flat.heights(), dom, judged & (flat.lab > 0))
    if miss_model > KEEP_SHARE or miss_model > miss_lod2 / 2:
        return None
    landmark = obj.id in area.landmarks
    model = measured_model(dom, own, inner, green, small, landmark=landmark, scan=scan)
    if model is None:
        return None

    # the strips merged away may have stood a storey off their new level:
    # where that makes the drawn roof miss more than the flat model may (a
    # hall's monitor roofs, 5 m strips 3 m over the rest, merged into blocks
    # that miss as much as the LoD2 did), they stay
    def misses(m: Model) -> bool:
        drawn = miss_share(m.heights(), dom, judged & (m.lab > 0))
        return drawn > KEEP_SHARE or drawn > miss_lod2 / 2

    if misses(model):
        model = measured_model(
            dom, own, inner, green, small, narrow=False, landmark=landmark, scan=scan
        )
        # the faces' own merges may still miss more: then the flat model,
        # which met the bar, is drawn (a LoD2 off on 88 % stays no better)
        if model is None or misses(model):
            model = flat
    # the footprint's own outline, less what another roof covers — each
    # piece of it whole, not one holding no 3 × 3 square (a neighbour's
    # eave reaching over the party wall: a notch a metre deep every few
    # metres along it) —, the cut's raster steps smoothed to its lines
    outline = footprint
    under = covered & np.isfinite(roof)
    pieces, _ = ndi.label(under)
    wide = np.unique(pieces[ndi.binary_opening(under, structure=np.ones((3, 3), bool))])
    mask = np.isin(pieces, wide[wide > 0])
    if mask.any():
        shapes = rfeatures.shapes(mask.astype(np.uint8), mask=mask, transform=grid.transform)
        cut = shapely.union_all([shapely.geometry.shape(g) for g, _ in shapes])
        footprint = _polygonal(shapely.difference(footprint, shapely.simplify(cut, CUT_SMOOTH_M)))
    parts = []
    for poly, z, rid in region_polygons(model.lab, model.level, grid, footprint, outline):
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
