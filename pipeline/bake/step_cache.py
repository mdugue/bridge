"""Skipping a step whose tile would come out the same.

A bake step reads files (the tile's committed artifacts and its
neighbours', the raw rasters, the Basis-DLM, the OSM extract) and writes
others. Each run of a step on a tile records what it read, what it looked
for, which folders it listed and what it wrote, with every file's content
hash, in a manifest beside the raw data; the next run of that step on that
tile skips it when the step's code (its module and every bake module it
imports, and the locked packages), the site spec, everything it read or
looked for and everything it wrote are as they were. So after a change to
one step's code, or to one input, only the steps that read what changed
run again — the rest of a `bake all` is a check of file times.

What the step reads is watched where Python opens files (an audit hook:
`open`, `os.listdir`, `os.scandir`, renames and removals), where GDAL does
(`rasterio.open`, `pyogrio.raw.read` / `write`, with a shapefile's sidecar
files) and where it asks whether a file is there (`os.stat`, behind
`Path.exists` and friends). Only paths under the working directory and the
site's data and raw folders count; the OSM index's files stand for the
extract they are built from, which is read instead. A file one step
writes and a later one rewrites (`islands`, `lamp-heights`) is judged by
what a full run would have there at each step (`Ledger`)."""

from __future__ import annotations

import ast
import hashlib
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path

import pyogrio
import pyogrio.raw
import rasterio

# Bumped when the manifest's meaning changes.
VERSION = 2
PACKAGE = Path(__file__).resolve().parent
LOCK = PACKAGE.parent / "uv.lock"
# A shapefile's other files, read by GDAL with it.
SIDECARS = (".dbf", ".shx", ".prj", ".cpg", ".qix", ".sbn", ".sbx")
WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


class Recorder:
    """What one step on one tile touched, by absolute path."""

    def __init__(self, roots: list[str]) -> None:
        self.roots = tuple(os.path.abspath(r).rstrip(os.sep) + os.sep for r in roots)
        # read: the entry it was read at where that is known already (a
        # memo's), else None (taken when the run is saved)
        self.reads: dict[str, list | None] = {}
        self.writes: set[str] = set()
        # read, then written: what it held before the first write
        self.before: dict[str, list | None] = {}
        self.probes: dict[str, str] = {}
        self.listed: set[str] = set()

    def _norm(self, path) -> str | None:
        if isinstance(path, int):
            return None
        try:
            p = os.path.abspath(os.fsdecode(path))
        except TypeError:
            return None
        if not p.startswith(self.roots):
            return None
        if ".index" + os.sep in p or "__pycache__" in p or p.endswith(".part"):
            return None
        if ".bake-cache" + os.sep in p or p.endswith(".lock"):
            return None
        return p

    def read(self, path, entry: list | None = None) -> None:
        p = self._norm(path)
        if p is None:
            return
        if p in self.writes:
            return
        if not os.path.isfile(p):
            # an open that fails (a cache not made yet) only looked for it
            self.probe(p, _kind(p))
            return
        if self.reads.get(p) is None:
            self.reads[p] = entry
        if p.endswith(".shp"):
            stem = p[:-4]
            for ext in SIDECARS:
                if os.path.exists(stem + ext):
                    self.reads.setdefault(stem + ext, None)

    def write(self, path) -> None:
        p = self._norm(path)
        if p is None:
            return
        if p in self.reads and p not in self.writes:
            # the write has not happened yet: the file is as it was read
            self.before[p] = self.reads[p] or _file_entry(p)
        self.writes.add(p)

    def probe(self, path, kind: str) -> None:
        p = self._norm(path)
        if p is not None and p not in self.probes and p not in self.writes:
            self.probes[p] = kind

    def listing(self, path) -> None:
        p = self._norm(path if path is not None else ".")
        if p is not None:
            self.listed.add(p)


# The step's recorder, and the memos being computed inside it (`memo`).
_ACTIVE: list[Recorder] = []
_BUSY = False
_INSTALLED = False


def _each(call) -> None:
    """`call(recorder)` for every active recorder, with the watching off
    (what a recorder does itself is not the step's)."""
    global _BUSY
    if not _ACTIVE or _BUSY:
        return
    _BUSY = True
    try:
        for rec in _ACTIVE:
            call(rec)
    finally:
        _BUSY = False


def _audit(event: str, args) -> None:
    if not _ACTIVE or _BUSY:
        return
    if event == "open":
        path, mode, flags = args
        writing = (
            any(c in mode for c in "wax+") if isinstance(mode, str) else bool(flags & WRITE_FLAGS)
        )
        _each(lambda r: r.write(path) if writing else r.read(path))
    elif event in ("os.listdir", "os.scandir"):
        _each(lambda r: r.listing(args[0]))
    elif event == "os.rename":
        _each(lambda r: (r.write(args[0]), r.write(args[1])))
    elif event in ("os.remove", "os.rmdir"):
        _each(lambda r: r.write(args[0]))


