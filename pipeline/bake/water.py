"""The water class → its bodies: one surface per connected water, its dry
shore, its colour and its foam. landcover.py calls `bodies` on the class
raster it has just burned (re-classing the shore in place) and writes the
result into the legend as its `water` member; the build reads it
(scripts/prepare-data.ts, lib/city/water-bodies.ts).

- **Bodies.** The water texels at the DGM's 1 m, connected (4-neighbours),
  split only where OpenStreetMap maps a weir, a lock gate or a dam across
  them (`waterway=weir|lock_gate|dam`, ways and nodes; a node's cut runs
  across the water at right angles to the nearest waterway).
- **One surface per body** (`lifts`). The DGM fills standing water at
  fixed heights, and where two fills meet inside one body it steps:
  Hamburg's Elbe stands at 2.00 m, its Fleete at 0.78, the strip between
  the Landungsbrücken and their pontoons at 0.2, the Oberhafen at 0.0 —
  1.8–2 m cliffs of water a few metres apart. A fill (MIN_FILL_M2 of cells
  at one height, FILL_TOL) whose edge with the body's other fills lies
  mostly more than STEP_M below larger ones is lifted to the largest of
  them, the smallest first (a chain ends at the top) — Hamburg's harbour to
  the Elbe's 2.00, the mode of its fill, which is about its mean high
  water: the tide is not modelled. The cells round a fill that dip under it
  (the DGM blends two fills over a cell or two, a quay's foot) go up with
  it. What the DGM measured as a sloping surface (a river falls along its
  course: the Isar 1–3 m over a tile, the Elbe 0.5 m) keeps it, so a tile
  seam never steps, and so does a step at a mapped weir. Nothing is
  lowered. The terrain bake raises the ground of every lifted cell to its
  level (`lift_raster`), as it raises a terrace; the water sheet drapes
  that ground.
- **Shore** (`dry_cells`, `reclass`). Water texels standing more than
  SHORE_M over their body's level nearby (`local_level`) are dry: the
  beaches, gravel bars and bank slopes the water class takes in (Meißen's
  Elbe beach, the Isar's bars, a quay's top). They become meadow where the
  DOP is green, the built-up, rail or road class beside them on a bank
  (BANK_REACH_M), else the path class (6, drawn unpaved: sand and gravel).
  Streams narrower than NARROW_M are left alone: their DGM is mostly bank.
- **Colour** (`colours`, `tint_grid`). Each body's open water (CORE_M
  from its bank): the median of its DOP pixels, the flight's cast taken out
  (dop_balance.py), in CIE L*a*b*, with the number of cells it was read
  from. The build pools a body's reads over every tile it spans (joined at
  the seams by `edge_runs`) and makes the tint (lib/city/water-bodies.ts):
  the hue at the sheet's lightness — the Isar green, Hamburg's Elbe ochre,
  Saxony's rivers the palette's dusty blue. A TINT_GRID² grid says which
  body's colour is where.
- **Foam** (`foam`). Where the water falls: a mapped weir, or where its
  surface drops more than DROP_M within DROP_WINDOW_M along a run of
  water (an unmapped weir or a cascade: Dresden's Weißeritz) — the line
  across the water there, the drop and which way is down.
"""

from __future__ import annotations

import base64
import io
import math
import warnings
from dataclasses import replace

import numpy as np
import rasterio
import shapely
from PIL import Image
from rasterio.enums import Resampling
from rasterio.features import rasterize
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from . import dop_balance
from .common import Tile, column
from .osm import has_extract, read_osm, tag

WATER = 8  # landcover.py CLASSES
MEADOW = 1
SANDY = 6  # the path class: drawn unpaved
BANK_CLASSES = (4, 5, 7)  # built-up, railway, road: a quay, a pier, a landing
BANK_REACH_M = 3.0

STEP_M = 0.5  # a fill this far under the fill it meets is lifted to it
FILL_TOL = 0.005  # a fill: cells connected at one height (m) …
MIN_FILL_M2 = 50  # … over this area at least
LIFT_GROW = 2  # a lift raises the cells this far round its fill too
SHORE_M = 0.3  # a water cell this far over its body's level nearby is dry
SHORE_MIN_M2 = 20  # a dry patch out on the water this big at least (not a stone, a buoy)
BANK_MIN_M2 = 2  # one on the bank (the class's water up a quay) this big
LEVEL_BLOCK_M = 5  # the local level: a low percentile per block …
LEVEL_PCT = 20
LEVEL_WINDOW = 9  # … its median over this many blocks square (45 m)
NARROW_M = 8.0  # water narrower than this is a stream: never shore
GREEN_NDVI = 0.15  # raw NDVI of a green shore (meadow) …
GREEN_GLI = 0.05  # … or its visible-band index without infrared
CORE_M = 5.0  # a body's colour is read this far inside its bank
CORE_MIN = 200  # core cells a body needs for its own colour
TINT_GRID = 64  # the tint grid's edge (cells over the tile)
DROP_M = 0.5  # the surface falls this much …
DROP_WINDOW_M = 20  # … within this along a run of water: foam
DROP_MIN_M2 = 30  # a drop zone at least this big
FOAM_MAX = 16  # foam lines a tile carries at most (the shader's array)
FOAM_MIN_M = 4.0  # a foam line this long at least
FOAM_SIDE_SHARE = 0.6  # the water on both sides of a drop along this much of it
CUT_REACH_M = 150.0  # a node's cut reaches at most this far either way
WEIR_DROP_M = 0.8  # a mapped weir's drop where the DGM shows none
BODY_MIN_M2 = 100  # a body the legend lists


