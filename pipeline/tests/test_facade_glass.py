"""Glass fronts from street photos: the camera models, the photos a wall is
read on, the crop the model sees, and the per-wall decision."""

import json
import math

import numpy as np
import pytest

from bake import facade_glass, facades
from bake import windows as win
from bake.facade_measure import project, rotation_matrix


def test_a_panorama_sees_all_round():
    C = np.array([[0.0, 0.0, 1.0], [0.0, 0.0, -1.0], [1.0, 0.0, 0.0]])
    u, v, seen, _ = project(C, 2048, 1024, None)
    assert seen.all()
    assert u[0] == pytest.approx(1024)  # straight ahead: the image's middle
    assert v[0] == pytest.approx(512)


def test_a_framed_photo_sees_only_ahead_within_its_frame():
    camera = {"type": "perspective", "params": [0.8, 0.0, 0.0]}
    C = np.array([[0.0, 0.0, 10.0], [0.0, 0.0, -10.0], [20.0, 0.0, 10.0], [1.0, -1.0, 10.0]])
    u, v, seen, per_px = project(C, 2000, 1500, camera)
    assert seen.tolist() == [True, False, False, True]
    assert (u[0], v[0]) == pytest.approx((1000, 750))
    # x right, y down: a point up and right lands up and right of the middle
    assert u[3] > 1000 and v[3] < 750
    assert per_px == pytest.approx(1 / (0.8 * 2000))


def test_a_brown_camera_reads_its_focal_and_radial_terms_in_opensfm_order():
    C = np.array([[3.0, 2.0, 10.0]])
    brown = {"type": "brown", "params": [0.8, 0.79, 0.01, -0.01, 0.05, -0.02, 0.001, 0.001, 0.0]}
    plain = {"type": "perspective", "params": [0.8, 0.05, -0.02]}
    assert project(C, 2000, 1500, brown)[0] == pytest.approx(project(C, 2000, 1500, plain)[0])
    # without its radial terms: no distortion, never fy taken for k1
    short = {"type": "brown", "params": [0.8, 0.79, 0.01, -0.01]}
    flat = {"type": "perspective", "params": [0.8, 0.0, 0.0]}
    assert project(C, 2000, 1500, short)[0] == pytest.approx(project(C, 2000, 1500, flat)[0])


def test_a_fisheye_bends_by_the_angle():
    camera = {"type": "fisheye", "params": [0.5, 0.0, 0.0]}
    C = np.array([[1.0, 0.0, 1.0]])  # 45° to the right
    u, _, seen, _ = project(C, 1000, 1000, camera)
    assert seen[0]
    assert u[0] == pytest.approx(500 + 0.5 * math.pi / 4 * 1000)


def _wall(eave: float = 12.0) -> dict:
    return {"a": (0.0, 0.0), "b": (20.0, 0.0), "eave": eave, "n": (0.0, -1.0), "L": 20.0}


def _photo(heading_deg: float, pano: bool = False) -> dict:
    """A photo whose camera looks along `heading_deg` (0 north, 90 east),
    level, as Mapillary's computed rotation (world → camera)."""
    h = math.radians(heading_deg)
    forward = np.array([math.sin(h), math.cos(h), 0.0])
    right = np.array([math.cos(h), -math.sin(h), 0.0])
    down = np.array([0.0, 0.0, -1.0])
    R = np.stack([right, down, forward])  # rows: the camera's axes in the world
    angle = math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2)))
    axis = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    rotvec = axis / np.linalg.norm(axis) * angle
    return {
        "is_pano": pano,
        "camera_type": "spherical" if pano else "perspective",
        "camera_parameters": None if pano else [0.8, 0.0, 0.0],
        "computed_rotation": rotvec.tolist(),
    }


def _in_frame(wall: dict, photo: dict, at, gamma: float = 0.0) -> float:
    rot = facades.onto_grid(rotation_matrix(photo["computed_rotation"]), gamma)
    return facades.in_frame(wall, photo, at, rot)


def test_a_photo_reads_a_wall_only_when_it_looks_at_it():
    wall = _wall()
    at = (10.0, -25.0)  # 25 m south of the wall's middle, the wall to the north
    assert _in_frame(wall, _photo(0), at) > 0.9
    assert _in_frame(wall, _photo(180), at) == 0.0
    assert _in_frame(wall, _photo(180, pano=True), at) == 1.0
    # a portrait photo sees less of a wide, low wall than the 4:3 default
    low, near = _wall(eave=5.0), (10.0, -15.0)
    tall = _photo(0) | {"width": 3, "height": 4}
    assert _in_frame(low, tall, near) < _in_frame(low, _photo(0), near)


