"""scripts/eval/compare-bakes.py says two trees of baked files hold the same
(exit 0) or names what differs (exit 1) — the proof plan 092 leans on once a
change is no longer "the same bytes"."""

import copy
import importlib.util
import io
import json
import random
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from PIL import Image
from rasterio.transform import from_origin

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "eval" / "compare-bakes.py"
spec = importlib.util.spec_from_file_location("compare_bakes", SCRIPT)
assert spec and spec.loader
cb = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = cb  # a dataclass looks its module up there
spec.loader.exec_module(cb)

TILE = "33392_5668_2_sn"


def _feature(x: float, props: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [x, 5668000.25]},
        "properties": props,
    }


LAMPS = {
    "type": "FeatureCollection",
    "attribution": "© OpenStreetMap contributors",
    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}},
    "features": [
        _feature(392000.5, {"h": 6.0, "hs": "dom", "wire": [[1.5, 2.25], [3.0, 4.0]]}),
        _feature(392010.5, {"h": 7.1}),
        _feature(392020.5, {"h": 8.2, "wr": [1, 2, 3, 4, 5, 6, 7, 8]}),
    ],
}
PLINTHS = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": [[[0.5, 1.5], [2.5, 3.5]]]},
            "properties": {"of": "DESN1", "g": [101.25], "top": [101.5]},
        }
    ],
}
OSMBUILD = {
    "attribution": "© OpenStreetMap contributors",
    "meta": {"tile": TILE, "objects_named": 1},
    "objects": {"DESN1": {"name": "Rathaus", "levels": 3}, "DESN2": {"shop": "bakery"}},
}
LANDMARKS = {"landmarks": [{"id": "Q1", "name": "Dom", "x": 1.5}, {"id": "Q2", "name": "Burg"}]}
CITY = {
    "type": "CityJSON",
    "transform": {"scale": [0.001, 0.001, 0.001], "translate": [0, 0, 0]},
    "CityObjects": {
        "DESN1": {
            "type": "Building",
            "geometry": [{"type": "MultiSurface", "boundaries": [[[0, 1, 2]], [[2, 1, 3]]]}],
        }
    },
    "vertices": [[0, 0, 0], [1000, 0, 0], [0, 1000, 0], [1000, 1000, 500]],
}


def _png(path: Path, cells: np.ndarray) -> None:
    Image.fromarray(cells).save(path)


def _tif(path: Path, cells: np.ndarray) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=cells.shape[0],
        width=cells.shape[1],
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(392000, 5670000, 1, 1),
    ) as ds:
        ds.write(cells, 1)


def _tree(root: Path, **over) -> Path:
    """A small site: one file of every way the comparer reads."""
    docs = {
        f"dlm/lamps_{TILE}.geojson": LAMPS,
        f"dlm/plinths_{TILE}.geojson": PLINTHS,
        f"dlm/osmbuild_{TILE}.json": OSMBUILD,
        f"dlm/landmarks_{TILE}.json": LANDMARKS,
        f"dlm/surface_{TILE}.json": {"tile": TILE, "size": 4, "surfaces": {"0": "asphalt"}},
        f"cityjson/lod2_{TILE}.city.json": CITY,
    }
    docs.update({k: v for k, v in over.items() if isinstance(v, dict)})
    for name, doc in docs.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc))
    grey = np.arange(16, dtype=np.uint8).reshape(4, 4)
    _png(root / f"dlm/landcover_{TILE}.png", over.get("grey", grey))
    rgba = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
    _png(root / f"dlm/surface_{TILE}.png", over.get("rgba", rgba))
    heights = np.linspace(100, 101, 16, dtype=np.float32).reshape(4, 4)
    heights[0, 0] = np.nan
    (root / "dgm").mkdir(exist_ok=True)
    _tif(root / f"dgm/dgm1_{TILE}.tif", over.get("heights", heights))
    (root / "notes.txt").write_text(over.get("notes", "as baked"))
    return root


