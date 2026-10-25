"""The lowered kerbs (pipeline/bake/kerb_drops.py): where a kerb drops at a
crossing, a lowered node or a driveway."""

import shapely

from bake import kerb_drops
from tests.synthetic import X0, Y0, osm_tile, way


def _tags(tags: dict[str, str]) -> str:
    return "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())


# --- B14: lowered kerbs ---------------------------------------------------------


def _kerb_tile(tmp_path, monkeypatch):
    """A street along y = 100 with its kerbs at y = 95 (drawn east) and
    y = 105 (drawn west), the road on each line's left."""
    nodes = {
        1: (0, 100, ""),
        2: (200, 100, ""),
        3: (100, 100, _tags({"highway": "crossing"})),
        4: (50, 96, _tags({"barrier": "kerb", "kerb": "flush"})),
        5: (150, 100, _tags({"highway": "crossing", "crossing": "uncontrolled"})),
        6: (150, 104, _tags({"barrier": "kerb", "kerb": "raised"})),
        7: (30, 100, ""),
        8: (30, 80, ""),
        9: (170, 90, ""),
        10: (170, 110, ""),
        11: (60, 100, _tags({"highway": "crossing", "crossing": "no"})),
    }
    ways = (
        way(1, [1, 2], {"highway": "residential"})
        + way(2, [7, 8], {"highway": "service", "service": "driveway", "width": "5"})
        + way(3, [9, 10], {"highway": "footway", "footway": "crossing"})
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    south = shapely.LineString([(X0, Y0 + 95), (X0 + 200, Y0 + 95)])
    north = shapely.LineString([(X0 + 200, Y0 + 105), (X0, Y0 + 105)])
    road = shapely.STRtree([shapely.LineString([(X0, Y0 + 100), (X0 + 200, Y0 + 100)])])
    return tile, [south, north], road


def test_kerbs_lower_at_crossings_lowered_nodes_and_driveways(tmp_path, monkeypatch):
    tile, lines, road = _kerb_tile(tmp_path, monkeypatch)
    south, north = kerb_drops.kerb_drops(tile, lines, road)
    # south, from x = 0: the driveway (5 m wide), the flush node, the
    # crossing node, the second crossing (no raised node near this side)
    # and the crossing way
    assert south == [
        [27.5, 32.5, 0.03],
        [48.5, 51.5, 0.0],
        [98.5, 101.5, 0.03],
        [148.5, 151.5, 0.03],
        [168.5, 171.5, 0.03],
    ]
    # north, from x = 200: the crossing way at 30 m, the crossing node at
    # 100 m; the crossing at x = 150 keeps its raised kerb on this side
    assert north == [[28.5, 31.5, 0.03], [98.5, 101.5, 0.03]]


def test_kerbs_stand_full_without_an_extract_or_lines(tmp_path, monkeypatch):
    tile, lines, road = _kerb_tile(tmp_path, monkeypatch)
    assert kerb_drops.kerb_drops(tile, [], road) == []
    monkeypatch.setattr(type(tile), "osm_extract", lambda self: None)
    assert kerb_drops.kerb_drops(tile, lines, road) == [[], []]


def test_drops_merge_clip_and_yield_to_a_raised_kerb():
    drops = [(-1.0, 2.0, 0.03, False), (2.5, 4.0, 0.0, True), (9.0, 12.0, 0.03, False)]
    assert kerb_drops.merged(drops, [], 10.0) == [[0.0, 4.0, 0.0], [9.0, 10.0, 0.03]]
    # a raised node at 11 m vetoes the crossing's default, not a tagged drop
    assert kerb_drops.merged(drops, [11.0, 3.0], 10.0) == [[2.5, 4.0, 0.0]]
    assert kerb_drops.half_width('"width"=>"6 m"') == 3.0
    assert kerb_drops.half_width(None) == kerb_drops.CROSSING_HALF_M
    assert kerb_drops.half_width('"width"=>"40"') == kerb_drops.DRIVEWAY_W
