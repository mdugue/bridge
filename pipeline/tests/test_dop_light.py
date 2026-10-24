from datetime import UTC, date, datetime

import numpy as np

from bake import dop_light
from bake.dop_light import (
    GAIN_MAX,
    GAIN_MIN,
    MIN_SUN_CONTRAST,
    cast_shadow,
    estimate_sun,
    incidence_gain,
    light_ratio,
    pooled_sun,
    shadow_mask,
    solar_path,
    solar_position,
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


def test_solar_position_matches_the_almanac():
    # Dresden, 19 March 2024 (the DOP's flight): true noon about 11:12 UTC,
    # the sun due south at 90° − 51.05° + its declination (−0.3°)
    az, el = solar_position(datetime(2024, 3, 19, 11, 12, tzinfo=UTC), 13.74, 51.05)
    assert abs(az - 180) < 0.5 and abs(el - 38.7) < 0.2
    # München, 24 August 2024, mid-morning: south-east, about 50° high
    az, el = solar_position(datetime(2024, 8, 24, 9, 0, tzinfo=UTC), 11.57, 48.14)
    assert 125 < az < 140 and 43 < el < 48


def test_the_path_holds_only_a_survey_sun():
    path = solar_path([date(2024, 3, 19)], 13.74, 51.05)
    assert min(el for _, el, _ in path) >= dop_light.MIN_SUN_EL
    # the March sun never climbs past 39° over Dresden: a 45° fit is no fit
    assert max(el for _, el, _ in path) < 39
    assert path[1][2] - path[0][2] == (path[2][2] - path[1][2])


def _blocks(n: int = 300) -> tuple[np.ndarray, np.ndarray]:
    dsm = np.zeros((n, n), np.float32)
    roofs = np.zeros(dsm.shape, bool)
    for r in range(70, n - 70, 30):
        for c in range(70, n - 70, 30):
            dsm[r : r + 12, c : c + 10] = 18
            roofs[r : r + 12, c : c + 10] = True
    return dsm, roofs


def test_the_sun_is_found_on_its_days_path():
    dsm, roofs = _blocks()
    path = solar_path([date(2024, 3, 19)], 13.74, 51.05)
    az, el, when = next(p for p in path if p[2].hour == 10 and p[2].minute == 30)
    shadow = cast_shadow(dsm, az, el, 2.0) & ~roofs
    counts: dict = {}
    fit = estimate_sun(shadow, dsm, roofs, path=path, counts=counts)
    assert fit is not None and fit.when is not None
    assert abs((fit.when - when).total_seconds()) <= 10 * 60
    assert abs(fit.el - el) < 1.5
    # one side of the buildings only: sure
    assert fit.contrast >= MIN_SUN_CONTRAST
    # the agreement every PATH_STEP minutes, for the flight's pooled sun
    assert len(counts) > 30 and all(u >= i for i, u in counts.values())


def test_shadows_on_both_sides_are_no_fit_of_ones_own():
    dsm, roofs = _blocks()
    # what an evenly lit courtyard quarter shows: dark all round the houses
    shadow = (cast_shadow(dsm, 180, 35, 2.0) | cast_shadow(dsm, 0, 35, 2.0)) & ~roofs
    fit = estimate_sun(shadow, dsm, roofs)
    assert fit is not None and fit.contrast < MIN_SUN_CONTRAST


def test_the_flight_sun_is_pooled_over_its_sure_tiles():
    t = [datetime(2024, 3, 19, 10, m, tzinfo=UTC) for m in (0, 10, 20)]
    a = {t[0]: (10, 100), t[1]: (50, 100), t[2]: (30, 100)}
    b = {t[0]: (20, 100), t[1]: (45, 100), t[2]: (40, 100)}
    assert pooled_sun([a, b]) == t[1]
    assert pooled_sun([]) is None
    assert pooled_sun([{t[0]: (1, 100)}]) is None  # under MIN_SUN_FIT
