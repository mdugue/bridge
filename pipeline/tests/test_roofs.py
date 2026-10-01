"""The LoD2 roofs rebuilt from DOM1 (pipeline/bake/roofs.py)."""

import json

import numpy as np
import rasterio
from rasterio.transform import from_origin

from bake.common import Tile
from bake.roofs import merge_regions, run

X0, Y0, SIZE = 400_000.0, 5_600_000.0, 200
BASE = 110.0


def _raster(path, data):
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
        transform=from_origin(X0, Y0 + SIZE, 1.0, 1.0),
        nodata=-9999.0,
    ) as ds:
        ds.write(data.astype(np.float32), 1)


def _solid(first, roofs):
    """A box's walls and ground from vertices `first`..`first + 3` (ground
    ring) plus the given roof rings (vertex indices)."""
    a, b, c, d = first, first + 1, first + 2, first + 3
    shell = [[[a, d, c, b]]] + [[r] for r in roofs]
    values = [0] + [1] * len(roofs)
    return {
        "type": "Solid",
        "lod": "2",
        "boundaries": [shell],
        "semantics": {
            "surfaces": [{"type": "GroundSurface"}, {"type": "RoofSurface"}],
            "values": [values],
        },
    }


def _square(x, y, w, z):
    return [[x, y, z], [x + w, y, z], [x + w, y + w, z], [x, y + w, z]]


def _tile(tmp_path, dom):
    tile = Tile(
        "t",
        (X0, Y0, X0 + SIZE, Y0 + SIZE),
        25833,
        tmp_path / "raw",
        tmp_path / "data",
        credit="Quelle: GeoSN, dl-de/by-2-0",
    )
    _raster(tile.dgm, np.full((SIZE, SIZE), BASE))
    _raster(tile.raw_raster("dom1"), dom)
    # 1. a tent: four facets from 5 m eaves to a 20 m peak, over 40 × 40 m
    tent = (
        _square(X0 + 20, Y0 + 20, 40, BASE)
        + _square(X0 + 20, Y0 + 20, 40, BASE + 5)
        + [[X0 + 40, Y0 + 40, BASE + 20]]
    )
    facets = [[4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 4, 8]]
    # 2. a flat roof the scan agrees with, 3. one over open ground (torn down)
    flat = _square(X0 + 100, Y0 + 20, 40, BASE) + _square(X0 + 100, Y0 + 20, 40, BASE + 10)
    gone = _square(X0 + 100, Y0 + 100, 40, BASE) + _square(X0 + 100, Y0 + 100, 40, BASE + 10)
    vertices = tent + flat + gone
    doc = {
        "type": "CityJSON",
        "version": "2.0",
        "transform": {"scale": [1, 1, 1], "translate": [0, 0, 0]},
        "vertices": vertices,
        "CityObjects": {
            "tent": {
                "type": "Building",
                "attributes": {"function": "31001_2071"},
                "geometry": [_solid(0, facets)],
            },
            "flat": {"type": "Building", "geometry": [_solid(9, [[13, 14, 15, 16]])]},
            "gone": {"type": "Building", "geometry": [_solid(17, [[21, 22, 23, 24]])]},
        },
    }
    path = tile.data / "cityjson" / "lod2_t.city.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc))
    return tile


def _dom():
    """The scan: the tent's footprint is a 20 m block (west) beside a 9 m
    one (east); the flat roof stands at 10 m; the third is open ground."""
    dom = np.full((SIZE, SIZE), BASE, np.float32)
    rows = slice(SIZE - 60, SIZE - 20)  # y 20..60, row 0 = north
    dom[rows, 20:40] = BASE + 20
    dom[rows, 40:60] = BASE + 9
    dom[rows, 100:140] = BASE + 10
    return dom


def test_a_tent_over_two_blocks_becomes_the_two_blocks(tmp_path):
    tile = _tile(tmp_path, _dom())
    run(tile)
    doc = json.loads((tile.data / "dlm" / "roofs_t.geojson").read_text())
    # the provider's credit line, whatever the Land
    assert doc["attribution"] == "Quelle: GeoSN, dl-de/by-2-0 (LoD2, DOM1)"
    parts = [(f["properties"]["id"], f["properties"]["z"], f["geometry"]) for f in doc["features"]]
    # the flat roof fits and the torn-down one is not rebuilt
    assert {p[0] for p in parts} == {"tent"}
    assert sorted(round(z) for _, z, _ in parts) == [BASE + 9, BASE + 20]
    for _, z, g in parts:
        xs = [x for x, _ in g["coordinates"][0]]
        # each block keeps to its half of the footprint, within a cell
        if z > BASE + 15:
            assert min(xs) >= X0 + 20 - 1e-6 and max(xs) <= X0 + 41
        else:
            assert min(xs) >= X0 + 39 and max(xs) <= X0 + 60 + 1e-6


def test_without_dom1_the_step_leaves_the_roofs_alone(tmp_path, capsys):
    tile = _tile(tmp_path, _dom())
    tile.raw_raster("dom1").unlink()
    run(tile)
    assert not (tile.data / "dlm" / "roofs_t.geojson").exists()
    assert "no DOM1" in capsys.readouterr().out


def test_regions_closer_than_the_merge_step_merge_a_storey_stays():
    # a ramp of 1 m bands (one roof slope) beside a block 3 m higher
    h = np.zeros((10, 30))
    h[:, :20] = (np.arange(20) // 10)[None, :]
    h[:, 20:] = 5.0
    lab = np.zeros(h.shape, np.int64)
    lab[:, :10], lab[:, 10:20], lab[:, 20:] = 1, 2, 3
    out = merge_regions(lab, h, small_cells=5)
    assert out.max() == 2
    assert len(np.unique(out[:, :20])) == 1
    assert out[0, 0] != out[0, 25]
