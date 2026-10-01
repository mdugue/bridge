"""DOP + LoD2 → one roof colour per building: rasterise its RoofSurface
rings, erode them inward (the orthophoto leans buildings over their
facades), take the per-channel median of at least 12 texels, in linear RGB,
keyed by CityObject id. The building bake folds it into the mesh."""

from __future__ import annotations

import json

import numpy as np
import rasterio
from PIL import Image, ImageDraw, ImageFilter

from .common import Tile

MIN_SAMPLES = 12


def srgb_to_linear(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def roof_rings(geometry: dict):
    """Each RoofSurface exterior ring (vertex indices) of one geometry."""
    return surface_rings(geometry, "RoofSurface")


def surface_rings(geometry: dict, kind: str):
    """Each exterior ring (vertex indices) of one geometry's `kind` surfaces
    (RoofSurface, GroundSurface, …)."""
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
    for surface, s in pairs:
        is_kind = s is not None and s < len(surfaces) and surfaces[s].get("type") == kind
        if is_kind and surface and surface[0]:
            yield surface[0]


def run(tile: Tile, erode: int = 5) -> None:
    city_path = tile.cityjson
    if not (tile.raw_raster("dop").exists() and city_path.exists()):
        print(f"{tile.id}: no DOP or CityJSON — skipping roof colours (palette fallback)")
        return
    with rasterio.open(tile.raw_raster("dop")) as dop:
        rgb = np.moveaxis(dop.read((1, 2, 3)), 0, -1)
    h, w = rgb.shape[:2]
    xmin, _, _, ymax = tile.bounds
    size_x, size_y = tile.size
    px_w, px_h = size_x / w, size_y / h
    city = json.loads(city_path.read_text())
    scale = city.get("transform", {}).get("scale", [1, 1, 1])
    translate = city.get("transform", {}).get("translate", [0, 0, 0])
    verts = city["vertices"]

    def to_px(vi: int) -> tuple[float, float]:
        v = verts[vi]
        x, y = v[0] * scale[0] + translate[0], v[1] * scale[1] + translate[1]
        return (x - xmin) / px_w, (ymax - y) / px_h

    roofs, sampled, skipped = {}, 0, 0
    for oid, obj in city["CityObjects"].items():
        rings = [
            [to_px(vi) for vi in ring] for g in obj.get("geometry", []) for ring in roof_rings(g)
        ]
        if not rings:
            continue
        cols = [c for ring in rings for c, _ in ring]
        rows = [r for ring in rings for _, r in ring]
        c0, r0 = max(0, int(min(cols))), max(0, int(min(rows)))
        c1, r1 = min(w, int(max(cols)) + 1), min(h, int(max(rows)) + 1)
        if c1 - c0 < 2 or r1 - r0 < 2:
            continue
        mask = Image.new("L", (c1 - c0, r1 - r0), 0)
        draw = ImageDraw.Draw(mask)
        for ring in rings:
            draw.polygon([(c - c0, r - r0) for c, r in ring], fill=255)
        if erode >= 3 and mask.width > erode and mask.height > erode:
            inset = mask.filter(ImageFilter.MinFilter(erode))
            if inset.getbbox():  # keep the inset only if it didn't erase a thin roof
                mask = inset
        texels = rgb[r0:r1, c0:c1][np.asarray(mask) > 0]
        if len(texels) < MIN_SAMPLES:
            skipped += 1
            continue
        # The upper median, like the sorted-list median it replaces.
        med = np.sort(texels, axis=0)[len(texels) // 2]
        roofs[oid] = [round(srgb_to_linear(float(c)), 4) for c in med]
        sampled += 1
    out = {
        "meta": {
            "tile": tile.id,
            "source": "DOP",
            "space": "linear-rgb",
            "erode_px": erode,
            "buildings_sampled": sampled,
            "buildings_skipped": skipped,
        },
        "roofs": roofs,
    }
    tile.out("dop", f"roofcolor_{tile.id}.json").write_text(json.dumps(out))
    print(f"{tile.id}: {sampled} roofs sampled, {skipped} skipped (too few texels)")
