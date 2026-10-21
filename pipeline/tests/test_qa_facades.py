"""The facade heuristics' bakes (QA batch: G21 storeys from the neighbours,
G27 the shaped roofs of missing buildings)."""

from types import SimpleNamespace

import numpy as np
import shapely

from bake import osm_buildings as ob
from bake import structures


def _box(first: int, roof: list[int] | None = None) -> dict:
    """A CityJSON LoD2 Solid over the eight vertices from `first` (the
    lower four, then the upper four), its top a RoofSurface."""
    a, b, c, d, e, f, g, k = range(first, first + 8)
    return {
        "type": "Solid",
        "lod": "2",
        "boundaries": [
            [
                [[a, d, c, b]],
                [[e, f, g, k]],
                [[a, b, f, e]],
                [[b, c, g, f]],
                [[c, d, k, g]],
                [[d, a, e, k]],
            ]
        ],
        "semantics": {
            "surfaces": [
                {"type": "GroundSurface"},
                {"type": "RoofSurface"},
                {"type": "WallSurface"},
            ],
            "values": [[0, 1, 2, 2, 2, 2]],
        },
    }


def _city(boxes: dict) -> dict:
    """`boxes`: id → (x0, y0, x1, y1, h, ridge); `ridge` lifts the north
    edge's two upper vertices (a mono-pitch roof) by that many metres."""
    verts, objects = [], {}
    for oid, (x0, y0, x1, y1, h, ridge) in boxes.items():
        first = len(verts)
        ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        verts += [[x, y, 100] for x, y in ring]
        verts += [[x, y, 100 + h + (ridge if y == y1 else 0)] for x, y in ring]
        objects[oid] = {"type": "Building", "geometry": [_box(first)]}
    return {"type": "CityJSON", "vertices": verts, "CityObjects": objects}


def test_eaves_are_the_lowest_roof_over_the_base_and_a_level_roof_is_flat():
    h = ob.eaves(_city({"flat": (0, 0, 10, 10, 12, 0), "pitched": (20, 0, 30, 10, 9, 6)}))
    assert h["flat"] == (12.0, True)
    # the eave at the low edge, not the ridge; a 31° roof is no flat one
    assert h["pitched"] == (9.0, False)


def test_osm_counts_a_storey_only_in_range():
    assert ob.counted(17.0, 4)
    assert not ob.counted(17.0, None)
    assert not ob.counted(17.0, 0)
    # a tower's walls over four storeys, a typo's six on a bungalow
    assert not ob.counted(40.0, 4)
    assert not ob.counted(6.0, 5)


def test_a_building_takes_its_mapped_neighbours_storey_of_its_roof_form_and_eave():
    # five Gründerzeit blocks mapped at 3.7 m storeys around one OSM counts
    # none of, a flat-roofed block among them, a far one, a much lower one
    xy = np.array(
        [[0, 0], [30, 0], [0, 30], [-30, 0], [0, -30], [10, 10], [12, 12], [900, 0], [5, 5]]
    )
    eave = np.array([18.5, 18.5, 18.0, 19.0, 18.5, 18.0, 18.0, 18.0, 6.0])
    flat = np.array([False] * 5 + [False, True, False, False])
    storey = np.array([3.7] * 5 + [np.nan] * 4)
    near = ob.neighbour_storeys(eave, flat, xy, storey)
    assert near[5] == 3.7
    # leave one out: a mapped block's own count is not its neighbours'
    assert near[0] == 3.7
    # another roof form, too far, a much lower eave: the tile's median of
    # its form, which five mapped objects are too few for
    assert np.isnan(near[6])
    assert np.isnan(near[7])
    assert np.isnan(near[8])


def test_the_tile_median_stands_in_where_the_neighbours_are_too_few():
    n = ob.TILE_STOREY_MIN
    xy = np.column_stack([np.arange(n + 1) * 1000.0, np.zeros(n + 1)])
    eave = np.full(n + 1, 15.0)
    flat = np.zeros(n + 1, bool)
    storey = np.r_[np.full(n, 3.0), np.nan]
    near = ob.neighbour_storeys(eave, flat, xy, storey)
    assert near[n] == 3.0


def test_apply_storeys_writes_a_storey_only_where_osm_counts_none():
    city = _city(
        {
            "a": (0, 0, 10, 10, 18.5, 4),
            "b": (20, 0, 30, 10, 18.5, 4),
            "c": (40, 0, 50, 10, 18.5, 4),
            "d": (0, 20, 10, 30, 18.5, 4),
            # OSM's own count is not in range: the neighbours' count stands
            "e": (20, 20, 30, 30, 18.0, 4),
        }
    )
    objects = {k: {"levels": 5} for k in "abcd"}
    objects["e"] = {"levels": 1}
    ids, polys = ob.footprints(city)
    assert ob.apply_storeys(objects, city, ids, polys) == 1
    assert objects["e"]["storey"] == 3.7
    assert all("storey" not in objects[k] for k in "abcd")


