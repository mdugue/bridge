"""Hedges and the trees outside the canopy mask, from the GeoSN laser scan
(LSC) + OpenStreetMap. The viewer draws the OSM hedges
(low-vegetation-layer.ts) at the height the scan measures along them, and
the extra trees join the canopy; the scan-only hedges and the shrubs this
step also finds are NOT shipped (docs/transformations.md, "Low vegetation":
~30 % crown-rim false positives, faceted "boulders" up close) — `research`
writes every candidate for study.

Inputs, beyond the committed bakes it depends on (landcover, ndvi, walls,
bridge, canopy, trees under data/dlm/, the CityJSON and the DGM):
  <raw>/lsc/<tile>.laz   the laser scan (≈380 MB; the only raw input with
                         heights below 3 m that tells vegetation apart),
                         rasterised once (lsc.py: laspy, PDAL's rules) into
                         <raw>/lsc/<tile>/*.tif at 0.5 m: ground (classes
                         2/8/30: idw, min, count), surface (2/20: max,
                         count), the non-ground count and its multi-echo
                         share, and the mean intensity of the LOW non-ground
                         returns (0.25–4 m above ground)
  the site's .osm.pbf    barrier=hedge lines, natural=scrub|shrubbery areas,
                         natural=shrub nodes
Without the LAZ the tile falls back to OSM only: mapped hedges at their
tagged (or a default) height, and no extra trees (docs/portability.md).

Outputs:
  data/dlm/lowveg_<tile>.geojson   the OSM hedge LineStrings {kind:"hedge",
                                   h, w, src: "osm" | "osm+lsc"}
  data/dlm/canopyx_<tile>.geojson  LSC crown peaks > 3 m that the canopy
                                   (canopy_<tile>.geojson) does not cover and
                                   no cadastre tree (trees_<tile>.geojson)
                                   claims {h, r} — courtyard and garden trees
The method and the evidence behind every threshold are in
docs/transformations.md ("Low vegetation") — keep the two in step.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, unary_union
from skimage.feature import peak_local_max
from skimage.morphology import skeletonize

from .common import OSM_ATTRIBUTION, Tile, column, write_geojson
from .lsc import rasterise
from .osm import has_extract, read_osm, tag

RES = 0.5  # the LSC raster grid (m)

# --- thresholds (each one measured on the primary tile; see the ledger) -------
BAND = (0.5, 3.0)  # low-vegetation height band above ground (m)
TALL = 3.0  # above this a crown belongs to the canopy layer
RIM_M = 1.0  # band pixels this close to a >TALL pixel are crown edge, not shrub
BLD_BUF_M = 1.0  # DSM-max binning smears eaves/walls this far past a footprint
WALL_BUF_M = 0.75  # OSM walls/city walls (a garden wall reads as a 1–2 m "hedge")
# The vegetation cue. NDVI (DOP, 2024-03-19) separates hedges from cars best
# (AUC 0.94): evergreen hedges are green in March. The laser intensity of the
# low returns carries deciduous shrubs; alone it also passes pale cars, so it
# needs the multi-echo ratio, which alone passes fences (they are MORE
# multi-echo than hedges: a trimmed hedge rarely splits a pulse).
NDVI_T = 0.12
INT_T = 1250.0
ECHO_T = 0.3
# Inside a mapped OSM scrub polygon the prior is strong: accept a weaker cue.
SCRUB_NDVI_T = 0.06
SCRUB_ECHO_T = 0.3
MIN_AREA_M2 = 2.0  # smallest kept blob (≈ a 1.6 m shrub)
HEDGE_MIN_LEN = 4.0  # skeleton length (m) for a hedge
HEDGE_MIN_ELONG = 3.0  # length / mean width for a hedge
HEDGE_MAX_W = 3.0  # wider than this is a shrub bed, not a hedge
HEDGE_SPUR_EVERY_M = 8.0  # a hedge may sprout one extra skeleton end per 8 m
SHRUB_SINGLE_M2 = 12.0  # compact blobs up to this area are one shrub
SHRUB_PEAK_PX = 3  # min distance between shrub peaks in a bed (px = 1.5 m)
SPUR_M = 1.5  # skeleton spurs shorter than this are pruned
DP_TOL = 0.4  # Douglas-Peucker tolerance (m)
OSM_SNAP_M = 2.0  # an LSC hedge within this of an OSM hedge is the OSM hedge
OSM_SUPPORT_M = 1.5
OSM_DEFAULT_H = 1.5
OSM_DEFAULT_W = 1.0
# Out-of-mask canopy trees
CANOPY_ECHO_T = 0.5  # tall vegetation is multi-echo (median 1.0 vs 0.0 on roofs)
CANOPY_PEAK_PX = 6  # crown peaks ≥ 3 m apart
CANOPY_DEDUP_M = 5.0  # a peak this close to a current canopy point is covered
BLOCKED_CLASSES = (5, 8)  # railway, water — never low vegetation
TREE_BLOCKED_CLASSES = (5, 6, 7, 8)  # as canopy.py: no tree on these


def disk(r_px):
    y, x = np.mgrid[-r_px : r_px + 1, -r_px : r_px + 1]
    return np.hypot(x, y) <= r_px + 0.01


class Grid:
    """The tile's 0.5 m grid (row 0 = north), with EPSG helpers."""

    def __init__(self, xmin, ymin, xmax, ymax):
        self.xmin, self.ymin, self.xmax, self.ymax = xmin, ymin, xmax, ymax
        self.n = int(round((xmax - xmin) / RES))
        self.transform = from_origin(xmin, ymax, RES, RES)

    def xy(self, r, c):
        return self.xmin + (c + 0.5) * RES, self.ymax - (r + 0.5) * RES

    def rc(self, x, y):
        c = np.clip(((np.asarray(x) - self.xmin) / RES).astype(int), 0, self.n - 1)
        r = np.clip(((self.ymax - np.asarray(y)) / RES).astype(int), 0, self.n - 1)
        return r, c

    def burn(self, geoms):
        shapes = [(mapping(g), 1) for g in geoms if g is not None and not g.is_empty]
        if not shapes:
            return np.zeros((self.n, self.n), bool)
        return rasterize(
            shapes, out_shape=(self.n, self.n), transform=self.transform, dtype=np.uint8
        ).astype(bool)

    def resample_png(self, path, nearest):
        from PIL import Image

        img = np.array(Image.open(path).convert("L"))
        idx = ((np.arange(self.n) + 0.5) * img.shape[0] / self.n).astype(int)
        out = img[np.ix_(idx, idx)]
        return out if nearest else out.astype(np.float32) / 255.0


