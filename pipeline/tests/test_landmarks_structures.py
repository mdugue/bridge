"""Plan 038's pure parts: OSM looks, Wikidata materials and the fetch's
quartering, the column and roof-relief measurements on a synthetic field."""

import json

import numpy as np
import shapely

from bake import landmarks, structures
from bake.osm_buildings import colour_of
from bake.osm_buildings import material_of as osm_material
from bake.skyview import Field

X0, Y0, N = 400000.0, 5600000.0, 100  # 100 m at 1 m
GROUND = 100.0


def surfaces(dom: np.ndarray, roof: np.ndarray) -> structures.Surfaces:
    s = structures.Surfaces.__new__(structures.Surfaces)
    s.field = Field((X0, Y0, X0 + N, Y0 + N), 1.0)
    s.ground = np.full((N, N), GROUND, np.float32)
    s.roof = roof.astype(np.float32)
    s.dom = dom.astype(np.float32)
    s.above = s.dom - s.ground
    s.gap = s.dom - np.fmax(s.ground, s.roof)
    return s


def cell_box(r0, c0, rows, cols):
    """A polygon over grid cells (row 0 at the north edge)."""
    return shapely.box(X0 + c0, Y0 + N - (r0 + rows), X0 + c0 + cols, Y0 + N - r0)


def test_osm_colours_and_materials():
    assert colour_of("#abc") == "#aabbcc"
    assert colour_of("#A0B1C2;red") == "#a0b1c2"
    assert colour_of("white") is not None
    assert colour_of("sort of blue") is None
    assert osm_material('"building:material"=>"brick"') == "brick"
    assert osm_material('"facade:material"=>"glass"') == "glass"
    assert osm_material('"building:material"=>"unobtainium"') is None


def test_wikidata_material_reads_the_facade():
    # the glass a facade shows wins over what carries it
    assert landmarks.material_of(["reinforced concrete", "steel", "glass"]) == "glass"
    assert landmarks.material_of(["reinforced concrete"]) == "concrete"
    assert landmarks.material_of(["brick", "sandstone"]) == "brick"
    assert landmarks.material_of([]) is None


def test_a_timed_out_box_is_asked_again_in_quarters(monkeypatch):
    asked = []

    class Answer:
        def __init__(self, rows):
            self.body = json.dumps({"results": {"bindings": rows}}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self, *_):
            return self.body

    def urlopen(req, timeout):
        asked.append(req.full_url)
        if len(asked) == 1:
            raise OSError("HTTP Error 504: Gateway Timeout")
        return Answer([{"i": {"value": f"Q{len(asked)}"}}])

    monkeypatch.setattr(landmarks.urllib.request, "urlopen", urlopen)
    rows = landmarks.query_box((13.0, 13.1), (51.0, 51.1))
    assert len(asked) == 5
    assert len(rows) == 4


def test_a_chimney_beside_a_hall_is_measured():
    roof = np.full((N, N), np.nan)
    roof[40:60, 40:60] = GROUND + 8  # the brewery hall LoD2 draws
    dom = np.where(np.isfinite(roof), roof, GROUND)
    dom[48:50, 62:64] = GROUND + 48  # the shaft LoD2 leaves out
    s = surfaces(dom, roof)
    point = shapely.Point(X0 + 63, Y0 + N - 49)
    f = structures.column(s, point, "chimney", '"name"=>"Schlot"')
    assert f is not None
    p = f["properties"]
    assert p["h"] == 48
    assert p["z"] == GROUND
    # thicker than the 1 m model saw it: a twelfth of its height across
    assert p["r"] >= 48 / 24
    assert p["name"] == "Schlot"
    # the hall's own roof is no chimney
    assert structures.column(s, shapely.Point(X0 + 50, Y0 + 50), "chimney", None) is None


def test_a_landmarks_measured_roof_becomes_slabs():
    roof = np.full((N, N), np.nan)
    roof[20:80, 20:80] = GROUND + 30  # LoD2: a flat block
    dom = np.where(np.isfinite(roof), roof, GROUND)
    dom[30:60, 25:75] = GROUND + 36  # the wave the block flattens
    dom[35:50, 35:60] = GROUND + 40
    s = surfaces(dom, roof)
    outline = cell_box(20, 20, 60, 60)
    slabs = structures.relief(s, outline, "DEBY_obj")
    assert slabs
    assert {f["properties"]["kind"] for f in slabs} == {"relief"}
    assert {f["properties"]["of"] for f in slabs} == {"DEBY_obj"}
    tops = [f["properties"]["z"] + f["properties"]["h"] for f in slabs]
    bases = [f["properties"]["z"] for f in slabs]
    assert min(bases) >= GROUND + 30 - 1e-6
    assert max(tops) <= GROUND + 40 + 1e-6
    assert max(tops) >= GROUND + 38
    # the highest slabs are the smaller crest
    top = max(slabs, key=lambda f: f["properties"]["z"])
    assert shapely.geometry.shape(top["geometry"]).area < 25 * 15 * 1.3


def test_an_ordinary_roofs_antennas_make_no_relief():
    roof = np.full((N, N), np.nan)
    roof[20:80, 20:80] = GROUND + 30
    dom = np.where(np.isfinite(roof), roof, GROUND)
    dom[40:42, 40:42] = GROUND + 45  # an antenna, a dormer
    s = surfaces(dom, roof)
    assert structures.relief(s, cell_box(20, 20, 60, 60), "x") == []


def test_a_landmark_point_beside_its_building_finds_it():
    city = {"CityObjects": {"hall": {"children": ["part"]}, "part": {"parents": ["hall"]}}}
    ids = ["part"]
    polys = [shapely.box(0, 0, 20, 20)]
    tree = shapely.STRtree(polys)
    item = {"id": "Q1", "building": True, "x": 30.0, "y": 10.0}
    assert landmarks.matched_objects(item, city, ids, polys, tree, {}) == ["part"]
    far = {**item, "x": 60.0}
    assert landmarks.matched_objects(far, city, ids, polys, tree, {}) == []
    # a district or a cemetery is not looked for beside
    assert landmarks.matched_objects({**item, "building": False}, city, ids, polys, tree, {}) == []


def test_courtyard_trees_under_the_top_make_no_relief():
    roof = np.full((N, N), np.nan)
    roof[20:80, 20:80] = GROUND + 30  # the wings
    roof[35:65, 35:65] = GROUND + 12  # the courtyard's low roof
    dom = np.where(np.isfinite(roof), roof, GROUND)
    dom[38:62, 38:62] = GROUND + 26  # its trees, over a third of it
    s = surfaces(dom, roof)
    assert structures.relief(s, cell_box(20, 20, 60, 60), "x") == []
