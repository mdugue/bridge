"""The dormers and chimneys on the LoD2 roofs, measured in the surface
model (DOM1): `data/<site>/dlm/dormers_<tile>.geojson`, which the building
bake (`scripts/bake-city-mesh.ts`) draws as part of the building they sit
on.

LoD2 draws a roof as its planes; the dormers and chimneys on it are not
there. The surface model sees them: the excess `DOM − LoD2 roof` rises by
a metre or two. Measured against the roof's own fit (the excess's median
over `FIT_M` around — a roof LoD2 drew a metre off is not a dormer, and a
roof it drew badly is skipped: `FIT_TOLERANCE_M`; a building it drew
off as a whole is first moved onto the surface model: `shifts`; a part
with steep faces it drew off in plan is read a second time moved onto
it, `plan_moves`, and what that reading adds is kept), every
blob of
`MIN_EXCESS_M` or more, at any size and however close to the next, not at
the roof's outline (one cell in) and clear of every mapped or measured
tree (canopy, cadastre, `TREE_CLEAR_M`), is read by where it stands
(`kind_of`):

- on a pitched roof (`MIN_SLOPE`–`MAX_SLOPE`; a mansard roof, LoD2's
  `roofType` 3400 or a lower face of that shape, `mansard_flanks`, up to
  `MANSARD_MAX_SLOPE`; the line of a ridge or a
  valley between two faces with them, `pitched_cells`) a dormer: its top
  `MIN_TOP_M`–`MAX_TOP_M` over the roof and under its object's ridge,
  compact (`MIN_FILL` of its box), at most `MAX_SIDE_M` down the slope and
  as wide across it as it runs (a row of dormers, one over the whole
  roof). Dormers side by side that the 1 m cells join are parted at their
  cores (`split`, `SPLIT_EXCESS_M`). Not along a seam of the LoD2 roof (a
  ridge, a hip, a valley or a step it drew half a metre off reads as a
  band of excess along it: `seams`, `SEAM_SHARE`); on Dresden's
  33410_5656 a third of the dormers the bake drew until 2026-10-31 were
  such bands in the valleys of hipped roofs;
- a chimney: a blob of at most `CHIMNEY_CELLS` that reaches within
  `CHIMNEY_RIDGE_M` of its object's ridge (a stack leaves the roof by the
  ridge; one as small lower down is a small dormer), one of up to
  `CHIMNEY_STACK_CELLS` over the ridge, or a small one on a flat roof
  clear of its outline and its seams — its top `CHIMNEY_MIN_LIFT_M`–
  `CHIMNEY_MAX_LIFT_M` over the roof (`SEAM_LIFT_M` on a seam), not one
  of a crowd on a flat roof (`uncrowded`: masts along a platform roof, a
  plant room's ducts; on a pitched roof every stack stays).

The dormers then stand in rows (`in_rows`): one building's falling the
same way at one depth, set straight at the row's median depth, in one
shape (`unify`), and each stretch of it (`stretches`) on one grid
(`grid`): over the window axes of the wall below where the street photos
measured them (dlm/windows_<tile>.json, `wall_axes`), else the spacing
its dormers agree on best, every dormer on its nearest slot (`snap`), at
one height on each LoD2 part (`level`). A row reads one dormer once
(`snap`, `overlapping`); a single empty slot between two takes one like
its neighbour (`holes`). The Taschenbergpalais' street photos show one
identical dormer over each window axis, where DOM1 had read their
centres up to 3 m apart down the slope and 1–4 m wide, and the roof's
1 m cells read a mansard's face ±1.4 m up and down. Last, each stands on
its host's exact LoD2 roof face (`on_planes`): the burned 1 m roof reads
a cell's height, which on a 45° face is up to half a metre off the face
under a dormer's centre — one dormer in fourteen stood over 0.3 m above
the roof the building draws, its cheeks clear of it, as many sunk in.
On a roof rebuilt from DOM1 (roofs.py) the face is its rebuilt part
(`MeasuredPart`): the building draws those, not the LoD2 faces.

A crown overhanging a roof is irregular, overtops the ridge or stands on
a tree point. Checked against the 20 cm orthophoto on Dresden's
33410_5656 (2026-10-31): 996 dormers (654 before, a third of them
valleys), rows of small gabled dormers now in, 1 952 chimneys at ridges
and on flat roofs; DOM1's 1 m cells still miss the smallest dormers, and
a roof LoD2 drew flat over a pitched one is no dormer's.

Each dormer is a point (the blob's centre) with the downslope direction
(`ax`, `ay`, from the roof's gradient around it), its width across the
slope and depth along it (`w`, `d`, from the blob's extent), the roof's
height at the centre (`z`), the dormer's top (`top`, the 80th percentile
of the measured surface over the blob) and the roof's slope (`slope`,
degrees); `of` is the LoD2 object whose footprint holds it. A chimney is
the same record with `k: "chimney"`: its box `w` × `d` (`CHIMNEY_SIDE_M`
a cell, at most `CHIMNEY_MAX_SIDE_M`) along the roof's fall or, on a
level roof, its footprint's longer side, and its top the highest measured
point. Only the tile's own (the west and south edges in). A site without
a surface model writes an empty file.

A shed dormer (Schleppgaube) carries `tf`, its roof's fall in degrees:
the surface model along the dormer's axis through its centre, from its
back — on behind the blob while the surface stays `FALL_EXCESS_M` over
the roof: a shed's back sinks into the roof below the blob's threshold —
to `FALL_FRONT_M` behind its front edge (a cell over the front wall or a
cheek reads the roof below and would tilt every dormer forward), over at
least `FALL_MIN_SPAN_M`, fitted by a line (`roof_fall`). Where it
falls the way the roof does by `SHED_MIN_FALL` or more and by at least
`SHED_MARGIN` less than the roof (steeper is the roof itself, a LoD2
face drawn too low), the dormer is a shed one: its `top` is then where
its roof meets the main roof (its highest line) and the build lets the
roof fall `tf` from there to its front (lib/city/dormers.ts). Every other
dormer is drawn flat at `top`. Meißen's street photos show gabled and
shed dormers where the bake drew every one flat; a gabled or hipped one
fits a fall near 0 along its axis and stays flat. Measured (2026-10-21):
8–25 % of a tile's dormers are shed ones (Meißen 16 %, München 21 %,
Hamburg 9 %); about half of all dormers are too shallow along the slope
to read a fall from 1 m cells and stay flat."""

from __future__ import annotations

import copy
import json
import math

import numpy as np
import shapely
import shapely.affinity
from rasterio.features import rasterize
from scipy import ndimage as ndi
from scipy.ndimage import map_coordinates

from .common import Tile, feature, owns, write_geojson
from .osm_buildings import _lod2, footprints, root_of
from .roof_colour import ring_normal, ring_slope, surface_rings
from .skyview import surface_heights
from .structures import Surfaces

MIN_SLOPE = 25.0
MAX_SLOPE = 62.0
# A mansard roof's lower face is steeper: its dormers stand on it up to
# this slope (degrees). LoD2 may name the roof's form (`roofType`), but
# Saxony's never does (its mansards are "9999", other), so the lower faces
# are read from the LoD2 roof faces too (`mansard_flanks`): a face steeper
# than MAX_SLOPE whose top edge an upper roof face (MAX_SLOPE or less)
# goes on from — within MANSARD_BREAK_M in height and in plan —, where
# such faces make MANSARD_SHARE and MANSARD_MIN_AREA_M2 of the building's
# roof. A spire's faces meet at its tip, a step between two parts is a
# wall, a steep annex under a tall flat roof touches nothing at its top.
# Only those faces take the steeper cap and lose their seams (`seams`): on
# the burned 1 m roof a step between two parts reads as a steep band (a
# first, raster reading drew a dormer every metre along such edges in
# München).
MANSARD_MAX_SLOPE = 80.0
MANSARD = "3400"
MANSARD_SHARE = 0.15
MANSARD_BREAK_M = 0.5
MANSARD_MIN_AREA_M2 = 50.0
# A building LoD2 drew as a whole over the surface model (the
# Taschenbergpalais 1.2 m over it, its flat roofs too) has the surface
# model raised onto it before the fit (`shifts`): by the median of LoD2 roof − DOM over its
# cells up to MAX_SLOPE (a steep face's cells scatter by the metre), where
# at least SHIFT_MIN_CELLS of them spread by at most SHIFT_SPREAD_M (their
# median deviation) round it and it is FIT_TOLERANCE_M–SHIFT_MAX_M. Only
# down: a surface over the roof may be the roof's own dormers, eaves and
# plant (raising those lost München 99 dormers on one tile, 2026-11-02).
# A roof that is off in one place only still fails the fit; one within
# the fit is read as it is (moving those too lost more dormers than it
# found: Meißen 1 803 → 1 704).
SHIFT_MAX_M = 3.0
SHIFT_SPREAD_M = 0.3
SHIFT_MIN_CELLS = 30
# the roof's fit: the median excess over this window (m) and how far off it
# may be before the roof is not trusted
FIT_M = 9
FIT_TOLERANCE_M = 0.4
# A pitched part with steep (over MAX_SLOPE) faces LoD2 drew off in plan
# (`plan_moves`; only those: a mansard's lower faces are where a metre
# off loses the dormers, and a plain roof's fit hardly tells a metre
# along its ridge): moved by up to
# PLAN_MAX_M (every PLAN_STEP_M, then a quarter of it round the best)
# where that brings its cells' spread round their median deviation from
# the surface model (MAD) to PLAN_GAIN of what it was, PLAN_MIN_GAIN_M
# less at least, over its steep faces too; a part of PLAN_MIN_CELLS,
# PLAN_PITCHED of them pitched.
# The Taschenbergpalais' north wing: 0.5 m east and 0.25 m north, MAD
# 0.51 → 0.16 m; its north face's dormers lay outside LoD2's lower roof.
PLAN_MAX_M = 1.0
PLAN_STEP_M = 0.5
PLAN_GAIN = 0.7
PLAN_MIN_GAIN_M = 0.08
PLAN_MIN_CELLS = 40
PLAN_PITCHED = 0.3
# A roof face is a plane up to PLANE_REACH_M past its outline (a dormer's
# centre on the eave's edge), one facing up at least PLANE_MIN_UP (its
# normal's height) a roof's.
PLANE_REACH_M = 0.3
PLANE_MIN_UP = 0.05
MIN_EXCESS_M = 0.7
# A blob deeper than this along the slope is the roof drawn low, not a
# dormer (m); across the slope a row of dormers runs as wide as it is.
MAX_SIDE_M = 8
MIN_FILL = 0.4
# Dormers side by side read as one blob at MIN_EXCESS_M where the gap
# between them is a cell or two: each core over SPLIT_EXCESS_M of at least
# MIN_CORE_CELLS is a dormer of its own, the blob's cells shared out to the
# nearest core.
SPLIT_EXCESS_M = 1.2
MIN_CORE_CELLS = 2
# A chimney (a stack, a vent): a blob of at most CHIMNEY_CELLS cells that
# reaches within CHIMNEY_RIDGE_M of its object's ridge (a stack leaves the
# roof by the ridge; one as small lower down the slope is a small dormer)
# or stands on a flat roof clear of its edge and its seams, or a blob of up
# to CHIMNEY_STACK_CELLS that overtops the ridge; its top
# CHIMNEY_MIN_LIFT_M–CHIMNEY_MAX_LIFT_M over the roof (m), drawn
# CHIMNEY_SIDE_M across a cell (DOM1's 1 m cell spreads a 0.6 m stack over
# it) and at most CHIMNEY_MAX_SIDE_M.
CHIMNEY_CELLS = 2
CHIMNEY_RIDGE_M = 0.5
# A chimney on a flat roof with CHIMNEY_CROWD others within
# CHIMNEY_CROWD_M (m) is in a row of something else (`uncrowded`); a pair
# of stacks stays, and every one on a pitched roof.
CHIMNEY_CROWD = 2
CHIMNEY_CROWD_M = 4.0
CHIMNEY_STACK_CELLS = 4
CHIMNEY_MIN_LIFT_M = 0.8
CHIMNEY_MAX_LIFT_M = 5.0
CHIMNEY_SIDE_M = 0.6
CHIMNEY_MAX_SIDE_M = 1.6
# how far a chimney may reach over the object's highest roof cell (m)
CHIMNEY_OVER_RIDGE_M = 3.0
# a roof under this slope (degrees) has no way down: a chimney on it stands
# along its footprint's longer side
LEVEL_DEG = 5.0
# A roof's seam — a ridge, a hip, a valley, a step between two parts —
# where the LoD2 roof bends by more than SEAM_BEND_M over three cells (m):
# a ridge LoD2 drew half a metre low reads as a band of excess along it. A
# blob with SEAM_SHARE of its cells within a cell of a seam is no dormer;
# a chimney on one stands SEAM_LIFT_M over the roof at least.
SEAM_BEND_M = 0.8
SEAM_SHARE = 0.5
SEAM_REACH = 1
SEAM_LIFT_M = 1.2
MIN_TOP_M = 0.9
MAX_TOP_M = 3.5
# how far a dormer stays from a tree point (m)
TREE_CLEAR_M = 2.0
# how far its top may reach over the object's highest roof cell (m)
RIDGE_SLACK_M = 0.2
# A dormer's roof is read along its axis every FALL_STEP_M, up to this far
# behind its front edge (m: the 1 m cells by the front wall read the roof
# below), over at least FALL_MIN_SPAN_M: a shallower one has no fall to
# read and is drawn flat. A plane over the whole blob read 45 % of
# Meißen's dormers as shed: its cells over the front wall and the cheeks
# tilt every dormer forward.
FALL_STEP_M = 0.5
FALL_FRONT_M = 1.5
FALL_MIN_SPAN_M = 1.0
# ... and on behind it up to FALL_BACK_M while the surface stays this far
# over the roof (m)
FALL_BACK_M = 3.0
FALL_EXCESS_M = 0.3
# A shed dormer's roof falls the way the roof does by at least this much
# (degrees) and at least SHED_MARGIN less than the roof.
SHED_MIN_FALL = 8.0
SHED_MARGIN = 8.0

