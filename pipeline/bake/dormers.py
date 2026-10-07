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
writes an empty file."""

from __future__ import annotations

import json
import math

import numpy as np
import shapely
from scipy import ndimage as ndi

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
        d = dormer(s, sl, labels[sl] == i, excess, gx, gy, slope)
        if d is None:
            continue
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
        if d["top"] > ridge(s, polys[of]) + RIDGE_SLACK_M:
            continue
        point = {"type": "Point", "coordinates": [round(x, 2), round(y, 2)]}
        out.append(feature(point, {"of": ids[of], **d}))
    return out


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
