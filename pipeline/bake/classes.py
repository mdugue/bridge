"""The land-cover class raster's ids: the legend the client's palette is
keyed by (lib/city/landcover.ts `LANDCOVER_CLASSES`), and a name for each
id. Every bake names a class by these, never by its number, so a
renumbering moves them together. Its own module, imported by landcover.py
(which re-exports `CLASSES`) and by the modules landcover.py itself imports.
"""

# id → key
CLASSES = {
    0: "background",
    1: "farmland",
    2: "forest",
    3: "copse",
    4: "builtup",
    5: "railway",
    6: "path",
    7: "road",
    8: "water",
    9: "arable",
}

_ID = {name: i for i, name in CLASSES.items()}
BACKGROUND = _ID["background"]
FARMLAND = _ID["farmland"]
FOREST = _ID["forest"]
COPSE = _ID["copse"]
BUILTUP = _ID["builtup"]
RAILWAY = _ID["railway"]
PATH = _ID["path"]
ROAD = _ID["road"]
WATER = _ID["water"]
ARABLE = _ID["arable"]
# the viewer calls class 1 meadow (lib/city/landcover.ts MEADOW_CLASS)
MEADOW = FARMLAND
