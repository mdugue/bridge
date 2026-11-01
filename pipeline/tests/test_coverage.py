"""The coverage check: its ledger says true of the bakes, and a site's
frequent built thing nobody decided about fails it."""

import re
from pathlib import Path

from bake import coverage
from bake.coverage import KEYS, LEDGER, MIN_COUNT, PAIRS, Drawn
from tests.synthetic import osm_tile, tags, way

BAKE = Path(coverage.__file__).parent


def test_a_drawn_value_is_read_by_its_module():
    for key, values in LEDGER.items():
        for value, fate in values.items():
            if not isinstance(fate, Drawn):
                continue
            source = BAKE / f"{fate.module}.py"
            assert source.exists(), f"{key}={value}: no {source.name}"
            quoted = re.compile(rf"""["']{re.escape(value)}["']|=>"{re.escape(value)}\"""")
            assert quoted.search(source.read_text()), f"{key}={value}: {source.name} never names it"


def test_the_ledger_decides_the_audited_keys_only():
    assert set(LEDGER) == set(KEYS) | {k for k, _ in PAIRS}
    for key, value in PAIRS:
        assert value in LEDGER[key]
        assert set(LEDGER[key]) == {v for k, v in PAIRS if k == key}


def test_tags_read_from_columns_and_other_tags():
    row = {
        "osm_id": "7",
        "man_made": "flagpole",
        "other_tags": '"power"=>"pole","route"=>"ferry"',
    }
    assert sorted(coverage.audited(coverage.tags_of(row))) == [
        "man_made=flagpole",
        "power=pole",
        "route=ferry",
    ]


def test_an_undecided_frequent_value_fails(tmp_path, monkeypatch, capsys):
    nodes = {}
    for i in range(MIN_COUNT):
        nodes[1 + i] = (20 + 10 * i, 20, tags(man_made="flagpole"))
        nodes[10 + i] = (20 + 10 * i, 60, tags(man_made="zeppelin_mast"))
    # rare: seen less often than MIN_COUNT
    nodes[30] = (20, 100, tags(man_made="sundial"))
    # a line counts once, however many nodes it has
    nodes[40] = (20, 150, "")
    nodes[41] = (180, 150, "")
    nodes[42] = (100, 150, "")
    # the OSM driver reads the nodes in increasing id
    nodes = dict(sorted(nodes.items()))
    tile = osm_tile(tmp_path, monkeypatch, nodes, way(100, [40, 42, 41], {"railway": "turntable"}))
    counts = coverage.count(tile.osm_extract(), [tile])
    assert counts["man_made=flagpole"] == MIN_COUNT
    assert counts["railway=turntable"] == 1
    assert coverage.run(tile.osm_extract(), [tile], "t") == 1
    out = capsys.readouterr().out
    assert "man_made=zeppelin_mast" in out.split("does not decide:")[1]
    assert "sundial" not in out.split("does not decide:")[1]
    assert "planned: flagpoles" in out


def test_a_decided_site_passes(tmp_path, monkeypatch):
    nodes = {i: (20 + 10 * i, 20, tags(man_made="flagpole")) for i in range(1, 5)}
    tile = osm_tile(tmp_path, monkeypatch, nodes)
    assert coverage.run(tile.osm_extract(), [tile], "t") == 0