def _wrap(module, name: str, kind: str) -> None:
    inner = getattr(module, name)

    def wrapped(path, *args, **kwargs):
        mode = kwargs.get("mode", args[0] if args else "r")
        writing = kind == "write" or (kind == "open" and isinstance(mode, str) and mode != "r")
        _each(lambda r: r.write(path) if writing else r.read(path))
        return inner(path, *args, **kwargs)

    wrapped.__wrapped__ = inner  # type: ignore[attr-defined]
    setattr(module, name, wrapped)


def _install() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True
    sys.addaudithook(_audit)
    _wrap(rasterio, "open", "open")
    _wrap(pyogrio.raw, "read", "read")
    _wrap(pyogrio.raw, "write", "write")
    stat = os.stat

    def watched_stat(path, *args, **kwargs):
        try:
            st = stat(path, *args, **kwargs)
        except OSError:
            _each(lambda r: r.probe(path, "missing"))
            raise
        kind = "dir" if (st.st_mode & 0o170000) == 0o040000 else "file"
        _each(lambda r: r.probe(path, kind))
        return st

    watched_stat.__wrapped__ = stat  # type: ignore[attr-defined]
    os.stat = watched_stat
    for name in ("exists", "isfile", "isdir", "lexists"):
        _wrap_probe(name)


def _wrap_probe(name: str) -> None:
    """`os.path.exists` and friends, which may not go through `os.stat`."""
    inner = getattr(os.path, name)

    def wrapped(path):
        found = inner(path)
        _each(lambda r: r.probe(path, _kind(os.fspath(path)) if found else "missing"))
        return found

    wrapped.__wrapped__ = inner  # type: ignore[attr-defined]
    setattr(os.path, name, wrapped)


def note_read(path) -> None:
    """A file the step depends on that it reads through something else (the
    OSM index stands for its extract)."""
    _each(lambda r: r.read(path))


@contextmanager
def recording(roots: list[str]):
    """Records what the body touches under `roots`."""
    _install()
    rec = Recorder(roots)
    _ACTIVE.append(rec)
    try:
        yield rec
    finally:
        _ACTIVE.remove(rec)


@contextmanager
def quiet():
    """Nothing the body touches is recorded (a cache of the step's own,
    whose sources it notes with `note_read`)."""
    global _BUSY
    was = _BUSY
    _BUSY = True
    try:
        yield
    finally:
        _BUSY = was


def memo(store: dict, key, make):
    """`store[key]`, made by `make()` on first use — a site-wide measurement
    a step keeps for the process (and its forked workers). What making it
    read is replayed into every later step that takes it from the store, at
    the state it was read in: a file rewritten since (a class raster the
    land cover bakes again) is then recorded as changed, so the step runs
    again on the next bake, with the measurement made anew."""
    if key not in store:
        _install()
        seen = Recorder([os.sep])
        _ACTIVE.append(seen)
        try:
            value = make()
        finally:
            _ACTIVE.remove(seen)
        read = {p: e or _file_entry(p) for p, e in seen.reads.items()}
        store[key] = (value, read, dict(seen.probes), set(seen.listed))
    value, read, probes, listed = store[key]

    def replay(rec: Recorder) -> None:
        for p, e in read.items():
            rec.read(p, e)
        for p, kind in probes.items():
            rec.probe(p, kind)
        for p in listed:
            rec.listing(p)

    _each(replay)
    return value


# --- hashes --------------------------------------------------------------

# sha256 by (path, size, time): this process's, and the manifests' (a file
# unchanged since its last run is not read again)
_DIGESTS: dict[tuple[str, int, int], str] = {}


def _stat(path: str) -> os.stat_result | None:
    try:
        return os.lstat(path) if os.path.islink(path) else _real_stat(path)
    except OSError:
        return None


def _real_stat(path: str) -> os.stat_result:
    stat = getattr(os.stat, "__wrapped__", None) or os.stat
    return stat(path)


def digest(path: str) -> str | None:
    """A file's sha256, once per size and time."""
    st = _stat(path)
    if st is None or not os.path.isfile(path):
        return None
    key = (path, st.st_size, st.st_mtime_ns)
    if key not in _DIGESTS:
        with quiet(), open(path, "rb") as fh:
            _DIGESTS[key] = hashlib.file_digest(fh, "sha256").hexdigest()
    return _DIGESTS[key]


def _known(path: str, entry: list | None) -> None:
    if entry is not None and entry[2] is not None:
        _DIGESTS.setdefault((path, entry[0], entry[1]), entry[2])


def _file_entry(path: str) -> list | None:
    with quiet():
        st = _stat(path)
        if st is None or not os.path.isfile(path):
            return None
        return [st.st_size, st.st_mtime_ns, digest(path)]


