import json

import numpy as np
import pytest
from pyproj import Transformer

from bake import facades
from bake.facade_measure import class_map, rotation_matrix
from bake.facades import grade, plan, readings, signed_roots, wall_values, walls, wmedian

X0, Y0 = 411000.0, 5656000.0


def _box(x0, y0, x1, y1, z0, z1) -> tuple[list[list[float]], list]:
    """Vertices and faces of an axis-aligned block: ground, roof, four walls."""
    v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]
    v += [[x, y, z1] for x, y, _ in v]
    faces = [[[0, 3, 2, 1]], [[4, 5, 6, 7]], [[0, 1, 5, 4]], [[1, 2, 6, 5]], [[2, 3, 7, 6]]]
    faces += [[[3, 0, 4, 7]]]
    return v, faces


def _city(blocks: dict[str, tuple]) -> dict:
    """A CityJSON of axis-aligned buildings (id → x0, y0, x1, y1, height),
    given in metres from (X0, Y0), each a child of a root `<id>-root`."""
    verts, objs = [], {}
    for oid, (x0, y0, x1, y1, h) in blocks.items():
        v, faces = _box(X0 + x0, Y0 + y0, X0 + x1, Y0 + y1, 100.0, 100.0 + h)
        base = len(verts)
        verts += v
        shells = [[[i + base for i in ring] for ring in face] for face in faces]
        objs[oid] = {
            "type": "BuildingPart",
            "parents": [f"{oid}-root"],
            "geometry": [
                {
                    "type": "Solid",
                    "lod": "2",
                    "boundaries": [shells],
                    "semantics": {
                        "surfaces": [
                            {"type": "GroundSurface"},
                            {"type": "RoofSurface"},
                            {"type": "WallSurface"},
                        ],
                        "values": [[0, 1, 2, 2, 2, 2]],
                    },
                }
            ],
        }
        objs[f"{oid}-root"] = {"type": "Building", "children": [oid]}
    return {
        "type": "CityJSON",
        "transform": {"scale": [0.001, 0.001, 0.001], "translate": [0, 0, 0]},
        "CityObjects": objs,
        "vertices": [[round(c * 1000) for c in p] for p in verts],
    }


def test_the_weighted_median_takes_the_value_at_half_the_weight():
    assert wmedian([(0.2, 1.0), (0.9, 1.0), (0.5, 10.0)]) == 0.5
    assert wmedian([(0.2, 3.0), (0.9, 1.0)]) == 0.2
    assert wmedian([(0.9, 1.0), (0.2, 1.0)]) == 0.2  # the lower at an exact half


@pytest.mark.parametrize(
    ("open_", "dark", "seqs", "want"),
    [
        (0.2, 0.1, 2, [1, 1, 0]),
        (0.5, 0.2, 2, [2, 2, 0]),
        (0.8, 0.3, 2, [3, 3, 0]),
        (0.8, 0.3, 1, [2, 3, 0]),  # busy only where two sequences saw it
        (0.35, 0.15, 2, [2, 2, 0]),  # the thresholds belong to the upper grade
    ],
)
def test_the_grades(open_, dark, seqs, want):
    ws = [{"open": open_, "dark": dark, "gf_open": None, "L": 10.0, "seqs": seqs}]
    assert grade(ws, signed=False) == want


def test_a_shop_is_a_sign_or_an_open_ground_floor():
    wall = {"open": 0.2, "dark": 0.1, "L": 10.0, "seqs": 1}
    assert grade([wall | {"gf_open": 0.5}], signed=True)[2] == 1
    assert grade([wall | {"gf_open": 0.81}], signed=False)[2] == 1
    assert grade([wall | {"gf_open": 0.8}], signed=False)[2] == 0


def test_a_long_wall_outweighs_short_ones():
    ws = [
        {"open": 0.9, "dark": 0.3, "gf_open": None, "L": 30.0, "seqs": 2},
        {"open": 0.1, "dark": 0.1, "gf_open": None, "L": 8.0, "seqs": 2},
        {"open": 0.1, "dark": 0.1, "gf_open": None, "L": 8.0, "seqs": 2},
    ]
    assert grade(ws, signed=False) == [3, 3, 0]


def _rec(oid, wi, seq, open_, dark=0.1, gf=None, length=10.0):
    return {
        "oid": oid,
        "wi": wi,
        "seq": seq,
        "L": length,
        "open": open_,
        "dark": dark,
        "gf_open": gf,
    }


def test_a_wall_is_the_median_of_its_sequences_medians():
    recs = [
        _rec("a", 0, "s1", 0.1),
        _rec("a", 0, "s1", 0.3),  # s1: 0.2
        _rec("a", 0, "s2", 0.8),  # s2: 0.8
        _rec("a", 0, "s3", 0.6, gf=0.9),  # s3: 0.6
        {"oid": "a", "wi": 0, "seq": "s4", "L": 10.0, "cov": 0.1},  # not measured
    ]
    w = wall_values(recs)[("a", 0)]
    assert w["seqs"] == 3
    assert w["open"] == pytest.approx(0.6)
    assert w["gf_open"] == pytest.approx(0.9)


