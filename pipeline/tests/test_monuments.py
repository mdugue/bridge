"""The monuments (pipeline/bake/monuments.py): their form, height and facing as
OSM, the DLM and the surface model give them."""

import json

import numpy as np
import shapely
from PIL import Image

from tests.synthetic import X0, Y0, osm_tile, tags, way


def _ndom(size: int = 40) -> np.ndarray:
    return np.zeros((size, size), dtype=np.float64)


def _surface(ndom: np.ndarray, winter: bool = False, built=None, scan=None):
    from bake.monuments import Surface

    return Surface(ndom, (X0, Y0 + ndom.shape[0]), built, scan, winter)


def _at(ndom: np.ndarray, r: int, c: int) -> shapely.Point:
    """The centre of cell (r, c) of a surface `_surface` made."""
    return shapely.Point(X0 + c + 0.5, Y0 + ndom.shape[0] - r - 0.5)


def test_an_outline_memorial_is_read_at_its_point_and_takes_a_default_form(tmp_path, monkeypatch):
    from bake.monuments import _osm_monuments

    nodes = {
        1: (50, 50, ""),
        2: (58, 50, ""),
        3: (58, 58, ""),
        4: (50, 58, ""),
        # a bare monument node, and a statue mapped inside its own outline
        10: (120, 120, tags(historic="monument", name="Kriegerdenkmal")),
        11: (150, 150, tags(historic="memorial", memorial="statue", name="Reiter")),
        12: (146, 146, ""),
        13: (154, 146, ""),
        14: (154, 154, ""),
        15: (146, 154, ""),
    }
    war = {"historic": "memorial", "memorial": "war_memorial", "name": "Ehrenmal"}
    ways = way(100, [1, 2, 3, 4, 1], war) + way(
        101, [12, 13, 14, 15, 12], {"historic": "memorial", "name": "Reiter"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    found = {m["name"]: m for m in _osm_monuments(tile)}
    # the outline at its representative point; unmeasured, a war memorial is a stele
    assert found["Ehrenmal"]["geom"].geom_type == "Point"
    assert shapely.Polygon(
        [(X0 + 50, Y0 + 50), (X0 + 58, Y0 + 50), (X0 + 58, Y0 + 58), (X0 + 50, Y0 + 58)]
    ).contains(found["Ehrenmal"]["geom"])
    assert found["Ehrenmal"]["form"] == "stele"
    assert found["Kriegerdenkmal"]["form"] == "statue"
    # the node inside its outline is the object: not read twice
    assert sum(m["name"] == "Reiter" for m in _osm_monuments(tile)) == 1


def test_an_unformed_memorial_takes_the_form_its_measured_height_says():
    from bake.monuments import default_form, unformed

    assert unformed("memorial", '"memorial"=>"war_memorial"') == "war_memorial"
    assert unformed("monument", None) == "monument"
    assert unformed("monument", '"memorial"=>"statue"') is None
    assert unformed("memorial", None) is None
    assert default_form("war_memorial", 1.0, False) == "stone"
    assert default_form("war_memorial", 2.2, False) == "stele"
    assert default_form("monument", 5.0, False) == "statue"
    assert default_form("monument", 14.0, True) == "column"
    assert default_form("war_memorial", None, False) == "stele"


def test_a_slim_shaft_above_the_cap_is_a_column_a_crown_is_not():
    from bake.monuments import NAMED_SLIM_CELLS, SLIM_CELLS, slim_column

    heights = _ndom(13)
    heights[4:9, 4:9] = 1.6  # the pedestal
    heights[5:8, 5:8] = 12.0  # the shaft, 3 × 3 cells
    heights[6, 6] = 15.4
    near = np.zeros_like(heights, dtype=bool)
    near[5:8, 5:8] = True
    column = slim_column(heights, near)
    assert column is not None
    assert column[6, 6] and column[4, 4] and not column[0, 0]
    # a LoD2 footprint under the shaft: a building's corner, not a column
    built = np.zeros_like(near)
    built[5:8, 5:8] = True
    assert slim_column(heights, near, built) is None
    # one over its edge (a terrace building round a column's foot) is not
    built[5:8, 5:8] = False
    built[5, 5:8] = True
    assert slim_column(heights, near, built) is not None
    # a broader shaft (an angel's wings on a capital) only where it is named
    broad = _ndom(13)
    broad[3:10, 3:10] = 1.6
    broad[4:8, 4:9] = 30.0
    broad[6, 6] = 36.0
    assert SLIM_CELLS < 4 * 5
    assert slim_column(broad, near) is None
    assert slim_column(broad, near, None, NAMED_SLIM_CELLS) is not None
    # a crown: wide above a third of its top
    crown = _ndom(13)
    crown[2:11, 2:11] = 9.0
    crown[6, 6] = 12.0
    assert slim_column(crown, near) is None
    # below the cap the relief bake measures it as before
    low = heights.copy()
    low[low > 1.6] = 6.0
    assert slim_column(low, near) is None


def test_a_column_measured_at_its_height_prefers_the_laser_scan():
    from bake.monuments import measured_props

    ndom = _ndom()
    ndom[18:23, 18:23] = 1.5
    ndom[19:22, 19:22] = 14.0
    ndom[20, 20] = 15.4
    scan = np.ones_like(ndom, dtype=bool)
    item = {"geom": _at(ndom, 20, 20), "kind": "column", "form": None}
    props = measured_props(_surface(ndom, scan=scan), item)
    assert props["form"] == "column"
    assert max(props["relief"]["dm"]) == 154
    assert props["hs"] == "lsc"
    # an obelisk stays one
    props = measured_props(_surface(ndom), {**item, "form": "obelisk"})
    assert "form" not in props and "hs" not in props
    # a sculpture beside a slim shaft (a bare young tree in a winter
    # flight) is no column: the shaft is not measured
    props = measured_props(_surface(ndom), {**item, "kind": "statue", "form": "sculpture"})
    assert "relief" not in props and "form" not in props


def _housing(ndom: np.ndarray) -> None:
    ndom[18:21, 18:22] = 2.5  # a flat 3 × 4 m box
    ndom[19, 19] = 2.6


def test_a_box_in_a_winter_flight_is_the_housing_not_the_figure():
    from bake.monuments import measured_props, winter_cover

    ndom = _ndom()
    _housing(ndom)
    item = {"geom": _at(ndom, 19, 19), "kind": "statue", "form": "statue"}
    assert measured_props(_surface(ndom, winter=True), item) == {"cover": True}
    # flown in summer, the same box is what stands there
    assert "relief" in measured_props(_surface(ndom), item)
    # a figure on its pedestal is no box
    statue = _ndom()
    statue[17:22, 17:22] = 2.0
    statue[19, 19] = 4.6
    statue[19, 20] = 4.0
    patch = statue > 0.7
    assert not winter_cover(statue, patch)
    assert "relief" in measured_props(_surface(statue, winter=True), item)


def test_an_unmeasured_figure_takes_its_height_from_the_open_ring_clamped():
    from bake.monuments import measured_props, ring_height

    ndom = _ndom()
    # too small to measure as a relief (one cell) but standing in the open
    ndom[20, 20] = 3.4
    xs, ys = np.meshgrid(X0 + np.arange(40) + 0.5, Y0 + 40 - np.arange(40) - 0.5)
    p = _at(ndom, 20, 20)
    assert ring_height(ndom, xs, ys, p.x, p.y) == 3.4
    statue = {"geom": p, "kind": "statue", "form": "statue"}
    assert measured_props(_surface(ndom), statue)["hm"] == 3.4
    # above a stone's range: a branch or a mast, not the stone
    stone = {**statue, "kind": "stone", "form": "stone"}
    assert "hm" not in measured_props(_surface(ndom), stone)
    # below a statue's least: raised to it
    low = ndom.copy()
    low[20, 20] = 1.1
    assert measured_props(_surface(low), statue)["hm"] == 1.5
    # crowns round it: nothing to read
    shaded = ndom.copy()
    shaded[15:26, 15:18] = 6.0
    shaded[15:26, 23:26] = 6.0
    assert ring_height(shaded, xs, ys, p.x, p.y) is None


def test_a_fountain_mapped_on_a_facade_moves_out_one_indoors_is_dropped():
    from bake.monuments import POINT_BASIN_R, SMALL_FOUNTAIN_R, out_of_buildings

    house = shapely.box(0, 0, 20, 10)
    tree = shapely.STRtree([house])
    near = {"geom": shapely.Point(10, 9), "kind": "fountain"}
    moved = out_of_buildings(near, tree)
    assert moved is not None and not house.contains(moved)
    assert moved.y > 10 + POINT_BASIN_R
    small = out_of_buildings({**near, "small": True}, tree)
    assert small is not None and 10 + SMALL_FOUNTAIN_R < small.y < 10 + POINT_BASIN_R
    assert out_of_buildings({"geom": shapely.Point(10, 5), "kind": "fountain"}, tree) is None
    free = {"geom": shapely.Point(30, 5), "kind": "fountain"}
    assert out_of_buildings(free, tree) is free["geom"]
    statue = {"geom": shapely.Point(10, 5), "kind": "statue"}
    assert out_of_buildings(statue, tree) is statue["geom"]


def test_drinking_fountains_and_stone_blocks_are_small():
    from bake.monuments import small_fountain

    assert small_fountain('"fountain"=>"drinking"')
    assert small_fountain('"fountain"=>"stone_block"')
    assert small_fountain('"drinking_water"=>"yes"')
    assert not small_fountain('"fountain"=>"decorative"')
    assert not small_fountain(None)


def test_a_monument_faces_its_squares_centre_else_its_way(tmp_path, monkeypatch):
    from bake.monuments import Facing

    nodes = {
        1: (20, 20, ""),
        2: (80, 20, ""),
        3: (80, 80, ""),
        4: (20, 80, ""),
        5: (100, 150, ""),
        6: (190, 150, ""),
    }
    ways = way(100, [1, 2, 3, 4, 1], {"place": "square", "name": "Markt"}) + way(
        101, [5, 6], {"highway": "residential"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    view = Facing(tile)
    # west of the square's centre: it faces east
    assert abs(view.bearing(shapely.Point(X0 + 30, Y0 + 50)) - 90) < 1
    # off the square: it faces the street to its north
    assert abs(view.bearing(shapely.Point(X0 + 140, Y0 + 140)) % 360) < 1


def test_a_site_flown_leaf_off_reads_its_crowns_bare(tmp_path):
    from bake.monuments import _winter

    data = tmp_path / "data"
    (data / "dlm").mkdir(parents=True)
    bounds = (X0, Y0, X0 + 200, Y0 + 200)
    rng = np.random.default_rng(1)
    pts = rng.uniform(0, 200, (600, 2))
    crowns = [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [X0 + x, Y0 + y]}}
        for x, y in pts
    ]
    (data / "dlm" / "canopy_t.geojson").write_text(json.dumps({"features": crowns}))
    Image.fromarray(np.full((64, 64), int(0.3 * 255), np.uint8)).save(data / "dlm" / "ndvi_t.png")
    assert _winter(data, (("t", bounds),))
    summer = tmp_path / "summer"
    (summer / "dlm").mkdir(parents=True)
    (summer / "dlm" / "canopy_t.geojson").write_text(json.dumps({"features": crowns}))
    Image.fromarray(np.full((64, 64), int(0.7 * 255), np.uint8)).save(summer / "dlm" / "ndvi_t.png")
    assert not _winter(summer, (("t", bounds),))


def test_two_names_are_one_monument_by_a_word_more_than_the_kind():
    from bake.monuments import same_name

    assert same_name("Schiller-Denkmal", "Friedrich-Schiller-Denkmal")
    assert not same_name("Schiller-Denkmal", "Goethe-Denkmal")  # "Denkmal" alone is no match
    assert not same_name("Bär am Tor", "Löwe am Tor")  # nor words of three letters
    assert not same_name("Kriegerdenkmal", None) and not same_name(None, None)


def test_the_official_name_states_a_form():
    from bake.monuments import name_form

    assert name_form("Moltke-Obelisk") == "obelisk"
    assert name_form("Gedenkstele für die Opfer") == "stele"
    assert name_form("Büste Carl Maria von Weber") == "bust"
    assert name_form("Mariensäule") == "column"
    assert name_form("Schiller-Denkmal") is None and name_form(None) is None