def read_band(path, desc):
    with rasterio.open(path) as ds:
        i = list(ds.descriptions).index(desc) + 1 if desc else 1
        a = ds.read(i).astype(np.float32)
        a[a == -9999] = np.nan
        return a


def dgm_on(grid, path, epsg):
    out = np.full((grid.n, grid.n), np.nan, np.float32)
    with rasterio.open(path) as ds:
        reproject(
            ds.read(1).astype(np.float32),
            out,
            src_transform=ds.transform,
            src_crs=f"EPSG:{epsg}",
            dst_transform=grid.transform,
            dst_crs=f"EPSG:{epsg}",
            resampling=Resampling.bilinear,
            src_nodata=ds.nodata,
            dst_nodata=np.nan,
        )
    return out


def building_mask(grid, cityjson):
    """Every LoD2 surface projected to 2D — the roof outline incl. overhangs."""
    if not Path(cityjson).exists():
        return np.zeros((grid.n, grid.n), bool)
    d = json.loads(Path(cityjson).read_text())
    sc, tr = d["transform"]["scale"], d["transform"]["translate"]
    V = np.asarray(d["vertices"], dtype=np.float64)
    X, Y = V[:, 0] * sc[0] + tr[0], V[:, 1] * sc[1] + tr[1]
    polys = []

    def rings(b):
        if b and isinstance(b[0], int):
            yield b
        else:
            for c in b:
                yield from rings(c)

    for o in d["CityObjects"].values():
        for g in o.get("geometry", []):
            for ring in rings(g["boundaries"]):
                if len(ring) >= 3:
                    p = Polygon(list(zip(X[ring], Y[ring], strict=True)))
                    if p.is_valid and p.area > 0.05:
                        polys.append(p)
    return grid.burn(polys)