def test_the_walls_are_outer_long_and_tall():
    city = _city(
        {
            "a": (0, 0, 20, 10, 12),  # 2 × 20 m + 2 × 10 m walls
            "b": (20, 0, 24, 10, 12),  # shares a's east wall; 4 m sides too short
            "low": (50, 0, 70, 10, 4),  # eave below 6 m
        }
    )
    ws = walls(city)
    assert sorted((w["oid"], round(w["L"])) for w in ws) == [
        ("a", 10),
        ("a", 20),
        ("a", 20),
        ("b", 10),
    ]
    for w in ws:  # the normals point away from the footprint
        mx, my = (w["a"][0] + w["b"][0]) / 2, (w["a"][1] + w["b"][1]) / 2
        cx, cy = (X0 + 10, Y0 + 5) if w["oid"] == "a" else (X0 + 22, Y0 + 5)
        assert (mx - cx) * w["n"][0] + (my - cy) * w["n"][1] > 0


def _pano(i, x, y, seq, year=2025):
    lon, lat = Transformer.from_crs(25833, 4326, always_xy=True).transform(X0 + x, Y0 + y)
    ms = (year - 1970) * 365.25 * 86400 * 1000
    return {
        "id": str(i),
        "is_pano": True,
        "computed_geometry": {"type": "Point", "coordinates": [lon, lat]},
        "captured_at": ms,
        "sequence": seq,
    }


def test_the_plan_picks_frontal_panoramas_with_a_free_view():
    city = _city({"a": (0, 0, 20, 10, 12), "far": (0, 40, 20, 50, 12)})
    images = [
        _pano(1, 10, -15, "s1"),  # 15 m in front of a's south wall
        _pano(2, 10, -12, "s1"),
        _pano(3, 11, -18, "s1"),  # a third of one sequence: over PER_SEQ
        _pano(4, 10, -2, "s2"),  # too close
        _pano(5, 60, -5, "s3"),  # too far
        _pano(6, 10, -20, "s4", year=2012),  # too old
        _pano(7, 10, 25, "s5"),  # between a and far: sees both
    ]
    jobs = plan(city, images, 25833)
    south = {
        i for i, j in jobs.items() if any(w["oid"] == "a" and w["n"][1] < -0.9 for w in j["walls"])
    }
    assert south == {"1", "2"}
    assert {w["oid"] for w in jobs["7"]["walls"]} == {"a", "far"}
    assert all(w["n"][1] > 0.9 for w in jobs["7"]["walls"] if w["oid"] == "a")
    # the far building's south wall cannot see 1 (a stands in between)
    assert all(w["oid"] == "a" for w in jobs["1"]["walls"])


def test_readings_join_signs_and_walls_per_building():
    city = _city({"a": (0, 0, 20, 10, 12), "b": (40, 0, 60, 10, 12)})
    recs = [_rec("a", 0, "s1", 0.5, 0.2, length=20.0), _rec("b", 0, "s1", 0.1, 0.05)]
    sign = np.array([[X0 + 10, Y0 - 2.0]])  # 2 m in front of a's south wall
    assert signed_roots(city, sign) == {"a-root"}
    assert readings(city, recs, sign) == {"a-root": [2, 2, 1], "b-root": [1, 1, 0]}


def test_rodrigues_matches_a_quarter_turn():
    r = rotation_matrix([0, 0, np.pi / 2])
    assert np.allclose(r @ [1, 0, 0], [0, 1, 0])
    assert np.allclose(rotation_matrix([0, 0, 0]), np.eye(3))


def _mvt_square(x0, y0, x1, y1, extent=4096) -> str:
    """A one-feature vector tile: a square, as Mapillary's detections are."""
    import base64

    def varint(v):
        out = bytearray()
        while True:
            b = v & 0x7F
            v >>= 7
            out.append(b | (0x80 if v else 0))
            if not v:
                return bytes(out)

    def zz(v):
        return (v << 1) ^ (v >> 31)

    def field(f, t, payload):
        return varint((f << 3) | t) + (varint(len(payload)) + payload if t == 2 else payload)

    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    geom = [varint(1 | (1 << 3)), varint(zz(pts[0][0])), varint(zz(pts[0][1]))]
    geom.append(varint(2 | (3 << 3)))
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:], strict=True):
        geom += [varint(zz(bx - ax)), varint(zz(by - ay))]
    geom.append(varint(7 | (1 << 3)))
    feat = field(4, 2, b"".join(geom))
    layer = field(2, 2, feat) + field(5, 0, varint(extent))
    return base64.b64encode(field(3, 2, layer)).decode()


def test_the_class_map_puts_small_occluders_on_top_of_the_building():
    dets = [
        {"value": "construction--structure--building", "geometry": _mvt_square(0, 0, 4096, 2048)},
        {"value": "nature--vegetation", "geometry": _mvt_square(1024, 512, 2048, 1024)},
        {"value": "construction--flat--road", "geometry": _mvt_square(0, 0, 4096, 4096)},
    ]
    cls = class_map(dets, 64, 32)
    assert cls[4, 4] == 1  # building
    assert cls[6, 24] == 2  # the tree in front of it
    assert cls[28, 30] == 0  # the road is not drawn


def test_without_measurements_the_file_is_empty(tmp_path):
    from bake.common import Tile

    tile = Tile("t", (X0, Y0, X0 + 200, Y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    tile = Tile(**{**tile.__dict__, "mapillary": True})
    facades.run(tile)
    doc = json.loads((tmp_path / "data" / "dlm" / "facades_t.json").read_text())
    assert doc == {"attribution": "Mapillary, CC BY-SA 4.0", "buildings": {}}
