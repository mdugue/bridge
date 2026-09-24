"""
extract-lowveg.py — hedges, shrubs and out-of-mask trees for one tile.

Called by scripts/extract-lowveg.sh (which prepares the laser-scan rasters and
the Overpass cache and runs this under `uv` — the bake needs numpy/scipy/
scikit-image/shapely/rasterio, which the system Python lacks). Read that file's
header for the inputs; the method and the evidence behind every threshold are in
docs/transformations.md (🧪 "Low vegetation") — keep the two in step.

Outputs (small, COMMITTED):
  data/dlm/lowveg_<tile>.geojson   hedge LineStrings {kind:"hedge", h, w, src}
                                   + shrub Points {kind:"shrub", h, r, src}
  data/dlm/canopyx_<tile>.geojson  LSC crown peaks > 3 m that the current
                                   canopy (canopy_<tile>.geojson) does not cover
                                   {h, r} — courtyard and garden trees
Both EPSG:25833, never recentred. `src` is "osm", "lsc" or "osm+lsc".
"""

import argparse
import json
import math
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform
from scipy import ndimage as ndi
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, unary_union
from skimage.feature import peak_local_max
from skimage.morphology import skeletonize

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
TREE_BLOCKED_CLASSES = (5, 6, 7, 8)  # as extract-canopy.sh: no tree on these


def log(msg):
    print(msg, file=sys.stderr)


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
        return rasterize(shapes, out_shape=(self.n, self.n), transform=self.transform, dtype=np.uint8).astype(bool)

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


def dgm_on(grid, path):
    out = np.full((grid.n, grid.n), np.nan, np.float32)
    with rasterio.open(path) as ds:
        reproject(
            ds.read(1).astype(np.float32),
            out,
            src_transform=ds.transform,
            src_crs="EPSG:25833",
            dst_transform=grid.transform,
            dst_crs="EPSG:25833",
            resampling=Resampling.bilinear,
            src_nodata=ds.nodata,
            dst_nodata=np.nan,
        )
    return out


def building_mask(grid, cityjson):
    """Every LoD2 surface projected to 2D — the roof outline incl. overhangs."""
    d = json.load(open(cityjson))
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
                    p = Polygon(list(zip(X[ring], Y[ring])))
                    if p.is_valid and p.area > 0.05:
                        polys.append(p)
    return grid.burn(polys)


def windowed_ratio(num, den, k=3):
    w = np.ones((k, k), np.float32)
    s_num = ndi.convolve(num, w, mode="constant")
    s_den = ndi.convolve(den, w, mode="constant")
    return np.where(s_den > 0, s_num / np.maximum(s_den, 1e-6), 0.0).astype(np.float32)


# --- OSM ------------------------------------------------------------------


def load_osm(path):
    """Overpass JSON → (hedge lines, scrub polygons, shrub points) in EPSG:25833."""
    hedges, scrub, shrubs = [], [], []
    if not path or not os.path.exists(path):
        return hedges, scrub, shrubs
    d = json.load(open(path))

    def proj(geom):
        xs, ys = transform("EPSG:4326", "EPSG:25833", [g["lon"] for g in geom], [g["lat"] for g in geom])
        return list(zip(xs, ys))

    for e in d.get("elements", []):
        t = e.get("tags", {})
        if e["type"] == "node" and t.get("natural") == "shrub":
            (p,) = proj([e])
            shrubs.append((e["id"], t, Point(p)))
        elif e["type"] == "way" and "geometry" in e and len(e["geometry"]) >= 2:
            pts = proj(e["geometry"])
            closed = len(pts) >= 4 and e["nodes"][0] == e["nodes"][-1]
            if t.get("barrier") == "hedge":
                hedges.append((e["id"], t, LineString(pts)))  # a closed hedge is a ring of hedge
            elif t.get("natural") in ("scrub", "shrubbery") and closed:
                poly = Polygon(pts)
                scrub.append((e["id"], t, poly if poly.is_valid else poly.buffer(0)))
        elif e["type"] == "relation" and t.get("natural") in ("scrub", "shrubbery"):
            outers = [Polygon(proj(m["geometry"])) for m in e.get("members", []) if m.get("role") == "outer" and len(m.get("geometry", [])) >= 4]
            if outers:
                scrub.append((e["id"], t, unary_union([p.buffer(0) for p in outers])))
    return hedges, scrub, shrubs


def osm_height(tags):
    try:
        h = float(str(tags.get("height", "")).replace("m", "").strip())
    except ValueError:
        return None
    return h if 0.3 <= h <= 4.0 else None


