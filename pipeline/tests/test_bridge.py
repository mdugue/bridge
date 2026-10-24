"""bridge.py: the measured bridge."""

import json

import numpy as np
import shapely

from bake import bridge


class FakeGround:
    """A flat DGM at 100 m and a DOM that is `surface(x, y)` on a 1 m grid."""

    def __init__(self, surface):
        self.surface = surface
        self.dom = np.zeros((1, 1))

    def sample(self, _arr, xs, ys):
        return np.vectorize(self.surface)(xs, ys).astype(float)

    def lowest(self, _x, _y, _win):
        return 100.0


RING = [(0.0, -6.0), (200.0, -6.0), (200.0, 6.0), (0.0, 6.0), (0.0, -6.0)]


def test_the_opening_drops_lamps_and_the_closing_bridges_gaps():
    rise = np.zeros(160)
    rise[10] = 8.0  # a lamp
    rise[40:100] = 12.0  # a chord...
    rise[70:75] = 0.0  # ...with a hole in the raster
    rise[140:148] = 6.0  # a lorry-length bump: too short to be structure
    clean = bridge.clean_rise(rise)
    assert clean[10] == 0
    assert clean[72] == 12.0
    assert clean[144] == 0
    assert (clean[40:100] > 0).all()


def test_a_truss_on_the_deck_edges_becomes_two_ribs():
    def surface(x, y):
        chord = 120 + max(0.0, 20 - abs(x - 100) * 0.3)  # a pylon at 100 m
        return chord if abs(abs(y) - 5.5) < 0.6 and 30 <= x <= 170 else 120.5

    ribs = bridge.superstructure(FakeGround(surface), RING, lambda t: 120.0)
    assert len(ribs) == 2
    assert sorted(round(r["offset"]) for r in ribs) in ([-6, 5], [-5, 5], [-6, 6], [-5, 6])
    rise = ribs[0]["rise"]
    assert len(rise) == 101
    assert max(rise) > 17
    assert rise[5] == 0  # before the truss starts


def test_a_central_arch_is_one_rib():
    def surface(x, y):
        crown = 132 - 0.004 * (x - 100) ** 2
        return crown if abs(y) < 0.6 and crown > 121 else 120.5

    ribs = bridge.superstructure(FakeGround(surface), RING, lambda t: 120.0)
    assert len(ribs) == 1
    assert abs(ribs[0]["offset"]) < 1


def test_the_measured_deck_follows_the_roadway_but_not_a_train():
    def surface(x, y):
        if 80 <= x <= 120:
            return 131.0  # a train standing on the deck
        return 123.0

    deck = bridge.measured_deck(FakeGround(surface), RING, lambda t: 120.0)
    assert abs(deck(0.1) - 123.0) < 0.3  # lifted to the roadway
    assert deck(0.5) <= 124.0  # the train is not the deck (held near the ramp)


def test_the_fairway_mark_sets_the_structural_depth():
    ground = FakeGround(lambda x, y: 120.0)
    marks = [(150.0, 0.0, 11.5, "Q1"), (900.0, 0.0, 9.0, None)]
    got = bridge.fairway(ground, RING, lambda t: 114.0, marks)
    assert got["clearance"] == 11.5
    assert got["depth"] == 2.5  # 114 − (100 + 11.5)
    assert abs(got["fairway"] - 0.75) < 0.01
    assert bridge.fairway(ground, RING, lambda t: 114.0, marks[1:]) == {}


def test_wikidata_classes_map_to_the_osm_vocabulary():
    assert bridge.structure_of(["Bogenbrücke", "Straßenbrücke"]) == "arch"
    assert (
        bridge.structure_of(["Gerberträgerbrücke", "Hängebrücke", "Kettenbrücke"])
        == "suspension;cantilever"
    )
    assert bridge.structure_of(["Straßenbrücke"]) == ""


