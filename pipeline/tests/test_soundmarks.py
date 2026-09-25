import json

from synthetic import X0, Y0, local, osm_tile, read, tags, way

CHURCH = {"building": "church", "name": "Kreuzkirche"}


def _square(first_id: int, x: float, y: float, half: float) -> tuple[dict, list[int]]:
    corners = [
        (x - half, y - half),
        (x + half, y - half),
        (x + half, y + half),
        (x - half, y + half),
    ]
    nodes = {first_id + i: (cx, cy, "") for i, (cx, cy) in enumerate(corners)}
    return nodes, [*nodes, first_id]


def _lod2(tile, points: list[tuple[float, float, float]]) -> None:
    """A CityJSON holding only the vertices (the bake reads nothing else)."""
    path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "type": "CityJSON",
        "transform": {"scale": [0.01, 0.01, 0.01], "translate": [X0, Y0, 0.0]},
        "vertices": [[round(x * 100), round(y * 100), round(z * 100)] for x, y, z in points],
        "CityObjects": {},
    }
    path.write_text(json.dumps(doc))


def _tile(tmp_path, monkeypatch):
    """Ground at 100 m. A church at (60, 60) with a 72 m tower in its west
    corner and a 15 m nave; a place of worship outline over the same
    church; a chapel at (150, 60) whose ridge is 9 m up; a mosque at
    (150, 150); a bell tower point beside the church (the same tower) and
    one alone at (40, 160), 30 m tall; a church across the west edge whose
    tip stands outside the tile."""
    nodes: dict = {}
    ways = []
    for wid, (x, y, half, t) in enumerate(
        [
            (60, 60, 15, CHURCH),
            (60, 60, 18, {"amenity": "place_of_worship", "religion": "christian"}),
            (150, 60, 8, {"building": "chapel"}),
            (
                150,
                150,
                10,
                {"amenity": "place_of_worship", "religion": "muslim", "building": "mosque"},
            ),
            (4, 120, 10, {"building": "church"}),
        ],
        start=1,
    ):
        n, refs = _square(wid * 10, x, y, half)
        nodes.update(n)
        ways.append(way(wid, refs, t))
    nodes[100] = (48, 50, tags(man_made="tower", tower__type="bell_tower"))
    nodes[101] = (40, 160, tags(man_made="tower", tower__type="bell_tower"))
    tile = osm_tile(tmp_path, monkeypatch, nodes, "".join(ways))
    _lod2(
        tile,
        [
            (50, 50, 172.0),  # the church's tower tip
            (70, 70, 115.0),  # its nave
            (150, 60, 109.0),  # the chapel's ridge
            (150, 150, 160.0),  # the mosque's minaret
            (40, 160, 130.0),  # the lone bell tower
            (-3, 120, 150.0),  # the seam church's tip, west of the tile
            (8, 120, 140.0),  # its nave, inside the tile
        ],
    )
    return tile


def test_a_church_rings_from_its_tallest_lod2_point(tmp_path, monkeypatch):
    from bake import soundmarks

    tile = _tile(tmp_path, monkeypatch)
    soundmarks.run(tile)
    doc = read(tile, "soundmarks")
    assert "OpenStreetMap" in doc["attribution"] and "GeoSN" in doc["attribution"]
    marks = {local(f["geometry"]["coordinates"]): f["properties"] for f in doc["features"]}
    church = marks[(50.0, 50.0)]
    assert church == {"k": "bell", "h": 72.0, "size": "large", "name": "Kreuzkirche"}


def test_low_roofs_other_faiths_and_twins_do_not_ring(tmp_path, monkeypatch):
    from bake import soundmarks

    tile = _tile(tmp_path, monkeypatch)
    soundmarks.run(tile)
    places = sorted(
        local(f["geometry"]["coordinates"]) for f in read(tile, "soundmarks")["features"]
    )
    # the church once (its place-of-worship outline and its bell-tower node
    # are the same tower), the lone bell tower; no chapel (9 m), no mosque,
    # and the seam church rings from its neighbour tile (its tip is there)
    assert places == [(40.0, 160.0), (50.0, 50.0)]


def test_the_lone_bell_tower_is_small(tmp_path, monkeypatch):
    from bake import soundmarks

    tile = _tile(tmp_path, monkeypatch)
    soundmarks.run(tile)
    props = [
        f["properties"]
        for f in read(tile, "soundmarks")["features"]
        if local(f["geometry"]["coordinates"]) == (40.0, 160.0)
    ]
    assert props == [{"k": "bell", "h": 30.0, "size": "small"}]


def test_a_tile_without_churches_writes_an_empty_file(tmp_path, monkeypatch):
    from bake import soundmarks

    tile = osm_tile(tmp_path, monkeypatch, {1: (10, 10, "")})
    soundmarks.run(tile)
    doc = read(tile, "soundmarks")
    assert doc["features"] == []
    assert doc["type"] == "FeatureCollection"


def test_size_classes_follow_the_tower_height():
    from bake.soundmarks import size_class

    assert [size_class(h) for h in (25, 39.9, 40, 64.9, 65, 94)] == [
        "small",
        "small",
        "medium",
        "medium",
        "large",
        "large",
    ]
