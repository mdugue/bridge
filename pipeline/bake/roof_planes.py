"""What a measured roof face may be drawn as (roofs.py, ADR 0036): planes,
one extruded profile, or — on a landmark only — the scan itself
(`plausible_surface`).

DOM1's 1 m cells over a roof are its tiles, gutters, skylights, snow
guards, dormers and a metre of blur at every edge. Drawn as they are, even
smoothed, a pitched roof reads as a crumpled blanket and a ring of gables
as a dune (An der Frauenkirche 5, the block around the Hilton's
courtyard). Roofs are built of planes: a gable is two, a hip four, a
mansard eight; a vault is the rare roof that curves, and then the same all
along its axis. So a face is drawn as what it most plausibly is:

1. **planes** (`plane_facets`): grown from the smoothest cells outward,
   every cell within `PLANE_TOL_M` of its facet's plane, each facet at
   least `FACET_M2` and holding a disk `FACET_W_M` across; the border
   between two moved to where their planes cross (`settle_borders`): a
   ridge, a valley, a hip. They are the face when they explain
   `PLANAR_SHARE` of it and turn the ways one roof's flanks turn
   (`orderly`);
2. else **one profile extruded along an axis** (`curved_surface`): a
   barrel, a shed's curve, where the scan stays within `CURVE_TOL_M` of it
   on `PLANAR_SHARE` of a face of at least `CURVE_M2` and it stands
   `CURVE_MIN_M` off a plane;
3. else, on a **landmark** — Wikidata vouches that the building is that
   unusual — the scan's own surface, smoothed (`measured_surface`: the
   Hauptbahnhof's ribbed vaults; a landmark takes planes only where they
   explain `LANDMARK_PLANAR_SHARE` of the face);
4. else **nothing**: the face's cells go back to the flat levels.

`planar_faces` finds the faces the slope rules of roofs.py miss: the
inclined planes of a roof too narrow or too gentle for them.
"""

from __future__ import annotations

from collections import deque

import numpy as np
from scipy import ndimage as ndi

PLANE_TOL_M = 0.3  # a cell this close to its facet's plane belongs to it
FACET_M2 = 15.0  # a smaller facet is a dormer, a skylight, a chimney's foot
PLANAR_SHARE = 0.75  # what the planes, or the curve, must explain of a face
LANDMARK_PLANAR_SHARE = 0.9  # ... of a landmark's, whose own surface is the alternative
ALIGN_DEG = 15.0  # a facet turned within this of the roof's axis (or its right angle)
ALIGNED_SHARE = 0.7  # of the inclined facets' area
CURVE_M2 = 200.0  # a smaller face is no evidence of a vault or a dome
CURVE_TOL_M = 0.35
CURVE_STEP_DEG = 2.0  # the axes tried
CURVE_SMOOTH = 1.0  # σ (m) of the profile's smoothing
CURVE_MIN_M = 1.0  # the face must stand this far off its plane (95th percentile)
SURFACE_SMOOTH = 1.0  # σ (cells) of a landmark face's edge-preserving blur
SURFACE_STEP_M = 1.0  # σ of the height difference it still mixes
SURFACE_PASSES = 2
REFIT_GROWTH = 1.5  # a growing facet refits its plane each time it grows this much
SETTLE_PASSES = 4
SETTLE_GAIN_M = 0.05  # a border cell changes facet when the other plane is this much closer
FACET_W_M = 4.0  # a facet must hold a disk this wide


def _plane(rows: np.ndarray, cols: np.ndarray, z: np.ndarray) -> np.ndarray:
    """(a, b, c) of z = a + b·col + c·row, least squares."""
    a = np.column_stack([np.ones(len(rows)), cols, rows])
    coef, *_ = np.linalg.lstsq(a, z, rcond=None)
    return coef


def _on(coef: np.ndarray, rows, cols) -> np.ndarray:
    return coef[0] + coef[1] * cols + coef[2] * rows


