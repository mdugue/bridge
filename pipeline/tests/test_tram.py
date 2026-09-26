import numpy as np
from synthetic import X0, Y0, local, neighbour, osm_tile, read, tags, way

TRAM = {"railway": "tram", "gauge": "1450", "electrified": "contact_line"}
MAST = tags(power="catenary_mast")


def _tram_tile(tmp_path, monkeypatch, buildings: bool = True):
    """A street track along y = 100 (on the road band, running 50 m past
    both tile edges), a lawn track along y = 150 (on the meadow band), a
    ballast track along y = 50 (unclassified ground); masts either side of
    the street at x = 100, one beside the lawn track, one west of the
    tile, one too far from any track; two blocks either side of the street
    towards the east end."""
    cls = np.zeros((200, 200), np.uint8)
    cls[90:111, :] = 7  # road: y 90..110
    cls[40:61, :] = 1  # meadow: y 140..160
    nodes = {
        1: (-50, 100, ""),
        2: (250, 100, ""),
        3: (20, 150, ""),
        4: (180, 150, ""),
        5: (20, 50, ""),
        6: (180, 50, ""),
        10: (100, 88, MAST),
        11: (100, 112, MAST),
        12: (50, 144, MAST),
        13: (-10, 94, MAST),
        14: (100, 20, MAST),
    }
    ways = [
        way(1, [1, 2], TRAM),
        way(2, [3, 4], TRAM),
        way(3, [5, 6], TRAM),
    ]
    if buildings:
        corners = {
            20: (150, 108),
            21: (210, 108),
            22: (210, 130),
            23: (150, 130),
            24: (150, 70),
            25: (210, 70),
            26: (210, 92),
            27: (150, 92),
        }
        nodes.update({k: (x, y, "") for k, (x, y) in corners.items()})
        ways.append(way(10, [20, 21, 22, 23, 20], {"building": "yes"}))
        ways.append(way(11, [24, 25, 26, 27, 24], {"building": "yes"}))
    return osm_tile(tmp_path, monkeypatch, nodes, "".join(ways), classes=cls)


def _by_kind(doc, k):
    return [f for f in doc["features"] if f["properties"]["k"] == k]


def test_tracks_take_their_bed_from_the_ground_and_stop_at_the_tile_edge(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch)
    tram.run(tile)
    doc = read(tile, "tram")
    assert doc["attribution"].startswith("©")
    beds = {}
    for f in _by_kind(doc, "track"):
        _, y = local(f["geometry"]["coordinates"][0])
        beds[round(y)] = f["properties"]["bed"]
        xs = [local(c)[0] for c in f["geometry"]["coordinates"]]
        assert min(xs) >= 0 and max(xs) <= 200
    assert beds == {100: "street", 150: "grass", 50: "ballast"}


def test_masts_pair_across_the_tracks_or_carry_an_arm(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch)
    tram.run(tile)
    doc = read(tile, "tram")
    masts = sorted(local(f["geometry"]["coordinates"]) for f in _by_kind(doc, "mast"))
    # the mast west of the tile is its neighbour's; the far one is the railway's
    assert masts == [(50.0, 144.0), (100.0, 88.0), (100.0, 112.0)]
    [span] = _by_kind(doc, "span")
    assert sorted(local(c) for c in span["geometry"]["coordinates"]) == [
        (100.0, 88.0),
        (100.0, 112.0),
    ]
    assert span["properties"]["x"] == [0.5]
    [arm] = _by_kind(doc, "arm")
    (x0, y0), (x1, y1) = (local(c) for c in arm["geometry"]["coordinates"])
    assert (x0, y0) == (50.0, 144.0) and x1 == 50.0 and 150.0 < y1 < 150.5


