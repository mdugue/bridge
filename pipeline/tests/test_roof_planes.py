"""What a measured roof face may be drawn as (pipeline/bake/roof_planes.py)."""

import numpy as np
from scipy import ndimage as ndi

from bake.roof_planes import (
    CREASE_REACH,
    FLANK_TOL_M,
    PLANE_TOL_M,
    _flank_plane,
    _join_flanks,
    _share_axes,
    creases,
    curved_surface,
    flank_cells,
    gable_fit,
    planar_faces,
    plane_facets,
    plausible_fit,
)
from bake.roofs import SLOPE, measured_model, step_cells


def gable_surface(h, mine, slope):
    fit = gable_fit(h, mine, slope)
    return None if fit is None else fit[0]


def plausible_surface(h, mine, slope, landmark=False):
    fit = plausible_fit(h, mine, slope, landmark=landmark)
    return None if fit is None else fit[0]


def _gable(rows=40, cols=30, ridge=15.0, pitch=0.4, noise=0.0, seed=0):
    """A gable along the rows: z falls from a ridge at `ridge` (columns)."""
    x = np.arange(cols) + 0.5
    h = np.tile(10 - np.abs(x - ridge) * pitch, (rows, 1))
    return h + np.random.default_rng(seed).normal(0, noise, h.shape)


def test_a_gable_is_two_planes_meeting_at_its_ridge():
    h = _gable(noise=0.08)
    lab, planes = plane_facets(h, np.ones(h.shape, bool))
    assert len(planes) == 2
    # the border sits where the planes cross, within a cell of the ridge
    border = np.flatnonzero(lab[20, 1:] != lab[20, :-1])
    assert len(border) == 1 and abs(border[0] + 1 - 15) <= 1
    out = plausible_surface(h, np.ones(h.shape, bool), SLOPE)
    # a cell beside the ridge stands on its own plane, half a cell past it
    assert np.abs(out - _gable()).max() < 2 * 0.4 * 0.5 + 0.05


def test_a_crumpled_blanket_is_no_face_unless_a_landmark():
    rng = np.random.default_rng(3)
    # smooth bumps a couple of metres high, no plane, no axis
    h = 10 + ndi.gaussian_filter(rng.normal(0, 1, (40, 40)), 3) * 8
    mine = np.ones(h.shape, bool)
    assert plausible_surface(h, mine, SLOPE) is None
    measured = plausible_surface(h, mine, SLOPE, landmark=True)
    assert measured is not None and np.abs(measured - h).mean() < 0.3


def test_a_barrel_vault_is_its_profile_drawn_straight():
    rows, cols = 60, 30
    x = np.arange(cols) + 0.5 - cols / 2
    arc = 10 + np.sqrt(np.maximum(18**2 - x**2, 0)) - 18 + 6
    h = np.tile(arc, (rows, 1)) + np.random.default_rng(1).normal(0, 0.1, (rows, cols))
    out = curved_surface(h, np.ones(h.shape, bool))
    assert out is not None
    assert np.abs(out - np.tile(arc, (rows, 1))).max() < 0.5
    # the same all along its axis
    assert np.abs(out[5] - out[50]).max() < 1e-6


def test_a_ring_of_gentle_narrow_flanks_is_a_face_not_terraces():
    # a 16 m wide block of two 8 m flanks at 18°, too narrow and too gentle
    # for the slope rules (a 10 m disk at 0.15, a 5 m one at 0.5)
    h = _gable(rows=60, cols=16, ridge=8.0, pitch=0.33, noise=0.05)
    own = np.ones(h.shape, bool)
    face = planar_faces(h, own, step_cells(h), SLOPE)
    assert face[5:55, 1:15].mean() > 0.9
    dom = h.astype(np.float32)
    model = measured_model(dom, own, own, np.zeros(h.shape, bool), 20)
    assert model is not None
    # one face, drawn as its two planes, not a flight of 1 m levels
    assert model.faces.sum() == 1 and int(model.lab.max()) == 1
    assert np.abs(model.heights()[5:55] - _gable(60, 16, 8.0, 0.33)[5:55]).max() < 2 * PLANE_TOL_M