def windowed_ratio(num, den, k=3):
    w = np.ones((k, k), np.float32)
    s_num = ndi.convolve(num, w, mode="constant")
    s_den = ndi.convolve(den, w, mode="constant")
    return np.where(s_den > 0, s_num / np.maximum(s_den, 1e-6), 0.0).astype(np.float32)


def osm_height(other_tags):
    """The tagged height (m) of a hedge or shrub, when plausible."""
    try:
        h = float(str(tag(other_tags, "height") or "").replace("m", "").strip())
    except ValueError:
        return None
    return h if 0.3 <= h <= 4.0 else None


# --- skeleton → polylines -------------------------------------------------

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def trace_skeleton(skel):
    """Pixel paths between skeleton nodes (degree ≠ 2); cycles included."""
    pts = set(zip(*np.nonzero(skel), strict=True))
    deg = {p: sum((p[0] + dr, p[1] + dc) in pts for dr, dc in NB) for p in pts}
    nodes = {p for p, k in deg.items() if k != 2}
    seen_edges = set()
    paths = []

    def walk(start, nxt):
        path = [start, nxt]
        prev, cur = start, nxt
        while cur not in nodes:
            step = [
                (cur[0] + dr, cur[1] + dc)
                for dr, dc in NB
                if (cur[0] + dr, cur[1] + dc) in pts and (cur[0] + dr, cur[1] + dc) != prev
            ]
            if not step:
                break
            # prefer a 4-neighbour to avoid cutting corners twice
            step.sort(key=lambda q: abs(q[0] - cur[0]) + abs(q[1] - cur[1]))
            prev, cur = cur, step[0]
            if cur == start:
                path.append(cur)
                break
            path.append(cur)
        return path

    for n in nodes:
        for dr, dc in NB:
            q = (n[0] + dr, n[1] + dc)
            if q in pts and (n, q) not in seen_edges:
                p = walk(n, q)
                seen_edges.add((n, q))
                seen_edges.add((p[-1], p[-2]))
                paths.append(p)
    # pure cycles (no node at all)
    visited = {p for path in paths for p in path}
    for p in pts - visited:
        if p in visited:
            continue
        nb = [(p[0] + dr, p[1] + dc) for dr, dc in NB if (p[0] + dr, p[1] + dc) in pts]
        if not nb:
            continue
        nodes.add(p)
        path = walk(p, nb[0])
        visited.update(path)
        paths.append(path)
    return paths, deg


def path_length_px(path):
    return sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(path, path[1:], strict=False))


# --- the bake ---------------------------------------------------------------


def lowveg_mask(inputs, scrub_mask):
    ndom, cls = inputs["ndom"], inputs["cls"]
    band = (ndom >= BAND[0]) & (ndom <= BAND[1])
    rim = ndi.binary_dilation(ndom > TALL, disk(int(round(RIM_M / RES))))
    bld = ndi.binary_dilation(inputs["bld"], disk(int(round(BLD_BUF_M / RES))))
    excl = rim | bld | inputs["walls"] | inputs["bridge"] | np.isin(cls, BLOCKED_CLASSES)
    cue = (inputs["ndvi"] >= NDVI_T) | ((inputs["int"] >= INT_T) & (inputs["echo"] >= ECHO_T))
    cue |= scrub_mask & ((inputs["ndvi"] >= SCRUB_NDVI_T) | (inputs["echo"] >= SCRUB_ECHO_T))
    m = band & ~excl & cue
    m = ndi.binary_closing(m, np.ones((3, 3), bool)) & band & ~excl
    m = ndi.binary_opening(m, np.ones((2, 2), bool))
    lab, n = ndi.label(m)
    area = ndi.sum(np.ones_like(lab, np.float32), lab, np.arange(1, n + 1)) * RES * RES
    keep = np.zeros(n + 1, bool)
    keep[1:] = area >= MIN_AREA_M2
    return keep[lab], {"band": band, "excl": excl, "cue": cue}


