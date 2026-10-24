"""Plan 031: the Elbe's landing stages, groynes and ferry lines on a
synthetic bank — the river south of y = 100."""

import numpy as np
import pytest
import rasterio
import shapely

from bake import riverside
from tests.synthetic import SIZE, X0, Y0, local, osm_tile, read, way


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


def raise_ground(tile, x: tuple[int, int], y: tuple[int, int], h: float) -> None:
    """Lift the synthetic DGM to `h` over x0 ≤ x < x1, y0 ≤ y < y1 (metres
    from the tile's south-west corner)."""
    with rasterio.open(tile.dgm, "r+") as dst:
        dgm = dst.read(1)
        dgm[SIZE - y[1] : SIZE - y[0], x[0] : x[1]] = h
        dst.write(dgm, 1)


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
    assert {f["properties"]["fb"] for f in pontoons} == {0.9}  # the default freeboard
    for f in pontoons:
        ys = [local(c)[1] for c in f["geometry"]["coordinates"][0]]
        assert max(ys) <= 100.5  # cut to the water
        bx, by = local(f["properties"]["bank"])
        assert 100.0 <= by <= 102.0  # its gangway meets the bank


def test_groynes_and_ferry_lines_come_through_cut_to_the_water(tmp_path, monkeypatch):
    from bake import riverside

    tile = _bank(tmp_path, monkeypatch)
    raise_ground(tile, (178, 183), (80, 105), 100.8)  # the groyne's stones stand out
    riverside.run(tile)
    doc = read(tile, "riverside")
    [groyne] = _by_kind(doc, "groyne")
    assert groyne["properties"]["w"] == 100.0  # the water beside it
    [ferry] = _by_kind(doc, "ferry")
    assert ferry["properties"]["name"] == "Johannstadt Fähre"
    ys = [local(c)[1] for c in ferry["geometry"]["coordinates"]]
    assert max(ys) < 100.0 and min(ys) <= 21.0


def test_pier_widths_parse_and_clamp():
    from bake.riverside import width_of

    assert width_of('"width"=>"4 m"') == 4.0
    assert width_of('"width"=>"500"') == 30.0
    assert width_of(None) == 3.0


# --- V27–V29: the landing stages and groynes as DOM1 shows them ---------------


WATER_DOM = 99.5  # the scan's water, below the DGM's (100): another day's river


def _river(
    tmp_path,
    monkeypatch,
    hull: float = 1.2,
    finger: bool = False,
    dom: bool = True,
    gangway: float | None = None,
    pier_dom: float = 101.0,
):
    """The river south of y = 100 (DGM 100); a fixed pier at x = 50 (4 m,
    y 90..110), a tagged pontoon at x = 100 (y 70..108) and a long pier at
    x = 150 (y 60..110: a pontoon by its reach) — with `finger` a short
    pier off the first pontoon's east side, with `gangway` a fixed pier
    from the bank onto its north end, DOM1 at that height over it. DOM1:
    the water at 99.5, the fixed pier at `pier_dom` (1 m over the ground),
    the first pontoon `hull` over the water, the long one awash."""
    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[100:, :] = 8
    nodes = {
        1: (50, 110, ""),
        2: (50, 90, ""),
        3: (100, 108, ""),
        4: (100, 70, ""),
        5: (150, 110, ""),
        6: (150, 60, ""),
        7: (101.5, 80, ""),
        8: (115, 80, ""),
        9: (100, 112, ""),
        10: (100, 99, ""),
    }
    ways = [
        way(1, [1, 2], {"man_made": "pier", "width": "4"}),
        way(2, [3, 4], {"man_made": "pier", "floating": "yes"}),
        way(3, [5, 6], {"man_made": "pier"}),
    ]
    if finger:
        ways.append(way(4, [7, 8], {"man_made": "pier", "width": "2"}))
    if gangway is not None:
        ways.append(way(5, [9, 10], {"man_made": "pier", "width": "2"}))
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways), classes=cls)
    if dom:
        d = np.full((SIZE, SIZE), 100.0, np.float32)
        d[100:, :] = WATER_DOM
        d[SIZE - 110 : SIZE - 90, 48:52] = pier_dom  # the fixed pier
        d[SIZE - 108 : SIZE - 70, 99:101] = WATER_DOM + hull  # the pontoon
        if finger:
            d[SIZE - 81 : SIZE - 79, 102:115] = WATER_DOM + hull
        if gangway is not None:
            d[SIZE - 112 : SIZE - 100, 99:101] = gangway
        path = tile.raw_raster("dom1")
        path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=SIZE,
            height=SIZE,
            count=1,
            dtype="float32",
            crs="EPSG:25833",
            transform=tile.transform(SIZE),
        ) as dst:
            dst.write(d, 1)
    riverside.run(tile)
    return read(tile, "riverside")


