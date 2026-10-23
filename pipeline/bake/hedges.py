"""What the hedge bakes share: OSM's hedge lines, a hedge's height read
off the surface model (DOM1) where no laser scan measures it, and the
checks a hedge the scan finds on its own must pass to be drawn.

- **OSM's hedges** (`osm_hedge_lines`): `barrier=hedge` ways, and the rings
  of a closed one (GDAL's OSM driver routes a garden's ring into
  `multipolygons`). lowveg.py draws them; landcover.py leaves out a
  Basis-DLM hedge within ROW_SNAP_M of one, so a hedge both map is drawn
  once (Dresden: 0.43 of its 4.48 km of DLM hedge).
- **Height from DOM1** (`dom_height`): along the line, every half metre,
  the highest nDOM (DOM1 − DGM) within DOM_REACH_M, samples over TALL_M
  skipped (a tree in or over the hedge), the median of the rest — where
  at least DOM_SEEN of the line has a sample. Hamburg's 92 OSM hedges all
  took the 1.5 m default; DOM1 reads them 1.7 m at the median. Under
  ABSENT_M the hedge is not there (grubbed, or mapped where a fence
  stands): dropped.
- **The scan's own hedges** (`scan_hedge_ok`): ~30 % of all the scan's
  hedge pieces are crown rims (docs/transformations.md, "Low
  vegetation"), so only a piece SCAN_MIN_M long, SCAN_ELONG times as long
  as wide, its axis SCAN_CLEAR_M clear of crown texels over TALL_M along
  most of it, and green where the tile has an NDVI raster.
"""

from __future__ import annotations

import numpy as np
import rasterio
import shapely
from rasterio.enums import Resampling
from rasterio.warp import reproject
from scipy import ndimage as ndi

from .common import Tile, column
from .osm import read_osm

ROW_SNAP_M = 2.0  # a DLM hedge this close to an OSM hedge is that hedge
DOM_REACH_M = 1.0  # the nDOM's maximum this far round each sample
DOM_STEP_M = 0.5
TALL_M = 3.0  # a sample this high is a tree, not the hedge
DOM_SEEN = 0.3  # share of the line that needs a sample
ABSENT_M = 0.4  # a hedge DOM1 reads lower than this is not there
HEDGE_H = (0.5, 3.0)  # a measured hedge's height, clamped (m)
SCAN_MIN_M = 6.0  # a scan hedge this long at least …
SCAN_ELONG = 4.0  # … this many times as long as it is wide …
SCAN_CLEAR_M = 1.5  # … its axis this far from a crown texel …
SCAN_CLEAR_SHARE = 0.8  # … along this share of it …
SCAN_NDVI = 0.12  # … and its median NDVI (the committed 0..1 scale) at least this


def osm_hedge_lines(
    tile: Tile, margin: float = 0.0005
) -> list[tuple[str | None, shapely.Geometry]]:
    """(other_tags, line) of every OSM hedge near the tile."""
    lines, fields = read_osm(tile, "lines", "barrier = 'hedge'", ["other_tags"], margin=margin)
    hedges = [(t, g) for t, g in zip(column(fields, "other_tags", lines), lines, strict=True) if g]
    rings, fields = read_osm(
        tile, "multipolygons", "barrier = 'hedge'", ["other_tags"], margin=margin
    )
    for t, g in zip(column(fields, "other_tags", rings), rings, strict=True):
        hedges += [(t, ring) for ring in hedge_rings(g)]
    return hedges


def hedge_rings(geom: shapely.Geometry | None) -> list[shapely.LineString]:
    """A hedge mapped as a closed way, as the lines it is: every ring of the
    polygon GDAL built from it (a hedge around a garden has no inside)."""
    out: list[shapely.LineString] = []
    if geom is None:
        return out
    for part in shapely.get_parts(geom):
        if isinstance(part, shapely.Polygon) and not part.is_empty:
            out += [shapely.LineString(part.exterior.coords)]
            out += [shapely.LineString(r.coords) for r in part.interiors]
    return out


def without_mapped(
    rows: list[dict], hedges: list[shapely.Geometry], reach: float = ROW_SNAP_M
) -> tuple[list[dict], float]:
    """The veg rows less their hedges' stretches within `reach` of a mapped
    hedge (pieces under 2 m dropped), and the metres taken out."""
    if not hedges:
        return rows, 0.0
    near = shapely.union_all([shapely.buffer(h, reach) for h in hedges])
    out, removed = [], 0.0
    for f in rows:
        if f["properties"].get("kind") != "hedge":
            out.append(f)
            continue
        line = shapely.geometry.shape(f["geometry"])
        if not line.intersects(near):
            out.append(f)
            continue
        rest = line.difference(near)
        removed += line.length - rest.length
        for part in shapely.get_parts(rest):
            if isinstance(part, shapely.LineString) and part.length >= 2.0:
                coords = [[round(x, 2), round(y, 2)] for x, y, *_ in part.coords]
                geom = {"type": "LineString", "coordinates": coords}
                out.append({**f, "geometry": geom})
            else:
                removed += part.length
    return out, removed