# --- skeleton → polylines -------------------------------------------------

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def trace_skeleton(skel):
    """Pixel paths between skeleton nodes (degree ≠ 2); cycles included."""
    pts = set(zip(*np.nonzero(skel)))
    deg = {p: sum((p[0] + dr, p[1] + dc) in pts for dr, dc in NB) for p in pts}
    nodes = {p for p, k in deg.items() if k != 2}
    seen_edges = set()
    paths = []

    def walk(start, nxt):
        path = [start, nxt]
        prev, cur = start, nxt
        while cur not in nodes:
            step = [(cur[0] + dr, cur[1] + dc) for dr, dc in NB if (cur[0] + dr, cur[1] + dc) in pts and (cur[0] + dr, cur[1] + dc) != prev]
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
    return sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(path, path[1:]))


# --- the bake ---------------------------------------------------------------


def load_inputs(a):
    xmin, ymin = a.xmin, a.ymin
    grid = Grid(xmin, ymin, xmin + 2000, ymin + 2000)
    I = {"grid": grid}
    der = a.lsc
    I["has_lsc"] = bool(der) and os.path.exists(os.path.join(der, "dsm_050.tif"))
    I["cls"] = grid.resample_png(a.landcover, nearest=True)
    I["ndvi"] = grid.resample_png(a.ndvi, nearest=False) if a.ndvi and os.path.exists(a.ndvi) else np.zeros((grid.n, grid.n), np.float32)
    I["bld"] = building_mask(grid, a.cityjson)
    walls = [shape(f["geometry"]).buffer(WALL_BUF_M) for f in json.load(open(a.walls))["features"]] if a.walls and os.path.exists(a.walls) else []
    I["walls"] = grid.burn(walls)
    bridges = [shape(f["geometry"]) for f in json.load(open(a.bridge))["features"]] if a.bridge and os.path.exists(a.bridge) else []
    I["bridge"] = grid.burn(bridges)
    if I["has_lsc"]:
        ground = read_band(os.path.join(der, "dtm_050.tif"), "idw")
        dgm = dgm_on(grid, a.dgm)
        ground = np.where(np.isnan(ground), dgm, ground)
        dsm = read_band(os.path.join(der, "dsm_050.tif"), "max")
        ndom = np.where(np.isnan(dsm), 0.0, dsm - ground)
        I["ndom"] = np.nan_to_num(ndom).astype(np.float32)
        ng = np.nan_to_num(read_band(os.path.join(der, "nonground_count_050.tif"), None))
        me = np.nan_to_num(read_band(os.path.join(der, "nonground_multiecho_count_050.tif"), None))
        I["echo"] = windowed_ratio(me, ng)
        ipath = os.path.join(a.lowveg_dir, "lowint_050.tif")
        imean = np.nan_to_num(read_band(ipath, "mean"))
        icnt = np.nan_to_num(read_band(ipath, "count"))
        I["int"] = windowed_ratio(imean * icnt, icnt)
    return I


def lowveg_mask(I, scrub_mask):
    ndom, cls = I["ndom"], I["cls"]
    band = (ndom >= BAND[0]) & (ndom <= BAND[1])
    rim = ndi.binary_dilation(ndom > TALL, disk(int(round(RIM_M / RES))))
    bld = ndi.binary_dilation(I["bld"], disk(int(round(BLD_BUF_M / RES))))
    excl = rim | bld | I["walls"] | I["bridge"] | np.isin(cls, BLOCKED_CLASSES)
    cue = (I["ndvi"] >= NDVI_T) | ((I["int"] >= INT_T) & (I["echo"] >= ECHO_T))
    cue |= scrub_mask & ((I["ndvi"] >= SCRUB_NDVI_T) | (I["echo"] >= SCRUB_ECHO_T))
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
            shrubs.append((sl[0].start + rr.mean(), sl[1].start + cc.mean(), float(np.percentile(h[comp], 90)), math.sqrt(a / math.pi)))
            continue
        sm = ndi.gaussian_filter(np.where(comp, h, 0), 1.0)
        pk = peak_local_max(sm, min_distance=SHRUB_PEAK_PX, labels=comp.astype(np.uint8), exclude_border=False)
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
        line = LineString(list(zip(x, y))).simplify(DP_TOL)
        if line.length < SPUR_M:
            continue
        out.append((line, float(np.median(ridge[rr, cc])), float(np.clip(2 * np.median(dist[rr, cc]), 0.5, HEDGE_MAX_W))))
    return out


def merge_lines(lines):
    """Join touching LSC pieces so a hedge is one polyline, not a dozen stubs."""
    if not lines:
        return []
    merged = linemerge(MultiLineString([l for l, _, _ in lines]))
    geoms = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    out = []
    for g in geoms:
        near = [(h, w, l.length) for l, h, w in lines if l.distance(g) < 0.3]
        tot = sum(n[2] for n in near) or 1
        out.append((g.simplify(DP_TOL), sum(n[0] * n[2] for n in near) / tot, sum(n[1] * n[2] for n in near) / tot))
    return out


