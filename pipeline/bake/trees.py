"""A municipal tree register (cadastre.py: Dresden's Stadtbäume, Hamburg's
Straßenbaumkataster, Leipzig's Baumkataster, Berlin's Baumbestand) and the
OSM `natural=tree` nodes it does not cover → one point per tree with its
height, crown, silhouette archetype, genus and trunk.

Each register is read through its field mapping (`cadastre.Fields`) into one
record: position, taxon, German name, height, crown and trunk diameter (a
circumference is divided by π), planting year. What a register covers
differs — Dresden's street, park and school trees, Hamburg's street trees,
Leipzig's street and park trees, Berlin's street and park trees — and each
licence's credit goes into the output's `attribution` member. `bun run
fetch` caches the WFS response as `<raw>/trees/<tile>.geojson` (cadastre.py;
only for a site that names a register); this step:

  1. keeps the standing trees (not felled, not a stump or a stand mapped as
     one point) whose position the tile owns — west/south edges in, so each
     tree lands in exactly one tile;
  2. maps the taxon to archetype / leaf type / foliage colour
     (tree_archetypes.py);
  3. for a register that records no height (Hamburg's), measures it in the
     surface model (DOM1 − DGM1, the highest texel within a quarter of the
     crown diameter of the trunk, `measure_heights`) where the result fits
     the recorded crown;
  4. imputes a still missing height or crown diameter from this tile's own
     trees: the genus median height and the archetype's median
     crown-to-height ratio;
  5. flags (`f`) a tree standing in forest or copse (class 2/3 of the
     committed class raster): the viewer does not let such a tree veto the
     canopy trees around it — a park's measured canopy is denser than the
     municipal register (docs/transformations.md);
  6. adds the OSM trees (the site's extract, ODbL) that stand more than
     OSM_CLEARANCE from every cadastre tree of the cached answer (its margin
     across the seams included) — courts, the Zwinger, Free-State and
     private ground the municipal register skips. The cadastre wins: it is
     measured. An OSM tree needs a taxon the bake reads (`species`/`taxon`/
     `genus` naming a known genus; German names, lower-case genera and a few
     unambiguous bare epithets mapped) or at least `leaf_type`; one with
     neither is dropped (the DOM canopy covers unknown trees, and no species
     is invented). A `leaf_type` that contradicts the taxon wins over it, and
     `leaf_cycle` sets the leaf type. Its `height`/`diameter_crown`/
     `circumference` tags are read when present, the gaps filled from the
     cadastre's own statistics for the tile.
  7. drops a trunk diameter that cannot be the tree's (over T_MAX, or over
     T_PER_H cm per metre of its height) rather than clamping it.

Output `data/<site>/dlm/trees_<tile>.geojson`, points with
  h tree height (m), d crown diameter (m), a archetype id (0 round, 1 oval,
  2 columnar, 3 conifer, 4 weeping, 5 small), l leaf type ("e"/"d"),
  c foliage colour (1 purple, 2 golden; absent = green), g 1 = globe
  cultivar, f 1 = in forest/copse, gn the genus (an index into the file's
  `genera` member, tree_archetypes.GENERA; absent = 0, other deciduous),
  t trunk diameter at breast height (cm, when measured or tagged and
  plausible), s "osm"
  for an OSM tree (absent = the cadastre) (lib/city/features.ts `TreeFeature`).

And `data/dlm/treefacts_<tile>.json`, what the inquiry card says about each
of those trees (ADR 0041; the viewer fetches it with the first question
about a tree on the tile, never to draw): columns aligned with the
features, by index — the species (German, botanical; a table of the
names), the register's location and tree number, the age it records and
the date of that record, and which sizes are measured (bit 1 height, 2
crown, 4 trunk) rather than filled in from the tile's statistics. An OSM
tree has its tagged taxon and German name, its tagged sizes, no location
(lib/city/features.ts `TreeFactsFile`).
"""

from __future__ import annotations

import json
import re
import statistics
from dataclasses import dataclass

import numpy as np
import rasterio
from scipy.spatial import cKDTree

from . import tree_archetypes as ta
from .cadastre import Fields, register_of
from .common import OSM_ATTRIBUTION, Tile, crs_member, feature, owns
from .osm import has_extract, read_osm, tag

