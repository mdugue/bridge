"""Plan 050's pure parts: OSM looks, Wikidata materials and the fetch's
quartering, the landmarks Wikidata knows as gone; the structures beyond
LoD2 (structures.py) on a synthetic field: columns, roof relief, the roofs
on posts and the buildings newer than the surface model, the shaped roofs
of missing buildings and the lattices."""

import json
from types import SimpleNamespace

import numpy as np
import shapely

from bake import landmarks, structures
from bake.osm_buildings import colour_of
from bake.osm_buildings import material_of as osm_material
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


def test_a_tower_folded_into_a_pitched_roof_stands_on_the_slope():
    # LoD2 drew the church as one gabled block (ridge 37 m, eaves 22 m);
    # the tower above its west end is only in the surface model, with a
    # sound opening the laser saw through to the ground
    roof = np.full((N, N), np.nan)
    for r in range(30, 70):
        roof[r, 30:70] = GROUND + 37 - abs(r - 50) * 0.75
    dom = np.where(np.isfinite(roof), roof, GROUND)
    dom[35:50, 30:45] = GROUND + 47
    dom[42, 40] = GROUND  # the sound opening
    s = surfaces(dom, roof)
    (f,) = structures.relief(s, cell_box(30, 30, 40, 40), "church")
    p = f["properties"]
    grid = p["grid"]
    z = np.array(grid["z"]).reshape(grid["rows"], grid["cols"])
    floor = np.array(grid["floor"]).reshape(grid["rows"], grid["cols"])
    assert (grid["rows"], grid["cols"]) == (15, 15)
    # no shaft where the opening was
    assert (z[1:-1, 1:-1] >= 8).all()
    # the north face stands far down the slope, the south one near the ridge
    assert p["z"] + floor[0].mean() < GROUND + 26.5
    assert p["z"] + floor[-1].mean() > GROUND + 35
    assert (floor[z >= 0] < z[z >= 0]).all()


def test_unmapped_walls_take_their_neighbourhoods_material():
    from bake.osm_buildings import apply_contexts

    def outline(x, y, material):
        return (shapely.box(x, y, x + 10, y + 10), {"material": material}, False)

    # a brick quarter in the west, a plaster one 2 km east, glass in between
    outlines = [outline(i * 20, 0, "brick") for i in range(12)]
    outlines += [outline(2000 + i * 20, 0, "plaster") for i in range(10)]
    outlines += [outline(1000 + i * 20, 0, "glass") for i in range(30)]
    ids = ["west", "east", "between", "mapped"]
    polys = [
        shapely.box(100, 50, 110, 60),
        shapely.box(2100, 50, 2110, 60),
        shapely.box(1100, 50, 1110, 60),
        shapely.box(2050, 50, 2060, 60),
    ]
    objects = {"mapped": {"material": "plaster"}}
    default, differ = apply_contexts(objects, ids, polys, outlines)
    # 12 brick against 10 plaster votes: the area is brick; glass does not vote
    assert default == "brick"
    assert "context" not in objects.get("west", {})
    assert objects["east"]["context"] == "render"
    # too few mapped walls near the glass towers: the area's walls
    assert "context" not in objects.get("between", {})
    # a mapped material is kept
    assert "context" not in objects["mapped"]
    assert differ == 1


def test_a_dense_tile_keeps_its_second_rank_and_a_small_town_its_few():
    city = [{"links": n} for n in (120, 80, 40, 15, 9, 3)]
    assert landmarks.notable_floor(city) == 120 * landmarks.NOTABLE_SHARE
    town = [{"links": n} for n in (6, 3, 2)]
    assert landmarks.notable_floor(town) == landmarks.MIN_SITELINKS


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


def _surfaces(dom: np.ndarray, ground: float = 100.0):
    """A stand-in for structures.Surfaces on a 1 m grid from (0, rows)."""
    rows, cols = dom.shape
    field = SimpleNamespace(xmin=0.0, ymax=float(rows), res=1.0)
    return SimpleNamespace(
        field=field,
        dom=dom,
        above=dom - ground,
        green=np.zeros(dom.shape, bool),
        mask=lambda geom, win: _inside(dom.shape, geom)[win],
    )


