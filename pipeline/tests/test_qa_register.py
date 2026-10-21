"""The street-tree registers' QA fixes (PR #173): heights from the genus ×
trunk allometry where a register records none, a stale height taken from
the surface model, a tree it shows gone left out, OSM trees cleared by the
register crown's radius, and the conifers' forms by genus."""

import numpy as np
import pytest

from bake import allometry
from bake import tree_archetypes as ta
from bake.cadastre import REGISTERS
from bake.trees import (
    ABSENT_H,
    DEFAULT_RATIO,
    SizeStats,
    Surface,
    cadastre_points,
    complement,
    impute,
    osm_tree,
    parse_trees,
    sized_trees,
    surface_check,
)

DRESDEN = REGISTERS["dresden"].fields


def _register(x, y, h=None, d=None, trunk=None, botanical="Tilia cordata"):
    return {
        "properties": {
            "gis_x_utm": x,
            "gis_y_utm": y,
            "baumhoehe_akt": h,
            "kronendurchmesser_akt": d,
            "stammdurchmesser_akt": trunk,
            "art_botanisch": botanical,
            "art_deutsch": "",
        }
    }


def _trees(*features, bounds=(0.0, 0.0, 100.0, 100.0)):
    return parse_trees({"features": list(features)}, bounds, DRESDEN)


STATS = SizeStats(genus_h={"Tilia": 10.0}, all_h=10.0, arch_r={0: 0.6})
BOUNDS = (0.0, 0.0, 100.0, 100.0)


# --- the allometry ------------------------------------------------------------


def test_the_curve_is_the_class_medians_made_non_decreasing():
    # 20 trees a class: 5 cm → 4 m, 12 cm → 9 m, 17 cm → 7 m (noise), 27 cm → 12 m
    pairs = [(5.0, 4.0)] * 20 + [(12.0, 9.0)] * 20 + [(17.0, 7.0)] * 20 + [(27.0, 12.0)] * 20
    points = allometry.curve(pairs)
    assert points is not None
    heights = [h for _, h in points]
    assert heights == sorted(heights)  # the 9 m / 7 m pair pooled to 8 m
    assert [14.5, 8.0] in points
    # a class with fewer than BIN_MIN trees gives no point
    assert allometry.curve([(5.0, 4.0)] * (allometry.BIN_MIN - 1)) is None


def test_a_height_reads_off_the_line_and_holds_past_the_ends():
    points = [[10.0, 6.0], [30.0, 14.0]]
    assert allometry.read_curve(points, 20.0) == pytest.approx(10.0)
    assert allometry.read_curve(points, 2.0) == 6.0
    assert allometry.read_curve(points, 90.0) == 14.0


def test_the_shipped_table_covers_the_common_genera_and_every_archetype():
    tab = allometry.table()
    for genus in ("Tilia", "Acer", "Quercus", "Platanus", "Pinus", "Taxus"):
        points = tab["genus"][genus]
        assert [h for _, h in points] == sorted(h for _, h in points)
    assert set(tab["archetype"]) >= {str(a) for a in range(len(ta.ARCHETYPES)) if a != ta.WEEPING}
    # a 30 cm lime: 13–14 m in Saxony (Hamburg's leaf-off DOM1 read 9.7 m)
    assert 12.0 <= allometry.height("Tilia", ta.ROUND, 30.0) <= 15.0
    # a small ornamental's curve is lower than a lime's
    assert allometry.height("Prunus", ta.SMALL, 30.0) < allometry.height("Tilia", ta.ROUND, 30.0)
    # a genus without a curve takes its archetype's
    assert allometry.height("Nyssa", ta.ROUND, 30.0) == allometry.height("", ta.ROUND, 30.0)
    fit = tab["fit"]
    assert set(fit["registers"]) == {"dresden", "leipzig"}
    for v in fit["validation"].values():
        assert v["mae"] < v["genus_median_mae"]


def test_a_missing_height_comes_from_the_trunk_then_the_crown_then_the_genus():
    trunk, crown, bare = _trees(
        _register(1, 1, trunk=30), _register(2, 1, d=6.0), _register(3, 1, botanical="Tilia x")
    )
    (h_trunk, _), (h_crown, _), (h_bare, _) = impute([trunk, crown, bare], STATS)[0]
    assert h_trunk == pytest.approx(allometry.height("Tilia", ta.ROUND, 30.0))
    assert h_crown == pytest.approx(6.0 / 0.6)
    assert h_bare == 10.0


def test_a_tile_without_measured_trees_falls_back_on_the_tables_ratios():
    from bake.trees import size_stats

    stats = size_stats([])
    assert stats.arch_r[ta.PINE] == pytest.approx(allometry.table()["crown_ratio"]["6"])
    assert stats.genus_h["Tilia"] == allometry.table()["genus_h"]["Tilia"]
    assert stats.arch_r.get(99, DEFAULT_RATIO) == DEFAULT_RATIO


