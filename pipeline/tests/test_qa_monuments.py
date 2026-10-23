"""The QA's monument corrections (W5–W9): OSM outlines and unformed
memorials, slim columns, winter housings, heights measured in the open,
facing, small fountains and fountains mapped on a facade."""

from __future__ import annotations

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


# --- street furniture (W10, W11, W13, W14, W15) ------------------------------


def _furniture(tile) -> dict[str, list]:
    from tests.synthetic import read

    out: dict[str, list] = {}
    for f in read(tile, "furniture")["features"]:
        out.setdefault(f["properties"]["k"], []).append(f)
    return out


def test_a_bench_with_water_beyond_it_looks_at_the_water(tmp_path, monkeypatch):
    from bake import furniture
    from tests.synthetic import local

    cls = np.zeros((200, 200), np.uint8)
    cls[90:110, :] = 8  # the river: 90 < y <= 110
    nodes = {
        1: (0, 80, ""),
        2: (200, 80, ""),
        10: (100, 86, tags(amenity="bench")),  # between the path and the river
        11: (100, 74, tags(amenity="bench")),  # beyond the path, 16 m off the water
        12: (50, 86, tags(amenity="bench", direction="180")),  # tagged: kept
    }
    tile = osm_tile(tmp_path, monkeypatch, nodes, way(1, [1, 2], {"highway": "footway"}), cls)
    furniture.run(tile)
    a = {
        local(f["geometry"]["coordinates"]): f["properties"]["a"] for f in _furniture(tile)["bench"]
    }
    assert a[(100.0, 86.0)] % 360 == 0  # the water, not the path behind it
    assert a[(100.0, 74.0)] % 360 == 0  # the path in front
    assert a[(50.0, 86.0)] == 180


def test_a_carriageway_is_its_lanes_wide_where_no_width_is_tagged():
    from bake.furniture import carriageway_half
    from bake.landcover_osm import _road_half, lanes

    assert carriageway_half("primary", '"lanes"=>"4"') == 6.5
    assert carriageway_half("residential", '"lanes"=>"1"') == 3.0  # a one-way's count
    assert carriageway_half("primary", '"lanes"=>"4","width"=>"9"') == 4.5
    # one carriageway of a dual road, as the class raster paints it
    whole = carriageway_half("primary", None)
    assert carriageway_half("primary", '"oneway"=>"yes"') == max(whole / 2, 2.0)
    assert carriageway_half("residential", '"oneway"=>"yes"') == 3.0
    assert lanes('"lanes"=>"3"') == 3 and lanes(None) is None
    assert _road_half("secondary", None, 3) == 4.875
    assert _road_half("secondary", None, None) == 5.0


def _crossing_street(tmp_path, monkeypatch, extra=None, ways_extra=""):
    """A four-lane primary road along y = 100 (its class raster band 90..110)
    drawn east, a service street crossing it along x = 80 (band 78..82), a
    signal for the eastbound traffic at x = 50 and a signalled pedestrian
    crossing at x = 140 with its footway north-south."""
    cls = np.zeros((200, 200), np.uint8)
    cls[90:110, :] = 7
    cls[:, 78:82] = 7
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (80, 0, ""),
        4: (80, 200, ""),
        5: (80, 100, ""),
        6: (140, 80, ""),
        7: (140, 120, ""),
        10: (50, 100, tags(highway="traffic_signals", traffic_signals__direction="forward")),
        11: (140, 100, tags(highway="crossing", crossing="traffic_signals")),
        **(extra or {}),
    }
    ways = (
        way(1, [1, 10, 5, 11, 2], {"highway": "primary", "lanes": "4"})
        + way(2, [3, 5, 4], {"highway": "service"})
        + way(3, [6, 11, 7], {"highway": "footway", "footway": "crossing"})
        + ways_extra
    )
    return osm_tile(tmp_path, monkeypatch, nodes, ways, cls)


def test_a_crossing_has_a_pedestrian_signal_at_each_kerb_looking_across(tmp_path, monkeypatch):
    from bake import furniture
    from tests.synthetic import local

    tile = _crossing_street(tmp_path, monkeypatch)
    furniture.run(tile)
    peds = sorted(
        (local(f["geometry"]["coordinates"]), f["properties"]["a"])
        for f in _furniture(tile)["pedsignal"]
    )
    [((xs, ys), a_south), ((xn, yn), a_north)] = peds
    assert xs == xn == 140.0
    assert 88.5 < ys < 90.0 and a_south == 0  # the south kerb's looks north
    assert 110.0 < yn < 112.0 and a_north == 180


def test_a_signal_over_four_lanes_hangs_on_an_arm_and_repeats_past_the_junction(
    tmp_path, monkeypatch
):
    from bake import furniture
    from tests.synthetic import local

    tile = _crossing_street(tmp_path, monkeypatch)
    furniture.run(tile)
    signals = sorted(
        (local(f["geometry"]["coordinates"]), f["properties"]) for f in _furniture(tile)["signal"]
    )
    [((x0, y0), stop), ((x1, y1), far)] = signals
    assert x0 == 50.0 and 88.5 < y0 < 90.0 and stop == {"k": "signal", "a": 270, "arm": True}
    # past the service street (half 2 m, a kerb's step, 1 m), on the right
    assert x1 == 83.6 and 88.5 < y1 < 90.0 and far == {"k": "signal", "a": 270}