def local_planes(h: np.ndarray, mine: np.ndarray, r: int = 1):
    """Per cell, the slope (d/dcol, d/drow) of the plane fitted to the cells
    of `mine` within `r` of it, and how far the cell itself stands off it."""
    dy, dx = np.mgrid[-r : r + 1, -r : r + 1].astype(np.float64)
    w = mine.astype(np.float64)
    z = np.where(mine, h, 0.0)

    def conv(a, k):
        return ndi.correlate(a, k, mode="constant")

    s1, sx, sy = conv(w, np.ones_like(dx)), conv(w, dx), conv(w, dy)
    sxx, sxy, syy = conv(w, dx * dx), conv(w, dx * dy), conv(w, dy * dy)
    sz, sxz, syz = conv(z, np.ones_like(dx)), conv(z, dx), conv(z, dy)
    m = np.stack(
        [np.stack([s1, sx, sy], -1), np.stack([sx, sxx, sxy], -1), np.stack([sy, sxy, syy], -1)],
        -2,
    )
    rhs = np.stack([sz, sxz, syz], -1)
    ok = np.abs(np.linalg.det(m)) > 1e-6
    sol = np.zeros(rhs.shape)
    sol[ok] = np.linalg.solve(m[ok], rhs[ok][..., None])[..., 0]
    # the plane through the neighbourhood, at the cell itself: its offset
    off = np.where(ok, np.abs(sol[..., 0] - h), np.inf)
    return sol[..., 1], sol[..., 2], off


def _grow(h, mine, lab, seed, gx, gy, label) -> tuple[list[tuple[int, int]], np.ndarray]:
    """One facet grown from `seed` over free cells of `mine` within
    PLANE_TOL_M of its plane (refitted as it grows)."""
    r0, c0 = seed
    coef = np.array([h[r0, c0] - gx[seed] * c0 - gy[seed] * r0, gx[seed], gy[seed]])
    members = [seed]
    lab[seed] = label
    queue = deque([seed])
    fitted_at = 1
    rows, cols = h.shape
    while queue:
        r, c = queue.popleft()
        for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if not (0 <= rr < rows and 0 <= cc < cols) or not mine[rr, cc] or lab[rr, cc]:
                continue
            if abs(_on(coef, rr, cc) - h[rr, cc]) > PLANE_TOL_M:
                continue
            lab[rr, cc] = label
            members.append((rr, cc))
            queue.append((rr, cc))
        if len(members) >= fitted_at * REFIT_GROWTH and len(members) >= 6:
            mr, mc = np.asarray(members).T
            coef = _plane(mr, mc, h[mr, mc])
            fitted_at = len(members)
    mr, mc = np.asarray(members).T
    return members, _plane(mr, mc, h[mr, mc])


def settle_borders(h: np.ndarray, lab: np.ndarray, planes: dict[int, np.ndarray]) -> np.ndarray:
    """Each cell beside another facet goes to whichever of the two planes
    stands closer to the scan there: the border runs where the planes cross
    (a ridge, a valley), not where the growing happened to stop."""
    rows, cols = np.indices(lab.shape)
    coef = np.zeros((max(planes) + 1, 3))
    for k, p in planes.items():
        coef[k] = p
    for _ in range(SETTLE_PASSES):
        moved = False
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nb = np.zeros_like(lab)
            src = (
                slice(max(dr, 0), lab.shape[0] + min(dr, 0)),
                slice(max(dc, 0), lab.shape[1] + min(dc, 0)),
            )
            dst = (
                slice(max(-dr, 0), lab.shape[0] + min(-dr, 0)),
                slice(max(-dc, 0), lab.shape[1] + min(-dc, 0)),
            )
            nb[dst] = lab[src]
            edge = (lab > 0) & (nb > 0) & (nb != lab)
            if not edge.any():
                continue
            r, c = rows[edge], cols[edge]
            own = _on(coef[lab[edge]].T, r, c)
            other = _on(coef[nb[edge]].T, r, c)
            better = np.abs(other - h[edge]) + SETTLE_GAIN_M < np.abs(own - h[edge])
            if better.any():
                lab[r[better], c[better]] = nb[edge][better]
                moved = True
        if not moved:
            break
    return lab


