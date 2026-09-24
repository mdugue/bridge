"""Hedges and the laser-scan trees the canopy misses, for one tile. The method
and the evidence behind every threshold are in docs/transformations.md ("Low
vegetation") — keep the two in step.

Outputs (small, committed under data/dlm/):
  lowveg_<tile>.geojson   the OSM `barrier=hedge` lines {kind: "hedge", h, w,
                          src: "osm" | "osm+lsc"}: the geometry is OSM's, the
                          height (and width) the laser scan's where it sees
                          the hedge, else the tag or a default
  canopyx_<tile>.geojson  laser-scan crown peaks > 3 m that the canopy
                          (canopy_<tile>.geojson) does not cover and no
                          cadastre tree (trees_<tile>.geojson) claims {h, r} —
                          courtyard and garden trees. Only on a tile with a scan.

Inputs: the OSM extract (osm.py), and — where the tile has one — the GeoSN
laser scan as `<raw>/lsc/<tile>.laz` (the classified LAS 1.4 point cloud; put
there by hand, it is a large download), which PDAL (the `pdal` CLI) grids
into 0.5 m rasters under `<raw>/lsc/derived/<tile>/`. Without a scan the
hedges keep their tagged or default height and no canopyx is written. The
committed DGM, class raster, NDVI, CityJSON, walls and bridges gate the mask.

The laser scan also finds hedges OSM lacks and free-standing shrubs; neither
is shipped (about 30 % of them are crown rims, and a shrub dome reads as a
faceted boulder up close), so this bake no longer derives them — the
scan-only hedge lines survive only to lend an OSM hedge their width.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
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
from shapely.geometry import LineString, MultiLineString, Polygon, box, mapping, shape
from shapely.ops import linemerge
from skimage.feature import peak_local_max
from skimage.morphology import skeletonize

from .common import OSM_ATTRIBUTION, Tile, column, feature, write_geojson
from .osm import has_extract, read_osm, tag

RES = 0.5  # the laser-scan raster grid (m)

# --- thresholds (each one measured on the spawn tile; see the ledger) --------
BAND = (0.5, 3.0)  # low-vegetation height band above ground (m)
TALL = 3.0  # above this a crown belongs to the canopy layer
RIM_M = 1.0  # band pixels this close to a >TALL pixel are crown edge, not shrub
BLD_BUF_M = 1.0  # DSM-max binning smears eaves/walls this far past a footprint
WALL_BUF_M = 0.75  # OSM walls/city walls (a garden wall reads as a 1–2 m "hedge")
# The vegetation cue. NDVI (DOP, leaf-off) separates hedges from cars best
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
SPUR_M = 1.5  # skeleton spurs shorter than this are pruned
DP_TOL = 0.4  # Douglas-Peucker tolerance (m)
OSM_SNAP_M = 2.0  # a scan hedge within this of an OSM hedge is the OSM hedge
OSM_SUPPORT_M = 1.5
OSM_DEFAULT_H = 1.5
OSM_DEFAULT_W = 1.0
# Out-of-mask canopy trees
CANOPY_ECHO_T = 0.5  # tall vegetation is multi-echo (median 1.0 vs 0.0 on roofs)
CANOPY_PEAK_PX = 6  # crown peaks ≥ 3 m apart
CANOPY_DEDUP_M = 5.0  # a peak this close to a current canopy point is covered
# A scan tree this close to a cadastre tree (or inside its crown, when that is
# wider) is the same tree: the cadastre wins — it has the surveyed spot, crown
# and taxon. Radius, not 1:1 matching: one big crown often yields two scan
# peaks, and both belong to it.
CADASTRE_DEDUP_M = 4.0
BLOCKED_CLASSES = (5, 8)  # railway, water — never low vegetation
TREE_BLOCKED_CLASSES = (5, 6, 7, 8)  # as the canopy bake: no tree on these
LSC_ATTRIBUTION = "Quelle: GeoSN, dl-de/by-2-0 (laser scan)"


def disk(r_px: int) -> np.ndarray:
    y, x = np.mgrid[-r_px : r_px + 1, -r_px : r_px + 1]
    return np.hypot(x, y) <= r_px + 0.01


class Grid:
    """The tile's 0.5 m grid (row 0 = north), with projected-coordinate helpers."""

    def __init__(self, bounds: tuple[float, float, float, float]):
        self.xmin, self.ymin, self.xmax, self.ymax = bounds
        self.n = int(round((self.xmax - self.xmin) / RES))
        self.transform = from_origin(self.xmin, self.ymax, RES, RES)

    def xy(self, r, c):
        return self.xmin + (c + 0.5) * RES, self.ymax - (r + 0.5) * RES

    def rc(self, x, y):
        c = np.clip(((np.asarray(x) - self.xmin) / RES).astype(int), 0, self.n - 1)
        r = np.clip(((self.ymax - np.asarray(y)) / RES).astype(int), 0, self.n - 1)
        return r, c

    def burn(self, geoms) -> np.ndarray:
        shapes = [(mapping(g), 1) for g in geoms if g is not None and not g.is_empty]
        if not shapes:
            return np.zeros((self.n, self.n), bool)
        return rasterize(
            shapes, out_shape=(self.n, self.n), transform=self.transform, dtype=np.uint8
        ).astype(bool)

    def resample_png(self, path: Path, nearest: bool) -> np.ndarray:
        from PIL import Image

        img = np.array(Image.open(path).convert("L"))
        idx = ((np.arange(self.n) + 0.5) * img.shape[0] / self.n).astype(int)
        out = img[np.ix_(idx, idx)]
        return out if nearest else out.astype(np.float32) / 255.0