def osm_support_rasters(I, mask):
    """What osm_hedge_height samples: the mask grown by OSM_SUPPORT_M, and the
    local (1 m) max of the nDOM below the band's top — computed once per tile."""
    near = ndi.binary_dilation(mask, disk(int(OSM_SUPPORT_M / RES)))
    band_max = ndi.maximum_filter(np.where(I["ndom"] <= BAND[1] + 0.5, I["ndom"], 0), footprint=disk(2))
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


def build(a):
    I = load_inputs(a)
    grid = I["grid"]
    tile = box(grid.xmin, grid.ymin, grid.xmax, grid.ymax)
    o_hedges, o_scrub, o_shrubs = load_osm(a.osm)
    o_hedges = [(i, t, g.intersection(tile)) for i, t, g in o_hedges if g.intersects(tile)]
    o_hedges = [(i, t, g) for i, t, g in o_hedges if g.length >= 1.0]
    o_scrub = [(i, t, g.intersection(tile)) for i, t, g in o_scrub if g.intersects(tile)]
    o_shrubs = [(i, t, g) for i, t, g in o_shrubs if tile.contains(g)]
    feats, stats = [], {"osm_hedges": len(o_hedges), "osm_hedge_m": round(sum(g.length for _, _, g in o_hedges)), "osm_scrub": len(o_scrub), "osm_shrub_nodes": len(o_shrubs)}

    mask = np.zeros((grid.n, grid.n), bool)
    lsc_lines, lsc_shrubs = [], []
    if I["has_lsc"]:
        scrub_mask = grid.burn([g for _, _, g in o_scrub])
        mask, parts = lowveg_mask(I, scrub_mask)
        hedge_mask, skel, shrubs_rc = split_components(mask, I["ndom"])
        lsc_lines = merge_lines(hedge_lines(grid, hedge_mask, skel, I["ndom"]))
        for r, c, h, rad in shrubs_rc:
            x, y = grid.xy(r, c)
            lsc_shrubs.append((Point(x, y), h, rad))
        I["mask"], I["hedge_mask"] = mask, hedge_mask
        stats.update(lsc_mask_m2=round(float(mask.sum()) * RES * RES), lsc_hedge_pieces=len(lsc_lines), lsc_shrubs=len(lsc_shrubs))

    # 1) OSM hedges: geometry wins; the LSC supplies the height where it sees one.
    support_rasters = osm_support_rasters(I, mask) if I["has_lsc"] else None
    osm_lines = []
    for oid, t, g in o_hedges:
        parts = list(g.geoms) if hasattr(g, "geoms") else [g]
        for part in parts:
            if part.length < 1.0:
                continue
            h = osm_hedge_height(grid, part, support_rasters)
            src = "osm+lsc" if h is not None else "osm"
            h = h if h is not None else (osm_height(t) or OSM_DEFAULT_H)
            osm_lines.append(part)
            feats.append(hedge_feature(part, h, OSM_DEFAULT_W, src))
    # 2) LSC hedges fill the unmapped ones.
    snap = unary_union([l.buffer(OSM_SNAP_M) for l in osm_lines]) if osm_lines else None
    added = 0
    for line, h, w in lsc_lines:
        rest = line.difference(snap) if snap is not None else line
        for part in list(rest.geoms) if hasattr(rest, "geoms") else [rest]:
            if part.length >= 2.0:
                feats.append(hedge_feature(part, h, w, "lsc"))
                added += 1
    # width for OSM hedges: the nearest LSC hedge's width when it overlaps
    for f in feats:
        if f["properties"]["src"] == "osm+lsc":
            g = shape(f["geometry"])
            near = [w for l, _, w in lsc_lines if l.distance(g) < OSM_SNAP_M]
            if near:
                f["properties"]["w"] = round(float(np.median(near)), 1)
    # 3) shrubs — not inside a hedge's footprint
    hedge_zone = unary_union([shape(f["geometry"]).buffer(max(f["properties"]["w"], 1.0)) for f in feats]) if feats else None
    for p, h, rad in lsc_shrubs:
        if hedge_zone is not None and hedge_zone.contains(p):
            continue
        feats.append(shrub_feature(p, h, rad, "lsc"))
    for _, t, p in o_shrubs:
        feats.append(shrub_feature(p, osm_height(t) or 1.8, 1.2, "osm"))
    # OSM-only tiles do NOT fill scrub polygons with shrubs: tried (a jittered
    # 3–4 m grid) and it produced more shrubs per neighbour tile (4–9 k) than
    # the laser scan finds on the primary, most of them under existing crowns.
    stats.update(lsc_hedges_added=added, shrubs=sum(f["geometry"]["type"] == "Point" for f in feats), hedges=sum(f["geometry"]["type"] == "LineString" for f in feats))
    return I, feats, stats, (o_hedges, o_scrub)


