"""`python -m bake <step> --tile ID --bounds XMIN YMIN XMAX YMAX --epsg N`
(the arguments come from the site config; `bun run bake` passes them)."""

from __future__ import annotations

import argparse
from pathlib import Path

from . import canopy, furniture, lamps, landcover, monuments, ndvi, rail, roof_colour, stairs, walls
from .common import Tile

STEPS = {
    "landcover": landcover.run,
    "canopy": canopy.run,
    "ndvi": ndvi.run,
    "roof-colour": roof_colour.run,
    "lamps": lamps.run,
    "monuments": monuments.run,
    "furniture": furniture.run,
    "walls": walls.run,
    "stairs": stairs.run,
    "rail": rail.run,
}


def main() -> None:
    parser = argparse.ArgumentParser(prog="bake")
    parser.add_argument("step", choices=[*STEPS, "all"])
    parser.add_argument("--tile", required=True)
    parser.add_argument("--bounds", nargs=4, type=float, required=True)
    parser.add_argument("--epsg", type=int, required=True)
    parser.add_argument("--raw", type=Path, required=True, help="the site's canonical raw folder")
    parser.add_argument("--data", type=Path, default=Path("data"))
    args = parser.parse_args()
    tile = Tile(args.tile, tuple(args.bounds), args.epsg, args.raw, args.data)
    steps = list(STEPS) if args.step == "all" else [args.step]
    for step in steps:
        STEPS[step](tile)


if __name__ == "__main__":
    main()