def _same_file(path: str, entry: list | None) -> bool:
    """Whether the file at `path` is what `entry` recorded (None: none)."""
    with quiet():
        st = _stat(path)
        if entry is None:
            return st is None or not os.path.isfile(path)
        if st is None or not os.path.isfile(path):
            return False
        if [st.st_size, st.st_mtime_ns] == entry[:2]:
            return True
        return st.st_size == entry[0] and digest(path) == entry[2]


def _same_entry(a: list | None, b: list | None) -> bool:
    if a is None or b is None:
        return a is b
    return a[0] == b[0] and a[2] == b[2]


def _kind(path: str) -> str:
    st = _stat(path)
    if st is None:
        return "missing"
    return "dir" if os.path.isdir(path) else "file"


def _listing(path: str) -> str:
    try:
        names = sorted(os.listdir(path))
    except OSError:
        names = None
    return hashlib.sha256(json.dumps(names).encode()).hexdigest()


# --- code ----------------------------------------------------------------

_CODE: dict[str, str] = {}


def _imports(module: str) -> set[str]:
    """The bake modules `module` imports (anywhere in its body)."""
    path = _module_path(module)
    if path is None:
        return set()
    found: set[str] = set()
    tree = ast.parse(path.read_text(), str(path))
    base = module.rsplit(".", 1)[0] if path.name != "__init__.py" else module
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:
                parts = base.split(".")[: len(base.split(".")) - node.level + 1]
                prefix = ".".join(parts)
                target = f"{prefix}.{node.module}" if node.module else prefix
            elif node.module and node.module.startswith("bake"):
                target = node.module
            else:
                continue
            found.add(target)
            for alias in node.names:
                found.add(f"{target}.{alias.name}")
        elif isinstance(node, ast.Import):
            found.update(a.name for a in node.names if a.name.startswith("bake"))
    return {m for m in found if _module_path(m) is not None}


def _module_path(module: str) -> Path | None:
    rel = module.split(".", 1)[1].replace(".", "/") if "." in module else ""
    for p in (PACKAGE / f"{rel}.py", PACKAGE / rel / "__init__.py"):
        if rel and p.exists():
            return p
    return PACKAGE / "__init__.py" if module == "bake" else None


def _closure(module: str) -> set[str]:
    """`module` and every bake module it reaches through its imports."""
    seen: set[str] = set()
    todo = [module]
    while todo:
        m = todo.pop()
        if m in seen:
            continue
        seen.add(m)
        todo.extend(_imports(m) - seen)
    return seen


def code_hash(module: str) -> str:
    """The step's module, every bake module it reaches and the lockfile."""
    if module not in _CODE:
        h = hashlib.sha256(f"{VERSION}:{sys.version_info[:2]}".encode())
        for m in sorted(_closure(module)):
            p = _module_path(m)
            if p is not None:
                h.update(m.encode() + b"\0" + p.read_bytes() + b"\0")
        h.update(LOCK.read_bytes() if LOCK.exists() else b"")
        _CODE[module] = h.hexdigest()
    return _CODE[module]


def dated(module: str) -> bool:
    """Whether the step reads the clock (the cadastre's young trees are
    young by today's year): its key then carries the year."""
    return any(_reads_clock(p) for m in _closure(module) if (p := _module_path(m)) is not None)


def _reads_clock(path: Path) -> bool:
    """A `date.today()` or `datetime.now()` call in the module."""
    for node in ast.walk(ast.parse(path.read_text(), str(path))):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("today", "now")
        ):
            return True
    return False


# --- manifests -----------------------------------------------------------


def manifest_path(raw: Path, site: str, step: str, tile: str) -> Path:
    return raw / ".bake-cache" / site / step / f"{tile}.json"


