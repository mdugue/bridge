"""DOP + LoD2 → each building's roof colour and each roof face's, keyed by
CityObject id; the building bake folds them into the mesh.

A face's colour is read from its texels in sun only (dop_light.py): the
orthophoto is flown in sun, and a face turned from it, or one a neighbour
shades, reads several times darker and bluer than its tiles are — one
median over a whole roof painted the Frauenkirche's dome slate grey, half
the Altstadt's red roofs brown and a mansard's red slopes the grey of its
zinc top. Each sunlit texel is scaled by its face's slope to how a flat
roof in the same sun reads it (the sun is found from the image's shadows),
so a roof's faces turned to and from the sun come out alike. Per face and
per building: rasterise the RoofSurface rings, erode them inward (the
orthophoto leans buildings over their facades), take the per-channel
median of at least 12 sunlit texels, in linear RGB.

The file: `roofs`, every building's colour (its faces' sunlit texels
together; the old median over all texels where too few are lit), and
`faces`, the faces whose own colour differs from it, as `[geometry,
surface, r, g, b]` — the geometry's index in the object and the surface's
in its flattened boundaries, the ids cityjson-threejs-loader writes
(`geometryid`, `boundaryid`)."""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFilter
from rasterio.enums import Resampling

from .common import Tile
from .dop_lean import LEAN_MIN_HEIGHT, Sample, building_lean, fit_leans, lean_map, reach_px
from .dop_light import (
    SUN_RES_M,
    estimate_sun,
    incidence_gain,
    light_ratio,
    luminance,
    roof_surface_model,
    shadow_mask,
    sun_vector,
)

MIN_SAMPLES = 12
# A face takes its own colour only when this share of it is in sun: in
# shadow it is the building's (most roofs are one material).
MIN_LIT_SHARE = 0.25
# A face the sun meets at a lower cosine than this (about 10° above its
# plane) is read as in shadow: it is lit by the sky alone.
MIN_SUN_COS = 0.17
# A face is written only when its colour differs from its building's by
# this much in some channel (8-bit sRGB steps): the rest read the
# building's from the mesh's table.
FACE_STEP = 6


