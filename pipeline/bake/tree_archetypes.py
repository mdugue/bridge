"""Taxon -> crown archetype, leaf type and foliage colour for the Dresden
street-tree cadastre (Stadtbaumkataster, `art_botanisch` / `art_deutsch`).

Pure Python, no third-party imports: `trees.py` bakes with it and
`scripts/eval/kataster-eval.py` reuses it, so the analysis and the committed
artifact can never disagree about which tree is which archetype.

The archetypes are an illustrator's silhouettes, not botany. The cadastre's
own height and crown diameter already carry most of a tree's proportions (a
'Fastigiata' oak is recorded 15 m tall and 4 m wide), so an archetype only
decides what the scale cannot: where the crown starts on the trunk and which
crown geometry the viewer draws (both in lib/city/tree-inventory.ts).

  0 round     broad rounded crown (lime, maple, oak, plane, chestnut ...)
  1 oval      upright oval / narrow-conic (hornbeam, birch, sweetgum, 'Greenspire')
  2 columnar  fastigiate cultivars ('Fastigiata', 'Italica', 'Columnare' ...)
  3 conifer   conical conifers (incl. the leaf-off Larix/Metasequoia/Taxodium)
  4 weeping   'Pendula', 'Tristis', weeping willows
  5 small     small ornamentals and globe cultivars (Prunus, Malus, Crataegus,
              Sorbus, 'Globosum' ...)

Leaf type: "e" evergreen (in leaf on the 2024-03-19 leaf-off DOP) or "d"
deciduous (bare then). Deciduous conifers are "d".
Foliage colour: 0 green, 1 purple/copper ("Blut-" cultivars), 2 golden.
Genus id: an index into GENERA, the viewer's phenology table
(lib/city/tree-season.ts): when the crown leafs out, turns and falls.
"""

import re

ARCHETYPES = ["round", "oval", "columnar", "conifer", "weeping", "small"]
ROUND, OVAL, COLUMNAR, CONIFER, WEEPING, SMALL = range(6)

EVERGREEN_CONIFERS = {
    "Abies",
    "Araucaria",
    "Cedrus",
    "Chamaecyparis",
    "Cupressocyparis",
    "Cupressus",
    "Juniperus",
    "Picea",
    "Pinus",
    "Pseudotsuga",
    "Sequoiadendron",
    "Taxus",
    "Thuja",
    "Tsuga",
}
DECIDUOUS_CONIFERS = {"Larix", "Metasequoia", "Taxodium"}
# Broadleaves that keep their leaves through winter.
EVERGREEN_BROADLEAF = {"Buxus", "Ilex"}
EVERGREEN_SPECIES = {"Viburnum rhytidophyllum", "Magnolia grandiflora", "Prunus laurocerasus"}

SMALL_GENERA = {
    "Amelanchier",
    "Buxus",
    "Caragana",
    "Cercis",
    "Cornus",
    "Cotinus",
    "Crataegus",
    "Cydonia",
    "Euonymus",
    "Laburnum",
    "Magnolia",
    "Malus",
    "Mespilus",
    "Prunus",
    "Rhus",
    "Sambucus",
    "Sorbopyrus",
    "Sorbus",
    "Syringa",
    "Tamarix",
    "Tetradium",
    "Viburnum",
    "Parrotia",
}
SMALL_SPECIES = {
    "Acer palmatum",
    "Acer ginnala",
    "Acer tataricum",
    "Acer buergerianum",
    "Acer monspessulanum",
    "Corylus avellana",
    "Salix caprea",
    "Salix cinerea",
    "Salix viminalis",
    "Pyrus communis",
    "Pyrus pyraster",
    "Koelreuteria paniculata",
    "Cercidiphyllum japonicum",
}
OVAL_GENERA = {
    "Alnus",
    "Betula",
    "Carpinus",
    "Ginkgo",
    "Liquidambar",
    "Liriodendron",
    "Ostrya",
    "Populus",
    "Zelkova",
    "Pyrus",
}
OVAL_SPECIES = {
    "Corylus colurna",
    "Acer rubrum",
    "Acer freemannii",
    "Quercus palustris",
    "Pyrus calleryana",
    "Fraxinus angustifolia",
}
# Cultivar epithets (inside the quotes) that name an upright-oval or conic
# crown on a genus that is otherwise round.
OVAL_CULTIVARS = {
    "greenspire",
    "rancho",
    "roelvo",
    "pallida",
    "elsrijk",
    "huibers elegant",
    "queen elizabeth",
    "raywood",
    "cleveland",
    "emerald queen",
    "olmsted",
    "autum blaze",
    "autumn blaze",
    "armstrong",
    "red sunset",
    "october glory",
    "rebona",
    "new horizon",
    "regal",
    "lobel",
    "dodoens",
    "skyline",
    "chanticleer",
    "glenleven",
    "brouwers",
    "geessink",
    "sapporo gold",
    "summit",
    "cimmzam",
    "merkur",
    "szeleste",
    "brabant",
    "green vase",
}
COLUMNAR_RE = re.compile(
    r"fastig|fastic|columna|colum\.|columella|italica|pyramidalis|erecta|"
    r"stricta|amanogawa|frans fontaine|lucas|obelisk|sentry'|'spire'|paarl",
    re.IGNORECASE,
)
# German-name hints (the cadastre's art_deutsch): reliable where the Latin is
# abbreviated or a cultivar is unknown to the lists above.
COLUMNAR_DE = re.compile(r"säulen|pyramiden", re.IGNORECASE)
OVAL_DE = re.compile(r"schmalkronig|kegel", re.IGNORECASE)
GLOBE_RE = re.compile(r"globos|umbraculifera|'nana'", re.IGNORECASE)
GLOBE_DE = re.compile(r"kugel", re.IGNORECASE)
# 'Pendula' only as a cultivar: Betula pendula is the upright silver birch.
WEEPING_RE = re.compile(
    r"'pendula'|'tristis'|youngii|chrysocoma|dalecarlica|babylonica|sepulcralis",
    re.IGNORECASE,
)
WEEPING_DE = re.compile(r"trauer", re.IGNORECASE)
PURPLE_RE = re.compile(
    r"nigra'|atropurpure|purpurea|atropunicea|royal red|faassen|schwedleri|"
    r"reitenbachii|crimson|deborah|rohanii|eleyi|colorata",
    re.IGNORECASE,
)
PURPLE_DE = re.compile(r"blut-|rotblättrig", re.IGNORECASE)
GOLD_RE = re.compile(r"sunburst|frisia|aurea|aureovariegat|wredei", re.IGNORECASE)
GOLD_DE = re.compile(r"gold-|goldulme|gelbblättrig", re.IGNORECASE)

