"""A street's lamps are alike: each takes the median of the post heights
DOM1 shows along its street, or of its kind of street on the tile, or the
5 m it had."""

from __future__ import annotations

import json

import numpy as np
import rasterio

from bake import lamp_heights
from tests.synthetic import SIZE, X0, Y0, osm_tile, way


def _lamps(xs, y):
    return [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [X0 + x, Y0 + y]},
            "properties": {"h": 5.0},
        }
        for x in xs
    ]


def _tile(tmp_path, monkeypatch):
    """A primary road along y = 150 with five lamps 2 m off it, the DOM
    showing four of their posts (9.6–10.3 m) and missing one; a residential
    street along y = 50 with two lamps, one under a tree."""
    nodes = {1: (0, 150, ""), 2: (200, 150, ""), 3: (0, 50, ""), 4: (200, 50, "")}
    ways = way(1, [1, 2], {"highway": "primary", "name": "Hauptstraße"}) + way(
        2, [3, 4], {"highway": "residential", "name": "Gasse"}
    )
    tile = osm_tile(tmp_path, monkeypatch, nodes, ways)
    dom = np.full((SIZE, SIZE), 100.0)
    for x, h in ((20, 9.6), (60, 10.0), (100, 10.3), (140, 10.1)):  # x 180: missed
        dom[SIZE - 152, x] = 100.0 + h
    dom[SIZE - 58 : SIZE - 42, 112:128] = 108.0  # a crown over the lamp at x 120
    dom[SIZE - 52, 60] = 104.5  # the street's other lamp reads 4.5 m
    path = tile.raw_raster("dom1")
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
        dst.write(dom.astype("float32"), 1)
    hung = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [X0 + 100, Y0 + 50]},
        "properties": {"h": 7.0, "wire": [[X0 + 100, Y0 + 40], [X0 + 100, Y0 + 60]]},
    }
    features = _lamps((20, 60, 100, 140, 180), 152) + _lamps((60, 120), 52) + [hung]
    tile.out("dlm", "lamps_t.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features})
    )
    return tile


def _heights(tile):
    doc = json.loads(tile.out("dlm", "lamps_t.geojson").read_text())
    return [(f["properties"]["h"], f["properties"].get("hs")) for f in doc["features"]]


def test_a_street_s_posts_take_the_median_its_lamps_show(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    lamp_heights.run(tile)
    h = _heights(tile)
    # the primary road: four readings, all five lamps at their median
    assert h[:5] == [(10.0, "street")] * 5
    # the residential street: one reading (the other lamp under a crown) —
    # too few for the street, or for its kind on the tile
    assert h[5:7] == [(5.0, None)] * 2
    assert h[7] == (7.0, None)  # a hung lamp keeps its wire's height


def test_too_few_readings_on_a_street_borrow_its_kind_s(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    monkeypatch.setattr(lamp_heights, "STREET_MIN", 5)
    monkeypatch.setattr(lamp_heights, "KIND_MIN", 4)
    lamp_heights.run(tile)
    assert _heights(tile)[:5] == [(10.0, "class")] * 5