# --- the surface model's say ------------------------------------------------------


def _surface(fill=0.0, green=None):
    ndom = np.full((100, 100), fill)
    return ndom, Surface(ndom, green)


def test_a_stale_height_becomes_the_surface_models():
    ndom, surface = _surface()
    ndom[50, 50] = 18.0  # the crown over the trunk at (50.5, 49.5)
    (tree,) = _trees(_register(50.5, 49.5, h=8.0, d=7.0))
    kept, sizes, done = surface_check([tree], [(8.0, 7.0)], surface, BOUNDS, STATS)
    assert done.stale == 1 and sizes == [(18.0, 7.0)]
    assert kept[0]["h"] == 18.0  # measured now: the facts' bit
    # within max(5 m, 30 %) the register's height stands
    ndom[50, 50] = 12.0
    (tree,) = _trees(_register(50.5, 49.5, h=8.0, d=7.0))
    assert surface_check([tree], [(8.0, 7.0)], surface, BOUNDS, STATS)[1] == [(8.0, 7.0)]


def test_a_saplings_height_is_not_its_neighbours_crown():
    ndom, surface = _surface()
    ndom[50, 50] = 14.0
    # a 5 cm trunk: at most TRUNK_LIMIT × the allometry's ~4 m
    (sapling,) = _trees(_register(50.5, 49.5, h=4.0, d=6.0, trunk=5))
    _, sizes, done = surface_check([sapling], [(4.0, 6.0)], surface, BOUNDS, STATS)
    assert done.stale == 0 and sizes == [(4.0, 6.0)]
    # nor a roof's or a bridge's (masked): nothing to measure there
    ndom[50, 50] = np.nan
    (tree,) = _trees(_register(50.5, 49.5, h=8.0, d=7.0))
    _, _, done = surface_check([tree], [(8.0, 7.0)], surface, BOUNDS, STATS)
    assert (done.stale, done.absent) == (0, 0)


def test_a_tree_the_surface_model_must_see_and_does_not_is_gone():
    ndom, surface = _surface(ABSENT_H / 2)
    tall, young_trunk, osm = _trees(
        _register(20.5, 20.5, h=14.0, d=8.0),
        _register(60.5, 60.5, trunk=8),  # a thin trunk: the allometry's ~5 m
        _register(80.5, 80.5, h=14.0, d=8.0),
    )
    osm["src"] = "osm"
    trees = [tall, young_trunk, osm]
    sizes = impute(trees, STATS)[0]
    kept, _, done = surface_check(trees, sizes, surface, BOUNDS, STATS)
    assert done.absent == 1 and kept == [young_trunk, osm]
    # the orthophoto's green says a crown stands there after all
    green = np.full((50, 50), 0.6)
    (tall,) = _trees(_register(20.5, 20.5, h=14.0, d=8.0))
    _, _, done = surface_check([tall], [(14.0, 8.0)], Surface(ndom, green), BOUNDS, STATS)
    assert done.absent == 0
    # planted the other year: the flight may predate it
    (tall,) = _trees(_register(20.5, 20.5, h=14.0, d=8.0))
    tall["planted"] = 2025
    _, _, done = surface_check([tall], [(14.0, 8.0)], surface, BOUNDS, STATS)
    assert done.absent == 0


def test_without_a_register_the_osm_trees_are_measured_in_the_surface_model():
    from bake.trees import Census

    ndom, surface = _surface()
    ndom[50, 50] = 11.0
    lime = osm_tree(50.5, 49.5, '"natural"=>"tree","genus"=>"Tilia"')
    assert lime is not None
    rows, sizes = sized_trees([], [lime], surface, BOUNDS, census := Census())
    assert census.measured == 1 and rows == [lime]
    assert sizes[0][0] == 11.0
    # its crown from the table's ratio for its archetype
    assert sizes[0][1] == pytest.approx(11.0 * allometry.table()["crown_ratio"]["0"])


# --- the OSM trees' clearance -------------------------------------------------------


def test_an_osm_tree_under_a_register_crown_is_that_tree():
    raw = {
        "features": [
            _register(0.0, 0.0, h=20.0, d=12.0),  # a 6 m crown radius
            _register(50.0, 0.0, h=6.0, d=3.0),  # 1.5 m: the 3 m floor
        ]
    }
    points = cadastre_points(raw, DRESDEN)
    assert points[:, 2].tolist() == [6.0, 1.5]
    tags = '"natural"=>"tree","genus"=>"Tilia"'
    osm = [osm_tree(x, 0.0, tags) for x in (5.0, 7.0, 52.5, 54.0)]
    kept = complement([t for t in osm if t], points)
    assert [t["x"] for t in kept] == [7.0, 54.0]