def split_components(mask, ndom):
    """Elongated components → hedge mask; compact → shrub list."""
    lab, n = ndi.label(mask, np.ones((3, 3), bool))
    idx = np.arange(1, n + 1)
    skel = skeletonize(mask)
    area = ndi.sum(np.ones_like(lab, np.float32), lab, idx) * RES * RES
    slen = ndi.sum(skel.astype(np.float32), lab, idx) * RES * 1.1  # ≈ diagonal steps
    # Width from the distance transform ON the skeleton (the inscribed width),
    # not area/length: a big branchy shrub mass has a long skeleton and would
    # otherwise pass as a "narrow" hedge network.
    dist = ndi.distance_transform_edt(mask) * RES
    sk_lab = np.where(skel, lab, 0)
    width = np.zeros(n)
    for i, sl in enumerate(ndi.find_objects(sk_lab)):
        if sl is not None:
            width[i] = 2 * np.percentile(dist[sl][sk_lab[sl] == i + 1], 75)
    # Spurs: skeleton end points per component. A hedge (even an L or a garden
    # ring) has few; the skeleton of a blob sprouts one per lobe.
    nbrs = ndi.convolve(skel.astype(np.uint8), np.ones((3, 3), np.uint8), mode="constant") - 1
    ends = ndi.sum((skel & (nbrs == 1)).astype(np.float32), lab, idx)
    hedge_c = (
        (slen >= HEDGE_MIN_LEN)
        & (slen / np.maximum(width, RES) >= HEDGE_MIN_ELONG)
        & (width <= HEDGE_MAX_W)
        & (ends <= 2 + slen / HEDGE_SPUR_EVERY_M)
    )
    is_hedge = np.zeros(n + 1, bool)
    is_hedge[1:] = hedge_c
    hedge_mask = is_hedge[lab]
    shrubs = []
    objs = ndi.find_objects(lab)
    for i in np.nonzero(~hedge_c)[0]:
        sl = objs[i]
        comp = lab[sl] == i + 1
        h = ndom[sl]
        a = area[i]
        if a <= SHRUB_SINGLE_M2:
            rr, cc = np.nonzero(comp)
            shrubs.append(
                (
                    sl[0].start + rr.mean(),
                    sl[1].start + cc.mean(),
                    float(np.percentile(h[comp], 90)),
                    math.sqrt(a / math.pi),
                )
            )
            continue
        sm = ndi.gaussian_filter(np.where(comp, h, 0), 1.0)
        pk = peak_local_max(
            sm, min_distance=SHRUB_PEAK_PX, labels=comp.astype(np.uint8), exclude_border=False
        )
        if len(pk) == 0:
            continue
        r = min(max(math.sqrt(a / len(pk) / math.pi), 0.6), 2.5)
        for pr, pc in pk:
            shrubs.append((sl[0].start + pr, sl[1].start + pc, float(h[pr, pc]), r))
    return hedge_mask, skel & hedge_mask, shrubs


def hedge_lines(grid, hedge_mask, skel, ndom):
    dist = ndi.distance_transform_edt(hedge_mask) * RES
    ridge = ndi.maximum_filter(np.where(hedge_mask, ndom, 0), size=3)
    paths, deg = trace_skeleton(skel)
    out = []
    for p in paths:
        L = path_length_px(p) * RES
        spur = deg.get(p[0], 0) == 1 or deg.get(p[-1], 0) == 1
        if L < SPUR_M or (spur and len(paths) > 1 and L < 2 * SPUR_M):
            continue
        rr = np.array([q[0] for q in p])
        cc = np.array([q[1] for q in p])
        x, y = grid.xy(rr, cc)
        line = LineString(list(zip(x, y, strict=True))).simplify(DP_TOL)
        if line.length < SPUR_M:
            continue
        out.append(
            (
                line,
                float(np.median(ridge[rr, cc])),
                float(np.clip(2 * np.median(dist[rr, cc]), 0.5, HEDGE_MAX_W)),
            )
        )
    return out


def merge_lines(lines):
    """Join touching LSC pieces so a hedge is one polyline, not a dozen stubs."""
    if not lines:
        return []
    merged = linemerge(MultiLineString([line for line, _, _ in lines]))
    geoms = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    out = []
    for g in geoms:
        near = [(h, w, line.length) for line, h, w in lines if line.distance(g) < 0.3]
        tot = sum(n[2] for n in near) or 1
        out.append(
            (
                g.simplify(DP_TOL),
                sum(n[0] * n[2] for n in near) / tot,
                sum(n[1] * n[2] for n in near) / tot,
            )
        )
    return out


