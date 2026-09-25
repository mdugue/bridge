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
    Point {k: "tree", h, d, src}          an orchard tree: the mapped
                                          `natural=tree` inside it, else an
                                          8 m grid along its long axis
                                          (src "osm" | "grid"); the tile's own
    Polygon/MultiPolygon {k: "vineyard"}  `landuse=vineyard`
    LineString {k: "row"}                 a vine row, 1.8 m apart along the
                                          contour (perpendicular to the DGM's
                                          mean gradient over the vineyard)

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
    G = 1 + o, o = the long axis over 0–180° in 0..126 of the colony (or
        of the mapped parcel) the texel lies in or nearest to, within
        `AXIS_REACH_M` outside it; 0 elsewhere

The terrain shader paints the gardens on it (app/_components/cultivated-
layer.ts); prepare-data crops it to the texels that carry a colony.
"""

from __future__ import annotations

import math

import numpy as np
import rasterio
import shapely
from PIL import Image
from rasterio.features import rasterize
from scipy import ndimage as ndi

from .common import (
    OSM_ATTRIBUTION,
    Tile,
    column,
    feature,
    geometry_json,
    owns,
    write_geojson,
)
from .osm import has_extract, read_osm, tag

ORCHARD_SPACING_M = 8.0
ORCHARD_TREE_H = 4.5  # m: a standard fruit tree, crown base ≈ 1.3 m ("small")
ORCHARD_TREE_D = 4.0
VINE_ROW_SPACING_M = 1.8
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


def contour_angle(tile: Tile, g: shapely.Geometry) -> float:
    """The direction along the contour over the polygon: perpendicular to
    the DGM's mean gradient (radians from east). A flat or DGM-less area
    runs along its long axis."""
    if not tile.dgm.exists():
        return long_axis(g)
    with rasterio.open(tile.dgm) as ds:
        z = ds.read(1).astype(np.float64)
        mask = rasterize([(g, 1)], out_shape=z.shape, transform=ds.transform, dtype=np.uint8)
        res = ds.transform.a
    inside = mask.astype(bool) & np.isfinite(z)
    if inside.sum() < 4:
        return long_axis(g)
    gy, gx = np.gradient(z, res)  # rows grow south: dz/dy_north = −gy
    ex, ny = gx[inside].mean(), -gy[inside].mean()
    if math.hypot(ex, ny) < 0.01:  # under 1 %: flat
        return long_axis(g)
    return (math.atan2(ny, ex) + math.pi / 2) % math.pi


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
    tile: Tile, px: int, colonies: list, parcels: list, paths: list, cls: np.ndarray | None
) -> np.ndarray:
    """The R and G planes (see the module docstring), (px, px, 2)."""
    fine = px * FINE
    res = (tile.bounds[2] - tile.bounds[0]) / fine
    transform = tile.transform(fine)
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
    shapes = [(c, 1 + axis_code(long_axis(c))) for c in colonies]
    shapes += [(p, 1 + axis_code(long_axis(p))) for p in parcels if not p.is_empty]
    g = rasterize(shapes, out_shape=(px, px), transform=coarse, dtype=np.uint8)
    if g.any():
        dist, (ri, ci) = ndi.distance_transform_edt(g == 0, return_indices=True)
        reach = dist * (tile.bounds[2] - tile.bounds[0]) / px <= AXIS_REACH_M
        g = np.where(reach, g[ri, ci], 0).astype(np.uint8)
    g = np.where(r > 0, g, 0).astype(np.uint8)
    return np.stack([r, g], axis=-1)


def clip_features(tile: Tile, geoms, kind: str) -> list[dict]:
    box = shapely.box(*tile.bounds)
    out = []
    for geom in geoms:
        clipped = shapely.intersection(shapely.make_valid(geom), box)
        polys = [p for p in shapely.get_parts(clipped) if p.geom_type == "Polygon" and p.area > 1]
        if polys:
            shape = polys[0] if len(polys) == 1 else shapely.MultiPolygon(polys)
            out.append(feature(geometry_json(shape), {"k": kind}))
    return out


def build(tile: Tile, areas, landuse, leisure, trees, paths_in) -> tuple[list[dict], dict]:
    box = shapely.box(*tile.bounds)
    valid = [shapely.make_valid(g) for g in areas]
    colonies = [g for g, lu in zip(valid, landuse, strict=True) if lu == "allotments"]
    colonies = [g for g in colonies if g.intersects(box)]
    gardens = [g for g, le in zip(valid, leisure, strict=True) if le == "garden"]
    orchards = [g for g, lu in zip(valid, landuse, strict=True) if lu == "orchard"]
    vineyards = [g for g, lu in zip(valid, landuse, strict=True) if lu == "vineyard"]
    parcels, with_parcels = [], 0
    for c in colonies:
        own = parcels_of(c, gardens)
        parcels.extend(own)
        with_parcels += bool(own)
    feats = clip_features(tile, colonies, "colony") + clip_features(tile, parcels, "parcel")
    n_trees = 0
    for o in orchards:
        if not o.intersects(box):
            continue
        feats += clip_features(tile, [o], "orchard")
        mapped = [(p.x, p.y) for p in trees if o.contains(p)]
        src = "osm" if mapped else "grid"
        for x, y in mapped or grid_trees(o):
            if owns(tile.bounds, x, y):
                props = {"k": "tree", "h": ORCHARD_TREE_H, "d": ORCHARD_TREE_D, "src": src}
                feats.append(
                    feature({"type": "Point", "coordinates": [round(x, 1), round(y, 1)]}, props)
                )
                n_trees += 1
    n_rows = 0
    for v in vineyards:
        if not v.intersects(box):
            continue
        feats += clip_features(tile, [v], "vineyard")
        for row in vine_rows(v, contour_angle(tile, v)):
            clipped = shapely.intersection(row, box)
            for part in shapely.get_parts(clipped):
                if part.geom_type == "LineString" and part.length >= 1.0:
                    feats.append(feature(geometry_json(part), {"k": "row"}))
                    n_rows += 1
    stats = {
        "colonies": len(colonies),
        "withParcels": with_parcels,
        "parcels": len(parcels),
        "colonyHa": round(sum(shapely.intersection(c, box).area for c in colonies) / 1e4, 1),
        "orchards": sum(1 for o in orchards if o.intersects(box)),
        "orchardTrees": n_trees,
        "vineyards": sum(1 for v in vineyards if v.intersects(box)),
        "vineRows": n_rows,
    }
    return feats, {"colonies": colonies, "parcels": parcels, "paths": paths_in, "stats": stats}


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the cultivated land"):
        return
    areas, af = read_osm(
        tile,
        "multipolygons",
        "landuse IN ('allotments', 'orchard', 'vineyard') OR leisure = 'garden'",
        ["landuse", "leisure"],
    )
    points, pf = read_osm(tile, "points", 'other_tags LIKE \'%"natural"=>"tree"%\'', ["other_tags"])
    trees = [
        p
        for p, t in zip(points, column(pf, "other_tags", points), strict=True)
        if tag(t, "natural") == "tree"
    ]
    lines, lf = read_osm(tile, "lines", "highway IS NOT NULL", ["highway"])
    paths = [
        shapely.buffer(g, PATH_HALF_WIDTH[h], cap_style="flat")
        for g, h in zip(lines, column(lf, "highway", lines), strict=True)
        if h in PATH_HALF_WIDTH
    ]
    feats, parts = build(
        tile, areas, column(af, "landuse", areas), column(af, "leisure", areas), trees, paths
    )
    path = tile.out("dlm", f"cultivated_{tile.id}.geojson")
    write_geojson(path, feats, tile.epsg, attribution=OSM_ATTRIBUTION)
    cls_png = tile.data / "dlm" / f"landcover_{tile.id}.png"
    cls = np.asarray(Image.open(cls_png).convert("L")) if cls_png.exists() else None
    near = shapely.union_all(parts["colonies"]) if parts["colonies"] else None
    colony_paths = [p for p in paths if near is not None and p.intersects(near)]
    raster = colony_raster(tile, px, parts["colonies"], parts["parcels"], colony_paths, cls)
    Image.fromarray(raster.reshape(px, 2 * px), mode="L").save(
        tile.out("dlm", f"cultivated_{tile.id}.png"), optimize=True
    )
    print(f"{tile.id}: cultivated land {parts['stats']}")
