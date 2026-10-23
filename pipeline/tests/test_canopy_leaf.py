"""A crown in a needle forest is an evergreen, and so is one in a mixed forest
that a leaf-off flight shows green — where the broadleaves are bare, so the
flight can tell."""

from __future__ import annotations

import numpy as np
import pyogrio.raw
import rasterio
import shapely
from PIL import Image

from bake import canopy
from tests.synthetic import SIZE, X0, Y0, osm_tile, read

BROAD, MIXED, NEEDLE = (0, 100), (100, 150), (150, 200)  # x ranges (m)


def _tile(tmp_path, monkeypatch, broadleaf_green: float):
    """A 200 m forest, row 0 = north: broadleaf west of x = 100, mixed to
    x = 150, needle beyond. Every crown is rough DOM1, 12 m tall. In the
    mixed forest the crowns north of y = 100 read green (0.5), the others
    grey (0.15); the broadleaf crowns read `broadleaf_green`."""
    tile = osm_tile(tmp_path, monkeypatch, {})
    tile.dlm.mkdir(parents=True, exist_ok=True)
    stands = [shapely.box(X0 + x0, Y0, X0 + x1, Y0 + SIZE) for x0, x1 in (BROAD, MIXED, NEEDLE)]
    pyogrio.raw.write(
        tile.dlm / "veg02_f.shp",
        np.array([shapely.to_wkb(g) for g in stands], dtype=object),
        [np.array(["1100", "1300", "1200"], dtype=object)],
        fields=["VEG"],
        crs="EPSG:25833",
        geometry_type="Polygon",
        driver="ESRI Shapefile",
    )
    rng = np.random.default_rng(0)
    dom = 112.0 + rng.normal(0.0, 1.5, (SIZE, SIZE))
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
    index = np.full((SIZE, SIZE), 0.15)
    index[:, BROAD[0] : BROAD[1]] = broadleaf_green
    index[: SIZE // 2, MIXED[0] : MIXED[1]] = 0.5
    Image.fromarray((index * 255).astype(np.uint8)).save(tile.out("dlm", "ndvi_t.png"))
    return tile


def _leaves(tile) -> dict[str, set[str]]:
    """The leaf types found in each stand, split north/south in the mixed;
    the crowns within 4 m of a boundary are left out."""
    out: dict[str, set[str]] = {}
    for f in read(tile, "canopy")["features"]:
        x, y = (v - o for v, o in zip(f["geometry"]["coordinates"], (X0, Y0), strict=True))
        if min(abs(x - BROAD[1]), abs(x - MIXED[1]), abs(y - SIZE / 2)) < 4:
            continue
        if x < BROAD[1]:
            where = "broad"
        elif x < MIXED[1]:
            where = "mixed north" if y > SIZE / 2 else "mixed south"
        else:
            where = "needle"
        p = f["properties"]
        out.setdefault(where, set()).add(p.get("l", "") + ("/" + p["ls"] if "ls" in p else ""))
    return out


def test_a_needle_forest_and_a_mixed_forest_s_green_crowns_are_evergreen(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch, broadleaf_green=0.15)  # leaf-off: bare
    canopy.run(tile, cell=7)
    assert _leaves(tile) == {
        "broad": {""},
        "mixed north": {"e/dop"},
        "mixed south": {""},
        "needle": {"e"},
    }


def test_a_summer_flight_tells_no_conifer_in_a_mixed_forest(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch, broadleaf_green=0.5)  # leaf-on: green
    canopy.run(tile, cell=7)
    leaves = _leaves(tile)
    assert leaves["mixed north"] == {""}
    assert leaves["needle"] == {"e"}