def osm_support_rasters(inputs, mask):
    """What osm_hedge_height samples: the mask grown by OSM_SUPPORT_M, and the
    local (1 m) max of the nDOM below the band's top — computed once per tile."""
    near = ndi.binary_dilation(mask, disk(int(OSM_SUPPORT_M / RES)))
    band_max = ndi.maximum_filter(
        np.where(inputs["ndom"] <= BAND[1] + 0.5, inputs["ndom"], 0), footprint=disk(2)
    )
    return near, band_max


def osm_hedge_height(grid, line, support_rasters):
    """The LSC height along an OSM hedge, or None where < 30 % of it is seen."""
    if support_rasters is None:
        return None
    near, band_max = support_rasters
    samples = [line.interpolate(d) for d in np.arange(0, line.length + 1e-6, RES)]
    r, c = grid.rc([p.x for p in samples], [p.y for p in samples])
    sup = near[r, c]
    if sup.mean() < 0.3:
        return None
    h = float(np.median(band_max[r[sup], c[sup]]))
    return h if BAND[0] <= h <= BAND[1] + 0.5 else None


def hedge_feature(line, h, w, src):
    return {
        "type": "Feature",
        "properties": {
            "kind": "hedge",
            "h": round(float(h), 1),
            "w": round(float(w), 1),
            "src": src,
        },
        "geometry": {
            "type": "LineString",
            "coordinates": [[round(x, 1), round(y, 1)] for x, y in line.coords],
        },
    }


def shrub_feature(p, h, r, src):
    return {
        "type": "Feature",
        "properties": {
            "kind": "shrub",
            "h": round(float(h), 1),
            "r": round(float(r), 1),
            "src": src,
        },
        "geometry": {"type": "Point", "coordinates": [round(p.x, 1), round(p.y, 1)]},
    }


# A scan tree this close to a cadastre tree (or inside its crown, when that
# is wider) is the same tree: the cadastre wins — it has the surveyed spot,
# crown and taxon. Radius, not 1:1 matching: one big crown often yields two
# scan peaks, and both belong to it.
CADASTRE_DEDUP_M = 4.0


def cadastre_filter(extra, trees_path):
    """Drops the scan trees within max(4 m, crown radius) of a cadastre tree."""
    if not trees_path or not Path(trees_path).exists():
        return extra, 0
    cad = [f for f in json.loads(Path(trees_path).read_text())["features"] if f.get("geometry")]
    if not cad:
        return extra, 0
    xy = np.array([f["geometry"]["coordinates"] for f in cad])
    r = np.array([max(CADASTRE_DEDUP_M, (f["properties"] or {}).get("d", 0) / 2) for f in cad])
    index = cKDTree(xy)
    reach = float(r.max())
    kept = []
    for f in extra:
        p = f["geometry"]["coordinates"]
        near = index.query_ball_point(p, reach)
        if any(math.dist(p, xy[i]) <= r[i] for i in near):
            continue
        kept.append(f)
    return kept, len(extra) - len(kept)