def test_rosette_spans_hang_between_facades_where_no_mast_is_near(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch)
    tram.run(tile)
    doc = read(tile, "tram")
    rosettes = _by_kind(doc, "rosette")
    xs = sorted(local(f["geometry"]["coordinates"][0])[0] for f in rosettes)
    assert xs == [165.0, 195.0]
    for f in rosettes:
        ys = sorted(local(c)[1] for c in f["geometry"]["coordinates"])
        assert ys == [92.0, 108.0]  # the facades either side
    # the street track's wire is held at the span and the rosettes
    [street] = [f for f in _by_kind(doc, "track") if f["properties"]["bed"] == "street"]
    assert street["properties"]["s"] == [100.0, 165.0, 195.0]
    [lawn] = [f for f in _by_kind(doc, "track") if f["properties"]["bed"] == "grass"]
    assert lawn["properties"]["s"] == [30.0]


def test_without_facades_no_rosette_is_invented(tmp_path, monkeypatch):
    from bake import tram

    tile = _tram_tile(tmp_path, monkeypatch, buildings=False)
    tram.run(tile)
    assert _by_kind(read(tile, "tram"), "rosette") == []


def test_bridge_and_layer_tags_are_read():
    from bake.tram import bridge_of, layer_of

    assert bridge_of('"bridge"=>"viaduct"') == 1
    assert bridge_of('"bridge"=>"no"') == 0
    assert bridge_of(None) == 0
    assert layer_of('"layer"=>"-1"') == -1
    assert layer_of('"layer"=>"x"') == 0


def test_a_tram_stop_signs_its_platform_unless_a_shelter_stands_there(tmp_path, monkeypatch):
    import json

    from bake import tram

    cls = np.zeros((200, 200), np.uint8)
    cls[90:111, :] = 7
    stop = tags(railway="tram_stop", name="Albertplatz")
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (40, 100, stop),  # on the track, a platform 4 m south
        4: (30, 96, ""),
        5: (50, 96, ""),
        6: (120, 100, stop),  # a shelter stands on its platform
        7: (110, 96, ""),
        8: (130, 96, ""),
        9: (170, 100, stop),  # no platform
    }
    ways = [
        way(1, [1, 3, 6, 9, 2], TRAM),
        way(2, [4, 5], {"public_transport": "platform", "tram": "yes"}),
        way(3, [7, 8], {"public_transport": "platform", "tram": "yes"}),
    ]
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways), classes=cls)
    shelter = {
        "type": "Feature",
        "properties": {"k": "shelter", "a": 0},
        "geometry": {"type": "Point", "coordinates": [X0 + 121, Y0 + 95]},
    }
    furniture = {"type": "FeatureCollection", "features": [shelter]}
    (tile.data / "dlm" / "furniture_t.geojson").write_text(json.dumps(furniture))
    tram.run(tile)
    [sign] = _by_kind(read(tile, "tram"), "stop")
    assert local(sign["geometry"]["coordinates"]) == (40.0, 96.0)
    assert sign["properties"] == {"k": "stop", "a": 0, "name": "Albertplatz"}


def test_a_shelter_across_the_seam_takes_the_stops_sign(tmp_path, monkeypatch):
    import json

    from bake import tram

    stop = tags(railway="tram_stop", name="Nahtstelle")
    nodes = {
        1: (0, 100, ""),
        2: (260, 100, ""),
        3: (197, 100, stop),  # the sign would stand at (197, 96), on this tile
        4: (185, 96, ""),
        5: (215, 96, ""),
    }
    ways = [
        way(1, [1, 3, 2], TRAM),
        way(2, [4, 5], {"public_transport": "platform", "tram": "yes"}),
    ]
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways))
    east = neighbour(tile, "u")
    shelter = {
        "type": "Feature",
        "properties": {"k": "shelter", "a": 0},
        "geometry": {"type": "Point", "coordinates": [X0 + 203, Y0 + 95]},
    }
    doc = {"type": "FeatureCollection", "features": [shelter]}
    (east.data / "dlm" / "furniture_u.geojson").write_text(json.dumps(doc))
    tram.run(tile)
    # the shelter 6 m away is the neighbour's: it stands for the stop still
    assert _by_kind(read(tile, "tram"), "stop") == []
