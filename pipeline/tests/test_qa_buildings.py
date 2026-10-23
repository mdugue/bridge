"""The photo QA's building rules (PR #173): the roofs on posts LoD2 lacks
(Unna's platform roofs) and the buildings newer than the surface model
(Hamburg's Überseequartier), measured on a synthetic field."""

import numpy as np
import shapely

from bake import structures
from bake.skyview import Field

X0, Y0, N = 400000.0, 5600000.0, 100  # 100 m at 1 m
GROUND = 100.0


def surfaces(dom: np.ndarray, roof: np.ndarray | None = None) -> structures.Surfaces:
    s = structures.Surfaces.__new__(structures.Surfaces)
    s.field = Field((X0, Y0, X0 + N, Y0 + N), 1.0)
    s.ground = np.full((N, N), GROUND, np.float32)
    s.roof = (np.full((N, N), np.nan) if roof is None else roof).astype(np.float32)
    s.dom = dom.astype(np.float32)
    s.above = s.dom - s.ground
    s.gap = s.dom - np.fmax(s.ground, s.roof)
    s.green = np.zeros((N, N), bool)  # no crowns
    return s


def cell_box(r0, c0, rows, cols):
    """A polygon over grid cells (row 0 at the north edge)."""
    return shapely.box(X0 + c0, Y0 + N - (r0 + rows), X0 + c0 + cols, Y0 + N - r0)


def field(*boxes):
    """The surface model: the ground, raised to `top` over each (r0, c0,
    rows, cols, top)."""
    dom = np.full((N, N), GROUND, np.float32)
    for r0, c0, rows, cols, top in boxes:
        dom[r0 : r0 + rows, c0 : c0 + cols] = top
    return dom


def outline(geom, kind, other=None, name=None):
    return (geom, kind, name, other)


def find(s, *outlines):
    return structures.missing(s, list(outlines), lambda x, y: True)


def test_a_platform_roof_lod2_lacks_stands_at_its_measured_height():
    # 80 × 8 m at 5.8 m over the platform: Unna's platform roofs
    s = surfaces(field((40, 10, 8, 80, GROUND + 5.8)))
    (f,) = find(s, outline(cell_box(40, 10, 8, 80), "roof", '"layer"=>"1"'))
    p = f["properties"]
    assert p["kind"] == "roof"
    assert p["z"] == GROUND
    assert abs(p["h"] - 5.8) < 0.05
    assert f["geometry"]["type"] == "Polygon"


def test_a_roof_lod2_draws_is_left_to_it():
    roof = np.full((N, N), np.nan)
    roof[40:48, 10:90] = GROUND + 5.8
    s = surfaces(field((40, 10, 8, 80, GROUND + 5.8)), roof)
    assert find(s, outline(cell_box(40, 10, 8, 80), "roof")) == []


def test_a_crown_over_a_carport_is_no_roof():
    # a dome: its middle half spreads over metres
    dom = np.full((N, N), GROUND, np.float32)
    rr, cc = np.mgrid[0:N, 0:N]
    r = np.hypot(rr - 50, cc - 50)
    dom[r < 6] = GROUND + 9 - (r[r < 6] ** 2) / 6
    s = surfaces(dom)
    assert find(s, outline(cell_box(46, 46, 8, 8), "carport")) == []


def test_a_shelter_under_a_tree_is_too_high_for_one():
    s = surfaces(field((40, 40, 5, 5, GROUND + 8.0)))
    assert find(s, outline(cell_box(40, 40, 5, 5), "shelter")) == []
    # the same height is a platform roof's
    (f,) = find(s, outline(cell_box(40, 40, 5, 5), "roof"))
    assert f["properties"]["kind"] == "roof"


def test_a_roof_the_surface_model_does_not_show_is_left_out():
    s = surfaces(field())
    assert find(s, outline(cell_box(40, 10, 8, 80), "roof")) == []


def test_a_building_the_model_measured_stands_at_its_measured_height():
    s = surfaces(field((20, 20, 30, 30, GROUND + 12.0)))
    (f,) = find(s, outline(cell_box(20, 20, 30, 30), "yes", '"building:levels"=>"4"'))
    p = f["properties"]
    assert p["kind"] == "building"
    assert abs(p["h"] - 12.0) < 0.05
    assert "src" not in p


def test_a_building_newer_than_the_model_takes_osms_height():
    # The Lyte: 16 storeys, a 21.6 m shell on the flight
    s = surfaces(field((20, 20, 30, 30, GROUND + 21.6)))
    (f,) = find(s, outline(cell_box(20, 20, 30, 30), "apartments", '"building:levels"=>"16"'))
    p = f["properties"]
    assert p["src"] == "osm"
    assert abs(p["h"] - 16 * structures.LEVEL_M) < 0.05
    # … and one the model saw as a pit, at its mapped height
    s = surfaces(field())
    (f,) = find(s, outline(cell_box(20, 20, 30, 30), "commercial", '"height"=>"18 m"'))
    assert f["properties"]["src"] == "osm"
    assert f["properties"]["h"] == 18.0


def test_a_building_osm_maps_no_height_of_needs_the_model():
    s = surfaces(field())
    assert find(s, outline(cell_box(20, 20, 30, 30), "yes")) == []