def test_a_deck_finds_its_wikidata_item_by_tag_or_by_name():
    known = [
        {"id": "Q1", "label": "Blaues Wunder", "x": 100.0, "y": 0.0, "types": []},
        {"id": "Q2", "label": "Albertbrücke", "x": 5000.0, "y": 0.0, "types": []},
    ]
    assert bridge.wikidata_for(RING, None, ["Q1"], known)["id"] == "Q1"
    assert bridge.wikidata_for(RING, "Blaues Wunder", [], known)["id"] == "Q1"
    assert bridge.wikidata_for(RING, "Albertbrücke", [], known) is None  # too far


def test_the_deck_line_ramps_instead_of_dropping_off_a_cliff():
    # a rail deck at 118 m whose first 6 m the DOM sees as the street below
    deck = np.full(60, 118.0)
    deck[:6] = 112.5
    limited = bridge.limit_grade(deck, 1.0, bridge.RAIL_GRADE)
    assert limited[10] == 118.0
    assert np.all(np.abs(np.diff(limited)) <= bridge.RAIL_GRADE + 1e-9)
    assert limited[0] > 117.5


def test_a_bridge_line_beside_a_footprint_is_not_laid_on_it():
    from shapely import LineString, Polygon

    from bake.rail import footprint_of

    # the rail bridge's footprint, 30 m wide; the road bridge's line 16 m
    # beside it (the Marienbrücke), then a line running along its middle
    rail = Polygon([(0, -15), (200, -15), (200, 15), (0, 15)])
    polys = [[list(rail.exterior.coords), 100, 0, False, rail]]
    assert footprint_of(LineString([(-10, 31), (210, 31)]), polys) == -1
    assert footprint_of(LineString([(-10, 0), (210, 0)]), polys) == 0
    polys[0][3] = True  # a claimed footprint is not matched twice
    assert footprint_of(LineString([(-10, 0), (210, 0)]), polys) == -1


def test_the_axis_runs_down_the_middle_of_the_deck_not_corner_to_corner():
    axis = bridge.deck_axis(RING)
    assert abs(axis.length - 200.0) < 1e-6
    assert axis.point(0.0) == (0.0, 0.0)  # starts at the end nearer the first vertex
    assert abs(axis.project(100.0, 6.0)[1] - 6.0) < 1e-6  # the edges are ±6 all along
    assert abs(axis.project(190.0, -6.0)[1] + 6.0) < 1e-6


def test_a_curved_bridge_line_becomes_its_axis_run_on_to_the_ends():
    import math

    import shapely

    # a deck 12 m wide along a quarter circle of radius 100 m
    arc = [(100 * math.cos(a), 100 * math.sin(a)) for a in np.linspace(0, math.pi / 2, 30)]
    ring = [
        (x, y) for x, y, *_ in shapely.LineString(arc).buffer(6, cap_style="flat").exterior.coords
    ]
    line = arc[1:-1]  # the DLM line stops a few metres short of the abutments
    axis = bridge.deck_axis(ring, line)
    assert abs(axis.length - 100 * math.pi / 2) < 2.0
    for s in (10.0, 80.0, 150.0):
        x, y = axis.point(s)
        assert abs(math.hypot(x, y) - 100) < 0.6  # on the curve, not on its chord
    # a ring vertex is 6 m to one side, wherever it sits along the curve
    for x, y in ring[:-1]:
        assert abs(abs(axis.project(x, y)[1]) - 6.0) < 1.0


def test_a_deck_the_raster_sees_sagging_comes_out_straight_not_bowed_in():
    stations = np.arange(0.0, 301.0)
    sag = 120 - 2.5 * np.sin(np.pi * stations / 300)  # 2.5 m low in the middle
    flat = bridge.camber_fit(stations, sag, bridge.MAX_GRADE)
    assert np.allclose(flat, 120.0)
    # a real camber is kept, the ends stay where they were measured
    hump = 118 + 3 * np.sin(np.pi * stations / 300) + np.where(stations % 7 == 3, 0.8, 0)
    fit = bridge.camber_fit(stations, hump, bridge.MAX_GRADE)
    assert fit[0] == hump[0] and fit[-1] == hump[-1]
    assert 120.5 < fit[150] < 121.5
    assert np.all(np.diff(fit[:150]) >= 0) and np.all(np.diff(fit[150:]) <= 0)


