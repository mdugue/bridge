"""Where the OSM extract comes from (osm_source.py): BBBike's published
boundary, whether it covers a site with the bakes' widest read margin, the
record beside the extract and the provenance a bake writes from it — and
that no bake reads OSM farther beyond a tile than that margin."""

import dataclasses
import errno
import json
import re
import urllib.error
from pathlib import Path

import pytest

from bake import __main__ as bake_main
from bake import osm_source
from bake.common import Tile
from bake.spec import parse

BAKE = Path(__file__).resolve().parent.parent / "bake"
# BBBike's Dresden boundary as published (Dresden.poly, 2026-11-16)
DRESDEN = """Dresden
1
   13.43  50.88
   14.18  50.88
   14.18  51.23
   13.43  51.23
END
END
"""


def _tile(e: int, n: int, epsg: int = 25833) -> Tile:
    x, y = e * 1000.0, n * 1000.0
    return Tile(f"{e}_{n}", (x, y, x + 2000, y + 2000), epsg, Path("raw"), Path("data"))


def test_a_poly_file_with_a_hole_parses():
    poly = osm_source.parse_poly(
        "x\n1\n 0 0\n 4 0\n 4 4\n 0 4\nEND\n!2\n 1 1\n 2 1\n 2 2\n 1 2\nEND\nEND\n"
    )
    assert poly.area == pytest.approx(15.0)
    with pytest.raises(ValueError):
        osm_source.parse_poly("x\nEND\n")


def test_bbbikes_dresden_covers_dresden_but_not_meissen():
    boundary = osm_source.parse_poly(DRESDEN)
    assert osm_source.shortfall(boundary, [_tile(412, 5656), _tile(408, 5658)]) is None
    # Meißen's one tile ends 0.025° inside the rectangle's west edge, short
    # of the 0.05° the monorail's chain is read around a tile
    short = osm_source.shortfall(boundary, [_tile(392, 5668)])
    assert short is not None and short.startswith("west by 0.02")


def test_the_record_names_the_source_and_day_and_provenance_takes_it_per_tile(tmp_path):
    pbf = tmp_path / "Leipzig.osm.pbf"
    pbf.write_text("x")
    url = "https://download.bbbike.org/osm/bbbike/Leipzig/Leipzig.osm.pbf"
    osm_source.write_record(pbf, url, "2026-11-14T16:39:33+00:00", "abc", "abc")
    assert "from BBBike" in osm_source.describe(pbf) and "2026-11-14" in osm_source.describe(pbf)
    provenance = tmp_path / "provenance.json"
    provenance.write_text(json.dumps({"openstreetmap": {"licence": "ODbL"}}))
    osm_source.record_bake(provenance, pbf, [("walls", "a"), ("lamps", "a"), ("walls", "b")], [])
    osm = json.loads(provenance.read_text())["openstreetmap"]
    assert osm["licence"] == "ODbL"
    assert list(osm["baked"]) == ["lamps", "walls"] and list(osm["baked"]["walls"]) == ["a", "b"]
    # the data's day first: the Open-Data-Wächter reads the age from it;
    # the bake's own day apart, where no reader takes it for the data's
    entry = osm["baked"]["walls"]["a"]
    assert entry["dataAsOf"].startswith("2026-11-14 (BBBike extract")
    assert "baked" not in entry["dataAsOf"] and len(entry["on"]) == 10


def test_an_extract_without_a_day_is_unknown_not_the_day_of_the_bake(tmp_path):
    pbf = tmp_path / "sachsen-latest.osm.pbf"
    for record in (None, {"source": "Geofabrik", "url": "u", "lastModified": None}):
        entry = osm_source.provenance_entry(record, pbf, "2026-11-16")
        assert entry["dataAsOf"].startswith("unknown")
        assert not re.search(r"20\d\d-\d\d-\d\d", entry["dataAsOf"])


