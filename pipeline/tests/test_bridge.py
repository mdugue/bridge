"""bridge.py: the measured bridge."""

import numpy as np

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
    assert abs(deck(0.1) - 123.0) < 0.01  # lifted to the roadway
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