def test_a_panorama_too_far_to_resolve_the_wall_is_not_read():
    import shapely

    wall = _wall() | {"k": 0}
    # a panorama's pixel spans MAX_RES_M at ~33 m: one at 25 m reads the
    # wall, one at 45 m would only fetch a photo the reading masks whole
    at = np.array([(10.0, -25.0), (10.0, -45.0), (10.0, -45.0)])
    pano = _photo(0, pano=True)
    images = [pano | {"sequence": "near"}, pano | {"sequence": "far"}]
    images.append(_photo(0) | {"sequence": "framed"})
    rots = [rotation_matrix(o["computed_rotation"]) for o in images]
    ptree = shapely.STRtree(shapely.points(at))
    angles = [facades.pixel_angle(o) for o in images]
    got = facades.glass_candidates(wall, images, at, rots, angles, ptree, shapely.STRtree([]))
    assert set(got) == {"near", "framed"}


def test_a_photo_stored_turned_is_turned_back_into_its_poses_frame():
    up = np.arange(6).reshape(2, 3)
    assert facades.raw_frame(up, None) is up
    assert facades.raw_frame(up, 3).tolist() == np.rot90(up, 2).tolist()
    assert facades.raw_frame(up, 6).shape == (3, 2)
    assert facades.raw_frame(up, 6)[0].tolist() == [2, 5]  # turned back left
    assert facades.raw_frame(up, 2) is None  # mirrored: not read


def test_the_crop_keeps_the_seen_upper_wall_and_greys_the_rest():
    rgb = np.zeros((100, 200, 3))
    rgb[:, :, 2] = 1.0
    upper = np.zeros((100, 200), bool)
    upper[10:60, 20:120] = True
    upper[30:40, 50:60] = False
    crop = facade_glass.upper_crop(rgb, upper)
    assert crop.shape == (50, 100, 3)
    assert crop[0, 0].tolist() == [0, 0, 255]
    assert crop[25, 35].tolist() == np.round(facade_glass.MEAN * 255).astype(int).tolist()
    assert facade_glass.upper_crop(rgb, np.zeros_like(upper)) is None


def test_the_model_sees_a_long_wall_whole():
    # padded to a square, not centre-cropped: a long wall keeps its ends
    crop = np.zeros((50, 400, 3), np.uint8)
    crop[:, :20] = 255
    x = facade_glass._pixels(crop)
    assert x.shape == (1, 3, facade_glass.SIZE, facade_glass.SIZE)
    middle = facade_glass.SIZE // 2
    assert x[0, 0, middle, 2] > x[0, 0, middle, 100]


def _lines(readings: dict[tuple[str, int, float], list[tuple[int, float]]]) -> list[str]:
    out = []
    for (oid, wi, length), rs in readings.items():
        for k, (gl, cov) in enumerate(rs):
            w = {"oid": oid, "wi": wi, "L": length, "cov": cov} | ({} if gl is None else {"gl": gl})
            out.append(json.dumps({"img": f"{oid}{wi}{k}", "seq": f"s{k}", "walls": [w]}))
    return out


def test_a_photo_without_a_building_segment_is_read_only_as_a_facade(monkeypatch):
    seg = np.zeros((8, 8), np.uint8)
    assert facade_glass.unsegmented(seg)
    seg[2, 2] = 1
    assert not facade_glass.unsegmented(seg)

    class Stub:
        def __init__(self, glass, other):
            self.p = (glass, other)

        def glass(self, _crop):
            return self.p

    rgb = np.full((60, 60, 3), 0.5)
    upper = np.ones((60, 60), bool)
    monkeypatch.setattr(facade_glass, "model", lambda *_: Stub(0.95, 0.9))
    # sky above a canopy: glass against a wall, but most likely no facade
    assert facade_glass.glass_of(rgb, upper, "", "", segmented=False) is None
    assert facade_glass.glass_of(rgb, upper, "", "", segmented=True) == 950
    monkeypatch.setattr(facade_glass, "model", lambda *_: Stub(0.95, 0.1))
    assert facade_glass.glass_of(rgb, upper, "", "", segmented=False) == 950