def canopy_extra(inputs, canopy_path):
    """LSC crown peaks (>3 m, multi-echo) the current canopy leaves out."""
    grid, ndom, cls = inputs["grid"], inputs["ndom"], inputs["cls"]
    bld = ndi.binary_dilation(inputs["bld"], disk(2))
    tall = (ndom > TALL) & (ndom < 45) & (inputs["echo"] >= CANOPY_ECHO_T)
    tall = ndi.binary_opening(tall, np.ones((3, 3), bool))
    lab, n = ndi.label(tall)
    area = ndi.sum(np.ones_like(lab, np.float32), lab, np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = area >= 16  # ≥ 4 m² of crown
    tall = keep[lab] & ~bld & ~inputs["bridge"] & ~np.isin(cls, TREE_BLOCKED_CLASSES)
    chm = ndi.gaussian_filter(np.where(tall, ndom, 0), 1.5)
    pk = peak_local_max(
        chm,
        min_distance=CANOPY_PEAK_PX,
        threshold_abs=TALL,
        labels=tall.astype(np.uint8),
        exclude_border=False,
    )
    # crown radius: distance to the crown edge at the peak, capped
    edge = ndi.distance_transform_edt(tall) * RES
    cur = (
        json.loads(Path(canopy_path).read_text())["features"]
        if canopy_path and Path(canopy_path).exists()
        else []
    )
    cxy = np.array([f["geometry"]["coordinates"] for f in cur]) if cur else np.zeros((0, 2))
    tree = cKDTree(cxy) if len(cxy) else None
    out = []
    for r, c in pk:
        x, y = grid.xy(r, c)
        if tree is not None and tree.query([x, y])[0] <= CANOPY_DEDUP_M:
            continue
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "h": round(float(ndom[r, c]), 1),
                    "r": round(float(min(max(edge[r, c], 1.0), 8.0)), 1),
                },
                "geometry": {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
            }
        )
    return out, len(pk)


# --- inputs -----------------------------------------------------------------

LSC_RASTERS = (
    "dtm_050.tif",
    "dsm_050.tif",
    "nonground_count_050.tif",
    "nonground_multiecho_count_050.tif",
    "lowint_050.tif",
)


def lsc_rasters(tile: Tile) -> Path | None:
    """The folder with the 0.5 m laser-scan rasters, rasterised from the LAZ
    on first use (lsc.py); None without a scan. A folder PDAL made earlier
    (the same files, the same band names) is read as it is."""
    der = tile.raw / "lsc" / tile.id
    if all((der / name).exists() for name in LSC_RASTERS):
        return der
    laz = tile.raw / "lsc" / f"{tile.id}.laz"
    if not laz.exists():
        return None
    print(f"{tile.id}: rasterising the laser scan (a few minutes) …")
    der.mkdir(parents=True, exist_ok=True)
    rasterise(laz, der, tile.bounds, tile.epsg, RES)
    return der


def hedge_rings(geom) -> list:
    """A hedge mapped as a closed way, as the lines it is: every ring of the
    polygon GDAL built from it (a hedge around a garden has no inside)."""
    out = []
    for part in shapely.get_parts(geom):
        if isinstance(part, Polygon) and not part.is_empty:
            out += [LineString(part.exterior.coords)]
            out += [LineString(r.coords) for r in part.interiors]
    return out


def load_osm(tile: Tile):
    """(hedge lines, scrub polygons, shrub points) from the site's extract,
    each as (other_tags, geometry) in the tile's CRS."""
    lines, fields = read_osm(tile, "lines", "barrier = 'hedge'", ["other_tags"], margin=0.0005)
    hedges = list(zip(column(fields, "other_tags", lines), lines, strict=True))
    # GDAL's OSM driver routes a CLOSED hedge way (a garden ring) into
    # `multipolygons`; it is still a line of hedge, so take its rings.
    rings, fields = read_osm(
        tile, "multipolygons", "barrier = 'hedge'", ["other_tags"], margin=0.0005
    )
    for t, g in zip(column(fields, "other_tags", rings), rings, strict=True):
        hedges += [(t, ring) for ring in hedge_rings(g)]
    areas, fields = read_osm(
        tile, "multipolygons", "natural IN ('scrub','shrubbery')", ["other_tags"], margin=0.0005
    )
    scrub = [
        (t, g if g.is_valid else g.buffer(0))
        for t, g in zip(column(fields, "other_tags", areas), areas, strict=True)
    ]
    points, fields = read_osm(
        tile, "points", 'other_tags LIKE \'%"natural"=>"shrub"%\'', ["other_tags"], margin=0.0005
    )
    shrubs = list(zip(column(fields, "other_tags", points), points, strict=True))
    return hedges, scrub, shrubs


def _features(path: Path) -> list:
    return json.loads(path.read_text())["features"] if path.exists() else []