# A row of dormers (`rows`): one building's dormers falling the same way
# within ROW_TURN_DEG, at most ROW_DEPTH_M apart down the slope and
# ROW_GAP_M across it from the next.
ROW_TURN_DEG = 20.0
ROW_DEPTH_M = 1.5
ROW_GAP_M = 12.0
# The grid a stretch of ROW_MIN or more dormers in a row stands on
# (`grid`): a spacing within RHYTHM_M (every RHYTHM_STEP_M) and
# RHYTHM_SHORT–RHYTHM_GAP of its median gap (about one dormer a slot: a
# dormer missed or two blobs of one are the exception), its slots one
# spacing apart; a row parts into stretches where two dormers stand more
# than GRID_BREAK times its median gap apart (`stretches`).
ROW_MIN = 3
RHYTHM_M = (1.8, 7.0)
RHYTHM_STEP_M = 0.02
# the measured window axes below are taken where the dormers' phases on
# them reach this mean resultant (`resultant`)
RHYTHM_WINDOWS = 0.8
RHYTHM_SHORT = 0.75
RHYTHM_GAP = 1.3
GRID_BREAK = 2.5
# … where the dormers stand, half of them, within GRID_LOOSE of the
# spacing of its slots (dormers at random: a quarter)
GRID_LOOSE = 0.22
# A dormer more than SNAP_SHARE of the spacing off its slot where a nearer
# one takes it is something else on the roof (a skylight, a stair head)
# and stays where it stands.
SNAP_SHARE = 0.35
# A dormer narrower than WEAK_SHARE of its stretch's median may be a
# fragment DOM1 read of one (a cell or two up the slope): it takes a slot
# last, and where none is left it is that one's.
WEAK_SHARE = 0.6
# Blobs closer than this across the row are one dormer's two halves.
MERGE_M = 0.5
# A stretch with no grid is set straight in one shape only where its dormers'
# widths lie within ALIKE of each other; in a run one wider than WIDE
# times its stretch's median (a Zwerchhaus; two dormers DOM1 reads as one blob
# are narrower) stays as it was.
ALIKE = 1.5
WIDE = 2.5
# A dormer is at most WIDTH_SHARE of its grid's spacing wide; one whose box
# overlaps a longer row's dormer by OVERLAP_SHARE of its width is that one.
# (down the slope within their mean depth and OVERLAP_DOWN_M).
OVERLAP_SHARE = 0.2
OVERLAP_DOWN_M = 0.5
WIDTH_SHARE = 0.8
# A row up to WALL_REACH_M behind a wall whose window axes the street
# photos measured (dlm/windows_<tile>.json) stands over those axes, every
# one, every second or every third (`AXES_EVERY`), where its dormers fit
# them (RHYTHM_WINDOWS).
WALL_REACH_M = 12.0
AXES_EVERY = (1, 2, 3)


def drawn_slope(roof: np.ndarray, res: float) -> np.ndarray:
    """The roof's slope per cell (degrees)."""
    gx, gy = roof_gradient(np.where(np.isfinite(roof), roof, np.nan), res)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def roof_gradient(roof: np.ndarray, res: float) -> tuple[np.ndarray, np.ndarray]:
    """The roof's downhill direction in EPSG axes (dz/dx, dz/dy per metre):
    rows run south, so the row gradient is −dz/dy."""
    gr, gc = np.gradient(roof, res)
    return gc, -gr


def tree_points(tile: Tile) -> np.ndarray:
    """Every canopy, laser-scan and cadastre tree point the tile's bakes
    wrote, as (x, y)."""
    pts: list[tuple[float, float]] = []
    for name in ("canopy", "canopyx", "trees", "lowveg"):
        path = tile.data / "dlm" / f"{name}_{tile.id}.geojson"
        if not path.exists():
            continue
        for f in json.loads(path.read_text()).get("features", []):
            g = f.get("geometry") or {}
            if g.get("type") == "Point":
                pts.append(tuple(g["coordinates"][:2]))
    return np.asarray(pts, dtype=float).reshape(-1, 2)


def roof_forms(city: dict, ids: list[str]) -> list[str | None]:
    """Each object's LoD2 roof form (`roofType`: "3100" a gabled roof,
    "3400" a mansard …), its own or else its parent's."""
    objs = city.get("CityObjects", {})

    def form(oid: str | None) -> str | None:
        seen = set()
        while oid is not None and oid not in seen:
            seen.add(oid)
            obj = objs.get(oid, {})
            value = (obj.get("attributes") or {}).get("roofType")
            if value is not None:
                return str(value)
            oid = (obj.get("parents") or [None])[0]
        return None

    return [form(oid) for oid in ids]


def building_groups(city: dict, ids: list[str]) -> list[int]:
    """Each object's building, numbered from 1: the root of its tree."""
    numbers: dict[str, int] = {}
    return [numbers.setdefault(root_of(city, oid), len(numbers) + 1) for oid in ids]


def slope_cap(s: Surfaces, polys: list[shapely.Geometry], forms: list[str | None]) -> np.ndarray:
    """Per cell the steepest roof a dormer stands on: MAX_SLOPE, on a
    mansard roof MANSARD_MAX_SLOPE."""
    cap = np.full(s.roof.shape, MAX_SLOPE)
    for poly, form in zip(polys, forms, strict=True):
        win = s.window(poly, 0) if form == MANSARD else None
        if win is not None:
            cap[win][s.mask(poly, win)] = MANSARD_MAX_SLOPE
    return cap


def moved_flanks(
    flanks: list[shapely.Geometry], polys: list[shapely.Geometry], moves: np.ndarray
) -> list[shapely.Geometry]:
    """The mansards' lower faces moved with the part (`polys`, already
    moved) that holds most of each (`plan_moves`)."""
    if not moves.any() or not flanks:
        return flanks
    tree = shapely.STRtree(polys)
    out = []
    for fl in flanks:
        share = {int(k): polys[int(k)].intersection(fl).area for k in tree.query(fl)}
        k = max(share, key=lambda k: share[k], default=None)
        moved = k is not None and share[k] > 0 and moves[k].any()
        out.append(shapely.affinity.translate(fl, *moves[k]) if moved else fl)
    return out


def flank_cells(s: Surfaces, flanks: list[shapely.Geometry]) -> np.ndarray:
    """The cells a mansard's steep lower face covers (`mansard_flanks`)."""
    shapes = [(f, 1) for f in flanks if not f.is_empty]
    if not shapes:
        return np.zeros(s.roof.shape, bool)
    return rasterize(
        shapes, out_shape=s.roof.shape, transform=s.field.transform, fill=0, dtype=np.uint8
    ).astype(bool)


def _moved(a: np.ndarray, dx: float, dy: float, order: int, res: float) -> np.ndarray:
    """A raster window of `res` m cells moved dx east and dy north (m)."""
    return ndi.shift(a, (-dy / res, dx / res), order=order, mode="nearest", prefilter=False)


