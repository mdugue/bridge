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
    shuffled = copy.deepcopy(LAMPS)
    random.Random(7).shuffle(shuffled["features"])
    objects = dict(reversed(OSMBUILD["objects"].items()))
    over = {
        f"dlm/lamps_{TILE}.geojson": shuffled,
        f"dlm/osmbuild_{TILE}.json": {**OSMBUILD, "objects": objects},
    }
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b", **over)
    assert _run(a, b)[0] == 0
    code, out = _run(a, b, "--order")
    assert code == 1
    assert "3 features at another place in the file" in out
    assert "2 objects at another place in the file" in out

    rekeyed = copy.deepcopy(LAMPS)
    rekeyed["features"] = [
        {**f, "properties": dict(reversed(f["properties"].items()))} for f in rekeyed["features"]
    ]
    b = _tree(tmp_path / "keys", **{f"dlm/lamps_{TILE}.geojson": rekeyed})
    assert _run(a, b)[0] == 0
    code, out = _run(a, b, "--order")
    assert code == 1
    assert "2 features written otherwise" in out  # the third has one key


def test_order_sees_how_a_row_and_a_head_are_written(tmp_path):
    a = _tree(tmp_path / "a")
    whole = copy.deepcopy(LAMPS)
    whole["features"][1]["geometry"]["coordinates"][0] = 392010.5
    whole["features"][0]["properties"]["h"] = 6  # was 6.0
    turned = copy.deepcopy(LAMPS)
    turned["features"][0]["geometry"] = dict(reversed(turned["features"][0]["geometry"].items()))
    head = {k: LAMPS[k] for k in ("type", "crs", "attribution", "features")}
    legend = {"size": 4, "tile": TILE, "surfaces": {"0": "asphalt"}}
    for i, over in enumerate(
        (
            {f"dlm/lamps_{TILE}.geojson": whole},
            {f"dlm/lamps_{TILE}.geojson": turned},
            {f"dlm/lamps_{TILE}.geojson": head},
            {f"dlm/surface_{TILE}.json": legend},
            {
                f"dlm/osmbuild_{TILE}.json": {
                    k: OSMBUILD[k] for k in ("meta", "attribution", "objects")
                }
            },
        )
    ):
        b = _tree(tmp_path / str(i), **over)
        assert _run(a, b)[0] == 0, over
        code, out = _run(a, b, "--order")
        assert code == 1, over
        assert "written otherwise" in out


def test_order_sees_two_rows_at_one_point_swapped(tmp_path):
    twins = copy.deepcopy(LAMPS)
    twins["features"].append(_feature(392020.5, {"h": 3.5}))
    swapped = copy.deepcopy(twins)
    swapped["features"][2], swapped["features"][3] = swapped["features"][3], swapped["features"][2]
    a = _tree(tmp_path / "a", **{f"dlm/lamps_{TILE}.geojson": twins})
    b = _tree(tmp_path / "b", **{f"dlm/lamps_{TILE}.geojson": swapped})
    assert _run(a, b)[0] == 0
    code, out = _run(a, b, "--order")
    assert code == 1
    assert "2 features at another place in the file" in out


@pytest.mark.parametrize(
    "kind", ["trees", "smallbuild", "structures", "roofs", "rail", "tram", "walls"]
)
def test_a_row_another_file_names_by_its_place_is_compared_in_place(tmp_path, kind):
    """treefacts, roofcolor, the build's levels and the terrain study name
    these kinds' rows by number: a swap is a difference without --order."""
    name = f"dlm/{kind}_{TILE}.geojson"
    swapped = copy.deepcopy(LAMPS)
    swapped["features"][0], swapped["features"][1] = swapped["features"][1], swapped["features"][0]
    a = _tree(tmp_path / "a", **{name: LAMPS})
    assert _run(a, a)[0] == 0
    code, out = _run(a, _tree(tmp_path / "b", **{name: swapped}))
    assert code == 1
    assert "2 features at another place in the file (a row's place is a key of this kind)" in out
    assert "the first at row 0" in out