class DomHeights:
    """The tile's nDOM (DOM1 − DGM, 1 m) and the samplers along a line."""

    def __init__(self, ndom: np.ndarray, bounds: tuple[float, float, float, float]) -> None:
        self.bounds = bounds
        self.n = ndom.shape[0]
        self.res = (bounds[2] - bounds[0]) / self.n
        k = int(round(DOM_REACH_M / self.res))
        y, x = np.mgrid[-k : k + 1, -k : k + 1]
        self.top = ndi.maximum_filter(np.nan_to_num(ndom, nan=0.0), footprint=np.hypot(x, y) <= k)

    @classmethod
    def read(cls, tile: Tile) -> DomHeights | None:
        """From the raw DOM1 and the committed DGM; None without DOM1."""
        path = tile.raw_raster("dom1")
        if not path.exists() or not tile.dgm.exists():
            return None
        with rasterio.open(tile.dgm) as ds:
            dgm = ds.read(1).astype(np.float32)
            if ds.nodata is not None:
                dgm[dgm == ds.nodata] = np.nan
            transform, shape = ds.transform, ds.shape
        dom = np.full(shape, np.nan, np.float32)
        with rasterio.open(path) as ds:
            reproject(
                ds.read(1).astype(np.float32),
                dom,
                src_transform=ds.transform,
                src_crs=ds.crs or f"EPSG:{tile.epsg}",
                dst_transform=transform,
                dst_crs=f"EPSG:{tile.epsg}",
                resampling=Resampling.bilinear,
                src_nodata=ds.nodata,
                dst_nodata=np.nan,
            )
        return cls(dom - dgm, tile.bounds)

    def samples(self, line: shapely.LineString) -> np.ndarray:
        """The local nDOM maximum every DOM_STEP_M along the line (NaN off
        the tile)."""
        d = np.arange(0, line.length + 1e-6, DOM_STEP_M)
        pts = shapely.line_interpolate_point(line, d)
        xy = shapely.get_coordinates(pts)
        c = ((xy[:, 0] - self.bounds[0]) / self.res).astype(int)
        r = ((self.bounds[3] - xy[:, 1]) / self.res).astype(int)
        ok = (r >= 0) & (r < self.n) & (c >= 0) & (c < self.n)
        out = np.full(len(xy), np.nan)
        out[ok] = self.top[r[ok], c[ok]]
        return out


def dom_height(line: shapely.LineString, dom: DomHeights) -> float | None:
    """A hedge's height read off DOM1 (see the module doc): the median of
    the samples under TALL_M, or None where under DOM_SEEN of the line has
    one. A value under ABSENT_M means no hedge stands there."""
    s = dom.samples(line)
    low = s[np.isfinite(s) & (s <= TALL_M)]
    if len(s) == 0 or len(low) < DOM_SEEN * len(s):
        return None
    return float(np.median(low))


def scan_hedge_ok(
    line: shapely.LineString,
    width: float,
    crown_clear: DomHeights,
    ndvi_along: np.ndarray | None,
) -> bool:
    """Whether a hedge the laser scan finds on its own is drawn (module
    doc). `crown_clear` holds, per texel, the distance (m) to the nearest
    crown texel over TALL_M in its `top`; `ndvi_along` the NDVI samples
    along the line, or None without a raster."""
    if line.length < SCAN_MIN_M or line.length < SCAN_ELONG * max(width, 0.5):
        return False
    clear = crown_clear.samples(line)
    clear = clear[np.isfinite(clear)]
    if len(clear) == 0 or (clear >= SCAN_CLEAR_M).mean() < SCAN_CLEAR_SHARE:
        return False
    return ndvi_along is None or len(ndvi_along) == 0 or np.median(ndvi_along) >= SCAN_NDVI


def crown_clearance(ndom: np.ndarray, bounds: tuple[float, float, float, float]) -> DomHeights:
    """A sampler of the distance (m) to the nearest crown texel (nDOM over
    TALL_M) — `DomHeights` over it, with no maximum taken round a sample."""
    res = (bounds[2] - bounds[0]) / ndom.shape[0]
    dist = ndi.distance_transform_edt(~(np.nan_to_num(ndom) > TALL_M)) * res
    out = DomHeights.__new__(DomHeights)
    out.bounds, out.n, out.res, out.top = bounds, ndom.shape[0], res, dist
    return out