SHORT_RING = [(0.0, -6.0), (100.0, -6.0), (100.0, 6.0), (0.0, 6.0), (0.0, -6.0)]


class Ground:
    """A DOM and a DGM, each `f(x, y)` on a 1 m grid."""

    def __init__(self, dom=None, dgm=None):
        self.dom = np.zeros((1, 1)) if dom else None
        self.dgm = np.ones((1, 1))
        self._dom, self._dgm = dom, dgm

    def sample(self, arr, xs, ys):
        f = self._dom if arr is self.dom else self._dgm
        return np.vectorize(f)(np.asarray(xs, dtype=float), np.asarray(ys, dtype=float)).astype(
            float
        )


def deck_surface(half_at):
    """A deck at 110 m, `half_at(x)` either side of y = 0, over water at 100 m."""
    return lambda x, y: 110.0 if abs(y) <= half_at(x) else 100.0


def test_the_deck_is_as_wide_as_dom1_sees_it_around_an_offset_line():
    # a 20 m deck whose mapped line runs 2 m off its middle
    ground = Ground(dom=deck_surface(lambda x: 10.0))
    axis = bridge.Axis([(0.0, 2.0), (100.0, 2.0)])
    left, right = bridge.measured_halves(ground, axis, lambda t: 110.0)
    assert abs(left - 8.0) <= 0.5
    assert abs(right - 12.0) <= 0.5
    # another deck beside it stops the side (no gap between them)
    stop = lambda xs, ys: np.asarray(ys) < -4.0  # noqa: E731
    _, stopped = bridge.measured_halves(ground, axis, lambda t: 110.0, stop)
    assert abs(stopped - 6.0) <= 0.5


def test_the_side_dom1_lost_is_mirrored_and_the_width_clamped():
    assert bridge.deck_halves((8.0, 12.0), 11.0) == (8.0, 12.0)
    assert bridge.deck_halves((None, 9.0), 11.0) == (9.0, 9.0)
    assert bridge.deck_halves((None, None), 11.0) == (5.5, 5.5)
    left, right = bridge.deck_halves((30.0, 30.0), 11.0)
    assert left + right == bridge.WIDTH_MAX
    left, right = bridge.deck_halves((1.0, 0.5), 11.0)
    assert abs(left + right - bridge.WIDTH_MIN) < 1e-9


def test_a_deck_in_the_trees_is_not_measured():
    # the surface never falls beside the deck: no side, the fallback holds
    ground = Ground(dom=lambda x, y: 110.0)
    axis = bridge.Axis([(0.0, 0.0), (100.0, 0.0)])
    assert bridge.measured_halves(ground, axis, lambda t: 110.0) == (None, None)


def test_a_masonry_bridge_has_its_piers_where_its_deck_bulges():
    # an 18 m deck widening 3 m each side over 6 m at its piers
    def half_at(x):
        return 12.0 if abs(x - 45.0) < 3.0 or abs(x - 90.0) < 3.0 else 9.0

    ground = Ground(dom=deck_surface(half_at))
    axis = bridge.Axis([(0.0, 0.0), (135.0, 0.0)])
    piers = bridge.bastion_piers(ground, axis, lambda t: 110.0)
    assert len(piers) == 2
    assert abs(piers[0] - 45.0) <= 1.0
    assert abs(piers[1] - 90.0) <= 1.0
    # a deck of one width has none
    plain = Ground(dom=deck_surface(lambda x: 9.0))
    assert bridge.bastion_piers(plain, axis, lambda t: 110.0) == []


