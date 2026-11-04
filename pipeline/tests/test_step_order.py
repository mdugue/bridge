"""The bake's step order: each step after the steps whose files it reads.

The order is the insertion order of `STEPS` (__main__.py); the step cache's
`Ledger` keys its rewriter pairs on it too. Each pair below is a constraint
the table's comments state — a step moved above its prerequisite would read
a missing or stale file and bake a poorer one without failing.
"""

import importlib
import pkgutil
from types import SimpleNamespace

import pytest

import bake
from bake import __main__ as runner
from bake.__main__ import STEPS

AFTER = {
    "rail": ["landcover"],
    "canopy": ["landcover", "rail", "ndvi"],
    "furniture": ["landcover", "rail"],
    "mapillary": ["lamps", "furniture"],
    "lamp-heights": ["lamps", "mapillary"],
    "markings": ["surface", "edges"],
    "sport": ["ndvi"],
    "tram": ["landcover", "ndvi", "furniture", "rail"],
    "roofs": ["ndvi"],
    "lowveg": ["canopy", "trees", "walls", "rail"],
    "cultivated": ["lowveg", "canopy", "trees"],
    "skyview": ["canopy", "trees", "lowveg", "roofs"],
    "small-buildings": ["lowveg", "walls", "rail", "monuments", "furniture"],
    "structures": ["landmarks"],
    "roof-colour": ["roofs", "small-buildings", "structures", "landcover"],
    "dormers": ["roofs", "canopy", "trees", "lowveg"],
}


def test_every_step_follows_the_steps_it_reads():
    order = list(STEPS)
    late = [
        f"{step} runs before {before}"
        for step, befores in AFTER.items()
        for before in befores
        if order.index(before) > order.index(step)
    ]
    assert late == []


def test_land_cover_comes_first():
    assert list(STEPS)[0] == "landcover"


def test_every_constraint_names_a_step():
    named = set(AFTER) | {b for bs in AFTER.values() for b in bs}
    assert named <= set(STEPS)


# the bake's commands, not steps: their `run` is not in the table
COMMANDS = {"fetch", "coverage"}


def test_every_steps_run_is_in_the_table_once():
    listed = list(STEPS.values())
    assert len({id(f) for f in listed}) == len(listed)
    unlisted = []
    for info in pkgutil.iter_modules(bake.__path__):
        module = importlib.import_module(f"bake.{info.name}")
        run = getattr(module, "run", None)
        own = callable(run) and run.__module__ == module.__name__
        if own and info.name not in COMMANDS and run not in listed:
            unlisted.append(info.name)
    assert unlisted == []


def test_a_failing_step_names_its_site_tile_and_step(tmp_path, monkeypatch, capsys):
    def broken(step, tile, site_tiles, research=False):
        raise ValueError("no DOM1")

    monkeypatch.setattr(runner, "run_tile", broken)
    spec = SimpleNamespace(site="dresden", raw=tmp_path, data=tmp_path, tiles=[])
    tile = SimpleNamespace(id="33412_5656_2_sn")
    with pytest.raises(ValueError, match="no DOM1"):
        runner.recorded_tile(spec, "dormers", tile, False, {}, save=False)
    assert "dresden 33412_5656_2_sn dormers: no DOM1" in capsys.readouterr().out