def test_a_wall_is_glass_where_most_of_its_clear_views_say_so():
    got = win.glass_records(
        _lines(
            {
                ("ICC", 0, 10.0): [(990, 0.6), (950, 0.4), (400, 0.5)],
                ("house", 0, 10.0): [(990, 0.6), (300, 0.5), (200, 0.5)],
                ("glimpse", 0, 10.0): [(990, 0.6), (None, 0.1)],  # one view too narrow to read
                ("blind", 0, 10.0): [(None, 0.6), (None, 0.6)],
            }
        )
    )
    assert win.wall_glass(got[("ICC", 0, 10.0)]) == {"glass": True, "n": 3, "p": 950}
    assert win.wall_glass(got[("house", 0, 10.0)])["glass"] is False
    assert win.wall_glass(got[("glimpse", 0, 10.0)]) is None
    assert ("blind", 0, 10.0) not in got


def test_two_frames_of_one_pass_are_one_reading():
    lines = [
        json.dumps(
            {"img": i, "seq": "s", "walls": [{"oid": "a", "wi": 0, "L": 10.0, "cov": c, "gl": g}]}
        )
        for i, c, g in (("1", 0.5, 990), ("2", 0.8, 400))
    ]
    # the frame that saw most of the wall speaks for its sequence
    assert win.glass_records(lines) == {("a", 0, 10.0): [400]}


def test_a_wall_keeps_the_passes_the_fetch_plans():
    lines = [
        json.dumps(
            {
                "img": f"i{k}",
                "seq": f"s{k}",
                "walls": [{"oid": "a", "wi": 0, "L": 10.0, "cov": c, "gl": g}],
            }
        )
        for k, (c, g) in enumerate([(0.9, 990), (0.3, 100), (0.8, 980), (0.7, 970), (0.6, 960)])
    ]
    # five passes read (the plan picks more than the decision keeps, for
    # what a tree hides shows only in the reading): the four that saw most
    assert win.glass_records(lines) == {("a", 0, 10.0): [990, 980, 970, 960]}
    assert facades.GLASS_SEQ == 4 < facades.GLASS_PLAN_SEQ


def test_a_photo_read_is_read_again_only_for_a_wall_planned_since(tmp_path):
    cache = tmp_path / "c.jsonl"
    cache.write_text(
        "\n".join(
            json.dumps(r)
            for r in (
                {"img": "p", "seq": "s", "walls": [{"oid": "a", "wi": 0, "L": 10.0}]},
                {
                    "img": "q",
                    "seq": "s",
                    "walls": [{"oid": "a", "wi": 0, "L": 10.0, "off": "ground"}],
                },
                {"img": "r", "skip": "no pose or thumbnail"},
            )
        )
    )
    wall = [{"oid": "a", "wi": 0, "L": 10.0}]
    both = [*wall, {"oid": "b", "wi": 0, "L": 10.0}]
    jobs = {"p": {"walls": both}, "q": {"walls": wall}, "r": {"walls": both}, "n": {"walls": wall}}
    done = facades._done(cache)
    assert facades._todo(jobs, done, by_wall=True) == ["n", "p"]
    assert facades._todo(jobs, done, by_wall=False) == ["n"]
    # read again on the wall it lacks alone
    assert facades._unread(jobs["p"], done["p"])["walls"] == [{"oid": "b", "wi": 0, "L": 10.0}]
    assert facades._unread(jobs["n"], done.get("n")) is jobs["n"]
    # a new LoD2 edition's wall 0 of another length is another wall
    renumbered = {"p": {"walls": [{"oid": "a", "wi": 0, "L": 12.0}]}}
    assert facades._todo(renumbered, done, by_wall=True) == ["p"]


def test_a_glass_cache_is_read_through_when_its_last_line_says_so(tmp_path):
    cache = tmp_path / "c.jsonl"
    lines = lambda: cache.read_text().splitlines()  # noqa: E731
    assert not facades.complete([], "k")
    facades.mark_complete(cache, "k", {})  # a plan with nothing to read
    assert facades.complete(lines(), "k")
    facades.mark_complete(cache, "k", {})
    assert cache.read_text().count("complete") == 1
    # read through for other walls or limits is not read through
    assert not facades.complete(lines(), "other")
    with open(cache, "a") as f:  # a later run, killed mid-line
        f.write('{"img": "p", "seq"')
    assert not facades.complete(lines(), "k")
    with facades._append(cache) as f:  # the next run's line stands on its own
        f.write(json.dumps({"img": "q", "seq": "s", "walls": []}) + "\n")
    assert json.loads(lines()[-1])["img"] == "q"