def test_two_trees_at_one_point_swapped_are_a_difference(tmp_path):
    name = f"dlm/trees_{TILE}.geojson"
    twins = copy.deepcopy(LAMPS)
    twins["features"].append(_feature(392020.5, {"h": 3.5}))
    swapped = copy.deepcopy(twins)
    swapped["features"][2], swapped["features"][3] = swapped["features"][3], swapped["features"][2]
    code, out = _run(
        _tree(tmp_path / "a", **{name: twins}), _tree(tmp_path / "b", **{name: swapped})
    )
    assert code == 1
    assert "the first at row 2" in out


@pytest.mark.parametrize(("kind", "member"), [("markings", "markings"), ("sport", "grounds")])
def test_a_table_a_raster_names_by_row_is_compared_in_place(tmp_path, kind, member):
    """markings.png and sport.png hold 1 + a row of these tables."""
    name = f"dlm/{kind}_{TILE}.json"
    table = {"tile": TILE, member: [[1.5, 2.5, 0.0], [3.5, 4.5, 1.0], [5.5, 6.5, 2.0]]}
    turned = {"tile": TILE, member: list(reversed(table[member]))}
    a = _tree(tmp_path / "a", **{name: table})
    assert _run(a, a)[0] == 0
    code, out = _run(a, _tree(tmp_path / "b", **{name: turned}))
    assert code == 1
    assert f"2 {member} at another place in the file" in out


def test_columns_and_lists_outside_a_table_are_compared_in_order(tmp_path):
    """treefacts is columns in the trees' order; the land cover's tint grid
    names `water.bodies` by number."""
    facts = {"count": 3, "name": [0, 1, 0], "age": [80, 0, 12]}
    legend = {"tile": TILE, "water": {"bodies": [{"level": 96.8}, {"level": 125.95}]}}
    a = _tree(
        tmp_path / "a",
        **{f"dlm/treefacts_{TILE}.json": facts, f"dlm/landcover_{TILE}.json": legend},
    )
    turned = {**facts, "age": [0, 80, 12]}
    code, out = _run(a, _tree(tmp_path / "b", **{f"dlm/treefacts_{TILE}.json": turned}))
    assert code == 1
    assert "age[0]" in out
    bodies = {"tile": TILE, "water": {"bodies": list(reversed(legend["water"]["bodies"]))}}
    code, out = _run(a, _tree(tmp_path / "c", **{f"dlm/landcover_{TILE}.json": bodies}))
    assert code == 1
    assert "water.bodies[0].level" in out


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


def test_negative_zero_is_not_zero(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][1]["properties"]["h"] = 0
    a = _tree(tmp_path / "a", **{f"dlm/lamps_{TILE}.geojson": lamps})
    lamps["features"][1]["properties"]["h"] = -0.0
    code, out = _run(a, _tree(tmp_path / "b", **{f"dlm/lamps_{TILE}.geojson": lamps}))
    assert code == 1
    assert "properties.h" in out
    zero = {"type": "FeatureCollection", "features": [_feature(0.0, {})]}
    minus = {"type": "FeatureCollection", "features": [_feature(-0.0, {})]}
    a = _tree(tmp_path / "c", **{f"dlm/lamps_{TILE}.geojson": zero})
    code, out = _run(a, _tree(tmp_path / "d", **{f"dlm/lamps_{TILE}.geojson": minus}))
    assert "1 features only in a" in out


