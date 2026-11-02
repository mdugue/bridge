"""The dormers and chimneys on the LoD2 roofs, measured in the surface
model (DOM1): `data/<site>/dlm/dormers_<tile>.geojson`, which the building
bake (`scripts/bake-city-mesh.ts`) draws as part of the building they sit
on.

LoD2 draws a roof as its planes; the dormers and chimneys on it are not
there. The surface model sees them: the excess `DOM − LoD2 roof` rises by
a metre or two. Measured against the roof's own fit (the excess's median
over `FIT_M` around — a roof LoD2 drew a metre off is not a dormer, and a
roof it drew badly is skipped: `FIT_TOLERANCE_M`), every blob of
`MIN_EXCESS_M` or more, at any size and however close to the next, not at
the roof's outline (one cell in) and clear of every mapped or measured
tree (canopy, cadastre, `TREE_CLEAR_M`), is read by where it stands
(`kind_of`):

- on a pitched roof (`MIN_SLOPE`–`MAX_SLOPE`; a mansard roof, LoD2's
  `roofType` 3400, up to `MANSARD_MAX_SLOPE`; the line of a ridge or a
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

import json
import math

import numpy as np
import shapely
from scipy import ndimage as ndi
from scipy.ndimage import map_coordinates

from .common import Tile, feature, owns, write_geojson
from .osm_buildings import footprints
from .structures import Surfaces

MIN_SLOPE = 25.0
MAX_SLOPE = 62.0
# A mansard roof's lower face is steeper: its dormers stand on it up to
# this slope (degrees). LoD2 names the roof's form (`roofType`).
MANSARD_MAX_SLOPE = 80.0
MANSARD = "3400"
# the roof's fit: the median excess over this window (m) and how far off it
# may be before the roof is not trusted
FIT_M = 9
FIT_TOLERANCE_M = 0.4
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


def slope_cap(s: Surfaces, polys: list[shapely.Geometry], forms: list[str | None]) -> np.ndarray:
    """Per cell the steepest roof a dormer stands on: MAX_SLOPE, on a
    mansard roof MANSARD_MAX_SLOPE."""
    cap = np.full(s.roof.shape, MAX_SLOPE)
    for poly, form in zip(polys, forms, strict=True):
        win = s.window(poly, 0) if form == MANSARD else None
        if win is not None:
            cap[win][s.mask(poly, win)] = MANSARD_MAX_SLOPE
    return cap


def _shifted(a: np.ndarray, dr: int, dc: int) -> np.ndarray:
    """`a` moved by (dr, dc) cells, NaN where that runs off it."""
    rows, cols = a.shape
    out = np.full(a.shape, np.nan)
    out[max(dr, 0) : rows + min(dr, 0), max(dc, 0) : cols + min(dc, 0)] = a[
        max(-dr, 0) : rows + min(-dr, 0), max(-dc, 0) : cols + min(-dc, 0)
    ]
    return out


def seams(roof: np.ndarray) -> np.ndarray:
    """The cells within a cell of a seam of the LoD2 roof: where it bends by
    more than SEAM_BEND_M over three cells in a row (a ridge, a hip, a
    valley, a step between two parts), between roof cells only — its
    outline is no seam."""
    crease = np.zeros(roof.shape, bool)
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        bend = np.abs(_shifted(roof, dr, dc) + _shifted(roof, -dr, -dc) - 2 * roof)
        crease |= np.nan_to_num(bend, nan=0.0) > SEAM_BEND_M
    return ndi.binary_dilation(crease, iterations=SEAM_REACH) if SEAM_REACH else crease


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

    def __init__(self, tile: Tile, s: Surfaces, polys: list[shapely.Geometry], forms) -> None:
        f = s.field
        under = np.isfinite(s.roof)
        self.s = s
        self.gx, self.gy = roof_gradient(np.where(under, s.roof, np.nan), f.res)
        self.slope = np.degrees(np.arctan(np.hypot(self.gx, self.gy)))
        inner = ndi.binary_erosion(under, iterations=1)
        raw = np.where(inner & np.isfinite(s.dom), s.dom - s.roof, np.nan)
        local = ndi.median_filter(np.nan_to_num(raw), size=FIT_M)
        fits = inner & (np.abs(local) < FIT_TOLERANCE_M)
        fits &= self.slope <= slope_cap(s, polys, forms)
        self.excess = np.where(fits, raw - local, np.nan)
        self.seam = seams(s.roof)
        # the roof's outermost cell measured: its eaves, a parapet's foot
        self.edge = inner & ~ndi.binary_erosion(inner, iterations=1)
        self.polys = polys
        self.ridges: dict[int, float] = {}
        self.hosts = shapely.STRtree(polys)
        trees = tree_points(tile)
        self.trees = shapely.STRtree(shapely.points(trees)) if len(trees) else None
        self.bounds = tile.bounds

    def host(self, x: float, y: float) -> int | None:
        """The footprint a blob at (x, y) sits on — the smallest that holds
        it —, or None: off the tile's own, near a tree, on no footprint."""
        if not owns(self.bounds, x, y):
            return None
        p = shapely.Point(x, y)
        if self.trees is not None and len(self.trees.query(p.buffer(TREE_CLEAR_M))):
            return None
        hits = [int(k) for k in self.hosts.query(p, predicate="within")]
        return min(hits, key=lambda k: self.polys[k].area) if hits else None

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
) -> list[dict]:
    """Every dormer and chimney the surface model shows on the tile's own
    roofs (see the module); `forms` each object's roof form
    (`roof_forms`)."""
    roofs = Roofs(tile, s, polys, forms or [None] * len(polys))
    out: list[dict] = []
    level: list[bool] = []
    for sl, m, pitched in blobs(roofs.excess, pitched_cells(roofs.slope)):
        of = roofs.host(*centre(s, sl, m))
        if of is None:
            continue
        found = roofs.read(sl, m, pitched, of)
        if found is None:
            continue
        x, y = found.pop("x"), found.pop("y")
        point = {"type": "Point", "coordinates": [round(x, 2), round(y, 2)]}
        out.append(feature(point, {"of": ids[of], **found}))
        level.append(not pitched)
    return uncrowded(out, level)


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


def roof_at(s: Surfaces, sl, m: np.ndarray, x: float, y: float) -> float:
    """The LoD2 roof's height at (x, y), else the blob's median roof."""
    f = s.field
    r, c = int(round((f.ymax - y) / f.res - 0.5)), int(round((x - f.xmin) / f.res - 0.5))
    if 0 <= r < f.rows and 0 <= c < f.cols and np.isfinite(s.roof[r, c]):
        return float(s.roof[r, c])
    return float(np.nanmedian(s.roof[sl][m]))


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


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"dormers_{tile.id}.geojson")
    city_path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    if not tile.products.dom or not tile.raw_raster("dom1").exists() or not city_path.exists():
        print(f"{tile.id}: no surface model — no dormers")
        write_geojson(out, [], tile.epsg, tile.credit)
        return
    city = json.loads(city_path.read_text())
    ids, polys = footprints(city)
    found = find(tile, Surfaces(tile), ids, polys, roof_forms(city, ids))
    write_geojson(out, found, tile.epsg, tile.credit)
    chimneys = sum(1 for f in found if f["properties"].get("k") == "chimney")
    print(f"{tile.id}: {len(found) - chimneys} dormers, {chimneys} chimneys")
