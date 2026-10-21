"""The step cache skips a step only while what it read, looked for and wrote
is as a full run would leave it."""

from __future__ import annotations

import os

import numpy as np
import rasterio
from rasterio.transform import from_origin

from bake import step_cache

KEY = {"step": "s", "code": "c"}
SITE = "site"
TILE = "t"


def _raster(path, value: int) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=4,
        height=4,
        count=1,
        dtype="uint8",
        transform=from_origin(0, 4, 1, 1),
    ) as ds:
        ds.write(np.full((1, 4, 4), value, np.uint8))


def _record(raw, root, step: str, body, key=KEY) -> None:
    with step_cache.recording([str(root)]) as rec:
        body()
    step_cache.save(step_cache.manifest_path(raw, SITE, step, TILE), key, rec)


def _ledger(raw, order=("s",)) -> step_cache.Ledger:
    return step_cache.Ledger(raw, SITE, list(order))


def _step(root):
    """Reads a JSON file and a raster, looks for an optional file, lists a
    folder, writes one file."""
    total = int((root / "in.json").read_text())
    with rasterio.open(root / "in.tif") as ds:
        total += int(ds.read(1).sum())
    if (root / "optional.txt").exists():
        total += 1000
    total += len(list((root / "many").glob("*.txt")))
    (root / "out.txt").write_text(str(total))


def _setup(tmp_path):
    root = tmp_path / "data"
    (root / "many").mkdir(parents=True)
    (root / "in.json").write_text("1")
    _raster(root / "in.tif", 2)
    raw = tmp_path / "raw"
    _record(raw, root, "s", lambda: _step(root))
    return root, raw


def _unchanged(raw, step="s", key=KEY, order=("s",)) -> bool:
    return _ledger(raw, order).unchanged(step, TILE, key)


def test_unchanged_until_an_input_changes(tmp_path):
    root, raw = _setup(tmp_path)
    assert (root / "out.txt").read_text() == "33"
    assert _unchanged(raw)
    assert not _unchanged(raw, key={**KEY, "code": "other"})
    (root / "in.json").write_text("2")
    assert not _unchanged(raw)


def test_a_touched_but_equal_input_keeps_it(tmp_path):
    root, raw = _setup(tmp_path)
    (root / "in.json").write_text("1")
    os.utime(root / "in.json", ns=(1, 1))
    assert _unchanged(raw)


def test_gdal_reads_are_inputs(tmp_path):
    root, raw = _setup(tmp_path)
    _raster(root / "in.tif", 3)
    assert not _unchanged(raw)


def test_a_file_that_appears_is_seen(tmp_path):
    root, raw = _setup(tmp_path)
    (root / "optional.txt").write_text("x")
    assert not _unchanged(raw)


def test_a_listed_folder_is_seen(tmp_path):
    root, raw = _setup(tmp_path)
    (root / "many" / "a.txt").write_text("x")
    assert not _unchanged(raw)


def test_an_edited_output_runs_again(tmp_path):
    root, raw = _setup(tmp_path)
    (root / "out.txt").write_text("edited")
    assert not _unchanged(raw)


def test_a_step_that_feeds_on_its_own_output_runs_again(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    raw = tmp_path / "raw"
    (root / "log.txt").write_text("a")

    def body():
        text = (root / "log.txt").read_text()
        (root / "log.txt").write_text(text + "a")

    _record(raw, root, "s", body)
    assert not _unchanged(raw)


def test_paths_outside_the_roots_are_not_recorded(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    other = tmp_path / "elsewhere.txt"
    other.write_text("x")
    with step_cache.recording([str(root)]) as rec:
        other.read_text()
    assert not rec.reads


ORDER = ("a", "m", "b")


def _chain(tmp_path):
    """`a` writes x from in.txt, `m` reads x into y, `b` rewrites x in place
    (as `islands` does the land cover's raster)."""
    root = tmp_path / "data"
    root.mkdir()
    raw = tmp_path / "raw"
    (root / "in.txt").write_text("1")

    def a():
        (root / "x.txt").write_text((root / "in.txt").read_text() + "a")

    def m():
        (root / "y.txt").write_text((root / "x.txt").read_text() + "m")

    def b():
        (root / "x.txt").write_text((root / "x.txt").read_text() + "b")

    steps = {"a": a, "m": m, "b": b}
    for s in ORDER:
        _record(raw, root, s, steps[s], {**KEY, "step": s})
    return root, raw, steps


def test_a_step_whose_output_a_later_one_rewrote_is_unchanged(tmp_path):
    root, raw, _ = _chain(tmp_path)
    assert (root / "x.txt").read_text() == "1ab"
    ledger = _ledger(raw, ORDER)
    for s in ORDER:
        assert ledger.unchanged(s, TILE, {**KEY, "step": s}), s


def test_the_rewriter_runs_again_after_the_writer(tmp_path):
    root, raw, steps = _chain(tmp_path)
    (root / "in.txt").write_text("2")
    ledger = _ledger(raw, ORDER)
    assert not ledger.unchanged("a", TILE, {**KEY, "step": "a"})
    _record(raw, root, "a", steps["a"], {**KEY, "step": "a"})
    ledger.done("a", TILE)
    assert not ledger.unchanged("m", TILE, {**KEY, "step": "m"})
    assert not ledger.unchanged("b", TILE, {**KEY, "step": "b"})


def test_a_reader_of_a_rewritten_file_restores_it_first(tmp_path):
    """`m` reads x as `a` wrote it; on disk is `b`'s: before `m` runs, `a`
    runs again (and `b` after `m`, its input rewritten)."""
    root, raw, steps = _chain(tmp_path)
    ledger = _ledger(raw, ORDER)
    assert ledger.restore("m", TILE) == [("a", TILE)]
    assert ledger.restore("a", TILE) == []
    _record(raw, root, "a", steps["a"], {**KEY, "step": "a"})
    ledger.done("a", TILE)
    assert ledger.restore("m", TILE) == []
    assert not ledger.unchanged("b", TILE, {**KEY, "step": "b"})


def test_a_memo_is_recorded_as_it_was_read(tmp_path):
    """A measurement kept from before its source was rewritten leaves the
    step that takes it to run again next time."""
    root = tmp_path / "data"
    root.mkdir()
    raw = tmp_path / "raw"
    (root / "src.txt").write_text("1")
    store: dict = {}

    def measure():
        return step_cache.memo(store, "k", lambda: (root / "src.txt").read_text())

    measure()
    (root / "src.txt").write_text("2")

    def body():
        (root / "out.txt").write_text(measure())

    _record(raw, root, "s", body)
    assert (root / "out.txt").read_text() == "1"
    assert not _unchanged(raw)


def test_quiet_files_are_not_recorded(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    (root / "cache.txt").write_text("x")
    with step_cache.recording([str(root)]) as rec, step_cache.quiet():
        (root / "cache.txt").read_text()
        (root / "other.txt").write_text("y")
    assert not rec.reads and not rec.writes


def test_code_hash_follows_imports():
    """A step's hash covers the modules it imports, not every bake module."""
    walls = step_cache.code_hash("bake.walls")
    assert walls == step_cache.code_hash("bake.walls")
    seen = step_cache._closure("bake.walls")
    assert "bake.osm" in seen
    assert "bake.roof_colour" not in seen


def test_a_dated_step_is_known():
    assert step_cache.dated("bake.trees")
    assert not step_cache.dated("bake.walls")
