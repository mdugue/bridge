"""OSM cultivated land → allotment colonies, orchards and vineyards: what
the DLM burns into one class (vineyards, orchards and garden land into
meadow, the colonies into built-up) without reading the attribute that tells
them apart (plan 028). No new land-cover class: the palette and the class
raster stay as they are (ADR 0023); this is dressing.

`cultivated_<tile>.geojson` (OSM, ODbL), in the tile's CRS:

    Polygon/MultiPolygon {k: "colony"}    a `landuse=allotments` colony
    Polygon/MultiPolygon {k: "parcel"}    a `leisure=garden` plot inside one
                                          (where mapped — none is in
                                          Dresden's four tiles)
    Polygon/MultiPolygon {k: "orchard"}   `landuse=orchard`
    Point {k: "tree", h, d, src, g?, l?}  an orchard tree: at each crown peak
                                          DOM1 shows inside it, 2–12 m, as
                                          tall as measured (src "dom");
                                          without DOM1 the mapped
                                          `natural=tree` inside it, else an
                                          8 m grid along its long axis
                                          (src "osm" | "grid"); the tile's own,
                                          less those a measured tree (canopy,
                                          canopyx, trees — any tile's) stands
                                          in for: this step runs after lowveg.
                                          `g` its genus from the orchard's
                                          `trees=*` (ORCHARD_GENERA), `l: "e"`
                                          a Christmas-tree plantation's
    Polygon/MultiPolygon {k: "vineyard",  `landuse=vineyard`, with the way its
        dir, gap, src}                    rows run (`dir`, degrees from east),
                                          how far apart (`gap`, m) and what
                                          told it (`src`, `vine_layout`)
    LineString {k: "row"}                 a vine row: `gap` apart at `dir`

Everything is clipped to the tile. The project keeps what the data carries
and invents nothing (furniture.py's rule): no synthetic parcel grid, no
generated sheds — the sheds are in LoD2, the hedges are lowveg.py's.

`cultivated_<tile>.png` (2048², ≈1 m) is two bytes per texel interleaved in
an 8-bit greyscale PNG twice as wide (R0 G0 R1 G1 …, lib/city/png-raster.ts):

    R = 128 + 20 · the signed distance (m) to the edge of the garden land,
        positive inside, clamped to 1..255 (±6.35 m); 0 where it is farther
        outside. The garden land is the colony less its paths (OSM
        footways, paths, service roads, tracks), roads, rail and water, and
        less a 0.5 m seam along each mapped parcel's border. The distance
        is measured at 0.5 m and averaged onto the grid, so the viewer's
        LINEAR sample has a smooth edge, not the raster's staircase
    G = 1 + o, o = the plots' axis over 0–180° in 0..126 of the colony (or
        the long axis of the mapped parcel) the texel lies in or nearest
        to, within `AXIS_REACH_M` outside it; 0 elsewhere. A colony's plots
        line its paths: the axis is its mapped footways' prevailing
        direction (`path_axis`), its long axis where none is mapped — the
        long axis ran across the paths in a quarter of Dresden's colonies

The terrain shader paints the gardens on it (app/_components/cultivated-
layer.ts); prepare-data crops it to the texels that carry a colony.
"""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
import shapely
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.windows import Window, from_bounds
from scipy import ndimage as ndi
from skimage.feature import peak_local_max

from .canopy import built_mask
from .common import (
    OSM_ATTRIBUTION,
    Tile,
    column,
    feature,
    geometry_json,
    overlaps,
    owns,
    save_grey_png,
    write_geojson,
)
from .osm import has_extract, read_osm, read_ways, tag
from .skyview import Field, dgm_field

