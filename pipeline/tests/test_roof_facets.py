"""A face's planes cut into facets where they cross (bake/roof_facets.py)."""

import numpy as np
import shapely
from shapely.affinity import translate

from bake.roof_facets import GRID_M, face_facets, partition, tidy


def _hip(rows=30, cols=44, turn_deg=25.0, pitch=0.6):
    """A hip roof over a 16 × 30 m block turned `turn_deg` off the grid:
    each cell on the lowest of its four planes — the labels, the planes
    (z = a + b·col + c·row) and the block in the grid's frame (x along the
    columns, y against the rows)."""
    t = np.deg2rad(turn_deg)
    u, v = np.array([np.cos(t), np.sin(t)]), np.array([-np.sin(t), np.cos(t)])
    centre = np.array([cols / 2 - 0.5, rows / 2 - 0.5])
    planes = {}
    for k, (way, half) in enumerate(((u, 15.0), (-u, 15.0), (v, 8.0), (-v, 8.0)), start=1):
        # rising inward from the eave `half` out along `way`
        planes[k] = np.array([pitch * (half + way @ centre), *(-pitch * way)])
    r, c = np.indices((rows, cols))
    z = np.stack([p[0] + p[1] * c + p[2] * r for p in planes.values()])
    near = z.argmin(0) + 1
    cx, cy = centre[0] + 0.5, -(centre[1] + 0.5)
    corners = [
        (cx + a * 15 * u[0] + b * 8 * v[0], cy - a * 15 * u[1] - b * 8 * v[1])
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ]
    return near, planes, shapely.Polygon(corners)


def _z(plane, x, y):
    return plane[0] + plane[1] * x + plane[2] * y


def test_a_hips_ridge_and_hips_are_the_lines_its_planes_cross_along():
    near, planes, block = _hip()
    facets = face_facets(near, planes, (0.0, 0.0), block)
    assert facets is not None and len(facets) == 4
    # two trapezia and two triangles: no step of the raster left on a crease
    assert sorted(len(cell.exterior.coords) - 1 for _, cell in facets) == [3, 3, 4, 4]
    assert np.isclose(sum(cell.area for _, cell in facets), block.area, rtol=1e-3)
    # every corner two facets share lies on both planes' crossing: one
    # height there, to the centimetre grid's rounding
    at: dict = {}
    for plane, cell in facets:
        for x, y in cell.exterior.coords[:-1]:
            at.setdefault((round(x, 2), round(y, 2)), []).append(_z(plane, x, y))
    shared = [zs for zs in at.values() if len(zs) > 1]
    assert len(shared) == 6  # four eave corners, the ridge's two ends
    assert max(np.ptp(zs) for zs in shared) < 0.03
    # the ridge: level, at the height the flanks reach over the 16 m span
    ridge = [zs for zs in shared if len(zs) == 3]
    assert len(ridge) == 2
    assert np.allclose([np.mean(zs) for zs in ridge], 0.6 * 8, atol=0.03)


def test_the_facets_corners_lie_on_the_grid_and_neighbours_share_them():
    near, planes, block = _hip(turn_deg=37.0)
    facets = face_facets(near, planes, (100.0, 200.0), translate(block, 100, 200))
    assert facets is not None
    edges: dict = {}
    for _, cell in facets:
        xy = np.asarray(cell.exterior.coords)
        assert np.allclose(xy / GRID_M, np.round(xy / GRID_M), atol=1e-6)
        for a, b in zip(xy[:-1], xy[1:], strict=True):
            key = tuple(sorted((tuple(np.round(a, 2)), tuple(np.round(b, 2)))))
            edges[key] = edges.get(key, 0) + 1
    # an edge is one facet's (the outline) or two's, whole: no T-junction
    assert set(edges.values()) == {1, 2}
    outline = shapely.union_all([cell for _, cell in facets]).exterior.length
    alone = sum(np.hypot(a[0] - b[0], a[1] - b[1]) for (a, b), n in edges.items() if n == 1)
    assert np.isclose(alone, outline, rtol=1e-6)


def test_a_step_between_two_planes_stays_where_the_labels_put_it_straightened():
    # two houses of a row, the second's roof 2 m lower: the party wall
    # runs along the grid's diagonal, a stair in the labels
    r, c = np.indices((24, 24))
    near = np.where(c - r >= 0, 1, 2)
    planes = {1: np.array([10.0, 0.0, 0.3]), 2: np.array([8.0, 0.0, 0.3])}
    cut = partition(near, planes)
    border = shapely.intersection(cut[1].boundary, cut[2].boundary)
    # one line corner to corner (and its end at the grid's edge), not 24 steps
    assert len(shapely.get_coordinates(shapely.line_merge(border))) <= 3
    assert np.isclose(border.length, 24 * np.sqrt(2), rtol=0.05)
    assert np.isclose(cut[1].area + cut[2].area, 24 * 24)


def test_a_valley_is_cut_where_the_higher_plane_takes_over():
    # an inside corner: two flanks falling toward each other
    r, c = np.indices((20, 30))
    planes = {1: np.array([14.2, -0.5, 0.0]), 2: np.array([-0.3, 0.5, 0.0])}
    z = np.stack([p[0] + p[1] * c for p in planes.values()])
    near = z.argmax(0) + 1
    cut = partition(near, planes)
    # they cross at col 14.5: x = 15.0 on the grid's frame
    border = shapely.intersection(cut[1].boundary, cut[2].boundary)
    assert np.allclose(np.asarray(border.coords)[:, 0], 15.0, atol=0.011)


def test_a_strip_a_cell_wide_goes_to_its_neighbour():
    near = np.ones((10, 12), int)
    near[:, 6:] = 2
    near[:, 5] = 3  # the blur along the border, nearer a third plane
    out = tidy(near)
    assert set(np.unique(out)) == {1, 2}
    assert (out[:, :5] == 1).all() and (out[:, 6:] == 2).all()


def test_labels_without_a_plane_leave_the_face_to_its_grid():
    near, planes, block = _hip()
    del planes[3]
    assert face_facets(near, planes, (0.0, 0.0), block) is None