UNKNOWN = {"Baumart", "Stammstück", ""}

# The phenology table's keys: a tree's `gn` in trees_<tile>.geojson is an
# index into this list, and lib/city/tree-season.ts holds the leaf-out,
# colouring, leaf-fall and autumn hue per entry in the SAME order (the bake
# writes the list as the file's `genera` member; lib/city/features.test.ts
# checks it against the viewer's). Append only: an index, once baked, means
# that entry. 0 is "other deciduous", the generic curve. Two entries are a
# species group rather than a genus because their autumn is: the red maples
# (A. rubrum, A. × freemanii and their cultivars) and the red oaks.
# Evergreens need no entry: their leaf type (`l`) keeps them unchanged.
GENERA = [
    "",
    "Acer",
    "Acer rubrum",
    "Tilia",
    "Quercus",
    "Quercus rubra",
    "Fraxinus",
    "Aesculus",
    "Prunus",
    "Platanus",
    "Robinia",
    "Carpinus",
    "Crataegus",
    "Gleditsia",
    "Sophora",
    "Ulmus",
    "Betula",
    "Malus",
    "Liquidambar",
    "Populus",
    "Ailanthus",
    "Salix",
    "Alnus",
    "Koelreuteria",
    "Sorbus",
    "Liriodendron",
    "Catalpa",
    "Corylus",
    "Pyrus",
    "Ginkgo",
    "Ostrya",
    "Fagus",
    "Castanea",
    "Juglans",
    "Celtis",
    "Larix",
    "Metasequoia",
    "Taxodium",
]
_GENUS_INDEX = {g: i for i, g in enumerate(GENERA)}
RED_MAPLES = {"Acer rubrum", "Acer freemanii", "Acer freemannii"}
RED_MAPLE_CULTIVARS = {
    "october glory",
    "red sunset",
    "autumn blaze",
    "autum blaze",
    "armstrong",
    "scarlet sentinel",
    "brandywine",
}
RED_OAKS = {"Quercus rubra", "Quercus palustris", "Quercus coccinea"}
# Synonyms the cadastre and OSM use for a genus of the table.
GENUS_SYNONYMS = {"Styphnolobium": "Sophora"}
# Genera no table above names: the rarer ones in the Dresden cadastre and
# OSM, a round deciduous crown on the generic phenology curve.
OTHER_GENERA = {
    "Albizia",
    "Broussonetia",
    "Camellia",
    "Carya",
    "Cercidiphyllum",
    "Cladrastis",
    "Cryptomeria",
    "Davidia",
    "Elaeagnus",
    "Gymnocladus",
    "Halesia",
    "Hamamelis",
    "Hippophae",
    "Maclura",
    "Morus",
    "Nyssa",
    "Paulownia",
    "Phellodendron",
    "Philadelphus",
    "Ptelea",
    "Pterocarya",
    "Rhamnus",
    "Rhododendron",
    "Staphylea",
}
# Every genus the classifier knows by name. A first word outside it is not a
# botanical name the bake can read — a German or English common name, a
# family ("Pinaceae"), a bare epithet ("hippocastanum") — and classifying it
# as a genus would make it a round deciduous tree whatever it is.
BOTANICAL_GENERA = (
    EVERGREEN_CONIFERS
    | DECIDUOUS_CONIFERS
    | EVERGREEN_BROADLEAF
    | SMALL_GENERA
    | OVAL_GENERA
    | OTHER_GENERA
    | set(GENUS_SYNONYMS)
    | {name.split()[0] for name in GENERA if name}
    | {name.split()[0] for name in SMALL_SPECIES | OVAL_SPECIES | EVERGREEN_SPECIES}
)


