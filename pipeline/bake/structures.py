"""What stands in the surface model but not in LoD2 — the chimneys, towers
and masts the building model leaves out, and whole buildings it does not
carry yet — measured in DOM1 and confirmed by OpenStreetMap, as shapes the
build appends to the city mesh (lib/city/structures.ts).

Measurement (plan 050): over the tile and a margin, `gap = DOM − max(DGM,
LoD2 roof)`, the height the surface model sees above everything the
building model draws. Tall, slim gaps are common and mostly not buildings —
tree crowns, power pylons, and in a city centre the construction cranes
that stood on the flight day (Leipzig's centre: dozens of 50–95 m spikes
without a mapped structure). So nothing is added from the surface model
alone; OSM names the structure, the surface model measures it:

1. **Columns** — `man_made` chimney, tower, mast, water tower,
   communications tower or lighthouse (point or outline). Kept when the
   gap within a few metres of it is at least `MIN_GAP_M` (else LoD2 already
   draws it). Its foot is the lowest ground there, its axis the gap's peak,
   its height the surface model's (`dom − ground`) — or OSM's `height`
   where the model undershoots a lattice mast by more than a quarter. Its
   radius is the outline's, OSM's `diameter`, or the gap blob's low down
   (the foot), clamped per kind; its taper is the kind's. A tower,
   lighthouse or water tower whose foot is under a LoD2 roof is LoD2's
   own (`BUILT_TOWERS`).
2. **Buildings** — an OSM building outline (≥ `MIN_BUILDING_M2`, not a
   roof, carport, ruin, construction site or underground) that LoD2 barely
   covers (< `MAX_LOD2_SHARE`) and the surface model fills (≥
   `MIN_DOM_SHARE` of its cells ≥ `MIN_BUILDING_H` above ground). Its height
   is the 60th percentile of what the model measured inside it — a flat
   roof at the mass's typical height, not its antenna. The newest buildings
   of a city are the usual case (LoD2 is a year or more behind).

3. **Roof relief** — only for a landmark (`landmarks_<tile>.json`, the
   step before): where the surface model rises above the object's highest
   LoD2 roof, by ≥ `RELIEF_MIN_M` on ≥ `RELIEF_MIN_M2` (and
   `RELIEF_SHARE` of its footprint; the Elbphilharmonie's crests over its
   96 m block, a spire LoD2 cut short), that excess as a height field on
   the 1 m grid, lightly smoothed (`kind: relief`, `of`: the LoD2 object
   it sits on, whose look it wears). Measured against the highest roof, so
   courtyard trees and roof steps a metre off stay out; and not for every
   building — on ordinary roofs the excess is antennas, dormers and trees.
   Its walls reach down to the roof under each cell (`floor`): a tower
   LoD2 folded into its church's pitched roof stands on the slope, not
   hovering at the ridge. Surface-model cells below the LoD2 roof are
   voids (a sound opening, glass), filled from the nearest measured one.

Across a seam: rasters are read over the tile and `MARGIN_M` around it
(the neighbours' DGM, LoD2 and DOM), and a structure is written by the tile
that owns its anchor. A site without a surface model writes an empty file
(the runtime then has no gaps to fill).
"""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
import rasterio.features
import shapely
from rasterio.features import rasterize
from rasterio.warp import Resampling, reproject
from scipy import ndimage as ndi

from .common import OSM_ATTRIBUTION, Tile, feature, geometry_json, overlaps, owns, write_geojson
from .osm import has_extract, read_osm, tag
from .osm_buildings import footprints
from .skyview import Field, Roofs, dgm_field

MARGIN_M = 60.0
RES_M = 1.0
# A column LoD2 already draws leaves a smaller gap than this (m).
MIN_GAP_M = 5.0
# How far around a mapped point its structure is looked for (m).
SEARCH_M = 6.0
MIN_COLUMN_H = 8.0

# kind → (min radius, max radius, top radius / base radius)
COLUMN_KINDS: dict[str, tuple[float, float, float]] = {
    "chimney": (0.8, 6.0, 0.6),
    "tower": (1.5, 12.0, 0.9),
    "mast": (0.3, 2.5, 0.35),
    "communications_tower": (1.0, 12.0, 0.45),
    "water_tower": (2.0, 12.0, 1.0),
    "lighthouse": (1.5, 8.0, 0.7),
}