ORCHARD_SPACING_M = 8.0
ORCHARD_TREE_H = 4.5  # m: a standard fruit tree, crown base ≈ 1.3 m ("small")
ORCHARD_TREE_D = 4.0
# An orchard's trees where DOM1 reaches it (`orchard_dom`): a crown peak of
# DOM1 − DGM1 smoothed by ORCHARD_SIGMA_M, ORCHARD_PEAK_PX texels (1 m) from
# the next, between the heights of ORCHARD_PEAK_H — under them grass and
# bushes, over them a windbreak's poplars (the canopy's) — off every LoD2
# outline (the sheds); its crown ORCHARD_CROWN_TO_HEIGHT of its height
# across, within ORCHARD_CROWN_D. Dresden's rail-embankment "orchard" got
# four trees on the 8 m grid where none stands.
ORCHARD_PEAK_H = (2.0, 12.0)
ORCHARD_SIGMA_M = 1.0
ORCHARD_PEAK_PX = 2
ORCHARD_CROWN_TO_HEIGHT = 0.85
ORCHARD_CROWN_D = (2.0, 9.0)
# OSM's `trees=*` on an orchard → its trees' genus (lib/city/tree-season.ts
# TREE_GENERA), or "conifer": a Christmas-tree plantation's firs.
ORCHARD_GENERA = {
    "apple_trees": "Malus",
    "pear_trees": "Pyrus",
    "cherry_trees": "Prunus",
    "plum_trees": "Prunus",
    "apricot_trees": "Prunus",
    "peach_trees": "Prunus",
    "almond_trees": "Prunus",
    "walnut_trees": "Juglans",
    "hazel_plants": "Corylus",
    "christmas_trees": "conifer",
}
# …and, where an orchard names no `trees=*`, its `produce=*`.
ORCHARD_PRODUCE = {
    "apple": "Malus",
    "pear": "Pyrus",
    "cherry": "Prunus",
    "plum": "Prunus",
    "apricot": "Prunus",
    "peach": "Prunus",
    "walnut": "Juglans",
    "hazelnut": "Corylus",
}
# A vineyard's rows (`vine_layout`): their direction and spacing are the
# orthophoto's (`dop_rows`): the strongest wave between VINE_PERIOD_M in the
# spectrum of VINE_WINDOW_M windows VINE_STEP_M apart, at least
# VINE_INSIDE of each in the vineyard, where it stands VINE_PEAK_RATIO over
# the median of its band (Meißen's rows 300–12 000, a window of grass or
# noise under 30), the direction VINE_MAJORITY of the windows' weight agrees
# on. Without one (no orthophoto, a young or a fallow vineyard) the slope
# tells: under VINE_STEEP the rows run down the fall
# line (Meißen's at 3–12 % 2.2–3.1 m apart), above it along the contour (its
# terraces at 29–46 %), VINE_ROW_SPACING_M apart.
VINE_ROW_SPACING_M = 2.3
VINE_STEEP = 0.25
VINE_WINDOW_M = 40.0
VINE_STEP_M = 20.0
VINE_INSIDE = 0.5
VINE_PERIOD_M = (1.5, 3.6)
VINE_PEAK_RATIO = 30.0
VINE_AGREE_DEG = 15.0  # the windows that agree on the rows' direction
VINE_MAJORITY = 0.5
VINE_DOMINANCE = 0.5  # a rival wave this strong leaves the spacing unknown
VINE_FFT = 512  # the window zero-padded to this many texels a side
# A colony's plots line its paths (`path_axis`): their prevailing direction,
# the mode of the paths inside it (length-weighted, PATH_AXIS_BIN_DEG bins),
# once at least PATH_AXIS_MIN_M of them are mapped.
PATH_AXIS_MIN_M = 40.0
PATH_AXIS_BIN_DEG = 5
PATH_KINDS = ("footway", "path", "service", "track")
# A measured tree (the DOM1 canopy, a laser-scan crown, the cadastre or a
# classified OSM tree in trees_<tile>) this close to an orchard tree stands in
# its place: half the grid spacing, or the measured crown's radius when
# wider. Without it 13 crowns stood beside an orchard tree (2026-09-26).
ORCHARD_CLEAR_M = ORCHARD_SPACING_M / 2
MEASURED_TREES = ("canopy", "canopyx", "trees")
PARCEL_MIN_SHARE = 0.5  # a garden is a colony's parcel when half of it lies inside
PATH_HALF_WIDTH = {"footway": 1.0, "path": 1.0, "service": 2.5, "track": 1.5, "steps": 1.0}
NO_BEDS = (5, 7, 8)  # rail, road, water
EDGE_SCALE = 20.0
PARCEL_SEAM_M = 0.25  # half the seam carved along a mapped parcel's border
AXIS_REACH_M = 8.0  # the axis spreads this far past the garden land's edge
FINE = 2  # the distance is measured on a grid this many times finer


def long_axis(g: shapely.Geometry) -> float:
    """The minimum rotated rectangle's long axis (radians from east, 0..π)."""
    ring = np.asarray(shapely.minimum_rotated_rectangle(g).exterior.coords)[:4]
    if len(ring) < 4:
        return 0.0
    edges = np.diff(np.vstack([ring, ring[:1]]), axis=0)
    dx, dy = edges[int(np.argmax(np.hypot(*edges.T)))]
    return math.atan2(dy, dx) % math.pi


def axis_code(angle: float) -> int:
    """0..π → 0..126."""
    return int(round((angle % math.pi) / math.pi * 126)) % 127


def parcels_of(colony: shapely.Geometry, gardens: list[shapely.Geometry]) -> list:
    """The mapped gardens that are this colony's plots."""
    out = []
    for g in gardens:
        if g.area <= 0 or g.area >= 0.5 * colony.area:
            continue
        if shapely.intersection(g, colony).area >= PARCEL_MIN_SHARE * g.area:
            out.append(g)
    return out