def _run(a: Path, b: Path, *args: str) -> tuple[int, str]:
    out = io.StringIO()
    kinds = {args[i + 1] for i, v in enumerate(args) if v == "--kind"} or None
    code = cb.compare_trees(a, b, kinds, order="--order" in args, out=out)
    return code, out.getvalue()


def _seeded(tmp_path: Path, **over) -> tuple[int, str]:
    return _run(_tree(tmp_path / "a"), _tree(tmp_path / "b", **over))


def test_a_tree_against_itself_is_the_same(tmp_path):
    a = _tree(tmp_path / "a")
    code, out = _run(a, a, "--order")
    assert code == 0, out
    assert out.strip().endswith("0 differences")


def test_the_command_exits_with_the_verdict(tmp_path):
    a = _tree(tmp_path / "a")
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][0]["properties"]["h"] = 6.5
    b = _tree(tmp_path / "b", **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert cb.main([str(a), str(a)]) == 0
    assert cb.main([str(a), str(b)]) == 1
    assert cb.main([str(a), str(tmp_path / "nowhere")]) == 2


def test_order_of_rows_and_keys_is_ignored_unless_asked_for(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    random.Random(7).shuffle(lamps["features"])
    lamps["features"] = [
        {**f, "properties": dict(reversed(f["properties"].items()))} for f in lamps["features"]
    ]
    objects = dict(reversed(OSMBUILD["objects"].items()))
    over = {
        f"dlm/lamps_{TILE}.geojson": lamps,
        f"dlm/osmbuild_{TILE}.json": {**OSMBUILD, "objects": objects},
    }
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b", **over)
    assert _run(a, b)[0] == 0
    code, out = _run(a, b, "--order")
    assert code == 1
    assert "at another place in the file" in out
    assert "keys in another order" in out


def test_a_whole_float_is_the_integer(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][0]["properties"]["h"] = 6
    lamps["features"][0]["geometry"]["coordinates"][1] = 5668000.25
    assert _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})[0] == 0


def test_a_changed_property_names_its_key(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][0]["properties"]["wire"][1][0] = 3.0000000000000004
    code, out = _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert code == 1
    assert "1 features differ" in out
    assert "properties.wire[1][0]" in out
    assert "1 differ: 1 differences" in out


