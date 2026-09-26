"""The land-cover class raster → an edge-distance raster: for every texel the
signed distance (m) to the carriageway's edge and to the meadow's edge,
smoothed, 2048² over a 2 km tile (≈1 m).

The DLM road class (7) is the carriageway at its surveyed width, so its edge
is the kerb line; the terrain shader draws the kerb, the gutter and the
parking lanes (2–5 m out from the kerb) at distances from it, and lays paving
rows along it. Reading the class raster alone, the shader only knows that
distance within about a texel of the edge, and it follows the raster's 0.5 m
staircase. Here it is measured out to ±6 m and smoothed, so its isolines run
straight along a diagonal street and parallel to the kerb.

Two bytes per texel, interleaved in an 8-bit greyscale PNG twice as wide
(R0 G0 R1 G1 …, read by the viewer's own PNG decoder, lib/city/png-raster.ts):

    R = 128 + 20 · distance to the road edge   (positive on the road)
    G = 128 + 20 · distance to the meadow edge (positive on the meadow,
                                               urban green included)

so 5 cm steps over ±6.35 m, clamped. Keep `EDGE_SCALE` in step with the
viewer (`EDGE_SCALE` in lib/city/landcover.ts). Needs only the committed
class raster (plus the NDVI and paving rasters when present), so it runs
without the raw DLM; it runs after `surface`.

It also writes the kerb lines (`kerbs_<tile>.geojson`): the smoothed road
edge where the far side is ground, the carriageway on each line's left. The
terrain bake stands a kerb stone on them (lib/city/kerbs.ts).
"""

from __future__ import annotations

import json

import numpy as np
import shapely
from PIL import Image

from .common import Tile, feature, geometry_json, write_geojson

ROAD = 7
MEADOW = 1
BUILTUP = 4
NO_KERB = (5, 8)  # railway, water: a carriageway edge there is no kerb
# Urban green: built-up or unclassified ground whose DOP NDVI says green —
# courtyards, front gardens, parks inside the settlement. Counted as meadow
# here, so it gets the meadow's edges; the shader paints it as meadow.
GREEN_NDVI = 0.3
SEALED = (1, 2, 3, 4)  # OSM walk surfaces that are paved: never green
KERB_SIMPLIFY_M = 0.15
KERB_MIN_M = 3.0
EDGE_SCALE = 20.0  # bytes per metre
REACH_M = 6.5  # how far out the distance is measured


def distance_px(mask: np.ndarray, reach: int) -> np.ndarray:
    """For every texel, the distance (texels) to the nearest `True` one, by
    growing the mask ring by ring — 4-neighbours every ring, diagonals every
    other, an octagonal metric within ~8 % of the Euclidean one. Capped at
    `reach`; `True` texels are 0."""
    d = np.where(mask, 0.0, float(reach))
    cur = mask.copy()
    for ring in range(1, reach + 1):
        grow = cur.copy()
        grow[1:] |= cur[:-1]
        grow[:-1] |= cur[1:]
        grow[:, 1:] |= cur[:, :-1]
        grow[:, :-1] |= cur[:, 1:]
        if ring % 2 == 0:
            grow[1:, 1:] |= cur[:-1, :-1]
            grow[1:, :-1] |= cur[:-1, 1:]
            grow[:-1, 1:] |= cur[1:, :-1]
            grow[:-1, :-1] |= cur[1:, 1:]
        d[grow & ~cur] = ring
        cur = grow
    return d


def signed_distance_px(inside: np.ndarray, reach: int) -> np.ndarray:
    """Signed distance (texels) to the edge of `inside`, positive inside;
    the edge lies halfway between an inside and an outside texel."""
    return np.where(
        inside,
        distance_px(~inside, reach) - 0.5,
        -(distance_px(inside, reach) - 0.5),
    )


def box_blur(a: np.ndarray, passes: int = 3) -> np.ndarray:
    """Three 3×3 box passes ≈ a Gaussian of about one texel: the staircase
    of the class raster smoothed out of the distance's isolines."""
    out = a.astype(np.float64)
    for _ in range(passes):
        p = np.pad(out, 1, mode="edge")
        out = (
            sum(
                p[dy : dy + out.shape[0], dx : dx + out.shape[1]]
                for dy in range(3)
                for dx in range(3)
            )
            / 9.0
        )
    return out


