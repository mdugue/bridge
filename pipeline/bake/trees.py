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
     OSM_CLEARANCE from every cadastre tree — courts, the Zwinger, Free-State
     and private ground the municipal register skips. The cadastre wins: it is
     measured. An OSM tree needs a taxon (`species`/`taxon`/`genus`, German
     names mapped) or at least `leaf_type`; one with neither is dropped (the
     DOM canopy covers unknown trees, and no species is invented). Its
     `height`/`diameter_crown`/`circumference` tags are read when present,
     the gaps filled from the cadastre's own statistics for the tile.

Output `data/dlm/trees_<tile>.geojson`, points with
  h tree height (m), d crown diameter (m), a archetype id (0 round, 1 oval,
  2 columnar, 3 conifer, 4 weeping, 5 small), l leaf type ("e"/"d"),
  c foliage colour (1 purple, 2 golden; absent = green), g 1 = globe
  cultivar, f 1 = in forest/copse, gn the genus (an index into the file's
  `genera` member, tree_archetypes.GENERA; absent = 0, other deciduous),
  t trunk diameter at breast height (cm, when measured or tagged), s "osm"
  for an OSM tree (absent = the cadastre) (lib/city/features.ts `TreeFeature`).
"""

from __future__ import annotations

import json
import re
import statistics
from dataclasses import dataclass

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

from . import tree_archetypes as ta
from .common import OSM_ATTRIBUTION, Tile, crs_member, feature, owns
from .osm import has_extract, read_osm, tag

ATTRIBUTION = "Stadtbaumkataster © Landeshauptstadt Dresden (dl-de/by-2-0)"
H_MIN, H_MAX, D_MIN, D_MAX = 1.5, 40.0, 0.8, 30.0
WOODLAND = (2, 3)  # the class raster's forest and copse (landcover.py)
DEFAULT_RATIO = 0.55  # crown / height where an archetype has no sample
DEFAULT_H = 8.0  # the height of a tile whose trees carry none at all
T_MAX = 400.0  # trunk diameter clamp (cm): the register has typos past it
# An OSM tree this close to a cadastre tree is taken to be that tree (the
# register is surveyed; OSM positions are often traced from imagery).
OSM_CLEARANCE = 3.0
OSM_WHERE = 'other_tags LIKE \'%"natural"=>"tree"%\''
# German names OSM mappers put into `genus`/`species` (seen in the Dresden
# extract), mapped to the botanical genus.
GERMAN_GENERA = {
    "Ahorn": "Acer",
    "Feldahorn": "Acer",
    "Spitzahorn": "Acer",
    "Bergahorn": "Acer",
    "Linde": "Tilia",
    "Eiche": "Quercus",
    "Platane": "Platanus",
    "Rosskastanie": "Aesculus",
    "Kastanie": "Aesculus",
    "Birke": "Betula",
    "Buche": "Fagus",
    "Hainbuche": "Carpinus",
    "Esche": "Fraxinus",
    "Ulme": "Ulmus",
    "Pappel": "Populus",
    "Weide": "Salix",
    "Robinie": "Robinia",
    "Kiefer": "Pinus",
    "Fichte": "Picea",
    "Eibe": "Taxus",
    "Lärche": "Larix",
    "Walnuss": "Juglans",
    "Kirsche": "Prunus",
    "Erle": "Alnus",
}


def _num(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def _trunk(cm: float | None) -> float | None:
    return min(cm, T_MAX) if cm else None


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
                "t": _trunk(_num(p.get("stammdurchmesser_akt"))),
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


def osm_taxon(other_tags: str | None) -> str:
    """The botanical name an OSM tree is tagged with ("" when none): the most
    specific of `species`, `taxon` and `genus`, a German name mapped to its
    genus."""
    for key in ("species", "taxon", "genus"):
        v = (tag(other_tags, key) or "").strip()
        if not v:
            continue
        first, _, rest = v.partition(" ")
        return f"{GERMAN_GENERA.get(first, first)} {rest}".strip()
    return ""


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


def osm_tree(x: float, y: float, other_tags: str | None) -> dict | None:
    """One OSM `natural=tree` classified like a cadastre tree, or None when it
    carries neither a taxon nor a leaf type."""
    taxon = osm_taxon(other_tags)
    german = " ".join(v for k in ("species:de", "genus:de") if (v := tag(other_tags, k)))
    c = ta.classify(taxon, german) if taxon else _by_leaf_type(other_tags)
    if c is None or (taxon and not c["known"]):
        c = _by_leaf_type(other_tags)
    if c is None:
        return None
    circumference = _metres(tag(other_tags, "circumference"), unit_cm=True)
    return {
        "x": x,
        "y": y,
        "h": _metres(tag(other_tags, "height")),
        "d": _metres(tag(other_tags, "diameter_crown")),
        "t": _trunk(circumference / np.pi * 100) if circumference else None,
        "src": "osm",
        **c,
    }


def complement(osm: list[dict], cadastre: list[dict]) -> list[dict]:
    """The OSM trees no cadastre tree stands within OSM_CLEARANCE of."""
    if not osm or not cadastre:
        return osm
    index = cKDTree(np.array([(t["x"], t["y"]) for t in cadastre]))
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
    if t.get("t"):
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


def _osm_complement(tile: Tile, cadastre: list[dict]) -> list[dict]:
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
    trees = parse_trees(json.loads(raw_path.read_text()), tile.bounds)
    if not trees:
        print(f"{tile.id}: the tree cadastre has no tree here — nothing written")
        return
    stats = size_stats(trees)
    sizes, imputed_h, imputed_d = impute(trees, stats)
    osm = _osm_complement(tile, trees)
    osm_sizes, _, _ = impute(osm, stats)
    # Sorted by position, so a re-bake diffs by what changed, not by the
    # order the WFS happened to answer in.
    rows = sorted(
        zip(trees + osm, sizes + osm_sizes, strict=True), key=lambda r: (r[0]["x"], r[0]["y"])
    )
    landcover = tile.out("dlm", f"landcover_{tile.id}.png")
    cls = np.asarray(Image.open(landcover).convert("L")) if landcover.exists() else None
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
