"""The pen-and-wash drawing a mural's photo is redrawn as (mural_drawing.py)."""

import re
from pathlib import Path

import numpy as np

from bake import mural_drawing as md


def picture(h: int = 90, w: int = 240) -> np.ndarray:
    """An ochre ground with a dark-outlined red figure and a pale one."""
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = (200, 160, 70)
    img[20:70, 30:80] = (160, 40, 40)
    img[18:20, 28:82] = img[70:72, 28:82] = (30, 25, 20)
    img[18:72, 28:30] = img[18:72, 80:82] = (30, 25, 20)
    img[30:60, 140:200] = (230, 225, 215)
    return img


def test_the_same_photo_always_draws_the_same():
    a, b = md.drawing(picture(), 40), md.drawing(picture(), 40)
    assert np.array_equal(a.lines, b.lines)
    assert np.array_equal(a.wash, b.wash)
    assert a.ink == b.ink


def test_lines_at_the_photo_size_the_wash_at_its_own():
    d = md.drawing(picture(), 40)
    assert d.lines.shape == (90, 240) and d.lines.dtype == np.uint8
    # 240 px at 40 px/m is 6 m: WASH_PX_PER_M a metre
    assert d.wash.shape == (round(90 * 72 / 240), 72, 3)


def test_a_drawn_edge_takes_ink_and_a_flat_field_none():
    d = md.drawing(picture(), 40)
    assert d.lines[19, 40:70].min() < 128  # the figure's outline
    assert d.lines[80:88, 100:130].min() > 200  # the plain ground below
    flat = md.drawing(np.full((60, 120, 3), 180, np.uint8), 40)
    assert flat.lines.min() > 200


def test_the_ink_is_dark_and_the_wash_light_and_muted():
    d = md.drawing(picture(), 40)
    ink_l = md.to_lab(np.array(d.ink) / 255)[0]
    wash = md.to_lab(d.wash.reshape(-1, 3) / 255)
    assert ink_l < 45
    assert wash[:, 0].min() > 60
    # the red figure keeps a red cast, muted
    red = md.to_lab(d.wash[4:16, 12:18].reshape(-1, 3) / 255).mean(0)
    assert red[1] > 8 and np.hypot(red[1], red[2]) < 45


def test_lab_round_trips():
    rgb = np.random.default_rng(1).random((50, 3))
    assert np.allclose(md.to_rgb(md.to_lab(rgb)), rgb, atol=1e-6)


def test_the_guided_filter_keeps_an_edge_and_calms_grain():
    rng = np.random.default_rng(2)
    step = np.where(np.arange(60) < 30, 0.2, 0.8)[None, :].repeat(40, 0)
    noisy = step + rng.normal(0, 0.03, step.shape)
    out = md.guided(noisy, md.GUIDE_R, md.GUIDE_EPS)
    assert out[:, 10:20].std() < noisy[:, 10:20].std()
    assert out[:, 25].mean() < 0.3 and out[:, 35].mean() > 0.7


def test_a_coarse_photo_keeps_its_wash_no_larger_than_itself():
    rgb = np.random.default_rng(3).integers(0, 255, (40, 200, 3)).astype(np.uint8)
    with np.errstate(all="raise"):
        d = md.drawing(rgb, 8)  # fewer pixels a metre than WASH_PX_PER_M
    assert d.wash.shape[1] <= 200 and d.wash.shape[0] <= 40
    assert d.wash.max() < 255


def test_a_photo_of_fewer_colours_than_fields_still_draws():
    rgb = np.zeros((60, 120, 3), np.uint8)
    rgb[:, 60:] = (200, 40, 40)
    d = md.drawing(rgb, 40)
    assert d.lines[:, 58:62].min() < 128


def test_no_wash_is_lighter_than_the_paper_in_any_channel():
    rgb = np.full((60, 120, 3), 250, np.uint8)
    rgb[:, :40] = (150, 190, 250)  # a pale blue a channel over the clay's
    d = md.drawing(rgb, 40)
    paper = np.round(md.CLAY * 255)
    assert (d.wash <= paper + 1).all()


def test_the_paper_is_the_viewers_clay():
    """The viewer divides by CLAY_BASE (visual-style.ts): the bake's paper
    must be the same colour."""
    ts = (Path(__file__).parents[2] / "app/_components/visual-style.ts").read_text()
    hexa = re.search(r"export const CLAY_BASE = 0x([0-9a-f_]+);", ts).group(1).replace("_", "")
    assert np.allclose(md.CLAY * 255, [int(hexa[i : i + 2], 16) for i in (0, 2, 4)])