def _inside(shape, geom) -> np.ndarray:
    rows, cols = shape
    yy, xx = np.mgrid[0:rows, 0:cols]
    pts = shapely.points(xx.ravel() + 0.5, rows - (yy.ravel() + 0.5))
    return shapely.contains(geom, pts).reshape(shape)


def _wing_and_hall():
    """A flat wing at 110, a pitched hall: the outline, its surface model,
    the cells inside it and its window."""
    rows, cols = 34, 50
    geom = shapely.box(5, 5, 45, 29)
    dom = np.full((rows, cols), 100.0)
    x = np.arange(cols) + 0.5
    roof = np.where(x < 19, 110.0, 108.0 + 0.4 * (x - 19))
    inside = _inside((rows, cols), geom)
    dom[inside] = np.broadcast_to(roof, (rows, cols))[inside]
    return dom, geom, inside, (slice(0, rows), slice(0, cols))


def test_a_missing_buildings_roof_takes_the_shape_the_surface_model_shows():
    # 40 × 24 m: a flat wing 10 m up over its west 14 m, a mono-pitch hall
    # east of it rising 0.4 m a metre from 8 m
    dom, geom, inside, win = _wing_and_hall()
    parts = structures.shaped_roof(_surfaces(dom), geom, win, inside, 100.0, 110.0)
    assert parts is not None
    assert len(parts) >= 2
    flat = [p for p in parts if "surface" not in p]
    faces = [p for p in parts if "surface" in p]
    assert flat and faces
    assert any(abs(p["z"] - 110) < 0.5 for p in flat)
    s = faces[0]["surface"]
    assert len(s["dz"]) == s["cols"] * s["rows"]
    # each part inside the outline
    for p in parts:
        assert shapely.Polygon(p["coordinates"][0]).difference(geom.buffer(0.01)).area < 0.01


def test_a_level_roof_stays_the_flat_box():
    rows, cols = 30, 30
    geom = shapely.box(5, 5, 25, 25)
    dom = np.full((rows, cols), 100.0)
    inside = _inside((rows, cols), geom)
    dom[inside] = 112.0
    win = (slice(0, rows), slice(0, cols))
    assert structures.shaped_roof(_surfaces(dom), geom, win, inside, 100.0, 112.0) is None


def test_a_lattice_over_a_roof_stands_on_what_lies_under_it(monkeypatch):
    # the wing 7 m over the building's height: a mast's rigging where the
    # model shows a lattice, a roof where it fills it
    dom, geom, inside, win = _wing_and_hall()

    def flats(under):
        monkeypatch.setattr(structures, "lattice", lambda *_: under)
        parts = structures.shaped_roof(_surfaces(dom), geom, win, inside, 100.0, 103.0)
        return [p["z"] for p in parts if "surface" not in p]

    # on a roof the model shows under the rigging; on the ground (or
    # nothing) at the building's height
    assert any(abs(z - 106) < 0.01 for z in flats(106.0))
    assert any(abs(z - 103) < 0.01 for z in flats(101.0))
    assert any(abs(z - 103) < 0.01 for z in flats(-np.inf))
    assert any(abs(z - 110) < 0.5 for z in flats(None))


def test_a_lattice_is_a_surface_the_model_fills_sparsely():
    dom = np.full((20, 20), 108.0)
    geom = shapely.box(5, 5, 11, 11)
    win = (slice(0, 20), slice(0, 20))
    s = _surfaces(dom)
    dom[9:15:3, 5:11] = 135.0  # every third row of a 6 m square: rigging
    assert structures.lattice(s, win, geom, 135.0) == 108.0  # on the roof under it
    dom[9:15, 5:11] = 135.0  # the whole square: a plant room, a tower
    assert structures.lattice(s, win, geom, 135.0) is None


def test_rigging_at_every_height_stands_on_no_level_of_its_own():
    # a ship's masts: the model reads its rigging from the deck to the
    # mast tops, no level held by as many cells as a roof — it stands at
    # the building's height, not at the cells' median
    dom = np.full((20, 20), np.nan)
    geom = shapely.box(4, 4, 16, 16)
    win = (slice(0, 20), slice(0, 20))
    rng = np.random.default_rng(3)
    dom[4:16, 4:16] = rng.uniform(9.0, 33.0, (12, 12))
    dom[4:16:4, 4:16] = 34.0  # the yards at the top, sparse
    s = _surfaces(dom)
    assert structures.lattice(s, win, geom, 34.0) == -np.inf
    # a deck the model shows on half its cells holds it
    dom[4:16:2, 4:16] = 9.0
    assert abs(structures.lattice(_surfaces(dom), win, geom, 34.0) - 9.0) < 0.01


