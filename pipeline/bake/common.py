"""What every bake shares: the tile, the canonical raw layout, reading vector
layers without geopandas, and the GeoJSON the viewer reads."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyogrio.raw
import rasterio
import shapely
import shapely.ops
from PIL import Image
from rasterio.transform import from_bounds

OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"

# The Basis-DLM layers (AdV Shape profile) the bakes read: land cover and
# tree rows (landcover, canopy), rails, ballast and bridges (rail). A fetch
# adapter that can pick members of a statewide package takes only these.
DLM_LAYERS = (
    "veg01_f",
    "veg02_f",
    "veg03_f",
    "veg04_l",
    "sie02_f",
    "gew01_f",
    "gew01_l",
    "gew02_f",
    "ver01_f",
    "ver01_l",
    "ver02_l",
    "ver03_f",
    "ver03_l",
    "ver06_f",
    "ver06_l",
    "sie03_p",
)


def dlm_complete(dlm: Path) -> bool:
    """Whether every layer the bakes read is in `dlm` (an interrupted fetch
    may have left some): the fetch, the bakes and `bun run site` agree."""
    return all((dlm / f"{layer}{ext}").exists() for layer in DLM_LAYERS for ext in (".shp", ".dbf"))


DLM_MEMBERS = rf"(^|/)({'|'.join(DLM_LAYERS)})\.(shp|shx|dbf|prj|cpg)$"


@dataclass(frozen=True)
class Products:
    """What the site's provider publishes openly (sites/providers.ts)."""

    dom: bool
    dop: str | None  # "rgbi", "rgb" or None
    dlm: bool
    lsc: bool = False  # the adapter fetches a laser scan (opt-in: `--lsc`)


@dataclass(frozen=True)
class TreeCadastre:
    """The site's street-tree register (sites/<id>.ts `treeCadastre`): its
    entry in cadastre.py and its licence's credit line."""

    id: str
    credit: str


@dataclass(frozen=True)
class Tile:
    """One site tile: its id (the file-name key), extent and CRS, and where
    its inputs and outputs live. `raw` is the provider's raw folder, shared
    by every site of that provider (tile ids are coordinates, so they never
    collide): `<raw>/{dom1,dop}/<tile>.tif`, `<raw>/dlm/*.shp` (AdV Shape
    profile). `data` is the site's folder, `data/<site>/`. `osm` is the
    site's OpenStreetMap extract, `credit` the provider's credit line (the
    licence terms of its products, sites/providers.ts)."""

    id: str
    bounds: tuple[float, float, float, float]
    epsg: int
    raw: Path
    data: Path
    osm: Path | None = None
    products: Products = Products(dom=True, dop="rgbi", dlm=True)
    credit: str = ""
    tree_cadastre: TreeCadastre | None = None
    # the site's traffic-count source (traffic_sources.py), or None
    traffic: str | None = None
    # whether the site measures Mapillary's panoramas: the facade readings
    # and shopfronts (facades.py, shopfronts.py)
    mapillary: bool = False
    # whether it also adds Mapillary's lamps and bins (mapillary.py)
    mapillary_objects: bool = False

    @property
    def size(self) -> tuple[float, float]:
        xmin, ymin, xmax, ymax = self.bounds
        return xmax - xmin, ymax - ymin

    def transform(self, px: int):
        """The affine transform of a px × px raster over the tile."""
        return from_bounds(*self.bounds, px, px)

    def raw_raster(self, product: str) -> Path:
        return self.raw / product / f"{self.id}.tif"

    @property
    def dlm(self) -> Path:
        return self.raw / "dlm"

    @property
    def dgm(self) -> Path:
        return self.data / "dgm" / f"dgm1_{self.id}_tiff" / f"dgm1_{self.id}.tif"

    @property
    def cityjson(self) -> Path:
        return self.data / "cityjson" / f"lod2_{self.id}.city.json"

    def out(self, folder: str, name: str) -> Path:
        path = self.data / folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def has_dlm(self, what: str) -> bool:
        """Whether the Basis-DLM is there; if not, say what is skipped. A step
        without it leaves its committed files alone rather than emptying them."""
        if not self.products.dlm:
            print(f"{self.id}: the provider publishes no Basis-DLM — skipping {what}")
            return False
        if not dlm_complete(self.dlm):
            print(f"{self.id}: no complete Basis-DLM under {self.dlm} — skipping {what}")
            return False
        return True

    @property
    def landcover_credit(self) -> str:
        """The credit of what the class raster is drawn from: the provider's
        Basis-DLM, or without one OpenStreetMap."""
        return self.credit if self.products.dlm else OSM_ATTRIBUTION

    def classes(self, tile_id: str | None = None) -> np.ndarray | None:
        """The committed class raster (lib/city/landcover.ts ids, row 0 =
        north) of this tile or of `tile_id` beside it; None when it is not
        baked yet. Read with `value_at` / `pixel_of`."""
        path = self.data / "dlm" / f"landcover_{tile_id or self.id}.png"
        return np.asarray(Image.open(path).convert("L")) if path.exists() else None

    def neighbours(self) -> list[tuple[str, tuple[float, float, float, float]]]:
        """Every committed tile of the site (its DGM on disk), this one
        included, as (id, bounds): what a seam-aware step reads beyond its
        edge."""
        found = []
        for tif in sorted((self.data / "dgm").glob("dgm1_*_tiff/dgm1_*.tif")):
            tid = tif.stem.removeprefix("dgm1_")
            with rasterio.open(tif) as ds:
                b = ds.bounds
            found.append((tid, (b.left, b.bottom, b.right, b.top)))
        return found

    def osm_extract(self) -> Path | None:
        return self.osm if self.osm is not None and self.osm.exists() else None