def _misfit(
    dom: np.ndarray,
    roof: np.ndarray,
    mask: np.ndarray,
    steep: np.ndarray,
    move: tuple[float, float, float],
) -> tuple[float, float]:
    """The spread (MAD) of `dom` − `roof` over `mask`, the roof and its
    mask moved by `move` (dx, dy, the cell size): over all its cells, and over its `steep` ones
    (0 where it has too few)."""
    m = (_moved(mask.astype(float), *move[:2], 0, move[2]) > 0.5) & np.isfinite(dom)
    d = dom - _moved(roof, *move[:2], 1, move[2])
    st = m & (_moved(steep.astype(float), *move[:2], 0, move[2]) > 0.5)
    if m.sum() < PLAN_MIN_CELLS:
        return math.inf, math.inf

    def mad(v: np.ndarray) -> float:
        return float(np.median(np.abs(v - np.median(v)))) if len(v) >= 8 else 0.0

    return mad(d[m]), mad(d[st])


def plan_offset(
    dom: np.ndarray, roof: np.ndarray, mask: np.ndarray, steep: np.ndarray, res: float = 1.0
) -> tuple[float, float]:
    """How far a part's roof (`roof` over `mask`, a window) lies off the
    surface model in plan (east, north; m), (0, 0) where moving it does
    not fit it clearly better (PLAN_GAIN, PLAN_MIN_GAIN_M), over its
    `steep` faces (a mansard's lower ones) as well, or where it has none
    to tell (a plain roof's fit hardly sees a move along its ridge; the
    best move is kept within PLAN_MAX_M): LoD2 may draw a part's
    upper roof and its lower faces off each other, and moving it then
    loses the lower faces' dormers."""
    filled = np.where(mask, roof, np.nan)
    if np.isnan(filled).all():
        return 0.0, 0.0
    near = ndi.distance_transform_edt(np.isnan(filled), return_distances=False, return_indices=True)
    filled = filled[tuple(near)]
    base, base_steep = _misfit(dom, filled, mask, steep, (0.0, 0.0, res))
    if base_steep == 0.0:
        return 0.0, 0.0

    def tried(dx: float, dy: float) -> tuple[float, float, float, float, float]:
        # ties (a roof along its ridge) go to the shortest move
        mad, mad_steep = _misfit(dom, filled, mask, steep, (dx, dy, res))
        return round(mad, 3), math.hypot(dx, dy), mad_steep, dx, dy

    steps = np.arange(-PLAN_MAX_M, PLAN_MAX_M + 1e-9, PLAN_STEP_M)
    best = min(tried(dx, dy) for dx in steps for dy in steps)
    q = PLAN_STEP_M / 2
    bx, by = best[3], best[4]
    near_best = [(bx + i * q, by + j * q) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    best = min(tried(x, y) for x, y in near_best if max(abs(x), abs(y)) <= PLAN_MAX_M + 1e-9)
    mad, _, mad_steep, dx, dy = best
    if mad > PLAN_GAIN * base or base - mad < PLAN_MIN_GAIN_M:
        return 0.0, 0.0
    if mad_steep > PLAN_GAIN * base_steep:
        return 0.0, 0.0
    return float(dx), float(dy)


def plan_moves(s: Surfaces, polys: list[shapely.Geometry]) -> np.ndarray:
    """Each pitched part's move in plan onto the surface model (east,
    north; m), (0, 0) for most (`plan_offset`)."""
    gx, gy = roof_gradient(s.roof, s.field.res)
    slope = np.nan_to_num(np.degrees(np.arctan(np.hypot(gx, gy))))
    parts = building_labels(s, polys, list(range(1, len(polys) + 1)))
    moves = np.zeros((len(polys), 2))
    for k in range(len(polys)):
        win = s.window(polys[k], 3.0)
        if win is None:
            continue
        mask = (parts[win] == k + 1) & np.isfinite(s.roof[win])
        if mask.sum() < PLAN_MIN_CELLS or (slope[win][mask] >= MIN_SLOPE).mean() < PLAN_PITCHED:
            continue
        steep = (slope[win] > MAX_SLOPE) & mask
        moves[k] = plan_offset(s.dom[win], s.roof[win], mask, steep, s.field.res)
    return moves


def _moved_parts(s: Surfaces, polys: list[shapely.Geometry], moves: np.ndarray):
    """Each moved part (`plan_moves`): its index, window, cells (its
    footprint's, its eaves within two cells) and the cells it moves to."""
    parts = building_labels(s, polys, list(range(1, len(polys) + 1)))
    for k in np.nonzero(moves.any(axis=1))[0]:
        win = s.window(polys[k], 3.0)
        if win is None:
            continue
        mask = (parts[win] == k + 1) & np.isfinite(s.roof[win])
        to = _moved(mask.astype(float), *moves[k], 0, s.field.res) > 0.5
        yield int(k), win, mask, to


def moved_roof(s: Surfaces, polys: list[shapely.Geometry], moves: np.ndarray) -> np.ndarray:
    """The LoD2 roof with each part moved by `moves` (`plan_moves`): every
    moved part's cells cleared, then its roof written where it moved to
    (the higher where two meet)."""
    if not moves.any():
        return s.roof
    moved = list(_moved_parts(s, polys, moves))
    roof = s.roof.copy()
    for _, win, mask, _ in moved:
        roof[win][mask] = np.nan
    for k, win, mask, to in moved:
        filled = np.where(mask, s.roof[win], np.nan)
        near = ndi.distance_transform_edt(
            np.isnan(filled), return_distances=False, return_indices=True
        )
        shifted = _moved(filled[tuple(near)], *moves[k], 1, s.field.res)
        sub = roof[win]
        sub[to] = np.fmax(np.nan_to_num(sub[to], nan=-np.inf), shifted[to])
    return roof


def moved_seams(
    s: Surfaces, polys: list[shapely.Geometry], moves: np.ndarray, seam: np.ndarray
) -> np.ndarray:
    """LoD2's seams (`seams`, read on the roof as drawn: a moved part's
    step against its neighbours is none) with each moved part's moved
    along (`moved_roof`); `s` holds the drawn roof."""
    if not moves.any():
        return seam
    moved = list(_moved_parts(s, polys, moves))
    out = seam.copy()
    for _, win, mask, _ in moved:
        out[win][mask] = False
    for k, win, mask, to in moved:
        shifted = _moved((seam[win] & mask).astype(float), *moves[k], 0, s.field.res) > 0.5
        out[win][to] |= shifted[to]
    return out


def building_labels(s: Surfaces, polys: list[shapely.Geometry], groups: list[int]) -> np.ndarray:
    """Per cell the building (`groups`: each footprint's, from 1) whose
    footprint covers it — a building's parts share its label — and the
    roof's cells past the footprints (the eaves) the nearest one's within
    two cells; 0 elsewhere."""
    shapes = [(p, g) for p, g in zip(polys, groups, strict=True) if not p.is_empty]
    if not shapes:
        return np.zeros(s.roof.shape, np.int32)
    labels = rasterize(
        shapes, out_shape=s.roof.shape, transform=s.field.transform, fill=0, dtype=np.int32
    )
    eaves = (labels == 0) & np.isfinite(s.roof)
    if eaves.any():
        dist, (ir, ic) = ndi.distance_transform_edt(labels == 0, return_indices=True)
        near = eaves & (dist <= 2)
        labels[near] = labels[ir[near], ic[near]]
    return labels


def shifts(dom: np.ndarray, roof: np.ndarray, slope: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """Per building label (index 0 unused) how far LoD2 drew it over the
    surface model (m), 0 where it did not, where its cells spread too
    widely or too few were measured (see SHIFT_MAX_M)."""
    n = int(labels.max())
    out = np.zeros(n + 1)
    if n == 0:
        return out
    d = dom - roof
    use = (labels > 0) & np.isfinite(d) & (np.nan_to_num(slope, nan=90.0) <= MAX_SLOPE)
    lab, d = labels[use], d[use]
    if not len(d):
        return out
    index = np.arange(1, n + 1)
    count = np.bincount(lab, minlength=n + 1)
    med = np.zeros(n + 1)
    med[1:] = np.nan_to_num(ndi.median(d, lab, index))
    spread = np.zeros(n + 1)
    spread[1:] = np.nan_to_num(ndi.median(np.abs(d - med[lab]), lab, index), nan=np.inf)
    ok = (count >= SHIFT_MIN_CELLS) & (spread <= SHIFT_SPREAD_M)
    ok &= (-med >= FIT_TOLERANCE_M) & (-med <= SHIFT_MAX_M)
    out[ok] = -med[ok]
    out[0] = 0.0
    return out


def metres(city: dict):
    """A CityJSON vertex index → its (x, y, z) in metres (EPSG)."""
    scale = city.get("transform", {}).get("scale", [1, 1, 1])
    translate = city.get("transform", {}).get("translate", [0, 0, 0])
    vertices = city["vertices"]

    def to_metres(i: int) -> tuple[float, float, float]:
        v = vertices[i]
        return tuple(float(v[k]) * scale[k] + translate[k] for k in range(3))

    return to_metres


def roof_faces(city: dict, oid: str) -> list[tuple[float, float, float, float, shapely.Geometry]]:
    """(area m², slope degrees, lowest and highest height, plan) of each of
    the object's LoD2 roof faces."""
    obj = city["CityObjects"].get(oid, {})
    to_metres = metres(city)
    out = []
    for geometry in _lod2(obj.get("geometry", [])):
        for ring in surface_rings(geometry, "RoofSurface"):
            if len(ring) < 3:
                continue
            p = np.asarray([to_metres(i) for i in ring])
            plan = shapely.make_valid(shapely.Polygon(p[:, :2]))
            slope = ring_slope(ring, to_metres)
            area = plan.area / max(math.cos(math.radians(slope)), 1e-6)
            if plan.area > 0:
                out.append((area, slope, float(p[:, 2].min()), float(p[:, 2].max()), plan))
    return out


class MeasuredPart:
    """One part of a roof rebuilt from DOM1 (roofs.py): its plan, and its
    height — flat at `z`, or a face's surface grid (cell centres)."""

    def __init__(self, plan: shapely.Geometry, z: float, surface: dict | None):
        self.plan = plan
        self.z = z
        self.grid = None
        if surface is not None:
            self.grid, self.xs, self.ys = surface_heights(surface, z)
            self.x0, self.y0, self.res = surface["x"], surface["y"], surface["res"]

    def at(self, x: float, y: float) -> tuple[float, float]:
        """The part's height at (x, y) and its slope there (degrees): a
        face's grid read between its cells, its slope over the cells
        either side."""
        if self.grid is None:
            return self.z, 0.0
        g = self.grid
        fr = (self.y0 - y) / self.res - 0.5
        fc = (x - self.x0) / self.res - 0.5
        z = float(map_coordinates(g, [[fr], [fc]], order=1, mode="nearest")[0])
        r = int(np.clip(round(fr), 1, g.shape[0] - 2)) if g.shape[0] > 2 else 0
        c = int(np.clip(round(fc), 1, g.shape[1] - 2)) if g.shape[1] > 2 else 0
        sx = (g[r, min(c + 1, g.shape[1] - 1)] - g[r, max(c - 1, 0)]) / (2 * self.res)
        sy = (g[min(r + 1, g.shape[0] - 1), c] - g[max(r - 1, 0), c]) / (2 * self.res)
        return z, math.degrees(math.atan(math.hypot(sx, sy)))

    def top(self) -> float:
        """Its highest point inside its plan."""
        if self.grid is None:
            return self.z
        xs, ys = np.meshgrid(self.xs, self.ys)
        inside = shapely.contains_xy(self.plan, xs, ys)
        return float(self.grid[inside].max()) if inside.any() else self.z


def measured_parts(tile: Tile) -> dict[str, list[MeasuredPart]]:
    """The roofs rebuilt from DOM1 on this tile (dlm/roofs_<tile>.geojson,
    the `roofs` step's), by LoD2 object; none where it is not there."""
    path = tile.data / "dlm" / f"roofs_{tile.id}.geojson"
    out: dict[str, list[MeasuredPart]] = {}
    if not path.exists():
        return out
    for f in json.loads(path.read_text()).get("features", []):
        prop = f["properties"]
        part = MeasuredPart(shapely.geometry.shape(f["geometry"]), prop["z"], prop.get("surface"))
        out.setdefault(prop["id"], []).append(part)
    return out


class RoofPlanes:
    """Each object's LoD2 roof faces as planes: the roof's height and slope
    at a point exactly, where the burned 1 m roof reads a cell's (a
    dormer on a 45° face half a cell off sat half a metre high). An object
    whose roof was rebuilt from DOM1 (`measured`) is read on its rebuilt
    parts instead: the building draws them, not the LoD2 faces (a chimney
    stood at the LoD2 roof's height, metres off the drawn one)."""

    def __init__(
        self, city: dict, ids: list[str], measured: dict[str, list[MeasuredPart]] | None = None
    ):
        to_metres = metres(city)
        self.faces: list[list[tuple[shapely.Geometry, tuple, tuple]]] = []
        self.parts: list[list[MeasuredPart]] = []
        # each object's ridge: its roof faces' highest vertex
        self.ridge: list[float] = []
        for oid in ids:
            parts = (measured or {}).get(oid, [])
            self.parts.append(parts)
            if parts:
                self.faces.append([])
                self.ridge.append(max(p.top() for p in parts))
                continue
            faces = []
            ridge = -math.inf
            for geometry in _lod2(city["CityObjects"].get(oid, {}).get("geometry", [])):
                for ring in surface_rings(geometry, "RoofSurface"):
                    if len(ring) < 3:
                        continue
                    n = ring_normal(ring, to_metres)
                    if n[2] < PLANE_MIN_UP:
                        continue
                    pts = [to_metres(i) for i in ring]
                    plan = shapely.make_valid(shapely.Polygon([q[:2] for q in pts]))
                    if plan.area > 0:
                        faces.append((plan, n, pts[0]))
                        ridge = max(ridge, max(q[2] for q in pts))
            self.faces.append(faces)
            self.ridge.append(ridge)

    def at(self, of: int, x: float, y: float) -> tuple[float, float] | None:
        """The roof face of object `of` at (x, y): its height there and its
        slope (degrees); None where none is. The highest of the faces over
        the point (one drawn over another), else the nearest within
        PLANE_REACH_M of its outline — never the highest of those: past a
        ridge, a hip or a mansard's break the neighbour's plane runs on
        above the face the point is beside."""
        p = shapely.Point(x, y)
        if of < len(self.parts) and self.parts[of]:
            return self._measured_at(of, p)
        over = None
        near = None
        for plan, n, p0 in self.faces[of] if of < len(self.faces) else []:
            gap = plan.distance(p)
            if gap > PLANE_REACH_M:
                continue
            z = p0[2] - (n[0] * (x - p0[0]) + n[1] * (y - p0[1])) / n[2]
            face = (z, math.degrees(math.acos(min(1.0, n[2]))))
            if gap <= 1e-6:
                if over is None or z > over[0]:
                    over = face
            elif near is None or gap < near[0]:
                near = (gap, face)
        if over is not None:
            return over
        return near[1] if near is not None else None

    def _measured_at(self, of: int, p: shapely.Point) -> tuple[float, float] | None:
        """A rebuilt roof at `p`: the highest part over it, else the nearest
        within PLANE_REACH_M of its outline."""
        over = [q.at(p.x, p.y) for q in self.parts[of] if q.plan.covers(p)]
        if over:
            return max(over)
        gaps = [(q.plan.distance(p), q) for q in self.parts[of]]
        gap, q = min(gaps, key=lambda g: g[0])
        return q.at(p.x, p.y) if gap <= PLANE_REACH_M else None


def on_planes(found: list[dict], planes: RoofPlanes) -> None:
    """Each dormer and chimney at its host's exact roof (`RoofPlanes`):
    its `z` there; a dormer's slope there too, its top the same height
    over it (its row's one height over the roof: read against the roof,
    it moves with it) but at most RIDGE_SLACK_M over the ridge, and a
    shed's fall at most SHED_MARGIN under the slope. A chimney's top is
    the surface model's own height and stays. A dormer whose face there is
    flatter than MIN_SLOPE (beside a step onto a flat part) keeps its
    row's height and slope."""
    for d in found:
        e = planes.at(d["of"], d["x"], d["y"])
        if e is None:
            continue
        z, slope = e
        if d.get("k") == "chimney":
            d["z"] = round(z, 2)
            continue
        if slope < MIN_SLOPE:
            continue
        d["top"] = round(d["top"] + z - d["z"], 2)
        d["z"] = round(z, 2)
        ridge = planes.ridge[d["of"]] + RIDGE_SLACK_M
        d["top"] = round(max(min(d["top"], ridge), z), 2)
        d["slope"] = round(slope, 1)
        if "tf" in d:
            d["tf"] = round(min(d["tf"], slope - SHED_MARGIN), 1)


def mansard_flanks(city: dict) -> list[shapely.Geometry]:
    """The plans of the mansard roofs' steep lower faces (see
    MANSARD_SHARE), every building's."""
    faces: dict[str, list] = {}
    for oid in city["CityObjects"]:
        faces.setdefault(root_of(city, oid), []).extend(roof_faces(city, oid))
    out: list[shapely.Geometry] = []
    for fs in faces.values():
        upper = [f for f in fs if f[1] <= MAX_SLOPE]
        lower = [
            f
            for f in fs
            if MAX_SLOPE < f[1] <= MANSARD_MAX_SLOPE
            and any(
                abs(f[3] - u[2]) <= MANSARD_BREAK_M and f[4].distance(u[4]) <= MANSARD_BREAK_M
                for u in upper
            )
        ]
        area = sum(f[0] for f in lower)
        if lower and area >= max(MANSARD_MIN_AREA_M2, MANSARD_SHARE * sum(f[0] for f in fs)):
            out += [f[4] for f in lower]
    return out


def _shifted(a: np.ndarray, dr: int, dc: int) -> np.ndarray:
    """`a` moved by (dr, dc) cells, NaN where that runs off it."""
    rows, cols = a.shape
    out = np.full(a.shape, np.nan)
    out[max(dr, 0) : rows + min(dr, 0), max(dc, 0) : cols + min(dc, 0)] = a[
        max(-dr, 0) : rows + min(-dr, 0), max(-dc, 0) : cols + min(-dc, 0)
    ]
    return out


def seams(roof: np.ndarray, flank: np.ndarray | None = None) -> np.ndarray:
    """The cells within a cell of a seam of the LoD2 roof: where it bends by
    more than SEAM_BEND_M over three cells in a row (a ridge, a hip, a
    valley, a step between two parts), between roof cells only — its
    outline is no seam. Not by a mansard's steep lower face (`flank`): a
    dormer there rises to the break with the upper roof, a seam the face's
    few cells across all lie within a cell or two of."""
    crease = np.zeros(roof.shape, bool)
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        bend = np.abs(_shifted(roof, dr, dc) + _shifted(roof, -dr, -dc) - 2 * roof)
        crease |= np.nan_to_num(bend, nan=0.0) > SEAM_BEND_M
    out = ndi.binary_dilation(crease, iterations=SEAM_REACH) if SEAM_REACH else crease
    if flank is not None:
        out &= ~ndi.binary_dilation(flank, iterations=SEAM_REACH + 1)
    return out


def split(m: np.ndarray, ex: np.ndarray) -> list[np.ndarray]:
    """A blob's dormers: one per core over SPLIT_EXCESS_M of at least
    MIN_CORE_CELLS, the blob's cells shared out to the nearest core; the
    blob whole where it has fewer than two."""
    cores, n = ndi.label(m & (np.nan_to_num(ex) >= SPLIT_EXCESS_M))
    if n < 2:
        return [m]
    sizes = ndi.sum_labels(np.ones(m.shape), cores, index=np.arange(1, n + 1))
    keep = [k + 1 for k, size in enumerate(sizes) if size >= MIN_CORE_CELLS]
    if len(keep) < 2:
        return [m]
    seeds = np.isin(cores, keep)
    _, (ir, ic) = ndi.distance_transform_edt(~seeds, return_indices=True)
    nearest = cores[ir, ic]
    return [m & (nearest == k) for k in keep]


def pitched_cells(slope: np.ndarray) -> np.ndarray:
    """The cells of the pitched roofs: MIN_SLOPE or steeper, and the line
    of a cell or two between two such faces — a ridge or a valley, which
    the central differences of the gradient read as level, so a stack on
    the ridge stays one blob with the faces beside it."""
    steep = np.nan_to_num(slope) >= MIN_SLOPE
    return ndi.binary_closing(steep) | steep


def blobs(excess: np.ndarray, pitched: np.ndarray):
    """(slice, mask, on a pitched roof) of every blob of excess over
    MIN_EXCESS_M: on the pitched roofs split into its dormers (`split`), on
    the others whole."""
    over = np.nan_to_num(excess) >= MIN_EXCESS_M
    for on_slope in (True, False):
        labels, _ = ndi.label(over & (pitched == on_slope))
        for i, sl in enumerate(ndi.find_objects(labels), 1):
            if sl is None:
                continue
            m = labels[sl] == i
            for part in split(m, excess[sl]) if on_slope else [m]:
                yield sl, part, on_slope


def cells_xy(s: Surfaces, sl, m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The centres (EPSG) of a blob's cells."""
    f = s.field
    rr, cc = np.nonzero(m)
    return (
        f.xmin + (sl[1].start + cc + 0.5) * f.res,
        f.ymax - (sl[0].start + rr + 0.5) * f.res,
    )


def centre(s: Surfaces, sl, m: np.ndarray) -> tuple[float, float]:
    """A blob's centre (EPSG)."""
    xs, ys = cells_xy(s, sl, m)
    return float(xs.mean()), float(ys.mean())


def host_axis(poly: shapely.Geometry) -> tuple[float, float]:
    """The direction of a footprint's longer side (its least rotated
    rectangle's): how a chimney on a flat roof stands."""
    ring = list(poly.minimum_rotated_rectangle.exterior.coords)
    if len(ring) < 3:
        return 1.0, 0.0
    (x0, y0), (x1, y1), (x2, y2) = ring[0][:2], ring[1][:2], ring[2][:2]
    a, b = (x1 - x0, y1 - y0), (x2 - x1, y2 - y1)
    dx, dy = a if math.hypot(*a) >= math.hypot(*b) else b
    n = math.hypot(dx, dy)
    return (dx / n, dy / n) if n > 0 else (1.0, 0.0)


class Roofs:
    """What find() reads each blob against: the surfaces, the excess over
    the roof's fit, its gradient, slope and seams, and the footprints."""

    def __init__(
        self,
        tile: Tile,
        s: Surfaces,
        polys: list[shapely.Geometry],
        forms,
        groups: list[int],
        flanks: list[shapely.Geometry],
        moves: np.ndarray | None = None,
    ) -> None:
        """`moves` each part's move in plan (`plan_moves`), none where not
        given (LoD2 as drawn)."""
        f = s.field
        # the parts LoD2 drew off in plan moved onto the surface model: the
        # roof, the footprints, the mansards' faces read where it saw them
        # (a dormer's place is turned back into LoD2's at the end: `back`)
        drawn_s, drawn, drawn_polys = s, s.roof, polys
        s = copy.copy(s)
        self.moves = np.zeros((len(polys), 2)) if moves is None else moves
        s.roof = moved_roof(s, polys, self.moves)
        s.gap = s.dom - np.fmax(s.ground, s.roof)
        polys = [
            shapely.affinity.translate(p, *mv) if mv.any() else p
            for p, mv in zip(polys, self.moves, strict=True)
        ]
        drawn_steep = drawn_slope(drawn, f.res)
        drawn_flank = flank_cells(s, flanks) & (drawn_steep > MAX_SLOPE)
        drawn_flank &= drawn_steep <= MANSARD_MAX_SLOPE
        flanks = moved_flanks(flanks, polys, self.moves)
        under = np.isfinite(s.roof)
        self.gx, self.gy = roof_gradient(np.where(under, s.roof, np.nan), f.res)
        self.slope = np.degrees(np.arctan(np.hypot(self.gx, self.gy)))
        labels = building_labels(s, polys, groups)
        # the surface model raised onto each building LoD2 drew too high as
        # a whole: what the fit, the tops and the falls read
        lift = shifts(s.dom, s.roof, self.slope, labels)[labels]
        s.dom = s.dom + lift
        s.above = s.above + lift
        s.gap = s.gap + lift
        self.s = s
        inner = ndi.binary_erosion(under, iterations=1)
        raw = np.where(inner & np.isfinite(s.dom), s.dom - s.roof, np.nan)
        local = ndi.median_filter(np.nan_to_num(raw), size=FIT_M)
        on_flank = flank_cells(s, flanks)
        fits = inner & (np.abs(local) < FIT_TOLERANCE_M)
        cap = np.where(on_flank, MANSARD_MAX_SLOPE, slope_cap(s, polys, forms))
        fits &= self.slope <= cap
        self.excess = np.where(fits, raw - local, np.nan)
        # LoD2's own seams: a moved part's step against its neighbours is none
        self.seam = moved_seams(drawn_s, drawn_polys, self.moves, seams(drawn, drawn_flank))
        # the roof's outermost cell measured: its eaves, a parapet's foot
        self.edge = inner & ~ndi.binary_erosion(inner, iterations=1)
        self.polys = polys
        self.groups = groups
        self.ridges: dict[int, float] = {}
        self.hosts = shapely.STRtree(polys)
        trees = tree_points(tile)
        self.trees = shapely.STRtree(shapely.points(trees)) if len(trees) else None
        self.bounds = tile.bounds

    def back(self, d: dict) -> tuple[float, float]:
        """A dormer's place `d` in LoD2's frame: its host's plan move
        undone (`plan_moves`)."""
        dx, dy = self.moves[d["of"]]
        return d["x"] - dx, d["y"] - dy

    def host(self, x: float, y: float) -> int | None:
        """The footprint a blob at (x, y) sits on — the smallest that holds
        it —, or None: off the tile's own, near a tree, on no footprint."""
        p = shapely.Point(x, y)
        if self.trees is not None and len(self.trees.query(p.buffer(TREE_CLEAR_M))):
            return None
        hits = [int(k) for k in self.hosts.query(p, predicate="within")]
        if not hits:
            return None
        k = min(hits, key=lambda k: self.polys[k].area)
        # owned where it stands in LoD2's frame (`back`), as the first reading
        dx, dy = self.moves[k]
        return k if owns(self.bounds, x - dx, y - dy) else None

    def chimney_axis(self, sl, m: np.ndarray, of: int) -> tuple[float, float, float]:
        """How a chimney stands: down the roof round it, or on a roof under
        LEVEL_DEG along its footprint's longer side."""
        down = downslope(self.s, sl, m, self.gx, self.gy, self.slope)
        if down is not None and down[2] >= LEVEL_DEG:
            return down
        # level, or a ring whose falls cancel (a stack astride a ridge): how
        # steep the roof round it is, whichever way it falls
        pad, ring = ring_round(sl, m, self.slope.shape, self.slope)
        lean = float(np.median(self.slope[pad][ring])) if ring.any() else 0.0
        return (*host_axis(self.polys[of]), lean)

    def ridge(self, of: int) -> float:
        """The host's highest roof cell, read once per host."""
        if of not in self.ridges:
            self.ridges[of] = ridge(self.s, self.polys[of])
        return self.ridges[of]

    def place(self, x: float, y: float, d: dict) -> tuple[float, int, float] | None:
        """The roof under a dormer `d` moved to (x, y): its LoD2 height,
        its host and the host's ridge; None where that is off its
        building's roof or on none LoD2 drew there."""
        of = self.host(x, y)
        if of is None or self.groups[of] != self.groups[d["of"]]:
            return None
        z = lod2_at(self.s, x, y)
        return None if z is None else (z, of, self.ridge(of))

    def on_seam(self, sl, m: np.ndarray) -> bool:
        return float(self.seam[sl][m].mean()) >= SEAM_SHARE

    def read(self, sl, m: np.ndarray, pitched: bool, of: int) -> dict | None:
        """One blob on its host: a dormer, a chimney, or None."""
        s, ex = self.s, self.excess
        highest = self.ridge(of)
        seam = self.on_seam(sl, m)
        kind = kind_of(
            int(m.sum()),
            pitched,
            float(np.max(s.roof[sl][m] + ex[sl][m])),
            highest,
            seam,
            bool(self.edge[sl][m].any()),
        )
        if kind == "chimney":
            return chimney(s, sl, m, ex, self.chimney_axis(sl, m, of), seam, highest)
        d = dormer(s, sl, m, ex, self.gx, self.gy, self.slope) if kind == "dormer" else None
        if d is None or d["top"] > highest + RIDGE_SLACK_M:
            return None
        fall = roof_fall(s, sl, m, d, ex)
        shed = shed_top(d["z"], d["slope"], d["d"], fall)
        if fall is not None and shed is not None and shed <= highest + RIDGE_SLACK_M:
            d |= {"top": round(shed, 2), "tf": round(fall[0], 1)}
        return d


def kind_of(
    area: int, pitched: bool, peak: float, ridge_z: float, seam: bool, edge: bool
) -> str | None:
    """What a blob of `area` cells may be, its highest point `peak` and its
    object's ridge `ridge_z` (m): on a flat roof a chimney clear of the
    roof's edge and seams; on a pitched one a chimney where it is small and
    reaches the ridge, or a stack over it, else a dormer off the seams."""
    if not pitched:
        return "chimney" if area <= CHIMNEY_CELLS and not seam and not edge else None
    at_ridge = area <= CHIMNEY_CELLS and peak >= ridge_z - CHIMNEY_RIDGE_M
    stack = area <= CHIMNEY_STACK_CELLS and peak > ridge_z + RIDGE_SLACK_M
    if at_ridge or stack:
        return "chimney"
    return None if seam else "dormer"


def find(
    tile: Tile,
    s: Surfaces,
    ids: list[str],
    polys: list[shapely.Geometry],
    forms: list[str | None] | None = None,
    groups: list[int] | None = None,
    flanks: list[shapely.Geometry] | None = None,
    walls: dict[int, list[dict]] | None = None,
    planes: RoofPlanes | None = None,
) -> list[dict]:
    """Every dormer and chimney the surface model shows on the tile's own
    roofs (see the module), the dormers set in rows (`in_rows`); `forms`
    each object's roof form (`roof_forms`), `groups` its building
    (`building_groups`; each its own where not given), `flanks` the
    mansards' lower faces (`mansard_flanks`), `walls` the walls with
    measured window axes per building (`measured_walls`), `planes`
    the LoD2 roof faces each stands on at last (`on_planes`)."""
    args = (
        tile,
        s,
        polys,
        forms or [None] * len(polys),
        groups or list(range(1, len(polys) + 1)),
        flanks or [],
    )
    roofs = Roofs(*args)
    found = read(roofs, s)
    # the parts LoD2 drew off in plan read again where the surface model
    # saw them: the dormers that read adds (one LoD2 put beside its lower
    # roof), turned back into LoD2's frame
    moves = plan_moves(s, polys)
    if moves.any():
        moved = Roofs(*args, moves=moves)
        extra = read(moved, s, moves.any(axis=1))
        for d in extra:
            d["x"], d["y"] = moved.back(d)
        found += [d for d in extra if not twice(d, found)]
    building = [roofs.groups[d["of"]] for d in found]
    found = in_rows(found, building, walls or {}, roofs.place)
    if planes is not None:
        on_planes(found, planes)
    out: list[dict] = []
    level: list[bool] = []
    for d in found:
        x, y, of = d.pop("x"), d.pop("y"), d.pop("of")
        level.append(d.pop("level"))
        point = {"type": "Point", "coordinates": [round(x, 2), round(y, 2)]}
        out.append(feature(point, {"of": ids[of], **d}))
    return uncrowded(out, level)


def read(roofs: Roofs, s: Surfaces, only: np.ndarray | None = None) -> list[dict]:
    """Every dormer and chimney one reading of the roofs finds (`roofs`),
    in its frame, with its host (`of`) and whether it stands on a flat
    roof (`level`); `only` the hosts to read (each object's flag), all
    where not given."""
    found: list[dict] = []
    for sl, m, pitched in blobs(roofs.excess, pitched_cells(roofs.slope)):
        of = roofs.host(*centre(s, sl, m))
        if of is None or (only is not None and not only[of]):
            continue
        d = roofs.read(sl, m, pitched, of)
        if d is not None:
            found.append(d | {"of": of, "level": not pitched})
    return found


def twice(d: dict, found: list[dict]) -> bool:
    """Whether `d` is one of `found` read again: of the same kind, its
    centre within half their widths of one's."""
    for e in found:
        if (d.get("k") == e.get("k")) and math.hypot(d["x"] - e["x"], d["y"] - e["y"]) < (
            d["w"] + e["w"]
        ) / 2:
            return True
    return False


def uncrowded(found: list[dict], level: list[bool]) -> list[dict]:
    """`found` without the flat roofs' chimneys in a crowd (`level`: each
    one read on a flat roof): CHIMNEY_CROWD others within CHIMNEY_CROWD_M
    of one there are a row of something else — masts along a platform
    roof, the ducts of a plant room, a skylight's ridge. On a pitched roof
    every stack stays, however close."""
    at = [
        (i, f["geometry"]["coordinates"])
        for i, f in enumerate(found)
        if f["properties"].get("k") == "chimney" and level[i]
    ]
    if not at:
        return found
    xy = np.asarray([c for _, c in at], dtype=float)
    tree = shapely.STRtree(shapely.points(xy))
    pairs = tree.query(shapely.points(xy), predicate="dwithin", distance=CHIMNEY_CROWD_M)
    counts = np.bincount(pairs[0], minlength=len(at)) - 1
    crowded = {at[k][0] for k in np.nonzero(counts >= CHIMNEY_CROWD)[0]}
    return [f for i, f in enumerate(found) if i not in crowded]


# --- rows ---------------------------------------------------------------------


def _by(idx: list[int], key: list[int]) -> dict[int, list[int]]:
    out: dict[int, list[int]] = {}
    for i in idx:
        out.setdefault(key[i], []).append(i)
    return out


def rows(found: list[dict], building: list[int]) -> list[list[int]]:
    """The rows `found`'s dormers stand in (indices): one `building`'s, falling the same way within
    ROW_TURN_DEG, ROW_DEPTH_M apart down the slope and ROW_GAP_M across
    it at most, chained. Chimneys are in none."""
    idx = [i for i, d in enumerate(found) if d.get("k") != "chimney"]
    parent = {i: i for i in idx}

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    turn = math.cos(math.radians(ROW_TURN_DEG))
    pairs = []
    for same in _by(idx, building).values():
        pairs += [(i, j) for n, i in enumerate(same) for j in same[n + 1 :]]
    for i, j in pairs:
        a, b = found[i], found[j]
        if a["ax"] * b["ax"] + a["ay"] * b["ay"] >= turn:
            ax, ay = a["ax"] + b["ax"], a["ay"] + b["ay"]
            k = math.hypot(ax, ay)
            dx, dy = b["x"] - a["x"], b["y"] - a["y"]
            down, across = (dx * ax + dy * ay) / k, (dx * ay - dy * ax) / k
            if abs(down) <= ROW_DEPTH_M and abs(across) <= ROW_GAP_M:
                parent[root(j)] = root(i)
    out: dict[int, list[int]] = {}
    for i in idx:
        out.setdefault(root(i), []).append(i)
    return list(out.values())


def row_frame(found: list[dict], row: list[int]) -> tuple[float, float, np.ndarray, np.ndarray]:
    """A row's fall (the unit mean of its dormers' `ax`, `ay`) and each
    dormer's place across it (`u`, m) and down it (`v`)."""
    ax = float(np.mean([found[i]["ax"] for i in row]))
    ay = float(np.mean([found[i]["ay"] for i in row]))
    k = math.hypot(ax, ay)
    ax, ay = ax / k, ay / k
    x = np.asarray([found[i]["x"] for i in row])
    y = np.asarray([found[i]["y"] for i in row])
    return ax, ay, x * ay - y * ax, x * ax + y * ay


def resultant(u: np.ndarray, p: float, at: float | None = None) -> tuple[float, float]:
    """How close places `u` stand to slots `p` apart: the mean resultant
    of their phases (1 all on slots), and the slot nearest 0. With `at`
    the slots stand there, and the score is the resultant's share along
    it (so a phase off the given one scores lower)."""
    z = np.exp(2j * math.pi * u / p).mean()
    if at is None:
        return float(abs(z)), float(np.angle(z) / (2 * math.pi) * p) % p
    return float((z * np.exp(-2j * math.pi * at / p)).real), at % p


def grid(u: np.ndarray, axes=None) -> tuple[float, float, str] | None:
    """The one grid a stretch of a row's dormers (at `u`, their places
    across the row) stands on: (spacing, a slot's place, whence), or None
    where they are fewer than ROW_MIN. The spacing lies within RHYTHM_M
    and RHYTHM_SHORT–RHYTHM_GAP of their median gap (half the spacing, or
    one over the whole stretch, fits any few as well); it is the measured
    window axes below (`axes`: spacing and place, the place None where
    unmeasured) every AXES_EVERY'th, from any of its axes, where they fit
    RHYTHM_WINDOWS (`resultant`), else the spacing their phases agree on
    best, its slots then fitted by least squares to the nearest on each,
    where half of them stand within GRID_LOOSE of a slot. A roof's
    dormers stand on one grid; DOM1's 1 m cells read their centres ±0.5 m,
    so no test of how well they fit decides whether they do."""
    if len(u) < ROW_MIN:
        return None
    gap = median_gap(u)
    if gap is None:
        return None
    lo, hi = max(RHYTHM_M[0], RHYTHM_SHORT * gap), min(RHYTHM_M[1], RHYTHM_GAP * gap)
    if axes is not None:
        spacing, at = axes
        fits = [
            (*resultant(u, k * spacing, None if at is None else at + j * spacing), k * spacing)
            for k in AXES_EVERY
            for j in range(k if at is not None else 1)
        ]
        fits = [f for f in fits if lo <= f[2] <= hi and f[0] >= RHYTHM_WINDOWS]
        if fits:
            _, place, p = max(fits)
            return p, place, "windows"
    ps = np.arange(lo, hi + 1e-9, RHYTHM_STEP_M)
    if not len(ps):
        return None
    z = np.exp(2j * math.pi * u[:, None] / ps[None, :]).mean(axis=0)
    best = int(np.argmax(np.abs(z)))
    p = float(ps[best])
    at = float(np.angle(z[best]) / (2 * math.pi) * p)
    k = np.rint((u - at) / p)
    # each slot's nearest dormer (a second on one is the same one's blob)
    near: dict[float, int] = {}
    for j in np.argsort(np.abs(u - (at + k * p)), kind="stable"):
        near.setdefault(float(k[j]), int(j))
    idx = list(near.values())
    if len(idx) >= 2:
        fp, fat = np.polyfit(k[idx], u[idx], 1)
        if lo <= fp <= hi:
            p, at = float(fp), float(fat)
    off = np.abs((u - at + p / 2) % p - p / 2)
    if float(np.median(off)) > GRID_LOOSE * p:
        return None
    return p, at % p, "own"


def median_gap(u: np.ndarray) -> float | None:
    """The median gap between dormers across a row, of those at least
    RHYTHM_M's least spacing (two blobs of one dormer are no gap)."""
    gaps = np.diff(np.sort(u))
    gaps = gaps[gaps >= RHYTHM_M[0]]
    return float(np.median(gaps)) if len(gaps) else None


def stretches(u: np.ndarray) -> list[np.ndarray]:
    """A row's stretches (indices into `u`, in order across it): parted
    where two dormers stand more than GRID_BREAK times the row's median
    gap apart (two wings, a tower between: each its own grid)."""
    order = np.argsort(u, kind="stable")
    gaps = np.diff(u[order])
    gap = median_gap(u)
    if gap is None:
        return [order]
    cut = np.nonzero(gaps > GRID_BREAK * gap)[0]
    return [part for part in np.split(order, cut + 1) if len(part)]


def wall_axes(walls: list[dict], ax: float, ay: float, u: np.ndarray, v: np.ndarray):
    """The measured window axes under a row (falling `ax`, `ay`, its
    dormers at `u`, `v`) as (spacing, an axis' place across the row): of
    the walls with a measured spacing facing the row's way within
    ROW_TURN_DEG and up to WALL_REACH_M in front of it, the one under most
    of them, its spacing and phase seen across the row; the axes' place
    where the photos measured it (`phase`), else None."""
    turn = math.cos(math.radians(ROW_TURN_DEG))
    best, under = None, 0.0
    for w in walls:
        m = w.get("model")
        if m is None or w["n"][0] * ax + w["n"][1] * ay < turn:
            continue
        (x0, y0), (x1, y1) = w["a"], w["b"]
        ua, ub = x0 * ay - y0 * ax, x1 * ay - y1 * ax
        length = math.hypot(x1 - x0, y1 - y0)
        if length <= 0:
            continue
        # metres along the wall to metres across the row
        scale = abs(ub - ua) / length
        front = (x0 * ax + y0 * ay + x1 * ax + y1 * ay) / 2 - float(np.median(v))
        if not 0 < front <= WALL_REACH_M:
            continue
        lo, hi = min(ua, ub), max(ua, ub)
        share = float(np.mean((u >= lo) & (u <= hi)))
        if share > under:
            at = None
            if "phase" in m and ub != ua:
                at = ua + math.copysign(m["phase"] * scale, ub - ua)
            best, under = (float(m["axis"]) * scale, at), share
    return best


def unify(found: list[dict], row: list[int], p: float | None) -> None:
    """A run's dormers (or a row's, `row`) in one shape: the shape most of them have (a shed's
    fall or a flat top), its median width (at most WIDTH_SHARE of the
    spacing `p`), depth and height over the roof."""
    ds = [found[i] for i in row]
    sheds = [d for d in ds if "tf" in d]
    like = sheds if 2 * len(sheds) > len(ds) else [d for d in ds if "tf" not in d]
    w = float(np.median([d["w"] for d in ds]))
    if p is not None:
        w = min(w, WIDTH_SHARE * p)
    depth = float(np.median([d["d"] for d in ds]))
    lift = float(np.median([d["top"] - d["z"] for d in like]))
    tf = float(np.median([d["tf"] for d in like])) if like is sheds else None
    for d in ds:
        d["w"], d["d"], d["lift"] = round(w, 2), round(depth, 2), lift
        d.pop("tf", None)
        if tf is not None:
            d["tf"] = round(tf, 1)


def snap(
    u: np.ndarray, p: float, at: float, weak: np.ndarray | None = None
) -> tuple[np.ndarray, list[int], list[int], np.ndarray]:
    """A stretch's dormers on its grid (slots `p` apart, one at `at`):
    each one's new place across the row, which stand on a slot another
    nearer one takes (DOM1's cells part one dormer into two blobs, or a
    dormer from its cheek), which are set on a slot, and each one's slot.
    One whose slot a nearer one takes but whose neighbour slot on its side
    is free takes that (DOM1 read it half a slot off); one more than
    SNAP_SHARE of `p` off with neither free is something else and stays
    put. The `weak` (a fragment DOM1 read of a dormer) choose last, and
    one with no slot left is dropped."""
    k = np.rint((u - at) / p)
    off = np.abs(u - (at + k * p))
    out, taken, drop, on, late = u.copy(), set(), [], [], []
    rank = off / p + (0.0 if weak is None else weak.astype(float))
    for n in np.argsort(rank, kind="stable"):
        if k[n] in taken:
            late.append(int(n))
            continue
        taken.add(k[n])
        on.append(int(n))
    for n in late:
        side = k[n] + (1.0 if u[n] > at + k[n] * p else -1.0)
        if side not in taken and u.min() - p / 2 <= at + side * p <= u.max() + p / 2:
            taken.add(side)
            k[n] = side
            on.append(n)
        elif off[n] <= SNAP_SHARE * p or (weak is not None and weak[n]):
            drop.append(n)
    for n in on:
        out[n] = at + k[n] * p
    return out, sorted(drop), sorted(on), k


def holes(slots: set[int], kept: set[int]) -> list[int]:
    """The empty slots of a grid with a kept dormer on both sides
    (`kept`, of the taken `slots`): DOM1 misses a small dormer more often
    than a roof leaves one slot of a row bare."""
    return [s + 1 for s in sorted(kept) if s + 1 not in slots and s + 2 in kept]


def alike(found: list[dict], row: list[int]) -> bool:
    """Whether a row's dormers are of one size (widths within ALIKE of
    each other): a pair or a few of one kind, not a wide dormer (a
    Zwerchhaus) between small ones."""
    ws = [found[i]["w"] for i in row]
    return max(ws) <= ALIKE * min(ws)


def in_rows(found: list[dict], building: list[int], walls: dict, place) -> list[dict]:
    """`found` with its dormers set in rows (`rows`): each stretch of a
    row (`stretches`) on one grid (`grid`: over the window axes of the wall
    below where the street photos measured them, else the spacing its
    dormers agree on best), every dormer on its nearest slot (`snap`),
    straight down the slope at the row's median depth, in one shape
    (`unify`) and, on each LoD2 part, at one height (`level`); a slot
    empty between two kept dormers takes one like its neighbour (`holes`);
    a stretch with no grid likewise straight, in one shape and level where
    its dormers are alike (`alike`). A dormer more than ROW_DEPTH_M or
    ROW_TURN_DEG off the row (a chain of rows drifts) or wider than WIDE
    times its stretch's median (a Zwerchhaus) is something else and stays
    as it was. `walls` are the measured walls per building, `place(x, y,
    d)` the roof at a dormer's new centre: (height, host, the host's
    ridge), or None where it would leave its building's roof (it then
    stays where it stood, and no dormer fills a slot there)."""
    drop: set[int] = set()
    added: list[dict] = []
    gridded: set[int] = set()
    lines = sorted(rows(found, building), key=len, reverse=True)
    turn = math.cos(math.radians(ROW_TURN_DEG))
    for row in lines:
        if len(row) < 2:
            continue
        ax, ay, u, v = row_frame(found, row)
        depth = float(np.median(v))
        measured = walls.get(building[row[0]], [])

        def on_row(n: int, row=row, v=v, depth=depth, ax=ax, ay=ay) -> bool:
            d = found[row[n]]
            return abs(v[n] - depth) <= ROW_DEPTH_M and d["ax"] * ax + d["ay"] * ay >= turn

        for part in stretches(u):
            # off the row or a Zwerchhaus: something else, before any slot
            part = np.asarray([n for n in part if on_row(int(n))], dtype=int)
            if not len(part):
                continue
            wide = WIDE * float(np.median([found[row[n]]["w"] for n in part]))
            part = np.asarray([n for n in part if found[row[n]]["w"] <= wide], dtype=int)
            ws = np.asarray([found[row[n]]["w"] for n in part])
            weak = ws < WEAK_SHARE * float(np.median(ws))
            fit = grid(u[part], wall_axes(measured, ax, ay, u[part], v[part]))
            at, slot_of, p = u.copy(), {}, None
            if fit is not None:
                p, first, _ = fit
                moved, dropped, on, k = snap(u[part], p, first, weak)
                at[part] = moved
                drop.update(row[int(part[j])] for j in dropped)
                members = [int(part[j]) for j in on]
                slot_of = {int(part[j]): int(k[j]) for j in on}
            elif len(part) >= 2 and alike(found, [row[int(n)] for n in part]):
                members = [int(n) for n in part]
            else:
                continue
            unify(found, [row[n] for n in members], p)

            def set_on(d: dict, a: float, ax=ax, ay=ay, depth=depth) -> bool:
                return move(d, a * ay + depth * ax, -a * ax + depth * ay, ax, ay, place)

            placed = [n for n in members if set_on(found[row[n]], at[n])]
            if p is not None:
                gridded.update(id(found[row[n]]) for n in placed)
            # an empty slot between two set on it takes a dormer like its
            # neighbour (`holes`)
            line = [found[row[n]] for n in placed]
            kept = {slot_of[n]: n for n in placed if n in slot_of}
            for s in holes(set(slot_of.values()), set(kept)) if p is not None else []:
                src = found[row[kept[s - 1]]]
                twin = copy.deepcopy(src)
                twin["lift"] = src["lift"]
                if set_on(twin, at[kept[s - 1]] + p):
                    line.append(twin)
                    added.append((twin, row[kept[s - 1]]))
            level(line)
    drop |= overlapping(found, lines, drop, building, gridded)
    kept = [d for i, d in enumerate(found) if i not in drop]
    for twin, src in added:
        # a twin of a dormer read twice goes with it; none on a chimney or
        # a dormer of a grid; a smaller stray in its slot (a dormer's
        # fragment read up the slope) gives way to it
        if src in drop:
            continue
        hit = [d for d in kept if clash(twin, d)]
        if any(d.get("k") == "chimney" or id(d) in gridded or d["w"] >= twin["w"] for d in hit):
            continue
        gone = {id(d) for d in hit}
        kept = [d for d in kept if id(d) not in gone] + [twin]
        gridded.add(id(twin))
    return kept


def clash(a: dict, b: dict) -> bool:
    """Whether two boxes on a roof (dormers or chimneys, `w` across and
    `d` along `a`'s fall) overlap by OVERLAP_SHARE of the narrower width
    across, down the slope within their mean depth and OVERLAP_DOWN_M."""
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    across = abs(dx * a["ay"] - dy * a["ax"])
    down = abs(dx * a["ax"] + dy * a["ay"])
    over = (a["w"] + b["w"]) / 2 - across
    reach = (a["d"] + b["d"]) / 2 + OVERLAP_DOWN_M
    return over >= OVERLAP_SHARE * min(a["w"], b["w"]) and down < reach


def move(d: dict, x: float, y: float, ax: float, ay: float, place) -> bool:
    """A dormer `d` set at (x, y) facing (ax, ay), its top its row's
    height over the roof there (under its host's ridge: kept for `level`
    as `ridge`); where it would leave its building's roof (`place` None)
    it stays where it stood. Whether it moved."""
    lift = d.pop("lift")
    roof = place(x, y, d)
    if roof is None:
        d.pop("ridge", None)
        return False
    z, d["of"], ridge_z = roof
    d |= {"x": x, "y": y, "ax": round(ax, 4), "ay": round(ay, 4), "z": round(z, 2)}
    d["lift"], d["ridge"] = lift, ridge_z
    return True


def level(line: list[dict]) -> None:
    """A row's dormers, set on it (`move`), at one eave on each LoD2 part:
    its median roof height under them (a LoD2 part's eave is level) and
    the median slope, their tops their height over it under the part's
    ridge; a shed dormer's fall then at most SHED_MARGIN under the slope.
    The roof's 1 m cells read a mansard's 70° face ±1.4 m up and down (a
    cell either way across it). Where the LoD2 faces are given, `on_planes`
    then stands each on its exact face, its top the same height over it:
    what this keeps is that one height over the roof."""
    by: dict[int, list[dict]] = {}
    for d in line:
        by.setdefault(d["of"], []).append(d)
    for same in by.values():
        z = float(np.median([d["z"] for d in same]))
        slope = float(np.median([d["slope"] for d in same]))
        for d in same:
            top = min(z + d.pop("lift"), d.pop("ridge") + RIDGE_SLACK_M)
            d |= {"z": round(z, 2), "slope": round(slope, 1), "top": round(top, 2)}
            if "tf" in d:
                d["tf"] = round(min(d["tf"], slope - SHED_MARGIN), 1)


def overlapping(
    found: list[dict],
    lines: list[list[int]],
    drop: set[int],
    building: list[int],
    gridded: set[int] | None = None,
) -> set[int]:
    """The dormers whose box overlaps one of their building's kept before
    (the rows in `lines`' order, the longest first) by OVERLAP_SHARE of
    the narrower width across: one dormer read twice — its front and its
    back two rows a little more than ROW_DEPTH_M apart, or two blobs where
    two runs of a row meet — now set one into the other. In a rhythm the
    boxes stand apart (WIDTH_SHARE)."""
    out: set[int] = set()
    kept: dict[int, list[int]] = {}
    order = [i for row in lines for i in row if i not in drop]
    # a dormer set on a grid first: a fragment beside it gives way
    order.sort(key=lambda i: id(found[i]) not in (gridded or set()))
    for i in order:
        a = found[i]
        mine = kept.setdefault(building[i], [])
        for j in mine:
            if clash(a, found[j]):
                out.add(i)
                break
        else:
            mine.append(i)
    return out


def roof_fall(
    s: Surfaces, sl, m: np.ndarray, d: dict, excess: np.ndarray | None = None
) -> tuple[float, float] | None:
    """A dormer's roof along its axis: its fall (degrees, positive where it
    falls the way the main roof does) and its height at the centre — a
    line fitted to the surface model every FALL_STEP_M along the axis
    through the centre, where it runs over the blob, from its back to
    FALL_FRONT_M behind its front edge; None over less than
    FALL_MIN_SPAN_M (a shallow dormer: no fall to read). With the roof's
    `excess` the line runs on behind the blob as long as the surface stays
    FALL_EXCESS_M over the roof: a shed dormer's back rises out of the
    blob (its excess shrinks to nothing where it meets the roof), a flat
    one's top stays level there."""
    f = s.field
    xs, ys = cells_xy(s, sl, m)
    ax, ay = d["ax"], d["ay"]
    along = (xs - d["x"]) * ax + (ys - d["y"]) * ay
    back = float(along.min()) - (FALL_BACK_M if excess is not None else 0.0)
    front = float(along.max()) + f.res / 2
    bs = np.arange(back, front - FALL_FRONT_M + 1e-9, FALL_STEP_M)
    rows = (f.ymax - (d["y"] + bs * ay)) / f.res - 0.5
    cols = (d["x"] + bs * ax - f.xmin) / f.res - 0.5
    gr = np.clip(np.rint(rows).astype(int), 0, f.rows - 1)
    gc = np.clip(np.rint(cols).astype(int), 0, f.cols - 1)
    ri, ci = gr - sl[0].start, gc - sl[1].start
    used = (ri >= 0) & (ri < m.shape[0]) & (ci >= 0) & (ci < m.shape[1])
    used[used] = m[ri[used], ci[used]]
    if not used.any():
        return None
    if excess is not None:
        # behind the blob, back from its first sample while over the roof
        for j in range(int(np.argmax(used)) - 1, -1, -1):
            if not excess[gr[j], gc[j]] >= FALL_EXCESS_M:
                break
            used[j] = True
    height = map_coordinates(s.dom, [rows, cols], order=1, mode="nearest")
    ok = used & np.isfinite(height)
    if ok.sum() < 3 or float(np.ptp(bs[ok])) < FALL_MIN_SPAN_M - 1e-9:
        return None
    k, at_centre = np.polyfit(bs[ok], height[ok], 1)
    return math.degrees(math.atan(-k)), float(at_centre)


def shed_top(z: float, slope: float, depth: float, fall) -> float | None:
    """Where a shed dormer's roof meets the main roof — its top, the line
    the build lets it fall from — given the main roof's height `z` at the
    dormer's centre, its slope (degrees), the dormer's depth along it and
    its roof's (fall, height at the centre) (`roof_fall`); None where it is
    no shed dormer: a fall under SHED_MIN_FALL (flat, or gabled across
    the axis) or within SHED_MARGIN of the roof's own, a roof that would
    pass under the main roof before its front, or a run over MAX_SIDE_M."""
    if fall is None:
        return None
    tf, at_centre = fall
    if not SHED_MIN_FALL <= tf <= slope - SHED_MARGIN:
        return None
    tan_s, tan_f = math.tan(math.radians(slope)), math.tan(math.radians(tf))
    # along the axis from the centre (down the slope positive)
    back = (z - at_centre) / (tan_s - tan_f)
    if not 0 < depth / 2 - back <= MAX_SIDE_M:
        return None
    return z - tan_s * back


def ridge(s: Surfaces, poly: shapely.Geometry) -> float:
    """The highest LoD2 roof cell over the footprint."""
    win = s.window(poly, 0)
    if win is None:
        return -math.inf
    m = s.mask(poly, win) & np.isfinite(s.roof[win])
    return float(s.roof[win][m].max()) if m.any() else -math.inf


def ring_round(sl, m: np.ndarray, shape: tuple[int, int], *fields: np.ndarray):
    """The ring two cells round a blob: the window it lies in (`pad`) and
    its cells there where every one of `fields` is measured."""
    rows, cols = sl
    nr, nc = shape
    pad = (
        slice(max(rows.start - 2, 0), min(rows.stop + 2, nr)),
        slice(max(cols.start - 2, 0), min(cols.stop + 2, nc)),
    )
    big = np.zeros((pad[0].stop - pad[0].start, pad[1].stop - pad[1].start), bool)
    r0, c0 = rows.start - pad[0].start, cols.start - pad[1].start
    big[r0 : r0 + m.shape[0], c0 : c0 + m.shape[1]] = m
    ring = ndi.binary_dilation(big, iterations=2) & ~big
    for f in fields:
        ring &= np.isfinite(f[pad])
    return pad, ring


def downslope(s: Surfaces, sl, m: np.ndarray, gx, gy, slope) -> tuple[float, float, float] | None:
    """Which way the roof around a blob falls (a unit vector, EPSG) and how
    steeply (degrees): the median of the ring two cells round it. None
    where too little roof is round it or it is level."""
    pad, ring = ring_round(sl, m, gx.shape, gx, gy)
    if ring.sum() < 4:
        return None
    dx, dy = -float(np.median(gx[pad][ring])), -float(np.median(gy[pad][ring]))
    n = math.hypot(dx, dy)
    if n < 1e-6:
        return None
    return dx / n, dy / n, float(np.median(slope[pad][ring]))


def extent(s: Surfaces, sl, m: np.ndarray, ax: float, ay: float):
    """A blob's centre (EPSG), and its extent across the axis (ax, ay) and
    along it (m, a cell's width included)."""
    xs, ys = cells_xy(s, sl, m)
    cx, cy = float(xs.mean()), float(ys.mean())
    along = (xs - cx) * ax + (ys - cy) * ay
    across = (xs - cx) * ay - (ys - cy) * ax
    return cx, cy, float(np.ptp(across)) + s.field.res, float(np.ptp(along)) + s.field.res


def lod2_at(s: Surfaces, x: float, y: float) -> float | None:
    """The LoD2 roof's height in the cell holding (x, y), or None off the
    field or where LoD2 draws none."""
    f = s.field
    r, c = math.floor((f.ymax - y) / f.res), math.floor((x - f.xmin) / f.res)
    if 0 <= r < f.rows and 0 <= c < f.cols and np.isfinite(s.roof[r, c]):
        return float(s.roof[r, c])
    return None


def roof_at(s: Surfaces, sl, m: np.ndarray, x: float, y: float) -> float:
    """The LoD2 roof's height at (x, y), else the blob's median roof."""
    z = lod2_at(s, x, y)
    return z if z is not None else float(np.nanmedian(s.roof[sl][m]))


def dormer(s: Surfaces, sl, m: np.ndarray, excess, gx, gy, slope) -> dict | None:
    """One blob's dormer, or None where it is no dormer's shape: too low or
    too high over the roof, deeper than MAX_SIDE_M down the slope, or
    filling less than MIN_FILL of its box. Across the slope it may be as
    wide as it is: a row of dormers, a dormer over the whole roof."""
    ex = excess[sl][m]
    lift = float(np.percentile(ex, 80))
    if not MIN_TOP_M <= lift <= MAX_TOP_M:
        return None
    down = downslope(s, sl, m, gx, gy, slope)
    if down is None:
        return None
    ax, ay, sl_deg = down
    cx, cy, w, d = extent(s, sl, m, ax, ay)
    if d > MAX_SIDE_M or int(m.sum()) < MIN_FILL * w * d:
        return None
    z = roof_at(s, sl, m, cx, cy)
    return {
        "x": cx,
        "y": cy,
        "ax": round(ax, 4),
        "ay": round(ay, 4),
        "w": round(w, 2),
        "d": round(d, 2),
        "z": round(z, 2),
        "top": round(z + lift, 2),
        "slope": round(sl_deg, 1),
    }


def chimney_side(e: float, res: float) -> float:
    """A chimney's drawn side from its blob's extent `e` (m): DOM1's cells
    spread it over a whole one."""
    return float(np.clip(e - res + CHIMNEY_SIDE_M, CHIMNEY_SIDE_M, CHIMNEY_MAX_SIDE_M))


def chimney(
    s: Surfaces,
    sl,
    m: np.ndarray,
    excess,
    axis: tuple[float, float, float],
    seam: bool,
    ridge_z: float,
) -> dict | None:
    """One blob's chimney, standing along `axis` (ax, ay and the roof's
    slope, degrees), or None: its top under CHIMNEY_MIN_LIFT_M (SEAM_LIFT_M
    on a seam) or over CHIMNEY_MAX_LIFT_M over the roof, or more than
    CHIMNEY_OVER_RIDGE_M over the object's highest roof (`ridge_z`)."""
    ex = excess[sl][m]
    lift = float(ex.max())
    if not (SEAM_LIFT_M if seam else CHIMNEY_MIN_LIFT_M) <= lift <= CHIMNEY_MAX_LIFT_M:
        return None
    top = float(np.max(s.roof[sl][m] + ex))
    if top > ridge_z + CHIMNEY_OVER_RIDGE_M:
        return None
    ax, ay, sl_deg = axis
    cx, cy, w, d = extent(s, sl, m, ax, ay)
    return {
        "k": "chimney",
        "x": cx,
        "y": cy,
        "ax": round(ax, 4),
        "ay": round(ay, 4),
        "w": round(chimney_side(w, s.field.res), 2),
        "d": round(chimney_side(d, s.field.res), 2),
        "z": round(roof_at(s, sl, m, cx, cy), 2),
        "top": round(top, 2),
        "slope": round(sl_deg, 1),
    }


def measured_walls(tile: Tile, city: dict, ids: list[str]) -> dict[int, list[dict]]:
    """The walls whose window axes the street photos measured
    (`dlm/windows_<tile>.json`, windows.py), per building as
    `building_groups` numbers them; none where the tile has no such file."""
    path = tile.data / "dlm" / f"windows_{tile.id}.json"
    if not path.exists():
        return {}
    buildings = json.loads(path.read_text()).get("buildings", {})
    roots = [root_of(city, oid) for oid in ids]
    numbers = dict(zip(roots, building_groups(city, ids), strict=True))
    return {
        numbers[root]: [w for w in walls if "model" in w]
        for root, walls in buildings.items()
        if root in numbers
    }


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"dormers_{tile.id}.geojson")
    city_path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    if not tile.products.dom or not tile.raw_raster("dom1").exists() or not city_path.exists():
        print(f"{tile.id}: no surface model — no dormers")
        write_geojson(out, [], tile.epsg, tile.credit)
        return
    city = json.loads(city_path.read_text())
    ids, polys = footprints(city)
    found = find(
        tile,
        Surfaces(tile),
        ids,
        polys,
        roof_forms(city, ids),
        building_groups(city, ids),
        mansard_flanks(city),
        measured_walls(tile, city, ids),
        RoofPlanes(city, ids, measured_parts(tile)),
    )
    write_geojson(out, found, tile.epsg, tile.credit)
    chimneys = sum(1 for f in found if f["properties"].get("k") == "chimney")
    print(f"{tile.id}: {len(found) - chimneys} dormers, {chimneys} chimneys")
