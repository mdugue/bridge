#!/usr/bin/env python3
"""Snapshot JSONs for the tree-cadastre before/after shots (bun run shots).

Street-level views are placed on the tree lines themselves: for a cadastre
`name` (a street or square) the camera stands near one end of the group's
principal axis, a few metres to the side, eye height above the DGM, looking
down the line — oblique, never top-down (AGENTS.md: verify from oblique
angles). The fly-over is a fixed low oblique pass. Writes shots/kat-*.json.

  uv run --with numpy python scripts/eval/kataster-shots.py [--raw DIR]
then
  PORT=3101 bun run shots                                   # before
  PORT=3101 SHOTS_QUERY='?trees=kataster' bun run shots     # after
"""

import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TILE = "33412_5656_2_sn"
DGM = ROOT / "data" / "dresden" / "dgm" / f"dgm1_{TILE}_tiff" / f"dgm1_{TILE}.tif"
EYE = 1.7
DATE = "2026-06-15T15:30:00.000Z"  # 17:30 CEST: warm, oblique afternoon sun

# name -> (fraction of the half-length back from the centre, side offset m,
#          flip the direction, pitch deg)
STREETS = {
    "terrassenufer": ("Terrassenufer", 0.9, 7.0, False, 3.0),
    "radeberger": ("Radeberger Straße", 0.9, -6.0, False, 3.0),
    "albertstrasse": ("Albertstraße", 0.9, 6.0, False, 3.0),
    "rosengarten": ("Rosengarten", 1.1, 8.0, True, 2.0),
    # archetype close-ups: fastigiate street trees, conifers on a square
    "stolpener": ("Stolpener Straße", 1.5, -8.0, True, 4.0),
    "albertplatz": ("Albertplatz - Freiflächen am Brunnen", 1.6, 6.0, False, 4.0),
}
# fly-over: EPSG camera position, height above ground, heading, pitch
FLYOVER = {"flyover": ((412300.0, 5657350.0), 90.0, 150.0, -22.0)}


def ground(x, y):
    out = subprocess.run(
        ["gdallocationinfo", "-valonly", "-geoloc", str(DGM), f"{x}", f"{y}"],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def offset():
    manifest = json.load(open(ROOT / "public" / "data" / "manifest.json"))["files"]
    tileset = json.load(open(ROOT / "public" / "data" / manifest["tileset.json"]))
    off = tileset["extras"]["offset"]
    return off["cx"], off["cy"]


def snapshot(ex, ey, z, heading, pitch, mode, cx, cy):
    return {
        "v": 1,
        "camera": {
            "mode": mode,
            "pos": {"x": round(ex - cx, 2), "y": round(z, 2), "z": round(-(ey - cy), 2)},
            "epsg": {"x": round(ex, 2), "y": round(ey, 2)},
            "headingDeg": round(heading, 1),
            "pitchDeg": pitch,
            "fov": 55,
        },
        "date": DATE,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(ROOT / "data" / "_raw" / "baumkataster"))
    args = ap.parse_args()
    raw = json.load(open(Path(args.raw) / f"stadtbaum_{TILE}.geojson"))
    cx, cy = offset()
    out_dir = ROOT / "shots"
    out_dir.mkdir(exist_ok=True)
    for key, (name, back, side, flip, pitch) in STREETS.items():
        pts = np.array([
            (f["properties"]["gis_x_utm"], f["properties"]["gis_y_utm"])
            for f in raw["features"] if f["properties"]["name"] == name
        ])
        c = pts.mean(axis=0)
        _, s, vt = np.linalg.svd(pts - c)
        axis = vt[0] * (-1 if flip else 1)
        half = np.abs((pts - c) @ vt[0]).max()
        perp = np.array([-axis[1], axis[0]])
        ex, ey = c - axis * half * back + perp * side
        heading = math.degrees(math.atan2(axis[0], axis[1])) % 360
        snap = snapshot(ex, ey, ground(ex, ey) + EYE, heading, pitch, "fly", cx, cy)
        (out_dir / f"kat-{key}.json").write_text(json.dumps(snap, indent=2))
        print(key, name, len(pts), snap["camera"]["epsg"], snap["camera"]["headingDeg"])
    for key, ((ex, ey), above, heading, pitch) in FLYOVER.items():
        snap = snapshot(ex, ey, ground(ex, ey) + above, heading, pitch, "fly", cx, cy)
        (out_dir / f"kat-{key}.json").write_text(json.dumps(snap, indent=2))
        print(key, snap["camera"]["epsg"], heading)


if __name__ == "__main__":
    main()
