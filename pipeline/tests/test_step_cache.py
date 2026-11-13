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


def test_the_rewriter_of_a_restored_file_runs_after_the_reader(tmp_path):
    """A bake of `m` alone restores x to `a`'s output; `b` then rewrites it
    again, or x would stay as `a` left it (lamps without their heights)."""
    root, raw, steps = _chain(tmp_path)
    ledger = _ledger(raw, ORDER)
    again = ledger.restore("m", TILE)
    assert ledger.after(again, "m") == [("b", TILE)]
    assert ledger.after([], "m") == []
    for s in ("a", "m"):
        _record(raw, root, s, steps[s], {**KEY, "step": s})
        ledger.done(s, TILE)
    assert (root / "x.txt").read_text() == "1a"
    assert not ledger.unchanged("b", TILE, {**KEY, "step": "b"})
    _record(raw, root, "b", steps["b"], {**KEY, "step": "b"})
    ledger.done("b", TILE)
    assert (root / "x.txt").read_text() == "1ab"
    # the next bake finds every step as it left it
    nxt = _ledger(raw, ORDER)
    assert all(nxt.unchanged(s, TILE, {**KEY, "step": s}) for s in ORDER)


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


def test_code_hash_follows_imports(tmp_path, monkeypatch):
    """A step's hash covers the modules it imports, not every bake module."""
    seen = step_cache._closure("bake.walls")
    assert "bake.osm" in seen
    assert "bake.roof_colour" not in seen
    real = step_cache._module_path

    def edited(name):
        # the module's source with one more line, as an edit would leave it
        def path(module):
            p = real(module)
            if module != name or p is None:
                return p
            copy = tmp_path / f"{module}.py"
            copy.write_bytes(p.read_bytes() + b"\n")
            return copy

        return path

    def walls_hash(path):
        monkeypatch.setattr(step_cache, "_CODE", {})
        monkeypatch.setattr(step_cache, "_module_path", path)
        return step_cache.code_hash("bake.walls")

    walls = walls_hash(real)
    assert walls_hash(edited("bake.osm")) != walls
    assert walls_hash(edited("bake.roof_colour")) == walls


def test_a_dated_step_is_known():
    assert step_cache.dated("bake.trees")
    assert not step_cache.dated("bake.walls")


LOCK_TEXT = """
version = 1

[[package]]
name = "project"
version = "0.1.0"
source = { virtual = "." }
dependencies = [
    { name = "laspy", extra = ["lazrs"] },
    { name = "numpy" },
]

[package.dev-dependencies]
dev = [{ name = "ruff" }]

[[package]]
name = "laspy"
version = "2.7.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [{ name = "numpy" }]
wheels = [{ url = "laspy-2.7.0-a.whl", hash = "sha256:aa" }]

[package.optional-dependencies]
lazrs = [{ name = "lazrs" }]
other = [{ name = "unused" }]

[[package]]
name = "lazrs"
version = "0.8.1"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "numpy"
version = "2.5.4"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "ruff"
version = "0.17.3"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "unused"
version = "1.0"
source = { registry = "https://pypi.org/simple" }
"""


def test_the_locked_runtime_is_what_a_bake_runs_with():
    """The project's dependencies, the extras it asks for and what they
    depend on; not the dev group, not an extra nobody asked for."""
    names = [line.split()[0] for line in step_cache.locked_runtime(LOCK_TEXT).splitlines()]
    assert names == ["laspy", "lazrs", "numpy"]


def test_a_dev_tool_or_a_new_wheel_changes_no_key_and_a_runtime_version_does():
    base = step_cache.locked_runtime(LOCK_TEXT)
    assert step_cache.locked_runtime(LOCK_TEXT.replace("0.17.3", "0.17.4")) == base
    assert step_cache.locked_runtime(LOCK_TEXT.replace("sha256:aa", "sha256:bb")) == base
    assert step_cache.locked_runtime(LOCK_TEXT.replace("2.5.4", "2.5.5")) != base
    assert step_cache.locked_runtime(LOCK_TEXT.replace("0.8.1", "0.8.2")) != base


def test_a_lockfile_that_does_not_read_stands_whole():
    assert step_cache.locked_runtime("not [toml") == "not [toml"
    assert step_cache.locked_runtime("version = 1") == "version = 1"


def test_the_repo_lockfile_keys_the_bake_s_imports():
    """Every package a bake module imports by name is in the locked
    runtime (networkx came in only through scikit-image until it was
    named)."""
    locked = step_cache.locked_runtime(step_cache.LOCK.read_text())
    names = {line.split()[0] for line in locked.splitlines()}
    assert {"networkx", "numpy", "rasterio", "shapely", "scipy"} <= names
    assert not {"ruff", "pytest"} & names


def test_code_hash_leaves_the_cache_s_own_module_out(tmp_path, monkeypatch):
    """This module is in nearly every step's imports; its edits bake
    nothing again (`VERSION` says when they should)."""
    assert "bake.step_cache" in step_cache._closure("bake.walls")
    real = step_cache._module_path

    def edited(module):
        p = real(module)
        if module != "bake.step_cache" or p is None:
            return p
        copy = tmp_path / "step_cache.py"
        copy.write_bytes(p.read_bytes() + b"\n")
        return copy

    def walls_hash(path, version=step_cache.VERSION):
        monkeypatch.setattr(step_cache, "_CODE", {})
        monkeypatch.setattr(step_cache, "_module_path", path)
        monkeypatch.setattr(step_cache, "VERSION", version)
        return step_cache.code_hash("bake.walls")

    walls = walls_hash(real)
    assert walls_hash(edited) == walls
    assert walls_hash(real, step_cache.VERSION + 1) != walls
