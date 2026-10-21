"""Photo QA, bridges (V10, V11, V13, V15, B10): a deck's width as DOM1
sees it, a mixed deck split by network, a masonry bridge's piers at its
bastions, the stretches over water and the passages opened under a deck."""

import json

import numpy as np
import shapely

from bake import bridge, rail, rail_osm

RING = [(0.0, -6.0), (100.0, -6.0), (100.0, 6.0), (0.0, 6.0), (0.0, -6.0)]


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
    outline = shapely.Polygon(RING)
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


def member(coords, kind, width=None, name=None):
    return rail.Member(shapely.LineString(coords), name, kind, width, 0)


def test_rails_and_a_road_on_one_outline_are_two_decks():
    # the Lombardsbrücke: one footprint, the railway beside the road
    poly = shapely.box(0.0, -10.0, 100.0, 10.0)
    members = [
        member([(0.0, 5.0), (100.0, 5.0)], "rail"),
        member([(0.0, -5.0), (100.0, -5.0)], "road", name="Lombardsbrücke"),
    ]
    decks = rail.footprint_decks(poly, members)
    kinds = sorted(d[2] for d in decks)
    assert kinds == ["rail", "road"]
    for ring, name, kind, centre in decks:
        area = shapely.Polygon(ring).area
        assert 900.0 <= area <= 1100.0
        assert name == "Lombardsbrücke"
        assert (centre[0][1] > 0) == (kind == "rail")
    # one network: one deck, as before
    road = [member([(0.0, -5.0), (100.0, -5.0)], "road"), member([(0, 8), (100, 8)], "path")]
    assert [d[2] for d in rail.footprint_decks(poly, road)] == ["road"]


def test_merged_ways_split_by_the_network_they_carry():
    loose = [
        (shapely.LineString([(0.0, 0.0), (80.0, 0.0)]), None, "road", 7.0, 0),
        (shapely.LineString([(0.0, 6.0), (80.0, 6.0)]), None, "rail", 5.0, 0),
    ]
    decks = rail.merged_decks(loose)
    assert sorted(d[2] for d in decks) == ["rail", "road"]


def test_a_ways_passage_is_as_wide_as_it_is_mapped():
    margin = rail_osm.PASSAGE_MARGIN
    assert rail_osm.passage_half("primary", '"width"=>"9"') == 4.5 + margin
    assert rail_osm.passage_half("primary", '"lanes"=>"2"') == 2 * 1.6 + margin
    assert rail_osm.passage_half("footway", None) == 1.25 + margin
    assert rail_osm.passage_half("residential", '"width"=>"wide"') > margin


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
