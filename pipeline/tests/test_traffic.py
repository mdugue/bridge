"""The city's counted traffic (traffic.py): what a WFS row becomes, and the
clip that gives every tile its own piece of a section across a seam."""

import json
from pathlib import Path

import pytest

from bake.common import Tile
from bake.traffic import clip_sections, run, section_props

BOUNDS = (0.0, 0.0, 100.0, 100.0)


def _row(**props) -> dict:
    base = {
        "sta_id": "00001010",
        "str_bez": "Teststraße",
        "dtv_hin": 3700.0,
        "sv_hin": 74.0,
        "dtv_rueck": 4300.0,
        "sv_rueck": 86.0,
        "dtv_gesamt": 8000.0,
        "zaehldat_text": "28.05.2024",
        "zaehlart_h": "MAN",
        "zaehlart_r": "MAN",
    }
    return {**base, **props}


def _section(coords, **props) -> dict:
    return {
        "type": "Feature",
        "properties": _row(**props),
        "geometry": {"type": "LineString", "coordinates": coords},
    }


def test_both_directions_their_heavy_share_year_and_method():
    p = section_props(_row())
    assert p == {
        "t": 8000,
        "f": 3700,
        "hf": 0.02,
        "b": 4300,
        "hb": 0.02,
        "y": 2024,
        "m": "man",
        "n": "Teststraße",
    }


def test_an_uncounted_direction_is_left_out_not_zero():
    p = section_props(_row(dtv_rueck=-1.0, sv_rueck=-1.0, dtv_gesamt=3699.0))
    assert p is not None
    assert "b" not in p and "hb" not in p
    assert p["t"] == 3700


def test_the_table_total_stands_in_where_no_direction_is_counted():
    p = section_props(_row(dtv_hin=-1.0, dtv_rueck=-1.0, dtv_gesamt=1200.0))
    assert p is not None
    assert p["t"] == 1200 and "f" not in p and "b" not in p


def test_a_section_that_counts_nothing_is_dropped():
    assert section_props(_row(dtv_hin=-1.0, dtv_rueck=-1.0, dtv_gesamt=-2.0)) is None


def test_the_weakest_method_names_the_section_and_shares_are_clamped():
    p = section_props(_row(zaehlart_r="HW", sv_hin=4000.0))
    assert p is not None
    assert p["m"] == "estimate"
    assert p["hf"] == 1.0


def test_only_a_street_named_a_bridge_is_on_a_bridge():
    bridge = section_props(_row(str_bez="Albertbrücke"))
    street = section_props(_row(str_bez="Königsbrücker Straße"))
    assert bridge is not None and bridge["br"] == 1
    assert street is not None and "br" not in street


def test_a_section_across_the_seam_is_cut_at_the_tile_edge():
    raw = {"features": [_section([[50.0, 50.0], [150.0, 50.0]])]}
    here = clip_sections(raw, BOUNDS)
    there = clip_sections(raw, (100.0, 0.0, 200.0, 100.0))
    assert [f["geometry"]["coordinates"] for f in here] == [[[50.0, 50.0], [100.0, 50.0]]]
    assert [f["geometry"]["coordinates"] for f in there] == [[[100.0, 50.0], [150.0, 50.0]]]


def test_a_sliver_left_by_the_clip_is_dropped():
    raw = {"features": [_section([[99.0, 50.0], [150.0, 50.0]])]}
    assert clip_sections(raw, BOUNDS) == []


@pytest.fixture
def tile(tmp_path: Path) -> Tile:
    return Tile("t", BOUNDS, 25833, tmp_path / "raw", tmp_path / "data", traffic="dresden")


def test_a_tile_without_counts_still_gets_its_empty_file(tile: Tile):
    (tile.raw / "traffic").mkdir(parents=True)
    (tile.raw / "traffic" / "t.geojson").write_text(json.dumps({"features": []}))
    run(tile)
    doc = json.loads((tile.data / "dlm" / "traffic_t.geojson").read_text())
    assert doc["features"] == []
    assert "Landeshauptstadt Dresden" in doc["attribution"]


# --- the other sources (traffic_sources.py) ----------------------------------


def test_a_total_counted_both_ways_is_split_evenly_and_marked():
    from bake.traffic_sources import split_total

    p = split_total(4409, 0.069, 2021, "B 107")
    assert p["f"] + p["b"] == p["t"] == 4409
    assert abs(p["f"] - p["b"]) <= 1
    assert p["sp"] == 1 and p["m"] == "census"
    assert p["hf"] == p["hb"] == 0.069
    assert p["n"] == "B 107" and "br" not in p
    assert split_total(1, None, None)["f"] == 1


def test_each_source_reads_its_own_fields():
    from bake.traffic_sources import (
        berlin_props,
        hamburg_props,
        nrw_props,
        saxony_svz_props,
    )

    assert berlin_props({"dtvw_kfz": 24900, "str_name": "Potsdamer Straße"})["n"] == (
        "Potsdamer Straße"
    )
    hh = hamburg_props({"dtv": 40000, "sv": 6})
    assert hh["t"] == 40000 and hh["hf"] == 0.06 and hh["y"] == 2019
    sn = saxony_svz_props({"dtv_kfzges": 9651, "sv_kfz": "6.1", "jahr": "2021", "strasse": "B 107"})
    assert sn["t"] == 9651 and sn["hf"] == 0.061 and sn["y"] == 2021
    nw = nrw_props({"DTVKFZA": "15963.0", "DTVSVA": "929.0", "STRBEZ": "B1"})
    assert nw["t"] == 15963 and nw["hf"] == round(929 / 15963, 3)
    # nothing counted: no section
    assert hamburg_props({"dtv": 0}) is None
    assert nrw_props({"DTVKFZA": None}) is None


def test_the_site_names_its_source_and_a_site_without_one_bakes_nothing(tmp_path: Path):
    tile = Tile("t", BOUNDS, 25833, tmp_path / "raw", tmp_path / "data")
    run(tile)
    assert not (tile.data / "dlm" / "traffic_t.geojson").exists()
