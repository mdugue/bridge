"""The OSM buildings' bake (pipeline/bake/osm_buildings.py): the shops, addresses
and storeys it gives the LoD2 objects."""

import numpy as np

from bake import osm_buildings as ob
from tests.synthetic import osm_nodes, slope_tile


def _box(first: int, roof: list[int] | None = None) -> dict:
    """A CityJSON LoD2 Solid over the eight vertices from `first` (the
    lower four, then the upper four), its top a RoofSurface."""
    a, b, c, d, e, f, g, k = range(first, first + 8)
    return {
        "type": "Solid",
        "lod": "2",
        "boundaries": [
            [
                [[a, d, c, b]],
                [[e, f, g, k]],
                [[a, b, f, e]],
                [[b, c, g, f]],
                [[c, d, k, g]],
                [[d, a, e, k]],
            ]
        ],
        "semantics": {
            "surfaces": [
                {"type": "GroundSurface"},
                {"type": "RoofSurface"},
                {"type": "WallSurface"},
            ],
            "values": [[0, 1, 2, 2, 2, 2]],
        },
    }


def _city(boxes: dict) -> dict:
    """`boxes`: id → (x0, y0, x1, y1, h, ridge); `ridge` lifts the north
    edge's two upper vertices (a mono-pitch roof) by that many metres."""
    verts, objects = [], {}
    for oid, (x0, y0, x1, y1, h, ridge) in boxes.items():
        first = len(verts)
        ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        verts += [[x, y, 100] for x, y in ring]
        verts += [[x, y, 100 + h + (ridge if y == y1 else 0)] for x, y in ring]
        objects[oid] = {"type": "Building", "geometry": [_box(first)]}
    return {"type": "CityJSON", "vertices": verts, "CityObjects": objects}


def test_eaves_are_the_lowest_roof_over_the_base_and_a_level_roof_is_flat():
    h = ob.eaves(_city({"flat": (0, 0, 10, 10, 12, 0), "pitched": (20, 0, 30, 10, 9, 6)}))
    assert h["flat"] == (12.0, True)
    # the eave at the low edge, not the ridge; a 31° roof is no flat one
    assert h["pitched"] == (9.0, False)


def test_osm_counts_a_storey_only_in_range():
    assert ob.counted(17.0, 4)
    assert not ob.counted(17.0, None)
    assert not ob.counted(17.0, 0)
    # a tower's walls over four storeys, a typo's six on a bungalow
    assert not ob.counted(40.0, 4)
    assert not ob.counted(6.0, 5)


def test_a_building_takes_its_mapped_neighbours_storey_of_its_roof_form_and_eave():
    # five Gründerzeit blocks mapped at 3.7 m storeys around one OSM counts
    # none of, a flat-roofed block among them, a far one, a much lower one
    xy = np.array(
        [[0, 0], [30, 0], [0, 30], [-30, 0], [0, -30], [10, 10], [12, 12], [900, 0], [5, 5]]
    )
    eave = np.array([18.5, 18.5, 18.0, 19.0, 18.5, 18.0, 18.0, 18.0, 6.0])
    flat = np.array([False] * 5 + [False, True, False, False])
    storey = np.array([3.7] * 5 + [np.nan] * 4)
    near = ob.neighbour_storeys(eave, flat, xy, storey)
    assert near[5] == 3.7
    # leave one out: a mapped block's own count is not its neighbours'
    assert near[0] == 3.7
    # another roof form, too far, a much lower eave: the tile's median of
    # its form, which five mapped objects are too few for
    assert np.isnan(near[6])
    assert np.isnan(near[7])
    assert np.isnan(near[8])


def test_the_tile_median_stands_in_where_the_neighbours_are_too_few():
    n = ob.TILE_STOREY_MIN
    xy = np.column_stack([np.arange(n + 1) * 1000.0, np.zeros(n + 1)])
    eave = np.full(n + 1, 15.0)
    flat = np.zeros(n + 1, bool)
    storey = np.r_[np.full(n, 3.0), np.nan]
    near = ob.neighbour_storeys(eave, flat, xy, storey)
    assert near[n] == 3.0


def test_apply_storeys_writes_a_storey_only_where_osm_counts_none():
    city = _city(
        {
            "a": (0, 0, 10, 10, 18.5, 4),
            "b": (20, 0, 30, 10, 18.5, 4),
            "c": (40, 0, 50, 10, 18.5, 4),
            "d": (0, 20, 10, 30, 18.5, 4),
            # OSM's own count is not in range: the neighbours' count stands
            "e": (20, 20, 30, 30, 18.0, 4),
        }
    )
    objects = {k: {"levels": 5} for k in "abcd"}
    objects["e"] = {"levels": 1}
    ids, polys = ob.footprints(city)
    assert ob.apply_storeys(objects, city, ids, polys) == 1
    assert objects["e"]["storey"] == 3.7
    assert all("storey" not in objects[k] for k in "abcd")


def _lod2_box(first: int) -> dict:
    """A box solid over the eight vertices from `first`: ground, roof, walls."""
    a, b, c, d, e, f, g, k = range(first, first + 8)
    return {
        "type": "Solid",
        "lod": "2",
        "boundaries": [
            [[[a, d, c, b]], [[e, f, g, k]], [[a, b, f, e]], [[b, c, g, f]], [[c, d, k, g]]]
        ],
        "semantics": {
            "surfaces": [
                {"type": "GroundSurface"},
                {"type": "RoofSurface"},
                {"type": "WallSurface"},
            ],
            "values": [[0, 1, 2, 2, 2]],
        },
    }


