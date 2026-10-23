import numpy as np

from bake.dop_light import (
    GAIN_MAX,
    GAIN_MIN,
    cast_shadow,
    estimate_sun,
    incidence_gain,
    light_ratio,
    shadow_mask,
    sun_vector,
)


def test_shadow_mask_takes_dim_blue_texels_not_dark_grey_roofs():
    rgb = np.array([[[30, 45, 70], [80, 80, 85], [200, 60, 50], [20, 20, 20]]], np.uint8)
    assert shadow_mask(rgb).tolist() == [[True, False, False, True]]


def test_light_ratio_reads_across_shadow_edges():
    rgb = np.full((200, 200, 3), 180, np.uint8)
    rgb[:, 100:] = (45, 45, 60)  # same paving, in shadow
    ratio = light_ratio(rgb, shadow_mask(rgb))
    assert ratio is not None and 8 < ratio < 20


def test_incidence_gain():
    sun = sun_vector(180, 35)
    flat = (0.0, 0.0, 1.0)
    assert incidence_gain(flat, sun, 5.0) == 1.0
    # a slope turned to the sun read brighter than a flat roof: scaled down
    s = np.sin(np.radians(40))
    to_sun = (0.0, -float(s), float(np.cos(np.radians(40))))
    assert GAIN_MIN <= incidence_gain(to_sun, sun, 5.0) < 1
    # one turned away read darker: scaled up, at most GAIN_MAX
    away = (0.0, float(s), float(np.cos(np.radians(40))))
    assert 1 < incidence_gain(away, sun, 5.0) <= GAIN_MAX
    # without a sun nothing is corrected
    assert incidence_gain(to_sun, None, 5.0) == 1.0


def test_estimate_sun_finds_the_sun_its_shadows_were_cast_by():
    dsm = np.zeros((300, 300), np.float32)
    roofs = np.zeros(dsm.shape, bool)
    for r in range(70, 230, 30):
        for c in range(70, 230, 30):
            dsm[r : r + 12, c : c + 10] = 18
            roofs[r : r + 12, c : c + 10] = True
    shadow = cast_shadow(dsm, 160, 40, 2.0) & ~roofs
    sun = estimate_sun(shadow, dsm, roofs)
    assert sun is not None
    assert abs(sun.az - 160) <= 4 and abs(sun.el - 40) <= 3


def test_estimate_sun_gives_up_without_shadows():
    dsm = np.zeros((200, 200), np.float32)
    assert estimate_sun(np.zeros(dsm.shape, bool), dsm, np.zeros(dsm.shape, bool)) is None