def _dormers(h, rows, cols, lift=1.5):
    """Boxes `lift` over the flank at each (row, col) top-left corner, 3 × 3 m."""
    h = h.copy()
    for r in rows:
        for c in cols:
            h[r : r + 3, c : c + 3] += lift
    return h


def test_a_gable_with_a_row_of_dormers_is_still_its_two_flanks():
    # a 24 m deep block, 90 m long, its south flank broken by eleven dormers
    # (DOM1 over a street of town houses): no plane holds the scan, the
    # flanks do
    clean = _gable(rows=90, cols=24, ridge=12.0, pitch=0.8)
    noise = np.random.default_rng(1).normal(0, 0.12, clean.shape)
    h = _dormers(clean, range(4, 86, 8), [3]) + noise
    out = gable_surface(h, np.ones(h.shape, bool), SLOPE)
    assert out is not None
    # the dormers are not in it: the flanks run straight past them
    assert np.abs(out - clean)[2:-2, 1:-1].max() < FLANK_TOL_M
    assert np.abs(out[10] - out[80]).max() < 0.1


def test_houses_in_a_row_keep_each_its_own_ridge():
    # three gables side by side along one street, ridges 2 m apart in
    # height: each section its own plane, not one averaged across them
    rows = []
    for top in (10.0, 12.0, 10.5):
        rows.append(_gable(rows=20, cols=20, ridge=10.0, pitch=0.9) + top - 10)
    clean = np.vstack(rows)
    h = clean + np.random.default_rng(2).normal(0, 0.1, clean.shape)
    out = plausible_surface(h, np.ones(h.shape, bool), SLOPE)
    assert out is not None
    # off the party walls the surface is each house's own flanks
    for k in range(3):
        band = slice(20 * k + 3, 20 * k + 17)
        assert np.median(np.abs(out[band, 2:-2] - clean[band, 2:-2])) < FLANK_TOL_M


def test_a_block_raised_on_a_flat_roof_has_no_flanks():
    # a box 1.6 m over a flat roof, its edge blurred by the scan: a step
    # between two levels, not four flanks of a hip
    h = np.full((50, 50), 20.0)
    h[15:35, 12:38] += 1.6
    h = ndi.gaussian_filter(h, 0.8)
    own = np.ones(h.shape, bool)
    assert not flank_cells(h, own, step_cells(h), SLOPE).any()
    assert gable_surface(h, own, SLOPE) is None


def test_flanks_rising_from_wherever_the_scan_dips_are_no_gable():
    # smooth bumps over a long block: patches face every way, their feet
    # nowhere near its eaves
    for seed in range(4):
        rng = np.random.default_rng(seed)
        h = 10 + ndi.gaussian_filter(rng.normal(0, 1, (20, 60)), 3) * 10
        assert gable_surface(h, np.ones(h.shape, bool), SLOPE) is None


def test_a_flank_across_from_two_houses_keeps_one_axis_with_both():
    # one south flank, the north flanks of two houses across the ridge:
    # whichever pair comes second, every pair shares one axis
    dirs = {1: np.deg2rad(95.0), 2: np.deg2rad(-90.0), 3: np.deg2rad(-100.0)}
    _share_axes(dirs, {(1, 2): 10, (1, 3): 5})
    for k in (2, 3):
        assert abs(np.angle(np.exp(1j * (dirs[k] - dirs[1] - np.pi)))) < 1e-9


