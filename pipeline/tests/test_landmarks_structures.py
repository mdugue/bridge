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


def test_a_landmarks_measured_roof_becomes_a_height_field():
    roof = np.full((N, N), np.nan)
    roof[20:80, 20:80] = GROUND + 30  # LoD2: a flat block
    dom = np.where(np.isfinite(roof), roof, GROUND)
    dom[30:60, 25:75] = GROUND + 36  # the wave the block flattens
    dom[35:50, 35:60] = GROUND + 40
    s = surfaces(dom, roof)
    (f,) = structures.relief(s, cell_box(20, 20, 60, 60), "DEBY_obj")
    p = f["properties"]
    assert p["kind"] == "relief"
    assert p["of"] == "DEBY_obj"
    assert p["z"] == GROUND + 30  # on the object's highest roof
    grid = p["grid"]
    z = np.array(grid["z"]).reshape(grid["rows"], grid["cols"])
    assert grid["rows"] == 30 and grid["cols"] == 50  # the patch's window
    assert (z >= 0).sum() >= 30 * 50 - 4  # the opening rounds the corners
    # the crest keeps (nearly) its measured height, the shoulder its own
    assert 9 <= z.max() <= 10
    assert 5.5 <= z[2, 2] <= 6.5
    assert p["h"] == z.max()
    # the grid sits where the patch is: its north-west corner
    assert grid["x"] == X0 + 25 and grid["y"] == Y0 + N - 30


def test_a_spire_keeps_its_tip():
    roof = np.full((N, N), np.nan)
    roof[40:60, 40:60] = GROUND + 30  # LoD2 cut the tower at its eaves
    dom = np.where(np.isfinite(roof), roof, GROUND)
    for r in range(8):  # a stepped cone, 40 m above the eaves at its tip
        dom[42 + r : 58 - r, 42 + r : 58 - r] = GROUND + 30 + 5 * (r + 1)
    s = surfaces(dom, roof)
    (f,) = structures.relief(s, cell_box(40, 40, 20, 20), "tower")
    z = np.array(f["properties"]["grid"]["z"])
    assert z.max() >= 32  # most of the 40 m survives the smoothing


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


def test_two_scans_merge_into_one_with_their_classes_and_scaled_intensity(tmp_path):
    import laspy

    from bake.lsc import merge_laz

    def scan(path, x0, offset):
        header = laspy.LasHeader(point_format=1, version="1.2")
        header.scales = [0.01, 0.01, 0.01]
        header.offsets = [offset, 5_000_000, 0]
        las = laspy.LasData(header)
        las.x = np.array([x0, x0 + 1.5])
        las.y = np.array([5_710_000.0, 5_710_001.0])
        las.z = np.array([100.0, 112.5])
        las.intensity = np.array([32_000, 48_000], np.uint16)
        las.classification = np.array([2, 20], np.uint8)
        las.return_number = np.array([1, 1], np.uint8)
        las.number_of_returns = np.array([1, 2], np.uint8)
        las.write(path)
        return path

    a = scan(tmp_path / "a.laz", 408_000.0, 400_000)
    b = scan(tmp_path / "b.laz", 409_000.0, 409_000)
    out = merge_laz([a, b], tmp_path / "m.laz", intensity_scale=1 / 16)
    las = laspy.read(out)
    assert len(las.points) == 4
    assert sorted(np.round(las.x, 2)) == [408_000, 408_001.5, 409_000, 409_001.5]
    assert list(las.classification) == [2, 20, 2, 20]
    assert list(las.intensity) == [2000, 3000, 2000, 3000]
    assert list(las.number_of_returns) == [1, 2, 1, 2]


def test_a_foot_under_a_lod2_roof_is_told_from_one_in_the_open():
    roof = np.full((N, N), np.nan)
    roof[40:60, 40:60] = GROUND + 30  # a church, its tower in LoD2
    dom = np.where(np.isfinite(roof), roof, GROUND)
    dom[49:51, 49:51] = GROUND + 45  # the spire's tip above it
    s = surfaces(dom, roof)
    foot = shapely.Point(X0 + 50, Y0 + N - 50)
    assert s.under_roof(foot)
    assert not s.under_roof(shapely.Point(X0 + 10, Y0 + 10))
    assert not s.under_roof(shapely.Point(X0 - 500, Y0))  # off the field
