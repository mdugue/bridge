"""Basis-DLM → the land-cover class raster (one byte per texel, 4096² over a
2 km tile), its legend, and the hedge / tree-row lines. Without an open
Basis-DLM (Provider.products.dlm) the same three files come from
OpenStreetMap (landcover_osm.py). Where the DLM's road area swallows a
square's pedestrian island or lawn, OSM carves it back out
(`carve_islands`).

The client paints the classes with the palette in lib/city/landcover.ts; this
bake writes ids only. Classes burn lowest priority first, so water (8) wins
over everything. Roads are centrelines buffered by their surveyed width
`BRF`, else by the width the OSM way along them gives (road_widths.py),
else by a width per road class `WDM`, and not where they run through a
tunnel; streams are their axes buffered 1 m, and not where they run piped
(`stream_buffers`).
"""

from __future__ import annotations

import json

import numpy as np
import shapely
from PIL import Image
from rasterio.features import rasterize

from . import hedges, landcover_osm, road_widths, water
from .common import (
    OSM_ATTRIBUTION,
    Tile,
    above_ground,
    column,
    dlm_complete,
    dlm_tunnels,
    feature,
    geometry_json,
    read_layer,
    save_grey_png,
    write_geojson,
)
from .osm import has_extract, read_osm, tag

# id → key: the legend the client's palette is keyed by (lib/city/landcover.ts).
CLASSES = {
    0: "background",
    1: "farmland",
    2: "forest",
    3: "copse",
    4: "builtup",
    5: "railway",
    6: "path",
    7: "road",
    8: "water",
    9: "arable",
}

# The Landwirtschaft (veg01) that is ploughed — Ackerland, Streuobstacker,
# Spargel (`VEG`): bare soil or a crop as the season has it, not meadow.
ARABLE_VEG = ("1010", "1011", "1013")

# Road half-width (m) by WDM when the surveyed width BRF is unknown.
ROAD_HALF_WIDTH = {"1301": 10.0, "1303": 5.0, "1305": 4.0, "1306": 3.0, "1307": 2.5}
DEFAULT_ROAD_HALF_WIDTH = 2.5


def road_buffers(tile: Tile) -> list[shapely.Geometry]:
    """The road axes buffered by their width, without their stretches in a
    tunnel: a road there is under the ground the tile shows (a hillside over
    Meißen's Schottenbergtunnel, the square over Dresden's Wiener Platz),
    and painted, it grew a kerb along both sides. An axis without `BRF`
    takes its width from OSM where a way runs with it (road_widths.py)."""
    cols = ["BRF", "WDM", "FSZ"]
    geoms, fields = read_layer(tile.dlm / "ver01_l.shp", tile.bounds, columns=cols)
    under = dlm_tunnels(tile)
    osm = road_widths.OsmCarWays.read(tile) if tile.osm_extract() is not None else None
    out = []
    for g, brf, wdm, fsz in zip(geoms, *(column(fields, c, geoms) for c in cols), strict=True):
        width = float(brf) if brf not in (None, "") else 0.0
        half = width / 2 if width > 0 else ROAD_HALF_WIDTH.get(str(wdm), DEFAULT_ROAD_HALF_WIDTH)
        for part in (p for line in shapely.get_parts(g) for p in above_ground(line, under)):
            if width > 0:
                out.append(shapely.buffer(part, half))
            else:
                out += road_widths.buffered(part, osm, fsz, half)
    return out


def _areas(tile: Tile, layer: str) -> list[shapely.Geometry]:
    return list(read_layer(tile.dlm / f"{layer}.shp", tile.bounds)[0])


def arable_areas(tile: Tile) -> list[shapely.Geometry]:
    """The arable land among the Landwirtschaft (ARABLE_VEG)."""
    where = f"VEG IN ({', '.join(repr(v) for v in ARABLE_VEG)})"
    return list(read_layer(tile.dlm / "veg01_f.shp", tile.bounds, where=where)[0])


def _lines(tile: Tile, layer: str, half: float) -> list[shapely.Geometry]:
    return [shapely.buffer(g, half) for g in read_layer(tile.dlm / f"{layer}.shp", tile.bounds)[0]]


# A stream piped under a street, a station or a block is not on the ground
# the tile shows. The Basis-DLM says so twice: the structure it runs in (an
# AX_BauwerkImGewaesserbereich in `ver06`, "Durchlass" 2010, "Rohrdurchlass"
# 2011, "Düker" 2012) and the axis's own flag that something lies directly
# with it (`HDU_X`, hatDirektUnten). On the six DLM sites every flagged axis
# lies in such a structure but 46 m in Grimma; the orthophoto shows no water
# there (Unna's Kortelbach under the station, 1.0 km; Leipzig's
# Pleißemühlgraben under the square by the Neues Rathaus; Grimma's
# Thostgrundbach under its street), and OSM tags 71–95 % of what it maps of
# them `tunnel=culvert`. Painted, it was a straight blue line through Unna's
# station, and a blue stripe across every road over a culvert.
CULVERTS = ("2010", "2011", "2012")
CULVERT_HALF_M = 2.0
STREAM_HALF_M = 1.0