H_MIN, H_MAX, D_MIN, D_MAX = 1.5, 40.0, 0.8, 30.0
WOODLAND = (2, 3)  # the class raster's forest and copse (landcover.py)
DEFAULT_RATIO = 0.55  # crown / height where an archetype has no sample
DEFAULT_H = 8.0  # the height of a tile whose trees carry none at all
T_MAX = 400.0  # trunk diameter (cm) past which the register has a typo
# A trunk this many cm across per metre of the tree's height is a typo too
# (a 5 m tree 120 cm across): 99.8 % of the cadastre's measured pairs stay
# under it, the rest are swapped or mistyped fields and pollarded stumps.
T_PER_H = 15.0
# An OSM tree this close to a cadastre tree is taken to be that tree (the
# register is surveyed; OSM positions are often traced from imagery).
OSM_CLEARANCE = 3.0
# The disc the surface model is searched in for a tree's top: a quarter of
# its crown diameter, between 1 and 3 m (on Leipzig's measured trees the
# best of r = 1 m, d/4, d/3 and d/2, max or 90th percentile).
NDOM_REACH = (0.25, 1.0, 3.0)
OSM_WHERE = 'other_tags LIKE \'%"natural"=>"tree"%\''
# Common names OSM mappers put into `species`/`genus` (German, seen in the
# Dresden extract) → the botanical name. A value matches by its last word's
# ending ("Winter-Linde", "Gemeine Fichte", "Spitzahorn", a plural "Linden");
# the longer name is tried first, so a "Rosskastanie" is not a "Kastanie"
# and an "Eberesche" not an "Esche".
COMMON_NAMES = {
    "Ahorn": "Acer",
    "Rotahorn": "Acer rubrum",
    "Linde": "Tilia",
    "Eiche": "Quercus",
    "Roteiche": "Quercus rubra",
    "Platane": "Platanus",
    "Kastanie": "Aesculus",
    "Rosskastanie": "Aesculus",
    "Esskastanie": "Castanea",
    "Edelkastanie": "Castanea",
    "Birke": "Betula",
    "Buche": "Fagus",
    "Hainbuche": "Carpinus",
    "Esche": "Fraxinus",
    "Eberesche": "Sorbus",
    "Mehlbeere": "Sorbus",
    "Ulme": "Ulmus",
    "Pappel": "Populus",
    "Weide": "Salix",
    "Robinie": "Robinia",
    "Kiefer": "Pinus",
    "Fichte": "Picea",
    "Tanne": "Abies",
    "Eibe": "Taxus",
    "Lärche": "Larix",
    "Lebensbaum": "Thuja",
    "Walnuss": "Juglans",
    "Kirsche": "Prunus",
    "Kornelkirsche": "Cornus",
    "Pflaume": "Prunus",
    "Erle": "Alnus",
    "Tulpenbaum": "Liriodendron",
    "Magnolie": "Magnolia",
    "Maulbeere": "Morus",
}
_COMMON_LONGEST_FIRST = sorted(COMMON_NAMES, key=len, reverse=True)
# A bare species epithet (lower case, no genus) that names one tree; any
# other ("domestica": an apple, a plum or a service tree?) says nothing.
EPITHETS = {
    "hippocastanum": "Aesculus hippocastanum",
    "platanoides": "Acer platanoides",
    "pseudoplatanus": "Acer pseudoplatanus",
    "campestre": "Acer campestre",
    "cordata": "Tilia cordata",
    "platyphyllos": "Tilia platyphyllos",
    "robur": "Quercus robur",
    "petraea": "Quercus petraea",
    "sylvatica": "Fagus sylvatica",
    "betulus": "Carpinus betulus",
    "excelsior": "Fraxinus excelsior",
    "biloba": "Ginkgo biloba",
    "pseudoacacia": "Robinia pseudoacacia",
    "sativa": "Castanea sativa",
    "regia": "Juglans regia",
    "avium": "Prunus avium",
}