def test_numbers_are_exact_to_the_last_bit(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][1]["properties"]["h"] = 7.1000000000000005  # the next double after 7.1
    code, out = _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert code == 1
    assert "properties.h" in out
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][1]["geometry"]["coordinates"][1] = 5668000.250000001
    code, out = _seeded(tmp_path / "xy", **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert "1 features only in a" in out


def test_null_is_not_absent(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][1]["properties"]["hs"] = None
    code, out = _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert code == 1
    assert "properties.hs" in out
    osmbuild = copy.deepcopy(OSMBUILD)
    osmbuild["objects"]["DESN2"]["name"] = None
    code, out = _seeded(tmp_path / "t", **{f"dlm/osmbuild_{TILE}.json": osmbuild})
    assert code == 1
    assert "DESN2: name" in out
    surface = {"tile": TILE, "size": 4, "surfaces": {"0": "asphalt"}, "scale": None}
    code, out = _seeded(tmp_path / "j", **{f"dlm/surface_{TILE}.json": surface})
    assert code == 1
    assert "scale" in out


def test_a_longer_array_is_a_difference(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"][2]["properties"]["wr"].append(9)
    code, out = _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert code == 1
    assert "properties.wr" in out


def test_the_heads_are_compared(tmp_path):
    lamps = {**LAMPS, "attribution": "© somebody else"}
    code, out = _seeded(tmp_path, **{f"dlm/lamps_{TILE}.geojson": lamps})
    assert code == 1
    assert "the head differs in attribution" in out
    assert "1 differ: 1 differences" in out

    city = copy.deepcopy(CITY)
    city["transform"]["translate"][2] = 41.844
    code, out = _seeded(tmp_path / "city", **{f"cityjson/lod2_{TILE}.city.json": city})
    assert code == 1
    assert "the head differs in transform.translate[2]" in out


def test_a_file_in_one_side_only_is_a_difference_alone(tmp_path):
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b")
    (a / f"dlm/lamps_{TILE}.geojson").unlink()
    code, out = _run(a, b)
    assert code == 1
    assert f"dlm/lamps_{TILE}.geojson: only in b" in out
    assert "1 differ: 1 differences" in out


def _png_as(path: Path, **change) -> None:
    grey = np.arange(16, dtype=np.uint8).reshape(4, 4)
    im = Image.fromarray(grey)
    if "mode" in change:
        im = im.convert(change["mode"])
    if "palette" in change:
        im = im.convert("P")
        im.putpalette(change["palette"])
    im.save(path, **({"transparency": change["transparency"]} if "transparency" in change else {}))


@pytest.mark.parametrize(
    "change",
    [
        {"mode": "I;16"},
        {"palette": [0, 0, 0] * 256},
        {"palette": [9, 9, 9] * 256},
        {"transparency": 3},
    ],
    ids=["bit depth", "a palette", "another palette", "transparency"],
)
def test_a_png_of_another_type_differs_whatever_its_cells(tmp_path, change):
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b")
    name = f"dlm/landcover_{TILE}.png"
    if change.get("palette", [0])[0] == 9:
        _png_as(a / name, palette=[0, 0, 0] * 256)
    _png_as(b / name, **change)
    code, out = _run(a, b, "--kind", "landcover")
    assert code == 1, out


@pytest.mark.parametrize(
    "change",
    [
        {"dtype": "float64"},
        {"crs": "EPSG:25832"},
        {"transform": from_origin(392000, 5670000, 2, 2)},
        {"nodata": -9999.0},
    ],
    ids=["type", "crs", "transform", "nodata"],
)
def test_a_geotiff_elsewhere_or_of_another_type_differs(tmp_path, change):
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b")
    heights = np.linspace(100, 101, 16, dtype=np.float32).reshape(4, 4)
    profile = {
        "driver": "GTiff",
        "height": 4,
        "width": 4,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:25833",
        "transform": from_origin(392000, 5670000, 1, 1),
    }
    for root, extra in ((a, {}), (b, change)):
        with rasterio.open(root / f"dgm/dgm1_{TILE}.tif", "w", **{**profile, **extra}) as ds:
            ds.write(heights.astype(extra.get("dtype", "float32")), 1)
    code, out = _run(a, b, "--kind", "dgm1")
    assert code == 1, out


def test_a_geotiffs_bands_are_named(tmp_path):
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b")
    cells = np.zeros((2, 4, 4), dtype=np.float32)
    for root, names in ((a, ("min", "max")), (b, ("max", "min"))):
        with rasterio.open(
            root / f"dgm/dgm1_{TILE}.tif",
            "w",
            driver="GTiff",
            height=4,
            width=4,
            count=2,
            dtype="float32",
        ) as ds:
            ds.write(cells)
            ds.descriptions = names
    assert _run(a, b, "--kind", "dgm1")[0] == 1


def test_a_64_bit_cell_is_compared_as_an_integer(tmp_path):
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b")
    for root, top in ((a, 2**53), (b, 2**53 + 1)):
        with rasterio.open(
            root / f"dgm/dgm1_{TILE}.tif",
            "w",
            driver="GTiff",
            height=1,
            width=2,
            count=1,
            dtype="int64",
        ) as ds:
            ds.write(np.array([[7, top]], dtype=np.int64), 1)
    code, out = _run(a, b, "--kind", "dgm1")
    assert code == 1
    assert "1 cells differ" in out


def test_a_linked_folder_is_read_through(tmp_path):
    lamps = copy.deepcopy(LAMPS)
    lamps["features"].pop()
    stores = (
        _tree(tmp_path / "store-a"),
        _tree(tmp_path / "store-b", **{f"dlm/lamps_{TILE}.geojson": lamps}),
    )
    sides = []
    for store, name in zip(stores, ("a", "b"), strict=True):
        side = tmp_path / name
        side.mkdir()
        (side / "dlm").symlink_to(store / "dlm", target_is_directory=True)
        sides.append(side)
    code, out = _run(*sides)
    assert code == 1
    assert "1 features only in a" in out


def test_the_raw_downloads_and_the_step_cache_are_no_side(tmp_path):
    a, b = _tree(tmp_path / "a"), _tree(tmp_path / "b")
    for folder in ("_raw/sn/osm", "_raw/sn/.bake-cache/site/lamps", ".bake-cache"):
        (b / folder).mkdir(parents=True)
        (b / folder / "anything.json").write_text("{}")
    code, out = _run(a, b)
    assert code == 0, out


@pytest.mark.parametrize(
    ("name", "doc"),
    [
        (f"dlm/lamps_{TILE}.geojson", {"features": [{"type": "Feature", "properties": {}}]}),
        (
            f"dlm/plinths_{TILE}.geojson",
            {"features": [{"type": "Feature", "geometry": None, "properties": None}]},
        ),
        (f"dlm/lamps_{TILE}.geojson", {"features": [7]}),
        (f"cityjson/lod2_{TILE}.city.json", {**CITY, "CityObjects": []}),
        (f"cityjson/lod2_{TILE}.city.json", {**CITY, "vertices": CITY["vertices"][:3]}),
        (
            f"cityjson/lod2_{TILE}.city.json",
            {
                **CITY,
                "CityObjects": {
                    "DESN1": {"geometry": [{"type": "MultiSurface", "boundaries": [[[0, 1, -1]]]}]}
                },
            },
        ),
        (f"dlm/osmbuild_{TILE}.json", {"objects": 7}),
    ],
    ids=[
        "no geometry",
        "null properties",
        "a feature that is a number",
        "city objects as a list",
        "a vertex out of range",
        "a negative vertex",
        "a table that is a number",
    ],
)
def test_a_malformed_row_is_unreadable_never_a_verdict(tmp_path, name, doc):
    a = _tree(tmp_path / "a", **{name: doc})
    code, out = _run(a, a)
    assert code == 2, out
    assert "unreadable" in out
    assert _run(_tree(tmp_path / "good"), a)[0] == 2


def test_a_kind_nobody_has_is_named(tmp_path):
    a = _tree(tmp_path / "a")
    code, out = _run(a, a, "--kind", "lamps", "--kind", "lampz")
    assert code == 2
    assert "no file of kind lampz" in out


def test_the_laser_scan_mode_names_a_missing_raster(tmp_path, capsys):
    assert cb.main(["--rasters", str(tmp_path), str(tmp_path)]) == 2
    assert "dtm_050.tif" in capsys.readouterr().out