# --- reading ------------------------------------------------------------------


def grid_classes(raster: np.ndarray, n: int) -> np.ndarray:
    """The class raster sampled at the centres of an n × n grid over the
    tile (NEAREST, row 0 = north)."""
    idx = ((np.arange(n) + 0.5) * raster.shape[0] / n).astype(int)
    return raster[np.ix_(idx, idx)]


def read_dgm(tile: Tile) -> tuple[np.ndarray, object]:
    """The tile's DGM (NaN = NoData) and its transform."""
    with rasterio.open(tile.dgm) as ds:
        z = ds.read(1).astype(np.float32)
        if ds.nodata is not None:
            z[z == ds.nodata] = np.nan
        return z, ds.transform


def read_dop(tile: Tile, n: int) -> np.ndarray | None:
    """The orthophoto at the grid's resolution (bands × n × n, 8-bit), or
    None without one."""
    path = tile.raw_raster("dop")
    if not path.exists():
        return None
    with rasterio.open(path) as ds:
        if ds.count < 3:
            return None
        return ds.read(out_shape=(ds.count, n, n), resampling=Resampling.average)


# --- the cuts -------------------------------------------------------------------

CUT_KINDS = ("weir", "lock_gate", "dam")
FOAM_KINDS = ("weir",)
AXIS_KINDS = ("river", "canal", "stream", "ditch", "drain")


def osm_barriers(
    tile: Tile,
) -> tuple[list[tuple[str, shapely.Geometry]], list[shapely.Geometry]]:
    """(kind, geometry) of the weirs, lock gates and dams OSM maps near the
    tile — ways as lines, nodes as points, a dam's area as its outline — and
    the waterway axes, the direction a node's cut crosses. Three reads of the
    extract (GDAL's OSM driver scans the whole file for each)."""
    kinds = ", ".join(f"'{k}'" for k in (*CUT_KINDS, *AXIS_KINDS))
    lines, fields = read_osm(tile, "lines", f"waterway IN ({kinds})", ["waterway"])
    ways = list(zip(column(fields, "waterway", lines), lines, strict=True))
    out = [(k, g) for k, g in ways if g is not None and k in CUT_KINDS]
    axes = [g for k, g in ways if g is not None and k in AXIS_KINDS]
    like = " OR ".join(f'other_tags LIKE \'%"waterway"=>"{k}"%\'' for k in CUT_KINDS)
    points, fields = read_osm(tile, "points", like, ["other_tags"])
    for t, g in zip(column(fields, "other_tags", points), points, strict=True):
        kind = tag(t, "waterway")
        if g is not None and kind in CUT_KINDS:
            out.append((kind, g))
    areas, fields = read_osm(tile, "multipolygons", like, ["other_tags"])
    for t, g in zip(column(fields, "other_tags", areas), areas, strict=True):
        kind = tag(t, "waterway")
        if g is not None and kind in CUT_KINDS:
            out += [(kind, shapely.LineString(p.exterior.coords)) for p in shapely.get_parts(g)]
    return out, axes


class Grid:
    """The tile's 1 m grid (row 0 = north) with EPSG helpers."""

    def __init__(self, bounds: tuple[float, float, float, float], n: int) -> None:
        self.bounds = bounds
        self.n = n
        self.res = (bounds[2] - bounds[0]) / n
        self.transform = rasterio.transform.from_bounds(*bounds, n, n)

    def rc(self, x: float, y: float) -> tuple[int, int] | None:
        c = int((x - self.bounds[0]) / self.res)
        r = int((self.bounds[3] - y) / self.res)
        return (r, c) if 0 <= r < self.n and 0 <= c < self.n else None

    def xy(self, r: float, c: float) -> tuple[float, float]:
        return self.bounds[0] + (c + 0.5) * self.res, self.bounds[3] - (r + 0.5) * self.res