def test_a_row_in_one_side_only(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    moved = lamps["features"].pop()
    code, out = _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert code == 1
    assert "1 features only in a" in out
    # A feature that moved is another feature: its geometry is its identity.
    moved["geometry"]["coordinates"][0] += 0.5
    lamps["features"].append(moved)
    code, out = _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert "1 features only in a" in out
    assert "1 features only in b" in out


def test_rows_that_share_an_identity_are_counted(tmp_path):
    twice = copy.deepcopy(LAMPS)
    twice["features"].append(copy.deepcopy(twice["features"][1]))
    a = _tree(tmp_path / "a", **{f"dlm/lamps_{TILE}.geojson": twice})
    assert _run(a, a)[0] == 0
    code, out = _run(a, _tree(tmp_path / "b"))
    assert code == 1
    assert "1 features only in a" in out


def test_a_named_row_keeps_its_name_when_its_geometry_moves(tmp_path):
    plinths = copy.deepcopy(PLINTHS)
    plinths["features"][0]["geometry"]["coordinates"][0][1][0] = 2.75
    code, out = _seeded(tmp_path, **{f"dlm/plinths_{TILE}.geojson": plinths})
    assert code == 1
    assert "1 features differ" in out
    assert "geometry.coordinates[0][1][0]" in out


def test_a_table_in_a_json_file_is_compared_by_row(tmp_path):
    osmbuild = copy.deepcopy(OSMBUILD)
    osmbuild["objects"]["DESN1"]["levels"] = 4
    del osmbuild["objects"]["DESN2"]
    osmbuild["meta"]["objects_named"] = 2
    code, out = _seeded(tmp_path, **{f"dlm/osmbuild_{TILE}.json": osmbuild})
    assert code == 1
    assert "1 objects only in a, e.g. DESN2" in out
    assert "DESN1: levels" in out
    assert "the head differs in meta.objects_named" in out

    landmarks = copy.deepcopy(LANDMARKS)
    landmarks["landmarks"].reverse()
    assert _seeded(tmp_path / "l", **{f"dlm/landmarks_{TILE}.json": landmarks})[0] == 0
    landmarks["landmarks"][0]["name"] = "Albrechtsburg"
    code, out = _seeded(tmp_path / "m", **{f"dlm/landmarks_{TILE}.json": landmarks})
    assert code == 1
    assert "name" in out


def test_any_other_json_is_compared_whole(tmp_path):
    surface = {"size": 4, "tile": TILE, "surfaces": {"0": "sett"}}
    code, out = _seeded(tmp_path, **{f"dlm/surface_{TILE}.json": surface})
    assert code == 1
    assert "surfaces.0" in out


def test_cityjson_is_read_through_its_vertices(tmp_path):
    renumbered = copy.deepcopy(CITY)
    renumbered["vertices"].reverse()
    renumbered["CityObjects"]["DESN1"]["geometry"][0]["boundaries"] = [[[3, 2, 1]], [[1, 2, 0]]]
    name = f"cityjson/lod2_{TILE}.city.json"
    assert _seeded(tmp_path, **{name: renumbered})[0] == 0
    renumbered["vertices"][0][2] = 501
    code, out = _seeded(tmp_path / "moved", **{name: renumbered})
    assert code == 1
    assert "1 city objects differ" in out


def test_a_raster_is_compared_cell_by_cell(tmp_path):
    grey = np.arange(16, dtype=np.uint8).reshape(4, 4)
    grey[2, 3] = 99
    code, out = _seeded(tmp_path, grey=grey)
    assert code == 1
    assert "band 1: 1 cells differ (by up to 88), e.g. row 2 col 3: 11 → 99" in out

    rgba = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
    rgba[1, 1, 3] = 0
    rgba[1, 2, 3] = 0
    code, out = _seeded(tmp_path / "rgba", rgba=rgba)
    assert code == 1
    assert "band 4: 2 cells differ" in out

    heights = np.linspace(100, 101, 16, dtype=np.float32).reshape(4, 4)
    heights[0, 0] = np.nan
    assert _seeded(tmp_path / "nan", heights=heights.copy())[0] == 0
    heights[3, 3] += 0.5
    code, out = _seeded(tmp_path / "dgm", heights=heights)
    assert code == 1
    assert "1 cells differ (by up to 0.5)" in out

    code, out = _seeded(tmp_path / "size", grey=np.zeros((2, 2), dtype=np.uint8))
    assert code == 1


def test_a_file_in_one_side_only_and_other_bytes(tmp_path):
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b", notes="as baked again")
    (b / f"dlm/lamps_{TILE}.geojson").unlink()
    code, out = _run(a, b)
    assert code == 1
    assert f"dlm/lamps_{TILE}.geojson: only in a" in out
    assert "the bytes differ" in out


def test_a_kind_can_be_asked_for_alone(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"].pop()
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b", **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert _run(a, b, "--kind", "osmbuild")[0] == 0
    assert _run(a, b, "--kind", "lamps")[0] == 1
    assert _run(a, b, "--kind", "nosuchkind")[0] == 2


def test_a_file_that_is_not_its_kind_is_an_error_even_against_itself(tmp_path):
    a = _tree(tmp_path / "a")
    (a / f"dlm/lamps_{TILE}.geojson").write_text('{"type": "FeatureCollection"}')
    code, out = _run(a, a)
    assert code == 2
    assert "unreadable" in out


@pytest.mark.parametrize(
    ("name", "kind"),
    [
        (f"bridge_{TILE}.geojson", "bridge"),
        ("markings_low_33412_5656_2_sn.png", "markings_low"),
        ("lod2_566_5932_1_hh.city.json", "lod2"),
        ("provenance.json", "provenance"),
    ],
)
def test_a_files_kind_is_its_name_before_the_tile(name, kind):
    assert cb.kind_of(name) == kind
