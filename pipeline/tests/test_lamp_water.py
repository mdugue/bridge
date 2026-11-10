"""A lamp's light reaches the river past the quay's edge, not past a house:
the rays from its head over the height field, and the opening of them that
must see the water."""

from __future__ import annotations

import numpy as np

from bake import lamp_water
from bake.skyview import Field

RES = 2.0
CELLS = 400  # an 800 m field, the lamp at its centre


def _scene(house: bool):
    """Ground at 108 m, the river (level 104) north of y = 420 m; a lamp at
    (400, 390) 5.5 m up, 30 m south of the bank; with `house`, a block 20 m
    tall across the lamp's view between it and the water."""
    field = Field((0.0, 0.0, CELLS * RES, CELLS * RES), RES)
    ground = np.full(field.shape, 108.0, np.float32)
    water = np.zeros(field.shape, bool)
    north = int((CELLS * RES - 420.0) / RES)  # rows above this are water
    water[:north] = True
    ground[:north] = 104.0
    surface = ground.copy()
    if house:
        rows = slice(int((CELLS * RES - 410.0) / RES), int((CELLS * RES - 398.0) / RES))
        surface[rows, :] = 128.0
    head = (400.0, 390.0, 113.5)
    return head, ground, surface, water, field


def test_a_quay_lamp_sees_the_river_past_the_bank():
    head, ground, surface, water, field = _scene(house=False)
    seen, level, _, end = lamp_water.seen_rays(
        head, ground, surface, water, field, lamp_water.ray_steps(RES)
    )
    assert lamp_water.opening(seen)
    # the rays toward the river, none away from it
    assert seen.sum() >= lamp_water.AZIMUTHS // 4
    assert not seen[lamp_water.AZIMUTHS // 2]
    assert np.nanmedian(level[seen]) == 104.0
    # the river runs on to the field's edge, past the reach
    assert np.nanmax(end[seen]) > 250.0


def test_a_house_keeps_a_lamp_from_the_river():
    head, ground, surface, water, field = _scene(house=True)
    seen, _, _, _ = lamp_water.seen_rays(
        head, ground, surface, water, field, lamp_water.ray_steps(RES)
    )
    assert not lamp_water.opening(seen)


def test_one_ray_through_a_gap_is_no_view():
    seen = np.zeros(lamp_water.AZIMUTHS, bool)
    seen[5] = True
    assert not lamp_water.opening(seen)
    seen[[0, 1, lamp_water.AZIMUTHS - 1]] = True  # three round the wrap
    assert lamp_water.opening(seen)


def test_a_pond_and_the_river_beside_it_are_not_averaged():
    level = np.full(lamp_water.AZIMUTHS, np.nan, np.float32)
    reach = np.full(lamp_water.AZIMUTHS, np.nan, np.float32)
    rays = np.zeros(lamp_water.AZIMUTHS, bool)
    # three rays to a pond 20 m off (110 m), three to the river 90 m off
    level[0:3], reach[0:3] = 110.0, 20.0
    level[10:13], reach[10:13] = 104.0, 90.0
    rays[0:3] = rays[10:13] = True
    assert lamp_water.water_level(level, reach, rays) == 110.0


def test_a_ponds_column_ends_at_its_far_bank():
    wet = np.zeros(40, bool)
    wet[10:20] = True
    wet[22:25] = True  # past a pier two samples wide
    wet[30:35] = True  # another water, past a wider stretch of land
    assert lamp_water.water_end(wet, 10, 3) == 24


def test_a_lamps_water_reach_by_compass_sector():
    per = lamp_water.AZIMUTHS // lamp_water.SECTORS
    end = np.full(lamp_water.AZIMUTHS, np.nan, np.float32)
    rays = np.zeros(lamp_water.AZIMUTHS, bool)
    # a pond to the north, the rays either side of north
    end[[lamp_water.AZIMUTHS - 1, 0, 1]] = [40.0, 52.0, 41.0]
    rays[[lamp_water.AZIMUTHS - 1, 0, 1]] = True
    # the river to the east, but on other water: not this column's
    end[2 * per] = 200.0
    ends = lamp_water.sector_ends(end, rays)
    assert ends == [55, 0, 0, 0, 0, 0, 0, 0]