def owns(bounds: tuple[float, float, float, float], x: float, y: float) -> bool:
    """Whether a tile owns the point: west and south edges in, east and north
    out, so a point on a seam belongs to exactly one tile (the viewer's
    `ownsPoint`, lib/city/tileset.ts)."""
    xmin, ymin, xmax, ymax = bounds
    return xmin <= x < xmax and ymin <= y < ymax


def overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    """Whether two extents overlap (touching edges do not)."""
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def pixel_of(
    shape: tuple[int, ...], bounds: tuple[float, float, float, float], x: float, y: float
) -> tuple[int, int] | None:
    """The (row, column) of a raster of `shape` laid over `bounds` (row 0 =
    north) under a point; None off it (the half-open extent of `owns`)."""
    if not owns(bounds, x, y):
        return None
    xmin, ymin, xmax, ymax = bounds
    h, w = shape[0], shape[1]
    c = min(int((x - xmin) / (xmax - xmin) * w), w - 1)
    r = min(int((ymax - y) / (ymax - ymin) * h), h - 1)
    return r, c


def value_at(
    raster: np.ndarray, bounds: tuple[float, float, float, float], x: float, y: float
) -> int | None:
    """The raster's value under a point (see `pixel_of`); None off it."""
    at = pixel_of(raster.shape, bounds, x, y)
    return None if at is None else int(raster[at])


def save_grey_png(path: Path, raster: np.ndarray) -> None:
    """A single-band 8-bit PNG, as the viewer inflates it byte-exact
    (lib/city/png-raster.ts). The array must already be 2-D uint8: Pillow
    drops the `mode=` override in 13, and a wider dtype must fail here, not
    be reinterpreted."""
    if raster.dtype != np.uint8 or raster.ndim != 2:
        raise TypeError(f"{path.name}: want a 2-D uint8 raster, got {raster.dtype} {raster.shape}")
    Image.fromarray(np.ascontiguousarray(raster)).save(path, optimize=True)


