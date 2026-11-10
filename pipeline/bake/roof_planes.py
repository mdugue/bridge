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

0. **flanks** (`gable_surface`, tried first): the scan smoothed past its
   dormers falls into patches facing one way (`_flank_classes`); each
   patch of at least `FLANK_M2` that rises `FLANK_RISE_M` is a flank, cut
   into sections where one plane does not hold it (`_sections`: a wing
   bending with its street, a row of houses whose ridges step), and its
   plane rises along that way alone, so eaves and ridge are level; two
   neighbouring flanks facing nearly opposite ways share one axis. They
   are the face when its cells lie on their planes or under a dormer on
   them (`GABLE_SHARE`), no flank sags (a vault's half), and their feet
   lie along the face's edge (`_eave`): a gable or a hip, however many
   dormers break its scan, and never a blanket whose patches rise from
   wherever the scan dips;
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
inclined planes of a roof too narrow or too gentle for them; `flank_cells`
its flanks, whose dormers break every plane. A face most of whose cells
only `flank_cells` found is drawn as flanks or not at all.
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
    k = np.floor(u).astype(np.int64)
    keep = (k >= 0) & (k < bins)
    k, zs = k[keep], z[keep]
    order = np.lexsort((zs, k))
    k, zs = k[order], zs[order]
    n = np.bincount(k, minlength=bins)
    start = np.concatenate(([0], np.cumsum(n)[:-1]))
    out = np.full(bins, np.nan)
    has = n > 0
    lo = start[has] + (n[has] - 1) // 2
    hi = start[has] + n[has] // 2
    out[has] = (zs[lo] + zs[hi]) / 2
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


# σ (cells) of the smoothing flanks are read on: a dormer's 2-3 m melts into its flank
FLANK_SIGMA = 1.5
FLANK_TOL_DEG = 35.0  # a cell turned within this of a flank's direction belongs to it
FLANK_M2 = 20.0  # a smaller patch facing one way is a dormer's cheek or a chimney's foot
FLANK_W_M = 3.0  # ... and so is one holding no square this wide
SECTION_FIT = 0.85  # a flank whose plane holds less of it is cut into sections (a bent wing)
SECTION_GAIN = 0.05  # ... where its halves fit their own planes this much better
SECTION_DEPTH = 4  # into at most 2⁴
# two neighbouring flanks turned within this of opposite share one axis: a level ridge
OPPOSITE_DEG = 15.0
FLANK_TOL_M = 0.5  # a cell this close to its flank's plane is explained by it
ROOFTOP_M = 3.0  # ... and one up to this above it carries a dormer, a chimney, a skylight
ROOFTOP_M2 = 30.0  # ... as long as what stands there is no larger
GABLE_SHARE = 0.85  # flanks are the face when they explain this much of it, rooftop cells included
LANDMARK_GABLE_SHARE = 0.95  # ... of a landmark's, whose own surface is the alternative
GABLE_ON_SHARE = 0.6  # ... and this much within FLANK_TOL_M of their planes
# a flank sagging this far off a plane across its fall line is a vault's half
FLANK_SAG_M = 0.5
FLANK_SHARE = 0.4  # the flanks hold this much of a face drawn as them
FLANK_RISE_M = 1.0  # a flank rises at least this: a skylight's, a vent's, a parapet's foot does not
# ... and takes this far across from a fifth to four fifths of its rise: a
# step between two levels (a raised block's edge) does it within a metre or two
FLANK_SPREAD_M = 1.5
CROWN_M = 4.0  # a crown between flanks lies within this of one
CROWN_DROP_M = 0.75  # ... and no more than this under the top of the flanks near it
ASSIGN_REACH = 4  # a cell on no flank takes the best plane among those this near
# a flank's foot (its lowest EAVE_LOW of cells) faces the face's edge within EAVE_DEG: an eave
EAVE_LOW = 30.0
EAVE_DEG = 25.0
EAVE_SHARE = 0.7  # ... on flanks holding this much of the flanks' cells


def _calm_smooth(h: np.ndarray, calm: np.ndarray, sigma: float) -> np.ndarray:
    """`h` smoothed over the `calm` cells alone (a normalised Gaussian):
    a wall's drop beside them does not leak into their slope."""
    w = ndi.gaussian_filter(calm.astype(np.float64), sigma)
    v = ndi.gaussian_filter(np.where(calm, h, 0.0), sigma)
    return np.where(w > 1e-3, v / np.maximum(w, 1e-3), h)


def _aspect_peaks(aspect: np.ndarray, weight: np.ndarray) -> np.ndarray:
    """The directions the roof's inclined cells face, the peaks of their
    slope-weighted aspect histogram (2° bins, smoothed over ±6°)."""
    bins = 180
    hist, _ = np.histogram(aspect, bins=bins, range=(-np.pi, np.pi), weights=weight)
    k = np.exp(-0.5 * (np.arange(-9, 10) / 3.0) ** 2)
    wrapped = np.concatenate([hist[-9:], hist, hist[:9]])
    smooth = np.convolve(wrapped, k, "same")[9:-9]
    floor = 0.005 * smooth.sum()
    up = smooth >= np.roll(smooth, 1)
    down = smooth > np.roll(smooth, -1)
    return -np.pi + (np.flatnonzero(up & down & (smooth > floor)) + 0.5) * 2 * np.pi / bins


def _direction(aspect: np.ndarray, weight: np.ndarray) -> float:
    return float(np.angle(np.sum(weight * np.exp(1j * aspect))))


def _fits(h: np.ndarray, sel: np.ndarray, phi: float) -> float:
    """The share of the flank's cells within FLANK_TOL_M of its plane."""
    plane, _ = _flank_plane(h, sel, phi)
    rows, cols = np.nonzero(sel)
    return float((np.abs(h[rows, cols] - _on(plane, rows, cols)) <= FLANK_TOL_M).mean())


def _cut(h: np.ndarray, sel: np.ndarray, phi: float, min_cells: float) -> float | None:
    """Where along the flank to cut it in two: the border between two
    cell-wide strips across it that best splits the scan's height off the
    flank's plane into two even runs (most of their variance between the
    two) — a party wall where the ridge steps, the middle of a bend —
    leaving `min_cells` on either side; None where none does."""
    rows, cols = np.nonzero(sel)
    plane, _ = _flank_plane(h, sel, phi)
    off = h[rows, cols] - _on(plane, rows, cols)
    along = -cols * np.sin(phi) + rows * np.cos(phi)
    along = along - along.min()
    k = np.floor(along).astype(np.int64)
    prof = _profile(along, off, int(k.max()) + 1)
    n = np.bincount(k).astype(np.float64)
    good = np.flatnonzero(np.isfinite(prof) & (n > 0))
    if len(good) < 2:
        return None
    w, v = n[good], prof[good]
    left_w, left_s = np.cumsum(w)[:-1], np.cumsum(w * v)[:-1]
    right_w, right_s = w.sum() - left_w, (w * v).sum() - left_s
    gain = left_w * right_w * (left_s / left_w - right_s / right_w) ** 2
    gain[(left_w < min_cells) | (right_w < min_cells)] = -1.0
    j = int(np.argmax(gain))
    if gain[j] < 0:
        return None
    # along the flank, from where it was measured
    return float(good[j + 1] + (-cols * np.sin(phi) + rows * np.cos(phi)).min())


def _sections(h, sel, aspect, weight, min_cells, depth=0) -> list[np.ndarray]:
    """A flank cut into sections where one plane does not hold it — town
    houses in a row whose ridges step, a wing that bends with its street:
    cut in two along its length (`_cut`), and each part again, where the
    sections fit their own planes better (SECTION_GAIN more of the cells)
    than the flank its one plane."""
    phi = _direction(aspect[sel], weight[sel])
    whole = _fits(h, sel, phi)
    if depth >= SECTION_DEPTH or sel.sum() < 2 * min_cells or whole >= SECTION_FIT:
        return [sel]
    cut = _cut(h, sel, phi, min_cells)
    if cut is None:
        return [sel]
    rows, cols = np.nonzero(sel)
    along = -cols * np.sin(phi) + rows * np.cos(phi)
    halves = []
    for side in (along < cut, along >= cut):
        m = np.zeros_like(sel)
        m[rows[side], cols[side]] = True
        lab, n = ndi.label(m)
        halves += [lab == j for j in range(1, n + 1) if (lab == j).sum() >= min_cells]
    if len(halves) < 2:
        return [sel]
    # judged on the sections it ends in: the first cut alone may gain
    # nothing (three houses, the outer two on one plane)
    out = []
    for p in halves:
        out += _sections(h, p, aspect, weight, min_cells, depth + 1)
    fit = sum(_fits(h, p, _direction(aspect[p], weight[p])) * p.sum() for p in out)
    if fit < (whole + SECTION_GAIN) * sum(p.sum() for p in out):
        return [sel]
    return out


def _flank_plane(h: np.ndarray, sel: np.ndarray, phi: float) -> tuple[np.ndarray, np.ndarray]:
    """The plane through the flank's cells rising along `phi` only (level
    eaves and ridge), fitted with the cells over it — a dormer, a chimney —
    trimmed away; (a, b, c) and whether it sags (a vault's half)."""
    rows, cols = np.nonzero(sel)
    t = cols * np.cos(phi) + rows * np.sin(phi)
    z = h[rows, cols]
    # a first line through the median height of each metre across the
    # flank, its first and last left out (the eave's blur, the ridge's
    # rounding): dormers and gutters do not move a median
    k = np.floor(t - t.min()).astype(np.int64)
    prof = _profile(t - t.min(), z, int(k.max()) + 1)
    n = np.bincount(k)
    centre = np.arange(len(prof)) + 0.5 + t.min()
    good = np.isfinite(prof) & (n >= 2)
    if good.sum() >= 5:
        good[np.flatnonzero(good)[[0, -1]]] = False
    if good.sum() >= 2:
        coef = np.polyfit(centre[good], prof[good], 1, w=np.sqrt(n[good]))[::-1]
    else:
        coef = np.array([float(np.median(z)), 0.0])
    keep = np.abs(z - (coef[0] + coef[1] * t)) <= FLANK_TOL_M
    for _ in range(3):
        if keep.sum() < 3:
            break
        a = np.column_stack([np.ones(keep.sum()), t[keep]])
        coef, *_ = np.linalg.lstsq(a, z[keep], rcond=None)
        keep = np.abs(z - (coef[0] + coef[1] * t)) <= FLANK_TOL_M
    plane = np.array([coef[0], coef[1] * np.cos(phi), coef[1] * np.sin(phi)])
    sag = False
    # its sag away from the eave and the ridge, which the scan rounds
    lo, hi = np.percentile(t[keep], (15, 85)) if keep.any() else (0.0, 0.0)
    mid = keep & (t >= lo) & (t <= hi)
    if mid.sum() >= 6 and hi - lo > 2:
        q = np.polyfit(t[mid], z[mid], 2)
        sag = abs(q[0]) * (hi - lo) ** 2 / 8 > FLANK_SAG_M
    return plane, np.asarray(sag)


def _flank_classes(h, calm, slope_min):
    """Per cell of `calm`: the smoothed surface, its slope and aspect, and
    which of the roof's directions it faces (0: none, level or between)."""
    hs = _calm_smooth(h, calm, FLANK_SIGMA)
    gy, gx = np.gradient(hs)
    slope = np.hypot(gx, gy)
    aspect = np.arctan2(gy, gx)
    inclined = calm & (slope > slope_min) & ndi.binary_erosion(calm, iterations=1)
    peaks = _aspect_peaks(aspect[inclined], slope[inclined])
    cls = np.zeros(h.shape, np.int64)
    if len(peaks) == 0:
        return hs, slope, aspect, cls, 0
    off = np.abs(np.angle(np.exp(1j * (aspect[..., None] - peaks))))
    cls = np.where(inclined & (off.min(-1) < np.deg2rad(FLANK_TOL_DEG)), off.argmin(-1) + 1, 0)
    # a majority over 3 × 3, twice: the speckle of tiles and snow guards out
    for _ in range(2):
        best = np.zeros_like(cls)
        count = np.zeros(h.shape)
        for c in range(1, len(peaks) + 1):
            n = ndi.uniform_filter((cls == c).astype(np.float64), 3)
            better = n > count
            best[better] = c
            count[better] = n[better]
        cls = np.where(calm & (count > 0.4), best, 0)
    return hs, slope, aspect, cls, len(peaks)


def _flank_cores(cls: np.ndarray, n: int, res: float):
    """Each direction's patches that hold a FLANK_W_M square and FLANK_M2."""
    square = np.ones((max(int(round(FLANK_W_M / res)), 1),) * 2, bool)
    min_cells = FLANK_M2 / (res * res)
    for c in range(1, n + 1):
        lab, k = ndi.label(ndi.binary_opening(cls == c, structure=square))
        sizes = np.bincount(lab.ravel(), minlength=k + 1)
        for j in np.flatnonzero(sizes >= min_cells):
            if j:
                yield lab == j


def _spread(h: np.ndarray, sel: np.ndarray, phi: float, res: float) -> float:
    """How far (m) across the patch its rise along `phi` takes from a fifth
    to four fifths, on the median height of each cell-wide strip of the
    scan (dormers do not move a median), the profile made monotone."""
    rows, cols = np.nonzero(sel)
    t = cols * np.cos(phi) + rows * np.sin(phi)
    t = t - t.min()
    k = np.floor(t).astype(np.int64)
    prof = _profile(t, h[rows, cols], int(k.max()) + 1)
    good = np.isfinite(prof) & (np.bincount(k) >= 2)
    if good.sum() < 3:
        return 0.0
    x = np.flatnonzero(good) + 0.5
    z = np.maximum.accumulate(prof[good])
    rise = z[-1] - z[0]
    if rise <= 0:
        return 0.0
    # strictly increasing for the interpolation
    z = z + np.arange(len(z)) * 1e-6
    lo, hi = np.interp([z[0] + 0.2 * rise, z[0] + 0.8 * rise], z, x)
    return float(hi - lo) * res


def _rising(pieces, h: np.ndarray, hs: np.ndarray, aspect, slope, res: float):
    """The pieces that rise FLANK_RISE_M or more, and steadily
    (FLANK_SPREAD_M): a roof's flank, not a skylight's, a vent's or a
    parapet's blurred foot, nor the edge of a block raised over a flat roof."""
    for piece in pieces:
        if np.ptp(hs[piece]) < FLANK_RISE_M:
            continue
        phi = _direction(aspect[piece], slope[piece])
        if _spread(h, piece, phi, res) >= FLANK_SPREAD_M:
            yield piece


def flank_cells(
    h: np.ndarray, own: np.ndarray, step: np.ndarray, slope: float, res: float = 1.0
) -> np.ndarray:
    """The cells of the roof's flanks (`flank_facets`): patches facing one
    way on the smoothed scan, at least FLANK_M2, holding a FLANK_W_M square
    and rising FLANK_RISE_M — a gable's flank even where its dormers break
    every plane — and the crown between them (`_crowns`)."""
    hs, grade, aspect, cls, n = _flank_classes(h, own & ~step, slope / res)
    out = np.zeros(own.shape, bool)
    for core in _rising(_flank_cores(cls, n, res), h, hs, aspect, grade, res):
        out |= core
    return out | _crowns(hs, out, own & ~step, res)


def _crowns(hs: np.ndarray, flanks: np.ndarray, calm: np.ndarray, res: float) -> np.ndarray:
    """The level cells between flanks at their top: a ridge rounded by the
    scan, a vault's or a mansard's crown — within CROWN_M of a flank and
    no more than CROWN_DROP_M under the highest flank cell near them."""
    reach = max(int(round(CROWN_M / res)), 1)
    size = 2 * reach + 1
    top = ndi.maximum_filter(np.where(flanks, hs, -np.inf), size=size)
    between = ndi.binary_closing(flanks, structure=np.ones((size, size), bool))
    return between & calm & ~flanks & (hs >= top - CROWN_DROP_M)


def _neighbours(lab: np.ndarray) -> set[tuple[int, int]]:
    pairs = set()
    for a, b in ((lab[:, :-1], lab[:, 1:]), (lab[:-1, :], lab[1:, :])):
        m = (a > 0) & (b > 0) & (a != b)
        pairs |= {(int(min(x, y)), int(max(x, y))) for x, y in zip(a[m], b[m], strict=True)}
    return pairs


def _assign(hs, lab, planes, mine, reach: int, held_on=None) -> np.ndarray:
    """Every cell of `mine` without a label to the plane, among the labels
    within `reach` of it, that stands closest to the smoothed scan there;
    beyond every reach, to the nearest label. With `held_on` (the scan),
    only to a plane that holds the cell — the scan on it or up to
    ROOFTOP_M over it — and no label elsewhere."""
    out = np.where(mine, fill_nearest(lab, lab > 0), 0) if held_on is None else lab.copy()
    free = mine & (lab == 0)
    if not free.any():
        return out
    rows, cols = np.indices(lab.shape)
    best = np.full(lab.shape, np.inf)
    for k, coef in planes.items():
        near = free & ndi.binary_dilation(lab == k, iterations=reach)
        if not near.any():
            continue
        on = _on(coef, rows[near], cols[near])
        err = np.abs(on - hs[near])
        if held_on is not None:
            off = held_on[near] - on
            err = np.where((off >= -FLANK_TOL_M) & (off <= ROOFTOP_M), err, np.inf)
        better = err < best[near]
        r, c = rows[near][better], cols[near][better]
        best[r, c] = err[better]
        out[r, c] = k
    return out


def _inward(mine: np.ndarray) -> np.ndarray:
    """Per cell, the way into the face from its nearest edge (the gradient
    of its smoothed distance from the edge)."""
    dist = ndi.distance_transform_edt(np.pad(mine, 1))[1:-1, 1:-1]
    gy, gx = np.gradient(ndi.gaussian_filter(dist, 1.0))
    return np.arctan2(gy, gx)


def _eave(piece: np.ndarray, hs: np.ndarray, inward: np.ndarray, phi: float) -> bool:
    """Whether the flank rises from an eave: its lowest cells lie along the
    face's edge, which they face within EAVE_DEG. A blanket's patches rise
    every way from wherever the scan dips."""
    low = piece & (hs <= np.percentile(hs[piece], EAVE_LOW))
    way = np.angle(np.sum(np.exp(1j * inward[low])))
    return bool(abs(np.angle(np.exp(1j * (way - phi)))) <= np.deg2rad(EAVE_DEG))


def flank_facets(h: np.ndarray, mine: np.ndarray, res: float = 1.0):
    """The face as flanks: labels over `mine`, each label's plane, and
    whether any flank sags. A flank is a patch facing one way on the scan
    smoothed past its dormers (`_flank_classes`), rising FLANK_RISE_M, cut
    into sections where one plane does not hold it; its plane rises along
    that way alone, so eaves and ridge are level; two neighbouring flanks
    turned nearly opposite share one axis, so their ridge is level too.
    A level patch between them (a crown, a mansard's top) is a level
    plane; what is left takes planes of its own (`plane_facets`), and every
    other cell the plane near it that stands closest to the scan, the
    borders settled where two planes cross. Also the share of the flanks'
    cells on flanks that rise from an eave (`_eave`)."""
    hs, slope, aspect, cls, n = _flank_classes(h, mine, 0.15 / res)
    lab = np.zeros(h.shape, np.int64)
    dirs: dict[int, float] = {}
    min_cells = FLANK_M2 / (res * res)
    inward = _inward(mine)
    eaved = 0
    for core in _flank_cores(cls, n, res):
        sections = _sections(h, core, aspect, slope, min_cells)
        for piece in _rising(sections, h, hs, aspect, slope, res):
            label = len(dirs) + 1
            lab[piece] = label
            dirs[label] = _direction(aspect[piece], slope[piece])
            eaved += int(piece.sum()) * _eave(piece, hs, inward, dirs[label])
    if not dirs:
        return lab, {}, set(), False, 0.0
    eaves = eaved / float((lab > 0).sum())
    # gables: two flanks side by side facing nearly opposite ways take one axis
    for a, b in sorted(_neighbours(np.where(mine, fill_nearest(lab, lab > 0), 0))):
        turn = abs(np.angle(np.exp(1j * (dirs[a] - dirs[b]))))
        if turn > np.pi - np.deg2rad(OPPOSITE_DEG):
            axis = np.angle(np.exp(1j * dirs[a]) - np.exp(1j * dirs[b]))
            dirs[a], dirs[b] = float(axis), float(axis + np.pi)
    planes: dict[int, np.ndarray] = {}
    sags = False
    for k, phi in dirs.items():
        planes[k], sag = _flank_plane(h, lab == k, phi)
        sags = sags or bool(sag)
    # the level patches: a crown, a mansard's top
    square = np.ones((max(int(round(FLANK_W_M / res)), 1),) * 2, bool)
    level = ndi.binary_opening(mine & (lab == 0) & (slope <= 0.15 / res), structure=square)
    pieces, k = ndi.label(level)
    for j in range(1, k + 1):
        piece = pieces == j
        if piece.sum() >= min_cells:
            label = max(planes) + 1
            lab[piece] = label
            z = h[piece]
            planes[label] = np.array(
                [float(np.median(z[np.abs(z - np.median(z)) <= FLANK_TOL_M])), 0, 0]
            )
    # a cell near a flank or a level patch whose plane holds it (on it, or
    # under a dormer on it) is theirs; the rest takes planes of its own
    held = _assign(hs, lab, planes, mine, ASSIGN_REACH, h)
    lab = np.where(held > 0, held, lab)
    rest_lab, rest = plane_facets(h, mine & (lab == 0), res)
    for k2, coef in rest.items():
        label = max(planes) + 1
        lab[rest_lab == k2] = label
        planes[label] = coef
    full = _assign(hs, lab, planes, mine, ASSIGN_REACH)
    full = settle_borders(np.where(mine, hs, 0.0), full, planes)
    return full, planes, set(dirs), sags, eaves


def gable_surface(h: np.ndarray, mine: np.ndarray, res: float = 1.0, share: float = GABLE_SHARE):
    """The face as its flanks (`flank_facets`) over the whole grid, each
    cell on the plane of the flank nearest it; or None where they do not
    explain the face: less than `share` of its cells (a cell in from its
    edge, where the scan blurs the eave) within FLANK_TOL_M of their plane
    or up to ROOFTOP_M over it (a dormer), less than GABLE_ON_SHARE on it,
    a flank sagging like a vault's half, flanks holding less than
    FLANK_SHARE of it, flanks turned every way (not `orderly`), or flanks
    that mostly do not rise from an eave (`_eave`): a blanket's patches."""
    lab, planes, flanks, sags, eaves = flank_facets(h, mine, res)
    if not flanks or sags or eaves < EAVE_SHARE:
        return None
    # the flanks hold much of it and face the ways one roof's flanks do
    if float(np.isin(lab[mine], list(flanks)).mean()) < FLANK_SHARE or not orderly(
        lab, {k: planes[k] for k in flanks}, 0.0, res
    ):
        return None
    _, (r, c) = ndi.distance_transform_edt(lab == 0, return_indices=True)
    near = lab[r, c]
    rows, cols = np.indices(h.shape)
    coef = np.zeros((max(planes) + 1, 3))
    for k, p in planes.items():
        coef[k] = p
    out = coef[near, 0] + coef[near, 1] * cols + coef[near, 2] * rows
    # judged a cell in from its edge: the scan blurs an eave into the wall
    judged = ndi.binary_erosion(mine, iterations=1)
    if judged.sum() < 0.5 * mine.sum():
        judged = mine
    off = np.where(judged, h - out, 0.0)
    on = judged & (np.abs(off) <= FLANK_TOL_M)
    # over the planes, a dormer, a chimney, a skylight: small and not too high
    above = judged & (off > FLANK_TOL_M) & (off <= ROOFTOP_M)
    blobs, n = ndi.label(above)
    small = np.bincount(blobs.ravel(), minlength=n + 1) <= ROOFTOP_M2 / (res * res)
    small[0] = False
    explained = on | small[blobs]
    cells = judged.sum()
    if explained.sum() < share * cells or on.sum() < GABLE_ON_SHARE * cells:
        return None
    return out


def plausible_surface(
    h: np.ndarray,
    mine: np.ndarray,
    slope: float,
    res: float = 1.0,
    reach: int = 4,
    landmark: bool = False,
    flanks_only: bool = False,
) -> np.ndarray | None:
    """The face `mine` of the scan `h` over the whole grid as flanks or
    planes (each cell on the plane of the flank or facet nearest it), as one
    extruded profile, or, on a `landmark`, as measured; else None (see the
    module's head). With `flanks_only` (a face only the flank rule found),
    as flanks or None."""
    gable = gable_surface(h, mine, res, LANDMARK_GABLE_SHARE if landmark else GABLE_SHARE)
    if gable is not None or flanks_only:
        return gable
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
