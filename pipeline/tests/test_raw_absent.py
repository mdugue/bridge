"""A raw input that is merely not on this machine empties no committed file
(`Tile.raw_absent`): dormers, structures and the Mapillary lamps."""

import pytest

from bake import dormers, mapillary, structures
from bake.common import Tile

KEPT = '{"features": [1]}'
STEPS = [
    (dormers.run, "dormers_t.geojson", "no DOM1"),
    (structures.run, "structures_t.geojson", "no DOM1"),
    (mapillary.run, "mly_t.geojson", "no Mapillary cache"),
]


def _tile(tmp_path) -> Tile:
    tile = Tile(
        "t",
        (400_000.0, 5_600_000.0, 400_200.0, 5_600_200.0),
        25833,
        tmp_path / "raw",
        tmp_path / "data",
        credit="Quelle: GeoSN, dl-de/by-2-0",
        mapillary_objects=True,
    )
    lod2 = tile.data / "cityjson" / "lod2_t.city.json"
    lod2.parent.mkdir(parents=True)
    lod2.write_text("{}")
    return tile


@pytest.mark.parametrize(("run", "name", "said"), STEPS)
def test_a_committed_file_stays_when_its_raw_input_is_not_here(tmp_path, capsys, run, name, said):
    tile = _tile(tmp_path)
    out = tile.out("dlm", name)
    out.write_text(KEPT)
    run(tile)
    assert out.read_text() == KEPT
    printed = capsys.readouterr().out
    assert said in printed and f"leaving {name} as it is" in printed


@pytest.mark.parametrize(("run", "name", "said"), STEPS)
def test_a_tile_without_the_file_still_gets_its_empty_one(tmp_path, run, name, said):
    tile = _tile(tmp_path)
    run(tile)
    assert '"features": []' in (tile.data / "dlm" / name).read_text().replace("[ ]", "[]")