def _num(v) -> float | None:
    """A positive number from a register value (a number or a numeric
    string, decimal comma allowed); None for anything else."""
    if isinstance(v, str):
        try:
            v = float(v.strip().replace(",", "."))
        except ValueError:
            return None
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def plausible_trunk(cm: float, height: float) -> bool:
    """Whether a trunk diameter (cm) fits a tree `height` m tall. An
    implausible one is dropped, not clamped: a clamp would still draw the
    typo, only a little less of it."""
    return cm <= T_MAX and cm <= T_PER_H * height


def _first(p: dict, names: tuple[str, ...]) -> str:
    """The first of `names` that holds a non-empty text, stripped."""
    for name in names:
        v = p.get(name)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def position(f: dict, fields: Fields) -> tuple[float, float] | None:
    """A register feature's position in the tile's CRS: the two properties
    the register names, or its geometry's (first) point."""
    p = f.get("properties") or {}
    if fields.position is not None:
        x, y = (p.get(k) for k in fields.position)
        return (x, y) if isinstance(x, (int, float)) and isinstance(y, (int, float)) else None
    g = f.get("geometry") or {}
    coords = g.get("coordinates")
    if g.get("type") == "MultiPoint" and coords:
        coords = coords[0]
    if g.get("type") in ("Point", "MultiPoint") and coords and len(coords) >= 2:
        return float(coords[0]), float(coords[1])
    return None


def _trunk(p: dict, fields: Fields) -> float | None:
    """The trunk diameter (cm): measured, or from the circumference."""
    if fields.trunk_diameter and (d := _num(p.get(fields.trunk_diameter))):
        return d
    if fields.trunk_circumference and (c := _num(p.get(fields.trunk_circumference))):
        return c / np.pi
    return None


def register_tree(f: dict, fields: Fields) -> dict | None:
    """One register feature as the bake's tree record (position, sizes,
    classification; a size the register lacks is None), or None when it is
    no standing tree: felled, a stump, or without a position."""
    p = f.get("properties") or {}
    if fields.felled and p.get(fields.felled) not in (None, ""):
        return None
    taxon = _first(p, fields.taxon)
    if taxon in fields.not_trees:
        return None  # a trunk stump, not a tree
    xy = position(f, fields)
    if xy is None:
        return None
    planted = _num(p.get(fields.planted)) if fields.planted else None
    return {
        "x": xy[0],
        "y": xy[1],
        "h": _num(p.get(fields.height)) if fields.height else None,
        "d": _num(p.get(fields.crown)) if fields.crown else None,
        "t": _trunk(p, fields),
        "planted": int(planted) if planted else None,
        "facts": cadastre_facts(p, fields),
        **ta.classify(taxon, _first(p, fields.german)),
    }


def parse_trees(raw: dict, bounds: tuple[float, float, float, float], fields: Fields) -> list[dict]:
    """The register's standing trees the tile owns (west/south edges in, so
    each lands in exactly one tile), classified; sizes may be None."""
    trees = []
    for f in raw.get("features", []):
        t = register_tree(f, fields)
        if t is not None and owns(bounds, t["x"], t["y"]):
            trees.append(t)
    return trees


def _text(v) -> str:
    """A register text, its runs of spaces collapsed ("Europäische  Eibe")."""
    return " ".join(v.split()) if isinstance(v, str) else ""


def _record_date(v) -> str:
    """The register's change date ("10.09.2026 11:30:37") as ISO, "" if none."""
    m = re.match(r"\s*(\d{1,2})\.(\d{1,2})\.(\d{4})", v or "")
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else ""


def _whole(v) -> int | None:
    """A positive whole number from a register field ("46   ", 40.0)."""
    try:
        n = round(float(str(v).strip()))
    except (TypeError, ValueError, OverflowError):
        return None
    return n if n > 0 else None


def cadastre_facts(p: dict, fields: Fields) -> dict:
    """What the register says about one tree beyond its shape (the card's
    lines): its names, where it stands and its number there, its age and
    the date of the record — as far as the register keeps them."""

    def get(name: str | None):
        return p.get(name) if name else None

    return {
        "de": _text(_first(p, fields.german)),
        "bot": _text(_first(p, fields.taxon)),
        "place": _text(get(fields.place)),
        "nr": _whole(get(fields.number)),
        "age": _whole(get(fields.age)),
        "date": _record_date(get(fields.recorded)),
    }