# --- the laser-scan rasters (PDAL) ------------------------------------------


def pdal_raster(
    laz: Path,
    out: Path,
    grid: Grid,
    ranges: str,
    dim: str,
    otype: str,
    window: int,
    extra: list[dict] | None = None,
) -> None:
    """One 0.5 m raster of the scan. writers.gdal needs binmode (else it bins
    with a 0.71 m radius), and a pipeline with several writers runs only the
    first — hence one run per raster."""
    if out.exists():
        return
    stages = [
        str(laz),
        {"type": "filters.range", "limits": ranges},
        *(extra or []),
        {
            "type": "writers.gdal",
            "filename": str(out),
            "dimension": dim,
            "output_type": otype,
            "window_size": window,
            "resolution": RES,
            "origin_x": grid.xmin,
            "origin_y": grid.ymin,
            "width": grid.n,
            "height": grid.n,
            "data_type": "float32",
            "nodata": -9999,
            "binmode": True,
            "gdalopts": "COMPRESS=DEFLATE,PREDICTOR=3,TILED=YES",
        },
    ]
    print(f"PDAL → {out.name}")
    subprocess.run(
        ["pdal", "pipeline", "--stdin"],
        input=json.dumps({"pipeline": stages}),
        text=True,
        check=True,
    )


def lsc_rasters(tile: Tile, grid: Grid) -> Path | None:
    """The derived rasters' folder, built from the tile's LAZ; None without one."""
    laz = tile.raw / "lsc" / f"{tile.id}.laz"
    if not laz.exists():
        print(f"{tile.id}: no laser scan at {laz} — hedges from OSM tags only, no canopyx")
        return None
    if shutil.which("pdal") is None:
        raise SystemExit("lowveg: the laser scan needs the PDAL CLI (`pdal`) on PATH")
    der = tile.raw / "lsc" / "derived" / tile.id
    der.mkdir(parents=True, exist_ok=True)
    ground = "Classification[2:2],Classification[8:8],Classification[30:30]"
    pdal_raster(laz, der / "dtm_050.tif", grid, ground, "Z", "idw,min,count", 3)
    pdal_raster(
        laz,
        der / "dsm_050.tif",
        grid,
        "Classification[2:2],Classification[20:20]",
        "Z",
        "max,count",
        0,
    )
    nonground = "Classification[20:20]"
    pdal_raster(laz, der / "nonground_count_050.tif", grid, nonground, "Z", "count", 0)
    pdal_raster(
        laz,
        der / "nonground_multiecho_count_050.tif",
        grid,
        nonground,
        "Z",
        "count",
        0,
        [{"type": "filters.range", "limits": "NumberOfReturns[2:]"}],
    )
    pdal_raster(
        laz,
        der / "lowint_050.tif",
        grid,
        nonground,
        "Intensity",
        "mean,count",
        0,
        [
            {"type": "filters.hag_dem", "raster": str(der / "dtm_050.tif"), "band": 2},
            {"type": "filters.range", "limits": "HeightAboveGround[0.25:4.0]"},
        ],
    )
    return der


def read_band(path: Path, desc: str | None) -> np.ndarray:
    with rasterio.open(path) as ds:
        i = list(ds.descriptions).index(desc) + 1 if desc else 1
        a = ds.read(i).astype(np.float32)
        a[a == -9999] = np.nan
        return a