def across(
    grid: Grid, water: np.ndarray, x: float, y: float, ux: float, uy: float
) -> shapely.LineString | None:
    """The line through (x, y) along ±(ux, uy) to where the water ends on
    either side (at most CUT_REACH_M), or None off the water."""
    ends = []
    for sign in (1, -1):
        last = (x, y)
        d = 0.0
        while d <= CUT_REACH_M:
            px, py = x + sign * ux * d, y + sign * uy * d
            at = grid.rc(px, py)
            if at is None or not water[at]:
                break
            last = (px, py)
            d += grid.res / 2
        ends.append(last)
    line = shapely.LineString([ends[1], ends[0]])
    return line if line.length >= grid.res else None


def _direction(line: shapely.Geometry) -> tuple[float, float]:
    coords = np.asarray(line.coords)
    d = coords[-1] - coords[0]
    norm = math.hypot(*d) or 1.0
    return d[0] / norm, d[1] / norm


def cut_lines(
    grid: Grid,
    water: np.ndarray,
    barriers: list[tuple[str, shapely.Geometry]],
    waterways: list[shapely.Geometry],
) -> list[tuple[str, shapely.LineString]]:
    """Each barrier as a line across the water: a way extended along its
    ends until the water does (OSM draws many short of the DLM's bank), a
    node crossed at right angles to the nearest waterway."""
    out = []
    box = shapely.box(*grid.bounds)
    for kind, g in barriers:
        if not g.intersects(box):
            continue
        if isinstance(g, shapely.Point):
            near = min(waterways, key=lambda w: w.distance(g), default=None)
            if near is None or near.distance(g) > 10:
                continue
            d = near.project(g)
            a, b = near.interpolate(max(d - 2, 0)), near.interpolate(min(d + 2, near.length))
            ux, uy = _direction(shapely.LineString([a, b]))
            line = across(grid, water, g.x, g.y, -uy, ux)
        else:
            for part in shapely.get_parts(g):
                coords = np.asarray(part.coords)
                if len(coords) < 2:
                    continue
                ux, uy = _direction(part)
                head = across(grid, water, *coords[-1][:2], ux, uy)
                tail = across(grid, water, *coords[0][:2], -ux, -uy)
                pts = [coords[0][:2], *[c[:2] for c in coords[1:-1]], coords[-1][:2]]
                if tail is not None:
                    pts = [tail.coords[0], *pts]
                if head is not None:
                    pts = [*pts, head.coords[-1]]
                out += _inside(kind, shapely.LineString(pts), box, grid.res)
            continue
        if line is not None:
            out += _inside(kind, line, box, grid.res)
    return out


def _inside(
    kind: str, line: shapely.LineString, box: shapely.Geometry, least: float
) -> list[tuple[str, shapely.LineString]]:
    """The parts of a cut on the tile, `least` long at least."""
    return [
        (kind, p)
        for p in shapely.get_parts(line.intersection(box))
        if isinstance(p, shapely.LineString) and p.length >= least
    ]


def label_bodies(
    grid: Grid, water: np.ndarray, cuts: list[tuple[str, shapely.LineString]]
) -> tuple[np.ndarray, int]:
    """The water's bodies (4-connected), split along the cuts: a cut's cells
    belong to no body while they are labelled, then to the body beside
    them."""
    barrier = np.zeros(water.shape, bool)
    if cuts:
        barrier = rasterize(
            [(line, 1) for _, line in cuts],
            out_shape=water.shape,
            transform=grid.transform,
            all_touched=True,
            dtype=np.uint8,
        ).astype(bool)
    labels, n = ndi.label(water & ~barrier)
    on_cut = water & barrier & (labels == 0)
    if on_cut.any() and n:
        _, (ri, ci) = ndi.distance_transform_edt(labels == 0, return_indices=True)
        labels[on_cut] = labels[ri[on_cut], ci[on_cut]]
    return labels, n


# --- one surface per body ---------------------------------------------------------


def fills(z: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, int]:
    """Each body's fills: its cells connected (4-neighbours) at one height
    (within FILL_TOL) — every cell its own component where the DGM measured
    the water (0 = no water)."""
    n = z.shape[0]
    cells = labels > 0
    index = np.full(z.shape, -1, np.int64)
    index[cells] = np.arange(int(cells.sum()))
    rows, cols = [], []
    for dr, dc in ((0, 1), (1, 0)):
        a = (slice(0, n - dr), slice(0, n - dc))
        b = (slice(dr, n), slice(dc, n))
        join = cells[a] & (labels[a] == labels[b]) & (np.abs(z[a] - z[b]) <= FILL_TOL)
        rows.append(index[a][join])
        cols.append(index[b][join])
    size = int(cells.sum())
    edges = np.concatenate(rows), np.concatenate(cols)
    graph = coo_matrix((np.ones(len(edges[0]), np.int8), edges), shape=(size, size))
    count, part = connected_components(graph, directed=False)
    regions = np.zeros(z.shape, np.int32)
    regions[cells] = part + 1
    return regions, count