# Towers that are buildings: where LoD2 has a roof over the mapped foot, it
# draws the tower itself (a church's, a castle's), and a lathed column
# inside it only doubled it — Meißen's cathedral towers, Grimma's churches.
# A mast or chimney on a roof is not in LoD2 and stays.
BUILT_TOWERS = {"tower", "lighthouse", "water_tower"}

MIN_BUILDING_M2 = 40.0
MAX_LOD2_SHARE = 0.2
MIN_DOM_SHARE = 0.6
MIN_BUILDING_H = 2.5
# A landmark's roof relief: the excess over its LoD2 roof that counts, the
# share of its footprint it must cover, and the slabs it is drawn with.
RELIEF_MIN_M = 3.0
RELIEF_SHARE = 0.02
RELIEF_MIN_M2 = 60.0
RELIEF_MIN_PART_M2 = 6.0
# How many of a tile's landmarks (the most notable) get a roof relief.
RELIEF_LANDMARKS = 12
# How far a relief's heights are smoothed (cells, Gaussian sigma).
RELIEF_SMOOTH = 1.0
# A surface-model cell this far below the LoD2 roof under it is a void.
VOID_M = 1.0
# How far a relief's walls sink into the roof they stand on (m).
FLOOR_SINK_M = 0.3

NOT_BUILDINGS = {
    "roof",
    "carport",
    "construction",
    "ruins",
    "collapsed",
    "no",
    "proposed",
    "demolished",
    "bridge",
}


def dom_field(tile: Tile, field: Field) -> np.ndarray:
    """The surface model on the field from every tile of the site that has
    one (NaN where none reaches). `max` resampling keeps a 1 m spike."""
    out = np.full(field.shape, np.nan, np.float32)
    bounds = (field.xmin, field.ymin, field.xmax, field.ymax)
    for tid, b in tile.neighbours():
        path = tile.raw / "dom1" / f"{tid}.tif"
        if not path.exists() or not overlaps(b, bounds):
            continue
        part = np.full(field.shape, np.nan, np.float32)
        with rasterio.open(path) as ds:
            reproject(
                rasterio.band(ds, 1),
                part,
                dst_transform=field.transform,
                dst_crs=ds.crs,
                resampling=Resampling.max,
                src_nodata=ds.nodata,
                dst_nodata=np.nan,
            )
        out = np.fmax(out, part)
    return out


class Surfaces:
    """The three height fields over the tile and its margin."""

    def __init__(self, tile: Tile):
        xmin, ymin, xmax, ymax = tile.bounds
        m = MARGIN_M
        self.field = Field((xmin - m, ymin - m, xmax + m, ymax + m), RES_M)
        sources = tile.neighbours()
        self.ground = dgm_field(tile, self.field, sources)
        self.roof = Roofs(tile, sources).burn(self.field)
        self.dom = dom_field(tile, self.field)
        self.above = self.dom - self.ground
        self.gap = self.dom - np.fmax(self.ground, self.roof)

    def window(self, geom: shapely.Geometry, pad: float) -> tuple[slice, slice] | None:
        f = self.field
        x0, y0, x1, y1 = geom.buffer(pad).bounds
        c0 = max(int((x0 - f.xmin) / f.res), 0)
        c1 = min(int(math.ceil((x1 - f.xmin) / f.res)), f.cols)
        r0 = max(int((f.ymax - y1) / f.res), 0)
        r1 = min(int(math.ceil((f.ymax - y0) / f.res)), f.rows)
        if c1 <= c0 or r1 <= r0:
            return None
        return slice(r0, r1), slice(c0, c1)

    def under_roof(self, p: shapely.Point) -> bool:
        """Whether a LoD2 roof covers the point."""
        f = self.field
        col = int((p.x - f.xmin) / f.res)
        row = int((f.ymax - p.y) / f.res)
        if not (0 <= row < f.rows and 0 <= col < f.cols):
            return False
        return bool(np.isfinite(self.roof[row, col]))

    def cell_xy(self, row: int, col: int) -> tuple[float, float]:
        f = self.field
        return f.xmin + (col + 0.5) * f.res, f.ymax - (row + 0.5) * f.res

    def mask(self, geom: shapely.Geometry, win: tuple[slice, slice]) -> np.ndarray:
        rows, cols = win
        f = self.field
        transform = rasterio.transform.from_origin(
            f.xmin + cols.start * f.res, f.ymax - rows.start * f.res, f.res, f.res
        )
        shape = (rows.stop - rows.start, cols.stop - cols.start)
        return rasterize([(geom, 1)], out_shape=shape, transform=transform, dtype=np.uint8).astype(
            bool
        )