def dgm_on(grid: Grid, tile: Tile) -> np.ndarray:
    out = np.full((grid.n, grid.n), np.nan, np.float32)
    with rasterio.open(tile.dgm) as ds:
        reproject(
            ds.read(1).astype(np.float32),
            out,
            src_transform=ds.transform,
            src_crs=f"EPSG:{tile.epsg}",
            dst_transform=grid.transform,
            dst_crs=f"EPSG:{tile.epsg}",
            resampling=Resampling.bilinear,
            src_nodata=ds.nodata,
            dst_nodata=np.nan,
        )
    return out


def building_mask(grid: Grid, cityjson: Path) -> np.ndarray:
    """Every LoD2 surface projected to 2D — the roof outline incl. overhangs."""
    d = json.loads(cityjson.read_text())
    sc, tr = d["transform"]["scale"], d["transform"]["translate"]
    v = np.asarray(d["vertices"], dtype=np.float64)
    xs, ys = v[:, 0] * sc[0] + tr[0], v[:, 1] * sc[1] + tr[1]
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
                    p = Polygon(list(zip(xs[ring], ys[ring], strict=True)))
                    if p.is_valid and p.area > 0.05:
                        polys.append(p)
    return grid.burn(polys)


def windowed_ratio(num: np.ndarray, den: np.ndarray, k: int = 3) -> np.ndarray:
    w = np.ones((k, k), np.float32)
    s_num = ndi.convolve(num, w, mode="constant")
    s_den = ndi.convolve(den, w, mode="constant")
    return np.where(s_den > 0, s_num / np.maximum(s_den, 1e-6), 0.0).astype(np.float32)


def features_of(path: Path) -> list[dict]:
    return json.loads(path.read_text())["features"] if path.exists() else []


def load_inputs(tile: Tile, grid: Grid, der: Path | None) -> dict:
    dlm = tile.data / "dlm"
    ndvi = dlm / f"ndvi_{tile.id}.png"
    inputs = {
        "cls": grid.resample_png(dlm / f"landcover_{tile.id}.png", nearest=True),
        "ndvi": grid.resample_png(ndvi, nearest=False)
        if ndvi.exists()
        else np.zeros((grid.n, grid.n), np.float32),
        "bld": building_mask(grid, tile.data / "cityjson" / f"lod2_{tile.id}.city.json"),
        "walls": grid.burn(
            shape(f["geometry"]).buffer(WALL_BUF_M)
            for f in features_of(dlm / f"walls_{tile.id}.geojson")
        ),
        "bridge": grid.burn(
            shape(f["geometry"]) for f in features_of(dlm / f"bridge_{tile.id}.geojson")
        ),
    }
    if der is None:
        return inputs
    ground = read_band(der / "dtm_050.tif", "idw")
    ground = np.where(np.isnan(ground), dgm_on(grid, tile), ground)
    dsm = read_band(der / "dsm_050.tif", "max")
    inputs["ndom"] = np.nan_to_num(np.where(np.isnan(dsm), 0.0, dsm - ground)).astype(np.float32)
    ng = np.nan_to_num(read_band(der / "nonground_count_050.tif", None))
    me = np.nan_to_num(read_band(der / "nonground_multiecho_count_050.tif", None))
    inputs["echo"] = windowed_ratio(me, ng)
    imean = np.nan_to_num(read_band(der / "lowint_050.tif", "mean"))
    icnt = np.nan_to_num(read_band(der / "lowint_050.tif", "count"))
    inputs["int"] = windowed_ratio(imean * icnt, icnt)
    return inputs


# --- OSM ---------------------------------------------------------------------


def osm_hedges_and_scrub(tile: Tile) -> tuple[list[tuple[str | None, shapely.Geometry]], list]:
    """(hedge lines with their other_tags, scrub polygons), clipped to the
    tile. A closed hedge way is a ring of hedge (its exterior, if GDAL read it
    as an area)."""
    area = box(*tile.bounds)
    hedges = []
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, "barrier = 'hedge'", ["barrier", "other_tags"])
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            parts = shapely.get_parts(g)
            for part in parts:
                line = part.exterior if isinstance(part, Polygon) else part
                clipped = shapely.intersection(line, area)
                if not clipped.is_empty and clipped.length >= 1.0:
                    hedges.append((other, clipped))
    geoms, _ = read_osm(tile, "multipolygons", "natural IN ('scrub','shrubbery')", ["natural"])
    scrub = [shapely.intersection(shapely.make_valid(g), area) for g in geoms]
    return hedges, [g for g in scrub if not g.is_empty]


