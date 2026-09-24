"""Units of the cadastre-tree and hedge bakes that need no raw data."""

import json

import numpy as np
import shapely
from PIL import Image

from bake import lowveg, tree_archetypes, trees
from bake.common import Tile
from bake.ingest_trees_dresden import canonical


def tile_with_landcover(tmp_path, classes: np.ndarray) -> Tile:
    dlm = tmp_path / "data" / "dlm"
    dlm.mkdir(parents=True)
    Image.fromarray(classes.astype(np.uint8)).save(dlm / "landcover_t.png")
    return Tile("t", (0.0, 0.0, 100.0, 100.0), 25833, tmp_path / "raw", tmp_path / "data")


def test_the_dresden_cadastre_maps_to_canonical_points_without_stumps():
    doc = {
        "features": [
            {
                "properties": {
                    "gis_x_utm": 1.5,
                    "gis_y_utm": 2.5,
                    "art_botanisch": "Tilia cordata",
                    "art_deutsch": "Winter-Linde",
                    "baumhoehe_akt": 12,
                    "kronendurchmesser_akt": 0,
                }
            },
            {"properties": {"gis_x_utm": 3, "gis_y_utm": 4, "art_botanisch": "Stammstück"}},
            {"properties": {"art_botanisch": "Acer"}},
        ]
    }
    out = canonical(doc)
    assert len(out) == 1
    assert out[0]["geometry"]["coordinates"] == [1.5, 2.5]
    assert out[0]["properties"] == {
        "taxon": "Tilia cordata",
        "name": "Winter-Linde",
        "h": 12.0,
        "d": None,
    }


def test_the_trees_bake_classifies_imputes_flags_woodland_and_keeps_its_tile(tmp_path):
    classes = np.zeros((10, 10))
    classes[:, :5] = 2  # the west half is forest
    tile = tile_with_landcover(tmp_path, classes)
    raw = tmp_path / "raw" / "trees"
    raw.mkdir(parents=True)

    def point(x, y, taxon, h=None, d=None):
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [x, y]},
            "properties": {"taxon": taxon, "name": "", "h": h, "d": d},
        }

    (raw / "t.geojson").write_text(
        json.dumps(
            {
                "attribution": "credit",
                "features": [
                    point(10, 50, "Tilia cordata", 20, 10),
                    point(60, 50, "Tilia cordata", 10, 5),
                    point(70, 50, "Tilia cordata"),  # both imputed
                    point(80, 50, "Populus nigra 'Italica'", 25, 4),
                    point(100, 50, "Tilia cordata", 9, 9),  # on the east seam: the neighbour's
                ],
            }
        )
    )
    trees.run(tile)
    doc = json.loads((tmp_path / "data" / "dlm" / "trees_t.geojson").read_text())
    assert doc["attribution"] == "credit"
    assert doc["archetypes"] == tree_archetypes.ARCHETYPES
    props = [f["properties"] for f in doc["features"]]
    assert len(props) == 4
    assert props[0]["f"] == 1 and "f" not in props[1]
    # imputed: the genus has too few heights for its own median → the tile's
    # median height (20 m), and the round archetype's crown ratio (0.5)
    assert props[2]["h"] == 20.0 and props[2]["d"] == 10.0
    assert props[3]["a"] == tree_archetypes.COLUMNAR


def test_the_trees_bake_without_a_cadastre_leaves_the_committed_file(tmp_path):
    tile = tile_with_landcover(tmp_path, np.zeros((4, 4)))
    committed = tmp_path / "data" / "dlm" / "trees_t.geojson"
    committed.write_text('{"features": [1]}')
    trees.run(tile)
    assert committed.read_text() == '{"features": [1]}'


def test_a_straight_hedge_skeleton_traces_to_one_path():
    skel = np.zeros((5, 20), bool)
    skel[2, 2:18] = True
    paths, deg = lowveg.trace_skeleton(skel)
    assert len(paths) == 1
    assert lowveg.path_length_px(paths[0]) == 15
    assert sorted(deg[p] for p in (paths[0][0], paths[0][-1])) == [1, 1]


def test_a_long_narrow_blob_is_a_hedge_and_a_round_one_is_not():
    mask = np.zeros((60, 60), bool)
    mask[10:13, 5:55] = True  # 25 m long, 1.5 m wide
    yy, xx = np.mgrid[:60, :60]
    mask |= np.hypot(yy - 40, xx - 30) < 8  # an 8 m shrub bed
    hedge, skel = lowveg.hedge_components(mask)
    assert hedge[11, 30] and not hedge[40, 30]
    assert skel.any()


def test_scan_trees_inside_a_cadastre_crown_are_dropped():
    def pt(x, y, **props):
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [x, y]},
            "properties": props,
        }

    cadastre = [pt(0, 0, d=12.0), pt(100, 0, d=2.0)]
    extra = [pt(5, 0, h=8), pt(103, 0, h=8), pt(105, 0, h=8), pt(50, 50, h=8)]
    kept = lowveg.without_cadastre(extra, cadastre)
    # within the 6 m crown radius; within the 4 m floor; beyond both; far away
    assert [f["geometry"]["coordinates"] for f in kept] == [[105, 0], [50, 50]]


def test_hedge_heights_come_from_the_tag_within_reason():
    assert lowveg.osm_height('"height"=>"1.8 m"') == 1.8
    assert lowveg.osm_height('"height"=>"12"') is None
    assert lowveg.osm_height(None) is None


def test_an_osm_hedge_the_scan_sees_takes_its_height():
    grid = lowveg.Grid((0.0, 0.0, 20.0, 20.0))
    near = np.zeros((grid.n, grid.n), bool)
    band_max = np.zeros((grid.n, grid.n), np.float32)
    near[18:22, :] = True  # a band across the middle (y ≈ 9–11 m)
    band_max[18:22, :] = 1.6
    seen = shapely.LineString([(2, 10), (18, 10)])
    unseen = shapely.LineString([(2, 2), (18, 2)])
    assert lowveg.osm_hedge_height(grid, seen, near, band_max) == np.float32(1.6).item()
    assert lowveg.osm_hedge_height(grid, unseen, near, band_max) is None