def height_tag(value: str | None) -> float | None:
    """OSM `height` / `diameter` in metres ("52", "52 m", "52.5m"), or None."""
    if not value:
        return None
    try:
        return float(value.replace("m", "").strip().split(";")[0])
    except ValueError:
        return None


def column(s: Surfaces, geom: shapely.Geometry, kind: str, other_tags: str | None) -> dict | None:
    """One mapped column measured in the surface model, or None when LoD2
    draws it already or the model does not see it."""
    lo, hi, taper = COLUMN_KINDS[kind]
    pad = SEARCH_M if geom.geom_type == "Point" else 2.0
    win = s.window(geom, pad)
    if win is None:
        return None
    gap = s.gap[win]
    if not np.isfinite(gap).any() or np.nanmax(gap) < MIN_GAP_M:
        return None
    above = s.above[win]
    peak = np.unravel_index(np.nanargmax(np.where(np.isfinite(gap), above, -np.inf)), gap.shape)
    h_dom = float(above[peak])
    h_osm = height_tag(tag(other_tags, "height"))
    h = h_osm if h_osm and h_dom < 0.75 * h_osm else h_dom
    if not math.isfinite(h) or h < MIN_COLUMN_H:
        return None
    if geom.geom_type == "Point":
        x, y = s.cell_xy(peak[0] + win[0].start, peak[1] + win[1].start)
        diameter = height_tag(tag(other_tags, "diameter"))
        if diameter:
            r = diameter / 2
        else:
            # the gap's blob around the peak, low down (the foot is widest;
            # the gap leaves out the LoD2 building a chimney stands beside)
            low = np.nan_to_num(gap, nan=0) >= max(MIN_GAP_M, 0.2 * h_dom)
            blob, _ = ndi.label(low)
            r = math.sqrt(float((blob == blob[peak]).sum()) * s.field.res**2 / math.pi)
    else:
        c = geom.centroid
        x, y = c.x, c.y
        r = math.sqrt(geom.area / math.pi)
    ground = s.ground[win]
    z = float(np.nanmin(ground)) if np.isfinite(ground).any() else float("nan")
    if not math.isfinite(z):
        return None
    # a 1 m surface model sees a slim shaft thinner than it is: a chimney's
    # foot is about a twelfth of its height across, a floor under the
    # measurement (the Lindenbrauerei's 48 m shaft measured 1.7 m)
    if kind == "chimney":
        r = max(r, h / 24)
    r = min(max(r, lo), hi)
    props = {"kind": kind, "z": round(z, 2), "h": round(h, 1), "r": round(r, 2)}
    props["rt"] = round(r * taper, 2)
    name = tag(other_tags, "name")
    if name:
        props["name"] = name
    return feature({"type": "Point", "coordinates": [round(x, 2), round(y, 2)]}, props)


def building(s: Surfaces, geom: shapely.Geometry, name: str | None) -> dict | None:
    """One OSM building LoD2 lacks and the surface model confirms, or None."""
    if geom.area < MIN_BUILDING_M2:
        return None
    win = s.window(geom, 1.0)
    if win is None:
        return None
    inside = s.mask(geom, win)
    if inside.sum() < MIN_BUILDING_M2 / s.field.res**2 * 0.8:
        return None
    lod2 = np.isfinite(s.roof[win])[inside].mean()
    if lod2 >= MAX_LOD2_SHARE:
        return None
    above = s.above[win][inside]
    tall = above[np.isfinite(above) & (above >= MIN_BUILDING_H)]
    if len(tall) < MIN_DOM_SHARE * inside.sum():
        return None
    ground = s.ground[win][inside]
    if not np.isfinite(ground).any():
        return None
    h = float(np.percentile(tall, 60))
    props = {"kind": "building", "z": round(float(np.nanmin(ground)), 2), "h": round(h, 1)}
    if name:
        props["name"] = name
    return feature(geometry_json(geom.simplify(0.3)), props)


