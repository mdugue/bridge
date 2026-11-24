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
    # (Mapillary's lamps are handed on: lamp-water writes the tile's file)
    out = tile.work(name) if run is mapillary.run else tile.data / "dlm" / name
    assert '"features": []' in out.read_text().replace("[ ]", "[]")


def test_mapillary_without_the_osm_extract_skips_and_keeps_its_file(tmp_path, capsys):
    # the Mapillary cache is here, the OSM extract is not: the step skips
    # with a note (it weighs the lamps against OSM's) instead of stopping
    # the bake, and leaves the committed file as it is
    tile = _tile(tmp_path)
    tile = Tile(**{**tile.__dict__, "osm": tmp_path / "raw" / "osm" / "absent.osm.pbf"})
    cache = mapillary.cache_path(tile)
    cache.parent.mkdir(parents=True)
    cache.write_text('{"features": []}')
    out = tile.out("dlm", "mly_t.geojson")
    out.write_text(KEPT)
    mapillary.run(tile)
    assert out.read_text() == KEPT
    printed = capsys.readouterr().out
    assert "no OSM extract" in printed and "leaving mly_t.geojson as it is" in printed
    # a tile without the file gets its empty one (every tile carries it)
    out.unlink()
    mapillary.run(tile)
    assert '"features": []' in tile.work(out.name).read_text().replace("[ ]", "[]")