def _lod2_city(tile, boxes: dict) -> None:
    """A CityJSON for the `slope_tile` tile: `boxes` maps an id to its
    (x0, y0, x1, y1) in tile-local metres; `shop` is a part of `shop-bldg`."""
    import json

    verts, objects = [], {}
    for oid, (x0, y0, x1, y1) in boxes.items():
        first = len(verts)
        ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        verts += [[411000 + x, 5656000 + y, 100] for x, y in ring]
        verts += [[411000 + x, 5656000 + y, 110] for x, y in ring]
        objects[oid] = {"type": "BuildingPart", "geometry": [_lod2_box(first)]}
    objects["shop"]["parents"] = ["shop-bldg"]
    objects["shop-bldg"] = {"type": "Building", "children": ["shop"]}
    path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "CityJSON", "vertices": verts, "CityObjects": objects}))


def test_shops_on_the_ground_floor_and_listed_outlines_flag_the_lod2_objects(tmp_path, monkeypatch):
    import json

    from bake import osm_buildings

    heritage = [(10, 10, {}), (40, 10, {}), (40, 40, {}), (10, 40, {})]
    nodes = osm_nodes(
        11,
        [
            (150, 150, {"shop": "bakery"}),  # inside `shop`
            (163, 150, {"amenity": "cafe"}),  # 1 m off `other`'s facade: snapped
            (25, 25, {"shop": "clothes", "level": "1"}),  # upstairs: dropped
            (100, 190, {"shop": "kiosk"}),  # on no building
            *heritage,
            # two address points on `shop`, in no particular order
            (145, 145, {"addr:street": "Prager Straße", "addr:housenumber": "11"}),
            (155, 145, {"addr:street": "Prager Straße", "addr:housenumber": "3"}),
        ],
    )
    outline = "".join(f'<nd ref="{i}"/>' for i in (15, 16, 17, 18, 15))
    tags = (
        '<tag k="building" v="yes"/><tag k="heritage" v="4"/><tag k="name" v="Altes Haus"/>'
        '<tag k="addr:street" v="Am Markt"/><tag k="addr:housenumber" v="2"/>'
        '<tag k="building:levels" v="3"/>'
    )
    way = f'<way id="9" version="1">{outline}{tags}</way>'
    tile = slope_tile(tmp_path, monkeypatch, nodes + way)
    _lod2_city(
        tile,
        {"shop": (140, 140, 160, 160), "other": (164, 140, 180, 160), "old": (15, 15, 35, 35)},
    )
    osm_buildings.run(tile)
    doc = json.loads((tile.data / "dlm" / "osmbuild_t.json").read_text())
    assert doc["attribution"].startswith("©")
    assert doc["objects"] == {
        # the address points, numbers in natural order; never on the root
        "shop": {"shop": 1, "addr": "Prager Straße 3, 11"},
        "shop-bldg": {"shop": 1},  # the part's root
        "other": {"shop": 1},
        # the outline covers all of it: listed, named, addressed, storeys,
        # and its key, which every tree under it shares (ensembles.ts)
        "old": {
            "heritage": 1,
            "name": "Altes Haus",
            "addr": "Am Markt 2",
            "levels": 3,
            "outline": "w9",
        },
    }
    assert doc["meta"]["trees_outlined"] == 1
    assert doc["meta"]["shop_points_placed"] == 2
    assert doc["meta"]["objects_addressed"] == 2


def test_address_lines_group_numbers_by_street_and_storeys_parse():
    from bake.osm_buildings import address, address_line, levels_of

    assert address('"addr:street"=>"Hauptstraße","addr:housenumber"=>"1a"') == ("Hauptstraße", "1a")
    assert address('"addr:street"=>"Hauptstraße"') is None
    line = address_line([("Hauptstraße", "10"), ("Am Markt", "2"), ("Hauptstraße", "9")])
    assert line == "Hauptstraße 9, 10 · Am Markt 2"
    assert levels_of('"building:levels"=>"4"') == 4
    assert levels_of('"building:levels"=>"2,5"') == 2
    assert levels_of('"building:levels"=>"many"') is None
    assert levels_of('"building:levels"=>"inf"') is None
    assert levels_of('"building:levels"=>"nan"') is None
    assert levels_of(None) is None


def test_only_ground_floor_levels_count_as_street_shops_and_entrances():
    from bake.osm_buildings import is_shop, on_ground_floor

    assert on_ground_floor(None)
    assert on_ground_floor('"level"=>"0"')
    assert on_ground_floor('"level"=>"-1;0"')
    assert on_ground_floor('"level"=>"0.0"')
    assert on_ground_floor('"level"=>"1, 0"')
    assert on_ground_floor('"level"=>"EG"') and on_ground_floor('"level"=>"Erdgeschoß"')
    assert on_ground_floor('"level"=>"-1-1"')  # a range through the ground floor
    assert on_ground_floor('"level"=>"Hof"')  # unreadable: kept
    assert not on_ground_floor('"level"=>"1"')
    assert not on_ground_floor('"level"=>"-1"')
    assert not on_ground_floor('"level"=>"1-3"')
    for upper in ("OG", "1.OG", "2. OG", "DG", "UG", "KG"):
        assert not on_ground_floor(f'"level"=>"{upper}"'), upper
    assert is_shop("bakery", None) and is_shop(None, "pub")
    assert not is_shop("no", None) and not is_shop(None, "bench")
