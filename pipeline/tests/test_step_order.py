"""The bake's step order: each step after the steps whose files it reads.

The order is the insertion order of `STEPS` (__main__.py); the step cache's
`Ledger` keys its rewriter pairs on it too. Each pair below is a constraint
the table's comments state — a step moved above its prerequisite would read
a missing or stale file and bake a poorer one without failing.
"""

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