def plane_facets(h: np.ndarray, mine: np.ndarray, res: float = 1.0):
    """The face's planes: labels (0: on none) and each label's (a, b, c)."""
    gx, gy, off = local_planes(h, mine)
    lab = np.zeros(h.shape, np.int64)
    rows, cols = np.nonzero(mine)
    order = np.argsort(off[rows, cols], kind="stable")
    tried = np.zeros(h.shape, bool)
    planes: dict[int, np.ndarray] = {}
    min_cells = FACET_M2 / (res * res)
    label = 0
    for i in order:
        seed = (int(rows[i]), int(cols[i]))
        if lab[seed] or tried[seed] or off[seed] > PLANE_TOL_M:
            continue
        members, coef = _grow(h, mine, lab, seed, gx, gy, label + 1)
        if len(members) < min_cells:
            # too small to be a facet: free again, never a seed again
            mr, mc = np.asarray(members).T
            lab[mr, mc] = 0
            tried[mr, mc] = True
            continue
        label += 1
        planes[label] = coef
    if planes:
        lab = settle_borders(h, lab, planes)
        # a facet the settling shrank under its size is no facet
        counts = np.bincount(lab.ravel(), minlength=label + 1)
        for k in list(planes):
            if counts[k] < min_cells:
                lab[lab == k] = 0
                del planes[k]
    return lab, planes


def fill_nearest(values: np.ndarray, known: np.ndarray) -> np.ndarray:
    """Every cell takes the value of the nearest known cell."""
    _, (r, c) = ndi.distance_transform_edt(~known, return_indices=True)
    return values[r, c]


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


def measured_surface(h: np.ndarray, mine: np.ndarray, reach: int) -> np.ndarray:
    """A landmark's face as the scan shows it: the scan on its cells (the
    cells around filled from them: a dormer or a crane stays off the
    roof), blurred SURFACE_PASSES times over the face and `reach` cells
    around it, edges kept (`_edge_preserving`): the tiles, skylights and
    snow guards of a 1 m scan smoothed out, a dome's or a vault's curve
    kept."""
    v = fill_nearest(h, mine)
    w = ndi.binary_dilation(mine, iterations=reach).astype(np.float64)
    for _ in range(SURFACE_PASSES):
        v = _edge_preserving(v, w)
    return v


def _profile(u: np.ndarray, z: np.ndarray, bins: int) -> np.ndarray:
    """The median height per 1 m bin of `u` (NaN where a bin is empty)."""
    order = np.argsort(u, kind="stable")
    bounds = np.searchsorted(u[order], np.arange(bins + 1))
    out = np.full(bins, np.nan)
    for i in range(bins):
        if bounds[i + 1] > bounds[i]:
            out[i] = np.median(z[order[bounds[i] : bounds[i + 1]]])
    return out


def curved_surface(h: np.ndarray, mine: np.ndarray, res: float = 1.0) -> np.ndarray | None:
    """The face as one extruded profile — a vault, a barrel, a shed's
    curve: the height a function of the distance across one axis, the same
    all along it — where the scan stays within CURVE_TOL_M of it on
    PLANAR_SHARE of the face and it stands CURVE_MIN_M off a plane; else
    None. A crumpled blanket has no such axis."""
    if mine.sum() < CURVE_M2 / (res * res):
        return None
    rows, cols = np.nonzero(mine)
    z = h[rows, cols]
    best = None
    for theta in np.deg2rad(np.arange(0.0, 180.0, CURVE_STEP_DEG)):
        u = cols * np.cos(theta) + rows * np.sin(theta)
        u = u - u.min()
        k = np.round(u).astype(np.int64)
        prof = _profile(k.astype(np.float64), z, int(k.max()) + 1)
        share = float((np.abs(z - prof[k]) <= CURVE_TOL_M).mean())
        if best is None or share > best[0]:
            best = (share, theta, prof)
    share, theta, prof = best
    if share < PLANAR_SHARE:
        return None
    flat = _on(_plane(rows, cols, z), rows, cols)
    if float(np.percentile(np.abs(z - flat), 95)) < CURVE_MIN_M:
        return None
    # the profile, gaps bridged and its 1 m steps smoothed, over the grid
    idx = np.arange(len(prof))
    ok = np.isfinite(prof)
    prof = ndi.gaussian_filter1d(np.interp(idx, idx[ok], prof[ok]), CURVE_SMOOTH, mode="nearest")
    gr, gc = np.indices(h.shape)
    u0 = float((cols * np.cos(theta) + rows * np.sin(theta)).min())
    u = gc * np.cos(theta) + gr * np.sin(theta) - u0
    return np.interp(u, idx, prof)