def load_inputs(tile: Tile, grid: Grid) -> dict:
    dlm = lambda name: tile.data / "dlm" / f"{name}_{tile.id}"  # noqa: E731
    inputs = {"grid": grid}
    inputs["cls"] = grid.resample_png(dlm("landcover").with_suffix(".png"), nearest=True)
    ndvi = dlm("ndvi").with_suffix(".png")
    inputs["ndvi"] = (
        grid.resample_png(ndvi, nearest=False)
        if ndvi.exists()
        else np.zeros((grid.n, grid.n), np.float32)
    )
    inputs["bld"] = building_mask(grid, tile.data / "cityjson" / f"lod2_{tile.id}.city.json")
    # The walls file also carries fences and gates (walls.py): only walls mask.
    walls = [
        f
        for f in _features(dlm("walls").with_suffix(".geojson"))
        if f["properties"].get("kind") not in ("fence", "gate")
    ]
    inputs["walls"] = grid.burn([shape(f["geometry"]).buffer(WALL_BUF_M) for f in walls])
    bridges = _features(dlm("bridge").with_suffix(".geojson"))
    inputs["bridge"] = grid.burn([shape(f["geometry"]) for f in bridges])
    der = lsc_rasters(tile)
    inputs["has_lsc"] = der is not None
    if der is None:
        return inputs
    ground = read_band(der / "dtm_050.tif", "idw")
    ground = np.where(np.isnan(ground), dgm_on(grid, tile.dgm, tile.epsg), ground)
    dsm = read_band(der / "dsm_050.tif", "max")
    inputs["ndom"] = np.nan_to_num(np.where(np.isnan(dsm), 0.0, dsm - ground)).astype(np.float32)
    ng = np.nan_to_num(read_band(der / "nonground_count_050.tif", None))
    me = np.nan_to_num(read_band(der / "nonground_multiecho_count_050.tif", None))
    inputs["echo"] = windowed_ratio(me, ng)
    imean = np.nan_to_num(read_band(der / "lowint_050.tif", "mean"))
    icnt = np.nan_to_num(read_band(der / "lowint_050.tif", "count"))
    inputs["int"] = windowed_ratio(imean * icnt, icnt)
    return inputs


# --- the bake -----------------------------------------------------------------


def _parts(g):
    return list(g.geoms) if hasattr(g, "geoms") else [g]


def lsc_candidates(inputs, scrub):
    """The scan's own hedge pieces and shrubs, plus its low-vegetation mask."""
    grid = inputs["grid"]
    mask, _ = lowveg_mask(inputs, grid.burn([g for _, g in scrub]))
    hedge_mask, skel, shrubs_rc = split_components(mask, inputs["ndom"])
    lines = merge_lines(hedge_lines(grid, hedge_mask, skel, inputs["ndom"]))
    shrubs = []
    for r, c, h, rad in shrubs_rc:
        x, y = grid.xy(r, c)
        shrubs.append((Point(x, y), h, rad))
    return mask, lines, shrubs


def osm_hedge_features(grid, hedges, support):
    """OSM hedges: geometry wins; the scan supplies the height where it sees
    one."""
    feats, lines = [], []
    for other_tags, g in hedges:
        for part in _parts(g):
            if part.length < 1.0:
                continue
            h = osm_hedge_height(grid, part, support)
            src = "osm+lsc" if h is not None else "osm"
            h = h if h is not None else (osm_height(other_tags) or OSM_DEFAULT_H)
            lines.append(part)
            feats.append(hedge_feature(part, h, OSM_DEFAULT_W, src))
    return feats, lines


def lsc_hedge_features(lsc_lines, osm_lines):
    """The scan's hedges that no OSM hedge already maps (research only)."""
    snap = unary_union([line.buffer(OSM_SNAP_M) for line in osm_lines]) if osm_lines else None
    feats = []
    for line, h, w in lsc_lines:
        rest = line.difference(snap) if snap is not None else line
        feats += [hedge_feature(p, h, w, "lsc") for p in _parts(rest) if p.length >= 2.0]
    return feats