def _contacts(regions: np.ndarray, labels: np.ndarray, fill: np.ndarray) -> np.ndarray:
    """(region, neighbour region) for every pair of 4-neighbour cells of one
    body in two different fills, both ways."""
    n = regions.shape[0]
    pairs = []
    for dr, dc in ((0, 1), (1, 0)):
        a = (slice(0, n - dr), slice(0, n - dc))
        b = (slice(dr, n), slice(dc, n))
        ra, rb = regions[a], regions[b]
        touch = (ra > 0) & (rb > 0) & (ra != rb) & (labels[a] == labels[b])
        touch &= fill[ra] & fill[rb]
        pairs += [np.column_stack([ra[touch], rb[touch]]), np.column_stack([rb[touch], ra[touch]])]
    return np.concatenate(pairs) if pairs else np.zeros((0, 2), np.int64)


def _lifted_levels(z: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The fills (`fills`), each one's level, and its level once the lower
    ones are lifted (NaN = no fill): a fill is lifted when most of its edge with the
    other fills of its body lies more than STEP_M higher, at fills larger
    than itself — to the largest of them; the smallest first, so a chain
    (Oberhafen 0.0, the strip 0.2, the Elbe 2.0) ends at the top."""
    regions, count = fills(z, labels)
    area = np.bincount(regions.ravel(), minlength=count + 1).astype(np.float64)
    level = np.full(count + 1, np.nan)
    if count:
        level[1:] = ndi.median(z, regions, np.arange(1, count + 1))
    fill = area >= MIN_FILL_M2
    fill[0] = False
    level[~fill] = np.nan
    contacts = _contacts(regions, labels, fill)
    contacts = contacts[np.argsort(contacts[:, 0], kind="stable")]
    starts = np.searchsorted(contacts[:, 0], np.arange(count + 2))
    owner = np.arange(count + 1)

    def root(k: int) -> int:
        while owner[k] != k:
            owner[k] = owner[owner[k]]
            k = owner[k]
        return k

    for k in np.argsort(area[1:], kind="stable") + 1:
        mine = contacts[starts[k] : starts[k + 1], 1]
        if not fill[k] or len(mine) == 0:
            continue
        roots = np.array([root(int(o)) for o in mine])
        others = roots[roots != root(int(k))]
        higher = others[(level[others] - level[k] > STEP_M) & (area[others] > area[k])]
        if len(others) == 0 or len(higher) * 2 < len(others):
            continue
        best = max(set(higher.tolist()), key=lambda o: area[o])
        owner[k] = best
        area[best] += area[k]
    final = np.array([level[root(k)] for k in range(count + 1)])
    return regions, level, final


def lifts(z: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The DGM with each body's water made one surface — see the module doc
    — and the level each raised cell was lifted to (NaN elsewhere): the
    lifted fills, and round every fill the cells within LIFT_GROW of it
    that lie more than STEP_M under it (the DGM blends two fills over a
    cell or two, and dips at a quay's foot). Never lowered."""
    zz = np.nan_to_num(z, nan=-1e4)
    regions, level, final = _lifted_levels(zz, labels)
    target = np.where(regions > 0, final[regions], np.nan)
    # a fill that stays is not raised at its rim either: only the lifted
    # fills and the cells of no fill (the ramps, the dips) are
    stays = np.isfinite(level) & (final == level)
    eligible = (labels > 0) & ~stays[regions]
    near = np.full(z.shape, -np.inf)
    size = 2 * LIFT_GROW + 1
    for k, box in enumerate(ndi.find_objects(labels), start=1):
        if box is None:
            continue
        grown = tuple(
            slice(max(sl.start - LIFT_GROW, 0), min(sl.stop + LIFT_GROW, z.shape[i]))
            for i, sl in enumerate(box)
        )
        mine = labels[grown] == k
        t = np.where(mine & np.isfinite(target[grown]), target[grown], -np.inf)
        if not np.isfinite(t).any():
            continue
        near[grown] = np.where(mine, ndi.maximum_filter(t, size=size), near[grown])
    raise_to = np.where(eligible & (near - zz > STEP_M), near, np.nan)
    out = np.where(np.isfinite(raise_to), raise_to, z).astype(z.dtype)
    return out, raise_to


def lift_raster(raise_to: np.ndarray) -> dict | None:
    """The lifts as the terrain bake reads them: a greyscale PNG over the
    DGM's grid (base64), each texel 0 or 1 + the index of its level in
    `levels` (5 cm steps, at most 255)."""
    raised = np.isfinite(raise_to)
    if not raised.any():
        return None
    steps = np.round(raise_to[raised] / 0.05).astype(np.int64)
    levels, index = np.unique(steps, return_inverse=True)
    if len(levels) > 255:
        keep = np.argsort(-np.bincount(index))[:255]
        remap = {int(levels[i]): j for j, i in enumerate(sorted(keep))}
        levels = levels[sorted(keep)]
        index = np.array([remap.get(int(v), -1) for v in steps])
    img = np.zeros(raise_to.shape, np.uint8)
    img[raised] = index + 1
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG", optimize=True)
    return {
        "levels": [round(float(v) * 0.05, 2) for v in levels],
        "m2": int(raised.sum()),
        "png": base64.b64encode(buf.getvalue()).decode("ascii"),
    }


# --- the shore ------------------------------------------------------------------


def local_level(z: np.ndarray, water: np.ndarray) -> np.ndarray:
    """Each cell's water level nearby: a low percentile of the water's
    surface per LEVEL_BLOCK_M block, its median over LEVEL_WINDOW blocks
    (NaN far from water)."""
    n = z.shape[0]
    b = LEVEL_BLOCK_M
    nb = n // b
    zz = np.where(water, z, np.nan)[: nb * b, : nb * b].reshape(nb, b, nb, b)
    zz = zz.transpose(0, 2, 1, 3).reshape(nb, nb, b * b)
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN blocks: no water
        low = np.nanpercentile(zz, LEVEL_PCT, axis=2)
        low[np.sum(np.isfinite(zz), axis=2) < b] = np.nan
        pad = LEVEL_WINDOW // 2
        padded = np.pad(low, pad, constant_values=np.nan)
        win = np.lib.stride_tricks.sliding_window_view(padded, (LEVEL_WINDOW, LEVEL_WINDOW))
        level = np.nanmedian(win.reshape(nb, nb, -1), axis=2)
    full = np.repeat(np.repeat(level, b, axis=0), b, axis=1)
    out = np.full((n, n), np.nan, np.float32)
    out[: nb * b, : nb * b] = full
    return out


def dry_cells(z: np.ndarray, water: np.ndarray, level: np.ndarray) -> np.ndarray:
    """Water cells standing more than SHORE_M over the level nearby, not in
    a stream (NARROW_M): a patch on the bank (the class raster's water
    reaching onto a quay, a bank slope) of BANK_MIN_M2, out on the water (a
    bar, an island) of SHORE_MIN_M2."""
    wide = ndi.distance_transform_edt(water)
    wide = ndi.maximum_filter(wide, size=int(NARROW_M) * 2 + 1) * 2 >= NARROW_M
    with np.errstate(invalid="ignore"):
        dry = water & wide & (z > level + SHORE_M)
    lab, n = ndi.label(dry, np.ones((3, 3), bool))
    if n == 0:
        return dry
    area = np.bincount(lab.ravel(), minlength=n + 1)
    bank = np.zeros(n + 1, bool)
    bank[np.unique(lab[ndi.binary_dilation(~water) & dry])] = True
    keep = np.where(bank, area >= BANK_MIN_M2, area >= SHORE_MIN_M2)
    keep[0] = False
    return keep[lab]


def greenness(dop: np.ndarray) -> np.ndarray:
    """Where the DOP is green: the raw NDVI with infrared, the visible-band
    GLI without."""
    rgb = dop[:3].astype(np.float32)
    if dop.shape[0] >= 4:
        nir = dop[3].astype(np.float32)
        return (nir - rgb[0]) / (nir + rgb[0] + 1.0) >= GREEN_NDVI
    gli = (2 * rgb[1] - rgb[0] - rgb[2]) / (2 * rgb[1] + rgb[0] + rgb[2] + 1.0)
    return gli >= GREEN_GLI


# --- the tint ---------------------------------------------------------------------


def _lab(rgb: np.ndarray) -> np.ndarray:
    """8-bit sRGB (… × 3) → CIE L*a*b* (D65); lib/city/water-bodies.ts
    `srgbFromLab` goes back."""
    c = np.asarray(rgb, np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack(
        [116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1
    )


def colours(
    labels: np.ndarray, count: int, water: np.ndarray, dop: np.ndarray, lut: np.ndarray
) -> dict[int, tuple[list[float], int]]:
    """Each body's measured colour where it has CORE_MIN open-water cells
    CORE_M inside its bank: the median of their DOP pixels (the flight's
    cast taken out) in CIE L*a*b*, and how many cells it was read from —
    the build pools a body's reads across the tiles it spans."""
    core = ndi.distance_transform_edt(water) >= CORE_M
    rgb = dop_balance.balanced(dop[:3].copy(), lut, axis=0)
    out = {}
    for k in range(1, count + 1):
        cells = core & (labels == k)
        seen = int(cells.sum())
        if seen < CORE_MIN:
            continue
        px = rgb[:, cells].T
        if len(px) > 20_000:
            px = px[np.random.default_rng(k).choice(len(px), 20_000, replace=False)]
        lab = _lab(np.median(px.astype(np.float64), axis=0))
        out[k] = ([round(float(v), 2) for v in lab], seen)
    return out


def tint_grid(labels: np.ndarray, rows: dict[int, int]) -> dict | None:
    """Which body's colour is where: TINT_GRID² cells over the tile (row 0 =
    north), each the coloured body that covers most of it, filled out to the
    whole tile from the nearest (so a bilinear read at the bank blends no
    other colour in); `cells` are base64 bytes, 1 + the body's row in
    `bodies`. `rows` maps a coloured body's label to its row."""
    if not rows:
        return None
    n = labels.shape[0]
    g = TINT_GRID
    remap = np.zeros(int(labels.max()) + 1, np.int64)
    for k, row in rows.items():
        remap[k] = row + 1
    width = max(rows.values()) + 2
    coloured = remap[labels]
    cell = (np.arange(n) * g // n)[:, None] * g + (np.arange(n) * g // n)[None, :]
    keys = (cell * width + coloured)[coloured > 0]
    votes = np.bincount(keys, minlength=g * g * width).reshape(g * g, width)
    votes[:, 0] = 0
    cells = np.where(votes.max(axis=1) > 0, votes.argmax(axis=1), 0).reshape(g, g)
    if not cells.any():
        return None
    _, (ri, ci) = ndi.distance_transform_edt(cells == 0, return_indices=True)
    cells = cells[ri, ci].astype(np.uint8)
    return {"n": g, "cells": base64.b64encode(cells.tobytes()).decode("ascii")}


def edge_runs(cells: np.ndarray, surface: np.ndarray) -> dict[str, list[list[float]]]:
    """Where a body's cells touch the tile's edges: per side (n, s, w, e)
    the runs [from, to, z] of cells along it — from the west or the north,
    `to` exclusive, z the surface's median along the run — what the build
    joins a body to its neighbour tile's with (the same water meets at one
    height; a lock or a weir on the seam does not)."""
    sides = {
        "n": (cells[0], surface[0]),
        "s": (cells[-1], surface[-1]),
        "w": (cells[:, 0], surface[:, 0]),
        "e": (cells[:, -1], surface[:, -1]),
    }
    out = {}
    for side, (line, z) in sides.items():
        if not line.any():
            continue
        d = np.diff(np.concatenate([[0], line.astype(np.int8), [0]]))
        starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        out[side] = [
            [int(a), int(b), round(float(np.nanmedian(z[a:b])), 2)]
            for a, b in zip(starts, ends, strict=True)
        ]
    return out


# --- the foam -------------------------------------------------------------------


def surface_range(z: np.ndarray, water: np.ndarray, reach: int) -> np.ndarray:
    """Each water cell's surface range within `reach` cells along the water
    (4-neighbour steps through water only: another channel past a dyke is
    not this one)."""
    hi = np.where(water, z, -np.inf)
    lo = np.where(water, z, np.inf)
    for _ in range(reach):
        h, low = hi.copy(), lo.copy()
        for a, b in (
            ((slice(1, None), slice(None)), (slice(None, -1), slice(None))),
            ((slice(None, -1), slice(None)), (slice(1, None), slice(None))),
            ((slice(None), slice(1, None)), (slice(None), slice(None, -1))),
            ((slice(None), slice(None, -1)), (slice(None), slice(1, None))),
        ):
            np.maximum(h[a], hi[b], out=h[a])
            np.minimum(low[a], lo[b], out=low[a])
        hi = np.where(water, h, -np.inf)
        lo = np.where(water, low, np.inf)
    return np.where(water, hi - lo, 0.0)


def drop_zones(z: np.ndarray, water: np.ndarray) -> np.ndarray:
    """Water cells where the surface falls more than DROP_M within
    DROP_WINDOW_M along the water, as labelled zones of DROP_MIN_M2."""
    span = surface_range(np.nan_to_num(z), water, int(DROP_WINDOW_M) // 2)
    zone = ndi.binary_opening(water & (span > DROP_M), np.ones((3, 3), bool))
    lab, n = ndi.label(zone)
    if n == 0:
        return lab
    area = np.bincount(lab.ravel(), minlength=n + 1)[1:]
    keep = np.zeros(n + 1, np.int32)
    kept = np.flatnonzero(area >= DROP_MIN_M2) + 1
    keep[kept] = np.arange(1, len(kept) + 1)
    return keep[lab]


def _side_level(grid: Grid, z: np.ndarray, water: np.ndarray, line, ux, uy, d) -> float | None:
    """The surface's median along `line` shifted d m along (ux, uy), or
    None where under FOAM_SIDE_SHARE of it is on the water."""
    pts = [line.interpolate(t) for t in np.arange(0, line.length + 1e-6, grid.res)]
    vals = []
    for p in pts:
        at = grid.rc(p.x + ux * d, p.y + uy * d)
        if at is not None and water[at]:
            vals.append(z[at])
    return float(np.median(vals)) if len(vals) >= FOAM_SIDE_SHARE * len(pts) else None


def drop_lines(grid: Grid, z: np.ndarray, water: np.ndarray, zones: np.ndarray) -> list[dict]:
    """Each drop zone as foam: the line across the water through its
    steepest cell, at right angles to the fall, kept where the water on its
    high side stands DROP_M over the water on its low side along most of
    it (a bank slope inside the water class fails: one side is the bank)."""
    if zones.max() == 0:
        return []
    # smoothed over the water alone: the banks' slopes stay out of the fall
    share = ndi.gaussian_filter(water.astype(np.float32), 1.5)
    zs = ndi.gaussian_filter(np.where(water, np.nan_to_num(z), 0.0), 1.5)
    zs = zs / np.maximum(share, 1e-3)
    gy, gx = np.gradient(zs)  # per cell, rows grow south
    inner = ndi.distance_transform_edt(water) >= 2
    out = []
    for k in range(1, int(zones.max()) + 1):
        cells = (zones == k) & inner
        if not cells.any():
            continue
        fx, fy = float(gx[cells].mean()), float(-gy[cells].mean())  # uphill, EPSG axes
        norm = math.hypot(fx, fy)
        if norm == 0:
            continue
        ux, uy = fx / norm, fy / norm
        # the line crosses where the surface falls fastest along the fall
        steep = np.where(cells, gx * ux - gy * uy, -np.inf)
        r, c = np.unravel_index(int(np.argmax(steep)), steep.shape)
        x, y = grid.xy(r, c)
        line = across(grid, water, x, y, -uy, ux)
        if line is None or line.length < FOAM_MIN_M:
            continue
        high = _side_level(grid, z, water, line, ux, uy, DROP_WINDOW_M / 2)
        low = _side_level(grid, z, water, line, -ux, -uy, DROP_WINDOW_M / 2)
        if high is None or low is None or high - low <= DROP_M:
            continue
        out.append(foam_entry(line, high - low, (-ux, -uy)))
    return out


def foam_entry(line: shapely.LineString, drop: float, down: tuple[float, float] | None) -> dict:
    """A foam line as the sheet draws it: one segment, the line's two points
    farthest apart (a weir mapped as a bent way, or a ring, spans its
    chord), its drop and which way is down."""
    xy = shapely.get_coordinates(line)
    far = np.linalg.norm(xy[:, None, :] - xy[None, :, :], axis=-1)
    i, j = np.unravel_index(int(np.argmax(far)), far.shape)
    ends = [[round(float(x), 1), round(float(y), 1)] for x, y in (xy[i], xy[j])]
    entry = {"line": ends, "drop": round(drop, 1)}
    if down is not None:
        entry["down"] = [round(down[0], 2), round(down[1], 2)]
    return entry


def foam(
    grid: Grid,
    z: np.ndarray,
    water: np.ndarray,
    cuts: list[tuple[str, shapely.LineString]],
) -> list[dict]:
    """The tile's foam lines: its mapped weirs (the DGM's drop over them
    where it shows one) and the drops the DGM shows elsewhere; the biggest
    FOAM_MAX."""
    zones = drop_zones(z, water)
    found = drop_lines(grid, z, water, zones)
    weirs = []
    for kind, line in cuts:
        if kind not in FOAM_KINDS or shapely.minimum_bounding_radius(line) * 2 < FOAM_MIN_M:
            continue
        near = [f for f in found if shapely.LineString(f["line"]).distance(line) < DROP_WINDOW_M]
        drop = max((f["drop"] for f in near), default=WEIR_DROP_M)
        down = near[0].get("down") if near else None
        found = [f for f in found if f not in near]
        weirs.append(foam_entry(line, drop, tuple(down) if down else None))
    every = weirs + found
    every.sort(key=lambda f: -f["drop"] * shapely.LineString(f["line"]).length)
    return every[:FOAM_MAX]


# --- the bake -------------------------------------------------------------------


def site_tiles(tile: Tile) -> list[Tile]:
    """The site's tiles (every committed DGM beside this one): whose sunlit
    roads give the flight's cast (dop_balance.py)."""
    return [replace(tile, id=tid, bounds=b) for tid, b in tile.neighbours()] or [tile]


def bodies(tile: Tile, raster: np.ndarray) -> dict:
    """The water's bodies over the tile's class raster (in place: the dry
    shore re-classed), as the legend's `water` member: `bodies` (one row
    per body, `body_rows`), `lifts` (`lift_raster`), `shore` (m² re-classed),
    `foam` and `tint` (`tint_grid`)."""
    z, _ = read_dgm(tile)
    n = z.shape[0]
    grid = Grid(tile.bounds, n)
    water = (grid_classes(raster, n) == WATER) & np.isfinite(z)
    if not water.any():
        return {"bodies": [], "foam": []}
    osm = tile.osm_extract() is not None and has_extract(tile, "the weirs")
    barriers, axes = osm_barriers(tile) if osm else ([], [])
    cuts = cut_lines(grid, water, barriers, axes)
    labels, count = label_bodies(grid, water, cuts)
    surface, raised = lifts(z, labels)
    dry = dry_cells(surface, water, local_level(surface, water))
    dop = read_dop(tile, n)
    green = greenness(dop) if dop is not None else np.zeros_like(dry)
    shore = reclass(raster, dry, green)
    wet = water & ~dry
    seen = {}
    if dop is not None:
        lut = dop_balance.table(dop_balance.gains(site_tiles(tile)))
        seen = colours(labels, count, wet, dop, lut)
    rows, index = body_rows(grid, labels, count, surface, wet, seen)
    member: dict = {"bodies": rows, "shore": shore, "foam": foam(grid, surface, wet, cuts)}
    lift = lift_raster(raised)
    if lift is not None:
        member["lifts"] = lift
    tinted = {k: r for k, r in index.items() if "lab" in rows[r] and r < 254}
    tint = tint_grid(np.where(wet, labels, 0), tinted)
    if tint is not None:
        member["tint"] = tint
    return member


def reclass(raster: np.ndarray, dry: np.ndarray, green: np.ndarray) -> dict:
    """The dry cells' water texels re-classed, in place: meadow where the
    DOP is green; else the land beside them where that is built, rail or
    road (a quay's edge, a pier: within BANK_REACH_M), and sand (the path
    class) elsewhere — a beach, a gravel bar. m² of each."""
    n = dry.shape[0]
    idx = (np.arange(raster.shape[0]) * n // raster.shape[0]).astype(int)
    target = (raster == WATER) & dry[np.ix_(idx, idx)]
    if not target.any():
        return {"meadowM2": 0, "sandM2": 0, "bankM2": 0}
    green_hi = green[np.ix_(idx, idx)]
    dist, (ri, ci) = ndi.distance_transform_edt(raster == WATER, return_indices=True)
    texel = n / raster.shape[0]  # m per class texel (the DGM's 1 m cells)
    nearest = raster[ri, ci]
    built = np.isin(nearest, BANK_CLASSES) & (dist * texel <= BANK_REACH_M)
    meadow = target & green_hi
    bank = target & ~green_hi & built
    sand = target & ~green_hi & ~built
    raster[meadow] = MEADOW
    raster[bank] = nearest[bank]
    raster[sand] = SANDY
    a = texel * texel
    return {
        "meadowM2": round(float(meadow.sum() * a)),
        "sandM2": round(float(sand.sum() * a)),
        "bankM2": round(float(bank.sum() * a)),
    }


def body_rows(
    grid: Grid,
    labels: np.ndarray,
    count: int,
    surface: np.ndarray,
    wet: np.ndarray,
    seen: dict[int, tuple[list[float], int]],
) -> tuple[list[dict], dict[int, int]]:
    """One row per body of BODY_MIN_M2 or more — its level (the mode of its
    surface, 5 cm bins), its 5th–95th percentile, area and a point in it,
    its measured colour (`lab`, read from `core` cells) and where it meets
    the tile's edges (`edge_runs`) — and each body's row by its label."""
    rows, index = [], {}
    for k in range(1, count + 1):
        cells = wet & (labels == k)
        area = int(cells.sum())
        if area < BODY_MIN_M2:
            continue
        v = surface[cells]
        bins, counts = np.unique(np.round(v / 0.05).astype(np.int64), return_counts=True)
        r, c = np.argwhere(cells)[len(v) // 2]
        x, y = grid.xy(r, c)
        row: dict = {
            "level": round(float(bins[np.argmax(counts)] * 0.05), 2),
            "range": [round(float(np.percentile(v, 5)), 2), round(float(np.percentile(v, 95)), 2)],
            "m2": area,
            "at": [round(x, 1), round(y, 1)],
        }
        if k in seen:
            row["lab"], row["core"] = seen[k]
        edges = edge_runs(cells, surface)
        if edges:
            row["edges"] = edges
        index[k] = len(rows)
        rows.append(row)
    return rows, index
