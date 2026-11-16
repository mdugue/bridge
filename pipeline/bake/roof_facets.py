"""A face drawn as flanks, as its planes' polygons in plan.

`roof_planes.gable_fit` leaves a label per cell and a plane per label; a
1 m grid of their heights cuts every ridge, hip and valley off between two
cell centres, and the build's TIN of it runs along them in steps. Here the
planes are cut where they cross: each border between two planes that meet
at a crease (the cells either side of it lie on their own side of the two
planes' crossing) becomes that crossing's straight line, a corner three
planes share their common point, the other borders
(a step between two houses of a row) the raster's, straightened; all cut
to the part's outline and noded, so two facets share a border point for
point. The build stands each facet on its plane (scripts/measured-roofs.ts).
"""

from __future__ import annotations

import numpy as np
import shapely
import shapely.affinity
from affine import Affine
from rasterio import features as rfeatures
from scipy import ndimage as ndi

from .roof_planes import label_borders

GRID_M = 0.01  # the facets' corners lie on this grid: two facets' shared points are equal
CREASE_SIDE = 0.8  # of a border's cells, either side, lie on their side of the crossing
CREASE_TURN = 0.05  # the two planes' gradients differ by this (m/m) or more
CREASE_ZONE = 3  # cells a border's point moves at most, onto the crossing's line
STAIR_M = 1.25  # a border's raster steps are straightened within this (the root of an area)
EDGE_M = 0.75  # ... and what is left of them between two corners, off the straight line
PAD = 3  # cells the labels are carried past their window
COVER = 1e-3  # how far (a share of its area) the facets may miss the outline


def _shapes(values: np.ndarray, transform: Affine):
    return [
        (shapely.geometry.shape(g), int(v))
        for g, v in rfeatures.shapes(values.astype(np.int32), transform=transform)
    ]


def _crease(sub: np.ndarray, d: np.ndarray, a: int, b: int) -> bool:
    """Whether `a` and `b` meet at a crease: the cells of `a` along its
    border with `b` lie where `a` is the lower plane and those of `b` where
    `b` is (a ridge, a hip), or each where it is the higher (a valley) —
    not two planes a step apart. `d`: per cell, plane a less plane b."""
    of_a = (sub == a) & ndi.binary_dilation(sub == b)
    of_b = (sub == b) & ndi.binary_dilation(sub == a)
    return any(
        (sense * d[of_a] > 0).mean() >= CREASE_SIDE and (sense * d[of_b] < 0).mean() >= CREASE_SIDE
        for sense in (-1, 1)
    )


def _polygons(g) -> list:
    """The polygons of `g`, those of a collection inside it too."""
    out = []
    for p in shapely.get_parts(g):
        if p.geom_type == "Polygon":
            out += [p] if p.area > 0 else []
        elif p.geom_type in ("MultiPolygon", "GeometryCollection"):
            out += _polygons(p)
    return out


def _areas(g) -> shapely.Geometry:
    """The polygons of `g` (an overlay on a grid leaves lines and points
    where a sliver collapsed, which the next overlay does not take)."""
    return g if g.geom_type in ("Polygon", "MultiPolygon") else shapely.MultiPolygon(_polygons(g))


def tidy(near: np.ndarray) -> np.ndarray:
    """The labels without their strips a cell wide (a plane's cells along
    another's border, where the scan's blur stood nearer it: a row of teeth
    once cut): each label keeps what holds a 2 × 2 square of it, the rest
    goes to the label nearest."""
    kept = np.zeros(near.shape, bool)
    square = np.ones((2, 2), bool)
    for k in np.unique(near):
        kept |= ndi.binary_opening(near == k, structure=square)
    if kept.all() or not kept.any():
        return near
    _, (r, c) = ndi.distance_transform_edt(~kept, return_indices=True)
    return near[r, c]


def crease_lines(
    near: np.ndarray, planes: dict[int, np.ndarray], res: float
) -> dict[tuple[int, int], np.ndarray]:
    """Per pair of labels meeting at a crease (`_crease`), the line their
    planes cross along, as (n, d): the points p with n · p = d, n of length
    one, in the grid's frame (`partition`)."""
    rows, cols = np.indices(near.shape)
    out = {}
    for a, b in label_borders(near):
        if a not in planes or b not in planes:
            continue
        d = planes[a] - planes[b]
        turn = float(np.hypot(d[1], d[2])) / res
        if turn < CREASE_TURN or not _crease(near, d[0] + d[1] * cols + d[2] * rows, a, b):
            continue
        # at the cells' centres: col = x / res − ½, row = −y / res − ½
        n = np.array([d[1] / res, -d[2] / res])
        out[a, b] = np.array([*(n / turn), -(d[0] - (d[1] + d[2]) / 2) / turn])
    return out


def _onto(p: np.ndarray, lines: list[np.ndarray], reach: float) -> np.ndarray:
    """`p` moved onto the line, or to the point nearest all of several
    (three planes' common corner); left where that lies beyond `reach`
    (two lines nearly parallel)."""
    n = np.array([line[:2] for line in lines])
    d = np.array([line[2] for line in lines])
    if len(lines) == 1:
        q = p + (d[0] - n[0] @ p) * n[0]
    else:
        q, *_ = np.linalg.lstsq(n, d, rcond=None)
        if np.linalg.matrix_rank(n, tol=0.1) < 2:
            q = p + (d[0] - n[0] @ p) * n[0]
    return q if np.hypot(*(q - p)) <= reach else p