def _wide(lab: np.ndarray, planes: dict, res: float) -> list[int]:
    """The facets that hold a disk FACET_W_M across."""
    disk = _disk(FACET_W_M, res)
    objs = ndi.find_objects(lab)
    out = []
    for k in planes:
        sl = objs[k - 1] if k - 1 < len(objs) else None
        if (
            sl is not None
            and ndi.binary_opening(np.pad(lab[sl] == k, disk.shape[0]), structure=disk).any()
        ):
            out.append(k)
    return out


def orderly(lab: np.ndarray, planes: dict, slope: float, res: float = 1.0) -> bool:
    """Whether the inclined facets face the ways one building's roof does:
    `ALIGNED_SHARE` of their area turned to within ALIGN_DEG of one axis
    or its right angle (a gable's two flanks, a hip's four, a mansard's
    eight). A patchwork of planes turned every way is a blanket cut into
    pieces, not a roof."""
    area, angle = [], []
    for k, coef in planes.items():
        if np.hypot(coef[1], coef[2]) / res > slope:
            area.append(float((lab == k).sum()))
            angle.append(np.arctan2(coef[2], coef[1]))
    if not area:
        return True
    w, a4 = np.asarray(area), 4 * np.asarray(angle)
    axis = np.arctan2((w * np.sin(a4)).sum(), (w * np.cos(a4)).sum())
    off = np.abs(np.angle(np.exp(1j * (a4 - axis)))) / 4
    return float(w[off <= np.deg2rad(ALIGN_DEG)].sum() / w.sum()) >= ALIGNED_SHARE


def plausible_surface(
    h: np.ndarray,
    mine: np.ndarray,
    slope: float,
    res: float = 1.0,
    reach: int = 4,
    landmark: bool = False,
) -> np.ndarray | None:
    """The face `mine` of the scan `h` over the whole grid as planes (each
    cell on the plane of the facet nearest it), as one extruded profile, or,
    on a `landmark`, as measured; else None (see the module's head)."""
    lab, planes = plane_facets(h, mine, res)
    # a facet a strip narrower than FACET_W_M is a vault's or a blob's slice
    wide = set(_wide(lab, planes, res))
    for k in [k for k in planes if k not in wide]:
        lab[lab == k] = 0
        del planes[k]
    # a landmark's face is drawn as planes only where they explain nearly
    # all of it: a vault the planes cover in strips stays the vault
    share = LANDMARK_PLANAR_SHARE if landmark else PLANAR_SHARE
    if planes and float((lab[mine] > 0).mean()) >= share and orderly(lab, planes, slope, res):
        _, (r, c) = ndi.distance_transform_edt(lab == 0, return_indices=True)
        near = lab[r, c]
        rows, cols = np.indices(h.shape)
        out = np.zeros(h.shape)
        for k, coef in planes.items():
            m = near == k
            out[m] = _on(coef, rows[m], cols[m])
        return out
    curve = curved_surface(h, mine, res)
    if curve is None and landmark:
        return measured_surface(h, mine, reach)
    return curve


def _disk(width_m: float, res: float) -> np.ndarray:
    r = width_m / res / 2
    k = int(np.floor(r))
    return np.hypot(*np.mgrid[-k : k + 1, -k : k + 1]) <= r


def planar_faces(
    h: np.ndarray, own: np.ndarray, step: np.ndarray, slope: float, res: float = 1.0
) -> np.ndarray:
    """The cells on a plane of the roof (`plane_facets` over its cells,
    steps aside) rising more than `slope` m/m and holding a disk FACET_W_M
    across: a pitched roof's flank too narrow or too gentle for roofs.py's
    slope rules — a ring of gables around a courtyard, 8 m flanks at 18°,
    which they cut into a flight of 1 m terraces. A step's blurred flank
    holds no such disk, a dormer no such area."""
    lab, planes = plane_facets(h, own & ~step, res)
    inclined = [k for k, coef in planes.items() if np.hypot(coef[1], coef[2]) / res > slope]
    return np.isin(lab, _wide(lab, {k: planes[k] for k in inclined}, res))
