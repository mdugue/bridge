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

The level: the median DGM1 over WATER_RUN_M of each seeing ray's water past
its first cells (they climb the bank); the lamp's, its nearest water's —
the median of the rays within SAME_WATER_M of the nearest ray's level, so a
pond and the river beside it are not averaged. The viewer's water sheet
lies on the same ground.

The column's ends, `wr`: in each of SECTORS compass sectors (from north,
clockwise, each centred on its bearing), how far from the lamp (m, a
multiple of END_STEP_M) that water reaches along the sector's seeing rays —
to its far bank; a dry gap of up to GAP_M, a pier or a groyne, does not
end it; 0 where the lamp sees none of it. The viewer lays a lamp's column
toward the eye at the water's level only that far out, so the mirror of a
pond above the town does not float over the lower ground past its banks,
and an eye on the side where the lamp sees no water gets none.

The lamps' own files are rewritten (OSM's `lamps_`, Mapillary's lamps in
`mly_`), so this runs after lamp_heights.py, whose heights it reads."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .bridge import Wet
from .common import Tile
from .lamp_heights import LAMP_H
from .skyview import Field, Roofs, fields

REACH_M = 300.0  # how far a lamp's light is followed to the water
FIELD_PX = 1024  # the height field's cells over the tile (≈ 2 m)
AZIMUTHS = 64  # rays round a lamp, 5.6° apart
OPENING = 3  # neighbouring rays (11°) that must see the water
SAME_WATER_M = 1.0  # rays' levels this close are one water
NEAR_M = 3.0  # the field this close to the head is the lamp's own facade
CLEAR_M = 0.3  # an occluder must stand this far over the line
WATER_RUN_M = 12.0  # a ray's water read for the level, past its first cells
BANK_CELLS = 2  # a ray's first water cells, on the bank's slope
WATER_OUT_M = 40.0  # how far past its first water cell a ray's light may land
GAP_M = 6.0  # a dry stretch this short along a ray does not end its water
SECTORS = 8  # the compass sectors a lamp's water reach is kept for
END_STEP_M = 5.0  # a sector's reach is kept in these steps (the viewer
# packs SECTORS of them, 6 bits each, into two floats: at most 63 steps)


def water_field(tile: Tile, field: Field) -> np.ndarray:
    """Whether each cell of the field is water, by every committed class
    raster it touches (bridge.py `Wet`; False where none reaches)."""
    xs = field.xmin + (np.arange(field.cols) + 0.5) * field.res
    ys = field.ymax - (np.arange(field.rows) + 0.5) * field.res
    gx, gy = np.meshgrid(xs, ys)
    return Wet(tile)(gx, gy)


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
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """For each ray from the lamp's `head` (x, y, z): whether its light
    reaches water unblocked, that water's level, how far its first water
    cell is and how far its water runs (m; NaN where not)."""
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
    reach = np.full(AZIMUTHS, np.nan, np.float32)
    end = np.full(AZIMUTHS, np.nan, np.float32)
    gap = max(1, int(round(GAP_M / field.res)))
    run = max(1, int(round(WATER_RUN_M / field.res)))
    out = max(1, int(round(WATER_OUT_M / field.res)))
    for k in np.nonzero(hits)[0]:
        f = int(first[k])
        r, c = rows[k], cols[k]
        # the water's level: the median ground over its first stretch
        # past the bank's cells, which climb it; all of the stretch where
        # the water is narrower
        stretch = slice(f + BANK_CELLS, f + BANK_CELLS + run)
        if not wet[k, stretch].any():
            stretch = slice(f, f + run)
        w = float(np.median(ground[r[stretch], c[stretch]][wet[k, stretch]]))
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
                reach[k] = float(dist[f])
                end[k] = float(dist[water_end(wet[k], f, gap)])
                break
    return seen, level, reach, end


def water_end(wet: np.ndarray, first: int, gap: int) -> int:
    """A ray's last water sample of the water that starts at `first`: up
    to where `gap` samples in a row are dry, or the ray ends."""
    last, dry = first, 0
    for j in range(first + 1, len(wet)):
        if wet[j]:
            last, dry = j, 0
        else:
            dry += 1
            if dry >= gap:
                break
    return last


def in_openings(seen: np.ndarray) -> np.ndarray:
    """The rays that belong to a run of OPENING neighbouring rays (round
    the circle) seeing water: a lone ray through a gap belongs to none."""
    start = np.ones(len(seen), bool)
    for i in range(OPENING):
        start &= np.roll(seen, -i)
    out = np.zeros(len(seen), bool)
    for i in range(OPENING):
        out |= np.roll(start, i)
    return out


def opening(seen: np.ndarray) -> bool:
    """Whether OPENING neighbouring rays see water."""
    return bool(in_openings(seen).any())


def nearest_water(level: np.ndarray, reach: np.ndarray, rays: np.ndarray) -> np.ndarray:
    """Of a lamp's seeing `rays`, those on its nearest water: whose level
    lies within SAME_WATER_M of the nearest ray's, so a pond and the river
    beside it are not taken for one."""
    near = level[rays][np.argmin(reach[rays])]
    return rays & (np.abs(level - near) <= SAME_WATER_M)


def sector_ends(end: np.ndarray, rays: np.ndarray) -> list[int]:
    """Each sector's reach (m) of a lamp's water: the farthest end of its
    `rays` there, rounded up to END_STEP_M (0: none)."""
    per = AZIMUTHS // SECTORS
    reach = np.where(rays, np.nan_to_num(end), 0.0)
    # sector s is centred on ray s * per
    reach = np.roll(reach, per // 2).reshape(SECTORS, per).max(axis=1)
    steps = np.minimum(np.ceil(reach / END_STEP_M), 63)
    return [int(n * END_STEP_M) for n in steps]


def water_level(level: np.ndarray, reach: np.ndarray, rays: np.ndarray) -> float:
    """A lamp's water level from its seeing `rays`: the median of its
    nearest water's."""
    return float(np.median(level[nearest_water(level, reach, rays)]))


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
        f["properties"].pop("wr", None)
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
    water = water_field(tile, field)
    steps = ray_steps(res)
    mirrored = 0
    for f in lamps:
        head = lamp_head(f, ground, field)
        if head is None:
            continue
        seen, level, reach, end = seen_rays(head, ground, surface, water, field, steps)
        rays = in_openings(seen)
        if not rays.any():
            continue
        w = water_level(level, reach, rays)
        if not math.isfinite(w) or w >= head[2]:
            continue
        f["properties"]["w"] = round(w, 2)
        f["properties"]["wr"] = sector_ends(end, nearest_water(level, reach, rays))
        mirrored += 1
    for path, doc, _ in docs:
        _write(path, doc)
    print(f"{tile.id}: {mirrored} of {len(lamps)} lamps see the water")


def _write(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc))
