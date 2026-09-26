"""Small structures the laser scan saw and LoD2 does not carry — garden
houses, sheds, container buildings, carports, pavilions — as simple boxes
the build appends to the city mesh (plan 034).

The scan's 0.5 m rasters (lsc.py, made on first use by lowveg.lsc_rasters)
give the surface (`dsm` max), the ground (`dtm` idw) and, per cell, how many
non-ground returns were part of a multi-echo pulse. In the leaf-off flight
(27–30 Nov 2024) vegetation splits pulses and roofs do not, so:

1. candidates: 2.0 m < nDSM < 6.5 m, outside the LoD2 (every surface
   projected, grown 1 m), not on rail, road or water (classes 5/7/8);
2. the core: candidate cells with no multi-echo return in their 3 × 3
   window. The plan's rule on the whole blob ("multi-echo ≈ 0") found 4–43
   blobs on the spawn tile: a roof's edge splits the pulse too, so the
   blob-wide ratio of a shed is not 0. The per-cell rule keeps the roof
   and drops its rim, and a shrub cannot hide inside it;
3. each core blob ≥ 4 m² grows back one cell (the rim the window ate) within
   the candidates; kept at 6–150 m² when its top is a plane (residual
   std < 0.35 m, tilt ≤ 35°), it fills its minimum rotated rectangle
   (> 0.6), that rectangle is ≥ 2 m wide, the DOP's NDVI over it stays
   ≤ 0.25 (a clipped evergreen hedge is flat and single-echo too) and it is
   no sliver along the LoD2 (aspect ≥ 3 with ≥ 20 % of its rim on the mask:
   a roof edge or a misfit footprint);
4. not what the scan saw only that day or what another layer draws: blobs
   inside OSM pedestrian areas and squares (the Christmas markets were up —
   the Striezelmarkt opened on 27 Nov 2024, the Altmarkt alone held 101
   blobs) and within 6 m of a pedestrian street's line, marketplaces,
   construction sites and surface car parks; on a mapped wall or bridge;
   within 3 m of a monument or a stop shelter;
   vehicle-sized (2.0–2.8 m wide, 4.5–18 m long, under 4.2 m) unless an
   OSM building outline confirms a structure; touching the tile's edge.

Each is written as its rectangle with `z` (the lowest ground under it),
`h` (the top above `z`, the median of the fitted plane) and, where the top
tilts more than 8°, `hc`: the height above `z` at each of the ring's four
corners (a pent roof). Measurement and the gate: docs/plans/034-dom-minus-lod2.md.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely
from scipy import ndimage as ndi
from shapely.geometry import shape

from .common import Tile, column, feature, geometry_json, write_geojson
from .lowveg import Grid, building_mask, dgm_on, disk, lsc_rasters, read_band
from .osm import has_extract, read_osm, tag

GEOSN_ATTRIBUTION = "Quelle: GeoSN, dl-de/by-2-0 (laser scan, LoD2)"
RES = 0.5
BAND = (2.0, 6.5)  # height above ground (m)
BLOCKED = (5, 7, 8)  # railway, road, water: parked vans, trains, boats
BLD_BUF_PX = 2  # the LoD2 mask grown 1 m (DSM-max binning smears eaves)
CORE_MIN_M2 = 4.0
AREA_M2 = (6.0, 150.0)
PLANE_STD = 0.35  # m, the top's residual about its plane
MAX_TILT = 35.0  # degrees
PENT_TILT = 8.0  # degrees: steeper is a pent roof
COMPACT = 0.6  # area / minimum rotated rectangle
GREEN = 0.25  # median NDVI above this: a clipped evergreen hedge, not a roof
MIN_WIDTH = 2.0  # m
# A long strip along a LoD2 outline is its roof edge or a misfit, not a shed.
SLIVER = {"aspect": 3.0, "share": 0.2}
VEHICLE = {"width": (2.0, 2.8), "length": (4.5, 18.0), "h": 4.2}
PEDESTRIAN_STREET_M = 6.0  # half-width around a pedestrian street's line
NEAR_M = 3.0  # a monument or stop shelter this close draws the structure already
WALL_BUF_M = 0.75


@dataclass
class Rasters:
    """The tile's 0.5 m inputs, row 0 = north."""

    dsm: np.ndarray  # surface max (absolute m), NaN where no return
    dtm: np.ndarray  # ground (absolute m), filled
    multiecho: np.ndarray  # multi-echo non-ground returns per cell
    cls: np.ndarray  # land-cover class ids
    ndvi: np.ndarray  # the DOP's greenness, 0–1 (zeros without it)
    masked: np.ndarray  # LoD2 (already grown), walls, bridges: never a candidate


