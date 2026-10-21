"""DOP + LoD2 → each building's roof colour and each roof face's, keyed by
CityObject id; the building bake folds them into the mesh.

A face's colour is read from its texels in sun only (dop_light.py): the
orthophoto is flown in sun, and a face turned from it, or one a neighbour
shades, reads several times darker and bluer than its tiles are — one
median over a whole roof painted the Frauenkirche's dome slate grey, half
the Altstadt's red roofs brown and a mansard's red slopes the grey of its
zinc top. Each sunlit texel is scaled by its face's slope to how a flat
roof in the same sun reads it (the sun is found from the image's shadows),
so a roof's faces turned to and from the sun come out alike. The sun is
searched along the flight day's solar path (the fetch reads the day off
the provider's metadata, dop_light.flight_days); a tile whose shadows
cannot fix it (dop_light.MIN_SUN_CONTRAST) takes the sun its flight's
other tiles agree on, and an overcast flight (dop_light.OVERCAST_RATIO,
Meißen's) gets no slope correction at all. Per face and
per building: rasterise the RoofSurface rings, erode them inward (the
orthophoto leans buildings over their facades), take the per-channel
median of at least 12 sunlit texels, in linear RGB.

The photo is first taken to Dresden's colour balance (dop_balance.py):
a flight's cast — Leipzig's cyan, München's yellow — read off its sunlit
carriageways is scaled out of every texel, so a grey roof is grey in every
city and the shadows are found in the balanced photo.

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
the roofs file and its level `z`; and `scan` and `gaps`, the roofs the
build appends to LoD2's — the laser scan's sheds (`smallbuild_<tile>`) and
the buildings and roofs on posts the surface model shows beyond it
(`structures_<tile>`) — each read like a face at its measured top (a pent
shed's by its corners) from its sunlit texels alone, as `[index, z, r, g,
b]`, the feature's index in its file and its `z`. Before, every shed and
missing building got the palette's slate (Dresden's 6 625 sheds)."""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFilter
from pyproj import Transformer
from rasterio.enums import Resampling
from scipy.ndimage import uniform_filter