# --- landmarks -----------------------------------------------------------


def test_what_wikidata_knows_as_gone():
    assert landmarks.gone({"states": [landmarks.DEMOLISHED]}) is True
    # destroyed 1945 and restored: the Frauenkirche
    assert landmarks.gone({"dissolved": "1945-02-15", "states": ["Q75505084"]}) is False
    # an end date and no state: gone (a church rebuilt keeps its OSM outline)
    assert landmarks.gone({"dissolved": "1894-01-01", "states": []}) is True
    assert landmarks.gone({"dissolved": None, "states": []}) is False
    # a cache from before the state: unknown
    assert landmarks.gone({"id": "Q1"}) is None


def _quarter():
    city = {
        "CityObjects": {
            "rathaus": {"children": ["wing"]},
            "wing": {"parents": ["rathaus"]},
            "brewery": {},
        }
    }
    ids = ["wing", "brewery"]
    polys = [shapely.box(0, 0, 40, 40), shapely.box(100, 0, 120, 20)]
    return city, ids, polys, shapely.STRtree(polys)


def test_a_demolished_church_is_not_the_house_on_its_site():
    city, ids, polys, tree = _quarter()
    church = {
        "id": "Q2",
        "label": "Alte Reformierte Kirche",
        "building": True,
        "x": 20.0,
        "y": 20.0,
    }
    standing = {**church, "states": [], "dissolved": None}
    assert landmarks.matched_objects(standing, city, ids, polys, tree, {}) == ["wing"]
    demolished = {**church, "states": [landmarks.DEMOLISHED], "dissolved": "1894-01-01"}
    assert landmarks.matched_objects(demolished, city, ids, polys, tree, {}) == []
    # unless OSM tags a standing outline with it
    outline = {"Q2": [shapely.box(0, 0, 40, 40)]}
    assert landmarks.matched_objects(demolished, city, ids, polys, tree, outline) == ["wing"]


def test_a_point_beside_a_building_needs_it_near_or_named():
    city, ids, polys, tree = _quarter()
    item = {"id": "Q3", "label": "Lindenbrauerei", "building": True, "states": []}
    near = {**item, "x": 128.0, "y": 10.0}  # 8 m off the brewery
    assert landmarks.matched_objects(near, city, ids, polys, tree, {}) == ["brewery"]
    far = {**item, "x": 138.0, "y": 10.0}  # 18 m off
    assert landmarks.matched_objects(far, city, ids, polys, tree, {}) == []
    named = {"brewery": "Kulturzentrum Lindenbrauerei"}
    assert landmarks.matched_objects(far, city, ids, polys, tree, {}, named) == ["brewery"]
    # a name of the same kind is no name: "Altes Rathaus" is not the "Neues Rathaus"
    town = {**item, "label": "Altes Rathaus", "x": 55.0, "y": 20.0}  # 15 m off the wing
    hall = {"wing": "Neues Rathaus"}
    assert landmarks.matched_objects(town, city, ids, polys, tree, {}, hall) == []


def test_an_old_cache_is_completed_with_the_state(tmp_path, monkeypatch):
    dest = tmp_path / "landmarks_t.json"
    items = [{"id": "Q1", "label": "A"}, {"id": "Q2", "label": "B"}]
    dest.write_text(json.dumps({"landmarks": items}))
    rows = [
        {
            "i": {"value": "http://www.wikidata.org/entity/Q1"},
            "dissolved": {"value": "1894-01-01T00:00:00Z"},
            "states": {"value": "http://www.wikidata.org/entity/Q56556915"},
        },
        {"i": {"value": "http://www.wikidata.org/entity/Q2"}},
    ]
    monkeypatch.setattr(landmarks, "_ask", lambda query: rows)
    assert landmarks.complete_status(dest)
    a, b = json.loads(dest.read_text())["landmarks"]
    assert a["dissolved"] == "1894-01-01" and a["states"] == [landmarks.DEMOLISHED]
    assert landmarks.gone(a) and not landmarks.gone(b)
    assert not landmarks.complete_status(dest)  # complete already