# --- the conifers' forms ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("botanical", "german", "form"),
    [
        ("Pinus sylvestris", "Wald-Kiefer", ta.PINE),
        ("Pinus nigra", "Schwarz-Kiefer", ta.PINE),
        ("Pinus species", "", ta.PINE),
        ("Pinus mugo", "Berg-Kiefer", ta.BUSH),
        ("Pinus cembra", "Zirbel-Kiefer", ta.CONIFER),
        ("Pinus sylvestris 'Fastigiata'", "", ta.COLUMNAR),
        ("Taxus baccata", "Gemeine Eibe", ta.BUSH),
        ("Taxus baccata 'Fastigiata'", "Säulen-Eibe", ta.COLUMNAR),
        ("Juniperus x pfitzeriana", "", ta.BUSH),
        ("Juniperus communis", "", ta.CONIFER),
        ("Picea abies", "Gemeine Fichte", ta.CONIFER),
        ("Picea abies 'Nana'", "", ta.BUSH),
        ("Abies alba", "", ta.CONIFER),
        ("Thuja occidentalis 'Smaragd'", "", ta.CONIFER),
        ("Chamaecyparis lawsoniana", "", ta.CONIFER),
        ("Larix decidua", "", ta.CONIFER),
        ("Pseudotsuga menziesii", "", ta.CONIFER),
        ("Cryptomeria japonica", "", ta.CONIFER),
    ],
)
def test_a_conifers_form_is_its_genuss(botanical, german, form):
    c = ta.classify(botanical, german)
    assert c["archetype"] == form, ta.ARCHETYPES[c["archetype"]]
    assert not c["globe"]  # a dwarf conifer is a bush from the ground


def test_the_archetype_list_only_grows():
    assert ta.ARCHETYPES[:6] == ["round", "oval", "columnar", "conifer", "weeping", "small"]
    assert ta.ARCHETYPES[ta.PINE] == "pine" and ta.ARCHETYPES[ta.BUSH] == "bush"


def test_a_tristis_cultivar_weeps_whatever_follows_its_name():
    assert ta.classify("Salix alba 'Tristis Resistenta'", "Silber-Weide")["archetype"] == ta.WEEPING
    assert ta.classify("Salix alba 'Tristis'")["archetype"] == ta.WEEPING
    assert ta.classify("Betula pendula")["archetype"] == ta.OVAL  # the upright birch


# --- a conifer's form in the surface model ------------------------------------------


def _crown(profile, top=20.0, size=41):
    """An nDOM with one crown in the middle: `profile(rho)` its surface."""
    yy, xx = np.mgrid[:size, :size]
    rho = np.hypot(yy - size // 2, xx - size // 2)
    return np.maximum(profile(rho, top), 0.0)


def test_a_pines_top_is_flat_a_spruces_falls_away():
    from bake import crown_form

    spruce = _crown(lambda rho, top: top - 3.5 * rho)  # a cone, 0.29 of its height across
    pine = _crown(lambda rho, top: np.where(rho < 6, top - 0.1 * rho**2, top - 3.6 - 3 * (rho - 6)))
    assert crown_form.ring_drop(spruce, 20, 20, 20.0) == pytest.approx(0.7, abs=0.05)
    assert not crown_form.flat_topped(spruce, 20, 20, 20.0)
    assert crown_form.flat_topped(pine, 20, 20, 20.0)
    # the canopy's evergreens are marked; a broadleaf or an evergreen cone not
    leaves = crown_form.mark_pines(
        [{"l": "e"}, {}, {"l": "e", "ls": "dop"}],
        np.hstack([pine, pine, spruce]),
        np.array([20, 20, 20]),
        np.array([20, 20, 102]),
        np.array([20.0, 20.0, 20.0]),
    )
    assert leaves == [{"l": "e", "pine": 1}, {}, {"l": "e", "ls": "dop"}]
    # a crown at the raster's edge with half its ring outside is not told
    assert crown_form.ring_drop(pine, 0, 0, 20.0) is None


def test_an_osm_conifer_of_no_genus_takes_the_pines_crown_where_its_top_is_flat():
    from bake.trees import conifer_form

    pine = _crown(lambda rho, top: np.where(rho < 6, top - 0.1 * rho**2, top - 3.6 - 3 * (rho - 6)))
    bounds = (0.0, 0.0, 41.0, 41.0)
    needles = osm_tree(20.5, 20.5, '"natural"=>"tree","leaf_type"=>"needleleaved"')
    spruce = osm_tree(20.5, 20.5, '"natural"=>"tree","genus"=>"Picea"')
    assert needles is not None and spruce is not None
    assert conifer_form(needles, pine, bounds, 6.0) and needles["archetype"] == ta.PINE
    # a known genus keeps its form, whatever the model shows
    assert not conifer_form(spruce, pine, bounds, 6.0) and spruce["archetype"] == ta.CONIFER
