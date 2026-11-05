"""The water a street lamp's light falls on, for the river's mirror of it
(app/_components/lamp-reflections.ts): `w` on each lamp that sees water
within REACH_M — the water's level there (m, the DGM1's), which the viewer
lays the lamp's column on. A lamp without `w` is not mirrored.

A lamp sees the water when its light reaches it past the buildings: from
its head, rays every 360/AZIMUTHS degrees run out over the height field the
sky view burns (skyview.py `fields`: the DGM1 with the LoD2 roofs on it,
every committed tile across the seams) to their first water cell (the class
rasters' water, every committed tile's), and a ray counts when nothing
stands over the line from the head down to that cell. A lamp sees the water
when OPENING neighbouring rays do — a ray's light may land on the water
up to WATER_OUT_M past the bank's edge, over a quay wall: the Terrassenufer's lamps over the quay,
the Elbwiesen's on their paths, the bridges' — not a lamp in an old-town
lane behind the first row of houses, whose light the houses keep from the
river (one ray through a gap between two houses is no view of it). Before,
the viewer mirrored every lamp within 80 m of the water, and none farther.

The level: the lowest DGM1 over the first WATER_RUN_M of each seeing ray's
water (its bank cell climbs the bank), the median over the rays — the
viewer's water sheet lies on the same ground.

The lamps' own files are rewritten (OSM's `lamps_`, Mapillary's lamps in
`mly_`), so this runs after lamp_heights.py, whose heights it reads."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .classes import WATER
from .common import Tile, overlaps
from .lamp_heights import LAMP_H
from .skyview import Field, Roofs, fields

REACH_M = 300.0  # how far a lamp's light is followed to the water
FIELD_PX = 1024  # the height field's cells over the tile (≈ 2 m)
AZIMUTHS = 64  # rays round a lamp, 5.6° apart
OPENING = 3  # neighbouring rays (11°) that must see the water
NEAR_M = 3.0  # the field this close to the head is the lamp's own facade
CLEAR_M = 0.3  # an occluder must stand this far over the line
WATER_RUN_M = 12.0  # a ray's water read for the level, from its first cell
WATER_OUT_M = 40.0  # how far past its first water cell a ray's light may land


def water_field(tile: Tile, field: Field, sources) -> np.ndarray:
    """Whether each cell of the field is water, by every committed class
    raster it touches (False where none reaches)."""
    out = np.zeros(field.shape, bool)
    bounds = (field.xmin, field.ymin, field.xmax, field.ymax)
    xs = field.xmin + (np.arange(field.cols) + 0.5) * field.res
    ys = field.ymax - (np.arange(field.rows) + 0.5) * field.res
    for tid, b in sources:
        if not overlaps(b, bounds):
            continue
        classes = tile.classes(tid)
        if classes is None:
            continue
        h, w = classes.shape
        cols = np.floor((xs - b[0]) / (b[2] - b[0]) * w).astype(int)
        rows = np.floor((b[3] - ys) / (b[3] - b[1]) * h).astype(int)
        cin = (cols >= 0) & (cols < w)
        rin = (rows >= 0) & (rows < h)
        if not cin.any() or not rin.any():
            continue
        r_idx, c_idx = np.nonzero(rin)[0], np.nonzero(cin)[0]
        block = classes[np.ix_(rows[r_idx], cols[c_idx])] == WATER
        out[np.ix_(r_idx, c_idx)] |= block
    return out


def ray_steps(res: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Each ray's sample offsets (cells, east and south) and distances (m):
    one sample a cell, from NEAR_M out to REACH_M."""
    dist = np.arange(NEAR_M, REACH_M, res, dtype=np.float32)
    az = np.radians(np.arange(AZIMUTHS) * (360.0 / AZIMUTHS))
    dx = np.sin(az)[:, None] * dist[None, :] / res
    dy = -np.cos(az)[:, None] * dist[None, :] / res
    return dx, dy, dist