def srgb_to_linear(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb8(c: float) -> float:
    c = min(max(c, 0.0), 1.0)
    return 255 * (c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)


_LINEAR = np.array([srgb_to_linear(float(v)) for v in range(256)], np.float32)


def roof_rings(geometry: dict):
    """Each RoofSurface exterior ring (vertex indices) of one geometry."""
    return surface_rings(geometry, "RoofSurface")


def surface_rings(geometry: dict, kind: str):
    """Each exterior ring (vertex indices) of one geometry's `kind` surfaces
    (RoofSurface, GroundSurface, …)."""
    for _, ring in indexed_rings(geometry, kind):
        yield ring


def indexed_rings(geometry: dict, kind: str):
    """(index, exterior ring) of one geometry's `kind` surfaces, the index
    counting every surface of the geometry's flattened boundaries — a
    Solid's shells one after another, as cityjson-threejs-loader numbers
    its `boundaryid`."""
    semantics = geometry.get("semantics") or {}
    surfaces = semantics.get("surfaces", [])
    values = semantics.get("values")
    boundaries = geometry.get("boundaries", [])
    pairs = []
    if geometry.get("type") == "Solid":
        for shell_i, shell in enumerate(boundaries):
            shell_values = values[shell_i] if values else None
            for i, surface in enumerate(shell):
                pairs.append((surface, shell_values[i] if shell_values is not None else None))
    elif geometry.get("type") in ("MultiSurface", "CompositeSurface"):
        for i, surface in enumerate(boundaries):
            pairs.append((surface, values[i] if values else None))
    for index, (surface, s) in enumerate(pairs):
        is_kind = s is not None and s < len(surfaces) and surfaces[s].get("type") == kind
        if is_kind and surface and surface[0]:
            yield index, surface[0]


def ring_normal(ring, to_metres) -> tuple[float, float, float]:
    """A planar ring's upward unit normal, east-north-up (Newell's)."""
    nx = ny = nz = 0.0
    pts = [to_metres(vi) for vi in ring]
    for i, (x0, y0, z0) in enumerate(pts):
        x1, y1, z1 = pts[(i + 1) % len(pts)]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length == 0:
        return (0.0, 0.0, 1.0)
    sign = 1 if nz >= 0 else -1
    return (sign * nx / length, sign * ny / length, sign * nz / length)


def ring_slope(ring, to_metres) -> float:
    """A planar ring's slope from the horizontal, degrees."""
    return math.degrees(math.acos(min(1.0, ring_normal(ring, to_metres)[2])))


def ring_mask(rings, box, erode: int) -> np.ndarray:
    """The rings rasterised in `box` (c0, r0, c1, r1), eroded inward by
    `erode` texels unless that erases them."""
    c0, r0, c1, r1 = box
    mask = Image.new("L", (c1 - c0, r1 - r0), 0)
    draw = ImageDraw.Draw(mask)
    for ring in rings:
        draw.polygon([(c - c0, r - r0) for c, r in ring], fill=255)
    if erode >= 3 and mask.width > erode and mask.height > erode:
        inset = mask.filter(ImageFilter.MinFilter(erode))
        if inset.getbbox():  # keep the inset only if it didn't erase a thin roof
            mask = inset
    return np.asarray(mask) > 0


def _upper_median(texels: np.ndarray) -> list[float]:
    """The upper per-channel median, like the sorted-list median it replaced,
    at most 1: a face's slope gain can scale a bright roof past white."""
    return [round(min(1.0, float(c)), 4) for c in np.sort(texels, axis=0)[len(texels) // 2]]


def median_colour(rgb, rings, box, erode: int):
    """The upper per-channel median (linear RGB) of the DOP under the
    rings, eroded inward; None under MIN_SAMPLES texels."""
    c0, r0, c1, r1 = box
    texels = rgb[r0:r1, c0:c1][ring_mask(rings, box, erode)]
    if len(texels) < MIN_SAMPLES:
        return None
    return _upper_median(_LINEAR[texels])


class Light:
    """The flight's light over one tile: which texels are in shadow, and
    the sun with its share of the light, when they could be read."""

    def __init__(self, shadow: np.ndarray, sun=None, ratio: float | None = None):
        self.shadow = shadow
        self.sun = sun_vector(*sun) if sun else None
        self.ratio = ratio

    def gain(self, normal) -> float:
        return incidence_gain(normal, self.sun, self.ratio)

    def faces_away(self, normal) -> bool:
        """Whether a face lies in its own shadow, or so near it that the sun
        only grazes it: its texels are skylight, however red tiles read in
        it (the blue test misses those)."""
        if self.sun is None:
            return False
        return sum(n * s for n, s in zip(normal, self.sun, strict=True)) < MIN_SUN_COS


def face_colours(rgb, light: Light, faces, box):
    """One building's colour and its faces' own, from their sunlit texels
    scaled by each face's slope (`Light.gain`). `faces` are (key, ring in
    texels, normal); returns (colour or None, {key: colour})."""
    c0, r0, c1, r1 = box
    crop = rgb[r0:r1, c0:c1]
    shade = light.shadow[r0:r1, c0:c1]
    lit_all, own = [], {}
    for key, ring, normal in faces:
        if light.faces_away(normal):
            continue
        mask = ring_mask([ring], box, 3)
        lit = mask & ~shade
        n_lit = int(lit.sum())
        if n_lit == 0:
            continue
        texels = _LINEAR[crop[lit]] * light.gain(normal)
        lit_all.append(texels)
        if n_lit >= MIN_SAMPLES and n_lit >= MIN_LIT_SHARE * mask.sum():
            own[key] = _upper_median(texels)
    joined = np.concatenate(lit_all) if lit_all else np.zeros((0, 3))
    return (_upper_median(joined) if len(joined) >= MIN_SAMPLES else None), own


def _differs(a, b) -> bool:
    return (
        max(abs(linear_to_srgb8(x) - linear_to_srgb8(y)) for x, y in zip(a, b, strict=True))
        > FACE_STEP
    )


def read_light(tile: Tile, dop, rgb: np.ndarray, faces) -> Light:
    """The tile's shadows, and the flight's sun from them where the DGM is
    there to cast the roofs' shadows on (dop_light.estimate_sun)."""
    shadow = shadow_mask(rgb)
    xmin, ymin, xmax, ymax = tile.bounds
    metre = (int(round((xmax - xmin) / 1.0)), int(round((ymax - ymin) / 1.0)))
    small = np.moveaxis(
        dop.read((1, 2, 3), out_shape=(3, metre[1], metre[0]), resampling=Resampling.average), 0, -1
    )
    ratio = light_ratio(small, shadow_mask(small))
    if not tile.dgm.exists():
        return Light(shadow, None, ratio)
    n = (int((xmax - xmin) / SUN_RES_M), int((ymax - ymin) / SUN_RES_M))
    coarse = np.moveaxis(
        dop.read((1, 2, 3), out_shape=(3, n[1], n[0]), resampling=Resampling.average), 0, -1
    )
    with rasterio.open(tile.dgm) as g:
        dgm = g.read(1, out_shape=(n[1], n[0]), resampling=Resampling.average, masked=True)
    # a gap in the DGM would read as a pit the roofs cast shadows into
    dgm = dgm.filled(np.ma.median(dgm) if dgm.count() else 0).astype(np.float32)
    dsm, roofs = roof_surface_model(
        dgm, faces, lambda x, y: ((x - xmin) / SUN_RES_M, (ymax - y) / SUN_RES_M)
    )
    sun = estimate_sun(shadow_mask(coarse), dsm, roofs)
    return Light(shadow, sun, ratio)


def _vertex_ids(obj: dict):
    def walk(b):
        if isinstance(b, int):
            yield b
        else:
            for item in b:
                yield from walk(item)

    for g in obj.get("geometry", []):
        yield from walk(g.get("boundaries", []))


def roof_leans(rgb: np.ndarray, light: Light, buildings, bounds, px: float):
    """Each building's lean (dop_lean.py) and the tile's lean nodes, from
    the tall buildings' roof shading; none without a sun to shade by.
    `buildings`: {id: ([(key, ring in metres, normal)], base height)}."""
    if light.sun is None:
        return {}, []
    xmin, _, _, ymax = bounds
    h, w = rgb.shape[:2]
    samples, centres = {}, {}
    for oid, (faces, base) in buildings.items():
        pts = [p for _, ring, _ in faces for p in ring]
        centres[oid] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        height = max(p[2] for p in pts) - base
        if height < LEAN_MIN_HEIGHT:
            continue
        reach = reach_px(height, px)
        cols = [(p[0] - xmin) / px for p in pts]
        rows = [(ymax - p[1]) / px for p in pts]
        c0, r0 = max(0, int(min(cols)) - reach), max(0, int(min(rows)) - reach)
        c1, r1 = min(w, int(max(cols)) + reach + 1), min(h, int(max(rows)) + reach + 1)
        if c1 - c0 < 2 or r1 - r0 < 2:
            continue
        lum = luminance(rgb[r0:r1, c0:c1].astype(np.float32))
        drawn = [
            ([((x - xmin) / px - c0, (ymax - y) / px - r0) for x, y, _ in ring], normal)
            for _, ring, normal in sorted(faces, key=lambda f: max(p[2] for p in f[1]))
        ]
        grid = lean_map(lum, drawn, light.sun, reach)
        if grid is not None:
            samples[oid] = Sample(*centres[oid], height, grid, reach, px)
    nodes = fit_leans(list(samples.values()), bounds)
    leans = {oid: building_lean(nodes, *centres[oid], samples.get(oid)) for oid in buildings}
    return leans, nodes


def run(tile: Tile, erode: int = 5) -> None:
    city_path = tile.cityjson
    if not (tile.raw_raster("dop").exists() and city_path.exists()):
        print(f"{tile.id}: no DOP or CityJSON — skipping roof colours (palette fallback)")
        return
    city = json.loads(city_path.read_text())
    scale = city.get("transform", {}).get("scale", [1, 1, 1])
    translate = city.get("transform", {}).get("translate", [0, 0, 0])
    verts = city["vertices"]

    def to_metres(vi: int) -> tuple[float, float, float]:
        v = verts[vi]
        return tuple(v[k] * scale[k] + translate[k] for k in range(3))

    with rasterio.open(tile.raw_raster("dop")) as dop:
        rgb = np.moveaxis(dop.read((1, 2, 3)), 0, -1)
        every_face = [
            [to_metres(vi) for vi in ring]
            for obj in city["CityObjects"].values()
            for g in obj.get("geometry", [])
            for ring in roof_rings(g)
        ]
        light = read_light(tile, dop, rgb, every_face)
    h, w = rgb.shape[:2]
    xmin, _, _, ymax = tile.bounds
    size_x, size_y = tile.size
    px_w, px_h = size_x / w, size_y / h

    buildings = {}
    for oid, obj in city["CityObjects"].items():
        faces = [
            ((gi, si), [to_metres(vi) for vi in ring], ring_normal(ring, to_metres))
            for gi, g in enumerate(obj.get("geometry", []))
            for si, ring in indexed_rings(g, "RoofSurface")
        ]
        if faces:
            buildings[oid] = (faces, min(to_metres(vi)[2] for vi in _vertex_ids(obj)))
    leans, nodes = roof_leans(rgb, light, buildings, tile.bounds, px_w)

    roofs, faces_out, sampled, skipped, in_sun = {}, {}, 0, 0, 0
    for oid, (metres, base) in buildings.items():
        kx, ky = leans.get(oid, (0.0, 0.0))
        faces = [
            (
                key,
                [
                    ((x + kx * (z - base) - xmin) / px_w, (ymax - y - ky * (z - base)) / px_h)
                    for x, y, z in pts
                ],
                normal,
            )
            for key, pts, normal in metres
        ]
        rings = [ring for _, ring, _ in faces]
        cols = [c for ring in rings for c, _ in ring]
        rows = [r for ring in rings for _, r in ring]
        c0, r0 = max(0, int(min(cols))), max(0, int(min(rows)))
        c1, r1 = min(w, int(max(cols)) + 1), min(h, int(max(rows)) + 1)
        if c1 - c0 < 2 or r1 - r0 < 2:
            continue
        box = (c0, r0, c1, r1)
        lit, own = face_colours(rgb, light, faces, box)
        whole = lit or median_colour(rgb, rings, box, erode)
        if whole is None:
            skipped += 1
            continue
        roofs[oid] = whole
        sampled += 1
        in_sun += lit is not None
        apart = [[*key, *c] for key, c in own.items() if _differs(c, whole)]
        if apart:
            faces_out[oid] = apart
    out = {
        "meta": {
            "tile": tile.id,
            "source": "DOP",
            "space": "linear-rgb",
            "erode_px": erode,
            "buildings_sampled": sampled,
            "buildings_skipped": skipped,
            "buildings_in_sun": in_sun,
            "faces_apart": sum(len(f) for f in faces_out.values()),
            "sun": None if light.sun is None else [round(c, 3) for c in light.sun],
            "light_ratio": None if light.ratio is None else round(light.ratio, 2),
            # the roofs' lean off their outlines, metres per metre of height
            "lean": [[round(x), round(y), round(k[0], 2), round(k[1], 2)] for x, y, k in nodes],
        },
        "roofs": roofs,
        # the faces whose own colour differs from their building's
        "faces": faces_out,
    }
    tile.out("dop", f"roofcolor_{tile.id}.json").write_text(json.dumps(out))
    print(
        f"{tile.id}: {sampled} roofs sampled ({in_sun} from sunlit texels), {skipped} skipped, "
        f"{out['meta']['faces_apart']} faces apart; sun {out['meta']['sun']}, "
        f"light ratio {out['meta']['light_ratio']}"
    )