def test_a_signal_on_a_square_stands_at_its_ways_kerb(tmp_path, monkeypatch):
    """The class raster's road all round (a square): no kerb in reach, so
    the way's carriageway gives it — it was dropped."""
    from bake import furniture
    from tests.synthetic import local

    cls = np.full((200, 200), 7, np.uint8)
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        10: (100, 100, tags(highway="traffic_signals")),
    }
    tile = osm_tile(
        tmp_path, monkeypatch, nodes, way(1, [1, 10, 2], {"highway": "residential"}), cls
    )
    furniture.run(tile)
    [signal] = _furniture(tile)["signal"]
    x, y = local(signal["geometry"]["coordinates"])
    assert x == 100.0 and abs(abs(y - 100.0) - 3.6) < 0.05


def test_bins_take_their_own_colour_else_the_citys_majority(tmp_path, monkeypatch):
    from bake import furniture
    from bake.furniture import bin_tone

    assert bin_tone("Red") == "red"
    assert bin_tone("dark green") == "green"
    assert bin_tone("#7a828e") == "grey"
    assert bin_tone("#cc1111") == "red"
    assert bin_tone("brown") is None
    nodes = {
        100 + i: (
            10 + 6 * (i % 25),
            20 + 10 * (i // 25),
            tags(amenity="waste_basket", colour="red"),
        )
        for i in range(25)
    }
    nodes |= {
        200 + i: (10 + 6 * i, 60, tags(amenity="waste_basket", colour="grey")) for i in range(5)
    }
    nodes[300] = (100, 150, tags(amenity="waste_basket"))
    nodes[301] = (120, 150, tags(amenity="waste_basket", colour="blue"))
    tile = osm_tile(tmp_path, monkeypatch, nodes)
    furniture.run(tile)
    by = {tuple(f["geometry"]["coordinates"]): f["properties"] for f in _furniture(tile)["bin"]}
    assert by[(X0 + 100, Y0 + 150)].get("c") == "red"  # untagged: the city's
    assert by[(X0 + 120, Y0 + 150)].get("c") == "blue"
    assert "c" not in by[(X0 + 10, Y0 + 60)]  # grey is the model's own
    # too few tagged: no city colour
    few = {
        1: (50, 50, tags(amenity="waste_basket", colour="red")),
        2: (60, 50, tags(amenity="waste_basket")),
    }
    tile = osm_tile(tmp_path / "few", monkeypatch, few)
    furniture.run(tile)
    by = {tuple(f["geometry"]["coordinates"]): f["properties"] for f in _furniture(tile)["bin"]}
    assert "c" not in by[(X0 + 60, Y0 + 50)]


def _with_dom(tile, heights: np.ndarray) -> None:
    import rasterio

    path = tile.raw_raster("dom1")
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(200),
    ) as dst:
        dst.write((100.0 + heights).astype("float32"), 1)


def test_an_empty_playground_stands_what_the_surface_model_shows(tmp_path, monkeypatch):
    from bake import furniture

    nodes = {1: (20, 20, ""), 2: (60, 20, ""), 3: (60, 60, ""), 4: (20, 60, "")}
    tile = osm_tile(
        tmp_path, monkeypatch, nodes, way(1, [1, 2, 3, 4, 1], {"leisure": "playground"})
    )
    h = np.zeros((200, 200))
    # rows are 200 − y: a swing's frame 6 m east-west at y ≈ 50, a climbing
    # frame at (30, 30), a tree (8 m, its fringe 3 m) at (50, 30)
    h[149:151, 25:31] = 2.2
    h[169:172, 29:32] = 2.5
    h[167:174, 47:54] = 3.0
    h[169:172, 49:52] = 8.0
    h[155:175, 20] = 1.6  # the hedge along its western edge
    _with_dom(tile, h)
    furniture.run(tile)
    pieces = [f for k, fs in _furniture(tile).items() if k != "playground" for f in fs]
    assert sorted(f["properties"]["k"] for f in pieces) == ["climb", "swing"]
    assert all(f["properties"]["src"] == "dom" for f in pieces)
    [swing] = [f for f in pieces if f["properties"]["k"] == "swing"]
    assert swing["properties"]["a"] % 180 == 0  # across its east-west frame
    # a playground with its equipment mapped stands only that
    nodes[10] = (40, 40, tags(playground="slide"))
    tile = osm_tile(
        tmp_path / "mapped",
        monkeypatch,
        nodes,
        way(1, [1, 2, 3, 4, 1], {"leisure": "playground"}),
    )
    _with_dom(tile, h)
    furniture.run(tile)
    kinds = _furniture(tile)
    assert "climb" not in kinds and "swing" not in kinds and len(kinds["slide"]) == 1


# --- sports grounds (W20) -----------------------------------------------------


def test_a_block_of_tennis_courts_is_a_court_each_with_its_net():
    from bake.sport import COURT, TENNIS, courts

    block = shapely.box(0, 0, 73.2, 36.6)  # four courts side by side
    parts = courts(block, TENNIS)
    assert len(parts) == 4
    for p in parts:
        w = p.bounds[2] - p.bounds[0]
        h = p.bounds[3] - p.bounds[1]
        assert abs(w - 18.3) < 0.01 and abs(h - 36.6) < 0.01
    assert courts(shapely.box(0, 0, 36.6, 25), TENNIS) == [shapely.box(0, 0, 36.6, 25)]
    assert len(courts(block, COURT)) == 1
