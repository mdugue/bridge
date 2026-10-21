"""DOP (RGB + NIR) → a vegetation-vigour raster: NDVI = (NIR − Red) /
(NIR + Red) on one scale for every flight, clamped to 0..1 and stored ×255
in one byte, 1024² over the tile (≈2 m) — the crown colour, the meadow tint
and the urban green sample it, and the bakes that tell green from grey
(the canopy's courtyard crowns, the lawn edges, the hedges, the sheds, the
rebuilt roofs, the tram's lawn bed) read it.

The orthophotos are not calibrated reflectances: each flight's bands carry
their own gain and offset, so the same asphalt reads NDVI −0.30 in Dresden,
−0.15 in Leipzig, −0.07 in Hamburg and +0.02 in Unna, and the same mown
lawn 0.33, 0.12, 0.14 and 0.22. Every threshold downstream was tuned on
Dresden's scale; on Leipzig's hardly a courtyard reached the lawn edges'
0.3 (1–4 % of the OSM lawns a tile did, against Dresden's 18–82 %). So the raw index is mapped
onto Dresden's scale by two materials the site shows everywhere and that
hardly change between flights: the carriageways (`ways.carriageways`) and
the mown lawns (OSM grass, meadow, village green, park, garden), both
where the surface model stands below LOW_M — no car, crown or roof over
them. Their medians, pooled over the site's tiles (one flight, one scale,
no seam at a tile edge), go to REF_ROAD and REF_LAWN, Dresden's own:
Dresden's raster stays as it was. A site with fewer than MIN_SAMPLES
texels of either keeps the raw index.

A DOP without an infrared band (Bavaria's open DOP40 is RGB only) gets the
same raster from its visible bands: the Green Leaf Index GLI = (2G − R − B)
/ (2G + R + B), calibrated by the same two anchors (without them mapped by
a line fitted where both exist, `GLI_SCALE`, `GLI_OFFSET`: Unna's two
summer DOP tiles, NRW's RGBI, r ≈ 0.7 against the NDVI). It tells green
from grey well and vigour from colour less well — the honest second best,
not an NDVI."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize

from . import step_cache, ways
from .common import Tile, save_grey_png
from .osm import read_osm

# GLI → NDVI scale, fitted on NRW's summer RGBI (see the module docstring)
GLI_SCALE = 3.3
GLI_OFFSET = 0.14
# Dresden's flight: the median raw NDVI on its carriageways and its mown
# lawns, pooled over its 15 tiles (2026-10-20). Every site is mapped onto it.
REF_ROAD = -0.298
REF_LAWN = 0.332
LAWNS = "landuse IN ('grass', 'meadow', 'village_green') OR leisure IN ('park', 'garden')"
LOW_M = 0.5  # an anchor texel's surface model at most this far above the ground
MIN_SAMPLES = 2000  # texels of each anchor over the site, or no calibration
MIN_SPREAD = 0.05  # lawn − road of the raw index, or no calibration
KEEP = 50_000  # anchor texels a tile keeps (a fixed draw) for the site's median


@dataclass(frozen=True)
class Anchors:
    """A tile's raw index on its carriageways and on its lawns."""

    road: np.ndarray
    lawn: np.ndarray


_ANCHORS: dict[tuple[Path, Path | None, int], Anchors | None] = {}


