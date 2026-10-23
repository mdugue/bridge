"""The dormers on the LoD2 roofs, measured in the surface model (DOM1):
`data/<site>/dlm/dormers_<tile>.geojson`, which the building bake
(`scripts/bake-city-mesh.ts`) draws as part of the building they sit on.

LoD2 draws a pitched roof as its planes; the dormers on it are not there.
The surface model sees them: on a pitched roof (`MIN_SLOPE`–`MAX_SLOPE`)
the excess `DOM − LoD2 roof` rises by a metre or two over a few square
metres. Measured against the roof's own fit (the excess's median over
`FIT_M` around — a roof LoD2 drew a metre off is not a dormer, and a roof
it drew badly is skipped: `FIT_TOLERANCE_M`), a blob of `MIN_EXCESS_M` or
more, `MIN_AREA_M2`–`MAX_AREA_M2`, compact (`MIN_FILL` of its box), its
top `MIN_TOP_M`–`MAX_TOP_M` over the roof and under its object's ridge,
not at the roof's edge (one cell in), and clear of every mapped or
measured tree (canopy, cadastre, `TREE_CLEAR_M`). A chimney is smaller
than `MIN_AREA_M2`; a crown overhanging a roof is irregular, overtops the
ridge or stands on a tree point.

Each dormer is a point (the blob's centre) with the downslope direction
(`ax`, `ay`, from the roof's gradient around it), its width across the
slope and depth along it (`w`, `d`, from the blob's extent), the roof's
height at the centre (`z`), the dormer's top (`top`, the 80th percentile
of the measured surface over the blob) and the roof's slope (`slope`,
degrees); `of` is the LoD2 object whose footprint holds it. Only the
tile's own (the west and south edges in). A site without a surface model
writes an empty file.

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
# the roof's fit: the median excess over this window (m) and how far off it
# may be before the roof is not trusted
FIT_M = 9
FIT_TOLERANCE_M = 0.4
MIN_EXCESS_M = 0.7
MIN_AREA_M2 = 3
MAX_AREA_M2 = 30
MAX_SIDE_M = 8
MIN_FILL = 0.4
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


def find(tile: Tile, s: Surfaces, ids: list[str], polys: list[shapely.Geometry]) -> list[dict]:
    f = s.field
    under = np.isfinite(s.roof)
    gx, gy = roof_gradient(np.where(under, s.roof, np.nan), f.res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    inner = ndi.binary_erosion(under, iterations=1)
    raw = np.where(inner & np.isfinite(s.dom), s.dom - s.roof, np.nan)
    local = ndi.median_filter(np.nan_to_num(raw), size=FIT_M)
    pitched = inner & (slope >= MIN_SLOPE) & (slope <= MAX_SLOPE)
    excess = np.where(pitched & (np.abs(local) < FIT_TOLERANCE_M), raw - local, np.nan)
    labels, _ = ndi.label(np.nan_to_num(excess) >= MIN_EXCESS_M)
    tree = shapely.STRtree(polys)
    trees = tree_points(tile)
    tree_index = shapely.STRtree(shapely.points(trees)) if len(trees) else None
    out: list[dict] = []
    for i, sl in enumerate(ndi.find_objects(labels), 1):
        m = labels[sl] == i
        d = dormer(s, sl, m, excess, gx, gy, slope)
        if d is None:
            continue
        fall = roof_fall(s, sl, m, d, excess)
        x, y = d.pop("x"), d.pop("y")
        if not owns(tile.bounds, x, y):
            continue
        p = shapely.Point(x, y)
        if tree_index is not None and len(tree_index.query(p.buffer(TREE_CLEAR_M))):
            continue
        hits = [int(k) for k in tree.query(p, predicate="within")]
        if not hits:
            continue
        of = min(hits, key=lambda k: polys[k].area)
        highest = ridge(s, polys[of]) + RIDGE_SLACK_M
        if d["top"] > highest:
            continue
        shed = shed_top(d["z"], d["slope"], d["d"], fall)
        if fall is not None and shed is not None and shed <= highest:
            d |= {"top": round(shed, 2), "tf": round(fall[0], 1)}
        point = {"type": "Point", "coordinates": [round(x, 2), round(y, 2)]}
        out.append(feature(point, {"of": ids[of], **d}))
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
    rr, cc = np.nonzero(m)
    xs = f.xmin + (sl[1].start + cc + 0.5) * f.res
    ys = f.ymax - (sl[0].start + rr + 0.5) * f.res
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


def dormer(s: Surfaces, sl, m: np.ndarray, excess, gx, gy, slope) -> dict | None:
    """One blob's dormer, or None where it is no dormer's shape."""
    area = int(m.sum())
    rows, cols = sl
    if not MIN_AREA_M2 <= area <= MAX_AREA_M2:
        return None
    ex = excess[sl][m]
    lift = float(np.percentile(ex, 80))
    if not MIN_TOP_M <= lift <= MAX_TOP_M:
        return None
    # the roof around the blob says which way is down
    nr, nc = gx.shape
    pad = (
        slice(max(rows.start - 2, 0), min(rows.stop + 2, nr)),
        slice(max(cols.start - 2, 0), min(cols.stop + 2, nc)),
    )
    big = np.zeros((pad[0].stop - pad[0].start, pad[1].stop - pad[1].start), bool)
    r0, c0 = rows.start - pad[0].start, cols.start - pad[1].start
    big[r0 : r0 + m.shape[0], c0 : c0 + m.shape[1]] = m
    ring = ndi.binary_dilation(big, iterations=2) & ~big
    ring &= np.isfinite(gx[pad]) & np.isfinite(gy[pad])
    if ring.sum() < 4:
        return None
    dx, dy = -float(np.median(gx[pad][ring])), -float(np.median(gy[pad][ring]))
    n = math.hypot(dx, dy)
    if n < 1e-6:
        return None
    ax, ay = dx / n, dy / n
    # extent across the slope (w) and along it (d), the blob's centre
    rr, cc = np.nonzero(m)
    f = s.field
    xs = f.xmin + (cols.start + cc + 0.5) * f.res
    ys = f.ymax - (rows.start + rr + 0.5) * f.res
    cx, cy = float(xs.mean()), float(ys.mean())
    along = (xs - cx) * ax + (ys - cy) * ay
    across = (xs - cx) * ay - (ys - cy) * ax
    w = float(np.ptp(across)) + f.res
    d = float(np.ptp(along)) + f.res
    if max(w, d) > MAX_SIDE_M or area < MIN_FILL * w * d:
        return None
    r0, c0 = int(round((f.ymax - cy) / f.res - 0.5)), int(round((cx - f.xmin) / f.res - 0.5))
    z = float(s.roof[r0, c0]) if np.isfinite(s.roof[r0, c0]) else float(np.nanmedian(s.roof[sl][m]))
    sl_deg = float(np.median(slope[pad][ring]))
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


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"dormers_{tile.id}.geojson")
    city_path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    if not tile.products.dom or not tile.raw_raster("dom1").exists() or not city_path.exists():
        print(f"{tile.id}: no surface model — no dormers")
        write_geojson(out, [], tile.epsg, tile.credit)
        return
    ids, polys = footprints(json.loads(city_path.read_text()))
    found = find(tile, Surfaces(tile), ids, polys)
    write_geojson(out, found, tile.epsg, tile.credit)
    print(f"{tile.id}: {len(found)} dormers")