def _metres(v: str | None, unit_cm: bool = False) -> float | None:
    """A positive length from an OSM value ("12", "12.5 m", "180 cm")."""
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(m|cm)?\s*", v or "")
    if not m:
        return None
    x = float(m.group(1).replace(",", "."))
    if m.group(2) == "cm" or (unit_cm and m.group(2) is None and x > 20):
        x /= 100  # a bare circumference over 20 "m" was meant in cm
    return x if x > 0 else None


def _common_name(value: str) -> str:
    """The botanical name for a common tree name (COMMON_NAMES), "" when it
    is none."""
    word = re.split(r"[\s-]+", value.strip())[-1].lower()
    plural = word[:-1] if word.endswith("en") else ""  # "Linden", "Eichen"
    for candidate in (word, plural):
        for name in _COMMON_LONGEST_FIRST:
            if candidate and candidate.endswith(name.lower()):
                return COMMON_NAMES[name]
    return ""


def botanical(value: str | None) -> str:
    """An OSM tag value as a botanical name the classifier reads, "" when it
    is none: a known genus as it stands (capitalised where a mapper wrote it
    lower case), a bare epithet that names one tree, or a common name. Any
    other first word — a family, an English name, an ambiguous epithet — is
    not taken for a genus."""
    words = (value or "").split()
    if not words:
        return ""
    genus = words[0][:1].upper() + words[0][1:]
    if ta.is_genus(genus):
        return " ".join([genus, *words[1:]])
    if len(words) == 1 and words[0] in EPITHETS:
        return EPITHETS[words[0]]
    return _common_name(value or "")


def osm_taxon(other_tags: str | None) -> str:
    """The botanical name an OSM tree is tagged with ("" when none): the most
    specific of `species`, `taxon` and `genus` that reads as one (`botanical`),
    else the German `species:de`/`genus:de`."""
    for key in ("species", "taxon", "genus", "species:de", "genus:de"):
        name = botanical(tag(other_tags, key))
        if name:
            return name
    return ""


LEAF_CYCLE = {"evergreen": "e", "deciduous": "d"}


def _by_leaf_type(other_tags: str | None) -> dict | None:
    """Archetype and leaf type from `leaf_type`/`leaf_cycle` alone."""
    leaf_type = tag(other_tags, "leaf_type")
    cycle = tag(other_tags, "leaf_cycle")
    if leaf_type == "broadleaved":
        arch, leaf = ta.ROUND, "e" if cycle == "evergreen" else "d"
    elif leaf_type == "needleleaved":
        arch, leaf = ta.CONIFER, "d" if cycle == "deciduous" else "e"
    else:
        return None
    return {
        "genus": "",
        "gn": 0,
        "archetype": arch,
        "leaf": leaf,
        "foliage": 0,
        "globe": False,
        "known": False,
    }


def _classify_osm(other_tags: str | None) -> dict | None:
    """The taxon's classification, unless the tree's own `leaf_type`
    contradicts it (a needle-leaved "lime": the taxon is the suspect, the
    leaf type wins); a `leaf_cycle` tag sets the leaf type either way."""
    by_leaf = _by_leaf_type(other_tags)
    taxon = osm_taxon(other_tags)
    if not taxon:
        return by_leaf
    german = " ".join(v for k in ("species:de", "genus:de") if (v := tag(other_tags, k)))
    c = ta.classify(taxon, german)
    if by_leaf is not None and (by_leaf["archetype"] == ta.CONIFER) != (
        c["archetype"] == ta.CONIFER
    ):
        return by_leaf
    cycle = LEAF_CYCLE.get(tag(other_tags, "leaf_cycle") or "")
    return {**c, "leaf": cycle} if cycle else c


def osm_tree(x: float, y: float, other_tags: str | None) -> dict | None:
    """One OSM `natural=tree` classified like a cadastre tree, or None when it
    carries neither a taxon the bake reads nor a leaf type."""
    c = _classify_osm(other_tags)
    if c is None:
        return None
    circumference = _metres(tag(other_tags, "circumference"), unit_cm=True)
    german = tag(other_tags, "species:de") or tag(other_tags, "genus:de") or ""
    return {
        "x": x,
        "y": y,
        "h": _metres(tag(other_tags, "height")),
        "d": _metres(tag(other_tags, "diameter_crown")),
        "t": circumference / np.pi * 100 if circumference else None,
        "src": "osm",
        "facts": {"de": german.strip(), "bot": osm_taxon(other_tags)},
        **c,
    }