def build(tile: Tile):
    """Every candidate: OSM hedges (with the scan's height and width where it
    sees them), the scan's own hedges and shrubs, the OSM shrub nodes."""
    xmin, ymin, xmax, ymax = tile.bounds
    grid = Grid(xmin, ymin, xmax, ymax)
    inputs = load_inputs(tile, grid)
    area = box(*tile.bounds)
    o_hedges, o_scrub, o_shrubs = load_osm(tile)
    o_hedges = [(t, g.intersection(area)) for t, g in o_hedges if g.intersects(area)]
    o_hedges = [(t, g) for t, g in o_hedges if g.length >= 1.0]
    o_scrub = [(t, g.intersection(area)) for t, g in o_scrub if g.intersects(area)]
    o_shrubs = [(t, g) for t, g in o_shrubs if area.contains(g)]
    mask = np.zeros((grid.n, grid.n), bool)
    lsc_lines, lsc_shrubs = [], []
    if inputs["has_lsc"]:
        mask, lsc_lines, lsc_shrubs = lsc_candidates(inputs, o_scrub)
    support = osm_support_rasters(inputs, mask) if inputs["has_lsc"] else None
    feats, osm_lines = osm_hedge_features(grid, o_hedges, support)
    feats += lsc_hedge_features(lsc_lines, osm_lines)
    # Width for OSM hedges: the nearest scan hedge's, where one overlaps.
    for f in feats:
        if f["properties"]["src"] == "osm+lsc":
            g = shape(f["geometry"])
            near = [w for line, _, w in lsc_lines if line.distance(g) < OSM_SNAP_M]
            if near:
                f["properties"]["w"] = round(float(np.median(near)), 1)
    # Shrubs — not inside a hedge's footprint. OSM-only tiles do NOT fill
    # scrub polygons with shrubs: tried (a jittered 3–4 m grid), it produced
    # more shrubs per neighbour tile (4–9 k) than the scan finds on the spawn
    # tile, most of them under existing crowns.
    zone = (
        unary_union([shape(f["geometry"]).buffer(max(f["properties"]["w"], 1.0)) for f in feats])
        if feats
        else None
    )
    for p, h, rad in lsc_shrubs:
        if zone is None or not zone.contains(p):
            feats.append(shrub_feature(p, h, rad, "lsc"))
    for other_tags, p in o_shrubs:
        feats.append(shrub_feature(p, osm_height(other_tags) or 1.8, 1.2, "osm"))
    return inputs, feats


def shipped(feats: list[dict]) -> list[dict]:
    """What the viewer draws: the OSM hedges only (their height from the scan
    where it has one). The scan-only hedges and all shrubs stay out: ~30 %
    of them are crown rims, and a shrub dome reads as a faceted boulder up
    close (docs/transformations.md, "Low vegetation")."""
    return [
        f for f in feats if f["properties"]["kind"] == "hedge" and f["properties"]["src"] != "lsc"
    ]


LSC_ATTRIBUTION = "Quelle: GeoSN, dl-de/by-2-0 (laser scan)"


def run(tile: Tile, research: bool = False) -> None:
    if not has_extract(tile, "the hedges"):
        return
    inputs, feats = build(tile)
    attribution = f"{LSC_ATTRIBUTION}; {OSM_ATTRIBUTION}" if inputs["has_lsc"] else OSM_ATTRIBUTION
    if research:
        out = tile.raw / "lsc" / f"lowveg_all_{tile.id}.geojson"
        out.parent.mkdir(parents=True, exist_ok=True)
        write_geojson(out, feats, tile.epsg, attribution)
        print(f"{tile.id}: every candidate → {out}")
    hedges = shipped(feats)
    write_geojson(tile.out("dlm", f"lowveg_{tile.id}.geojson"), hedges, tile.epsg, attribution)
    print(f"{tile.id}: {len(hedges)} OSM hedges shipped of {len(feats)} candidates")
    if not inputs["has_lsc"]:
        return
    dlm = tile.data / "dlm"
    extra, peaks = canopy_extra(inputs, dlm / f"canopy_{tile.id}.geojson")
    extra, dropped = cadastre_filter(extra, dlm / f"trees_{tile.id}.geojson")
    write_geojson(tile.out("dlm", f"canopyx_{tile.id}.geojson"), extra, tile.epsg, LSC_ATTRIBUTION)
    print(
        f"{tile.id}: {len(extra)} extra trees of {peaks} crown peaks "
        f"({dropped} dropped as cadastre trees)"
    )
