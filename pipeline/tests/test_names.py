"""Plan 032: the street names' labels and named ways on a synthetic tile."""

import json

import shapely
from synthetic import X0, Y0, local, osm_tile, read, way


def _streets(tmp_path, monkeypatch):
    nodes = {
        1: (-50, 100, ""),
        2: (100, 100, ""),
        3: (250, 100, ""),
        4: (170, 40, ""),
        5: (260, 40, ""),
        6: (20, 150, ""),
        7: (40, 150, ""),
        8: (40, 170, ""),
        9: (20, 20, ""),
        10: (80, 20, ""),
        11: (80, 60, ""),
        12: (20, 60, ""),
    }
    ways = "".join(
        [
            # one street in two ways: merged, lettered once
            way(1, [1, 2], {"highway": "primary", "name": "Lange Straße"}),
            way(2, [2, 3], {"highway": "residential", "name": "Lange Straße"}),
            # its label's middle lies east of the tile: the neighbour's
            way(3, [4, 5], {"highway": "residential", "name": "Ostweg"}),
            # a sharp corner leaves no straight window for the name
            way(4, [6, 7, 8], {"highway": "footway", "name": "Winkelgasse"}),
            way(5, [1, 3], {"highway": "service", "name": "Hofzufahrt"}),
            way(
                6,
                [9, 10, 11, 12, 9],
                {"highway": "pedestrian", "area": "yes", "name": "Kleiner Markt"},
            ),
        ]
    )
    return osm_tile(tmp_path, monkeypatch, nodes, ways)


def test_a_street_in_several_ways_is_lettered_once_on_its_owner(tmp_path, monkeypatch):
    from bake import names

    tile = _streets(tmp_path, monkeypatch)
    names.run(tile)
    doc = read(tile, "names")
    assert doc["attribution"].startswith("©")
    labels = [f for f in doc["features"] if f["properties"]["k"] == "label"]
    by_name = {f["properties"]["name"]: f for f in labels}
    assert sorted(by_name) == ["Kleiner Markt", "Lange Straße"]
    assert by_name["Lange Straße"]["properties"]["c"] == "main"
    assert by_name["Kleiner Markt"]["properties"]["c"] == "square"
    line = shapely.LineString(by_name["Lange Straße"]["geometry"]["coordinates"])
    assert abs(line.length - names.label_length("Lange Straße")) < 1.0
    ways = {f["properties"]["name"] for f in doc["features"] if f["properties"]["k"] == "way"}
    # the service way names nothing; the ways are cut at the tile edge
    assert ways == {"Lange Straße", "Ostweg", "Winkelgasse"}
    for f in doc["features"]:
        if f["properties"]["k"] == "way":
            xs = [local(c)[0] for c in f["geometry"]["coordinates"]]
            assert min(xs) >= 0 and max(xs) <= 200


def test_a_window_must_turn_less_than_twenty_degrees():
    from bake.names import anchors, turning

    corner = shapely.LineString([(0, 0), (60, 0), (60, 60)])
    assert turning(corner, 0, 120) > 80
    assert anchors(corner, "Winkelgasse") == []
    straight = shapely.LineString([(0, 0), (1000, 0)])
    assert len(anchors(straight, "Lange Straße")) == 2  # one per 450 m


def test_a_name_across_a_seam_is_windowed_alike_on_both_tiles(tmp_path, monkeypatch):
    """Both tiles merge the whole street (not their clipped view of it), so
    they find the same window and only the owner of its middle letters it."""
    from bake import names
    from bake.common import Tile

    nodes = {1: (-100, 100, ""), 2: (60, 100, ""), 3: (520, 100, "")}
    ways = way(1, [1, 2], {"highway": "residential", "name": "Nahtstraße"}) + way(
        2, [2, 3], {"highway": "residential", "name": "Nahtstraße"}
    )
    west = osm_tile(tmp_path, monkeypatch, nodes, ways)
    east = Tile("u", (X0 + 200, Y0, X0 + 400, Y0 + 200), 25833, west.raw, west.data)
    names.run(west)
    names.run(east)
    mids = []
    for tile_id in ("t", "u"):
        path = west.data / "dlm" / f"names_{tile_id}.geojson"
        for f in json.loads(path.read_text())["features"]:
            if f["properties"]["k"] == "label":
                line = shapely.LineString(f["geometry"]["coordinates"])
                mids.append((tile_id, line.interpolate(0.5, normalized=True)))
    assert len(mids) == 1
    tile_id, mid = mids[0]
    # the whole 620 m street's one window sits at its middle, x ≈ 210 m
    assert tile_id == "u"
    assert abs(mid.x - X0 - 210) < 5