def relief(s: Surfaces, geom: shapely.Geometry, of: str) -> list[dict]:
    """A landmark's measured form above its LoD2 top, as a height field:
    one feature per connected patch, its outline and a 1 m grid of the
    surface model's heights above the object's highest roof (lightly
    smoothed; -1 outside the patch). Measured against the highest roof, not
    cell by cell: a tree in a courtyard or a roof step a metre off stays
    below it. Empty when LoD2 draws the top well enough."""
    win = s.window(geom, 0.0)
    if win is None:
        return []
    inside = s.mask(geom, win)
    roof = s.roof[win]
    if not np.isfinite(roof[inside]).any():
        return []
    top = float(np.nanpercentile(roof[inside], 98))
    # what each cell stands on: its own LoD2 roof, else the ground
    ground = s.ground[win]
    floor = np.where(np.isfinite(roof), np.fmax(roof, ground), ground)
    dom = np.where(inside, fill_voids(s.dom[win], inside & (s.dom[win] < floor - VOID_M)), np.nan)
    excess = np.nan_to_num(dom - top, nan=-1e9)
    over = excess >= RELIEF_MIN_M
    cells = s.field.res**2
    if over.sum() * cells < RELIEF_MIN_M2 or over.sum() < RELIEF_SHARE * inside.sum():
        return []
    # the relief's own cells, the speckle opened away
    raised = ndi.binary_opening(excess >= 1.0, iterations=1)
    if not raised.any():
        return []
    height = relief_heights(np.where(raised, excess, 0.0), raised)
    f = s.field
    labels, n = ndi.label(raised)
    out = []
    for k, sl in enumerate(ndi.find_objects(labels), start=1):
        patch = labels[sl] == k
        if patch.sum() * cells < RELIEF_MIN_PART_M2:
            continue
        r0, c0 = win[0].start + sl[0].start, win[1].start + sl[1].start
        x0, y0 = f.xmin + c0 * f.res, f.ymax - r0 * f.res
        transform = rasterio.transform.from_origin(x0, y0, f.res, f.res)
        outline = shapely.union_all(
            [
                shapely.geometry.shape(g)
                for g, v in rasterio.features.shapes(
                    patch.astype(np.uint8), patch, transform=transform
                )
                if v
            ]
        )
        grid = np.where(patch, np.round(height[sl], 1), -1.0)
        # walls reach down to the roof under each cell (a tower over a
        # pitched nave stands on the slope, not on the ridge), sunk a little
        # so the roof's slope inside a cell leaves no slit
        # (the lowest roof around the cell — only roofs: at the footprint's
        # edge the ground would pull the wall down along the LoD2 facade)
        roofed = np.where(np.isfinite(roof), floor, np.inf)
        low = ndi.minimum_filter(roofed, size=3, mode="nearest")
        low = np.where(np.isfinite(low), low, floor)
        under = low[sl] - top - FLOOR_SINK_M
        under = np.where(patch, np.round(np.minimum(under, grid - 0.5), 1), 0.0)
        props = {
            "kind": "relief",
            "z": round(top, 2),
            "h": round(float(grid.max()), 1),
            "of": of,
            "grid": {
                "x": round(x0, 2),
                "y": round(y0, 2),
                "res": f.res,
                "cols": int(grid.shape[1]),
                "rows": int(grid.shape[0]),
                "z": [float(v) for v in grid.ravel()],
                "floor": [float(v) for v in under.ravel()],
            },
        }
        out.append(feature(geometry_json(outline.simplify(0.5)), props))
    return out


def fill_voids(dom: np.ndarray, void: np.ndarray) -> np.ndarray:
    """The surface model with its voids filled from the nearest measured
    cell. A surface below the LoD2 roof is no surface: the laser saw
    through a sound opening, a glass roof or a dark slate (the cell then
    holds the ground), and drawn as such it tears a shaft into a tower."""
    if not void.any():
        return dom
    _, (rows, cols) = ndi.distance_transform_edt(void, return_indices=True)
    return dom[rows, cols]


