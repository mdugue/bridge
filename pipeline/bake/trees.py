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
  3. fills a height the register does not record (Hamburg's records none)
     from the tree's genus and trunk (allometry.py: the curve fitted on
     Dresden's and Leipzig's registers, shipped as tree_allometry.json),
     else from its crown (the archetype's median crown-to-height ratio),
     else the genus median — this tile's trees, else the table's. Not from
     Hamburg's surface model: matched from a leaf-off flight, it reads the
     street trees 10–40 % low;
  4. reads the surface model (DOM1 − DGM1, off the roofs and the bridges)
     at each trunk (`surface_check`): a register tree the model must see
     (SEEN_H tall) where it shows nothing above ABSENT_H is gone — its
     record outlived it — and is left out; a height the model exceeds by
     max(STALE_M, STALE_SHARE) — the viewer's `overtops`, which keeps a
     canopy crown that much taller as a second tree — is stale (a young
     tree's record, a genus median) and becomes the model's, where that
     fits the crown (`plausible_measure`). Else the viewer drew the tree
     twice: of the canopy and laser-scan crowns inside a register tree's
     footprint it kept 1 364 in Dresden as second trees, 609 in Leipzig and
     1 288 in Hamburg, most of them the register tree's own; with the check
     440, 278 and 227;
  5. flags (`f`) a tree standing in forest or copse (class 2/3 of the
     committed class raster): the viewer does not let such a tree veto the
     canopy trees around it — a park's measured canopy is denser than the
     municipal register (docs/transformations.md);
  6. adds the OSM trees (the site's extract, ODbL) that stand clear of every
     cadastre tree of the cached answer (its margin across the seams
     included) by its crown's radius, at least OSM_CLEARANCE — courts, the
     Zwinger, Free-State and private ground the municipal register skips.
     The cadastre wins: it is measured. An OSM tree needs a taxon the bake
     reads (`species`/`taxon`/`genus` naming a known genus; German names,
     lower-case genera and a few unambiguous bare epithets mapped) or at
     least `leaf_type`; one with neither is dropped (the DOM canopy covers
     unknown trees, and no species is invented). A `leaf_type` that
     contradicts the taxon wins over it, and `leaf_cycle` sets the leaf
     type. Its `height`/`diameter_crown`/`circumference` tags are read when
     present, the gaps filled as a register tree's (3.). A site without a
     register (München, Unna, Grimma, Meißen) has its OSM trees alone, their
     heights measured in the surface model (`measure_heights`): they veto
     the canopy crowns at their place in the viewer as a register's do;
  7. drops a trunk diameter that cannot be the tree's (over T_MAX, or over
     T_PER_H cm per metre of its height) rather than clamping it.

Output `data/<site>/dlm/trees_<tile>.geojson`, points with
  h tree height (m), d crown diameter (m), a archetype id (0 round, 1 oval,
  2 columnar, 3 conifer — the cone —, 4 weeping, 5 small, 6 pine, 7 bush:
  tree_archetypes.ARCHETYPES), l leaf type ("e"/"d"),
  c foliage colour (1 purple, 2 golden; absent = green), g 1 = globe
  cultivar, f 1 = in forest/copse, gn the genus (an index into the file's
  `genera` member, tree_archetypes.GENERA; absent = 0, other deciduous),
  t trunk diameter at breast height (cm, when measured or tagged and
  plausible), y the planting year (the register's own, or its record's
  year less the age it records; when plausible), s "osm"
  for an OSM tree (absent = the cadastre) (lib/city/features.ts `TreeFeature`).

And `data/dlm/treefacts_<tile>.json`, what the inquiry card says about each
of those trees (ADR 0042; the viewer fetches it with the first question
about a tree on the tile, never to draw): columns aligned with the
features, by index — the species (German, botanical; a table of the
names), the register's location and tree number, the age it records and
the date of that record, and which sizes are measured (bit 1 height, 2
crown, 4 trunk) rather than filled in from the tile's statistics. An OSM
tree has its tagged taxon and German name, its tagged sizes, no location
(lib/city/features.ts `TreeFactsFile`).
"""

from __future__ import annotations

import datetime
import json
import re
import statistics
from dataclasses import dataclass, field

import numpy as np
import rasterio
from scipy.spatial import cKDTree

from . import allometry, crown_form
from . import tree_archetypes as ta
from .cadastre import Fields, Register, register_of
from .canopy import BARE, bridge_mask, crown_green, roof_mask
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
# An OSM tree within a cadastre tree's crown radius, and never less than
# this, is taken to be that tree (the register is surveyed; OSM positions are
# often traced from imagery, a crown's middle rather than its trunk). With 3 m
# alone ~700 Dresden, 670 Leipzig and 340 Hamburg trees stood twice, 3–6 m
# from their register twin.
OSM_CLEARANCE = 3.0
CLEARANCE_CAP = 15.0  # m: D_MAX / 2, a crown radius past it is a typo
# The surface model's say over a tree (`surface_check`). A register tree
# this tall the model must see (a 25 cm trunk on the allometry; Saxony's
# DOM1 misses 0.1–0.4 % of the recorded ones over 10 m) …
SEEN_H = 8.0
# … and where its highest texel by the trunk is under this, and the
# orthophoto shows the ground bare there (the baked index's 3 × 3 maximum
# under the canopy's BARE, canopy.py `crown_green`: asphalt, gravel, a
# roof), nothing stands. The surface model alone does not tell: Hamburg's,
# matched from a leaf-off flight, shows nothing at 4 % of its register's
# trees with a 25 cm trunk, most of them green in its summer orthophoto
# (of the trees it does show, 2–3 % read as bare as that). A leaf-off
# flight's index (Saxony's) reads a lawn green and a bare crown bare; there
# the surface model, accurate, decides wherever a trunk stands in the street.
ABSENT_H = 2.0
# A tree the register says was planted this few years ago may postdate the
# flight (Hamburg's registers 2023–2025 plantings its 2022 flight never saw)
# and is too thin for it anyway: never taken for gone.
YOUNG_YEARS = 6
# A height the model exceeds by max(STALE_M, STALE_SHARE of it) is stale:
# the viewer's `overtops` (lib/city/tree-inventory.ts) keeps a canopy crown
# that much taller as a tree of its own.
STALE_M = 5.0
STALE_SHARE = 0.3
# … where the trunk on record allows it: a tree is at most this many times
# the allometry's height for its trunk (99 % of Dresden's and Leipzig's
# measured trees are; a 5 cm sapling read 9 m under a neighbour's crown).
TRUNK_LIMIT = 1.9
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
    """Every tree in the cached WFS answer as (x, y, crown radius), (n, 3):
    the tile's own and those in the margin across its seams, stumps and
    felled trees included (an OSM tree on one is the tree the register
    lost); the radius 0 where the register records no crown."""
    points = []
    for f in raw.get("features", []):
        xy = position(f, fields)
        if xy is None:
            continue
        d = _num((f.get("properties") or {}).get(fields.crown)) if fields.crown else None
        points.append((*xy, min(d / 2, CLEARANCE_CAP) if d else 0.0))
    return np.array(points, dtype=float).reshape(-1, 3)


def complement(osm: list[dict], cadastre: np.ndarray) -> list[dict]:
    """The OSM trees no cadastre tree (`cadastre_points`: the margin's too, so
    a register tree just across a seam claims its OSM twin on this side)
    stands within max(OSM_CLEARANCE, its crown radius) of."""
    if not osm or len(cadastre) == 0:
        return osm
    index = cKDTree(cadastre[:, :2])
    reach = max(OSM_CLEARANCE, float(cadastre[:, 2].max()))
    near = index.query_ball_point(np.array([(t["x"], t["y"]) for t in osm]), reach)
    kept = []
    for t, hits in zip(osm, near, strict=True):
        d = np.hypot(cadastre[hits, 0] - t["x"], cadastre[hits, 1] - t["y"])
        if not np.any(d <= np.maximum(cadastre[hits, 2], OSM_CLEARANCE)):
            kept.append(t)
    return kept


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
    samples), the tile's median height, the archetype's crown/height ratio
    — this tile's own measured trees', the shipped allometry table's
    (allometry.py: Dresden's and Leipzig's registers) where the tile has
    none."""

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
    table = allometry.table()
    return SizeStats(
        genus_h={
            **table["genus_h"],
            **{g: statistics.median(v) for g, v in by_genus.items() if len(v) >= 3},
        },
        all_h=statistics.median([t["h"] for t in trees if t["h"]] or [DEFAULT_H]),
        arch_r={
            **{int(a): r for a, r in table["crown_ratio"].items()},
            **{a: statistics.median(v) for a, v in ratio.items() if v},
        },
    )


def _missing_height(t: dict, stats: SizeStats, r: float) -> float:
    """A height for a tree that records none: the allometry's for its genus
    and trunk (a median 1.8 m off on the other Saxon register), else its
    crown over the archetype's ratio (2.0–2.3 m off), else the genus
    median."""
    if t.get("t") and t["t"] <= T_MAX:
        return allometry.height(t["genus"], t["archetype"], t["t"])
    if t["d"]:
        return t["d"] / r
    return stats.genus_h.get(t["genus"], stats.all_h)


def impute(
    trees: list[dict], stats: SizeStats | None = None
) -> tuple[list[tuple[float, float]], int, int]:
    """(height, crown diameter) per tree, the gaps filled (`_missing_height`;
    the crown from the height by `stats`, by default this tile's own
    measured trees) and clamped; plus how many of each were imputed."""
    stats = stats or size_stats(trees)
    out, imputed_h, imputed_d = [], 0, 0
    for t in trees:
        r = stats.arch_r.get(t["archetype"], DEFAULT_RATIO)
        h, d = t["h"], t["d"]
        if h is None:
            h = _missing_height(t, stats, r)
            imputed_h += 1
        if d is None:
            d = h * r
            imputed_d += 1
        out.append(clamped(h, d))
    return out, imputed_h, imputed_d


def clamped(h: float, d: float) -> tuple[float, float]:
    """A height and crown in the bake's ranges, the crown no wider than the
    tree allows."""
    h = min(max(h, H_MIN), H_MAX)
    return h, min(max(d, D_MIN), D_MAX, max(1.6 * h, 3.0))


def _disc(ndom: np.ndarray, r: int, c: int, reach: int) -> np.ndarray:
    """The nDOM texels within `reach` texels of (r, c)."""
    n_r, n_c = ndom.shape
    r0, r1, c0, c1 = (
        max(r - reach, 0),
        min(r + reach + 1, n_r),
        max(c - reach, 0),
        min(c + reach + 1, n_c),
    )
    yy, xx = np.mgrid[r0 - r : r1 - r, c0 - c : c1 - c]
    return ndom[r0:r1, c0:c1][yy**2 + xx**2 <= reach * reach]


def _disc_max(ndom: np.ndarray, r: int, c: int, reach: int) -> float:
    """The highest nDOM texel within `reach` texels of (r, c), the masked
    (NaN: a roof, a bridge) left out; 0 where none is left."""
    vals = _disc(ndom, r, c, reach)
    vals = vals[np.isfinite(vals)]
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
    measured = 0
    for t in trees:
        if t["h"] is not None:
            continue
        h, _ = trunk_top(ndom, bounds, t, t["d"])
        if plausible_measure(h, t["d"]):
            t["h"] = h
            measured += 1
    return measured


def trunk_top(ndom: np.ndarray, bounds, t: dict, d: float | None) -> tuple[float, bool]:
    """The surface model's highest texel within NDOM_REACH of a tree's trunk
    (a quarter of its crown `d`, 1–3 m), and whether that disc is all in
    view (no texel masked)."""
    xmin, _, xmax, ymax = bounds
    px = (xmax - xmin) / ndom.shape[1]
    reach_m = min(max((d or 0) * NDOM_REACH[0], NDOM_REACH[1]), NDOM_REACH[2])
    r = min(max(int((ymax - t["y"]) / px), 0), ndom.shape[0] - 1)
    c = min(max(int((t["x"] - xmin) / px), 0), ndom.shape[1] - 1)
    vals = _disc(ndom, r, c, max(1, round(reach_m / px)))
    seen = vals[np.isfinite(vals)]
    return (float(seen.max()) if seen.size else 0.0), seen.size == vals.size


def _peak(ndom: np.ndarray, bounds, t: dict, d: float | None) -> tuple[int, int, float] | None:
    """The row, column and height of the surface model's highest texel
    within NDOM_REACH of the trunk; None where none is in view."""
    xmin, _, xmax, ymax = bounds
    px = (xmax - xmin) / ndom.shape[1]
    reach = max(1, round(min(max((d or 0) * NDOM_REACH[0], NDOM_REACH[1]), NDOM_REACH[2]) / px))
    r = min(max(int((ymax - t["y"]) / px), 0), ndom.shape[0] - 1)
    c = min(max(int((t["x"] - xmin) / px), 0), ndom.shape[1] - 1)
    r0, c0 = max(r - reach, 0), max(c - reach, 0)
    win = ndom[r0 : r + reach + 1, c0 : c + reach + 1]
    yy, xx = np.mgrid[r0 - r : r0 - r + win.shape[0], c0 - c : c0 - c + win.shape[1]]
    vals = np.where((yy**2 + xx**2 <= reach * reach) & np.isfinite(win), win, -np.inf)
    i = int(np.argmax(vals))
    if not np.isfinite(vals.flat[i]):
        return None
    return r0 + i // win.shape[1], c0 + i % win.shape[1], float(vals.flat[i])


def conifer_form(t: dict, ndom: np.ndarray, bounds, d: float) -> bool:
    """A conifer of no known genus (an OSM tree tagged only needle-leaved)
    takes the pine's crown where the surface model shows its top flat
    (crown_form.py), as the canopy's evergreens do. True when it changed."""
    if t["archetype"] != ta.CONIFER or ta.is_genus(t["genus"]):
        return False
    peak = _peak(ndom, bounds, t, d)
    if peak is None or not crown_form.flat_topped(ndom, *peak):
        return False
    t["archetype"] = ta.PINE
    return True


@dataclass(frozen=True)
class Surface:
    """What the bake reads of a tile's flight: the nDOM (DOM1 − DGM1, north
    row first) with what is no tree masked (NaN: a building's roof and a
    bridge with its reach — canopy.py's `roof_mask` and `bridge_mask`, the
    canopy's own rules), and the orthophoto's crown green (`crown_green`,
    any grid; None without the index)."""

    ndom: np.ndarray
    green: np.ndarray | None = None

    def bare_at(self, bounds, x: float, y: float) -> bool:
        """Whether the orthophoto shows the ground bare at (x, y) (no index:
        it does not tell, and the surface model alone decides)."""
        if self.green is None:
            return True
        xmin, ymin, xmax, ymax = bounds
        n_r, n_c = self.green.shape
        r = min(max(int((ymax - y) / (ymax - ymin) * n_r), 0), n_r - 1)
        c = min(max(int((x - xmin) / (xmax - xmin) * n_c), 0), n_c - 1)
        return bool(self.green[r, c] < BARE)


def surface_model(tile: Tile) -> Surface | None:
    """The tile's `Surface`; None without a surface model."""
    dom = tile.raw_raster("dom1")
    if not dom.exists() or not tile.dgm.exists():
        print(f"{tile.id}: no surface model — every height from the register or the allometry")
        return None
    with rasterio.open(dom) as d, rasterio.open(tile.dgm) as g:
        ndom = d.read(1).astype(np.float64) - g.read(1).astype(np.float64)
    ndom[roof_mask(tile, ndom) | (bridge_mask(tile, ndom.shape[1]) == 1)] = np.nan
    return Surface(ndom, crown_green(tile))


@dataclass
class SurfaceCheck:
    """What `surface_check` did: the trees it left out as gone, the heights
    it took from the surface model as stale."""

    absent: int = 0
    stale: int = 0
    pines: int = 0


def _fits_trunk(t: dict, h: float) -> bool:
    """Whether a height can be the tree's by its trunk on record
    (TRUNK_LIMIT; no trunk recorded: any)."""
    if not t.get("t") or t["t"] > T_MAX:
        return True
    return h <= TRUNK_LIMIT * allometry.height(t["genus"], t["archetype"], t["t"])


def _seen(t: dict, h: float) -> bool:
    """Whether the surface model must show a tree: SEEN_H tall by its
    register's height or its measured trunk (not a genus median), and not
    planted in the last YOUNG_YEARS."""
    if t.get("src") == "osm" or h < SEEN_H or (t["h"] is None and not t.get("t")):
        return False
    year = planting_year(t)
    return year is None or year < datetime.date.today().year - YOUNG_YEARS


def surface_check(
    trees: list[dict],
    sizes: list[tuple[float, float]],
    surface: Surface,
    bounds,
    stats: SizeStats,
) -> tuple[list[dict], list[tuple[float, float]], SurfaceCheck]:
    """The trees and their sizes after the surface model's say (step 4 of
    the module doc): a register tree it must see and does not (`_seen`,
    under ABSENT_H by its trunk, the disc all in view, the orthophoto bare
    there) is left out; a height
    it exceeds by max(STALE_M, STALE_SHARE) becomes its, where that fits the
    recorded crown and trunk (`plausible_measure`, `_fits_trunk`) — a crown
    filled in from the height is filled in again; a conifer of no known
    genus takes its form from it (`conifer_form`).
    A height taken is measured (`t["h"]`, the facts' bit)."""
    kept, kept_sizes, done = [], [], SurfaceCheck()
    for t, (h, d) in zip(trees, sizes, strict=True):
        top, in_view = trunk_top(surface.ndom, bounds, t, d)
        if in_view and top < ABSENT_H and _seen(t, h) and surface.bare_at(bounds, t["x"], t["y"]):
            done.absent += 1
            continue
        stale = top > h + max(STALE_M, STALE_SHARE * h)
        if stale and plausible_measure(top, t["d"]) and _fits_trunk(t, top):
            t["h"] = top
            r = stats.arch_r.get(t["archetype"], DEFAULT_RATIO)
            h, d = clamped(top, t["d"] or top * r)
            done.stale += 1
        done.pines += conifer_form(t, surface.ndom, bounds, d)
        kept.append(t)
        kept_sizes.append((h, d))
    return kept, kept_sizes, done


def woodland_at(cls: np.ndarray, bounds, x: float, y: float) -> bool:
    """Whether the class raster (row 0 = north) says forest or copse there."""
    xmin, ymin, xmax, ymax = bounds
    h, w = cls.shape
    c = min(w - 1, int((x - xmin) / (xmax - xmin) * w))
    r = min(h - 1, int((ymax - y) / (ymax - ymin) * h))
    return int(cls[r, c]) in WOODLAND


EARLIEST_PLANTING = 1500


def planting_year(t: dict) -> int | None:
    """The year a register tree was planted: the register's own planting
    year, else the year of its record less the age it records (Dresden's
    `jalter`); None where neither is known or the year is implausible."""
    year = t.get("planted")
    if not year:
        f = t.get("facts") or {}
        age, date = f.get("age"), f.get("date") or ""
        year = int(date[:4]) - age if age and len(date) >= 4 else None
    if year is None or not EARLIEST_PLANTING <= year <= datetime.date.today().year:
        return None
    return year


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
    if (year := planting_year(t)) is not None:
        props["y"] = year
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


def _osm_trees(tile: Tile, cadastre: np.ndarray | None) -> list[dict]:
    """The site extract's trees the tile owns, without those a cadastre
    tree stands on (`complement`); all of them where the site has no
    register (`cadastre` None)."""
    if not has_extract(tile, "the OSM trees"):
        return []
    osm = read_osm_trees(tile)
    if cadastre is None:
        print(f"{tile.id}: {len(osm)} OSM trees (the site names no register)")
        return osm
    kept = complement(osm, cadastre)
    print(
        f"{tile.id}: {len(kept)} OSM trees added ({len(osm) - len(kept)} within "
        f"max({OSM_CLEARANCE:g} m, its crown radius) of a cadastre tree)"
    )
    return kept


def _register_trees(tile: Tile, register: Register) -> tuple[list[dict], np.ndarray] | None:
    """The register's trees the tile owns and every tree of the cached
    answer as `cadastre_points`; None without the cache."""
    raw_path = tile.raw / "trees" / f"{tile.id}.geojson"
    if not raw_path.exists():
        return None
    raw = json.loads(raw_path.read_text())
    return parse_trees(raw, tile.bounds, register.fields), cadastre_points(raw, register.fields)


@dataclass
class Census:
    """What one tile's bake did, for its log line."""

    measured: int = 0
    imputed_h: int = 0
    imputed_d: int = 0
    check: SurfaceCheck = field(default_factory=SurfaceCheck)
    osm_check: SurfaceCheck = field(default_factory=SurfaceCheck)


def sized_trees(
    trees: list[dict], osm: list[dict], surface: Surface | None, bounds, census: Census
) -> tuple[list[dict], list[tuple[float, float]]]:
    """The register's and the OSM trees with their (height, crown), in one
    list sorted by position (a re-bake diffs by what changed, not by the
    order the WFS happened to answer in): the gaps filled (`impute`; without
    a register the OSM trees' heights measured first), then checked against
    the surface model (`surface_check`)."""
    if not trees and surface is not None:
        census.measured = measure_heights(osm, surface.ndom, bounds)
    stats = size_stats(trees or osm)
    sizes, census.imputed_h, census.imputed_d = impute(trees, stats)
    osm_sizes, _, _ = impute(osm, stats)
    if surface is not None:
        trees, sizes, census.check = surface_check(trees, sizes, surface, bounds, stats)
        osm, osm_sizes, census.osm_check = surface_check(osm, osm_sizes, surface, bounds, stats)
    rows = sorted(
        zip(trees + osm, sizes + osm_sizes, strict=True), key=lambda r: (r[0]["x"], r[0]["y"])
    )
    return [r[0] for r in rows], [r[1] for r in rows]


def run(tile: Tile) -> None:
    register = register_of(tile)
    trees: list[dict] = []
    cadastre = None
    if register is not None:
        found = _register_trees(tile, register)
        if found is None:
            print(f"{tile.id}: no tree cadastre cached — skipping the inventory trees")
            return
        trees, cadastre = found
    # A tile without a tree (all forest) still gets its files, empty:
    # "baked, nothing here" is not "never baked" (lib/city/tile-data.test.ts
    # holds every tile to the same set of files).
    osm = _osm_trees(tile, cadastre)
    census = Census()
    rows, sizes = sized_trees(trees, osm, surface_model(tile), tile.bounds, census)
    features = tree_features(rows, sizes, tile.classes(), tile.bounds)
    facts = tree_facts(rows, [f["properties"] for f in features])
    credits = [tile.tree_cadastre.credit] if register is not None and tile.tree_cadastre else []
    if register is None or any(t.get("src") == "osm" for t in rows):
        credits.append(OSM_ATTRIBUTION)
    doc = {
        "type": "FeatureCollection",
        "attribution": "; ".join(credits),
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
    c = census
    print(
        f"{tile.id}: {len(trees)} cadastre trees ({c.imputed_h} heights and {c.imputed_d} crown "
        f"diameters filled in, {c.check.stale} stale heights taken from the surface model, "
        f"{c.check.absent} gone from it, {unknown} of no known genus), {len(osm)} OSM trees "
        f"({c.measured} heights measured, {c.osm_check.stale} raised to the surface model)"
    )