def test_patches_of_one_flank_join_two_houses_flanks_do_not():
    # one flank rising east, broken by a dormer across rows 20-24; then the
    # same with the second house's roof 2 m higher, its party wall there
    c = np.arange(20)[None, :]
    for lift, joined in ((0.0, True), (2.0, False)):
        h = np.repeat(10 + 0.8 * c, 45, axis=0).astype(float)
        h[22:] += lift
        lab = np.zeros(h.shape, np.int64)
        lab[:20], lab[25:] = 1, 2
        dirs = {1: 0.0, 2: 0.05}
        flat = np.zeros(h.shape)
        out, kept = _join_flanks(h, lab, dirs, np.ones(h.shape, bool), flat, flat + 0.8, 1.0)
        assert (len(kept) == 1) == joined


def test_two_flanks_meet_where_their_planes_cross_not_where_the_scan_left_their_border():
    lab = np.zeros((20, 30), np.int64)
    lab[:, :12] = 1
    lab[:, 12:] = 2
    every = np.ones(lab.shape, bool)
    cols = np.arange(30)
    # a ridge: each rises toward the other, crossing at column 15
    ridge = creases(lab, {1: np.array([10.0, 0.5, 0.0]), 2: np.array([25.0, -0.5, 0.0])}, every)
    assert (ridge[:, cols < 15] == 1).all() and (ridge[:, cols > 15] == 2).all()
    # a valley: each falls toward the other, the higher plane drawn
    valley = creases(lab, {1: np.array([25.0, -0.5, 0.0]), 2: np.array([10.0, 0.5, 0.0])}, every)
    assert (valley[:, cols < 15] == 1).all() and (valley[:, cols > 15] == 2).all()
    # one flank stepping up the same way: a step, where it was
    step = creases(lab, {1: np.array([10.0, 0.5, 0.0]), 2: np.array([12.0, 0.5, 0.0])}, every)
    assert (step == lab).all()


def test_a_crease_moves_no_cell_far_from_where_the_two_flanks_meet():
    lab = np.zeros((40, 40), np.int64)
    lab[:, :20] = 1
    lab[:, 20:] = 2
    every = np.ones(lab.shape, bool)
    # a ridge whose planes cross at column 20 at the top and run off across
    # the second flank toward the bottom (c = 20 + r / 2): its far cells are
    # no part of the crease, and stay
    planes = {1: np.array([0.0, 0.3, 0.0]), 2: np.array([12.0, -0.3, 0.3])}
    out = creases(lab, planes, every)
    far = 20 + CREASE_REACH + 1
    assert (out[:, :20] == 1).all() and (out[:, far:] == 2).all()
    # near it, the crease runs where the planes cross
    assert (out[30:, 20 : far - 1] == 1).all()


def test_two_flanks_a_pass_made_neighbours_meet_where_their_planes_cross():
    # a valley (z = 20 − c/2 and z = c/2, crossing at column 20) with a
    # level gutter between them in the scan's labels: the first pass gives
    # the gutter to one flank; the two never touched in the scan, and still
    # meet at the valley, not a step where the gutter ended
    lab = np.zeros((20, 40), np.int64)
    lab[:, :16], lab[:, 16:24], lab[:, 24:] = 1, 3, 2
    planes = {
        1: np.array([20.0, -0.5, 0.0]),
        2: np.array([0.0, 0.5, 0.0]),
        3: np.array([8.0, 0.0, 0.0]),
    }
    out = creases(lab, planes, np.ones(lab.shape, bool))
    assert (out[:, :20] == 1).all() and (out[:, 20:] == 2).all()


def test_a_vaults_half_sags_a_flank_does_not():
    rows, cols = np.indices((20, 12))
    every = np.ones((20, 12), bool)
    # a quarter circle of 6 m radius over 6 m, its crown at column 0
    t = np.clip(cols / 2 + 0.25, 0, 6)
    vault = np.sqrt(np.maximum(36 - t**2, 0.0)) + 10
    assert bool(_flank_plane(vault, every, np.pi)[1])
    # a pitched flank with dormers standing on it: straight
    flank = 15 - 0.6 * cols + np.where((rows % 6 < 2) & (cols > 3) & (cols < 7), 1.5, 0.0)
    assert not bool(_flank_plane(flank, every, np.pi)[1])
