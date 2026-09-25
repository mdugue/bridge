"""The city's large-scale light, baked from the committed DGM1 and LoD2:
the sky-view factor (how much of the sky a point on the ground sees) and
the far horizon (per direction, the elevation angle of the skyline more
than 80 m away) — the ambient term the hemisphere light cannot know and the
long shadows the shadow map's 110 m frustum cuts off (docs/plans/033).

Height field: the DGM1 with every non-vertical LoD2 surface burned on top
(max over its triangles, the plane of each surface evaluated per cell).
Trees are left out on purpose — they cast real shadows and have their own
shading — and so is DOM1: the bake is reproducible from the repository.
Committed neighbour tiles fill the margin; beyond the site the ground is
open, at the mean height of the tile's edge.

Outputs:
  data/dlm/svf_<tile>.png      1024² (≈2 m), 8-bit: 255 · svf, where
                               svf = 1 − mean over 16 azimuths of sin² h and
                               h is the horizon within 150 m (isotropic sky).
                               Texels under a roof (their ground sees almost
                               no sky) take the nearest open texel's value, so
                               LINEAR filtering and the mipmaps never pull a
                               dark band out of the footprints onto the
                               street
  data/dlm/horizon_<tile>.png  256² (≈8 m) × 16 azimuths × two bands: the
                               horizon angle of occluders 80–1 500 m away
                               (the far band, 0–45° in 8 bits) and 8–80 m
                               away (the near band, 0–90° in 8 bits). Eight
                               RGBA planes stacked north-to-south in one
                               greyscale PNG four times as wide (R0 G0 B0 A0
                               R1 …; planes 0–3 the far band, 4–7 the near
                               band; plane p, channel c = azimuth 4 (p mod 4)
                               + c), so the viewer reads it as an 8-layer
                               array texture with its own decoder
                               (lib/city/png-raster.ts). Footprint texels
                               take the nearest open texel's angles, as the
                               sky view's do
  data/dlm/horizon_<tile>.json the legend (azimuths, bands, angle scales) —
                               lib/city/skyview.ts keeps the same constants
The observer is the bare ground (DGM): the rasters shade the terrain and,
sampled just outside a wall, its facade.

The two bands split the work with the shadow map (docs/adr/0031): inside
the shadow frustum the map has the near occluders' shapes and the viewer
reads the far band alone; beyond it nothing else knows the building across
the street, so the viewer takes the higher of the two bands there (a 20 m
block's 55 m shadow at a 20° sun lies wholly in the near band).

The plan asked for the horizon at 4 m (512²); on the spawn tile that PNG
came to 1.86 MB for the far band alone, past the plan's 1.5 MB cap, so it
is baked at 8 m (the plan's second fallback) and keeps its 16 azimuths — a
far skyline changes slowly across the ground, but a 30° azimuth step would
smear every narrow occluder over a wide arc of sun positions. Both bands
together stay under the cap (the run logs the size).
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import numpy as np
import rasterio
import shapely
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from scipy.ndimage import distance_transform_edt

from .common import Tile
from .lowveg import lod2_rings

SVF_PX = 1024
SVF_REACH_M = 150.0
HORIZON_PX = 256
HORIZON_NEAR_M = 80.0  # the far band starts here; inside the frustum the
HORIZON_FAR_M = 1500.0  # nearer occluders are the shadow map's
HORIZON_MAX_DEG = 45.0
NEAR_BAND_M = 8.0  # the near band: 8–80 m, one 8 m cell out to the far band
NEAR_MAX_DEG = 90.0  # beside a wall the near horizon is steep
FOOTPRINT_MIN_M = 2.0  # a roof this far above the ground: under a building
AZIMUTHS = 16  # clockwise from north, 22.5° apart
WALL_NZ = 0.05  # |n_z| below this: a vertical wall, nothing to burn


def azimuths(count: int = AZIMUTHS) -> np.ndarray:
    """The azimuths (degrees clockwise from north)."""
    return np.arange(count) * (360.0 / count)


# --- the height field -------------------------------------------------------


class Field:
    """A north-up grid over `bounds` with square cells of `res` metres."""

    def __init__(self, bounds: tuple[float, float, float, float], res: float):
        self.xmin, self.ymin, self.xmax, self.ymax = bounds
        self.res = res
        self.cols = int(round((self.xmax - self.xmin) / res))
        self.rows = int(round((self.ymax - self.ymin) / res))
        self.transform = from_origin(self.xmin, self.ymax, res, res)

    @property
    def shape(self) -> tuple[int, int]:
        return self.rows, self.cols


def site_sources(tile: Tile) -> list[tuple[str, tuple[float, float, float, float]]]:
    """Every committed tile (its DGM on disk) as (id, bounds): the tile's
    neighbours fill the margins."""
    found = []
    for tif in sorted((tile.data / "dgm").glob("dgm1_*_tiff/dgm1_*.tif")):
        tid = tif.stem.removeprefix("dgm1_")
        with rasterio.open(tif) as ds:
            b = ds.bounds
        found.append((tid, (b.left, b.bottom, b.right, b.top)))
    return found


def overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def dgm_field(tile: Tile, field: Field, sources) -> np.ndarray:
    """The DGM averaged onto the field from every committed tile it touches
    (NaN where none reaches)."""
    out = np.full(field.shape, np.nan, np.float32)
    bounds = (field.xmin, field.ymin, field.xmax, field.ymax)
    for tid, b in sources:
        if not overlaps(b, bounds):
            continue
        path = tile.data / "dgm" / f"dgm1_{tid}_tiff" / f"dgm1_{tid}.tif"
        with rasterio.open(path) as ds:
            reproject(
                ds.read(1).astype(np.float32),
                out,
                src_transform=ds.transform,
                src_crs=f"EPSG:{tile.epsg}",
                dst_transform=field.transform,
                dst_crs=f"EPSG:{tile.epsg}",
                resampling=Resampling.average,
                src_nodata=ds.nodata,
                dst_nodata=np.nan,
                init_dest_nodata=False,
            )
    return out


def surface_triangles(rings) -> np.ndarray:
    """The non-vertical LoD2 surfaces as (n, 3, 3) triangles in the
    projected CRS, each vertex's z on its surface's plane (a constrained
    triangulation of the ring in plan, lifted by the ring's Newell plane)."""
    polys, planes = [], []
    for ring in rings:
        p = ring - ring.mean(axis=0)
        nxt = np.roll(p, -1, axis=0)
        n = np.array(
            [
                np.sum((p[:, 1] - nxt[:, 1]) * (p[:, 2] + nxt[:, 2])),
                np.sum((p[:, 2] - nxt[:, 2]) * (p[:, 0] + nxt[:, 0])),
                np.sum((p[:, 0] - nxt[:, 0]) * (p[:, 1] + nxt[:, 1])),
            ]
        )
        norm = np.linalg.norm(n)
        if norm < 1e-9 or abs(n[2]) / norm < WALL_NZ:
            continue
        poly = shapely.Polygon(ring[:, :2])
        if not poly.is_valid or poly.area < 0.05:
            continue
        polys.append(poly)
        planes.append((*ring.mean(axis=0), *(n / norm)))
    if not polys:
        return np.zeros((0, 3, 3))
    tris = shapely.constrained_delaunay_triangles(np.asarray(polys, dtype=object))
    parts, owner = shapely.get_parts(tris, return_index=True)
    xy = shapely.get_coordinates(shapely.get_exterior_ring(parts)).reshape(-1, 4, 2)[:, :3]
    pl = np.asarray(planes)[owner]
    # z on the plane n · (p − c) = 0
    cx, cy, cz, nx, ny, nz = (pl[:, None, i] for i in range(6))
    z = cz - (nx * (xy[..., 0] - cx) + ny * (xy[..., 1] - cy)) / nz
    return np.concatenate([xy, z[..., None]], axis=2)


def burn_triangles(field: Field, tris: np.ndarray) -> np.ndarray:
    """The highest triangle over every cell centre (NaN where none), fully
    vectorised: each triangle's bounding box of cells is enumerated, the
    cells inside it are kept and their plane height maxed in."""
    out = np.full(field.shape, -np.inf, np.float64)
    if len(tris):
        col = (tris[..., 0] - field.xmin) / field.res - 0.5
        row = (field.ymax - tris[..., 1]) / field.res - 0.5
        c0 = np.clip(np.ceil(col.min(axis=1)), 0, field.cols).astype(np.int64)
        c1 = np.clip(np.floor(col.max(axis=1)), -1, field.cols - 1).astype(np.int64)
        r0 = np.clip(np.ceil(row.min(axis=1)), 0, field.rows).astype(np.int64)
        r1 = np.clip(np.floor(row.max(axis=1)), -1, field.rows - 1).astype(np.int64)
        w = np.maximum(c1 - c0 + 1, 0)
        h = np.maximum(r1 - r0 + 1, 0)
        count = w * h
        keep = count > 0
        for chunk in np.array_split(np.flatnonzero(keep), max(1, int(count.sum() // 4_000_000))):
            _burn_chunk(out, chunk, col, row, c0, r0, w, count, tris[..., 2])
    out[~np.isfinite(out)] = np.nan
    return out.astype(np.float32)


def _burn_chunk(out, idx, col, row, c0, r0, w, count, z) -> None:
    if len(idx) == 0:
        return
    n = count[idx]
    tri = np.repeat(idx, n)
    start = np.repeat(np.cumsum(n) - n, n)
    k = np.arange(len(tri)) - start
    cc = c0[tri] + k % w[tri]
    rr = r0[tri] + k // w[tri]
    # barycentric weights of the cell centre in the triangle (plan)
    ax, ay = col[tri, 0], row[tri, 0]
    bx, by = col[tri, 1], row[tri, 1]
    cx, cy = col[tri, 2], row[tri, 2]
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    ok = np.abs(det) > 1e-12
    det = np.where(ok, det, 1.0)
    l1 = ((by - cy) * (cc - cx) + (cx - bx) * (rr - cy)) / det
    l2 = ((cy - ay) * (cc - cx) + (ax - cx) * (rr - cy)) / det
    l3 = 1.0 - l1 - l2
    eps = -1e-9
    inside = ok & (l1 >= eps) & (l2 >= eps) & (l3 >= eps)
    zz = l1 * z[tri, 0] + l2 * z[tri, 1] + l3 * z[tri, 2]
    np.maximum.at(out, (rr[inside], cc[inside]), zz[inside])


class Roofs:
    """Each committed tile's LoD2 triangles, read once per run."""

    def __init__(self, tile: Tile, sources):
        self.tile = tile
        self.sources = sources
        self._tris: dict[str, np.ndarray] = {}

    def triangles(self, tid: str) -> np.ndarray:
        if tid not in self._tris:
            path = self.tile.data / "cityjson" / f"lod2_{tid}.city.json"
            self._tris[tid] = surface_triangles(lod2_rings(path))
        return self._tris[tid]

    def burn(self, field: Field) -> np.ndarray:
        bounds = (field.xmin, field.ymin, field.xmax, field.ymax)
        out = np.full(field.shape, np.nan, np.float32)
        for tid, b in self.sources:
            if overlaps(b, bounds):
                out = np.fmax(out, burn_triangles(field, self.triangles(tid)))
        return out


def edge_mean(dgm: np.ndarray, margin: int) -> float:
    """The mean height of the tile's own edge (its outermost ring of cells
    inside the margin) — the open ground assumed beyond the site."""
    inner = dgm[margin : dgm.shape[0] - margin, margin : dgm.shape[1] - margin]
    ring = np.concatenate([inner[0], inner[-1], inner[:, 0], inner[:, -1]])
    ring = ring[np.isfinite(ring)]
    if len(ring):
        return float(ring.mean())
    return float(np.nanmean(dgm)) if np.isfinite(dgm).any() else 0.0


def fields(
    tile: Tile, px: int, reach_m: float, roofs: Roofs, pool: int = 1
) -> tuple[np.ndarray, np.ndarray, int]:
    """The ground (observer) and the surface (occluder) over the tile plus a
    margin of `reach_m`, at the tile's `px` grid; returns them and the
    margin in cells. With `pool` > 1 the roofs are burned `pool` times
    finer and max-pooled, so a thin spire still occludes."""
    xmin, ymin, xmax, ymax = tile.bounds
    res = (xmax - xmin) / px
    margin = int(math.ceil(reach_m / res)) + 1
    bounds = (xmin - margin * res, ymin - margin * res, xmax + margin * res, ymax + margin * res)
    sources = roofs.sources
    ground = dgm_field(tile, Field(bounds, res), sources)
    fine = Field(bounds, res / pool)
    roof = roofs.burn(fine)
    if pool > 1:
        n = roof.shape[0] // pool
        roof = np.fmax.reduce(
            np.fmax.reduce(roof.reshape(n, pool, n, pool), axis=3), axis=1
        ).astype(np.float32)
    fill = edge_mean(ground, margin)
    ground = np.where(np.isfinite(ground), ground, fill).astype(np.float32)
    surface = np.fmax(ground, roof)
    return ground, surface, margin


# --- the horizon ------------------------------------------------------------


def ray_offsets(az_deg: float, near_cells: float, far_cells: float) -> list[tuple[int, int, float]]:
    """The distinct cell offsets (drow, dcol) along an azimuth between two
    distances (cells), one per cell step, with their true length (cells)."""
    a = math.radians(az_deg)
    east, north = math.sin(a), math.cos(a)
    seen, out = set(), []
    t = max(1.0, near_cells)
    while t <= far_cells + 1e-9:
        dr, dc = -int(round(t * north)), int(round(t * east))
        if (dr, dc) not in seen and (dr, dc) != (0, 0):
            seen.add((dr, dc))
            length = math.hypot(dr, dc)
            if near_cells - 0.5 <= length <= far_cells + 0.5:
                out.append((dr, dc, length))
        t += 1.0
    return out


def horizon_tan(
    ground: np.ndarray,
    surface: np.ndarray,
    margin: int,
    res: float,
    az_deg: float,
    near_m: float,
    far_m: float,
) -> np.ndarray:
    """tan of the horizon angle (≥ 0) seen from the ground of the inner
    (unmargined) cells towards one azimuth, over occluders near_m–far_m away."""
    n_r, n_c = ground.shape[0] - 2 * margin, ground.shape[1] - 2 * margin
    obs = ground[margin : margin + n_r, margin : margin + n_c]
    best = np.zeros((n_r, n_c), np.float32)
    for dr, dc, length in ray_offsets(az_deg, near_m / res, min(far_m / res, margin)):
        occ = surface[margin + dr : margin + dr + n_r, margin + dc : margin + dc + n_c]
        np.maximum(best, (occ - obs) / np.float32(length * res), out=best)
    return best


def sky_view(ground, surface, margin, res, reach_m=SVF_REACH_M, count=AZIMUTHS) -> np.ndarray:
    """1 − mean over the azimuths of sin² h (h the horizon within reach)."""
    acc = None
    for az in azimuths(count):
        t = horizon_tan(ground, surface, margin, res, az, res, reach_m)
        sin2 = t * t / (1.0 + t * t)
        acc = sin2 if acc is None else acc + sin2
    return 1.0 - acc / count


def band_horizon(
    ground, surface, margin, res, near_m, far_m, max_deg, count=AZIMUTHS
) -> np.ndarray:
    """The horizon angle (degrees, 0–max_deg) per azimuth of the occluders
    near_m–far_m away: (count, rows, cols)."""
    return np.stack(
        [
            np.degrees(np.arctan(horizon_tan(ground, surface, margin, res, az, near_m, far_m)))
            for az in azimuths(count)
        ]
    ).clip(0.0, max_deg)


def far_horizon(
    ground, surface, margin, res, near_m=HORIZON_NEAR_M, far_m=HORIZON_FAR_M, count=AZIMUTHS
) -> np.ndarray:
    """The far band: occluders 80–1 500 m away, 0–45°."""
    return band_horizon(ground, surface, margin, res, near_m, far_m, HORIZON_MAX_DEG, count)


def near_horizon(
    ground, surface, margin, res, near_m=NEAR_BAND_M, far_m=HORIZON_NEAR_M, count=AZIMUTHS
) -> np.ndarray:
    """The near band: occluders 8–80 m away, 0–90° — what the shadow map
    holds inside its frustum and nothing holds beyond it."""
    return band_horizon(ground, surface, margin, res, near_m, far_m, NEAR_MAX_DEG, count)


def footprint(ground, surface, margin, min_height=FOOTPRINT_MIN_M) -> np.ndarray:
    """The inner cells under a roof (the occluder stands above the ground)."""
    inner = (slice(margin, ground.shape[0] - margin), slice(margin, ground.shape[1] - margin))
    return (surface[inner] - ground[inner]) > min_height


def fill_footprints(values: np.ndarray, under: np.ndarray) -> np.ndarray:
    """Each footprint cell takes the nearest open cell's value (over the last
    two axes, every leading plane alike): the ground under a roof is never
    seen, but LINEAR filtering and mipmaps would pull its dark value out
    onto the street beside it."""
    if not under.any() or under.all():
        return values
    _, (rows, cols) = distance_transform_edt(under, return_indices=True)
    return values[..., rows, cols]


def pack_horizon(angles: np.ndarray, max_deg: float = HORIZON_MAX_DEG) -> np.ndarray:
    """(16, n, n) degrees → the greyscale PNG layout: four RGBA planes
    stacked north-to-south, channels interleaved (4n rows × 4n columns)."""
    count, n, _ = angles.shape
    q = np.round(angles / max_deg * 255.0).clip(0, 255).astype(np.uint8)
    planes = q.reshape(count // 4, 4, n, n).transpose(0, 2, 3, 1)  # plane, row, col, channel
    return planes.reshape(count // 4 * n, n * 4)


def pack_bands(far: np.ndarray, near: np.ndarray) -> np.ndarray:
    """Both bands in one PNG: the far band's four planes, then the near
    band's (8n rows × 4n columns)."""
    return np.concatenate([pack_horizon(far, HORIZON_MAX_DEG), pack_horizon(near, NEAR_MAX_DEG)])


def legend(count: int = AZIMUTHS) -> dict:
    return {
        "azimuthsDeg": [float(a) for a in azimuths(count)],
        "layout": "plane p (stacked north-to-south), channel c = azimuth 4 (p mod 4) + c; "
        "planes 0-3 the far band, 4-7 the near band",
        "px": HORIZON_PX,
        "bands": [
            {
                "name": "far",
                "planes": [0, 4],
                "nearM": HORIZON_NEAR_M,
                "farM": HORIZON_FAR_M,
                "degPerUnit": HORIZON_MAX_DEG / 255.0,
            },
            {
                "name": "near",
                "planes": [4, 8],
                "nearM": NEAR_BAND_M,
                "farM": HORIZON_NEAR_M,
                "degPerUnit": NEAR_MAX_DEG / 255.0,
            },
        ],
        "footprints": "cells under a roof carry the nearest open cell's angles",
        "observer": "DGM1 ground; occluders DGM1 + LoD2 surfaces (no trees)",
    }


def save_png(path: Path, grey: np.ndarray) -> None:
    Image.fromarray(grey, mode="L").save(path, optimize=True)


def run(tile: Tile) -> None:
    t0 = time.perf_counter()
    if not tile.dgm.exists():
        print(f"{tile.id}: no DGM at {tile.dgm} — skipping the sky view")
        return
    roofs = Roofs(tile, site_sources(tile))
    xmin, _, xmax, _ = tile.bounds

    res = (xmax - xmin) / SVF_PX
    ground, surface, margin = fields(tile, SVF_PX, SVF_REACH_M, roofs)
    under = footprint(ground, surface, margin)
    svf = fill_footprints(sky_view(ground, surface, margin, res), under)
    svf_png = tile.out("dlm", f"svf_{tile.id}.png")
    save_png(svf_png, np.round(svf * 255.0).clip(0, 255).astype(np.uint8))
    t1 = time.perf_counter()

    res = (xmax - xmin) / HORIZON_PX
    ground, surface, margin = fields(tile, HORIZON_PX, HORIZON_FAR_M, roofs, pool=4)
    covered = footprint(ground, surface, margin)
    far = fill_footprints(far_horizon(ground, surface, margin, res), covered)
    near = fill_footprints(near_horizon(ground, surface, margin, res), covered)
    png = tile.out("dlm", f"horizon_{tile.id}.png")
    save_png(png, pack_bands(far, near))
    tile.out("dlm", f"horizon_{tile.id}.json").write_text(json.dumps(legend(), indent=2) + "\n")
    t2 = time.perf_counter()
    print(
        f"{tile.id}: sky view mean {svf.mean():.3f} (min {svf.min():.2f}; "
        f"{under.mean() * 100:.1f} % under roofs, filled), "
        f"{svf_png.stat().st_size / 1e6:.2f} MB in {t1 - t0:.1f} s; "
        f"horizon far mean {far.mean():.2f}° (max {far.max():.1f}°), "
        f"near mean {near.mean():.2f}° (max {near.max():.1f}°), "
        f"{png.stat().st_size / 1e6:.2f} MB in {t2 - t1:.1f} s"
    )