def seen_rays(
    head: tuple[float, float, float],
    ground: np.ndarray,
    surface: np.ndarray,
    water: np.ndarray,
    field: Field,
    steps: tuple[np.ndarray, np.ndarray, np.ndarray],
) -> tuple[np.ndarray, np.ndarray]:
    """For each ray from the lamp's `head` (x, y, z): whether its light
    reaches water unblocked, and that water's level (NaN where not)."""
    x, y, z = head
    dx, dy, dist = steps
    col0 = (x - field.xmin) / field.res
    row0 = (field.ymax - y) / field.res
    cols = np.floor(col0 + dx).astype(int)
    rows = np.floor(row0 + dy).astype(int)
    inside = (cols >= 0) & (cols < field.cols) & (rows >= 0) & (rows < field.rows)
    cols = np.clip(cols, 0, field.cols - 1)
    rows = np.clip(rows, 0, field.rows - 1)
    wet = water[rows, cols] & inside
    hits = wet.any(axis=1)
    first = np.argmax(wet, axis=1)
    level = np.full(AZIMUTHS, np.nan, np.float32)
    seen = np.zeros(AZIMUTHS, bool)
    run = max(1, int(round(WATER_RUN_M / field.res)))
    out = max(1, int(round(WATER_OUT_M / field.res)))
    for k in np.nonzero(hits)[0]:
        f = int(first[k])
        r, c = rows[k], cols[k]
        # the water's level: its lowest ground over the first stretch (the
        # bank's wet cells climb the bank)
        wet_run = wet[k, f : f + run]
        w = float(np.min(ground[r[f : f + run], c[f : f + run]][wet_run]))
        # the light lands on the water past the bank's edge: seen when the
        # line from the head to any water cell of the next stretch clears
        # everything dry before it
        dry = ~wet[k]
        top = surface[r, c]
        for j in range(f, min(f + out, len(dist))):
            if not wet[k, j]:
                continue
            line = z + (w - z) * dist[:j] / dist[j]
            if not np.any(dry[:j] & (top[:j] > line + CLEAR_M)):
                seen[k] = True
                level[k] = w
                break
    return seen, level


def opening(seen: np.ndarray) -> bool:
    """Whether OPENING neighbouring rays (round the circle) see water."""
    if OPENING <= 1:
        return bool(seen.any())
    run = np.ones(len(seen), bool)
    for i in range(OPENING):
        run &= np.roll(seen, -i)
    return bool(run.any())


def lamp_head(f: dict, ground: np.ndarray, field: Field) -> tuple[float, float, float] | None:
    """A lamp's head (x, y, height) as the viewer stands it: its height
    over its deck, else over the ground; None off the field."""
    x, y = f["geometry"]["coordinates"][:2]
    props = f["properties"] or {}
    c = int((x - field.xmin) / field.res)
    r = int((field.ymax - y) / field.res)
    if not (0 <= c < field.cols and 0 <= r < field.rows):
        return None
    base = props.get("deck")
    if base is None:
        base = float(ground[r, c])
    return float(x), float(y), float(base) + float(props.get("h", LAMP_H))


def _lamps(doc: dict, mapillary: bool) -> list[dict]:
    """The file's lamps (Mapillary's file holds its bins too)."""
    return [
        f for f in doc["features"] if not mapillary or (f["properties"] or {}).get("k") == "lamp"
    ]


def run(tile: Tile) -> None:
    files = [(tile.out("dlm", f"lamps_{tile.id}.geojson"), False)]
    files.append((tile.out("dlm", f"mly_{tile.id}.geojson"), True))
    docs = [(p, json.loads(p.read_text()), m) for p, m in files if p.exists()]
    lamps = [f for _, doc, m in docs for f in _lamps(doc, m)]
    for f in lamps:
        f["properties"] = dict(f["properties"] or {})
        f["properties"].pop("w", None)
    if not lamps or not tile.dgm.exists():
        for path, doc, _ in docs:
            _write(path, doc)
        print(f"{tile.id}: no lamps or no DGM — none mirrored")
        return
    sources = tile.neighbours()
    roofs = Roofs(tile, sources)
    ground, surface, margin = fields(tile, FIELD_PX, REACH_M, roofs)
    xmin, ymin, xmax, ymax = tile.bounds
    res = (xmax - xmin) / FIELD_PX
    field = Field(
        (xmin - margin * res, ymin - margin * res, xmax + margin * res, ymax + margin * res),
        res,
    )
    water = water_field(tile, field, sources)
    steps = ray_steps(res)
    mirrored = 0
    for f in lamps:
        head = lamp_head(f, ground, field)
        if head is None:
            continue
        seen, level = seen_rays(head, ground, surface, water, field, steps)
        if not opening(seen):
            continue
        w = float(np.median(level[seen]))
        if not math.isfinite(w) or w >= head[2]:
            continue
        f["properties"]["w"] = round(w, 2)
        mirrored += 1
    for path, doc, _ in docs:
        _write(path, doc)
    print(f"{tile.id}: {mirrored} of {len(lamps)} lamps see the water")


def _write(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc))
