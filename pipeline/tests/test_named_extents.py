"""What a step reads beyond its tile is found by the files' names, not by
opening every raster of the site (common.py `neighbours`, `dom_paths`)."""

from bake.common import Tile, dom_paths

HERE = (410000.0, 5656000.0, 412000.0, 5658000.0)


def _tile(tmp_path) -> Tile:
    return Tile("33410_5656_2_sn", HERE, 25833, tmp_path / "raw", tmp_path / "data")


def _touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"no raster: opening it would fail")
    return path


def test_the_sites_tiles_are_placed_by_their_names(tmp_path):
    tile = _tile(tmp_path)
    for tid in ("33410_5656_2_sn", "33412_5656_2_sn"):
        _touch(tile.data / "dgm" / f"dgm1_{tid}_tiff" / f"dgm1_{tid}.tif")
    assert tile.neighbours() == [
        ("33410_5656_2_sn", HERE),
        ("33412_5656_2_sn", (412000.0, 5656000.0, 414000.0, 5658000.0)),
    ]


def test_a_decks_surface_model_is_its_tiles_and_the_ones_beside_it(tmp_path):
    tile = _tile(tmp_path)
    near = [_touch(tile.raw / "dom1" / f"{t}.tif") for t in ("33410_5656_2_sn", "33412_5656_2_sn")]
    _touch(tile.raw / "dom1" / "33416_5656_2_sn.tif")
    odd = _touch(tile.raw / "dom1" / "another_scheme.tif")
    xmin, ymin, xmax, ymax = HERE
    found = dom_paths(tile, (xmin - 60, ymin - 60, xmax + 60, ymax + 60))
    # (one of another naming scheme is kept, for the mosaic to open and see)
    assert found == sorted([*near, odd])