def grid_trees(orchard: shapely.Geometry, spacing: float = ORCHARD_SPACING_M) -> list:
    """An orchard's trees on a grid along its long axis: as many rows and
    columns as fit `spacing` apart, centred on its minimum rotated
    rectangle (so the outer trees stand about half a spacing in), and only
    those inside the orchard."""
    angle = long_axis(orchard)
    c = shapely.minimum_rotated_rectangle(orchard).centroid
    u = np.array([math.cos(angle), math.sin(angle)])
    v = np.array([-u[1], u[0]])
    rel = shapely.get_coordinates(orchard) - [c.x, c.y]
    a, b = rel @ u, rel @ v

    def centred(lo: float, hi: float) -> np.ndarray:
        n = max(1, int((hi - lo) // spacing))
        return (lo + hi) / 2 + (np.arange(n) - (n - 1) / 2) * spacing

    inner = orchard.buffer(-min(spacing / 2 - 0.5, 1.0))
    out = []
    for i in centred(a.min(), a.max()):
        for j in centred(b.min(), b.max()):
            p = np.array([c.x, c.y]) + i * u + j * v
            if inner.contains(shapely.Point(p)):
                out.append((float(p[0]), float(p[1])))
    return out


def crown_peaks(ndom: np.ndarray, inside: np.ndarray) -> list[tuple[int, int, float]]:
    """(row, col, height) of each crown peak of `ndom` within `inside`: a
    local maximum of the surface there smoothed by ORCHARD_SIGMA_M,
    ORCHARD_PEAK_PX from the next, whose crown top (the highest texel beside
    it) lies in ORCHARD_PEAK_H. What lies outside is cut before smoothing,
    so a roof beside the orchard lends no crown its height."""
    lo, hi = ORCHARD_PEAK_H
    z = np.where(inside & np.isfinite(ndom), ndom, 0.0)
    smooth = ndi.gaussian_filter(z, ORCHARD_SIGMA_M)
    top = ndi.maximum_filter(z, size=3)
    found = peak_local_max(
        np.where(inside, smooth, 0.0),
        min_distance=ORCHARD_PEAK_PX,
        threshold_abs=lo / 2,
        exclude_border=False,
    )
    keep = [(r, c) for r, c in found if inside[r, c] and lo <= top[r, c] <= hi]
    return [(int(r), int(c), float(top[r, c])) for r, c in keep]


def orchard_dom(tile: Tile, orchard: shapely.Geometry, built: np.ndarray) -> list[tuple]:
    """The orchard's trees DOM1 shows on this tile, as (x, y, height):
    `crown_peaks` of DOM1 − DGM1 inside it and off every LoD2 outline
    (`built`, on DOM1's grid: a shed's roof is no crown)."""
    xmin, ymin, xmax, ymax = tile.bounds
    ox0, oy0, ox1, oy1 = orchard.bounds
    c0, c1 = max(0, math.floor(ox0 - xmin) - 2), min(built.shape[1], math.ceil(ox1 - xmin) + 2)
    r0, r1 = max(0, math.floor(ymax - oy1) - 2), min(built.shape[0], math.ceil(ymax - oy0) + 2)
    if c1 <= c0 or r1 <= r0:
        return []
    window = Window(c0, r0, c1 - c0, r1 - r0)
    with rasterio.open(tile.raw_raster("dom1")) as dom, rasterio.open(tile.dgm) as dgm:
        ndom = dom.read(1, window=window).astype(np.float64)
        ndom -= dgm.read(1, window=window).astype(np.float64)
        transform = dom.window_transform(window)
    mask = rasterize([(orchard, 1)], out_shape=ndom.shape, transform=transform, dtype=np.uint8)
    inside = mask.astype(bool) & ~built[r0:r1, c0:c1]
    peaks = crown_peaks(ndom, inside)
    if not peaks:
        return []
    rows, cols, tops = zip(*peaks, strict=True)
    xs, ys = rasterio.transform.xy(transform, rows, cols)
    return [(float(x), float(y), h) for x, y, h in zip(xs, ys, tops, strict=True)]


def orchard_genus(other_tags: str | None) -> str | None:
    """The genus of an orchard's trees from its `trees=*` (ORCHARD_GENERA;
    the first known of a `;` list), else its `produce=*` (ORCHARD_PRODUCE);
    None where it names none."""
    for key, table in (("trees", ORCHARD_GENERA), ("produce", ORCHARD_PRODUCE)):
        for value in (tag(other_tags, key) or "").split(";"):
            genus = table.get(value.strip())
            if genus:
                return genus
    return None


def orchard_props(genus: str | None, height: float | None = None) -> dict:
    """An orchard tree's properties: measured (`height`, its crown
    ORCHARD_CROWN_TO_HEIGHT of it across) or the standard tree's;
    its genus, or `l: "e"` for a Christmas-tree plantation's."""
    if height is None:
        props = {"k": "tree", "h": ORCHARD_TREE_H, "d": ORCHARD_TREE_D}
    else:
        lo, hi = ORCHARD_CROWN_D
        d = min(max(ORCHARD_CROWN_TO_HEIGHT * height, lo), hi)
        props = {"k": "tree", "h": round(height, 1), "d": round(d, 1)}
    if genus == "conifer":
        props["l"] = "e"
    elif genus:
        props["g"] = genus
    return props


def mean_gradient(tile: Tile, g: shapely.Geometry) -> tuple[float, float] | None:
    """The DGM's mean gradient over the polygon (dz/dx east, dz/dy north),
    read over the whole polygon from every committed DGM it touches
    (skyview.py's `Tile.neighbours`), so a vineyard across a seam gets one
    answer on both tiles — this tile's DGM alone kinked its rows at the
    seam. None where the DGMs hold too little of it."""
    xmin, ymin, xmax, ymax = g.bounds
    # whole metres, one cell of margin: the DGM1's own grid, copied not resampled
    field = Field(
        (math.floor(xmin) - 1, math.floor(ymin) - 1, math.ceil(xmax) + 1, math.ceil(ymax) + 1),
        1.0,
    )
    z = dgm_field(tile, field, tile.neighbours()).astype(np.float64)
    mask = rasterize([(g, 1)], out_shape=field.shape, transform=field.transform, dtype=np.uint8)
    gy, gx = np.gradient(z, field.res)  # rows grow south: dz/dy_north = −gy
    inside = mask.astype(bool) & np.isfinite(gx) & np.isfinite(gy)
    if inside.sum() < 4:
        return None
    return float(gx[inside].mean()), float(-gy[inside].mean())


def slope_layout(tile: Tile, g: shapely.Geometry) -> tuple[float, str]:
    """The vine rows' direction where the orthophoto shows none (radians
    from east) and what decided it: under VINE_STEEP down the fall line
    ("fall"), above it along the contour ("contour"); a flat (under 1 %)
    or DGM-less vineyard along its long axis ("axis")."""
    grad = mean_gradient(tile, g)
    if grad is None or math.hypot(*grad) < 0.01:
        return long_axis(g), "axis"
    fall = math.atan2(grad[1], grad[0]) % math.pi
    if math.hypot(*grad) < VINE_STEEP:
        return fall, "fall"
    return (fall + math.pi / 2) % math.pi, "contour"


def dop_grey(tile: Tile, bounds: tuple[float, float, float, float], res: float) -> np.ndarray:
    """The orthophoto's brightness (the mean of its visible bands) over
    `bounds` at `res` m, north up, from every tile's DOP it reaches — across
    a seam too, so a vineyard on two tiles reads one photo; NaN where none
    has one."""
    xmin, ymin, xmax, ymax = bounds
    w, h = round((xmax - xmin) / res), round((ymax - ymin) / res)
    out = np.full((h, w), np.nan, np.float32)
    for tid, b in tile.neighbours():
        path = tile.raw / "dop" / f"{tid}.tif"
        lo = (max(xmin, b[0]), max(ymin, b[1]), min(xmax, b[2]), min(ymax, b[3]))
        if not path.exists() or lo[0] >= lo[2] or lo[1] >= lo[3]:
            continue
        c0, r0 = round((lo[0] - xmin) / res), round((ymax - lo[3]) / res)
        c1, r1 = round((lo[2] - xmin) / res), round((ymax - lo[1]) / res)
        if c1 <= c0 or r1 <= r0:
            continue
        with rasterio.open(path) as src:
            bands = src.read(
                (1, 2, 3),
                window=from_bounds(*lo, transform=src.transform),
                out_shape=(3, r1 - r0, c1 - c0),
                resampling=Resampling.average,
            )
        out[r0:r1, c0:c1] = bands.astype(np.float32).mean(axis=0)
    return out


def window_wave(patch: np.ndarray, res: float) -> tuple[float, float | None, float] | None:
    """The strongest wave of a DOP window between VINE_PERIOD_M as (rows'
    direction, radians from east; spacing, m; its peak over the median of
    the band) — None where the window has no data or no wave stands out.
    The spacing is None where another wave in that direction, past the
    peak's own lobe, reaches VINE_DOMINANCE of it: the harmonics of a
    terrace's walls (Dresden's, every 12–15 m) or of a stony slope show
    which way the rows run, not how far apart."""
    if not np.isfinite(patch).all() or patch.std() < 1.0:
        return None
    n = patch.shape[0]
    hann = np.outer(np.hanning(n), np.hanning(patch.shape[1]))
    power = np.abs(np.fft.rfft2((patch - patch.mean()) * hann, s=(VINE_FFT, VINE_FFT))) ** 2
    fy = np.fft.fftfreq(VINE_FFT, res)[:, None]  # cycles per m, rows grow south
    fx = np.fft.rfftfreq(VINE_FFT, res)[None, :]
    f = np.hypot(fx, fy)
    band = (f >= 1 / VINE_PERIOD_M[1]) & (f <= 1 / VINE_PERIOD_M[0])
    i = int(np.argmax(np.where(band, power, -1.0)))
    peak, ratio = power.flat[i], power.flat[i] / max(float(np.median(power[band])), 1e-12)
    if peak <= 0 or ratio < VINE_PEAK_RATIO:
        return None
    r, c = divmod(i, power.shape[1])
    east, north = float(fx[0, c]), float(-fy[r, 0])
    # the same direction (or its opposite), past the main lobe of the window
    turn = np.abs(
        (np.arctan2(-fy, fx) - math.atan2(north, east) + math.pi / 2) % math.pi - math.pi / 2
    )
    lobe = 2.5 / (patch.shape[0] * res)  # a Hann window's main lobe, cycles per m
    rival = band & (turn <= math.radians(VINE_AGREE_DEG / 3)) & (np.abs(f - f[r, c]) > lobe)
    alone = not rival.any() or float(power[rival].max()) < VINE_DOMINANCE * peak
    # the wave runs across the rows: they lie perpendicular to it
    rows = (math.atan2(north, east) + math.pi / 2) % math.pi
    return rows, (1 / float(f[r, c]) if alone else None), float(ratio)


def dop_rows(tile: Tile, g: shapely.Geometry, res: float = 0.2) -> tuple[float, float] | None:
    """The vine rows the orthophoto shows in the vineyard as (direction,
    radians from east; spacing, m): each VINE_WINDOW_M window VINE_STEP_M
    apart that lies at least VINE_INSIDE in it votes with its wave
    (`window_wave`), weighted by how far the wave stands out; the
    direction most of the weight agrees on (within VINE_AGREE_DEG) wins
    when it holds VINE_MAJORITY of it: the mean and the median spacing of
    the windows that agree and know theirs (else VINE_ROW_SPACING_M). None
    where no window shows rows (no photo, a young or a fallow vineyard) or
    they disagree."""
    xmin, ymin, xmax, ymax = g.bounds
    half = VINE_WINDOW_M / 2
    cx = np.arange(xmin + half, max(xmax - half, xmin + half) + 1e-6, VINE_STEP_M)
    cy = np.arange(ymin + half, max(ymax - half, ymin + half) + 1e-6, VINE_STEP_M)
    boxes = [shapely.box(x - half, y - half, x + half, y + half) for y in cy for x in cx]
    boxes = [b for b in boxes if shapely.intersection(b, g).area >= VINE_INSIDE * b.area]
    if not boxes:
        return None
    reach = shapely.union_all(boxes).bounds
    grey = dop_grey(tile, reach, res)
    n = round(VINE_WINDOW_M / res)
    votes = []
    for b in boxes:
        c0, r0 = round((b.bounds[0] - reach[0]) / res), round((reach[3] - b.bounds[3]) / res)
        wave = window_wave(grey[r0 : r0 + n, c0 : c0 + n], res)
        if wave is not None:
            votes.append(wave)
    if not votes:
        return None
    a, w = np.array([v[0] for v in votes]), np.array([v[2] for v in votes])
    s = np.array([v[1] for v in votes], dtype=object)
    apart = np.abs((a[:, None] - a[None, :] + math.pi / 2) % math.pi - math.pi / 2)
    agree = apart <= math.radians(VINE_AGREE_DEG)
    best = agree[int(np.argmax(agree @ w))]
    if w[best].sum() < VINE_MAJORITY * w.sum():
        return None
    mean = np.angle(np.sum(w[best] * np.exp(2j * a[best]))) / 2
    gaps = [g for g in s[best] if g is not None]
    return float(mean % math.pi), float(np.median(gaps)) if gaps else VINE_ROW_SPACING_M


def vine_layout(tile: Tile, g: shapely.Geometry) -> tuple[float, float, str]:
    """A vineyard's rows: (direction, radians from east; spacing, m; what
    told it — "dop", else `slope_layout`'s)."""
    seen = dop_rows(tile, g)
    if seen is not None:
        return seen[0], seen[1], "dop"
    angle, src = slope_layout(tile, g)
    return angle, VINE_ROW_SPACING_M, src


def path_axis(colony: shapely.Geometry, lines) -> float | None:
    """The direction the colony's mapped paths (PATH_KINDS lines) mostly run
    inside it (radians from east, 0..π): the PATH_AXIS_BIN_DEG bin that
    holds the most of their length, and with its neighbours the
    length-weighted mean of their segments. None under PATH_AXIS_MIN_M."""
    seg_a, seg_w = [], []
    for line in lines:
        for part in shapely.get_parts(shapely.intersection(line, colony)):
            xy = shapely.get_coordinates(part)
            if len(xy) < 2:
                continue
            d = np.diff(xy, axis=0)
            seg_a.append(np.arctan2(d[:, 1], d[:, 0]) % math.pi)
            seg_w.append(np.hypot(d[:, 0], d[:, 1]))
    if not seg_a or float(np.concatenate(seg_w).sum()) < PATH_AXIS_MIN_M:
        return None
    a, w = np.concatenate(seg_a), np.concatenate(seg_w)
    bins = 180 // PATH_AXIS_BIN_DEG
    hist = np.bincount((np.degrees(a) // PATH_AXIS_BIN_DEG).astype(int) % bins, w, bins)
    near = hist + np.roll(hist, 1) + np.roll(hist, -1)
    centre = math.radians((int(np.argmax(near)) + 0.5) * PATH_AXIS_BIN_DEG)
    off = np.abs((a - centre + math.pi / 2) % math.pi - math.pi / 2)
    keep = off <= math.radians(1.5 * PATH_AXIS_BIN_DEG)
    return float((np.angle(np.sum(w[keep] * np.exp(2j * a[keep]))) / 2) % math.pi)


def vine_rows(g: shapely.Geometry, angle: float, spacing: float = VINE_ROW_SPACING_M) -> list:
    """Row lines at `angle`, `spacing` apart, clipped to the polygon."""
    u = np.array([math.cos(angle), math.sin(angle)])
    v = np.array([-u[1], u[0]])
    c = np.asarray(g.centroid.coords[0])
    rel = shapely.get_coordinates(g) - c
    a, b = rel @ u, rel @ v
    out = []
    for k in np.arange(math.floor(b.min() / spacing), math.ceil(b.max() / spacing) + 1):
        off = c + v * (k + 0.5) * spacing
        line = shapely.LineString([off + u * (a.min() - 1), off + u * (a.max() + 1)])
        for part in shapely.get_parts(shapely.intersection(line, g)):
            if part.geom_type == "LineString" and part.length >= 1.0:
                out.append(part)
    return out


def signed_distance(inside: np.ndarray, res: float) -> np.ndarray:
    """Metres from each cell centre to the edge of `inside` (positive
    inside): the edge lies half a cell past the last cell centre."""
    if not inside.any():
        return np.full(inside.shape, -np.inf)
    if inside.all():
        return np.full(inside.shape, np.inf)
    din = ndi.distance_transform_edt(inside)
    dout = ndi.distance_transform_edt(~inside)
    return np.where(inside, din - 0.5, -(dout - 0.5)) * res


def colony_raster(
    tile: Tile,
    px: int,
    colonies: list,
    parcels: list,
    paths: list,
    cls: np.ndarray | None,
    axes: list | None = None,
) -> np.ndarray:
    """The R and G planes (see the module docstring), (px, px, 2); `axes`
    the colonies' plot axes (`path_axis`), their long axes where None."""
    fine = px * FINE
    res = (tile.bounds[2] - tile.bounds[0]) / fine
    transform = tile.transform(fine)
    if axes is not None:
        axes = [a for c, a in zip(colonies, axes, strict=True) if not c.is_empty]
    colonies = [c for c in colonies if not c.is_empty]
    if not colonies:
        return np.zeros((px, px, 2), np.uint8)
    garden = rasterize(
        [(c, 1) for c in colonies], out_shape=(fine, fine), transform=transform, dtype=np.uint8
    ).astype(bool)
    cuts = list(paths) + [
        shapely.buffer(shapely.boundary(p), PARCEL_SEAM_M) for p in parcels if not p.is_empty
    ]
    if cuts:
        garden &= ~rasterize(
            [(c, 1) for c in cuts], out_shape=(fine, fine), transform=transform, dtype=np.uint8
        ).astype(bool)
    if cls is not None:
        idx = (np.arange(fine) * cls.shape[0]) // fine
        garden &= ~np.isin(cls[np.ix_(idx, idx)], NO_BEDS)
    d = signed_distance(garden, res).reshape(px, FINE, px, FINE).mean(axis=(1, 3))
    q = np.round(128 + EDGE_SCALE * np.clip(d, -6.35, 6.35))
    r = np.where(d < -6.3, 0, np.clip(q, 1, 255)).astype(np.uint8)
    # the axis: each colony's, a mapped parcel's over it; spread outward to
    # the nearest texel that has one, as far as the fade reaches
    coarse = tile.transform(px)
    axes = axes if axes is not None else [None] * len(colonies)
    shapes = [
        (c, 1 + axis_code(long_axis(c) if a is None else a))
        for c, a in zip(colonies, axes, strict=True)
    ]
    shapes += [(p, 1 + axis_code(long_axis(p))) for p in parcels if not p.is_empty]
    g = rasterize(shapes, out_shape=(px, px), transform=coarse, dtype=np.uint8)
    if g.any():
        dist, (ri, ci) = ndi.distance_transform_edt(g == 0, return_indices=True)
        reach = dist * (tile.bounds[2] - tile.bounds[0]) / px <= AXIS_REACH_M
        g = np.where(reach, g[ri, ci], 0).astype(np.uint8)
    g = np.where(r > 0, g, 0).astype(np.uint8)
    return np.stack([r, g], axis=-1)


def clip_features(tile: Tile, geoms, kind: str, props: dict | None = None) -> list[dict]:
    box = shapely.box(*tile.bounds)
    out = []
    for geom in geoms:
        clipped = shapely.intersection(shapely.make_valid(geom), box)
        polys = [p for p in shapely.get_parts(clipped) if p.geom_type == "Polygon" and p.area > 1]
        if polys:
            shape = polys[0] if len(polys) == 1 else shapely.MultiPolygon(polys)
            out.append(feature(geometry_json(shape), {"k": kind, **(props or {})}))
    return out


def measured_trees(tile: Tile, near: tuple[float, float, float, float]) -> tuple:
    """The measured trees (MEASURED_TREES files) of every tile whose extent
    reaches `near`, as (xy, crown radius) — across a seam too."""
    xy, r = [], []
    for tid, b in tile.neighbours():
        if not overlaps(b, near):
            continue
        for kind in MEASURED_TREES:
            path = tile.data / "dlm" / f"{kind}_{tid}.geojson"
            if not path.exists():
                continue
            for f in json.loads(path.read_text())["features"]:
                geom, props = f.get("geometry"), f.get("properties") or {}
                if not geom or geom.get("type") != "Point":
                    continue
                xy.append(geom["coordinates"][:2])
                r.append(float(props.get("r") or props.get("d", 0) / 2 or 0))
    return np.asarray(xy, np.float64).reshape(-1, 2), np.asarray(r, np.float64)


def unclaimed(points: list, measured: tuple | None) -> list:
    """The orchard trees ((x, y, …)) no measured tree stands in for
    (ORCHARD_CLEAR_M, or its crown radius when wider)."""
    if measured is None or not len(measured[0]) or not points:
        return points
    xy, r = measured
    reach = np.maximum(r, ORCHARD_CLEAR_M)
    out = []
    for p in points:
        d = np.hypot(xy[:, 0] - p[0], xy[:, 1] - p[1])
        if not (d <= reach).any():
            out.append(p)
    return out


def orchard_features(
    tile: Tile, orchard, trees, measured: tuple | None, genus: str | None, built
) -> list[dict]:
    """One orchard's trees on this tile (the module docstring): DOM1's
    where the tile has it (`built` its LoD2 mask, else None), else the
    mapped ones, else the grid; less those a measured tree stands in for."""
    if built is not None:
        spots, src = orchard_dom(tile, orchard, built), "dom"
    else:
        mapped = [(p.x, p.y, None) for p in trees if orchard.contains(p)]
        spots = mapped or [(x, y, None) for x, y in grid_trees(orchard)]
        src = "osm" if mapped else "grid"
    out = []
    for x, y, h in unclaimed(spots, measured):
        if owns(tile.bounds, x, y):
            props = {**orchard_props(genus, h), "src": src}
            out.append(feature({"type": "Point", "coordinates": [round(x, 1), round(y, 1)]}, props))
    return out


def vineyard_features(tile: Tile, vineyard) -> tuple[list[dict], tuple[float, float, str]]:
    """A vineyard on this tile with its rows (`vine_layout`), and the
    layout."""
    box = shapely.box(*tile.bounds)
    angle, gap, src = vine_layout(tile, vineyard)
    props = {"dir": round(math.degrees(angle), 1), "gap": round(gap, 2), "src": src}
    feats = clip_features(tile, [vineyard], "vineyard", props)
    for row in vine_rows(vineyard, angle, gap):
        for part in shapely.get_parts(shapely.intersection(row, box)):
            if part.geom_type == "LineString" and part.length >= 1.0:
                feats.append(feature(geometry_json(part), {"k": "row"}))
    return feats, (angle, gap, src)


def build(
    tile: Tile,
    areas,
    landuse,
    leisure,
    trees,
    paths_in,
    measured: tuple | None = None,
    *,
    tags: list | None = None,
    built: np.ndarray | None = None,
    path_lines: list | None = None,
) -> tuple[list[dict], dict]:
    """The tile's features and what the raster needs. `tags` the areas'
    `other_tags` (an orchard's `trees=*`), `built` the tile's LoD2 mask on
    DOM1's grid where it has DOM1 (`orchard_features`), `path_lines` the
    PATH_KINDS lines a colony's plot axis follows (`path_axis`)."""
    box = shapely.box(*tile.bounds)
    valid = [shapely.make_valid(g) for g in areas]
    tags = tags if tags is not None else [None] * len(valid)
    colonies = [g for g, lu in zip(valid, landuse, strict=True) if lu == "allotments"]
    colonies = [g for g in colonies if g.intersects(box)]
    gardens = [g for g, le in zip(valid, leisure, strict=True) if le == "garden"]
    orchards = [
        (g, orchard_genus(t))
        for g, lu, t in zip(valid, landuse, tags, strict=True)
        if lu == "orchard" and g.intersects(box)
    ]
    vineyards = [g for g, lu in zip(valid, landuse, strict=True) if lu == "vineyard"]
    vineyards = [g for g in vineyards if g.intersects(box)]
    parcels, with_parcels = [], 0
    for c in colonies:
        own = parcels_of(c, gardens)
        parcels.extend(own)
        with_parcels += bool(own)
    axes = [path_axis(c, path_lines or []) for c in colonies]
    feats = clip_features(tile, colonies, "colony") + clip_features(tile, parcels, "parcel")
    n_trees = 0
    for o, genus in orchards:
        feats += clip_features(tile, [o], "orchard")
        own = orchard_features(tile, o, trees, measured, genus, built)
        feats += own
        n_trees += len(own)
    layouts = []
    for v in vineyards:
        own, layout = vineyard_features(tile, v)
        feats += own
        layouts.append(layout)
    stats = {
        "colonies": len(colonies),
        "withParcels": with_parcels,
        "parcels": len(parcels),
        "colonyHa": round(sum(shapely.intersection(c, box).area for c in colonies) / 1e4, 1),
        "pathAxes": sum(a is not None for a in axes),
        "orchards": len(orchards),
        "orchardTrees": n_trees,
        "vineyards": len(vineyards),
        "vineRows": sum(f["properties"]["k"] == "row" for f in feats),
        "vineFrom": {k: [x[2] for x in layouts].count(k) for k in sorted({x[2] for x in layouts})},
    }
    parts = {"colonies": colonies, "axes": axes, "parcels": parcels, "paths": paths_in}
    return feats, {**parts, "layouts": layouts, "stats": stats}


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the cultivated land"):
        return
    areas, af = read_osm(
        tile,
        "multipolygons",
        "landuse IN ('allotments', 'orchard', 'vineyard') OR leisure = 'garden'",
        ["landuse", "leisure", "other_tags"],
    )
    points, pf = read_osm(tile, "points", 'other_tags LIKE \'%"natural"=>"tree"%\'', ["other_tags"])
    trees = [
        p
        for p, t in zip(points, column(pf, "other_tags", points), strict=True)
        if tag(t, "natural") == "tree"
    ]
    lines, lf = read_ways(tile, "highway IS NOT NULL", ["highway"])
    kinds = column(lf, "highway", lines)
    paths = [
        shapely.buffer(g, PATH_HALF_WIDTH[h], cap_style="flat")
        for g, h in zip(lines, kinds, strict=True)
        if h in PATH_HALF_WIDTH
    ]
    xmin, ymin, xmax, ymax = tile.bounds
    reach = (xmin - 20, ymin - 20, xmax + 20, ymax + 20)
    landuse = column(af, "landuse", areas)
    built = None
    if "orchard" in landuse and tile.raw_raster("dom1").exists():
        with rasterio.open(tile.raw_raster("dom1")) as dom:
            built = built_mask(tile, dom.width)
    feats, parts = build(
        tile,
        areas,
        landuse,
        column(af, "leisure", areas),
        trees,
        paths,
        measured_trees(tile, reach),
        tags=column(af, "other_tags", areas),
        built=built,
        path_lines=[g for g, h in zip(lines, kinds, strict=True) if h in PATH_KINDS],
    )
    path = tile.out("dlm", f"cultivated_{tile.id}.geojson")
    write_geojson(path, feats, tile.epsg, attribution=OSM_ATTRIBUTION)
    cls = tile.classes()
    near = shapely.union_all(parts["colonies"]) if parts["colonies"] else None
    colony_paths = [p for p in paths if near is not None and p.intersects(near)]
    raster = colony_raster(
        tile, px, parts["colonies"], parts["parcels"], colony_paths, cls, parts["axes"]
    )
    save_grey_png(tile.out("dlm", f"cultivated_{tile.id}.png"), raster.reshape(px, 2 * px))
    print(f"{tile.id}: cultivated land {parts['stats']}")