def osm_height(other_tags: str | None) -> float | None:
    try:
        h = float(str(tag(other_tags, "height") or "").replace("m", "").strip())
    except ValueError:
        return None
    return h if 0.3 <= h <= 4.0 else None


# --- skeleton → polylines ------------------------------------------------------

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def trace_skeleton(skel: np.ndarray):
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


def path_length_px(path) -> float:
    return sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(path, path[1:], strict=False))


# --- the scan's low-vegetation mask and hedge lines --------------------------


def lowveg_mask(inputs: dict, scrub_mask: np.ndarray) -> np.ndarray:
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
    return keep[lab]


def hedge_components(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The elongated components of the mask (hedges, not shrub beds) and
    their skeleton."""
    lab, n = ndi.label(mask, np.ones((3, 3), bool))
    idx = np.arange(1, n + 1)
    skel = skeletonize(mask)
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
    return hedge_mask, skel & hedge_mask


def hedge_lines(grid: Grid, hedge_mask: np.ndarray, skel: np.ndarray, ndom: np.ndarray):
    """The scan's hedges as (line, height, width), touching pieces joined."""
    dist = ndi.distance_transform_edt(hedge_mask) * RES
    ridge = ndi.maximum_filter(np.where(hedge_mask, ndom, 0), size=3)
    paths, deg = trace_skeleton(skel)
    lines = []
    for p in paths:
        length = path_length_px(p) * RES
        spur = deg.get(p[0], 0) == 1 or deg.get(p[-1], 0) == 1
        if length < SPUR_M or (spur and len(paths) > 1 and length < 2 * SPUR_M):
            continue
        rr = np.array([q[0] for q in p])
        cc = np.array([q[1] for q in p])
        x, y = grid.xy(rr, cc)
        line = LineString(list(zip(x, y, strict=True))).simplify(DP_TOL)
        if line.length < SPUR_M:
            continue
        w = float(np.clip(2 * np.median(dist[rr, cc]), 0.5, HEDGE_MAX_W))
        lines.append((line, float(np.median(ridge[rr, cc])), w))
    if not lines:
        return []
    merged = linemerge(MultiLineString([line for line, _, _ in lines]))
    out = []
    for g in getattr(merged, "geoms", [merged]):
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


def osm_hedge_height(grid: Grid, line, near: np.ndarray, band_max: np.ndarray) -> float | None:
    """The scan's height along an OSM hedge, or None where < 30 % of it is seen."""
    samples = [line.interpolate(d) for d in np.arange(0, line.length + 1e-6, RES)]
    r, c = grid.rc([p.x for p in samples], [p.y for p in samples])
    sup = near[r, c]
    if sup.mean() < 0.3:
        return None
    h = float(np.median(band_max[r[sup], c[sup]]))
    return h if BAND[0] <= h <= BAND[1] + 0.5 else None


def hedge_feature(line, h: float, w: float, src: str) -> dict:
    return feature(
        {"type": "LineString", "coordinates": [[round(x, 1), round(y, 1)] for x, y in line.coords]},
        {"kind": "hedge", "h": round(float(h), 1), "w": round(float(w), 1), "src": src},
    )


def hedges(tile: Tile, grid: Grid, inputs: dict, osm) -> list[dict]:
    """The OSM hedges: geometry from OSM, the scan supplies height and width
    where it sees them."""
    o_hedges, o_scrub = osm
    scan = "ndom" in inputs
    lines, near, band_max = [], None, None
    if scan:
        mask = lowveg_mask(inputs, grid.burn(o_scrub))
        lines = hedge_lines(grid, *hedge_components(mask), inputs["ndom"])
        # what osm_hedge_height samples: the mask grown by OSM_SUPPORT_M, and
        # the local (1 m) max of the nDOM below the band's top
        near = ndi.binary_dilation(mask, disk(int(OSM_SUPPORT_M / RES)))
        ndom = inputs["ndom"]
        band_max = ndi.maximum_filter(np.where(ndom <= BAND[1] + 0.5, ndom, 0), footprint=disk(2))
    out = []
    for other, g in o_hedges:
        for part in shapely.get_parts(g):
            if part.length < 1.0:
                continue
            h = osm_hedge_height(grid, part, near, band_max) if scan else None
            w = OSM_DEFAULT_W
            if h is not None:
                widths = [lw for line, _, lw in lines if line.distance(part) < OSM_SNAP_M]
                w = float(np.median(widths)) if widths else w
            src = "osm+lsc" if h is not None else "osm"
            if h is None:
                h = osm_height(other) or OSM_DEFAULT_H
            out.append(hedge_feature(part, h, w, src))
    return out


# --- trees the canopy misses ---------------------------------------------------


def canopy_extra(tile: Tile, grid: Grid, inputs: dict) -> tuple[list[dict], int]:
    """Scan crown peaks (> 3 m, multi-echo) the canopy leaves out."""
    ndom, cls = inputs["ndom"], inputs["cls"]
    bld = ndi.binary_dilation(inputs["bld"], disk(2))
    tall = (ndom > TALL) & (ndom < 45) & (inputs["echo"] >= CANOPY_ECHO_T)
    tall = ndi.binary_opening(tall, np.ones((3, 3), bool))
    lab, n = ndi.label(tall)
    area = ndi.sum(np.ones_like(lab, np.float32), lab, np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = area >= 16  # ≥ 4 m² of crown
    tall = keep[lab] & ~bld & ~inputs["bridge"] & ~np.isin(cls, TREE_BLOCKED_CLASSES)
    chm = ndi.gaussian_filter(np.where(tall, ndom, 0), 1.5)
    peaks = peak_local_max(
        chm,
        min_distance=CANOPY_PEAK_PX,
        threshold_abs=TALL,
        labels=tall.astype(np.uint8),
        exclude_border=False,
    )
    # crown radius: distance to the crown edge at the peak, capped
    edge = ndi.distance_transform_edt(tall) * RES
    canopy = features_of(tile.data / "dlm" / f"canopy_{tile.id}.geojson")
    index = cKDTree([f["geometry"]["coordinates"] for f in canopy]) if canopy else None
    out = []
    for r, c in peaks:
        x, y = grid.xy(r, c)
        if index is not None and index.query([x, y])[0] <= CANOPY_DEDUP_M:
            continue
        out.append(
            feature(
                {"type": "Point", "coordinates": [round(float(x), 1), round(float(y), 1)]},
                {
                    "h": round(float(ndom[r, c]), 1),
                    "r": round(float(min(max(edge[r, c], 1.0), 8.0)), 1),
                },
            )
        )
    return out, len(peaks)


def without_cadastre(extra: list[dict], cadastre: list[dict]) -> list[dict]:
    """Drops the scan trees within max(4 m, crown radius) of a cadastre tree."""
    cad = [f for f in cadastre if f.get("geometry")]
    if not cad or not extra:
        return extra
    xy = np.array([f["geometry"]["coordinates"] for f in cad])
    reach = np.array([max(CADASTRE_DEDUP_M, (f["properties"] or {}).get("d", 0) / 2) for f in cad])
    index = cKDTree(xy)
    kept = []
    for f in extra:
        p = f["geometry"]["coordinates"]
        near = index.query_ball_point(p, float(reach.max()))
        if not any(math.dist(p, xy[i]) <= reach[i] for i in near):
            kept.append(f)
    return kept


def run(tile: Tile) -> None:
    if not has_extract(tile, "the hedges"):
        return
    grid = Grid(tile.bounds)
    der = lsc_rasters(tile, grid)
    inputs = load_inputs(tile, grid, der)
    found = hedges(tile, grid, inputs, osm_hedges_and_scrub(tile))
    attribution = f"{LSC_ATTRIBUTION}; {OSM_ATTRIBUTION}" if der else OSM_ATTRIBUTION
    write_geojson(tile.out("dlm", f"lowveg_{tile.id}.geojson"), found, tile.epsg, attribution)
    measured = sum(f["properties"]["src"] == "osm+lsc" for f in found)
    print(f"{tile.id}: {len(found)} OSM hedges ({measured} measured by the scan)")
    if der is None:
        return
    extra, peaks = canopy_extra(tile, grid, inputs)
    kept = without_cadastre(extra, features_of(tile.data / "dlm" / f"trees_{tile.id}.geojson"))
    write_geojson(tile.out("dlm", f"canopyx_{tile.id}.geojson"), kept, tile.epsg, LSC_ATTRIBUTION)
    print(
        f"{tile.id}: {len(kept)} scan trees of {peaks} crown peaks "
        f"({len(extra) - len(kept)} dropped as cadastre trees)"
    )