def test_a_crop_the_model_cannot_read_is_not_the_photos_fault(monkeypatch):
    class Broken:
        def glass(self, crop):
            raise MemoryError("out of memory")

    monkeypatch.setattr(facade_glass, "model", lambda *_: Broken())
    rgb, upper = np.full((60, 60, 3), 0.5), np.ones((60, 60), bool)
    # raised, so the photo is not cached as read and is read again later
    with pytest.raises(facade_glass.ModelError):
        facade_glass.glass_of(rgb, upper, "", "", segmented=True)


def test_a_wall_seen_only_for_glass_enters_with_its_glass_alone():
    from tests.synthetic import blocks_city

    city = blocks_city({"hall": (0, 0, 30, 20, 15.0)})
    ws = facades.walls(city)
    assert len(ws) == 4
    glass = {facades.wall_key(w): win.wall_glass([980, 960]) for w in ws}
    buildings, _ = win.windows(city, {}, None, glass)
    entries = buildings["hall-root"]
    assert len(entries) == 4
    assert all(e["glass"]["glass"] and "model" not in e for e in entries)
    assert all(e["imgs"] == 0 and e["traits"] == {} for e in entries)
    # the hall's glass is weighed against all its outer walls
    assert win.outer_lengths(ws, buildings) == {entries[0]["oid"]: 100.0}


def test_a_glass_wall_has_no_window_model(monkeypatch):
    from tests.synthetic import blocks_city

    city = blocks_city({"hall": (0, 0, 30, 20, 15.0)})
    ws = facades.walls(city)
    # every wall measured with a clear window rhythm by the panoramas
    monkeypatch.setattr(win, "by_sequence", lambda recs: {"s": recs})
    monkeypatch.setattr(win, "wall_traits", lambda seqs: {})
    monkeypatch.setattr(win, "axis_agrees", lambda seqs: True)
    monkeypatch.setattr(win, "model", lambda *_: {"axis": 3.0, "grid": "regular"})
    monkeypatch.setattr(win, "wall_phase", lambda *_: None)
    by_wall = {(w["oid"], w["wi"]): [{"seq": "s"}] for w in ws}
    glass = {facades.wall_key(ws[0]): win.wall_glass([980, 960])}
    entries = win.windows(city, by_wall, None, glass)[0]["hall-root"]
    # the curtain wall's mullions are no rhythm: for no building, no dormer
    assert ["model" in e for e in entries] == [False, True, True, True]


def test_the_windows_bake_keeps_its_glass_where_the_readings_are_not_there(tmp_path):
    read = ['{"img": "p", "seq": "s", "walls": []}', json.dumps({"complete": "k"})]
    assert win.decided_glass(read) == {}
    out = tmp_path / "windows.json"
    assert win.prior_glass(out) == {}  # never baked
    entry = {"oid": "a", "wi": 0, "L": 10.0, "glass": {"glass": True, "n": 2, "p": 980}}
    out.write_text(json.dumps({"buildings": {"a": [entry, {"oid": "a", "wi": 1, "L": 5.0}]}}))
    assert win.prior_glass(out) == {("a", 0, 10.0): entry["glass"]}


def test_a_photo_that_keeps_failing_is_given_up(tmp_path):
    cache = tmp_path / "c.jsonl"
    fail = json.dumps({"img": "p", "fail": "HTTPError: 403", "own": True})
    cache.write_text("\n".join([fail] * (facades.MAX_FAILS - 1)))
    jobs = {"p": {"walls": [{"oid": "a", "wi": 0, "L": 10.0}]}}
    assert facades._todo(jobs, facades._done(cache), by_wall=True) == ["p"]
    cache.write_text("\n".join([fail] * facades.MAX_FAILS))
    assert facades._todo(jobs, facades._done(cache), by_wall=True) == []
    # read on one wall, refused since for a wall planned later: given up too
    read = json.dumps({"img": "p", "seq": "s", "walls": [{"oid": "a", "wi": 0, "L": 10.0}]})
    later = {"p": {"walls": [{"oid": "a", "wi": 0, "L": 10.0}, {"oid": "b", "wi": 0, "L": 5.0}]}}
    cache.write_text("\n".join([fail, fail, read, fail]))  # the fails before count no more
    assert facades._todo(later, facades._done(cache), by_wall=True) == ["p"]
    cache.write_text("\n".join([read] + [fail] * facades.MAX_FAILS))
    assert facades._todo(later, facades._done(cache), by_wall=True) == []


