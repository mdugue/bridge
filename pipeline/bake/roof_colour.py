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

A roof roofs.py rebuilt from DOM1 is read part by part instead of by its
LoD2 faces: the build draws the parts in its place, and LoD2 often lays
one flat lid over a whole block (the Neumarkt's quarters: red tiles, zinc
and courtyards under one face; the Schauspielhaus' three faces). Where the
fetch has the surface model, a face higher than ROOF_TEST_M is read only
where DOM1 shows its roof, so a street, forecourt or courtyard inside its
outline drops out.

The file: `roofs`, every building's colour (its faces' sunlit texels
together; the old median over all texels where too few are lit), and
`faces`, the faces whose own colour differs from it, as `[geometry,
surface, r, g, b]` — the geometry's index in the object and the surface's
in its flattened boundaries, the ids cityjson-threejs-loader writes
(`geometryid`, `boundaryid`) — and `parts`, a rebuilt roof's parts that
differ, as `[part, z, r, g, b]`, the part's index among the object's in
the roofs file and its level `z`."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFilter
from rasterio.enums import Resampling
from scipy.ndimage import uniform_filter

from .common import Tile
from .dop_lean import LEAN_MIN_HEIGHT, Sample, building_lean, fit_leans, lean_map, reach_px
from .dop_light import (
    GAIN_MAX,
    GAIN_MIN,
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
# A face this high over the ground (m) is read only where the surface
# model shows the roof (`on_the_roof`).
ROOF_TEST_M = 4.0


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

    def gains(self, normals: np.ndarray) -> np.ndarray:
        """`gain` for each of `normals` (n × 3), 0 where it `faces_away`."""
        if self.sun is None:
            return np.ones(len(normals))
        cos = normals @ np.asarray(self.sun)
        sun_z, ratio = self.sun[2], self.ratio
        if ratio is None or sun_z <= 0:
            gain = np.ones(len(normals))
        else:
            # incidence_gain, for many normals at once
            direct = (ratio - 1) / sun_z
            gain = (direct * sun_z + 1) / (direct * np.maximum(cos, 0.0) + 1)
            gain = np.clip(gain, GAIN_MIN, GAIN_MAX)
        return np.where(cos < MIN_SUN_COS, 0.0, gain)

    def faces_away(self, normal) -> bool:
        """Whether a face lies in its own shadow, or so near it that the sun
        only grazes it: its texels are skylight, however red tiles read in
        it (the blue test misses those)."""
        if self.sun is None:
            return False
        return sum(n * s for n, s in zip(normal, self.sun, strict=True)) < MIN_SUN_COS


@dataclass
class Face:
    """One roof face to read: `key` as the file writes it (a LoD2 face's
    geometry and surface index, a rebuilt part's ("p", index)), its outline
    in metres (x, y, z), the outer ring then its courtyards, and its upward
    unit normal. A rebuilt part's level is no face (it holds a block's
    pitched roofs as much as its flat ones): its texels take their normals
    from the surface model where the fetch has it, else from the part's
    measured surface (`surface`), else they are flat."""

    key: tuple
    rings: list
    normal: tuple[float, float, float]
    surface: dict | None = None
    part: bool = False


@dataclass
class Frame:
    """The tile's image and its 1 m surface and terrain models (when the
    fetch has them), with one building's lean and base: a roof point at
    height z shows `lean` × (z − base) off its place."""

    xmin: float
    ymax: float
    px: float
    size: tuple[int, int]
    dom: np.ndarray | None = None
    dgm: np.ndarray | None = None
    lean: tuple[float, float] = (0.0, 0.0)
    base: float = 0.0
    slope: tuple[np.ndarray, np.ndarray] | None = None

    def __post_init__(self):
        if self.dom is not None:
            # dz/dx and dz/dy of the surface model over 3 m (a texel's own
            # metre is noise: tiles, gutters, a chimney)
            smooth = uniform_filter(self.dom, 3)
            south, east = np.gradient(smooth)
            self.slope = (east, -south)

    def texel(self, x: float, y: float, z: float) -> tuple[float, float]:
        kx, ky = self.lean
        return (
            (x + kx * (z - self.base) - self.xmin) / self.px,
            (self.ymax - y - ky * (z - self.base)) / self.px,
        )

    def place(self, rows: np.ndarray, cols: np.ndarray, z: float):
        """Where texel centres show a point at height z: its (x, y)."""
        kx, ky = self.lean
        x = self.xmin + (cols + 0.5) * self.px - kx * (z - self.base)
        y = self.ymax - (rows + 0.5) * self.px + ky * (z - self.base)
        return x, y

    def box(self, faces) -> tuple[int, int, int, int] | None:
        pts = [self.texel(*p) for f in faces for ring in f.rings for p in ring]
        w, h = self.size
        c0, r0 = max(0, int(min(c for c, _ in pts))), max(0, int(min(r for _, r in pts)))
        c1, r1 = min(w, int(max(c for c, _ in pts)) + 1), min(h, int(max(r for _, r in pts)) + 1)
        return None if c1 - c0 < 2 or r1 - r0 < 2 else (c0, r0, c1, r1)


def _cells(model: np.ndarray, frame: Frame, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    rows = np.clip((frame.ymax - y).astype(int), 0, model.shape[0] - 1)
    cols = np.clip((x - frame.xmin).astype(int), 0, model.shape[1] - 1)
    return model[rows, cols]


def on_the_roof(frame: Frame, x: np.ndarray, y: np.ndarray, z: float) -> np.ndarray:
    """Which points the surface model shows the roof at: at least half way
    up from the ground to the face. Where a LoD2 outline or a lean reaches
    past the roof, the image shows the street, a forecourt or a courtyard
    there (the Schauspielhaus' hull covers part of its square). A roof
    under ROOF_TEST_M over the ground is not tested (a shed, a garage: the
    scan cannot tell it from a car)."""
    if frame.dom is None or frame.dgm is None:
        return np.ones(len(x), bool)
    ground = _cells(frame.dgm, frame, x, y)
    top = _cells(frame.dom, frame, x, y)
    return (z - ground < ROOF_TEST_M) | (top >= (z + ground) / 2)


def part_normals(frame: Frame, face: Face, z: float, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """A rebuilt part's upward unit normal at each point: the surface
    model's, else its measured surface's, else up."""
    if frame.slope is not None:
        n = np.stack(
            [
                -_cells(frame.slope[0], frame, x, y),
                -_cells(frame.slope[1], frame, x, y),
                np.ones(len(x)),
            ],
            axis=1,
        )
        return n / np.linalg.norm(n, axis=1, keepdims=True)
    if face.surface is not None:
        return _surface_normals(face.surface, z, x, y)
    return np.tile(np.array([0.0, 0.0, 1.0]), (len(x), 1))


def _surface_normals(surface: dict, z: float, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """The measured surface's upward unit normal under each point (its grid's
    central differences)."""
    res, cols, rows = surface["res"], surface["cols"], surface["rows"]
    grid = z + np.asarray(surface["dz"], np.float32).reshape(rows, cols) / 100
    dzdy, dzdx = np.gradient(grid, res)  # rows run south: dz/dy is -dzdy
    c = np.clip(((x - surface["x"]) / res).astype(int), 0, cols - 1)
    r = np.clip(((surface["y"] - y) / res).astype(int), 0, rows - 1)
    n = np.stack([-dzdx[r, c], dzdy[r, c], np.ones(len(x), np.float32)], axis=1)
    return n / np.linalg.norm(n, axis=1, keepdims=True)


def _face_mask(frame: Frame, face: Face, box) -> np.ndarray:
    c0, r0, c1, r1 = box
    mask = Image.new("L", (c1 - c0, r1 - r0), 0)
    draw = ImageDraw.Draw(mask)
    for i, ring in enumerate(face.rings):
        pts = [frame.texel(*p) for p in ring]
        draw.polygon([(c - c0, r - r0) for c, r in pts], fill=0 if i else 255)
    if mask.width > 3 and mask.height > 3:
        inset = mask.filter(ImageFilter.MinFilter(3))
        if inset.getbbox():
            mask = inset
    return np.asarray(mask) > 0


def face_texels(rgb, light: Light, frame: Frame, face: Face, box):
    """A face's sunlit texels on its roof (linear RGB, scaled by
    `Light.gain`) and how many texels it covers."""
    c0, r0, c1, r1 = box
    mask = _face_mask(frame, face, box)
    lit = mask & ~light.shadow[r0:r1, c0:c1]
    rows, cols = np.nonzero(lit)
    z = float(np.mean([p[2] for p in face.rings[0]]))
    x, y = frame.place(rows + r0, cols + c0, z)
    keep = on_the_roof(frame, x, y, z)
    texels = _LINEAR[rgb[r0:r1, c0:c1][lit]]
    if not face.part:
        if light.faces_away(face.normal):
            return np.zeros((0, 3), np.float32), int(mask.sum())
        return texels[keep] * light.gain(face.normal), int(mask.sum())
    gains = light.gains(part_normals(frame, face, z, x, y))
    keep &= gains > 0
    return texels[keep] * gains[keep, None].astype(np.float32), int(mask.sum())


def face_colours(rgb, light: Light, frame: Frame, faces, box):
    """One building's colour and its faces' own, from their sunlit texels
    on the roof scaled by each face's slope (`Light.gain`); returns (colour
    or None, {key: colour})."""
    lit_all, own = [], {}
    for face in faces:
        texels, covered = face_texels(rgb, light, frame, face, box)
        if len(texels) == 0:
            continue
        lit_all.append(texels)
        if len(texels) >= MIN_SAMPLES and len(texels) >= MIN_LIT_SHARE * covered:
            own[face.key] = _upper_median(texels)
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


def rebuilt_parts(tile: Tile) -> dict[str, list[Face]]:
    """The roofs roofs.py rebuilt from DOM1, as faces by LoD2 object id, in
    the file's order (the build draws them in place of the LoD2 roof): one
    LoD2 face often spans a whole block of roofs, red tiles, zinc and
    courtyards, where the rebuilt parts follow the scan's."""
    path = tile.out("dlm", f"roofs_{tile.id}.geojson")
    if not path.exists():
        return {}
    out: dict[str, list[Face]] = {}
    for f in json.loads(path.read_text()).get("features", []):
        props = f.get("properties") or {}
        geom = f.get("geometry") or {}
        if geom.get("type") != "Polygon" or "id" not in props:
            continue
        parts = out.setdefault(props["id"], [])
        z = props["z"]
        rings = [[(x, y, z) for x, y in ring] for ring in geom["coordinates"]]
        parts.append(Face(("p", len(parts)), rings, (0.0, 0.0, 1.0), props.get("surface"), True))
    return out


def surface_models(tile: Tile) -> tuple[np.ndarray | None, np.ndarray | None]:
    """The tile's 1 m surface and terrain models, where both are there."""
    dom = tile.raw_raster("dom1")
    if not (dom.exists() and tile.dgm.exists()):
        return None, None
    with rasterio.open(dom) as a, rasterio.open(tile.dgm) as b:
        return a.read(1).astype(np.float32), b.read(1).astype(np.float32)


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
    px_w = tile.size[0] / w

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

    rebuilt = rebuilt_parts(tile)
    frame = Frame(xmin, ymax, px_w, (w, h), *surface_models(tile))
    roofs, faces_out, parts_out, sampled, skipped, in_sun = {}, {}, {}, 0, 0, 0
    for oid, (metres, base) in buildings.items():
        frame.lean, frame.base = leans.get(oid, (0.0, 0.0)), base
        parts = rebuilt.get(oid)
        faces = parts or [Face(key, [ring], normal) for key, ring, normal in metres]
        box = frame.box(faces)
        if box is None:
            continue
        lit, own = face_colours(rgb, light, frame, faces, box)
        rings = [[frame.texel(*p) for p in f.rings[0]] for f in faces]
        whole = lit or median_colour(rgb, rings, box, erode)
        if whole is None:
            skipped += 1
            continue
        roofs[oid] = whole
        sampled += 1
        in_sun += lit is not None
        apart = [[*key, *c] for key, c in own.items() if _differs(c, whole)]
        if apart and parts:
            # the part's index and its level, which the build checks the
            # roofs file against (a re-baked roofs file renumbers its parts)
            parts_out[oid] = [[a[1], round(parts[a[1]].rings[0][0][2], 2), *a[2:]] for a in apart]
        elif apart:
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
            "parts_apart": sum(len(p) for p in parts_out.values()),
            "rebuilt": len(rebuilt),
            "sun": None if light.sun is None else [round(c, 3) for c in light.sun],
            "light_ratio": None if light.ratio is None else round(light.ratio, 2),
            # the roofs' lean off their outlines, metres per metre of height
            "lean": [[round(x), round(y), round(k[0], 2), round(k[1], 2)] for x, y, k in nodes],
        },
        "roofs": roofs,
        # the faces whose own colour differs from their building's
        "faces": faces_out,
        # the rebuilt roofs' parts (roofs.py) whose own colour differs from
        # their building's, as `[part, z, r, g, b]`: the part's index among
        # the building's in the roofs file and its level
        "parts": parts_out,
    }
    tile.out("dop", f"roofcolor_{tile.id}.json").write_text(json.dumps(out))
    print(
        f"{tile.id}: {sampled} roofs sampled ({in_sun} from sunlit texels), {skipped} skipped, "
        f"{out['meta']['faces_apart']} faces apart; sun {out['meta']['sun']}, "
        f"light ratio {out['meta']['light_ratio']}"
    )
