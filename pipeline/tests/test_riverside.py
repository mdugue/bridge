"""Plan 031: the Elbe's landing stages, groynes and ferry lines on a
synthetic bank — the river south of y = 100."""

import numpy as np
import shapely
from synthetic import local, osm_tile, read, way


def _bank(tmp_path, monkeypatch):
    cls = np.zeros((200, 200), np.uint8)
    cls[100:, :] = 8  # water: y < 100
    nodes = {
        1: (50, 110, ""),
        2: (50, 90, ""),
        3: (100, 108, ""),
        4: (100, 70, ""),
        5: (150, 110, ""),
        6: (150, 60, ""),
        7: (180, 104, ""),
        8: (180, 80, ""),
        9: (20, 150, ""),
        10: (20, 20, ""),
    }
    ways = "".join(
        [
            way(1, [1, 2], {"man_made": "pier", "width": "4"}),
            way(2, [3, 4], {"man_made": "pier", "floating": "yes"}),
            way(3, [5, 6], {"man_made": "pier"}),
            way(4, [7, 8], {"man_made": "groyne"}),
            way(5, [9, 10], {"route": "ferry", "name": "Johannstadt Fähre"}),
        ]
    )
    return osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)


def _by_kind(doc, k):
    return [f for f in doc["features"] if f["properties"]["k"] == k]


def test_a_pier_stands_at_the_bank_a_pontoon_floats_on_the_water(tmp_path, monkeypatch):
    from bake import riverside

    tile = _bank(tmp_path, monkeypatch)
    riverside.run(tile)
    doc = read(tile, "riverside")
    assert doc["attribution"].startswith("©")
    [pier] = _by_kind(doc, "pier")
    assert pier["properties"]["deck"] == 100.4  # the flat DGM + 0.4 m
    ring = shapely.Polygon(pier["geometry"]["coordinates"][0])
    assert abs(ring.area - 4 * 20) < 1  # buffered to its 4 m width
    pontoons = _by_kind(doc, "pontoon")
    # the tagged floating one, and the one reaching 40 m out on the water
    assert len(pontoons) == 2
    for f in pontoons:
        ys = [local(c)[1] for c in f["geometry"]["coordinates"][0]]
        assert max(ys) <= 100.5  # cut to the water
        bx, by = local(f["properties"]["bank"])
        assert 100.0 <= by <= 102.0  # its gangway meets the bank


def test_groynes_and_ferry_lines_come_through_cut_to_the_water(tmp_path, monkeypatch):
    from bake import riverside

    tile = _bank(tmp_path, monkeypatch)
    riverside.run(tile)
    doc = read(tile, "riverside")
    assert len(_by_kind(doc, "groyne")) == 1
    [ferry] = _by_kind(doc, "ferry")
    assert ferry["properties"]["name"] == "Johannstadt Fähre"
    ys = [local(c)[1] for c in ferry["geometry"]["coordinates"]]
    assert max(ys) < 100.0 and min(ys) <= 21.0


def test_pier_widths_parse_and_clamp():
    from bake.riverside import width_of

    assert width_of('"width"=>"4 m"') == 4.0
    assert width_of('"width"=>"500"') == 30.0
    assert width_of(None) == 3.0