@dataclass
class Structure:
    ring: list[tuple[float, float]]  # the rectangle, 4 corners (+ closing)
    z: float
    h: float
    corners: list[float] | None  # heights above z at the 4 corners (pent roof)


def core_blobs(r: Rasters) -> tuple[np.ndarray, np.ndarray]:
    """(labels of the grown blobs, candidate mask)."""
    ndsm = np.where(np.isnan(r.dsm), 0.0, r.dsm - r.dtm)
    cand = (ndsm > BAND[0]) & (ndsm < BAND[1]) & ~r.masked & ~np.isin(r.cls, BLOCKED)
    core = cand & (ndi.maximum_filter(r.multiecho, size=3) == 0)
    lab, _ = ndi.label(core)
    sizes = np.bincount(lab.ravel())
    small = sizes * RES * RES < CORE_MIN_M2
    small[0] = False
    lab[small[lab]] = 0
    # the rim the echo window ate: one cell back, within the candidates
    grown = ndi.grey_dilation(lab, footprint=disk(1))
    lab = np.where((lab == 0) & cand, grown, lab)
    return lab, cand


def fit_plane(xs: np.ndarray, ys: np.ndarray, zs: np.ndarray):
    """z = a + b·(x − x̄) + c·(y − ȳ): (a, b, c, x̄, ȳ, residual std)."""
    mx, my = xs.mean(), ys.mean()
    a = np.c_[np.ones_like(xs), xs - mx, ys - my]
    coef, *_ = np.linalg.lstsq(a, zs, rcond=None)
    resid = zs - a @ coef
    return coef[0], coef[1], coef[2], mx, my, float(resid.std())


def edge_share(masked: np.ndarray, sl, m: np.ndarray) -> float:
    """The share of the cells just outside a blob that are masked (LoD2)."""
    rows, cols = masked.shape
    r0, r1 = max(sl[0].start - 1, 0), min(sl[0].stop + 1, rows)
    c0, c1 = max(sl[1].start - 1, 0), min(sl[1].stop + 1, cols)
    blob = np.zeros((r1 - r0, c1 - c0), bool)
    blob[sl[0].start - r0 : sl[0].stop - r0, sl[1].start - c0 : sl[1].stop - c0] = m
    ring = ndi.binary_dilation(blob) & ~blob
    return float((ring & masked[r0:r1, c0:c1]).sum()) / max(int(ring.sum()), 1)


