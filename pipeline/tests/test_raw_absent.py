"""A raw input that is merely not on this machine empties no committed file
(`Tile.raw_absent`): dormers, structures, the Mapillary lamps, the facade
readings, the windows, the landmarks, the murals and the hedges."""

import json
from types import SimpleNamespace

import pytest

from bake import dormers, facades, landmarks, lowveg, mapillary, murals, structures, windows
from bake.common import Products, Tile

KEPT = '{"features": [1]}'
STEPS = [
    (dormers.run, "dormers_t.geojson", "no DOM1"),
    (structures.run, "structures_t.geojson", "no DOM1"),
    (mapillary.run, "mly_t.geojson", "no Mapillary cache"),
    (facades.run, "facades_t.json", "no facade measurements"),
    (windows.run, "windows_t.json", "no facade traits"),
]


def _tile(tmp_path) -> Tile:
    tile = Tile(
        "t",
        (400_000.0, 5_600_000.0, 400_200.0, 5_600_200.0),
        25833,
        tmp_path / "raw",
        tmp_path / "data",
        credit="Quelle: GeoSN, dl-de/by-2-0",
        mapillary=True,
        mapillary_objects=True,
        products=Products(dom=True, dop="rgbi", dlm=True, lsc=True),
    )
    lod2 = tile.data / "cityjson" / "lod2_t.city.json"
    lod2.parent.mkdir(parents=True)
    lod2.write_text('{"CityObjects": {}, "vertices": [[0, 0, 0]]}')
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
    assert '"features": []' in out.read_text().replace("[ ]", "[]").replace(
        '"buildings":{}', '"features": []'
    )


def test_the_landmarks_stay_without_the_wikidata_cache(tmp_path, capsys):
    tile = _tile(tmp_path)
    out = tile.out("dlm", "landmarks_t.json")
    out.write_text(KEPT)
    landmarks.run(tile)
    assert out.read_text() == KEPT
    assert "no Wikidata cache here" in capsys.readouterr().out


def test_the_murals_stay_without_their_cache_and_are_written_with_an_empty_one(
    tmp_path, capsys, monkeypatch
):
    spec = SimpleNamespace(
        site="s", data=tmp_path / "data", raw=tmp_path / "raw", tiles=[], epsg=25833
    )
    spec.osm = tmp_path / "s.osm.pbf"
    spec.osm.write_text("")
    mural = SimpleNamespace(item="Q1", tags={}, line=False, id="n1", name="m")
    monkeypatch.setattr(murals, "candidates", lambda *_: [mural])
    monkeypatch.setattr(murals, "site_extent", lambda *_: None)
    out = spec.data / "murals" / "murals.json"
    out.parent.mkdir(parents=True)
    out.write_text(KEPT)
    murals.run_site(spec)
    assert out.read_text() == KEPT
    assert "cache is not all here" in capsys.readouterr().out
    # the cache is here and its item gives the mural no size: the empty file
    murals.cache_dir(spec.raw).mkdir(parents=True)
    (murals.cache_dir(spec.raw) / "items.json").write_text('{"Q1": {}}')
    murals.run_site(spec)
    assert json.loads(out.read_text())["murals"] == []


def _points(path, points) -> None:
    feats = [
        {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": p}}
        for p in points
    ]
    path.write_text(json.dumps({"features": feats}))


def test_without_the_scan_the_hedges_stay_and_its_trees_give_way_to_every_canopy_tree(
    tmp_path, monkeypatch
):
    tile = _tile(tmp_path)
    monkeypatch.setattr(lowveg, "has_extract", lambda *_: True)
    monkeypatch.setattr(lowveg, "build", lambda _tile: ({"has_lsc": False}, []))
    hedges = tile.out("dlm", "lowveg_t.geojson")
    scanned = json.dumps({"attribution": lowveg.lsc_credit(tile), "features": [1]})
    hedges.write_text(scanned)
    # a canopy tree that is no row's, 3 m from the first scan tree
    _points(tile.out("dlm", "canopy_t.geojson"), [[400_010.0, 5_600_010.0]])
    extra = tile.out("dlm", "canopyx_t.geojson")
    _points(extra, [[400_013.0, 5_600_010.0], [400_100.0, 5_600_100.0]])
    lowveg.run(tile)
    assert hedges.read_text() == scanned
    left = [f["geometry"]["coordinates"] for f in json.loads(extra.read_text())["features"]]
    assert left == [[400_100.0, 5_600_100.0]]
    # a file that never saw the scan is OSM's alone: written again
    hedges.write_text(KEPT)
    lowveg.run(tile)
    assert json.loads(hedges.read_text())["features"] == []


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