def save(path: Path, key: dict, rec: Recorder) -> None:
    m = {
        "version": VERSION,
        "key": key,
        "inputs": {
            p: e or _file_entry(p) for p, e in sorted(rec.reads.items()) if p not in rec.writes
        },
        "before": dict(sorted(rec.before.items())),
        "probes": {p: _kind(p) for p in sorted(set(rec.probes) - rec.writes - set(rec.reads))},
        "listed": {p: _listing(p) for p in sorted(rec.listed)},
        "outputs": {p: _file_entry(p) for p in sorted(rec.writes)},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(f"{path.name}.{os.getpid()}.part")
    part.write_text(json.dumps(m, indent=0))
    part.replace(path)


class Ledger:
    """Every recorded run of a site's steps, and which ran in this bake.

    Some steps rewrite what an earlier one wrote (`islands` the land
    cover's class raster, `lamp-heights` the lamps'), so the file on disk
    is the last writer's, not the earlier step's. A run that skips what is
    unchanged is judged against what a full run would see: before step k a
    file holds what its last writer before k wrote (recorded in that
    writer's manifest) — what is there now if a writer ran in this bake or
    none comes before k — and the output a step recorded must lead,
    through the later writers' recorded runs (each read what the one before
    it wrote), to what is there now. A step that runs while a file it reads
    holds a later writer's output instead first has that file's earlier
    writers run again (`restore`)."""

    def __init__(self, raw: Path, site: str, order: list[str]) -> None:
        self.raw, self.site = raw, site
        self.order = {s: i for i, s in enumerate(order)}
        self.runs: dict[tuple[str, str], dict] = {}
        self.writers: dict[str, set[tuple[int, str, str]]] = {}
        self.ran: set[tuple[str, str]] = set()
        for step in order:
            folder = raw / ".bake-cache" / site / step
            if folder.is_dir():
                for f in folder.glob("*.json"):
                    self._load(step, f.stem)

    def _load(self, step: str, tile: str) -> None:
        old = self.runs.pop((step, tile), None)
        if old is not None:
            for p in old["outputs"]:
                self.writers[p].discard((self.order[step], step, tile))
        try:
            m = json.loads(manifest_path(self.raw, self.site, step, tile).read_text())
        except (OSError, ValueError):
            return
        if m.get("version") != VERSION:
            return
        self.runs[(step, tile)] = m
        for part in ("inputs", "before", "outputs"):
            for p, e in m[part].items():
                _known(p, e)
        for p in m["outputs"]:
            self.writers.setdefault(p, set()).add((self.order[step], step, tile))

    def done(self, step: str, tile: str) -> None:
        """`step` ran on `tile` in this bake (its manifest saved, if any)."""
        self.ran.add((step, tile))
        self._load(step, tile)

    def _held(self, p: str, k: int) -> tuple[bool, list | None]:
        """What `p` holds before step k in a full run: (True, None) for
        what is there now, else (False, the last earlier writer's output)."""
        earlier = sorted(w for w in self.writers.get(p, ()) if w[0] < k)
        if not earlier or any((s, t) in self.ran for _, s, t in earlier):
            return True, None
        _, s, t = earlier[-1]
        return False, self.runs[(s, t)]["outputs"][p]

    def _lasts(self, p: str, k: int, entry: list | None) -> bool:
        """Whether `p` as step k wrote it is, through the later writers'
        runs, what is there now."""
        state = entry
        for _, s, t in sorted(w for w in self.writers.get(p, ()) if w[0] > k):
            run = self.runs[(s, t)]
            if p not in run["before"] or not _same_entry(run["before"][p], state):
                return False
            state = run["outputs"][p]
        return _same_file(p, state)

    def unchanged(self, step: str, tile: str, key: dict) -> bool:
        """Whether the recorded run of `step` on `tile` would come out the
        same now."""
        m = self.runs.get((step, tile))
        if m is None or m["key"] != key:
            return False
        k = self.order[step]
        for p, e in (*m["inputs"].items(), *m["before"].items()):
            now, held = self._held(p, k)
            if not (_same_file(p, e) if now else _same_entry(held, e)):
                return False
        return (
            all(_kind(p) == kind for p, kind in m["probes"].items())
            and all(_listing(p) == h for p, h in m["listed"].items())
            and all(self._lasts(p, k, e) for p, e in m["outputs"].items())
        )

    def restore(self, step: str, tile: str) -> list[tuple[str, str]]:
        """The earlier steps to run again before `step` runs on `tile`, in
        order: the writers of a file it read last time whose output a later
        writer has replaced on disk."""
        found: set[tuple[int, str, str]] = set()
        todo = [(step, tile)]
        while todo:
            s0, t0 = todo.pop()
            m = self.runs.get((s0, t0))
            if m is None:
                continue
            k = self.order[s0]
            for p in (*m["inputs"], *m["before"]):
                now, held = self._held(p, k)
                if now or _same_file(p, held):
                    continue
                for w in self.writers[p]:
                    if w[0] < k and w not in found:
                        found.add(w)
                        todo.append((w[1], w[2]))
        return [(s, t) for _, s, t in sorted(found)]

    def after(self, restored: list[tuple[str, str]], step: str) -> list[tuple[str, str]]:
        """The later writers to run again once `step` is done, in order:
        those after it of the files the `restored` runs write, which a
        restore put back to an earlier writer's output (`lamp-heights` after
        a restored `lamps`) — a bake of `step` alone would leave them so."""
        k = self.order[step]
        found: set[tuple[int, str, str]] = set()
        for s0, t0 in restored:
            m = self.runs.get((s0, t0))
            for p in m["outputs"] if m else ():
                found |= {w for w in self.writers.get(p, ()) if w[0] > k}
        return [(s, t) for _, s, t in sorted(found)]