def measure(r: Rasters, grid: Grid, lab: np.ndarray, sl, i: int) -> Structure | None:
    """One blob → a structure, or None when it fails the shape rules."""
    m = lab[sl] == i
    area = float(m.sum()) * RES * RES
    if not AREA_M2[0] <= area <= AREA_M2[1]:
        return None
    if sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == grid.n or sl[1].stop == grid.n:
        return None  # cut by the tile's edge: the neighbour's scan is not read
    rr, cc = np.nonzero(m)
    xs = grid.xmin + (cc + sl[1].start + 0.5) * RES
    ys = grid.ymax - (rr + sl[0].start + 0.5) * RES
    top = r.dsm[sl][m]
    ok = ~np.isnan(top)
    if ok.sum() < 8 or float(np.median(r.ndvi[sl][m])) > GREEN:
        return None
    a, b, c, mx, my, std = fit_plane(xs[ok], ys[ok], top[ok])
    tilt = math.degrees(math.atan(math.hypot(b, c)))
    if std >= PLANE_STD or tilt > MAX_TILT:
        return None
    rect = shapely.MultiPoint(np.c_[xs, ys]).buffer(RES / 2, cap_style="square")
    rect = rect.minimum_rotated_rectangle
    if area / rect.area <= COMPACT:
        return None
    ring = [(float(x), float(y)) for x, y in rect.exterior.coords]
    sides = sorted(math.dist(ring[k], ring[k + 1]) for k in range(2))
    if sides[0] < MIN_WIDTH:
        return None
    if sides[1] / sides[0] >= SLIVER["aspect"] and edge_share(r.masked, sl, m) >= SLIVER["share"]:
        return None
    z = float(np.nanmin(r.dtm[sl][m]))
    plane = lambda x, y: a + b * (x - mx) + c * (y - my)  # noqa: E731
    h = float(np.median(plane(xs, ys))) - z
    corners = None
    if tilt > PENT_TILT:
        corners = [round(max(plane(x, y) - z, BAND[0] * 0.9), 2) for x, y in ring[:4]]
    return Structure(ring, round(z, 2), round(h, 2), corners)


def find_structures(r: Rasters, grid: Grid) -> list[Structure]:
    """Every structure the rasters show, before the OSM context."""
    lab, _ = core_blobs(r)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is not None and (s := measure(r, grid, lab, sl, i)) is not None:
            out.append(s)
    return out


def is_vehicle_sized(s: Structure) -> bool:
    w, length = sorted(math.dist(s.ring[k], s.ring[k + 1]) for k in range(2))
    return (
        VEHICLE["width"][0] <= w <= VEHICLE["width"][1]
        and VEHICLE["length"][0] <= length <= VEHICLE["length"][1]
        and s.h < VEHICLE["h"]
    )


# --- the context ----------------------------------------------------------------


def is_excluded_area(amenity, landuse, place, other_tags) -> bool:
    """A pedestrian area or square (the markets), a marketplace, a building
    site, or a surface car park (a carport or a garage court stays)."""
    if amenity == "parking":
        return tag(other_tags, "parking") in (None, "surface")
    return (
        amenity == "marketplace"
        or landuse == "construction"
        or place == "square"
        or "pedestrian" in (tag(other_tags, "highway"), tag(other_tags, "area:highway"))
    )


def osm_context(tile: Tile) -> tuple[shapely.Geometry | None, shapely.Geometry | None]:
    """(the areas nothing is taken from, the OSM building outlines)."""
    if tile.osm_extract() is None:
        return None, None
    where = (
        "amenity IN ('marketplace','parking') OR landuse = 'construction' "
        "OR place = 'square' OR other_tags LIKE '%\"highway\"=>\"pedestrian\"%' "
        'OR other_tags LIKE \'%"area:highway"=>"pedestrian"%\''
    )
    cols = ["amenity", "landuse", "place", "other_tags"]
    geoms, fields = read_osm(tile, "multipolygons", where, cols, margin=0.0005)
    rows = zip(geoms, *(column(fields, c, geoms) for c in cols), strict=True)
    areas = [g.buffer(0) for g, *tags in rows if is_excluded_area(*tags)]
    # Pedestrian streets mapped as a line only (Schloßstraße, Hauptstraße):
    # the stalls stand along them.
    streets, _ = read_osm(tile, "lines", "highway = 'pedestrian'", ["highway"], margin=0.0005)
    areas += [g.buffer(PEDESTRIAN_STREET_M) for g in streets]
    blds, _ = read_osm(tile, "multipolygons", "building IS NOT NULL", ["building"], margin=0.0005)
    return _union(areas), _union([g.buffer(0) for g in blds])


def _union(geoms: list) -> shapely.Geometry | None:
    if not geoms:
        return None
    union = shapely.union_all(geoms)
    shapely.prepare(union)
    return union


def _features(path: Path) -> list:
    return json.loads(path.read_text())["features"] if path.exists() else []


