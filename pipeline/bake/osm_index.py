"""The site's OSM extract, read without parsing the whole `.osm.pbf` again for
every layer a bake asks of a tile.

GDAL's OSM driver has no index: every read — whatever its bbox and filter —
parses the whole extract (1.5–5 s for a city, 3–4 times that for Unna's
Regierungsbezirk), and the bakes read it 10 to 24 times a tile. So the
extract is read once into FlatGeobuf files beside it, which GDAL reads by
bbox through their R-tree in hundredths of a second, with the same
features in the same order, and `where` evaluated by the same OGR SQL
engine (FlatGeobuf has no SQL of its own; an SQLite store would compare
`=` case-sensitively where OGR SQL does not):

- `points` and `lines` are one file each for the whole extract: their
  features do not depend on the bbox they are read with (a node is a point,
  a way a line), so a bbox read of the file is the bbox read of the extract.
- `multipolygons` is one file too, but the driver's answer for it also
  depends on the filter: a relation the filter turns down is never built,
  so its closed outer ways — which a built relation takes out of the
  standalone areas — come back on their own (a `building` way outlining a
  site's multipolygon is a building only when the filter skips the site).
  So beside the whole layer (the relations, then the standalone ways by
  id, as the driver gives them) the index keeps every area way no
  tag-less relation absorbs (those are built whatever the filter), and
  which tagged relation absorbs each of the others; a read is then the
  relations that pass, and the ways that pass and that none of the passing
  relations absorbs — the driver's own rule. A way whose relation cannot
  be told (absorbed, but no built relation has its ring) sends that read
  to the extract itself.
- `multilinestrings` and `other_relations` are one file each: the driver
  filters every such relation before building it, on the same fields.

Everything lives in `<extract>.index/`, stamped with the extract's size and
time, GDAL's version and this module's source: a new extract, GDAL or
index code rebuilds it. Each file is written through a temporary name and
moved into place, so forked bakes reading the same extract never see half
a file, and a layer counts as built only once its `<layer>.done` marker is
there, written after all its files (a build cut short is built again)."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pyogrio
import shapely

from . import step_cache

# Bumped when the files' layout changes.
VERSION = 2
# The layers whose bbox read is a bbox read of one file.
WHOLE = ("points", "lines", "multilinestrings", "other_relations")
AREAS = "multipolygons"
# The feature's place in the extract's own order, kept through the R-tree.
SEQ = "_seq"
# An area way's id, and the relations that absorb it (index files).
WAY_ID = "osm_way_id"
REL_ID = "osm_id"


def index_dir(pbf: Path) -> Path:
    return pbf.with_name(pbf.name + ".index")


def _stamp(pbf: Path) -> dict:
    st = pbf.stat()
    return {
        "version": VERSION,
        # the code that builds the index, so a change to it is a new index
        "code": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "size": st.st_size,
        "mtime_ns": st.st_mtime_ns,
        "gdal": pyogrio.__gdal_version_string__,
    }


@contextmanager
def _locked(pbf: Path):
    """One process at a time builds the index (forked bakes share it)."""
    lock = pbf.with_name(pbf.name + ".index.lock")
    with open(lock, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _fresh(pbf: Path) -> Path:
    """The index folder, emptied first when it is not this extract's."""
    folder = index_dir(pbf)
    stamp = folder / "stamp.json"
    want = _stamp(pbf)
    try:
        if json.loads(stamp.read_text()) == want:
            return folder
    except (OSError, ValueError):
        pass
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    stamp.write_text(json.dumps(want))
    return folder


def _write(dest: Path, meta: dict, wkb: np.ndarray, fields: list) -> None:
    part = dest.with_name(f"{dest.stem}.{os.getpid()}.part{dest.suffix}")
    pyogrio.raw.write(
        part,
        wkb,
        [*fields, np.arange(len(wkb), dtype=np.int64)],
        [*meta["fields"], SEQ],
        driver="FlatGeobuf",
        geometry_type=meta["geometry_type"],
        crs=meta["crs"],
        encoding="UTF-8",
        layer=dest.stem,
    )
    part.replace(dest)


def _build_whole(pbf: Path, folder: Path, layer: str) -> None:
    meta, _, wkb, fields = pyogrio.raw.read(pbf, layer=layer)
    _write(folder / f"{layer}.fgb", meta, _wkb(wkb), list(fields))


