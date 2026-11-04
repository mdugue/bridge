"""The dormer bake's pure parts: which way a roof falls, and which blobs
of surface over it are a dormer's shape."""

import math
from types import SimpleNamespace

import numpy as np
from scipy import ndimage as ndi

from bake import dormers
from bake.skyview import Field


def roof_falling_east(n: int = 30) -> SimpleNamespace:
    """A 45° roof over n × n one-metre cells, falling towards +x."""
    field = Field((0, 0, n, n), 1.0)
    cols = np.arange(n) + 0.5
    roof = np.tile(100.0 - cols, (n, 1))
    return SimpleNamespace(field=field, roof=roof)


def dormer_of(s, excess: np.ndarray):
    """The one blob of `excess` over the roof as find() reads it: its
    dormer, its slice and its mask."""
    labels, _ = ndi.label(excess >= dormers.MIN_EXCESS_M)
    sl = ndi.find_objects(labels)[0]
    m = labels[sl] == 1
    gx, gy = dormers.roof_gradient(s.roof, s.field.res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    return dormers.dormer(s, sl, m, excess, gx, gy, slope), sl, m


def blob(s, r0: int, c0: int, rows: int, cols: int, lift: float):
    excess = np.zeros_like(s.roof)
    excess[r0 : r0 + rows, c0 : c0 + cols] = lift
    return dormer_of(s, excess)[0]


def test_gradient_in_epsg_axes():
    s = roof_falling_east()
    gx, gy = dormers.roof_gradient(s.roof, 1.0)
    assert np.allclose(gx, -1) and np.allclose(gy, 0)
    # rows run south: a roof rising with the row index falls to the north
    gx, gy = dormers.roof_gradient(s.roof.T.copy(), 1.0)
    assert np.allclose(gx, 0) and np.allclose(gy, 1)


def test_a_dormer_faces_down_the_slope():
    s = roof_falling_east()
    d = blob(s, 10, 10, 3, 2, 1.5)
    assert d is not None
    assert (d["ax"], d["ay"]) == (1.0, 0.0)
    assert (d["w"], d["d"]) == (3.0, 2.0)
    assert d["slope"] == 45.0
    assert d["top"] - d["z"] == 1.5


def test_what_is_no_dormer():
    s = roof_falling_east()
    # a crown: too high over the roof
    assert blob(s, 10, 10, 3, 3, dormers.MAX_TOP_M + 1) is None
    # the roof drawn low: deeper down the slope than a dormer
    assert blob(s, 10, 2, 3, dormers.MAX_SIDE_M + 2, 1.5) is None


def test_a_row_of_dormers_is_as_wide_as_it_runs():
    s = roof_falling_east()
    d = blob(s, 2, 10, dormers.MAX_SIDE_M + 6, 2, 1.5)
    assert d is not None and d["w"] == dormers.MAX_SIDE_M + 6


def test_dormers_side_by_side_part_at_the_gap():
    # two dormers 1.6 m over the roof, a gap of 0.9 m (read as one blob at
    # MIN_EXCESS_M) between them
    m = np.zeros((4, 9), bool)
    m[:, :] = True
    ex = np.full((4, 9), 1.6)
    ex[:, 4] = 0.9
    parts = dormers.split(m, ex)
    assert len(parts) == 2
    assert sum(int(p.sum()) for p in parts) == m.sum()
    # one dormer, its back sinking into the roof: one core, kept whole
    ex = np.tile(np.linspace(0.8, 1.8, 9), (4, 1))
    assert len(dormers.split(m, ex)) == 1


def test_a_seam_is_where_the_roof_bends_not_its_outline():
    # a gabled roof, 45°, its ridge along column 5, beside a void
    cols = np.arange(12, dtype=float)
    roof = np.tile(10.0 - np.abs(cols - 5.0), (6, 1))
    roof[:, 10:] = np.nan
    seam = dormers.seams(roof)
    assert seam[:, 5].all()
    # a cell from the ridge counts with it, the faces beyond do not
    assert seam[:, 4].all() and seam[:, 6].all()
    assert not seam[:, 1:3].any() and not seam[:, 8].any()
    # the roof's edge by the void is no seam
    assert not seam[:, 9].any()


def test_where_a_small_blob_stands_says_what_it_is():
    k = dormers.kind_of
    ridge = 20.0
    # small at the ridge: a chimney (on its seam too); lower down: a dormer
    assert k(1, True, ridge - 0.2, ridge, True, False) == "chimney"
    assert k(2, True, ridge - 3.0, ridge, False, False) == "dormer"
    # four cells over the ridge: a stack; more: no dormer's shape to test
    assert k(4, True, ridge + 1.0, ridge, False, False) == "chimney"
    assert k(9, True, ridge + 1.0, ridge, False, False) == "dormer"
    # a blob along a seam below the ridge: the roof drawn off, nothing
    assert k(6, True, ridge - 2.0, ridge, True, False) is None
    # a flat roof: a chimney clear of its edge and seams, nothing else
    assert k(1, False, ridge, ridge, False, False) == "chimney"
    assert k(1, False, ridge, ridge, False, True) is None
    assert k(1, False, ridge, ridge, True, False) is None
    assert k(3, False, ridge + 1.0, ridge, False, False) is None


def test_a_chimney_stands_its_measured_height_a_little_wider_than_drawn():
    s = roof_falling_east()
    excess = np.zeros_like(s.roof)
    excess[10, 10] = 1.0
    labels, _ = ndi.label(excess >= dormers.MIN_EXCESS_M)
    sl = ndi.find_objects(labels)[0]
    m = labels[sl] == 1
    c = dormers.chimney(s, sl, m, excess, (1.0, 0.0, 45.0), False, 200.0)
    assert c is not None and c["k"] == "chimney"
    assert c["w"] == c["d"] == dormers.CHIMNEY_SIDE_M
    assert c["top"] == round(s.roof[10, 10] + 1.0, 2)
    # too low on a seam, far over the ridge: none
    assert dormers.chimney(s, sl, m, excess, (1.0, 0.0, 45.0), True, 200.0) is None
    assert dormers.chimney(s, sl, m, excess, (1.0, 0.0, 45.0), False, 80.0) is None


def test_chimneys_in_a_crowd_on_a_flat_roof_are_something_else():
    def chimney(x: float) -> dict:
        return {"geometry": {"coordinates": [x, 0.0]}, "properties": {"k": "chimney"}}

    dormer = {"geometry": {"coordinates": [1.0, 0.0]}, "properties": {}}
    # a pair of stacks stays; a row of masts a metre and a half apart goes
    pair = [chimney(0.0), chimney(1.0), dormer]
    assert dormers.uncrowded(pair, [True, True, False]) == pair
    row = [chimney(1.5 * i) for i in range(6)] + [dormer]
    assert dormers.uncrowded(row, [True] * 6 + [False]) == [dormer]
    # on a pitched roof a row of stacks stays, however close
    assert dormers.uncrowded(row, [False] * 7) == row


def test_a_ridge_is_pitched_roof_a_flat_roof_is_not():
    # a gabled roof, 45°, its ridge along column 5: the gradient's central
    # differences read the ridge's own cells level
    cols = np.arange(12, dtype=float)
    roof = np.tile(10.0 - np.abs(cols - 5.0), (6, 1))
    gx, gy = dormers.roof_gradient(roof, 1.0)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    assert slope[2, 5] < dormers.MIN_SLOPE
    assert dormers.pitched_cells(slope)[1:5, 1:10].all()
    # a flat roof stays flat, a 1 m step in it too
    flat = np.zeros((8, 8))
    flat[:, 4] = 40.0
    assert not dormers.pitched_cells(flat)[:, :4].any()


def test_a_roof_form_is_its_own_or_its_parents():
    city = {
        "CityObjects": {
            "a": {"attributes": {"roofType": "3400"}},
            "a-1": {"parents": ["a"]},
            "b": {"attributes": {"roofType": 3100}},
            "c": {},
        }
    }
    assert dormers.roof_forms(city, ["a", "a-1", "b", "c"]) == ["3400", "3400", "3100", None]


def mansard_profile(n: int = 40) -> tuple[np.ndarray, np.ndarray]:
    """A mansard house over n columns: 4 m of 70° lower roof each side,
    a 20° upper roof between; its roof heights and slopes, one row."""
    x = np.arange(n) + 0.5
    edge = np.minimum(x, n - x)
    steep, shallow = math.tan(math.radians(70)), math.tan(math.radians(20))
    z = np.where(edge < 4, 100 + edge * steep, 100 + 4 * steep + (edge - 4) * shallow)
    slope = np.where(edge < 4, 70.0, 20.0)
    return z, slope


def city_of(roofs: dict[str, list[list[tuple[float, float, float]]]]) -> dict:
    """A CityJSON whose objects ("a", "a-1" a part of "a", ...) carry the
    given roof faces (each a ring of x, y, z)."""
    vertices: list[list[int]] = []
    objs: dict = {}
    for oid, faces in roofs.items():
        rings = []
        for ring in faces:
            rings.append([[len(vertices) + i for i in range(len(ring))]])
            vertices += [[int(v * 1000) for v in p] for p in ring]
        objs[oid] = {
            "geometry": [
                {
                    "type": "MultiSurface",
                    "boundaries": rings,
                    "semantics": {
                        "surfaces": [{"type": "RoofSurface"}],
                        "values": [0] * len(rings),
                    },
                }
            ]
        }
        if "-" in oid:
            objs[oid]["parents"] = [oid.split("-")[0]]
    return {
        "CityObjects": objs,
        "vertices": vertices,
        "transform": {"scale": [0.001] * 3, "translate": [0, 0, 0]},
    }


def face(x0: float, x1: float, z0: float, z1: float, depth: float = 20.0):
    """A roof face rising from (x0, z0) to (x1, z1), `depth` m deep."""
    return [(x0, 0, z0), (x1, 0, z1), (x1, depth, z1), (x0, depth, z0)]


def test_a_steep_face_an_upper_roof_goes_on_from_is_a_mansards_whatever_lod2_calls_it():
    rise = 4 * math.tan(math.radians(70))
    lower = [face(0, 4, 100, 100 + rise), face(20, 16, 100, 100 + rise)]
    upper = [face(4, 10, 100 + rise, 102 + rise), face(16, 10, 100 + rise, 102 + rise)]
    # its parts may carry the faces: the building decides
    assert len(dormers.mansard_flanks(city_of({"a": upper, "a-1": lower}))) == 2
    # a spire: its steep faces meet at the tip, no roof goes on from there
    spire = [face(8, 10, 120, 140), face(12, 10, 120, 140)]
    assert dormers.mansard_flanks(city_of({"t": upper + spire})) == []
    # a steep annex under a tall flat roof touches nothing at its top
    annex = [face(30, 34, 100, 100 + rise), face(38, 34, 100, 100 + rise)]
    hall = [face(0, 20, 130, 130)]
    assert dormers.mansard_flanks(city_of({"h": hall + annex})) == []
    # a small steep sliver
    sliver = [face(0, 1, 100 + rise - 3, 100 + rise, depth=5)]
    assert dormers.mansard_flanks(city_of({"s": upper + sliver})) == []


def test_a_building_lod2_drew_too_high_as_a_whole_is_read_against_the_scan():
    roof = np.full((20, 20), 100.0)
    slope = np.zeros_like(roof)
    labels = np.zeros(roof.shape, np.int32)
    labels[:, :10], labels[:, 10:] = 1, 2
    rng = np.random.default_rng(1)
    dom = roof - 1.2 + rng.normal(0, 0.05, roof.shape)
    dom[:, 10:] = roof[:, 10:] + 0.2  # within the fit: read as it is
    dom[2:4, 2:4] += 1.5  # a dormer does not move the median
    shift = dormers.shifts(dom, roof, slope, labels)
    assert abs(shift[1] - 1.2) < 0.05
    assert shift[2] == 0.0
    # a surface over the roof as a whole may be the roof's own: no shift
    assert dormers.shifts(roof + 1.0, roof, slope, labels)[1] == 0.0
    # a roof that is off in places only: no shift
    dom[:, :5] = roof[:, :5]
    assert dormers.shifts(dom, roof, slope, labels)[1] == 0.0


def test_a_mansards_break_is_no_seam_to_its_dormers():
    z, slope = mansard_profile()
    roof = np.tile(z, (20, 1))
    seam = dormers.seams(roof)
    # the break between the lower and the upper roof is a seam ...
    assert seam[:, 3:5].any()
    # ... but none by the lower roof's cells, where its dormers rise to it
    flank = np.tile(slope > dormers.MAX_SLOPE, (20, 1))
    assert not dormers.seams(roof, flank)[:, :8].any()
    # a seam elsewhere on the roof stays one
    roof[:, 20:] -= 3.0
    assert dormers.seams(roof, flank)[:, 18:22].any()


# --- G11: a shed dormer's fall -----------------------------------------------


N = 30
TAN20 = math.tan(math.radians(20))


def roof_with(top) -> SimpleNamespace:
    """`roof_falling_east(N)` (roof(x) = 100 − x) with a dormer 5 cells wide
    (rows 10–14) whose front stands at x = 14: the surface over it `top(x)`
    where that rises over the roof."""
    s = roof_falling_east(N)
    x = np.arange(N) + 0.5
    s.dom = s.roof.copy()
    for c in range(N):
        if x[c] < 14:
            s.dom[10:15, c] = max(s.roof[0, c], top(x[c]))
    return s


def read(s):
    """The one blob's dormer and its roof's fall, as find() reads them."""
    excess = s.dom - s.roof
    d, sl, m = dormer_of(s, excess)
    return d, dormers.roof_fall(s, sl, m, d, excess)


def test_a_shed_dormer_reads_its_fall_and_where_it_meets_the_roof():
    # 3 m over the roof at its front, falling 20° down the slope
    s = roof_with(lambda x: 89.0 + TAN20 * (14 - x))
    d, fall = read(s)
    assert d is not None and fall is not None
    assert abs(fall[0] - 20) < 2
    top = dormers.shed_top(d["z"], d["slope"], d["d"], fall)
    # its roof meets the main roof at x ≈ 9.3, 90.7 m up (the bake's z is
    # the roof at the centre's cell, half a metre off the centre)
    assert top is not None and abs(top - 90.7) < 0.6


def test_a_flat_dormer_stays_flat_though_its_front_cells_read_low():
    s = roof_with(lambda x: 89.7)
    # the front cells half over the front wall read the roof below
    s.dom[10:15, 13] -= 0.6
    d, fall = read(s)
    assert d is not None and fall is not None
    assert abs(fall[0]) < dormers.SHED_MIN_FALL
    assert dormers.shed_top(d["z"], d["slope"], d["d"], fall) is None


def test_a_rise_as_steep_as_the_roof_is_no_shed_dormer():
    # the surface parallel to the roof, 1.5 m over it: LoD2 drew it low
    assert dormers.shed_top(90.0, 45.0, 4.0, (44.0, 91.5)) is None
    # a fall too gentle to tell from a flat roof
    assert dormers.shed_top(90.0, 45.0, 4.0, (5.0, 91.5)) is None
    # a roof that would pass under the main roof before its front
    assert dormers.shed_top(90.0, 45.0, 1.0, (20.0, 89.0)) is None
    # unreadable: no fall
    assert dormers.shed_top(90.0, 45.0, 4.0, None) is None


def test_a_shallow_dormer_has_no_fall_to_read():
    # 2 m deep along the slope: nothing left once the front 1.5 m is out
    s = roof_with(lambda x: 89.0 if x > 12 else 0.0)
    d, fall = read(s)
    assert d is not None
    assert fall is None


# --- rows ---------------------------------------------------------------------


def row_of(us, depth=0.0, jitter=(), w=1.6, d=1.4, lift=1.5, building=1):
    """Dormers on a roof falling towards −y (south) at x = `us`, y =
    −depth, each `jitter` m off down the slope."""
    out = []
    for n, u in enumerate(us):
        dv = jitter[n] if n < len(jitter) else 0.0
        out.append(
            {
                "x": float(u),
                "y": -depth - dv,
                "ax": 0.0,
                "ay": -1.0,
                "w": w,
                "d": d,
                "z": 100.0,
                "top": 100.0 + lift,
                "slope": 45.0,
                "of": building,
                "level": False,
            }
        )
    return out


def flat_roof(x, y, d):
    return 100.0, d["of"], 120.0


def test_a_row_is_one_buildings_dormers_falling_one_way_at_one_depth():
    found = row_of([0, 3, 6]) + row_of([0, 3], depth=4) + row_of([9], building=2)
    found.append(row_of([12])[0] | {"ax": -1.0, "ay": 0.0})
    building = [d["of"] for d in found]
    assert sorted(map(sorted, dormers.rows(found, building))) == [[0, 1, 2], [3, 4], [5], [6]]


def test_a_row_stands_on_the_grid_its_dormers_agree_on():
    u = np.asarray([0.1, 3.3, 6.5, 9.9, 13.1, 16.6, 19.8])
    p, at, whence = dormers.grid(u)
    assert abs(p - 3.3) < 0.05 and whence == "own"
    # a slot missed is still the same grid, not one twice as wide
    p2, *_ = dormers.grid(np.delete(u, 3))
    assert abs(p2 - p) < 0.1
    # DOM1 reads a dormer ±0.5 m: a row that loose still stands on one grid
    p3, at3, _ = dormers.grid(np.asarray([0.0, 3.8, 6.0, 9.8, 12.0]))
    assert abs(p3 - 3.0) < 0.1
    assert dormers.grid(np.asarray([0.0, 3.0])) is None


def test_a_row_parts_into_stretches_at_a_wide_gap():
    u = np.asarray([30.0, 0.0, 3.0, 6.0, 24.0, 27.0])
    assert [sorted(u[s].tolist()) for s in dormers.stretches(u)] == [
        [0.0, 3.0, 6.0],
        [24.0, 27.0, 30.0],
    ]


def test_the_window_axes_below_set_the_slots():
    u = np.asarray([0.3, 5.6, 11.1, 16.2])
    # every second axis of 2.7 m, the axes measured at 0.0
    p, at, whence = dormers.grid(u, (2.7, 0.0))
    assert whence == "windows" and p == 5.4 and at == 0.0
    # axes the dormers do not follow are not taken
    assert dormers.grid(u, (2.3, 1.0))[2] == "own"


def test_dormers_snap_to_their_slots_and_two_on_one_are_one():
    u = np.asarray([0.2, 3.1, 3.6, 6.4, 7.6])
    moved, drop, on, k = dormers.snap(u, 3.0, 0.0)
    assert moved.tolist()[:2] == [0.0, 3.0] and drop == [2] and on == [0, 1, 3, 4]
    assert moved[3] == 6.0 and moved[4] == 9.0
    # one half a slot off whose slot a nearer one takes takes the free one
    moved, drop, on, _ = dormers.snap(np.asarray([0.0, 3.0, 7.6, 8.8]), 3.0, 0.0)
    assert moved.tolist() == [0.0, 3.0, 6.0, 9.0] and drop == []
    # with neither free and well off, it stays put
    moved, drop, _, _ = dormers.snap(np.asarray([0.0, 3.0, 4.4, 6.0]), 3.0, 0.0)
    assert moved[2] == 4.4 and drop == []


def test_a_row_is_set_straight_on_its_slots_in_one_shape():
    found = row_of(
        [0.4, 3.0, 6.3, 9.0, 12.5],
        jitter=[0.0, 0.6, -0.5, 0.2, 0.0],
    )
    found[1] |= {"w": 3.9, "top": 102.6}
    found[4] |= {"w": 1.0}
    got = dormers.in_rows(found, [1] * len(found), {}, flat_roof)
    xs = sorted(d["x"] for d in got)
    gaps = np.diff(xs)
    assert len(got) == 5 and np.ptp(gaps) < 1e-6
    assert len({d["y"] for d in got}) == 1
    assert {d["w"] for d in got} == {1.6} and {d["top"] for d in got} == {101.5}


def test_a_dormer_that_would_leave_its_roof_stays_where_it_stood():
    found = row_of([0.4, 3.0, 6.3, 9.0])
    got = dormers.in_rows(found, [1] * 4, {}, lambda x, y, d: None)
    assert [d["x"] for d in got] == [0.4, 3.0, 6.3, 9.0]


def test_a_dormer_read_twice_one_row_behind_the_other_is_one():
    found = row_of([0, 3, 6, 9]) + row_of([3.2, 6.1], depth=1.7)
    got = dormers.in_rows(found, [1] * 6, {}, flat_roof)
    assert len(got) == 4 and {d["y"] for d in got} == {0.0}


def test_a_single_empty_slot_between_two_takes_a_dormer_like_them():
    got = dormers.in_rows(row_of([0, 3, 9, 12]), [1] * 4, {}, flat_roof)
    assert np.allclose(sorted(d["x"] for d in got), [0.0, 3.0, 6.0, 9.0, 12.0])
    # a wider gap parts the row; nothing is filled across it
    assert len(dormers.in_rows(row_of([0, 3, 12, 15]), [1] * 4, {}, flat_roof)) == 4
    assert dormers.holes({0, 1, 3, 4}, {0, 1, 3, 4}) == [2]
    assert dormers.holes({0, 1, 4}, {0, 1, 4}) == []
    # no twin on a chimney standing in the empty slot
    found = row_of([0, 3, 9, 12]) + [row_of([6.0], w=0.6, d=0.6)[0] | {"k": "chimney"}]
    got = dormers.in_rows(found, [1] * 5, {}, flat_roof)
    assert len(got) == 5


def test_a_rows_dormers_stand_at_one_height_on_their_part():
    # a mansard's 1 m cells read the roof ±1.4 m under a straight row
    zs = iter([100.0, 101.4, 98.6, 100.2, 99.9])

    def steep(x, y, d):
        return next(zs), d["of"], 120.0

    got = dormers.in_rows(row_of([0, 3, 6, 9, 12]), [1] * 5, {}, steep)
    assert {d["z"] for d in got} == {100.0} and {d["top"] for d in got} == {101.5}


def test_the_measured_walls_under_a_row():
    # a wall 2 m in front of a row falling towards −y; across it u = −x
    wall = {
        "a": [-5.0, -2.0],
        "b": [20.0, -2.0],
        "n": [0.0, -1.0],
        "model": {"axis": 2.7, "phase": 1.0},
    }
    u, v = np.asarray([0.0, -5.0]), np.zeros(2)
    spacing, at = dormers.wall_axes([wall], 0.0, -1.0, u, v)
    assert spacing == 2.7 and abs(at - 4.0) < 1e-9  # 1 m from a (u = 5) towards b
    # one facing away, or behind the row, is not under it
    assert dormers.wall_axes([wall | {"n": [0.0, 1.0]}], 0.0, -1.0, u, v) is None
    assert dormers.wall_axes([wall], 0.0, -1.0, u, v + 3.0) is None


def test_every_second_axis_from_either_of_its_axes():
    # dormers over the 2nd, 4th, 6th … of 2.7 m axes measured at 0
    u = np.asarray([2.7, 8.1, 13.5, 18.9])
    p, at, whence = dormers.grid(u, (2.7, 0.0))
    assert whence == "windows" and p == 5.4 and abs(at - 2.7) < 1e-9


def test_a_wall_at_an_angle_spaces_its_axes_closer_across_the_row():
    t = math.radians(15)
    wall = {
        "a": [0.0, -2.0],
        "b": [20 * math.cos(t), -2.0 - 20 * math.sin(t)],
        "n": [-math.sin(t), -math.cos(t)],
        "model": {"axis": 3.5, "phase": 1.0},
    }
    spacing, at = dormers.wall_axes([wall], 0.0, -1.0, np.asarray([-1.0, -10.0]), np.zeros(2))
    assert abs(spacing - 3.5 * math.cos(t)) < 1e-9 and abs(at + math.cos(t)) < 1e-9


def test_a_dormer_off_its_slot_or_wider_than_its_kind_stays_as_it_was():
    # a stair head between two, well off the slot a nearer one takes
    found = row_of([0.0, 3.0, 6.0, 9.0, 12.0])
    found.append(row_of([4.4], jitter=[0.3], w=1.0)[0])
    got = dormers.in_rows(found, [1] * 6, {}, flat_roof)
    assert got[5]["x"] == 4.4 and got[5]["y"] == -0.3 and got[5]["w"] == 1.0
    # a Zwerchhaus between two small dormers keeps its width
    pair = row_of([0.0, 5.0, 10.0], w=1.5)
    pair[1] |= {"w": 6.0}
    pair[2] |= {"x": 11.5}
    got = dormers.in_rows(pair, [1] * 3, {}, flat_roof)
    assert sorted(d["w"] for d in got) == [1.5, 1.5, 6.0]


def test_a_part_lod2_drew_off_in_plan_is_moved_onto_its_steep_faces():
    # a steep (63°) roof 20 × 16 m, the scan's 0.5 m east and 1 m north of it
    yy, xx = np.mgrid[0:30, 0:30].astype(float)

    def gable(x0, y0):
        z = 120.0 - np.abs(yy + 0.5 - y0) * 2.0
        inside = (np.abs(xx + 0.5 - x0) <= 10) & (np.abs(yy + 0.5 - y0) <= 8)
        return np.where(inside, z, np.nan)

    roof = gable(15.0, 15.0)
    dom = np.nan_to_num(gable(15.5, 14.0), nan=100.0)  # rows run south
    mask = np.isfinite(roof)
    dx, dy = dormers.plan_offset(dom, roof, mask, mask)
    assert dy == 1.0 and 0.0 <= dx <= 0.5  # along the ridge only its ends tell
    # one drawn where the scan saw it stays, and so does one without a
    # steep face (the roof's fit reads a plane moved in plan as one lifted)
    assert dormers.plan_offset(np.nan_to_num(roof, nan=100.0), roof, mask, mask) == (0.0, 0.0)
    assert dormers.plan_offset(dom, roof, mask, np.zeros_like(mask)) == (0.0, 0.0)


def test_a_dormer_read_again_once_moved_is_one():
    a = {"x": 0.0, "y": 0.0, "w": 2.0}
    assert dormers.twice({"x": 0.6, "y": 0.4, "w": 2.0}, [a])
    assert not dormers.twice({"x": 3.0, "y": 0.0, "w": 2.0}, [a])
    assert not dormers.twice({"x": 0.2, "y": 0.0, "w": 0.6, "k": "chimney"}, [a])


def gable_city() -> dict:
    """One object: a gable roof over x 0..10, y 0..8, eaves at 10 m, the
    ridge along y = 4 at 14 m (45°), and a wall surface under it."""
    vertices = [
        [0, 0, 10],
        [10, 0, 10],
        [10, 4, 14],
        [0, 4, 14],
        [0, 8, 10],
        [10, 8, 10],
        [0, 0, 0],
        [10, 0, 0],
    ]
    roof = {"type": "RoofSurface"}
    wall = {"type": "WallSurface"}
    geometry = {
        "type": "MultiSurface",
        "lod": "2",
        "boundaries": [[[0, 1, 2, 3]], [[3, 2, 5, 4]], [[6, 7, 1, 0]]],
        "semantics": {"surfaces": [roof, wall], "values": [0, 0, 1]},
    }
    return {
        "vertices": vertices,
        "CityObjects": {"a": {"type": "Building", "geometry": [geometry]}},
    }


def test_roof_planes_read_the_exact_face():
    planes = dormers.RoofPlanes(gable_city(), ["a"])
    z, slope = planes.at(0, 5.0, 1.3)
    assert abs(z - 11.3) < 1e-6
    assert abs(slope - 45.0) < 1e-6
    # the north face, and the ridge reads the higher of the two
    assert abs(planes.at(0, 5.0, 7.0)[0] - 11.0) < 1e-6
    assert abs(planes.at(0, 5.0, 4.0)[0] - 14.0) < 1e-6
    # a centre just past the eave still reads its face, far off none
    assert abs(planes.at(0, 5.0, -0.2)[0] - 9.8) < 1e-6
    assert planes.at(0, 5.0, -2.0) is None


def roof_city(*faces: list[list[float]]) -> dict:
    """One object whose roof is the given faces (each a ring of points)."""
    vertices: list[list[float]] = []
    boundaries = []
    for face in faces:
        boundaries.append([list(range(len(vertices), len(vertices) + len(face)))])
        vertices += face
    geometry = {
        "type": "MultiSurface",
        "lod": "2",
        "boundaries": boundaries,
        "semantics": {"surfaces": [{"type": "RoofSurface"}], "values": [0] * len(faces)},
    }
    return {
        "vertices": vertices,
        "CityObjects": {"a": {"type": "Building", "geometry": [geometry]}},
    }


def test_roof_planes_read_the_face_a_point_is_on_at_a_break():
    # a mansard: its 70° lower face y 0..1 up to the break at 12.75 m,
    # its upper face on at 30° — near the break, the upper face's plane
    # runs on above the lower face
    rise = math.tan(math.radians(70))
    up = math.tan(math.radians(30))
    lower = [[0, 0, 10], [10, 0, 10], [10, 1, 10 + rise], [0, 1, 10 + rise]]
    upper = [
        [0, 1, 10 + rise],
        [10, 1, 10 + rise],
        [10, 4, 10 + rise + 3 * up],
        [0, 4, 10 + rise + 3 * up],
    ]
    planes = dormers.RoofPlanes(roof_city(lower, upper), ["a"])
    z, slope = planes.at(0, 5.0, 0.85)
    assert abs(z - (10 + rise * 0.85)) < 1e-6
    assert abs(slope - 70.0) < 1e-6
    z, slope = planes.at(0, 5.0, 1.15)
    assert abs(slope - 30.0) < 1e-6


def test_on_planes_leaves_a_dormer_on_a_flat_face():
    flat = [[0, 0, 10], [10, 0, 10], [10, 8, 10], [0, 8, 10]]
    planes = dormers.RoofPlanes(roof_city(flat), ["a"])
    d = {"of": 0, "x": 5.0, "y": 4.0, "z": 10.4, "top": 12.0, "slope": 45.0, "tf": 30.0}
    dormers.on_planes([d], planes)
    assert d["z"] == 10.4 and d["slope"] == 45.0 and d["tf"] == 30.0


def test_on_planes_moves_a_dormer_onto_its_face():
    planes = dormers.RoofPlanes(gable_city(), ["a"])
    d = {"of": 0, "x": 5.0, "y": 1.3, "z": 11.8, "top": 13.0, "slope": 40.0, "tf": 44.0}
    chimney = {"of": 0, "x": 5.0, "y": 7.0, "z": 10.5, "top": 12.0, "slope": 40.0, "k": "chimney"}
    dormers.on_planes([d, chimney], planes)
    assert d["z"] == 11.3 and d["top"] == 12.5 and d["slope"] == 45.0
    assert d["tf"] == 45.0 - dormers.SHED_MARGIN
    # a chimney's top is the surface model's own height: it stays
    assert chimney["z"] == 11.0 and chimney["top"] == 12.0 and chimney["slope"] == 40.0


def test_on_planes_keeps_a_dormer_under_the_ridge():
    planes = dormers.RoofPlanes(gable_city(), ["a"])
    d = {"of": 0, "x": 5.0, "y": 3.0, "z": 12.0, "top": 15.0, "slope": 45.0}
    dormers.on_planes([d], planes)
    assert d["z"] == 13.0 and d["top"] == 14.0 + dormers.RIDGE_SLACK_M