def test_the_stretches_over_water():
    axis = bridge.Axis([(0.0, 0.0), (100.0, 0.0)])
    runs = bridge.water_runs(lambda xs, ys: (xs > 30) & (xs < 70), axis)
    assert len(runs) == 1
    assert abs(runs[0][0] - 31) <= 1 and abs(runs[0][1] - 69) <= 1
    # a puddle is no river
    assert bridge.water_runs(lambda xs, ys: (xs > 30) & (xs < 32), axis) == []


def fill(x, y):
    """The DGM: a street at 108 m that the fill under the deck closes."""
    return 117.0 if abs(y) < 8.0 else 108.0


def test_a_street_the_dgm_closes_under_a_deck_is_opened():
    ground = Ground(dgm=fill)
    axis = bridge.Axis([(0.0, 0.0), (100.0, 0.0)])
    outline = shapely.Polygon(SHORT_RING)
    street = shapely.LineString([(50.0, -40.0), (50.0, 40.0)])
    got = bridge.way_passages(ground, outline, axis, lambda t: 118.0, [(street, 4.0)])
    assert len(got) == 1
    passage = got[0]
    assert passage["h"] == 4.0
    assert all(y == 108.0 for y in passage["y"])
    ys = [c[1] for c in passage["c"]]
    assert min(ys) < -6.0 and max(ys) > 6.0  # under the whole deck
    assert len(passage["c"]) == len(passage["y"])
    # a way that ends under the deck (onto it) is not passed under
    onto = shapely.LineString([(50.0, -40.0), (50.0, 0.0)])
    assert bridge.way_passages(ground, outline, axis, lambda t: 118.0, [(onto, 4.0)]) == []
    # nor one the DGM leaves open
    open_ground = Ground(dgm=lambda x, y: 108.0)
    assert bridge.way_passages(open_ground, outline, axis, lambda t: 118.0, [(street, 4.0)]) == []
    # nor one with no headroom under the deck
    low = bridge.way_passages(ground, outline, axis, lambda t: 109.0, [(street, 4.0)])
    assert low == []


def test_the_bridge_the_dgm_holds_over_a_canal_is_opened_across_the_deck():
    # Hamburg's DGM keeps the bridge: 112 m under the deck, the canal (x
    # 20–40) at 104 m either side of it, the quays at 112 m
    def dgm(x, y):
        return 112.0 if abs(y) <= 6.5 or not 20.0 <= x <= 40.0 else 104.0

    ground = Ground(dgm=dgm)
    ring = [(0.0, -5.0), (60.0, -5.0), (60.0, 5.0), (0.0, 5.0), (0.0, -5.0)]
    axis = bridge.Axis([(0.0, 0.0), (60.0, 0.0)])
    got = bridge.hump_passages(ground, ring, axis, lambda t: 113.0)
    assert len(got) >= bridge.HUMP_RUN
    for passage in got:
        assert passage["y"] == [104.0, 104.0]
        assert 19.0 <= passage["c"][0][0] <= 41.0
        # across the deck, a metre past each edge
        assert sorted(round(c[1]) for c in passage["c"]) == [-6, 6]

    # a hump at a deck's end is its abutment, unless it is the whole deck
    def at_end(x, y):
        return 112.0 if abs(y) <= 6.5 or x > 12.0 else 104.0

    assert bridge.hump_passages(Ground(dgm=at_end), ring, axis, lambda t: 113.0) == []


def test_wikidata_spans_are_counts_and_old_caches_are_refetched(tmp_path):
    assert bridge._count({"spans": {"value": "5"}}, "spans") == 5
    assert bridge._count({"spans": {"value": "2.5"}}, "spans") is None
    assert bridge._count({"spans": {"value": "0"}}, "spans") is None
    assert bridge._count({}, "spans") is None
    old = tmp_path / "old.json"
    old.write_text(json.dumps({"bridges": []}))
    new = tmp_path / "new.json"
    new.write_text(json.dumps({"version": bridge.WIKIDATA_VERSION, "bridges": []}))
    assert bridge.cache_version(old) < bridge.WIKIDATA_VERSION
    assert bridge.cache_version(new) == bridge.WIKIDATA_VERSION