def edge_field(cls: np.ndarray, class_id: int, res: float, out_px: int) -> np.ndarray:
    """The smoothed signed distance (m) to one class's edge, averaged down to
    out_px²."""
    reach = int(np.ceil(REACH_M / res)) + 2
    sd = box_blur(signed_distance_px(cls == class_id, reach)) * res
    k = cls.shape[0] // out_px
    return sd.reshape(out_px, k, out_px, k).mean(axis=(1, 3))


def urban_green(tile: Tile, cls: np.ndarray) -> np.ndarray:
    """The built-up/background texels the NDVI calls green and OSM does not
    call paved (the NDVI and paving rasters are optional)."""
    n = cls.shape[0]
    green = np.zeros(cls.shape, dtype=bool)
    ndvi_png = tile.out("dlm", f"ndvi_{tile.id}.png")
    if not ndvi_png.exists():
        return green
    ndvi = np.asarray(Image.open(ndvi_png).convert("L"), dtype=np.float64) / 255.0
    # Upsampled and blurred: the ~2 m raster as a soft field, not a speckle.
    ndvi = box_blur(np.kron(ndvi, np.ones((n // ndvi.shape[0], n // ndvi.shape[1]))), passes=2)
    green = (ndvi > GREEN_NDVI) & np.isin(cls, (0, BUILTUP))
    surface_png = tile.out("dlm", f"surface_{tile.id}.png")
    if surface_png.exists():
        grey = np.asarray(Image.open(surface_png).convert("L"))
        walk = (grey[:, 0::4] >> 3) & 7
        walk = np.kron(walk, np.ones((n // walk.shape[0], n // walk.shape[1]), dtype=np.uint8))
        green &= ~np.isin(walk, SEALED)
    return green


def contour_segments(field: np.ndarray) -> np.ndarray:
    """Marching squares on the 0 level of `field` (texel units, row 0 =
    north): the segments as an (n, 2, 2) array of (col, row) points."""
    v00, v10 = field[:-1, :-1], field[:-1, 1:]
    v01, v11 = field[1:, :-1], field[1:, 1:]
    rows, cols = np.mgrid[0 : field.shape[0] - 1, 0 : field.shape[1] - 1].astype(np.float64)

    def cross(a, b, ax, ay, bx, by):
        hit = (a > 0) != (b > 0)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = a / (a - b)
            return (
                np.where(hit, ax + t * (bx - ax), np.nan),
                np.where(hit, ay + t * (by - ay), np.nan),
            )

    # The four cell edges: north, east, south, west.
    edges = [
        cross(v00, v10, cols, rows, cols + 1, rows),
        cross(v10, v11, cols + 1, rows, cols + 1, rows + 1),
        cross(v01, v11, cols, rows + 1, cols + 1, rows + 1),
        cross(v00, v01, cols, rows, cols, rows + 1),
    ]
    xs = np.stack([e[0] for e in edges], axis=-1)
    ys = np.stack([e[1] for e in edges], axis=-1)
    hits = ~np.isnan(xs)
    count = hits.sum(axis=-1)
    out = []
    two = count == 2
    if two.any():
        idx = np.argsort(~hits[two], axis=-1, kind="stable")[:, :2]
        px = np.take_along_axis(xs[two], idx, axis=-1)
        py = np.take_along_axis(ys[two], idx, axis=-1)
        out.append(
            np.stack([np.stack([px[:, 0], py[:, 0]], -1), np.stack([px[:, 1], py[:, 1]], -1)], 1)
        )
    four = count == 4
    if four.any():  # a saddle: pair north-west and south-east
        for a, b in ((0, 3), (1, 2)):
            out.append(
                np.stack(
                    [
                        np.stack([xs[four][:, a], ys[four][:, a]], -1),
                        np.stack([xs[four][:, b], ys[four][:, b]], -1),
                    ],
                    1,
                )
            )
    return np.concatenate(out) if out else np.empty((0, 2, 2))


def kerb_lines(tile: Tile, road_m: np.ndarray, cls_small: np.ndarray) -> list[shapely.LineString]:
    """The kerb: the smoothed road edge, where the far side is ground (not
    water or railway), as EPSG lines with the road on their left."""
    px = road_m.shape[0]
    segs = contour_segments(road_m)
    if len(segs) == 0:
        return []
    mid = segs.mean(axis=1)
    r = np.clip(np.round(mid[:, 1]).astype(int), 1, px - 2)
    c = np.clip(np.round(mid[:, 0]).astype(int), 1, px - 2)
    near = np.zeros(len(segs), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= np.isin(cls_small[r + dy, c + dx], NO_KERB)
    segs = segs[~near]
    xmin, _, xmax, ymax = tile.bounds
    res = (xmax - xmin) / px
    # Texel (col, row) → EPSG: the field's samples sit at texel centres.
    epsg = np.stack([xmin + (segs[..., 0] + 0.5) * res, ymax - (segs[..., 1] + 0.5) * res], axis=-1)
    merged = shapely.line_merge(shapely.multilinestrings(list(epsg)))
    lines = []
    for line in shapely.get_parts(merged):
        line = shapely.simplify(line, KERB_SIMPLIFY_M)
        if line.length < KERB_MIN_M:
            continue
        lines.append(road_on_left(line, road_m, tile, res))
    return lines


def road_on_left(line: shapely.LineString, road_m: np.ndarray, tile: Tile, res: float):
    """The line, reversed if need be, so the carriageway lies on its left."""
    xy = np.asarray(line.coords)
    a, b = xy[0], xy[1]
    d = (b - a) / (np.hypot(*(b - a)) or 1.0)
    probe = (a + b) / 2 + np.array([-d[1], d[0]]) * 0.7
    xmin, _, _, ymax = tile.bounds
    col = int(np.clip((probe[0] - xmin) / res - 0.5, 0, road_m.shape[1] - 1))
    row = int(np.clip((ymax - probe[1]) / res - 0.5, 0, road_m.shape[0] - 1))
    return line if road_m[row, col] > 0 else shapely.reverse(line)


def encode(metres: np.ndarray) -> np.ndarray:
    return np.clip(np.round(128.0 + metres * EDGE_SCALE), 0, 255).astype(np.uint8)


def run(tile: Tile, px: int = 2048) -> None:
    cls = tile.classes()
    if cls is None:
        print(f"{tile.id}: no class raster — skipping the edge distances")
        return
    res = (tile.bounds[2] - tile.bounds[0]) / cls.shape[1]
    road_m = edge_field(cls, ROAD, res, px)
    lawn = np.where(urban_green(tile, cls), MEADOW, cls)
    road = encode(road_m)
    meadow = encode(edge_field(lawn, MEADOW, res, px))
    grey = np.stack([road, meadow], axis=-1).reshape(px, 2 * px)
    Image.fromarray(grey, mode="L").save(tile.out("dlm", f"edges_{tile.id}.png"), optimize=True)
    legend = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "encoding": {
            "layout": "8-bit greyscale, 2 * size wide: R0 G0 R1 G1 ... per row",
            "r": "128 + scale * signed distance (m) to the road edge, positive on the road",
            "g": "128 + scale * signed distance (m) to the meadow edge, positive on the meadow",
        },
        "scale": EDGE_SCALE,
    }
    tile.out("dlm", f"edges_{tile.id}.json").write_text(json.dumps(legend, indent=2) + "\n")
    k = cls.shape[0] // px
    kerbs = kerb_lines(tile, road_m, cls[::k, ::k])
    write_geojson(
        tile.out("dlm", f"kerbs_{tile.id}.geojson"),
        [feature(geometry_json(line)) for line in kerbs],
        tile.epsg,
        "Quelle: GeoSN, dl-de/by-2-0",
    )
    total = sum(line.length for line in kerbs) / 1000
    print(f"{tile.id}: edge distances {px}², {len(kerbs)} kerbs ({total:.1f} km)")
