"""The Dresden street-tree cadastre (Stadtbaumkataster, WFS `cls:L1261`) and
the OSM `natural=tree` nodes it does not cover → one point per tree with its
height, crown, silhouette archetype, genus and trunk.

Street trees, parks, schools and other municipal land (not the Großer
Garten, not private courtyards); licence dl-de/by-2-0, credit
"Landeshauptstadt Dresden" — the output carries an `attribution` member.
The ingest adapter caches the WFS response as `<raw>/trees/<tile>.geojson`
(ingest_sn.py `ingest_trees`); this step:

  1. keeps the trees whose `gis_x_utm`/`gis_y_utm` (= the geometry, verified
     to µm) the tile owns — west/south edges in, so each tree lands in
     exactly one tile;
  2. maps the taxon to archetype / leaf type / foliage colour
     (tree_archetypes.py);
  3. imputes a missing height or crown diameter from this tile's own trees:
     the genus median height and the archetype's median crown-to-height
     ratio;
  4. flags (`f`) a tree standing in DLM forest or copse (class 2/3 of the
     committed class raster): the viewer does not let such a tree veto the
     canopy trees around it — a park's measured canopy is denser than the
     municipal register (docs/transformations.md);
  5. adds the OSM trees (the site's extract, ODbL) that stand more than
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
  6. drops a trunk diameter that cannot be the tree's (over T_MAX, or over
     T_PER_H cm per metre of its height) rather than clamping it.

Output `data/dlm/trees_<tile>.geojson`, points with
  h tree height (m), d crown diameter (m), a archetype id (0 round, 1 oval,
  2 columnar, 3 conifer, 4 weeping, 5 small), l leaf type ("e"/"d"),
  c foliage colour (1 purple, 2 golden; absent = green), g 1 = globe
  cultivar, f 1 = in forest/copse, gn the genus (an index into the file's
  `genera` member, tree_archetypes.GENERA; absent = 0, other deciduous),
  t trunk diameter at breast height (cm, when measured or tagged and
  plausible), s "osm"
  for an OSM tree (absent = the cadastre) (lib/city/features.ts `TreeFeature`).
"""

from __future__ import annotations

import json
import re
import statistics
from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from . import tree_archetypes as ta
from .common import OSM_ATTRIBUTION, Tile, crs_member, feature, owns
from .osm import has_extract, read_osm, tag

ATTRIBUTION = "Stadtbaumkataster © Landeshauptstadt Dresden (dl-de/by-2-0)"
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
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def plausible_trunk(cm: float, height: float) -> bool:
    """Whether a trunk diameter (cm) fits a tree `height` m tall. An
    implausible one is dropped, not clamped: a clamp would still draw the
    typo, only a little less of it."""
    return cm <= T_MAX and cm <= T_PER_H * height


def parse_trees(raw: dict, bounds: tuple[float, float, float, float]) -> list[dict]:
    """The WFS features the tile owns, classified; heights may be None."""
    trees = []
    for f in raw.get("features", []):
        p = f.get("properties") or {}
        x, y = p.get("gis_x_utm"), p.get("gis_y_utm")
        if x is None or y is None or not owns(bounds, x, y):
            continue
        if (p.get("art_botanisch") or "").strip() == "Stammstück":
            continue  # a trunk stump, not a tree
        c = ta.classify(p.get("art_botanisch") or "", p.get("art_deutsch") or "")
        trees.append(
            {
                "x": x,
                "y": y,
                "h": _num(p.get("baumhoehe_akt")),
                "d": _num(p.get("kronendurchmesser_akt")),
                "t": _num(p.get("stammdurchmesser_akt")),
                **c,
            }
        )
    return trees


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
    return {
        "x": x,
        "y": y,
        "h": _metres(tag(other_tags, "height")),
        "d": _metres(tag(other_tags, "diameter_crown")),
        "t": circumference / np.pi * 100 if circumference else None,
        "src": "osm",
        **c,
    }


def cadastre_points(raw: dict) -> np.ndarray:
    """Every tree position in the cached WFS answer, (n, 2): the tile's own
    and those in the margin across its seams, stumps included (an OSM tree
    on a stump is the tree the register lost)."""
    points = [
        (p["gis_x_utm"], p["gis_y_utm"])
        for f in raw.get("features", [])
        if (p := f.get("properties") or {}).get("gis_x_utm") is not None
        and p.get("gis_y_utm") is not None
    ]
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
    if t.get("t") and plausible_trunk(t["t"], h):
        props["t"] = round(t["t"])
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
    raw_path = tile.raw / "trees" / f"{tile.id}.geojson"
    if not raw_path.exists():
        print(f"{tile.id}: no tree cadastre at {raw_path} — skipping the inventory trees")
        return
    raw = json.loads(raw_path.read_text())
    trees = parse_trees(raw, tile.bounds)
    # A tile the cadastre has no tree on (all forest) still gets its file,
    # empty: "baked, nothing here" is not "never baked" (lib/city/tile-data.test.ts
    # holds every tile to the same set of files). The OSM complement fills in
    # sizes from the cadastre's own statistics, so it needs a cadastre tree.
    features = []
    osm: list[dict] = []
    imputed_h = imputed_d = 0
    if trees:
        stats = size_stats(trees)
        sizes, imputed_h, imputed_d = impute(trees, stats)
        osm = _osm_complement(tile, cadastre_points(raw))
        osm_sizes, _, _ = impute(osm, stats)
        # Sorted by position, so a re-bake diffs by what changed, not by the
        # order the WFS happened to answer in.
        rows = sorted(
            zip(trees + osm, sizes + osm_sizes, strict=True),
            key=lambda r: (r[0]["x"], r[0]["y"]),
        )
        cls = tile.classes()
        features = tree_features([r[0] for r in rows], [r[1] for r in rows], cls, tile.bounds)
    doc = {
        "type": "FeatureCollection",
        "attribution": f"{ATTRIBUTION}; {OSM_ATTRIBUTION}" if osm else ATTRIBUTION,
        "archetypes": ta.ARCHETYPES,
        "genera": ta.GENERA,
        "crs": crs_member(tile.epsg),
        "features": features,
    }
    tile.out("dlm", f"trees_{tile.id}.geojson").write_text(json.dumps(doc, separators=(",", ":")))
    print(
        f"{tile.id}: {len(trees)} cadastre trees "
        f"({imputed_h} heights, {imputed_d} crown diameters imputed), {len(osm)} OSM trees"
    )