def test_a_run_refused_everywhere_notes_no_failure(tmp_path):
    cache = tmp_path / "c.jsonl"
    own = [{"img": f"p{i}", "fail": "HTTPError: 403", "own": True} for i in range(12)]
    facades._note_fails(cache, own, 12, set())  # a proxy's or the network's, not the photos'
    assert not cache.exists()
    facades._note_fails(cache, own, 20, set())  # most of a run refused: the same
    assert not cache.exists()
    facades._note_fails(cache, own[:2], 12, set())
    assert len(cache.read_text().splitlines()) == 2
    facades._note_fails(cache, own[:1], 1, set())  # the one stubborn photo left
    assert len(cache.read_text().splitlines()) == 3


def test_photos_that_keep_failing_on_reruns_are_given_up(tmp_path):
    cache = tmp_path / "c.jsonl"
    own = [{"img": f"p{i}", "fail": "HTTPError: 403", "own": True} for i in range(15)]
    jobs = {r["img"]: {"walls": [{"oid": "a", "wi": 0, "L": 10.0}]} for r in own}
    facades._note_fails(cache, own, 2000, set())  # 15 of a 2000-photo run
    for _ in range(facades.MAX_FAILS - 1):
        # a rerun asks only those, which fail again
        todo = facades._todo(jobs, facades._done(cache), by_wall=True)
        assert len(todo) == 15
        facades._note_fails(cache, own, len(todo), facades._failing(cache))
    assert facades._todo(jobs, facades._done(cache), by_wall=True) == []


def test_the_decision_reads_only_the_photos_the_plan_picked(tmp_path):
    def reading(img, seq, gl):
        return json.dumps(
            {
                "img": img,
                "seq": seq,
                "walls": [{"oid": "a", "wi": 0, "L": 10.0, "gl": gl, "cov": 0.9}],
            }
        )

    lines = [reading("p", "s", 990), reading("q", "t", 980), reading("r", "u", 100)]
    jobs = {i: {"walls": [{"oid": "a", "wi": 0, "L": 10.0}]} for i in ("p", "q")}
    cache = tmp_path / "c.jsonl"
    cache.write_text("\n".join(lines) + "\n")
    facades.mark_complete(cache, "k", facades.plan_of(jobs))
    read = cache.read_text().splitlines()
    assert facades.complete(read, "k")
    # r, picked by an earlier plan, no longer counts: two of two say glass
    assert win.decided_glass(read)[("a", 0, 10.0)] == {"glass": True, "n": 2, "p": 985}
    # a new plan with the same limits and walls is noted anew
    facades.mark_complete(cache, "k", facades.plan_of({"p": jobs["p"]}))
    assert facades.complete(read := cache.read_text().splitlines(), "k")
    assert ("a", 0, 10.0) not in win.decided_glass(read)  # one reading is too few


def test_a_photo_smaller_than_its_thumbnail_is_planned_at_its_own_size():
    camera = {"camera_type": "perspective", "camera_parameters": [0.8, 0.0, 0.0]}
    full = facades.pixel_angle(camera | {"width": 4000, "height": 3000})
    small = facades.pixel_angle(camera | {"width": 1024, "height": 768})
    assert small == pytest.approx(2 * full, rel=0.01)
    assert facades.pixel_angle(camera) == pytest.approx(full)


def test_a_pose_batch_is_split_only_round_an_image_that_is_gone(monkeypatch):
    import io
    import urllib.error

    def err(code, kind):
        body = json.dumps({"error": {"type": kind}}).encode()
        return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(body))

    asked = []

    def get(url, **_):
        ids = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["ids"][0].split(",")
        asked.append(ids)
        if "gone" in ids:
            raise err(400, "GraphMethodException")
        return json.dumps({i: {"computed_rotation": [0, 0, 0]} for i in ids}).encode()

    monkeypatch.setattr(facades, "_get", get)
    assert sorted(facades._poses(["a", "gone", "b", "c"])) == ["a", "b", "c"]

    def refused(url, **_):
        asked.append(url)
        raise err(400, "OAuthException")

    monkeypatch.setattr(facades, "_get", refused)
    asked.clear()
    with pytest.raises(urllib.error.HTTPError):
        facades._poses(["a", "b", "c", "d"])
    assert len(asked) == 1  # a token's error is not split