def test_only_a_failure_to_reach_the_server_counts_as_unreachable():
    reset = urllib.error.URLError(ConnectionResetError(104, "Connection reset by peer"))
    assert osm_source.unreachable(reset)
    assert osm_source.unreachable(urllib.error.HTTPError("u", 503, "x", None, None))
    assert osm_source.unreachable(OSError("u: 100 of 2000 bytes"))
    assert not osm_source.unreachable(urllib.error.HTTPError("u", 404, "x", None, None))
    assert not osm_source.unreachable(OSError("u: md5 abc, published def"))
    assert not osm_source.unreachable(OSError(errno.ENOSPC, "No space left on device"))


def _spec(tmp_path: Path, e: int, n: int):
    return parse(
        json.dumps(
            {
                "site": "s",
                "provider": "sn",
                "epsg": 25833,
                "products": {"dom": True, "dop": None, "dlm": True, "lsc": False},
                "credit": "c",
                "raw": str(tmp_path),
                "data": str(tmp_path / "data"),
                "osm": "https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf",
                "tiles": [
                    {"id": "t", "bounds": [e * 1000, n * 1000, e * 1000 + 2000, n * 1000 + 2000]}
                ],
            }
        )
    )


BBBIKE = "https://download.bbbike.org/osm/bbbike/Dresden/Dresden.osm.pbf"


def _bbbike_on_disk(tmp_path: Path, content: bytes = b"x") -> Path:
    pbf = tmp_path / "osm" / "Dresden.osm.pbf"
    pbf.parent.mkdir(parents=True, exist_ok=True)
    pbf.write_bytes(content)
    osm_source.poly_path(pbf).write_text(DRESDEN)
    md5 = osm_source.file_md5(pbf)
    poly = osm_source.text_md5(DRESDEN)
    osm_source.write_record(pbf, BBBIKE, "2026-11-14T16:51:10+00:00", md5, md5, poly)
    return pbf


def test_the_bake_takes_a_fallback_on_disk_only_where_it_covers_the_site(tmp_path):
    pbf = _bbbike_on_disk(tmp_path)
    said: list[str] = []
    dresden = osm_source.resolve(_spec(tmp_path, 412, 5656), BBBIKE, say=said.append)
    assert dresden.osm == pbf and dresden.tiles[0].osm == pbf
    meissen = osm_source.resolve(_spec(tmp_path, 392, 5668), BBBIKE, say=said.append)
    assert not meissen.osm.exists() and meissen.tiles[0].osm_extract() is None
    assert "does not cover s" in said[-1]
    # a file that is not the one its record names is not taken either
    pbf.write_bytes(b"y")
    assert not osm_source.resolve(_spec(tmp_path, 412, 5656), BBBIKE, say=said.append).osm.exists()
    assert "md5 differs" in said[-1]


def test_a_boundary_not_fetched_with_its_extract_is_refused(tmp_path):
    # BBBike widened Dresden's rectangle and only the .poly was fetched
    # again: the file on disk is still the old cut
    pbf = _bbbike_on_disk(tmp_path)
    osm_source.poly_path(pbf).write_text(DRESDEN.replace("13.43", "13.30"))
    problem = osm_source.usable(_spec(tmp_path, 392, 5668), pbf)
    assert problem is not None and "not the boundary fetched with" in problem


def test_an_extract_that_is_not_its_records_stops_the_bake(tmp_path):
    spec = _spec(tmp_path, 412, 5656)
    spec.osm.parent.mkdir(parents=True, exist_ok=True)
    spec.osm.write_bytes(b"replaced by hand")
    url = "https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf"
    osm_source.write_record(spec.osm, url, "2026-11-10T00:00:00+00:00", "abc", "abc")
    with pytest.raises(SystemExit) as stop:
        osm_source.resolve(spec, BBBIKE)
    assert "md5 differs" in str(stop.value.code)