def gli_raster(red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> np.ndarray:
    """The visible-band stand-in for the NDVI, on its 0..255 scale."""
    return _byte(_gli(red, green, blue))


def _gli(red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> np.ndarray:
    gli = (2 * green - red - blue) / (2 * green + red + blue + 1.0)
    return GLI_SCALE * gli + GLI_OFFSET


def _byte(index: np.ndarray) -> np.ndarray:
    return (np.clip(index, 0.0, 1.0) * 255.0).astype(np.uint8)


def raw_index(tile: Tile, px: int) -> tuple[np.ndarray, np.ndarray]:
    """The DOP's unclamped NDVI (its GLI where it has no infrared band) on a
    px × px grid, and where the DOP has data."""
    with rasterio.open(tile.raw_raster("dop")) as dop:
        bands = [1, 2, 3, 4] if dop.count >= 4 else [1, 2, 3]
        a = dop.read(bands, out_shape=(len(bands), px, px), resampling=Resampling.bilinear)
    a = a.astype(np.float64)
    seen = a.sum(axis=0) > 0
    if len(bands) == 4:
        return (a[3] - a[0]) / (a[3] + a[0] + 1.0), seen
    return _gli(a[0], a[1], a[2]), seen


def _low(tile: Tile, px: int) -> np.ndarray:
    """Where the surface model stands within LOW_M of the ground (all of the
    tile without one)."""
    if not tile.raw_raster("dom1").exists():
        return np.ones((px, px), dtype=bool)
    with rasterio.open(tile.raw_raster("dom1")) as dom, rasterio.open(tile.dgm) as dgm:
        top = dom.read(1, out_shape=(px, px)).astype(np.float64)
        ground = dgm.read(1, out_shape=(px, px)).astype(np.float64)
    return top - ground < LOW_M


def _burn(geoms, px: int, tile: Tile) -> np.ndarray:
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    mask = np.zeros((px, px), dtype=np.uint8)
    if geoms:
        rasterize(((g, 1) for g in geoms), out=mask, transform=tile.transform(px))
    return mask == 1


def _draw(values: np.ndarray) -> np.ndarray:
    if len(values) <= KEEP:
        return values
    return np.random.default_rng(0).choice(values, KEEP, replace=False)


def tile_anchors(tile: Tile, px: int = 1024) -> Anchors | None:
    """The tile's raw index on its low carriageways and its low lawns (None
    without a DOP of three bands or an OSM extract); once per process."""
    key = (tile.raw_raster("dop"), tile.osm, px)
    return step_cache.memo(_ANCHORS, key, lambda: _measure(tile, px))


def _measure(tile: Tile, px: int) -> Anchors | None:
    if not tile.raw_raster("dop").exists() or tile.osm_extract() is None:
        return None
    with rasterio.open(tile.raw_raster("dop")) as dop:
        if dop.count < 3:
            return None
    index, seen = raw_index(tile, px)
    low = _low(tile, px) & seen
    lawn = _burn(read_osm(tile, "multipolygons", LAWNS, ["landuse"])[0], px, tile) & low
    road = _burn(ways.carriageways(tile), px, tile) & low & ~lawn
    return Anchors(road=_draw(index[road]), lawn=_draw(index[lawn]))


def scale(anchors: Sequence[Anchors | None]) -> tuple[float, float] | None:
    """The site's raw (road, lawn) medians, pooled over its tiles' anchors —
    or None where either has fewer than MIN_SAMPLES texels, or they lie
    closer than MIN_SPREAD."""
    found = [a for a in anchors if a is not None]
    road = np.concatenate([a.road for a in found]) if found else np.zeros(0)
    lawn = np.concatenate([a.lawn for a in found]) if found else np.zeros(0)
    if len(road) < MIN_SAMPLES or len(lawn) < MIN_SAMPLES:
        return None
    r, g = float(np.median(road)), float(np.median(lawn))
    return (r, g) if g - r >= MIN_SPREAD else None


def calibrate(index: np.ndarray, site: tuple[float, float] | None) -> np.ndarray:
    """The raw index on Dresden's scale (as it is without a site scale), as
    the raster's byte."""
    if site is None:
        return _byte(index)
    road, lawn = site
    return _byte(REF_ROAD + (index - road) * (REF_LAWN - REF_ROAD) / (lawn - road))


def run(tile: Tile, site: Sequence[Tile] = (), px: int = 1024) -> None:
    """Writes `ndvi_<tile>.png`, calibrated by the anchors of `site` (the
    site's tiles; the tile alone when empty)."""
    if not tile.raw_raster("dop").exists():
        print(f"{tile.id}: no DOP — skipping NDVI (crowns keep the hash sage)")
        return
    with rasterio.open(tile.raw_raster("dop")) as dop:
        bands = dop.count
    if bands < 3:
        print(f"{tile.id}: the DOP has {bands} band(s) — skipping NDVI")
        return
    tiles = [t for t in site if t.raw_raster("dop").exists()] or [tile]
    found = scale([tile_anchors(t, px) for t in tiles])
    index, _ = raw_index(tile, px)
    save_grey_png(tile.out("dlm", f"ndvi_{tile.id}.png"), calibrate(index, found))
    kind = "NDVI" if bands >= 4 else "vegetation index from RGB (GLI)"
    if found is None:
        print(f"{tile.id}: {kind} {px}², raw scale (too few carriageway or lawn texels)")
        return
    road, lawn = found
    print(
        f"{tile.id}: {kind} {px}², carriageways {road:+.2f} → {REF_ROAD:+.2f}, "
        f"lawns {lawn:+.2f} → {REF_LAWN:+.2f}"
    )