def partition(
    near: np.ndarray, planes: dict[int, np.ndarray], res: float = 1.0
) -> dict[int, shapely.Geometry]:
    """Each label's cells as polygons on the grid's own frame (x along the
    columns, y against the rows, the first cell's outer corner at 0, 0):
    the raster's borders straightened (STAIR_M), then every point of a
    border between two planes that meet at a crease moved onto the line
    they cross along, and a corner several creases share to their common
    point — within CREASE_ZONE cells of where the labels put it. A crease
    is one straight edge from corner to corner. `planes`: z = a + b·col +
    c·row at the cells' centres."""
    pieces = _shapes(near, Affine(res, 0, 0, 0, -res, 0))
    # a point on every grid corner along the borders: neighbours share them
    polys = shapely.segmentize(np.array([p for p, _ in pieces], dtype=object), res)
    polys = shapely.coverage_simplify(polys, STAIR_M)
    labels = [k for _, k in pieces]
    lines = crease_lines(near, planes, res)
    # the labels meeting at each point
    at: dict[tuple[float, float], set[int]] = {}
    for poly, k in zip(polys, labels, strict=True):
        for xy in shapely.get_coordinates(poly):
            at.setdefault((float(xy[0]), float(xy[1])), set()).add(k)
    moved = {}
    for xy, ks in at.items():
        ks = sorted(ks)
        here = [lines[a, b] for i, a in enumerate(ks) for b in ks[i + 1 :] if (a, b) in lines]
        if here:
            moved[xy] = _onto(np.array(xy), here, CREASE_ZONE * res)
    by_label: dict[int, list] = {}
    for poly, k in zip(polys, labels, strict=True):
        to = shapely.transform(
            poly, lambda c: np.array([moved.get((float(x), float(y)), (x, y)) for x, y in c])
        )
        # a point moved past its border's end folds the ring: the fold cut off
        by_label.setdefault(k, []).append(to if to.is_valid else _areas(shapely.make_valid(to)))
    return {k: _areas(shapely.union_all(v)) for k, v in by_label.items()}


def _straight(noded, outline) -> shapely.Geometry:
    """The noded borders, each run between two corners straightened: a
    crease's points in a row (moved onto one line) are one edge, a step's
    raster stair a line within EDGE_M — for every facet along it alike; the
    part's own outline stays as it is."""
    edge = outline.boundary.buffer(GRID_M)
    out = []
    for line in shapely.get_parts(shapely.line_merge(noded)):
        out.append(shapely.simplify(line, 1.5 * GRID_M if edge.covers(line) else EDGE_M))
    return shapely.union_all(out, grid_size=GRID_M)


def face_facets(
    near: np.ndarray,
    planes: dict[int, np.ndarray],
    origin: tuple[float, float],
    poly: shapely.Geometry,
    res: float = 1.0,
) -> list[tuple[np.ndarray, shapely.Polygon]] | None:
    """The part `poly` cut into its planes' facets: each a polygon (corners
    on the GRID_M grid, shared borders point for point) and its plane
    z = a + b·(x − x0) + c·(y − y0) from `origin` (x0, y0), the outer corner
    of the labels' first cell (north-west). None where the facets do not
    cover the part or cannot be cut (the build then draws its grid)."""
    try:
        return _face_facets(near, planes, origin, poly, res)
    except shapely.errors.GEOSException:
        # an overlay GEOS cannot node on the grid (a ring folded twice)
        return None


def _face_facets(near, planes, origin, poly, res):
    x0, y0 = origin
    padded = np.pad(near, PAD, mode="edge")
    bx0, by0, bx1, by1 = poly.bounds
    # the cells the part reaches, two more around them
    c0 = max(int(np.floor((bx0 - x0) / res)) + PAD - 2, 0)
    c1 = min(int(np.ceil((bx1 - x0) / res)) + PAD + 2, padded.shape[1])
    r0 = max(int(np.floor((y0 - by1) / res)) + PAD - 2, 0)
    r1 = min(int(np.ceil((y0 - by0) / res)) + PAD + 2, padded.shape[0])
    if c1 <= c0 or r1 <= r0:
        return None
    sub = tidy(padded[r0:r1, c0:c1])
    if (sub <= 0).any():
        return None
    # planes on the cut's own cells: col = col' − (c0 − PAD), row likewise
    dc, dr = c0 - PAD, r0 - PAD
    local = {
        int(k): np.array([planes[k][0] + planes[k][1] * dc + planes[k][2] * dr, *planes[k][1:]])
        for k in np.unique(sub)
        if int(k) in planes
    }
    if len(local) < len(np.unique(sub)):
        return None
    ox, oy = x0 + dc * res, y0 - dr * res
    cut = _areas(shapely.set_precision(poly, GRID_M))
    lines, labelled = [], []
    for k, g in partition(sub, local, res).items():
        g = _areas(shapely.make_valid(shapely.affinity.translate(g, ox, oy)))
        for p in _polygons(_areas(shapely.intersection(g, cut, grid_size=GRID_M))):
            lines.append(p.boundary)
            labelled.append((k, p))
    if not labelled:
        return None
    noded = _straight(shapely.union_all(lines, grid_size=GRID_M), cut)
    tree = shapely.STRtree([p for _, p in labelled])
    out = []
    for cell in _polygons(shapely.polygonize([noded])):
        at = cell.representative_point()
        if not cut.covers(at):
            # a courtyard's cell: not the part's
            continue
        # the label there; in a sliver between two straightened borders, the nearest
        hit = tree.query(at, predicate="intersects")
        k = labelled[int(hit[0] if len(hit) else tree.nearest(at))][0]
        a, b, c = planes[k]
        # at the cells' centres: col = (x − x0) / res − ½, row = (y0 − y) / res − ½
        out.append((np.array([a - (b + c) / 2, b / res, -c / res]), cell))
    if abs(sum(c.area for _, c in out) - cut.area) > COVER * cut.area:
        return None
    return out