def cadastre_points(raw: dict, fields: Fields) -> np.ndarray:
    """Every tree position in the cached WFS answer, (n, 2): the tile's own
    and those in the margin across its seams, stumps and felled trees
    included (an OSM tree on one is the tree the register lost)."""
    points = [xy for f in raw.get("features", []) if (xy := position(f, fields)) is not None]
    return np.array(points, dtype=float).reshape(-1, 2)


def complement(osm: list[dict], cadastre: np.ndarray) -> list[dict]:
    """The OSM trees no cadastre tree (`cadastre_points`: the margin's too, so
    a register tree just across a seam claims its OSM twin on this side)
    stands within OSM_CLEARANCE of."""
    if not osm or len(cadastre) == 0:
        return osm
    index = cKDTree(cadastre)
    dist, _ = index.query(np.array([(t["x"], t["y"]) for t in osm]))
    return [t for t, d in zip(osm, dist, strict=True) if d > OSM_CLEARANCE]


def read_osm_trees(tile: Tile) -> list[dict]:
    """The site extract's `natural=tree` nodes the tile owns, classified."""
    geoms, fields = read_osm(tile, "points", OSM_WHERE, ["other_tags"])
    trees = []
    for g, other in zip(geoms, fields["other_tags"], strict=True):
        if g is None or not owns(tile.bounds, g.x, g.y):
            continue
        t = osm_tree(g.x, g.y, other)
        if t is not None:
            trees.append(t)
    return trees


@dataclass(frozen=True)
class SizeStats:
    """What fills a missing height or crown: the genus median height (≥ 3
    samples), the tile's median height, the archetype's crown/height ratio."""

    genus_h: dict[str, float]
    all_h: float
    arch_r: dict[int, float]


def size_stats(trees: list[dict]) -> SizeStats:
    by_genus: dict[str, list[float]] = {}
    ratio: dict[int, list[float]] = {}
    for t in trees:
        if t["h"]:
            by_genus.setdefault(t["genus"], []).append(t["h"])
        if t["h"] and t["d"]:
            ratio.setdefault(t["archetype"], []).append(t["d"] / t["h"])
    return SizeStats(
        genus_h={g: statistics.median(v) for g, v in by_genus.items() if len(v) >= 3},
        all_h=statistics.median([t["h"] for t in trees if t["h"]] or [DEFAULT_H]),
        arch_r={a: statistics.median(v) for a, v in ratio.items() if v},
    )


def impute(
    trees: list[dict], stats: SizeStats | None = None
) -> tuple[list[tuple[float, float]], int, int]:
    """(height, crown diameter) per tree, the gaps filled from `stats` (by
    default this tile's own measured trees) and clamped; plus how many of
    each were imputed."""
    stats = stats or size_stats(trees)
    out, imputed_h, imputed_d = [], 0, 0
    for t in trees:
        r = stats.arch_r.get(t["archetype"], DEFAULT_RATIO)
        h, d = t["h"], t["d"]
        if h is None:
            h = d / r if d else stats.genus_h.get(t["genus"], stats.all_h)
            imputed_h += 1
        if d is None:
            d = h * r
            imputed_d += 1
        h = min(max(h, H_MIN), H_MAX)
        d = min(max(d, D_MIN), D_MAX, max(1.6 * h, 3.0))
        out.append((h, d))
    return out, imputed_h, imputed_d


def _disc_max(ndom: np.ndarray, r: int, c: int, reach: int) -> float:
    """The highest nDOM texel within `reach` texels of (r, c)."""
    n_r, n_c = ndom.shape
    r0, r1, c0, c1 = (
        max(r - reach, 0),
        min(r + reach + 1, n_r),
        max(c - reach, 0),
        min(c + reach + 1, n_c),
    )
    yy, xx = np.mgrid[r0 - r : r1 - r, c0 - c : c1 - c]
    vals = ndom[r0:r1, c0:c1][yy**2 + xx**2 <= reach * reach]
    return float(vals.max()) if vals.size else 0.0