def test_a_raised_part_starts_at_its_floor_and_a_site_is_no_building():
    # a bridge between two buildings: the street under it stays open
    s = surfaces(field((20, 20, 30, 30, GROUND + 12.0)))
    box = cell_box(20, 20, 30, 30)
    tags = '"building:min_level"=>"2","building:levels"=>"4"'
    (f,) = find(s, outline(box, "yes", tags))
    assert f["properties"]["base"] == 2 * structures.LEVEL_M
    assert f["properties"]["h"] == 12.0
    (f,) = find(s, outline(box, "yes", '"min_height"=>"7","height"=>"12"'))
    assert f["properties"]["base"] == 7.0
    # a floor as high as its top is no part to draw
    assert find(s, outline(box, "yes", '"min_height"=>"11"')) == []
    (f,) = find(s, outline(box, "yes"))
    assert "base" not in f["properties"]
    assert find(s, outline(box, "construction", '"building:levels"=>"4"')) == []


def test_a_block_mapped_over_its_parts_is_left_out():
    s = surfaces(field((20, 20, 30, 15, GROUND + 12.0), (20, 35, 30, 15, GROUND + 18.0)))
    found = find(
        s,
        outline(cell_box(20, 20, 30, 30), "yes"),
        outline(cell_box(20, 20, 30, 15), "yes"),
        outline(cell_box(20, 35, 30, 15), "yes"),
    )
    assert sorted(f["properties"]["h"] for f in found) == [12.0, 18.0]


def test_mapped_heights():
    assert structures.mapped_height('"height"=>"52.5 m"') == 52.5
    assert structures.mapped_height('"building:levels"=>"5"') == 5 * structures.LEVEL_M
    assert structures.mapped_height('"building:levels"=>"2","roof:levels"=>"1"') == (
        2.5 * structures.LEVEL_M
    )
    assert structures.mapped_height('"building:levels"=>"4-5"') is None
    assert structures.mapped_height('"height"=>"0.5"') is None
    assert structures.mapped_height(None) is None


def test_a_shelter_is_a_roof_on_posts_unless_it_is_a_hut():
    assert (
        structures.outline_kind(None, "shelter", '"shelter_type"=>"public_transport"') == "shelter"
    )
    assert structures.outline_kind("yes", "shelter", None) == "shelter"
    assert structures.outline_kind("hut", "shelter", '"shelter_type"=>"basic_hut"') == "hut"
    assert structures.outline_kind("roof", None, None) == "roof"
    # a building part stands for its piece of a block
    assert structures.outline_kind(None, None, '"building:part"=>"hotel"') == "hotel"
    assert structures.outline_kind(None, None, '"building:part"=>"roof"') == "roof"
    assert structures.outline_kind(None, None, '"building:part"=>"no"') is None
    assert structures.outline_kind(None, None, None) is None


def test_a_building_osm_dates_old_keeps_the_models_height():
    # Munich's Karolinenplatz obelisk: 1833, mapped 29 m, a needle in the model
    s = surfaces(field((40, 40, 1, 1, GROUND + 29.0)))
    box = cell_box(35, 35, 11, 11)
    assert find(s, outline(box, "yes", '"height"=>"29","start_date"=>"1833"')) == []
    # a shell the model measured, dated old: the measurement, not the tag
    s = surfaces(field((20, 20, 30, 30, GROUND + 7.0)))
    tags = '"building:levels"=>"4","start_date"=>"~1730"'
    (f,) = find(s, outline(cell_box(20, 20, 30, 30), "apartments", tags))
    assert f["properties"]["h"] == 7.0
    assert "src" not in f["properties"]
    # a recent date is no objection
    tags = '"height"=>"50","start_date"=>"2026-04"'
    (f,) = find(s, outline(cell_box(20, 20, 30, 30), "storage_tank", tags))
    assert f["properties"]["src"] == "osm"


def test_a_low_outline_the_model_does_not_show_is_left_out():
    s = surfaces(field())
    box = cell_box(20, 20, 30, 30)
    # a garage deck in a courtyard, one storey
    assert find(s, outline(box, "garage", '"building:levels"=>"1"')) == []
    # two storeys of containers since the flight
    (f,) = find(s, outline(box, "school", '"building:levels"=>"2"'))
    assert f["properties"]["h"] == 2 * structures.LEVEL_M


def test_dates():
    assert structures.dated_before('"start_date"=>"1833"', 2010)
    assert structures.dated_before('"start_date"=>"~1900"', 2010)
    assert not structures.dated_before('"start_date"=>"2026-04-01"', 2010)
    assert not structures.dated_before('"start_date"=>"C19"', 2010)
    assert not structures.dated_before(None, 2010)


def test_a_building_off_the_models_edge_keeps_to_the_model():
    # half of it past the last tile: no measurement there, no evidence the
    # flight predates it (Dresden's Gerhart-Potthoff-Bau)
    dom = field((20, 20, 30, 30, GROUND + 17.0))
    dom[:, 35:] = np.nan
    s = surfaces(dom)
    box = cell_box(20, 20, 30, 30)
    assert find(s, outline(box, "university", '"building:levels"=>"4"')) == []


def test_a_storey_short_of_osms_count_keeps_the_models_height():
    # Dresden's air shaft: 2 levels mapped, 2.8 m measured on all of it
    s = surfaces(field((20, 20, 12, 9, GROUND + 2.8)))
    box = cell_box(20, 20, 12, 9)
    (f,) = find(s, outline(box, "air_shaft", '"building:levels"=>"2"'))
    assert f["properties"]["h"] == 2.8
    assert "src" not in f["properties"]
    # two storeys short is still going up
    s = surfaces(field((20, 20, 30, 30, GROUND + 7.2)))
    (f,) = find(s, outline(cell_box(20, 20, 30, 30), "apartments", '"building:levels"=>"4"'))
    assert f["properties"]["src"] == "osm"