def _surfaces(dom: np.ndarray, ground: float = 100.0):
    """A stand-in for structures.Surfaces on a 1 m grid from (0, rows)."""
    rows, cols = dom.shape
    field = SimpleNamespace(xmin=0.0, ymax=float(rows), res=1.0)
    return SimpleNamespace(
        field=field,
        dom=dom,
        above=dom - ground,
        green=np.zeros(dom.shape, bool),
        mask=lambda geom, win: _inside(dom.shape, geom)[win],
    )


def _inside(shape, geom) -> np.ndarray:
    rows, cols = shape
    yy, xx = np.mgrid[0:rows, 0:cols]
    pts = shapely.points(xx.ravel() + 0.5, rows - (yy.ravel() + 0.5))
    return shapely.contains(geom, pts).reshape(shape)


def test_a_missing_buildings_roof_takes_the_shape_the_surface_model_shows():
    # 40 × 24 m: a flat wing 10 m up over its west 14 m, a mono-pitch hall
    # east of it rising 0.4 m a metre from 8 m
    rows, cols = 34, 50
    geom = shapely.box(5, 5, 45, 29)
    dom = np.full((rows, cols), 100.0)
    x = np.arange(cols) + 0.5
    roof = np.where(x < 19, 110.0, 108.0 + 0.4 * (x - 19))
    inside = _inside((rows, cols), geom)
    dom[inside] = np.broadcast_to(roof, (rows, cols))[inside]
    win = (slice(0, rows), slice(0, cols))
    parts = structures.shaped_roof(_surfaces(dom), geom, win, inside, 100.0, 110.0)
    assert parts is not None
    assert len(parts) >= 2
    flat = [p for p in parts if "surface" not in p]
    faces = [p for p in parts if "surface" in p]
    assert flat and faces
    assert any(abs(p["z"] - 110) < 0.5 for p in flat)
    s = faces[0]["surface"]
    assert len(s["dz"]) == s["cols"] * s["rows"]
    # each part inside the outline
    for p in parts:
        assert shapely.Polygon(p["coordinates"][0]).difference(geom.buffer(0.01)).area < 0.01


def test_a_level_roof_stays_the_flat_box():
    rows, cols = 30, 30
    geom = shapely.box(5, 5, 25, 25)
    dom = np.full((rows, cols), 100.0)
    inside = _inside((rows, cols), geom)
    dom[inside] = 112.0
    win = (slice(0, rows), slice(0, cols))
    assert structures.shaped_roof(_surfaces(dom), geom, win, inside, 100.0, 112.0) is None


def _wing_and_hall():
    """The first test's building: a flat wing at 110, a pitched hall."""
    rows, cols = 34, 50
    geom = shapely.box(5, 5, 45, 29)
    dom = np.full((rows, cols), 100.0)
    x = np.arange(cols) + 0.5
    roof = np.where(x < 19, 110.0, 108.0 + 0.4 * (x - 19))
    inside = _inside((rows, cols), geom)
    dom[inside] = np.broadcast_to(roof, (rows, cols))[inside]
    return dom, geom, inside, (slice(0, rows), slice(0, cols))


def test_a_lattice_over_a_roof_stands_at_the_buildings_height(monkeypatch):
    # the wing 7 m over the building's height: a mast's rigging where the
    # model shows a lattice, a roof where it fills it
    dom, geom, inside, win = _wing_and_hall()
    monkeypatch.setattr(structures, "lattice", lambda *_: True)
    parts = structures.shaped_roof(_surfaces(dom), geom, win, inside, 100.0, 103.0)
    assert any(abs(p["z"] - 103) < 0.01 for p in parts if "surface" not in p)
    monkeypatch.setattr(structures, "lattice", lambda *_: False)
    parts = structures.shaped_roof(_surfaces(dom), geom, win, inside, 100.0, 103.0)
    assert any(abs(p["z"] - 110) < 0.5 for p in parts if "surface" not in p)


def test_a_lattice_is_a_surface_the_model_fills_sparsely():
    dom = np.full((20, 20), 108.0)
    geom = shapely.box(5, 5, 11, 11)
    win = (slice(0, 20), slice(0, 20))
    s = _surfaces(dom)
    dom[9:15:3, 5:11] = 135.0  # every third row of a 6 m square: rigging
    assert structures.lattice(s, win, geom, 135.0)
    dom[9:15, 5:11] = 135.0  # the whole square: a plant room, a tower
    assert not structures.lattice(s, win, geom, 135.0)
