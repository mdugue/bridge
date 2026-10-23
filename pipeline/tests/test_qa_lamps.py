"""The photo QA's lamp and street furniture findings (PR #173): tall masts
hold their head on an arm over the carriageway, a lantern OSM puts on a wall
with no building near hangs on the mapped wall, and the signals and hydrant
signs on a bridge stand at its deck's edge."""

from __future__ import annotations

import json

import numpy as np
import pytest
import rasterio
import shapely
from synthetic import SIZE, X0, Y0, local, osm_tile, read, tags, way


def _write_raster(tile, path, values) -> None:
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
        dst.write(values.astype("float32"), 1)


# --- arms -------------------------------------------------------------------


def _lines(*coords):
    lines = np.array([shapely.LineString(c) for c in coords], dtype=object)
    return shapely.STRtree(lines), lines


def _carriageways(*coords):
    return [_lines(*coords)]


def test_a_tall_post_reaches_its_arm_to_the_carriageway():
    from bake.lamp_heights import arm_of

    roads = _carriageways([(0, 100), (200, 100)])
    beside = shapely.Point(50, 104)  # 4 m north of the street's line
    assert arm_of(beside, 9.0, False, roads) == 180
    # a post under the arm's height stands with its head on top
    assert arm_of(beside, 5.0, False, roads) is None
    # ... unless OSM calls its mast bent
    assert arm_of(beside, 5.0, True, roads) == 180
    # no carriageway within reach, or the post on its line: no side to reach to
    assert arm_of(shapely.Point(50, 130), 9.0, False, roads) is None
    assert arm_of(shapely.Point(50, 100.2), 9.0, False, roads) is None


def test_a_mast_between_two_carriageways_reaches_the_nearer_one_only():
    from bake.lamp_heights import arm_of

    # a dual carriageway's two lines 12 m apart, the mast on the strip between
    roads = _carriageways([(0, 94), (200, 94)], [(0, 106), (200, 106)])
    assert arm_of(shapely.Point(50, 99), 10.0, False, roads) == 180
    assert arm_of(shapely.Point(50, 101), 10.0, False, roads) == 0


def test_a_mast_reaches_over_the_street_not_the_service_way_behind_it():
    from bake.lamp_heights import arm_of

    # a car park's aisle 2 m north of the mast, the street 6 m south
    roads = [_lines([(0, 94), (200, 94)]), _lines([(0, 102), (200, 102)])]
    assert arm_of(shapely.Point(50, 100), 9.0, False, roads) == 180
    # with no street in reach, the service way is what it lights
    assert arm_of(shapely.Point(50, 100), 9.0, False, roads[1:]) == 0


def test_lamp_heights_give_the_tall_posts_of_a_main_road_an_arm(tmp_path, monkeypatch):
    """A primary road along y = 150 with four lamps 2 m north of it that
    DOM1 reads at 10 m, a residential street along y = 50 with two at 4.5 m,
    one of them a bent mast."""
    from bake import lamp_heights

    nodes = {1: (0, 150, ""), 2: (200, 150, ""), 3: (0, 50, ""), 4: (200, 50, "")}
    ways = way(1, [1, 2], {"highway": "primary", "name": "Hauptstraße"}) + way(
        2, [3, 4], {"highway": "residential", "name": "Gasse"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dom = np.full((SIZE, SIZE), 100.0)
    for x in (20, 60, 100, 140):
        dom[SIZE - 153, x] = 110.0
    for x in (40, 80, 120):
        dom[SIZE - 53, x] = 104.5
    _write_raster(tile, tile.raw_raster("dom1"), dom)

    def lamp(x, y, **props):
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [X0 + x, Y0 + y]},
            "properties": {"h": 5.0, **props},
        }

    features = [lamp(x, 152.5) for x in (20, 60, 100, 140)]
    features += [lamp(40, 52.5), lamp(80, 52.5, bent=True), lamp(120, 52.5)]
    path = tile.out("dlm", "lamps_t.geojson")
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    lamp_heights.run(tile)
    out = [f["properties"] for f in json.loads(path.read_text())["features"]]
    assert [(p["h"], p.get("arm")) for p in out[:4]] == [(10.0, 180)] * 4
    assert [(p["h"], p.get("arm")) for p in out[4:]] == [(4.5, None), (4.5, 180), (4.5, None)]