def test_only_a_missing_image_is_gone_never_a_token():
    import io
    import urllib.error

    def err(code, body=b""):
        return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(body))

    assert facades.gone(err(404)) and facades.gone(err(410))
    missing = b'{"error": {"type": "GraphMethodException", "code": 100}}'
    assert facades.gone(err(400, missing))
    assert not facades.gone(err(400, b'{"error": {"type": "OAuthException", "code": 190}}'))
    assert not facades.gone(err(403)) and not facades.gone(err(401))


def test_a_photo_list_made_for_other_fields_is_asked_anew(tmp_path):
    path = tmp_path / "t.photos.json"
    path.write_text(json.dumps({"retrieved": "x", "data": [{"id": "1"}]}))  # before width, height
    asked = []

    def make():
        asked.append(1)
        return [{"id": "1", "width": 4000}]

    assert facades._cached_json(path, make, "id,width") == [{"id": "1", "width": 4000}]
    assert facades._cached_json(path, make, "id,width") == [{"id": "1", "width": 4000}]
    assert len(asked) == 1


def test_a_wall_the_model_fails_on_keeps_the_photos_other_walls(monkeypatch, tmp_path):
    from bake import facade_measure

    monkeypatch.setattr(facades, "_detections", lambda *_: [])
    monkeypatch.setattr(facades, "_thumbnail", lambda *_: (tmp_path / "x.jpg", False))
    monkeypatch.setattr(facade_measure, "load_image", lambda _: np.zeros((4, 4, 3)))
    monkeypatch.setattr(facade_measure, "class_map", lambda _: np.zeros((4, 4)))
    monkeypatch.setattr(facades, "_ground", lambda *_: 100.0)
    monkeypatch.setattr(facade_glass, "model", lambda *_: None)

    def measure(w, *_):
        if w["oid"] == "long":
            raise MemoryError("a 300 m crop")
        return {"gl": 990, "cov": 0.9}

    monkeypatch.setattr(facade_glass, "measure", measure)
    wall = {"wi": 0, "a": [0, 0], "b": [10, 0], "L": 10.0, "n": [0, 1], "eave": 12.0}
    job = {
        "img": "p",
        "seq": "s",
        "kind": "glass",
        "rot": [0.0, 0.0, 0.0],
        "url": "u",
        "xy": [5.0, 20.0],
        "camera": {"type": "perspective", "params": [0.8, 0.0, 0.0]},
        "model": ["m", "c"],
        "scratch": str(tmp_path),
        "walls": [wall | {"oid": "short"}, wall | {"oid": "long"}],
    }
    r = facades.measure_image(job)
    assert [w["oid"] for w in r["walls"]] == ["short"] and r["also_fail"].startswith("model")
    only = facades.measure_image(job | {"walls": [wall | {"oid": "long"}]})
    assert only["own"] and "walls" not in only


def test_a_strong_barrel_is_not_read_past_where_it_folds_back():
    camera = {"type": "perspective", "params": [0.6, -0.5, 0.0]}  # turns at r² = 2/3
    C = np.array([[0.3, 0.0, 1.0], [1.0, 0.0, 1.0]])  # r² 0.09 and 1.0
    _, _, seen, _ = project(C, 2000, 1500, camera)
    assert seen.tolist() == [True, False]


def test_only_a_photos_own_failure_counts_against_it():
    import io
    import urllib.error

    def http(code, error):
        body = io.BytesIO(json.dumps({"error": error}).encode())
        return urllib.error.HTTPError("u", code, "x", {}, body)

    refused = http(403, {"message": "URL signature mismatch"})  # the CDN, this photo
    assert facades._failed("p", refused)["own"]
    expired = http(400, {"type": "OAuthException", "code": 190})
    assert not facades._failed("p", expired)["own"]
    assert not facades._failed("p", http(401, {}))["own"]
    assert not facades._failed("p", facades.Transient("HTTPError: 503"))["own"]  # the network
    assert facades._failed("p", ValueError("bad URL"))["own"]
    missing = http(400, {"type": "GraphMethodException"})
    assert facades.gone(missing) and facades.gone(missing)  # the body read once, kept