def hedge_feature(line, h, w, src):
    return {
        "type": "Feature",
        "properties": {"kind": "hedge", "h": round(float(h), 1), "w": round(float(w), 1), "src": src},
        "geometry": {"type": "LineString", "coordinates": [[round(x, 1), round(y, 1)] for x, y in line.coords]},
    }


def shrub_feature(p, h, r, src):
    return {
        "type": "Feature",
        "properties": {"kind": "shrub", "h": round(float(h), 1), "r": round(float(r), 1), "src": src},
        "geometry": {"type": "Point", "coordinates": [round(p.x, 1), round(p.y, 1)]},
    }


def canopy_extra(I, canopy_path):
    """LSC crown peaks (>3 m, multi-echo) the current canopy leaves out."""
    grid, ndom, cls = I["grid"], I["ndom"], I["cls"]
    bld = ndi.binary_dilation(I["bld"], disk(2))
    tall = (ndom > TALL) & (ndom < 45) & (I["echo"] >= CANOPY_ECHO_T)
    tall = ndi.binary_opening(tall, np.ones((3, 3), bool))
    lab, n = ndi.label(tall)
    area = ndi.sum(np.ones_like(lab, np.float32), lab, np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = area >= 16  # ≥ 4 m² of crown
    tall = keep[lab] & ~bld & ~I["bridge"] & ~np.isin(cls, TREE_BLOCKED_CLASSES)
    chm = ndi.gaussian_filter(np.where(tall, ndom, 0), 1.5)
    pk = peak_local_max(chm, min_distance=CANOPY_PEAK_PX, threshold_abs=TALL, labels=tall.astype(np.uint8), exclude_border=False)
    # crown radius: distance to the crown edge at the peak, capped
    edge = ndi.distance_transform_edt(tall) * RES
    cur = json.load(open(canopy_path))["features"] if canopy_path and os.path.exists(canopy_path) else []
    cxy = np.array([f["geometry"]["coordinates"] for f in cur]) if cur else np.zeros((0, 2))
    from scipy.spatial import cKDTree

    tree = cKDTree(cxy) if len(cxy) else None
    out = []
    for r, c in pk:
        x, y = grid.xy(r, c)
        if tree is not None and tree.query([x, y])[0] <= CANOPY_DEDUP_M:
            continue
        out.append({
            "type": "Feature",
            "properties": {"h": round(float(ndom[r, c]), 1), "r": round(float(min(max(edge[r, c], 1.0), 8.0)), 1)},
            "geometry": {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
        })
    return out, len(pk)


def write_fc(path, feats, attribution):
    geo = {"type": "FeatureCollection"}
    if attribution:
        geo["attribution"] = attribution
    geo["crs"] = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25833"}}
    geo["features"] = feats
    with open(path, "w") as f:
        json.dump(geo, f, separators=(",", ":"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--tile", required=True)
    p.add_argument("--xmin", type=float, required=True)
    p.add_argument("--ymin", type=float, required=True)
    p.add_argument("--lsc", help="dir with dtm_050/dsm_050/nonground_*_050.tif")
    p.add_argument("--lowveg-dir", help="dir with lowint_050.tif")
    p.add_argument("--dgm", required=True)
    p.add_argument("--landcover", required=True)
    p.add_argument("--ndvi")
    p.add_argument("--cityjson", required=True)
    p.add_argument("--walls")
    p.add_argument("--bridge")
    p.add_argument("--osm")
    p.add_argument("--canopy")
    p.add_argument("--out", required=True)
    p.add_argument("--out-canopyx")
    a = p.parse_args()
    I, feats, stats, _ = build(a)
    attribution = "Quelle: GeoSN, dl-de/by-2-0 (laser scan); © OpenStreetMap contributors (ODbL)" if I["has_lsc"] else "© OpenStreetMap contributors (ODbL)"
    write_fc(a.out, feats, attribution)
    log(f"wrote {a.out}: {json.dumps(stats)}")
    if a.out_canopyx and I["has_lsc"]:
        extra, peaks = canopy_extra(I, a.canopy)
        write_fc(a.out_canopyx, extra, "Quelle: GeoSN, dl-de/by-2-0 (laser scan)")
        log(f"wrote {a.out_canopyx}: {len(extra)} extra trees of {peaks} crown peaks")


if __name__ == "__main__":
    main()