def _build_areas(pbf: Path, folder: Path) -> None:
    """The whole area layer, the area ways no tag-less relation absorbs,
    and for each of those the tagged relations that absorb it (the closed
    outer ways the whole layer lacks, matched by ring)."""
    meta, _, wkb, fields = pyogrio.raw.read(pbf, layer=AREAS)
    wkb = _wkb(wkb)
    names = list(meta["fields"])
    _write(folder / f"{AREAS}.fgb", meta, wkb, list(fields))
    # A relation's own fields fail this filter, so only the tag-less
    # relations are built (and absorb their outer ways).
    wmeta, _, wwkb, wfields = pyogrio.raw.read(pbf, layer=AREAS, where=f"{WAY_ID} IS NOT NULL")
    wwkb = _wkb(wwkb)
    _write(folder / "area_ways.fgb", wmeta, wwkb, list(wfields))
    standalone = set(fields[names.index(WAY_ID)]) - {None}
    ways = list(wfields[list(wmeta["fields"]).index(WAY_ID)])
    absorbed = [i for i, w in enumerate(ways) if w not in standalone]
    rel_ids = fields[names.index(REL_ID)]
    rels = np.nonzero(np.array([r is not None for r in rel_ids], dtype=bool))[0]
    rel_geoms = shapely.from_wkb(wkb[rels])
    tree = shapely.STRtree(rel_geoms)
    owners: dict[str, list[str]] = {}
    for i in absorbed:
        ring = shapely.from_wkb(wwkb[i])
        found = []
        for j in tree.query(ring, predicate="intersects"):
            for poly in shapely.get_parts(rel_geoms[j]):
                if shapely.equals(
                    shapely.Polygon(poly.exterior), shapely.Polygon(ring.geoms[0].exterior)
                ):
                    found.append(rel_ids[rels[j]])
                    break
        owners[ways[i]] = found
    used = sorted({r for found in owners.values() for r in found})
    pick = rels[np.isin(rel_ids[rels], used)] if used else np.zeros(0, dtype=int)
    if len(pick):
        _write(folder / "absorbers.fgb", meta, wkb[pick], [f[pick] for f in fields])
    part = folder / f"absorbed.{os.getpid()}.part.json"
    part.write_text(json.dumps(owners))
    part.replace(folder / "absorbed.json")


def _ensure(pbf: Path, layer: str) -> Path:
    with _locked(pbf):
        folder = _fresh(pbf)
        # written last, so a build cut short is built again
        done = folder / f"{layer}.done"
        if not done.exists():
            if layer == AREAS:
                _build_areas(pbf, folder)
            else:
                _build_whole(pbf, folder, layer)
            done.touch()
    return folder


def read(
    pbf: Path,
    layer: str,
    bbox: tuple[float, float, float, float],
    where: str | None,
    columns: list[str] | None,
) -> tuple[np.ndarray, list[str], list[np.ndarray]]:
    """What `pyogrio.raw.read(pbf, layer=layer, bbox=bbox, where=where,
    columns=columns)` returns — the geometries as WKB, the field names and
    their columns — from the index. The filter may name columns that are
    not read (the OSM driver evaluates it on every field), so every column
    is read and the asked ones kept, in the layer's order."""
    step_cache.note_read(pbf)
    if layer not in (*WHOLE, AREAS):
        return _direct(pbf, layer, bbox, where, columns)
    folder = _ensure(pbf, layer)
    if layer != AREAS:
        names, wkb, fields = _part(folder / f"{layer}.fgb", bbox, where)
        return _keep(names, wkb, fields, columns)
    names, wkb, fields = _part(folder / f"{AREAS}.fgb", bbox, where)
    is_rel = np.array([r is not None for r in fields[names.index(REL_ID)]], dtype=bool)
    _, wwkb, wfields = _part(folder / "area_ways.fgb", bbox, where)
    owners = json.loads((folder / "absorbed.json").read_text())
    ways = wfields[names.index(WAY_ID)]
    held = [w for w in ways if w in owners]
    if held:
        if any(not owners[w] for w in held):
            return _direct(pbf, layer, bbox, where, columns)
        # the absorbing relations that pass the filter, wherever they lie
        _, _, afields = _part(folder / "absorbers.fgb", None, where)
        passing = set(afields[names.index(REL_ID)])
        out = {w for w in held if passing.intersection(owners[w])}
        keep = np.array([w not in out for w in ways], dtype=bool)
        wwkb, wfields = wwkb[keep], [f[keep] for f in wfields]
    wkb = np.concatenate([wkb[is_rel], wwkb])
    fields = [np.concatenate([f[is_rel], g]) for f, g in zip(fields, wfields, strict=True)]
    return _keep(names, wkb, fields, columns)


def _part(path: Path, bbox, where) -> tuple[list[str], np.ndarray, list[np.ndarray]]:
    """A file's features in the extract's order, every column."""
    meta, _, wkb, fields = pyogrio.raw.read(path, bbox=bbox, where=where)
    names = list(meta["fields"])
    order = np.argsort(fields[names.index(SEQ)], kind="stable")
    keep = [i for i, n in enumerate(names) if n != SEQ]
    return [names[i] for i in keep], _wkb(wkb)[order], [fields[i][order] for i in keep]


def _keep(names, wkb, fields, columns):
    keep = [i for i, n in enumerate(names) if columns is None or n in columns]
    return wkb, [names[i] for i in keep], [fields[i] for i in keep]


def _direct(pbf, layer, bbox, where, columns):
    meta, _, wkb, fields = pyogrio.raw.read(
        pbf, layer=layer, bbox=bbox, where=where, columns=columns
    )
    return _wkb(wkb), list(meta["fields"]), list(fields)


def _wkb(wkb) -> np.ndarray:
    return wkb if wkb is not None else np.array([], dtype=object)
