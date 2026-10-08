"""The plinth bake's pure parts: which stretches of a wall are open to the
street, how a run steps down a slope, and which corners a band runs past."""

import shapely

from bake import plinths


def test_party_wall_cuts_the_run():
    # a 10 m wall along +x, its outside (-y) taken by a neighbour from 4 to 7 m
    neighbour = shapely.box(4, -5, 7, 0)

    def inside(x, y):
        return neighbour.contains(shapely.Point(x, y))

    runs = plinths.open_runs((0, 0), (10, 0), (0, -1), inside)
    assert len(runs) == 2
    (a0, a1), (b0, b1) = runs
    assert a0 == 0 and 3.5 <= a1 <= 4.0
    assert 7.0 <= b0 <= 7.5 and b1 == 10


def test_short_wall_has_no_run():
    assert plinths.open_runs((0, 0), (1, 0), (0, -1), lambda x, y: False) == []


def test_level_ground_is_one_piece():
    assert plinths.pieces([10.0, 10.1, 10.2, 10.1]) == [(0, 3)]


def test_slope_steps_in_pieces_that_share_their_seams():
    ground = [10.0 + 0.2 * i for i in range(10)]
    out = plinths.pieces(ground)
    assert len(out) > 1
    assert out[0][0] == 0 and out[-1][1] == 9
    for (_, j), (i, _) in zip(out[:-1], out[1:], strict=True):
        assert j == i
    for i, j in out:
        assert max(ground[i : j + 1]) - min(ground[i : j + 1]) <= plinths.LEVEL_M + 0.2


def test_edges_walk_counter_clockwise_with_the_outside_to_the_right():
    # clockwise input: the walker turns it round
    square = shapely.Polygon([(0, 0), (0, 10), (10, 10), (10, 0)])
    out = list(plinths.edges(square))
    assert len(out) == 4
    for a, b, _, (nx, ny), corners in out:
        mid = ((a[0] + b[0]) / 2 + nx, (a[1] + b[1]) / 2 + ny)
        assert not square.contains(shapely.Point(mid))
        assert corners == (True, True)


def test_near_straight_vertex_is_no_corner():
    poly = shapely.Polygon([(0, 0), (5, 0.05), (10, 0), (10, 10), (0, 10)])
    by_start = {a: c for a, _, _, _, c in plinths.edges(poly)}
    # the edges either side of the near-straight vertex at (5, 0.05)
    assert by_start[(0.0, 0.0)] == (True, False)
    assert by_start[(5.0, 0.05)] == (False, True)