def dlm_culverts(tile: Tile) -> shapely.Geometry | None:
    """Where streams run piped: the Basis-DLM's culverts and siphons, as one
    area (CULVERT_HALF_M round their lines)."""
    areas = []
    where = f"BWF IN ({', '.join(repr(c) for c in CULVERTS)})"
    for layer in ("ver06_l", "ver06_f"):
        path = tile.dlm / f"{layer}.shp"
        if path.exists():
            geoms, _ = read_layer(path, tile.bounds, where=where)
            areas += [g.buffer(CULVERT_HALF_M) for g in geoms if g is not None]
    return shapely.union_all(areas) if areas else None


def _flag(value) -> bool:
    """A Shape-profile relation flag (`HDU_X`), int or text."""
    return str(value).strip() in ("1", "1.0", "True", "true")


def stream_buffers(tile: Tile) -> list[shapely.Geometry]:
    """The stream axes (`gew01_l`) buffered STREAM_HALF_M, without the
    stretches that run piped (`dlm_culverts`, or flagged `HDU_X`)."""
    geoms, fields = read_layer(tile.dlm / "gew01_l.shp", tile.bounds, columns=["HDU_X"])
    piped = dlm_culverts(tile)
    out = []
    for g, hdu in zip(geoms, column(fields, "HDU_X", geoms), strict=True):
        if g is None or _flag(hdu):
            continue
        open_ = g.difference(piped) if piped is not None and g.intersects(piped) else g
        out += [shapely.buffer(p, STREAM_HALF_M) for p in shapely.get_parts(open_) if p.length > 1]
    return out


def burn_order(tile: Tile) -> list[tuple[int, list[shapely.Geometry]]]:
    """(class id, geometries) in burn order: later burns overwrite earlier."""
    return [
        (1, _areas(tile, "veg01_f")),  # farmland / meadow
        (9, arable_areas(tile)),  # of it the arable land
        (2, _areas(tile, "veg02_f")),  # forest
        (3, _areas(tile, "veg03_f")),  # copse
        (4, _areas(tile, "sie02_f")),  # built-up
        (5, _areas(tile, "ver03_f")),  # railway area
        (6, _lines(tile, "ver02_l", 1.0)),  # paths
        (7, _areas(tile, "ver01_f")),  # road area
        (7, road_buffers(tile)),  # road centrelines, buffered
        (8, _areas(tile, "gew02_f")),  # water area (alt)
        (8, _areas(tile, "gew01_f")),  # water area
        (8, stream_buffers(tile)),  # streams, buffered, not where piped
    ]


def class_raster(
    tile: Tile, px: int, order: list[tuple[int, list[shapely.Geometry]]]
) -> np.ndarray:
    raster = np.zeros((px, px), dtype=np.uint8)
    transform = tile.transform(px)
    for cls, geoms in order:
        valid = [g for g in geoms if g is not None and not g.is_empty]
        if valid:
            rasterize(
                ((g, cls) for g in valid),
                out=raster,
                transform=transform,
                dtype=np.uint8,
            )
    return raster


# OSM areas that the DLM's road class swallows: a square's pedestrian island,
# its lawns, a traffic island. Burned only over road texels, walk first so a
# lawn inside a pedestrian area wins. The DLM draws the Albertplatz (and many
# squares) as one road area; OSM knows the island in the middle.
WALK_AREAS = {"footway", "pedestrian", "traffic_island", "path", "cycleway"}
GREEN_LANDUSE = {"grass", "village_green", "meadow", "flowerbed"}
GREEN_LEISURE = {"park", "garden"}


def osm_islands(tile: Tile) -> list[tuple[int, list[shapely.Geometry]]]:
    """(class id, areas) of the non-carriageway ground OSM maps inside the
    road class: pedestrian areas, islands and fountain basins as built-up
    (4), lawns and parks as meadow (1)."""
    geoms, fields = read_osm(
        tile,
        "multipolygons",
        "landuse IS NOT NULL OR leisure IS NOT NULL OR amenity = 'fountain' "
        "OR other_tags LIKE '%highway%'",
        ["landuse", "leisure", "amenity", "other_tags"],
    )
    walk, green = [], []
    for g, landuse, leisure, amenity, tags in zip(
        geoms,
        column(fields, "landuse", geoms),
        column(fields, "leisure", geoms),
        column(fields, "amenity", geoms),
        column(fields, "other_tags", geoms),
        strict=True,
    ):
        if landuse in GREEN_LANDUSE or leisure in GREEN_LEISURE:
            green.append(g)
        elif (
            tag(tags, "highway") == "pedestrian"
            or tag(tags, "area:highway") in WALK_AREAS
            or amenity == "fountain"  # the basin is drawn by the monuments
        ):
            walk.append(g)
    return [(4, walk), (1, green)]