def plausible_measure(h: float, d: float | None) -> bool:
    """Whether a height read from the surface model can be the tree's: in
    the bake's range and, with a crown on record, neither far flatter nor
    far taller than it (a roof or a bigger neighbour's crown above a
    sapling, or the ground beside one the flight predates)."""
    if not H_MIN <= h <= H_MAX:
        return False
    return d is None or 0.6 * d <= h <= max(3 * d, 6.0) + 2.0


def measure_heights(trees: list[dict], ndom: np.ndarray, bounds) -> int:
    """Fills each missing height from the surface model (nDOM = DOM1 − DGM1):
    the highest texel within NDOM_REACH of the trunk, kept when plausible
    (`plausible_measure`). For a register that records no height (Hamburg);
    on Leipzig's, which does, this reads 0.6 m low in the median, 1.5 m off
    — against 2.3 m for a height guessed from the crown. Returns how many."""
    xmin, _, xmax, ymax = bounds
    px = (xmax - xmin) / ndom.shape[1]
    measured = 0
    for t in trees:
        if t["h"] is not None:
            continue
        reach_m = min(max((t["d"] or 0) * NDOM_REACH[0], NDOM_REACH[1]), NDOM_REACH[2])
        r = min(int((ymax - t["y"]) / px), ndom.shape[0] - 1)
        c = min(int((t["x"] - xmin) / px), ndom.shape[1] - 1)
        h = _disc_max(ndom, r, c, max(1, round(reach_m / px)))
        if plausible_measure(h, t["d"]):
            t["h"] = h
            measured += 1
    return measured


def surface_heights(tile: Tile, trees: list[dict]) -> int:
    """`measure_heights` over the tile's surface model; 0 without one."""
    dom = tile.raw_raster("dom1")
    if not dom.exists() or not tile.dgm.exists():
        print(f"{tile.id}: no surface model — the register's heights come from the crowns")
        return 0
    with rasterio.open(dom) as d, rasterio.open(tile.dgm) as g:
        ndom = d.read(1).astype(np.float64) - g.read(1).astype(np.float64)
    return measure_heights(trees, ndom, tile.bounds)


def woodland_at(cls: np.ndarray, bounds, x: float, y: float) -> bool:
    """Whether the class raster (row 0 = north) says forest or copse there."""
    xmin, ymin, xmax, ymax = bounds
    h, w = cls.shape
    c = min(w - 1, int((x - xmin) / (xmax - xmin) * w))
    r = min(h - 1, int((ymax - y) / (ymax - ymin) * h))
    return int(cls[r, c]) in WOODLAND


def tree_props(t: dict, h: float, d: float) -> dict:
    """The feature properties of one tree (the optional members only when
    they say something)."""
    props: dict = {"h": round(h, 1), "d": round(d, 1), "a": t["archetype"], "l": t["leaf"]}
    if t["foliage"]:
        props["c"] = t["foliage"]
    if t["globe"]:
        props["g"] = 1
    if t.get("gn"):
        props["gn"] = t["gn"]
    if t.get("t") and plausible_trunk(t["t"], h) and round(t["t"]) > 0:
        props["t"] = round(t["t"])  # a sapling's 1 cm girth rounds to none
    if t.get("src") == "osm":
        props["s"] = "osm"
    return props


def tree_features(trees: list[dict], sizes, cls: np.ndarray | None, bounds) -> list[dict]:
    features = []
    for t, (h, d) in zip(trees, sizes, strict=True):
        props = tree_props(t, h, d)
        if cls is not None and woodland_at(cls, bounds, t["x"], t["y"]):
            props["f"] = 1
        features.append(
            feature({"type": "Point", "coordinates": [round(t["x"], 1), round(t["y"], 1)]}, props)
        )
    return features