def test_a_piers_deck_is_the_surface_models_not_the_bank_plus_04(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch)
    [pier] = _by_kind(doc, "pier")
    assert pier["properties"]["deck"] == 101.0  # the DGM + 0.4 would say 100.4


def test_a_pontoon_floats_at_its_measured_freeboard_and_an_awash_one_is_not_drawn(
    tmp_path, monkeypatch
):
    doc = _river(tmp_path, monkeypatch)
    [pontoon] = _by_kind(doc, "pontoon")  # the long one lies under the scan's water
    assert local(pontoon["properties"]["bank"])[0] == pytest.approx(100, abs=3)
    # against the scan's water (99.5), not the DGM's (100)
    assert pontoon["properties"]["fb"] == 1.2


def test_only_a_drawn_pier_spares_a_pontoon_its_gangway(tmp_path, monkeypatch):
    shown = _river(tmp_path / "shown", monkeypatch, gangway=100.8)
    [pontoon] = _by_kind(shown, "pontoon")
    assert "bank" not in pontoon["properties"]  # the pier reaches it
    assert len(_by_kind(shown, "pier")) == 2
    hidden = _river(tmp_path / "hidden", monkeypatch, gangway=100.0)  # not in the scan
    [pontoon] = _by_kind(hidden, "pontoon")
    assert "bank" in pontoon["properties"]
    assert len(_by_kind(hidden, "pier")) == 1


def test_a_pier_the_scan_has_under_the_dgms_river_floats(tmp_path, monkeypatch):
    # 0.4 m over the scan's water (99.5), under the DGM's (100): a pontoon
    doc = _river(tmp_path, monkeypatch, pier_dom=99.9)
    assert _by_kind(doc, "pier") == []
    [floated] = [f for f in _by_kind(doc, "pontoon") if local(f["properties"]["bank"])[0] < 60]
    assert floated["properties"]["fb"] == 0.4
    ys = [local(c)[1] for c in floated["geometry"]["coordinates"][0]]
    assert max(ys) <= 100.5  # cut to the water


def test_the_freeboard_is_clamped(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch, hull=2.2)
    [pontoon] = _by_kind(doc, "pontoon")
    assert pontoon["properties"]["fb"] == 1.5


def test_a_steamer_moored_over_a_landing_stage_hides_its_deck_not_the_stage(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch, hull=4.2)  # a paddle steamer's superstructure
    [pontoon] = _by_kind(doc, "pontoon")
    assert pontoon["properties"]["fb"] == 0.9


def test_a_finger_pier_off_a_pontoon_floats_with_it(tmp_path, monkeypatch):
    doc = _river(tmp_path, monkeypatch, finger=True)
    fingers = [f for f in _by_kind(doc, "pontoon") if f["properties"].get("finger")]
    [finger] = fingers
    assert "bank" not in finger["properties"]
    assert finger["properties"]["fb"] == 1.2  # its pontoon's
    [parent] = [f for f in _by_kind(doc, "pontoon") if not f["properties"].get("finger")]
    assert "bank" in parent["properties"]  # the finger is no way ashore


def test_a_groyne_is_drawn_where_the_ground_stands_over_the_water(tmp_path, monkeypatch):
    nodes = {1: (180, 104, ""), 2: (180, 50, "")}
    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[100:, :] = 8
    tile = osm_tile(
        tmp_path, monkeypatch, nodes, way(1, [1, 2], {"man_made": "groyne"}), classes=cls
    )
    raise_ground(tile, (178, 183), (80, 105), 100.6)  # its head (y < 80) under the river
    river = riverside.River(tile)
    out, under = riverside.groynes(tile, river)
    [groyne] = out
    ys = [local(c)[1] for c in groyne["geometry"]["coordinates"]]
    assert min(ys) == pytest.approx(80, abs=2.1) and max(ys) == pytest.approx(104, abs=0.1)
    assert groyne["properties"]["w"] == 100.0
    assert under == pytest.approx(30, abs=2.1)
    # nothing beside it to tell it from: drawn whole, no `w`
    line = shapely.LineString([(X0 + 20, Y0 + 180), (X0 + 20, Y0 + 150)])
    runs, water = riverside.groyne_runs(line, river)
    assert water is None and runs == [line]