def test_which_extract_a_step_read_is_in_its_cache_key(tmp_path):
    spec = _spec(tmp_path, 412, 5656)
    primary = spec.osm
    # no extract, then BBBike's, then Geofabrik's: three keys for lamps
    none = osm_source.identity(spec, primary)
    pbf = _bbbike_on_disk(tmp_path)
    bbbike = osm_source.identity(osm_source.resolve(spec, BBBIKE), primary)
    primary.write_text("geofabrik")  # placed by hand: no record, no check
    geofabrik = osm_source.identity(osm_source.resolve(spec, BBBIKE), primary)
    assert none == "none" and bbbike["file"] == pbf.name and geofabrik is None
    keys = [bake_main.step_key("lamps", False, "h", osm) for osm in (none, bbbike, geofabrik)]
    assert len({json.dumps(k, sort_keys=True) for k in keys}) == 3
    # on the provider's own extract the key is the one every recorded run
    # already has: nothing runs again for this change
    assert "osm" not in keys[2] and set(keys[2]) == {"step", "code", "spec", "research"}
    # a step that reads no OSM keeps one key whatever the extract
    no_osm = [s for s in bake_main.STEPS if not bake_main.reads_osm(s)]
    if no_osm:
        assert bake_main.step_key(no_osm[0], False, "h", bbbike) == bake_main.step_key(
            no_osm[0], False, "h", None
        )


def test_a_bake_without_a_covering_extract_is_refused_unless_asked(tmp_path):
    spec = _spec(tmp_path, 392, 5668)
    with pytest.raises(SystemExit) as stop:
        bake_main.refuse_without_extract(spec, ["landcover", "trees"], without_osm=False)
    assert "--without-osm" in str(stop.value.code)
    bake_main.refuse_without_extract(spec, ["landcover", "trees"], without_osm=True)


def test_a_bake_that_fails_midway_keeps_what_its_finished_tiles_ran(tmp_path, monkeypatch):
    spec = _spec(tmp_path, 412, 5656)
    tiles = [spec.tiles[0], dataclasses.replace(spec.tiles[0], id="t2")]

    def run(spec, step, tile, *args):
        if tile.id == "t2":
            raise RuntimeError("tile two fails")
        return True, True

    monkeypatch.setattr(bake_main, "recorded_tile", run)
    bake = bake_main.Bake(spec, 1, False, "h", "off")
    with pytest.raises(RuntimeError):
        bake.step("walls", tiles)
    assert bake.ran == {("walls", "t"): (True, True)}


def _first_tile_fails(spec, step, tile, *args):
    """A step's run in a `--jobs` worker (module level: a pool pickles it)."""
    if tile.id == "t0":
        raise RuntimeError("the first tile fails")
    return True, True


def test_a_step_baked_without_the_extract_keeps_no_day(tmp_path):
    pbf = tmp_path / "Leipzig.osm.pbf"
    provenance = tmp_path / "provenance.json"
    old = {"dataAsOf": "2026-10-31 (…)", "on": "2026-11-01"}
    provenance.write_text(json.dumps({"openstreetmap": {"baked": {"trees": {"a": old}}}}))
    osm_source.record_bake(provenance, pbf, [], [("trees", "a")])
    assert "trees" not in json.loads(provenance.read_text())["openstreetmap"]["baked"]


def test_a_step_that_skipped_without_the_extract_keeps_its_day(tmp_path):
    spec = _spec(tmp_path, 412, 5656)
    provenance = spec.data / "provenance.json"
    provenance.parent.mkdir(parents=True)
    day = {"dataAsOf": "2026-11-14 (…)", "on": "2026-11-16"}
    provenance.write_text(json.dumps({"openstreetmap": {"baked": {"walls": {"t": day}}}}))
    bake = bake_main.Bake(spec, 1, False, "h", "off")
    # walls ran with --without-osm and skipped: its committed file stays
    bake.ran = {("walls", "t"): (False, False)}
    bake_main.record_provenance(spec, bake)
    assert json.loads(provenance.read_text())["openstreetmap"]["baked"]["walls"]["t"] == day
    # trees wrote its file without the extract: no day of any extract now
    bake.ran = {("walls", "t"): (False, True)}
    bake_main.record_provenance(spec, bake)
    assert "walls" not in json.loads(provenance.read_text())["openstreetmap"]["baked"]