def relief_heights(excess: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """The heights a relief is drawn with: half the measured cell, half its
    neighbourhood (a normalised Gaussian over the patch only), so a spire
    keeps its tip and a wave its crest while the 1 m cells stop reading as
    steps."""
    w = mask.astype(np.float64)
    blur = ndi.gaussian_filter(excess * w, RELIEF_SMOOTH) / np.maximum(
        ndi.gaussian_filter(w, RELIEF_SMOOTH), 1e-6
    )
    return np.where(mask, np.maximum(0.5 * excess + 0.5 * blur, 0.0), 0.0)


def landmark_reliefs(tile: Tile, s: Surfaces) -> list[dict]:
    """The roof relief of every landmark the tile owns."""
    path = tile.out("dlm", f"landmarks_{tile.id}.json")
    if not path.exists() or not tile.cityjson.exists():
        return []
    landmarks = json.loads(path.read_text()).get("landmarks", [])
    if not landmarks:
        return []
    city = json.loads(tile.cityjson.read_text())
    ids, polys = footprints(city)
    by_id = dict(zip(ids, polys, strict=True))
    out = []
    # the file lists them most notable first; only the first few get a
    # relief: on a villa among old trees the crowns over its roof would
    # read as the roof's own form, and the further down the list, the more
    # ordinary the building
    for lm in landmarks[:RELIEF_LANDMARKS]:
        # per LoD2 object: a part's roof is its own (the relief over the
        # hall, not over the tower beside it)
        for oid in lm["objects"]:
            if oid in by_id:
                out += relief(s, by_id[oid], oid)
    return out


def mapped_columns(tile: Tile):
    kinds = ",".join(f"'{k}'" for k in COLUMN_KINDS)
    for layer in ("points", "multipolygons"):
        geoms, cols = read_osm(
            tile, layer, f"man_made IN ({kinds})", ["man_made", "name", "other_tags"]
        )
        for g, kind, name, other in zip(
            geoms, cols["man_made"], cols["name"], cols["other_tags"], strict=True
        ):
            if g is None or g.is_empty:
                continue
            if name:
                other = f'{other or ""},"name"=>"{name}"'
            yield g, kind, other


def mapped_buildings(tile: Tile):
    geoms, cols = read_osm(
        tile, "multipolygons", "building IS NOT NULL", ["building", "name", "other_tags"]
    )
    for g, kind, name, other in zip(
        geoms, cols["building"], cols["name"], cols["other_tags"], strict=True
    ):
        if g is None or g.is_empty or kind in NOT_BUILDINGS:
            continue
        if tag(other, "location") == "underground" or (tag(other, "layer") or "0").startswith("-"):
            continue
        for part in shapely.get_parts(g):
            if part.is_valid:
                yield part, name


def find(tile: Tile, s: Surfaces) -> list[dict]:
    found: list[dict] = []
    for g, kind, other in mapped_columns(tile):
        anchor = g.centroid
        if not owns(tile.bounds, anchor.x, anchor.y):
            continue
        if kind in BUILT_TOWERS and s.under_roof(anchor):
            continue
        f = column(s, g, kind, other)
        if f:
            found.append(f)
    for g, name in mapped_buildings(tile):
        anchor = g.representative_point()
        if not owns(tile.bounds, anchor.x, anchor.y):
            continue
        f = building(s, g, name)
        if f:
            found.append(f)
    return found + landmark_reliefs(tile, s)


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"structures_{tile.id}.geojson")
    if not tile.products.dom or not tile.raw_raster("dom1").exists():
        print(f"{tile.id}: no surface model — no structures beyond LoD2")
        write_geojson(out, [], tile.epsg, OSM_ATTRIBUTION)
        return
    if not has_extract(tile, "the structures beyond LoD2"):
        return
    found = find(tile, Surfaces(tile))
    write_geojson(out, found, tile.epsg, OSM_ATTRIBUTION)
    kinds: dict[str, int] = {}
    for f in found:
        k = f["properties"]["kind"]
        kinds[k] = kinds.get(k, 0) + 1
    print(f"{tile.id}: structures beyond LoD2 {kinds or 'none'}")