def tree_facts(trees: list[dict], props: list[dict]) -> dict:
    """The facts file's body for trees in feature order (`props` their
    feature properties, which say which sizes the feature carries as
    measured): names, places and dates as tables, the rest as columns,
    -1 for unknown."""
    names: dict[tuple[str, str], int] = {}
    places: dict[str, int] = {}
    dates: dict[str, int] = {}

    def index(table: dict, key) -> int:
        if not key or key == ("", ""):
            return -1
        return table.setdefault(key, len(table))

    cols: dict[str, list[int]] = {k: [] for k in ("name", "place", "nr", "age", "date", "known")}
    for t, p in zip(trees, props, strict=True):
        f = t.get("facts") or {}
        cols["name"].append(index(names, (f.get("de", ""), f.get("bot", ""))))
        cols["place"].append(index(places, f.get("place", "")))
        cols["nr"].append(f.get("nr") or -1)
        cols["age"].append(f.get("age") or -1)
        cols["date"].append(index(dates, f.get("date", "")))
        known = (1 if t["h"] else 0) | (2 if t["d"] else 0) | (4 if "t" in p else 0)
        cols["known"].append(known)
    return {
        "names": [list(k) for k in names],
        "places": list(places),
        "dates": list(dates),
        **cols,
    }


def _osm_complement(tile: Tile, cadastre: np.ndarray) -> list[dict]:
    if not has_extract(tile, "the OSM trees"):
        return []
    osm = read_osm_trees(tile)
    kept = complement(osm, cadastre)
    print(
        f"{tile.id}: {len(kept)} OSM trees added "
        f"({len(osm) - len(kept)} within {OSM_CLEARANCE:g} m of a cadastre tree)"
    )
    return kept


def run(tile: Tile) -> None:
    register = register_of(tile)
    if register is None:
        print(f"{tile.id}: the site names no tree cadastre — skipping the inventory trees")
        return
    raw_path = tile.raw / "trees" / f"{tile.id}.geojson"
    if not raw_path.exists():
        print(f"{tile.id}: no tree cadastre at {raw_path} — skipping the inventory trees")
        return
    raw = json.loads(raw_path.read_text())
    trees = parse_trees(raw, tile.bounds, register.fields)
    # A tile the cadastre has no tree on (all forest) still gets its file,
    # empty: "baked, nothing here" is not "never baked" (lib/city/tile-data.test.ts
    # holds every tile to the same set of files). The OSM complement fills in
    # sizes from the cadastre's own statistics, so it needs a cadastre tree.
    features = []
    facts = tree_facts([], [])
    osm: list[dict] = []
    measured = imputed_h = imputed_d = 0
    if trees:
        if register.fields.height is None:
            measured = surface_heights(tile, trees)
        stats = size_stats(trees)
        sizes, imputed_h, imputed_d = impute(trees, stats)
        osm = _osm_complement(tile, cadastre_points(raw, register.fields))
        osm_sizes, _, _ = impute(osm, stats)
        # Sorted by position, so a re-bake diffs by what changed, not by the
        # order the WFS happened to answer in.
        rows = sorted(
            zip(trees + osm, sizes + osm_sizes, strict=True),
            key=lambda r: (r[0]["x"], r[0]["y"]),
        )
        cls = tile.classes()
        features = tree_features([r[0] for r in rows], [r[1] for r in rows], cls, tile.bounds)
        facts = tree_facts([r[0] for r in rows], [f["properties"] for f in features])
    credit = tile.tree_cadastre.credit
    doc = {
        "type": "FeatureCollection",
        "attribution": f"{credit}; {OSM_ATTRIBUTION}" if osm else credit,
        "archetypes": ta.ARCHETYPES,
        "genera": ta.GENERA,
        "crs": crs_member(tile.epsg),
        "features": features,
    }
    tile.out("dlm", f"trees_{tile.id}.geojson").write_text(json.dumps(doc, separators=(",", ":")))
    tile.out("dlm", f"treefacts_{tile.id}.json").write_text(
        json.dumps(
            {"attribution": doc["attribution"], "count": len(features), **facts},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    unknown = sum(not t["known"] or not ta.is_genus(t["genus"]) for t in trees)
    print(
        f"{tile.id}: {len(trees)} cadastre trees "
        f"({measured} heights measured in the surface model, {imputed_h} heights and "
        f"{imputed_d} crown diameters imputed, {unknown} of no known genus), {len(osm)} OSM trees"
    )