def carve_islands(raster: np.ndarray, tile: Tile) -> int:
    """Re-classes the road texels OSM calls pedestrian ground or lawn, in
    place; the number of texels changed. Idempotent (only road texels
    change), so it can run over a committed raster (`--step islands`)."""
    px = raster.shape[0]
    islands = np.zeros_like(raster)
    for cls, geoms in osm_islands(tile):
        valid = [g for g in geoms if g is not None and not g.is_empty]
        if valid:
            rasterize(((g, cls) for g in valid), out=islands, transform=tile.transform(px))
    carve = (raster == 7) & (islands > 0)
    raster[carve] = islands[carve]
    return int(np.count_nonzero(carve))


def _island_credit(tile: Tile) -> str:
    return f"{tile.credit}; islands: {OSM_ATTRIBUTION}"


def run_islands(tile: Tile) -> None:
    """The OSM islands over the committed class raster, without the DLM."""
    if not tile.products.dlm or not has_extract(tile, "the road islands"):
        return
    path = tile.out("dlm", f"landcover_{tile.id}.png")
    raster = np.array(Image.open(path).convert("L"))
    changed = carve_islands(raster, tile)
    save_grey_png(path, raster)
    legend_path = tile.out("dlm", f"landcover_{tile.id}.json")
    legend = json.loads(legend_path.read_text())
    legend["attribution"] = _island_credit(tile)
    legend_path.write_text(json.dumps(legend, indent=2) + "\n")
    print(f"{tile.id}: {changed} road texels re-classed from OSM islands")


def veg_rows(tile: Tile) -> list[dict]:
    """ATKIS veg04 lines: hedges (BWS = 1100) and tree rows."""
    geoms, fields = read_layer(tile.dlm / "veg04_l.shp", tile.bounds, columns=["BWS"])
    features = []
    for g, bws in zip(geoms, column(fields, "BWS", geoms), strict=True):
        kind = "hedge" if str(bws) == "1100" else "treerow"
        for part in shapely.get_parts(g):
            features.append(feature(geometry_json(part), {"kind": kind}))
    return features


def run(tile: Tile, px: int = 4096) -> None:
    if tile.products.dlm:
        if not dlm_complete(tile.dlm):
            raise SystemExit(
                f"{tile.id}: no complete Basis-DLM under {tile.dlm} — the land cover is required; "
                "run `bun run fetch` first"
            )
        order, rows, source = burn_order(tile), veg_rows(tile), "Basis-DLM"
        # A hedge OSM maps too is lowveg.py's (at its measured height): once.
        if has_extract(tile, "the mapped hedges"):
            mapped = [line for _, line in hedges.osm_hedge_lines(tile)]
            rows, _ = hedges.without_mapped(rows, mapped)
    else:
        if not has_extract(tile, "the land cover"):
            raise SystemExit(f"{tile.id}: the land cover is required; run `bun run fetch` first")
        (order, rows), source = landcover_osm.burn_order(tile), "OpenStreetMap"
    raster = class_raster(tile, px, order)
    if not raster.any():
        raise SystemExit(f"{tile.id}: nothing rasterized (no {source} features in the tile?)")
    # OSM land cover has its islands already; only the DLM's roads swallow them.
    islands = tile.products.dlm and has_extract(tile, "the road islands")
    if islands:
        carve_islands(raster, tile)
    # The water's bodies: their dry shore re-classed here, the rest for the build.
    bodies = water.bodies(tile, raster)
    save_grey_png(tile.out("dlm", f"landcover_{tile.id}.png"), raster)
    legend = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "source": source,
        "classes": {str(k): v for k, v in CLASSES.items()},
        **({"attribution": _island_credit(tile)} if islands else {}),
        "water": bodies,
    }
    tile.out("dlm", f"landcover_{tile.id}.json").write_text(json.dumps(legend, indent=2) + "\n")
    write_geojson(tile.out("dlm", f"vegrows_{tile.id}.geojson"), rows, tile.epsg)
    print(f"{tile.id}: land cover {px}² from {source} ({landcover_osm.stats(raster)})")
