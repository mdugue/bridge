"""What a measured roof face may be drawn as (pipeline/bake/roof_planes.py)."""

import numpy as np

from bake.roof_planes import (
    PLANE_TOL_M,
    curved_surface,
    planar_faces,
    plane_facets,
    plausible_surface,
)
from bake.roofs import SLOPE, measured_model, step_cells


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
    from scipy import ndimage as ndi

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