def test_a_bent_mast_is_called_so():
    from bake.lamps import post

    assert post(5.0, '"lamp_mount"=>"bent_mast"') == {"h": 5.0, "bent": True}
    assert post(5.0, '"lamp_mount"=>"straight_mast"') == {"h": 5.0}
    assert post(5.0, None) == {"h": 5.0}


# --- lanterns on a mapped wall -------------------------------------------------


def _walls(tmp_path, monkeypatch):
    """A retaining wall along y = 100 (drawn east), its high ground north
    (108 m against 100 m south); a garden wall along y = 40 on flat ground;
    a city wall along x = 190 (drawn north) with a street along x = 170
    west of it. No buildings."""
    nodes = {
        1: (20, 100, ""),
        2: (180, 100, ""),
        3: (20, 40, ""),
        4: (180, 40, ""),
        5: (190, 10, ""),
        6: (190, 60, ""),
        7: (170, 0, ""),
        8: (170, 80, ""),
        10: (60, 100, tags(highway="street_lamp", lamp_mount="wall")),
        11: (120, 100, tags(highway="street_lamp")),
        12: (60, 40, tags(highway="street_lamp", lamp_mount="wall")),
        13: (190, 30, tags(highway="street_lamp", support="wall_mounted")),
    }
    ways = (
        way(1, [1, 10, 11, 2], {"barrier": "retaining_wall"})
        + way(2, [3, 12, 4], {"barrier": "wall"})
        + way(3, [5, 13, 6], {"barrier": "city_wall"})
        + way(4, [7, 8], {"highway": "residential"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dgm = np.full((SIZE, SIZE), 100.0)
    dgm[: SIZE - 100, :] = 108.0  # north of y = 100
    _write_raster(tile, tile.dgm, dgm)
    return tile


def _lamps(tile):
    from bake import lamps

    lamps.run(tile)
    return {
        local(f["geometry"]["coordinates"]): f["properties"]
        for f in read(tile, "lamps")["features"]
    }


def test_a_wall_lantern_with_no_building_near_hangs_on_the_wall(tmp_path, monkeypatch):
    lamps = _lamps(_walls(tmp_path, monkeypatch))
    # on the retaining wall's face, the low side, half a metre out
    face = lamps[(60.0, 99.5)]
    assert face["on"] == "wall" and face["h"] == 3.5
    assert local(face["wall"]) == (60.0, 100.0)
    # a freestanding city wall: on the side of the street
    city = lamps[(189.5, 30.0)]
    assert city["on"] == "wall" and local(city["wall"]) == (190.0, 30.0)


def test_a_lamp_beside_a_low_wall_or_untagged_stays_a_post(tmp_path, monkeypatch):
    lamps = _lamps(_walls(tmp_path, monkeypatch))
    # a garden wall (1.5 m) holds no lantern: the lamp stands on its post
    assert lamps[(60.0, 40.0)] == {"h": 5.0}
    # nor is an untagged lamp on a wall hung on it
    assert lamps[(120.0, 100.0)] == {"h": 5.0}


def test_a_low_retaining_wall_hangs_its_lantern_lower():
    from bake.lamps import WALL_H, Walls

    walls = Walls.__new__(Walls)
    walls.lines = [shapely.LineString([(0, 0), (100, 0)])]
    walls.tops = [3.0]
    walls.tree = shapely.STRtree(walls.lines)
    ground = {1: 103.4, -1: 100.0}  # the left (north) side 3.4 m up
    walls.ground_at = lambda x, y: ground[1 if y > 0 else -1]
    ways, lines = _lines([(0, -30), (100, -30)])
    foot, head, h = walls.bracket(shapely.Point(50, 0), ways, lines)
    assert foot == [50.0, 0.0] and (head.x, head.y) == pytest.approx((50, -0.5))
    assert h == 2.5 < WALL_H  # under the crown, its bracket rising to it
    ground[1] = 102.0  # a 2 m step holds none
    assert walls.bracket(shapely.Point(50, 0), ways, lines) is None


# --- signals and hydrant signs on a bridge -----------------------------------


def test_a_signal_and_a_hydrant_sign_on_a_bridge_stand_at_its_deck_s_edge(tmp_path, monkeypatch):
    """A primary road east along y = 100 over a river (x 90..110) on a 12 m
    wide deck (x 60..140, y 94..106, its top at 105 m): its signal for the
    eastbound traffic, mapped on the way, stands at the deck's southern
    edge — on that traffic's right — facing it; a hydrant's sign mapped in
    the lane at the nearer edge. A wall clock with no facade near is still
    dropped."""
    from bake import furniture

    cls = np.zeros((SIZE, SIZE), np.uint8)
    cls[:, 90:110] = 8  # the river
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (60, 100, ""),
        4: (140, 100, ""),
        10: (100, 100, tags(highway="traffic_signals", traffic_signals__direction="forward")),
        11: (104, 101.5, tags(emergency="fire_hydrant", fire_hydrant__type="underground")),
        12: (96, 100.5, tags(amenity="clock", support="wall")),
    }
    ways = (
        way(1, [1, 3], {"highway": "primary"})
        + way(2, [3, 10, 4], {"highway": "primary", "bridge": "yes"})
        + way(3, [4, 2], {"highway": "primary"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways, classes=cls)
    ring = [[X0 + x, Y0 + y] for x, y in ((60, 94), (140, 94), (140, 106), (60, 106), (60, 94))]
    deck = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "properties": {
            "kind": "road",
            "axis": [[X0 + 60, Y0 + 100], [X0 + 140, Y0 + 100]],
            "line": [105.0] * 41,
        },
    }
    (tile.data / "dlm" / "bridge_t.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [deck]})
    )
    furniture.run(tile)
    kinds: dict[str, list] = {}
    for f in read(tile, "furniture")["features"]:
        kinds.setdefault(f["properties"]["k"], []).append(f)
    [signal] = kinds["signal"]
    assert local(signal["geometry"]["coordinates"]) == (100.0, 94.4)
    assert signal["properties"]["a"] == 270 and signal["properties"]["deck"] == 105.0
    [sign] = kinds["hydrantsign"]
    assert local(sign["geometry"]["coordinates"]) == (104.0, 105.6)
    assert sign["properties"]["deck"] == 105.0
    assert "wallclock" not in kinds


def test_a_signal_on_a_wide_deck_stands_at_its_carriageway_s_kerb():
    """A residential street along y = 0 over a 40 m wide deck (a station's
    tracks below): its signal moves to the kerb, 3 m (its class's half
    carriageway) and 0.6 m on, not 20 m to the parapet; a lamp in the lanes
    still stands by the parapet; on a deck narrower than the carriageway the
    edge comes first."""
    from bake.bridge import Axis
    from bake.furniture import Decks, carriageway_half

    assert carriageway_half("residential", None) == 3.0
    assert carriageway_half("primary", '"width"=>"9 m"') == 4.5
    street = shapely.LineString([(0, 0), (60, 0)])
    wide = shapely.box(0, -20, 60, 20)
    decks = Decks([(wide, Axis([[0, 0], [60, 0]]), [10.0] * 31)], [(street, True)], [street], [3.0])
    at = decks.kerbside(shapely.Point(30, 0.5), toward=180.0, kerb=True)
    assert (at.x, at.y) == pytest.approx((30, -3.6))
    lamp = decks.kerbside(shapely.Point(30, 0.5))
    assert (lamp.x, lamp.y) == pytest.approx((30, 19.6))
    narrow = Decks(
        [(shapely.box(0, -2, 60, 2), Axis([[0, 0], [60, 0]]), [10.0] * 31)],
        [(street, True)],
        [street],
        [3.0],
    )
    at = narrow.kerbside(shapely.Point(30, 0.5), toward=0.0, kerb=True)
    assert (at.x, at.y) == pytest.approx((30, 1.6))