def is_genus(name: str) -> bool:
    """Whether `name` is a botanical genus the classifier knows."""
    return name in BOTANICAL_GENERA


def genus_id(botanical: str) -> int:
    """The phenology table index (GENERA) of a taxon; 0 when it has none."""
    genus, binomial, cultivar = parse_taxon(botanical)
    genus = GENUS_SYNONYMS.get(genus, genus)
    if genus == "Acer" and (
        _species_match(binomial, RED_MAPLES) or cultivar in RED_MAPLE_CULTIVARS
    ):
        return _GENUS_INDEX["Acer rubrum"]
    if genus == "Quercus" and _species_match(binomial, RED_OAKS):
        return _GENUS_INDEX["Quercus rubra"]
    return _GENUS_INDEX.get(genus, 0)


def parse_taxon(botanical: str) -> tuple[str, str, str]:
    """(genus, "Genus species", cultivar) from e.g. "Acer plat. 'Globosum'"."""
    text = " ".join((botanical or "").split())
    cultivar_m = re.search(r"'([^']*)'", text)
    cultivar = cultivar_m.group(1).strip().lower() if cultivar_m else ""
    words = re.sub(r"'[^']*'", "", text).split()
    genus = words[0] if words else ""
    if genus.lower() == "x" and len(words) > 1:  # "x Cupressocyparis"
        genus = words[1]
        words = words[1:]
    species = ""
    if len(words) > 1 and words[1] not in {"species", "Cultivar", "x"}:
        species = words[1].rstrip(".")
    elif len(words) > 2 and words[1] == "x":
        species = words[2].rstrip(".")
    return genus, f"{genus} {species}".strip(), cultivar


def _species_match(binomial: str, names: set[str]) -> bool:
    """True when "Genus sp" matches one of `names`, abbreviations included
    ("Acer plat" ~ "Acer platanoides")."""
    genus, _, sp = binomial.partition(" ")
    if not sp:
        return False
    for name in names:
        g, _, s = name.partition(" ")
        if g == genus and s.startswith(sp):
            return True
    return False


def leaf_type(genus: str, binomial: str) -> str:
    if genus in EVERGREEN_CONIFERS or genus in EVERGREEN_BROADLEAF:
        return "e"
    if _species_match(binomial, EVERGREEN_SPECIES):
        return "e"
    return "d"


def is_conifer(genus: str) -> bool:
    return genus in EVERGREEN_CONIFERS or genus in DECIDUOUS_CONIFERS


def foliage(botanical: str, german: str) -> int:
    if PURPLE_RE.search(botanical) or PURPLE_DE.search(german):
        # "Blut-Pflaume" etc.; "Rot-Ahorn"/"Rot-Eiche" are autumn colour and
        # do not match (the German pattern needs "Blut-" / "Rotblättrig").
        return 1
    if GOLD_RE.search(botanical) or GOLD_DE.search(german):
        return 2
    return 0


def _form_override(botanical: str, german: str, cultivar: str) -> int | None:
    """Archetype decided by a cultivar/form keyword, before the genus table."""
    if WEEPING_RE.search(botanical) or WEEPING_DE.search(german):
        return WEEPING
    if COLUMNAR_RE.search(botanical) or COLUMNAR_DE.search(german):
        return COLUMNAR
    if GLOBE_RE.search(botanical) or GLOBE_DE.search(german):
        return SMALL
    if cultivar in OVAL_CULTIVARS or OVAL_DE.search(german):
        return OVAL
    return None


def classify(botanical: str, german: str = "") -> dict:
    """Archetype id, leaf type, foliage colour and a globe flag for one taxon."""
    genus, binomial, cultivar = parse_taxon(botanical)
    german = german or ""
    known = genus not in UNKNOWN
    lt = leaf_type(genus, binomial) if known else "d"
    if known and is_conifer(genus):
        arch = CONIFER
    else:
        arch = _form_override(botanical, german, cultivar)
        if arch is None:
            if genus in SMALL_GENERA or _species_match(binomial, SMALL_SPECIES):
                arch = SMALL
            elif (
                genus in OVAL_GENERA
                or _species_match(binomial, OVAL_SPECIES)
                or (genus == "Salix" and "matsudana" in binomial)
            ):
                arch = OVAL
            else:
                arch = ROUND
    globe = bool(GLOBE_RE.search(botanical) or GLOBE_DE.search(german))
    return {
        "genus": genus if known else "",
        "gn": genus_id(botanical) if known else 0,
        "archetype": arch,
        "leaf": lt,
        "foliage": foliage(botanical, german),
        "globe": globe,
        "known": known,
    }