def layer_mask(tile: Tile, grid: Grid) -> np.ndarray:
    """LoD2 grown 1 m, the mapped walls (not fences) and the bridge decks."""
    dlm = tile.data / "dlm"
    bld = building_mask(grid, tile.data / "cityjson" / f"lod2_{tile.id}.city.json")
    mask = ndi.binary_dilation(bld, structure=disk(BLD_BUF_PX))
    walls = [
        shape(f["geometry"]).buffer(WALL_BUF_M)
        for f in _features(dlm / f"walls_{tile.id}.geojson")
        if f["properties"].get("kind") not in ("fence", "gate")
    ]
    bridges = [shape(f["geometry"]) for f in _features(dlm / f"bridge_{tile.id}.geojson")]
    return mask | grid.burn(walls + bridges)


def drawn_elsewhere(tile: Tile) -> shapely.Geometry | None:
    """Monuments and stop shelters: other layers draw them."""
    dlm = tile.data / "dlm"
    geoms = [shape(f["geometry"]) for f in _features(dlm / f"monuments_{tile.id}.geojson")]
    geoms += [
        shape(f["geometry"])
        for f in _features(dlm / f"furniture_{tile.id}.geojson")
        if f["properties"].get("k") == "shelter"
    ]
    return _union([g.buffer(NEAR_M) for g in geoms])


def load_rasters(tile: Tile, grid: Grid, der: Path) -> Rasters:
    ground = read_band(der / "dtm_050.tif", "idw")
    ground = np.where(np.isnan(ground), dgm_on(grid, tile.dgm, tile.epsg), ground)
    dlm = tile.data / "dlm"
    cls = grid.resample_png(dlm / f"landcover_{tile.id}.png", nearest=True)
    ndvi_png = dlm / f"ndvi_{tile.id}.png"
    ndvi = (
        grid.resample_png(ndvi_png, nearest=False)
        if ndvi_png.exists()
        else np.zeros((grid.n, grid.n), np.float32)
    )
    return Rasters(
        dsm=read_band(der / "dsm_050.tif", "max"),
        dtm=ground,
        multiecho=np.nan_to_num(read_band(der / "nonground_multiecho_count_050.tif", None)),
        cls=cls,
        ndvi=ndvi,
        masked=layer_mask(tile, grid),
    )


def keep(s: Structure, excluded, drawn, buildings) -> bool:
    c = shapely.Polygon(s.ring).centroid
    if excluded is not None and excluded.contains(c):
        return False
    if drawn is not None and drawn.intersects(shapely.Polygon(s.ring)):
        return False
    confirmed = buildings is not None and buildings.contains(c)
    return confirmed or not is_vehicle_sized(s)


def structure_feature(s: Structure) -> dict:
    props: dict = {"z": s.z, "h": s.h}
    if s.corners is not None:
        props["hc"] = s.corners
    return feature(geometry_json(shapely.Polygon(s.ring)), props)


def run(tile: Tile) -> None:
    der = lsc_rasters(tile)
    out = tile.out("dlm", f"smallbuild_{tile.id}.geojson")
    if der is None:
        print(f"{tile.id}: no laser scan under {tile.raw / 'lsc'} — skipping the small structures")
        return
    if not has_extract(tile, "the small structures (the markets and building sites)"):
        return
    grid = Grid(*tile.bounds)
    found = find_structures(load_rasters(tile, grid, der), grid)
    excluded, buildings = osm_context(tile)
    drawn = drawn_elsewhere(tile)
    kept = [s for s in found if keep(s, excluded, drawn, buildings)]
    # Stable order: the committed file diffs by feature, not by label order.
    kept.sort(key=lambda s: (round(s.ring[0][0], 1), round(s.ring[0][1], 1)))
    write_geojson(out, [structure_feature(s) for s in kept], tile.epsg, GEOSN_ATTRIBUTION)
    pent = sum(s.corners is not None for s in kept)
    print(
        f"{tile.id}: {len(kept)} small structures ({pent} pent roofs) "
        f"of {len(found)} found in the scan"
    )