from . import dop_balance
from .common import Tile
from .dop_lean import LEAN_MIN_HEIGHT, Sample, building_lean, fit_leans, lean_map, reach_px
from .dop_light import (
    GAIN_MAX,
    GAIN_MIN,
    MIN_SUN_CONTRAST,
    OVERCAST_RATIO,
    SUN_RES_M,
    SunFit,
    estimate_sun,
    flight_days,
    incidence_gain,
    light_ratio,
    luminance,
    pooled_sun,
    roof_surface_model,
    shadow_mask,
    solar_path,
    solar_position,
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
    the sun with its share of the light, when they could be read. Under an
    overcast sky (`ratio` under OVERCAST_RATIO) the light is as good as
    diffuse: no face is scaled by its slope, none lies in its own shadow
    (the sun still guides the lean fit, dop_lean.py). `lean_sun`: the sun
    the lean fit shades the roofs by where `sun` is None — the tile's own
    fit, too unsure to scale a face by: the lean asks only which side of
    a tall roof reads the brighter, and its nodes are what the buildings
    around agree on (Meißen's strips lean 0.04–0.19 m/m under its 1.98
    fit, smooth across each strip)."""

    def __init__(
        self,
        shadow: np.ndarray,
        sun=None,
        ratio: float | None = None,
        source: str | None = None,
        lean_sun=None,
    ):
        self.shadow = shadow
        self.sun = sun_vector(*sun) if sun else None
        self.lean_sun = self.sun or (sun_vector(*lean_sun) if lean_sun else None)
        self.ratio = ratio
        # where the sun came from: the tile's own shadows, its flight's
        # ("pooled"), or None
        self.source = source if sun else None
        self.overcast = ratio is not None and ratio < OVERCAST_RATIO

    def gain(self, normal) -> float:
        if self.overcast:
            return 1.0
        return incidence_gain(normal, self.sun, self.ratio)

    def gains(self, normals: np.ndarray) -> np.ndarray:
        """`gain` for each of `normals` (n × 3), 0 where it `faces_away`."""
        if self.sun is None or self.overcast:
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
        if self.sun is None or self.overcast:
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


def _face_mask(frame: Frame, face: Face, box) -> tuple[np.ndarray, np.ndarray]:
    """The face's texels in `box` a texel in from its drawn edge (all of
    them where that erases them), and its core two texels in: what a colour
    of its own is read from. At the edge the image may show the eave, the
    facade or the ground, and a face too narrow for a core reads none of
    its own (3–4 % of the faces read apart were such slivers, read from
    their edge alone: a parapet's coping, a ridge strip)."""
    c0, r0, c1, r1 = box
    drawn = Image.new("L", (c1 - c0, r1 - r0), 0)
    draw = ImageDraw.Draw(drawn)
    for i, ring in enumerate(face.rings):
        pts = [frame.texel(*p) for p in ring]
        draw.polygon([(c - c0, r - r0) for c, r in pts], fill=0 if i else 255)
    mask = drawn
    if drawn.width > 3 and drawn.height > 3:
        inset = drawn.filter(ImageFilter.MinFilter(3))
        if inset.getbbox():
            mask = inset
    if drawn.width > 5 and drawn.height > 5:
        core = np.asarray(drawn.filter(ImageFilter.MinFilter(5))) > 0
    else:
        core = np.zeros((drawn.height, drawn.width), bool)
    return np.asarray(mask) > 0, core


@dataclass
class FaceRead:
    """A face's sunlit texels on its roof (linear RGB, scaled by its
    slope's gain), how many texels it covers, which of the texels lie in
    its core (`_face_mask`) and how many its core covers."""

    texels: np.ndarray
    covered: int
    core: np.ndarray
    core_covered: int


def face_texels(rgb, light: Light, frame: Frame, face: Face, box) -> FaceRead:
    """A face's read (`FaceRead`), its texels scaled by `Light.gain`."""
    c0, r0, c1, r1 = box
    mask, core = _face_mask(frame, face, box)
    lit = mask & ~light.shadow[r0:r1, c0:c1]
    rows, cols = np.nonzero(lit)
    z = float(np.mean([p[2] for p in face.rings[0]]))
    x, y = frame.place(rows + r0, cols + c0, z)
    keep = on_the_roof(frame, x, y, z)
    texels = _LINEAR[rgb[r0:r1, c0:c1][lit]]
    in_core = core[rows, cols]
    covered, core_covered = int(mask.sum()), int(core.sum())
    if not face.part:
        if light.faces_away(face.normal):
            return FaceRead(np.zeros((0, 3), np.float32), covered, np.zeros(0, bool), core_covered)
        return FaceRead(
            texels[keep] * light.gain(face.normal), covered, in_core[keep], core_covered
        )
    gains = light.gains(part_normals(frame, face, z, x, y))
    keep &= gains > 0
    return FaceRead(
        texels[keep] * gains[keep, None].astype(np.float32), covered, in_core[keep], core_covered
    )


def face_colours(rgb, light: Light, frame: Frame, faces, box):
    """One building's colour and its faces' own, from their sunlit texels
    on the roof scaled by each face's slope (`Light.gain`); returns (colour
    or None, {key: colour}). A face's own colour is read from its core
    alone. Touching faces of one plane (`_planes`) are read as one: a flat
    roof the dataset splits into pieces is one roof, and each piece read
    alone took the colour of what stands on it (Leipzig's department
    stores read as pyramids of three shades)."""
    reads = [face_texels(rgb, light, frame, face, box) for face in faces]
    lit_all = [r.texels for r in reads if len(r.texels)]
    own = {}
    for group in _planes(faces):
        parts = [reads[i].texels[reads[i].core] for i in group]
        texels = np.concatenate(parts) if parts else np.zeros((0, 3))
        covered = sum(reads[i].core_covered for i in group)
        if len(texels) >= MIN_SAMPLES and len(texels) >= MIN_LIT_SHARE * covered:
            colour = _upper_median(texels)
            for i in group:
                own[faces[i].key] = colour
    joined = np.concatenate(lit_all) if lit_all else np.zeros((0, 3))
    return (_upper_median(joined) if len(joined) >= MIN_SAMPLES else None), own


# Two faces lie in one plane when their normals differ by less than
# PLANE_NORMAL (per component) and their planes by less than PLANE_M; they
# touch when a corner of one lies within TOUCH_M of a corner of the other.
PLANE_NORMAL = 0.05
PLANE_M = 0.3
TOUCH_M = 0.05


def _planes(faces) -> list[list[int]]:
    """The faces grouped into touching pieces of one plane, by index; a
    rebuilt part stands alone."""
    root = list(range(len(faces)))

    def find(i):
        while root[i] != i:
            root[i] = root[root[i]]
            i = root[i]
        return i

    lod2 = [i for i, f in enumerate(faces) if not f.part]
    corners = [np.array([p for ring in faces[i].rings for p in ring], float) for i in lod2]
    normals = np.array([faces[i].normal for i in lod2], float).reshape(-1, 3)
    offsets = np.array([np.dot(n, c[0]) for n, c in zip(normals, corners, strict=True)])
    coplanar = (np.abs(normals[:, None] - normals[None]).max(axis=2) < PLANE_NORMAL) & (
        np.abs(offsets[:, None] - offsets[None]) < PLANE_M
    )
    for a, b in zip(*np.nonzero(np.triu(coplanar, 1)), strict=True):
        if find(lod2[a]) == find(lod2[b]):
            continue
        gaps = np.abs(corners[a][:, None, :] - corners[b][None, :, :]).max(axis=2)
        if gaps.min() < TOUCH_M:
            root[find(lod2[b])] = find(lod2[a])
    groups: dict[int, list[int]] = {}
    for i in range(len(faces)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def _differs(a, b) -> bool:
    return (
        max(abs(linear_to_srgb8(x) - linear_to_srgb8(y)) for x, y in zip(a, b, strict=True))
        > FACE_STEP
    )


def read_light(
    tile: Tile, dop, rgb: np.ndarray, faces, lut: np.ndarray, site: Sequence[Tile] = ()
) -> Light:
    """The tile's shadows, and the flight's sun (`flight_sun`); `rgb` is
    balanced, and the coarser reads of `dop` are put through `lut`."""
    shadow = shadow_mask(rgb)
    xmin, ymin, xmax, ymax = tile.bounds
    metre = (int(round((xmax - xmin) / 1.0)), int(round((ymax - ymin) / 1.0)))
    small = np.moveaxis(
        dop.read((1, 2, 3), out_shape=(3, metre[1], metre[0]), resampling=Resampling.average), 0, -1
    )
    small = dop_balance.balanced(small, lut)
    ratio = light_ratio(small, shadow_mask(small))
    sun, source = flight_sun(tile, site, lut, dop, faces)
    own = sun_reading(tile, lut, dop, faces)
    guess = (own.fit.az, own.fit.el) if own is not None and own.fit is not None else None
    return Light(shadow, sun, ratio, source, lean_sun=guess)


@dataclass
class SunReading:
    """A tile's shadows read for the flight's sun: the days it was flown
    (the fetch's, dop_light.flight_days), where it lies (lon, lat), its own
    fit, and its agreement every PATH_STEP minutes of those days' path
    (dop_light.pooled_sun)."""

    days: list
    lonlat: tuple[float, float]
    fit: SunFit | None
    counts: dict | None

    @property
    def sure(self) -> bool:
        return self.fit is not None and self.fit.contrast >= MIN_SUN_CONTRAST


_READINGS: dict[tuple, SunReading | None] = {}


def roof_faces(city: dict) -> list[list[tuple[float, float, float]]]:
    """Every RoofSurface ring of the CityJSON, in metres."""
    scale = city.get("transform", {}).get("scale", [1, 1, 1])
    translate = city.get("transform", {}).get("translate", [0, 0, 0])
    verts = city["vertices"]
    return [
        [tuple(verts[vi][k] * scale[k] + translate[k] for k in range(3)) for vi in ring]
        for obj in city["CityObjects"].values()
        for g in obj.get("geometry", [])
        for ring in roof_rings(g)
    ]


def sun_reading(tile: Tile, lut: np.ndarray, dop=None, faces=None) -> SunReading | None:
    """The tile's `SunReading`, once per process (a tile whose own fit is
    not sure reads its flight's other tiles); None without the DGM to cast
    the roofs' shadows on, the orthophoto or the LoD2."""
    key = (tile.raw, tile.id)
    if key not in _READINGS:
        _READINGS[key] = _read_sun(tile, lut, dop, faces)
    return _READINGS[key]


def _read_sun(tile: Tile, lut: np.ndarray, dop, faces) -> SunReading | None:
    if not tile.dgm.exists():
        return None
    if faces is None:
        if not tile.cityjson.exists():
            return None
        faces = roof_faces(json.loads(tile.cityjson.read_text()))
    if dop is None:
        if not tile.raw_raster("dop").exists():
            return None
        with rasterio.open(tile.raw_raster("dop")) as opened:
            return _read_sun(tile, lut, opened, faces)
    xmin, ymin, xmax, ymax = tile.bounds
    n = (int((xmax - xmin) / SUN_RES_M), int((ymax - ymin) / SUN_RES_M))
    coarse = np.moveaxis(
        dop.read((1, 2, 3), out_shape=(3, n[1], n[0]), resampling=Resampling.average), 0, -1
    )
    coarse = dop_balance.balanced(coarse, lut)
    with rasterio.open(tile.dgm) as g:
        dgm = g.read(1, out_shape=(n[1], n[0]), resampling=Resampling.average, masked=True)
    # a gap in the DGM would read as a pit the roofs cast shadows into
    dgm = dgm.filled(np.ma.median(dgm) if dgm.count() else 0).astype(np.float32)
    dsm, roofs = roof_surface_model(
        dgm, faces, lambda x, y: ((x - xmin) / SUN_RES_M, (ymax - y) / SUN_RES_M)
    )
    lonlat = Transformer.from_crs(tile.epsg, 4326, always_xy=True).transform(
        (xmin + xmax) / 2, (ymin + ymax) / 2
    )
    days = flight_days(tile.raw, tile.id)
    path = solar_path(days, *lonlat) if days else None
    counts: dict | None = {} if path else None
    fit = estimate_sun(shadow_mask(coarse), dsm, roofs, path=path, counts=counts)
    return SunReading(days, lonlat, fit, counts)


def flight_sun(
    tile: Tile, site: Sequence[Tile], lut: np.ndarray, dop=None, faces=None
) -> tuple[tuple[float, float] | None, str | None]:
    """The sun (azimuth, elevation) the tile's roofs are read in, and where
    it came from: its own shadows' fit where it is sure (`own`), else the
    sun its flight's tiles — the site's flown on the same days, with sure
    fits of their own — agree on at once (`pooled`, at the tile's own
    place), else none (no slope correction: a guessed sun scaled faces
    wrongly, and dropped lit ones as turned from it)."""
    own = sun_reading(tile, lut, dop, faces)
    if own is None:
        return None, None
    if own.sure:
        return (own.fit.az, own.fit.el), "own"
    if not own.days:
        return None, None
    peers = [t for t in site if t.id != tile.id and flight_days(t.raw, t.id) == own.days]
    readings = [own, *(sun_reading(t, lut) for t in peers)]
    when = pooled_sun([r.counts for r in readings if r and r.sure and r.counts])
    if when is None:
        return None, None
    return solar_position(when, *own.lonlat), "pooled"


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
    the tall buildings' roof shading; none without a sun to shade by
    (`Light.lean_sun`). `buildings`: {id: ([(key, ring in metres,
    normal)], base height)}."""
    if light.lean_sun is None:
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
        grid = lean_map(lum, drawn, light.lean_sun, reach)
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


# The roofs the build appends to LoD2's that are read too: the laser scan's
# sheds (small_buildings.py) and the buildings and roofs on posts the
# surface model shows beyond LoD2 (structures.py); a column's head takes its
# wall's tint and a relief its landmark's roof, so neither is read.
APPENDED = {"scan": "smallbuild", "gaps": "structures"}
APPENDED_KINDS = ("building", "roof")


def _polygons(geometry: dict) -> list[list]:
    """A Polygon's or MultiPolygon's polygons, each its rings of (x, y)."""
    if geometry.get("type") == "Polygon":
        return [geometry["coordinates"]]
    if geometry.get("type") == "MultiPolygon":
        return list(geometry["coordinates"])
    return []


def appended_face(props: dict, geometry: dict) -> tuple[list[Face], float] | None:
    """One appended roof as faces to read, and its foot (the lean's base):
    its outline at its top (`z` + `h`, a pent shed's corners at `z` +
    `hc`, its normal from them), or None where it has no outline."""
    polys = _polygons(geometry)
    if not polys or "z" not in props or "h" not in props:
        return None
    z, top = props["z"], props["z"] + props["h"]
    corners = props.get("hc") or []
    faces = []
    for rings in polys:
        outline = [[(x, y, top) for x, y, *_ in ring] for ring in rings]
        normal = (0.0, 0.0, 1.0)
        if len(corners) >= 3:
            # the corners in the ring's order, its closing point the first
            outline[0] = [
                (x, y, z + corners[k % len(corners)]) for k, (x, y, _) in enumerate(outline[0])
            ]
            normal = ring_normal(range(len(outline[0])), outline[0].__getitem__)
        faces.append(Face(("a", 0), outline, normal))
    return faces, z


def appended_roofs(tile: Tile) -> dict[str, list[tuple[int, float, list[Face], float]]]:
    """Per kind (`APPENDED`) the appended roofs to read: (the feature's index
    in its file, its `z` — the build checks both —, its faces, its foot)."""
    out: dict[str, list] = {}
    for key, name in APPENDED.items():
        path = tile.data / "dlm" / f"{name}_{tile.id}.geojson"
        out[key] = []
        if not path.exists():
            continue
        for i, f in enumerate(json.loads(path.read_text()).get("features", [])):
            props = f.get("properties") or {}
            if key == "gaps" and props.get("kind") not in APPENDED_KINDS:
                continue
            read = appended_face(props, f.get("geometry") or {})
            if read is not None:
                out[key].append((i, props["z"], *read))
    return out


def appended_colours(rgb, light: Light, frame: Frame, nodes, roofs) -> list[list[float]]:
    """The appended roofs' colours, `[index, z, r, g, b]`, from their sunlit
    texels alone (`face_colours`): a shed in a crown's or a house's shadow
    reads the crown or the shade, so it keeps the palette's roof. Each is
    shifted by the lean of the nearest node (they are too low or too few
    to fit their own)."""
    out = []
    for index, z, faces, base in roofs:
        ring = faces[0].rings[0]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        frame.lean, frame.base = building_lean(nodes, cx, cy, None), base
        box = frame.box(faces)
        if box is None:
            continue
        lit, _ = face_colours(rgb, light, frame, faces, box)
        if lit is not None:
            out.append([index, z, *lit])
    return out


def surface_models(tile: Tile) -> tuple[np.ndarray | None, np.ndarray | None]:
    """The tile's 1 m surface and terrain models, where both are there."""
    dom = tile.raw_raster("dom1")
    if not (dom.exists() and tile.dgm.exists()):
        return None, None
    with rasterio.open(dom) as a, rasterio.open(tile.dgm) as b:
        return a.read(1).astype(np.float32), b.read(1).astype(np.float32)


def run(tile: Tile, site: Sequence[Tile] = (), erode: int = 5) -> None:
    """Writes `roofcolor_<tile>.json`, the photo balanced by the cast of
    `site` (the site's tiles; the tile alone when empty)."""
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

    balance = dop_balance.gains(site or [tile])
    lut = dop_balance.table(balance)
    with rasterio.open(tile.raw_raster("dop")) as dop:
        rgb = dop_balance.balanced(np.moveaxis(dop.read((1, 2, 3)), 0, -1), lut)
        light = read_light(tile, dop, rgb, roof_faces(city), lut, site)
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
    appended = {
        key: appended_colours(rgb, light, frame, nodes, roofs)
        for key, roofs in appended_roofs(tile).items()
    }
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
            # the appended roofs read (`scan`, `gaps`)
            "scan_sampled": len(appended["scan"]),
            "gaps_sampled": len(appended["gaps"]),
            "sun": None if light.sun is None else [round(c, 3) for c in light.sun],
            # the unsure fit the lean was found by, where no sun is sure
            "lean_sun": (
                None
                if light.sun is not None or light.lean_sun is None
                else [round(c, 3) for c in light.lean_sun]
            ),
            # the days the photo was flown (the fetch's), and where the sun
            # came from: the tile's own shadows, its flight's ("pooled")
            "flight": [d.isoformat() for d in flight_days(tile.raw, tile.id)],
            "sun_from": light.source,
            "light_ratio": None if light.ratio is None else round(light.ratio, 2),
            "overcast": light.overcast,
            # the per-channel factors (linear RGB) that took the flight's
            # cast out (dop_balance.py)
            "balance": [round(float(k), 3) for k in balance],
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
        # the roofs the build appends, read alike: the laser scan's sheds
        # (`smallbuild_<tile>`) and the structures beyond LoD2 that are a
        # building or a roof on posts (`structures_<tile>`), as `[index, z,
        # r, g, b]` — the feature's index in its file and its `z`, which the
        # build checks (a re-baked file renumbers them)
        "scan": appended["scan"],
        "gaps": appended["gaps"],
    }
    tile.out("dop", f"roofcolor_{tile.id}.json").write_text(json.dumps(out))
    print(
        f"{tile.id}: {sampled} roofs sampled ({in_sun} from sunlit texels), {skipped} skipped, "
        f"{out['meta']['faces_apart']} faces apart, {len(appended['scan'])} sheds and "
        f"{len(appended['gaps'])} structures read; sun {out['meta']['sun']}, "
        f"light ratio {out['meta']['light_ratio']}"
    )