def read_layer(
    path: Path,
    bbox: tuple[float, float, float, float],
    where: str | None = None,
    columns: list[str] | None = None,
    layer: str | None = None,
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Features intersecting `bbox` (not clipped) as shapely geometries plus
    their attribute columns. Missing file → nothing."""
    if not path.exists():
        return np.array([], dtype=object), {}
    # An attribute filter only sees the columns that are read: with a
    # `where`, read them all unless the caller names some.
    wanted = columns if columns is not None else (None if where else [])
    meta, _, wkb, fields = pyogrio.raw.read(
        path, layer=layer, bbox=bbox, where=where, columns=wanted
    )
    geoms = shapely.from_wkb(wkb) if wkb is not None else np.array([], dtype=object)
    return geoms, dict(zip(meta["fields"], fields, strict=True))


def column(fields: dict[str, np.ndarray], name: str, geoms: np.ndarray) -> list:
    """One attribute column, or Nones when the layer has no such field —
    never shorter than the geometries it is zipped with."""
    values = fields.get(name)
    return list(values) if values is not None else [None] * len(geoms)


def crs_member(epsg: int) -> dict:
    return {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{epsg}"}}


def round_coords(coords, digits: int = 2):
    """Nested coordinate lists rounded (the committed files keep centimetres)."""
    if coords and isinstance(coords[0], (int, float)):
        return [round(float(c), digits) for c in coords[:2]]
    return [round_coords(c, digits) for c in coords]


def feature(geometry: dict, properties: dict | None = None) -> dict:
    return {"type": "Feature", "properties": properties or {}, "geometry": geometry}


def write_geojson(
    path: Path, features: list[dict], epsg: int, attribution: str | None = None
) -> None:
    """A FeatureCollection in the projected CRS (the viewer never reprojects),
    with the named-CRS member and, for OSM-derived data, the credit."""
    doc: dict = {"type": "FeatureCollection"}
    if attribution:
        doc["attribution"] = attribution
    doc["crs"] = crs_member(epsg)
    doc["features"] = features
    path.write_text(json.dumps(doc))


def geometry_json(geom: shapely.Geometry, digits: int = 2) -> dict:
    mapped = shapely.geometry.mapping(geom)
    return {"type": mapped["type"], "coordinates": round_coords(mapped["coordinates"], digits)}


# --- per-sample decisions along a line (ADR 0035) ------------------------------
#
# A property of a line feature that the ground under it decides (a tram
# track's bed, …) is read per sample and smoothed along the line — never
# decided once for the whole line (one bed per kilometre of track sent a
# street track to ballast for the square under a third of it), never left
# raw (a sawtooth of one-sample pieces).


def smooth_labels(raw: list[str | None], half: int, order: tuple[str, ...]) -> list[str]:
    """The majority label within `half` samples either side of each (ties
    in `order`), ignoring None (no sample there); every label is in
    `order`."""
    out = []
    for i in range(len(raw)):
        near = [b for b in raw[max(0, i - half) : i + half + 1] if b is not None]
        if not near:
            near = [b for b in raw if b is not None]
        out.append(max(order, key=lambda b: (near.count(b), -order.index(b))))
    return out


def absorb_short(labels: list[str], min_run: int) -> list[str]:
    """Runs shorter than `min_run` samples take the label of the longer
    neighbouring run, shortest first, until none is left (or one run)."""
    labels = list(labels)
    while True:
        runs = []
        i = 0
        while i < len(labels):
            j = i
            while j + 1 < len(labels) and labels[j + 1] == labels[i]:
                j += 1
            runs.append((i, j))
            i = j + 1
        short = [r for r in runs if r[1] - r[0] + 1 < min_run]
        if len(runs) == 1 or not short:
            return labels
        k = runs.index(min(short, key=lambda r: r[1] - r[0]))
        prev = runs[k - 1] if k > 0 else None
        nxt = runs[k + 1] if k + 1 < len(runs) else None
        side = max((r for r in (prev, nxt) if r is not None), key=lambda r: r[1] - r[0])
        label = labels[side[0]]
        i0, i1 = runs[k]
        for m in range(i0, i1 + 1):
            labels[m] = label


def label_line(
    line: shapely.LineString,
    sample,
    *,
    step: float,
    window: float,
    min_run: float,
    order: tuple[str, ...],
) -> list[tuple[shapely.LineString, str | None]]:
    """The line cut where its label changes: [(piece, label)]. `sample(x, y)`
    labels one point (None off the data); the labels are read every `step`
    m, a majority over `window` m, no run shorter than `min_run` m, and the
    cut falls halfway between two samples. All None: the whole line, None."""
    n = max(int(line.length / step), 1)
    raw = [sample(*line.interpolate(i / n, normalized=True).coords[0]) for i in range(n + 1)]
    if all(b is None for b in raw):
        return [(line, None)]
    labels = smooth_labels(raw, max(int(window / step / 2), 1), order)
    labels = absorb_short(labels, max(int(min_run / step), 1))
    out = []
    i = 0
    while i < len(labels):
        j = i
        while j + 1 < len(labels) and labels[j + 1] == labels[i]:
            j += 1
        a = 0.0 if i == 0 else (i - 0.5) / n
        b = 1.0 if j == len(labels) - 1 else (j + 0.5) / n
        piece = shapely.ops.substring(line, a, b, normalized=True)
        if piece.geom_type == "LineString" and piece.length > 0:
            out.append((piece, labels[i]))
        i = j + 1
    return out
