"""Where the OSM extract comes from (osm_source.py): BBBike's published
boundary, whether it covers a site with the bakes' widest read margin, the
record beside the extract and the provenance a bake writes from it — and
that no bake reads OSM farther beyond a tile than that margin."""

import ast
import json
from pathlib import Path

import pytest

from bake import osm_source
from bake.common import Tile

BAKE = Path(__file__).resolve().parent.parent / "bake"
# BBBike's Dresden boundary as published (Dresden.poly, 2026-11-16)
DRESDEN = """Dresden
1
   13.43  50.88
   14.18  50.88
   14.18  51.23
   13.43  51.23
END
END
"""


def _tile(e: int, n: int, epsg: int = 25833) -> Tile:
    x, y = e * 1000.0, n * 1000.0
    return Tile(f"{e}_{n}", (x, y, x + 2000, y + 2000), epsg, Path("raw"), Path("data"))


def test_a_poly_file_with_a_hole_parses():
    poly = osm_source.parse_poly(
        "x\n1\n 0 0\n 4 0\n 4 4\n 0 4\nEND\n!2\n 1 1\n 2 1\n 2 2\n 1 2\nEND\nEND\n"
    )
    assert poly.area == pytest.approx(15.0)
    with pytest.raises(ValueError):
        osm_source.parse_poly("x\nEND\n")


def test_bbbikes_dresden_covers_dresden_but_not_meissen():
    boundary = osm_source.parse_poly(DRESDEN)
    assert osm_source.shortfall(boundary, [_tile(412, 5656), _tile(408, 5658)]) is None
    # Meißen's one tile ends 0.025° inside the rectangle's west edge, short
    # of the 0.05° the monorail's chain is read around a tile
    short = osm_source.shortfall(boundary, [_tile(392, 5668)])
    assert short is not None and short.startswith("west by 0.02")


def test_the_record_names_the_source_and_day_and_provenance_takes_it(tmp_path):
    pbf = tmp_path / "Leipzig.osm.pbf"
    pbf.write_text("x")
    url = "https://download.bbbike.org/osm/bbbike/Leipzig/Leipzig.osm.pbf"
    osm_source.write_record(pbf, url, "2026-11-14T16:39:33+00:00", "abc")
    assert "from BBBike" in osm_source.describe(pbf) and "2026-11-14" in osm_source.describe(pbf)
    provenance = tmp_path / "provenance.json"
    provenance.write_text(json.dumps({"openstreetmap": {"licence": "ODbL"}}))
    osm_source.record_bake(provenance, pbf, ["walls", "lamps"])
    osm = json.loads(provenance.read_text())["openstreetmap"]
    assert osm["licence"] == "ODbL"
    assert list(osm["baked"]) == ["lamps", "walls"]
    # the data's day first: the Open-Data-Wächter reads the age from it
    assert osm["baked"]["walls"]["dataAsOf"].startswith("2026-11-14 (BBBike extract")
    # an extract placed by hand has no day to claim
    (tmp_path / "Leipzig.osm.pbf.source.json").unlink()
    assert osm_source.provenance_line(None, pbf, "2026-11-16").startswith("unknown")


# The functions that read OSM around a tile, and the index of their margin
# among the positional arguments: the readers in osm.py, and every bake
# function that hands its own `margin` on to one (found below).
READERS = {"read_osm": 4, "read_ways": 3, "wgs84_bbox": 1}


def _number(node: ast.expr, consts: dict[str, float]) -> float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, int | float):
        return float(node.value)
    if isinstance(node, ast.Name):
        return consts.get(node.id)
    return None


def _margin_arg(call: ast.Call, index: int) -> ast.expr | None:
    for kw in call.keywords:
        if kw.arg == "margin":
            return kw.value
    return call.args[index] if len(call.args) > index else None


def _called(call: ast.Call) -> str | None:
    f = call.func
    return f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None


def test_no_bake_reads_osm_beyond_the_margin_the_coverage_check_uses():
    trees = {p: ast.parse(p.read_text()) for p in sorted(BAKE.glob("*.py"))}
    readers = dict(READERS)
    # a function whose `margin` parameter reaches a reader is one too
    grew = True
    while grew:
        grew = False
        for tree in trees.values():
            for fn in ast.walk(tree):
                if not isinstance(fn, ast.FunctionDef) or fn.name in readers:
                    continue
                names = [a.arg for a in fn.args.args]
                if "margin" not in names:
                    continue
                for call in ast.walk(fn):
                    if isinstance(call, ast.Call) and _called(call) in readers:
                        arg = _margin_arg(call, readers[_called(call)])
                        if isinstance(arg, ast.Name) and arg.id == "margin":
                            readers[fn.name] = names.index("margin")
                            grew = True
                            break
    seen, unread = [], []
    for path, tree in trees.items():
        if path.name in ("osm_source.py", "coverage.py", "murals.py"):
            continue  # the check itself; the two read the site's own bbox
        consts = {
            t.id: v
            for node in tree.body
            if isinstance(node, ast.Assign)
            for t in node.targets
            if isinstance(t, ast.Name) and (v := _number(node.value, {})) is not None
        }
        for fn in ast.walk(tree):
            if isinstance(fn, ast.FunctionDef) and fn.name in readers:
                args = fn.args
                named = [a.arg for a in args.args][len(args.args) - len(args.defaults) :]
                defaults = dict(zip(named, args.defaults, strict=True))
                if "margin" in defaults:
                    seen.append((path.name, fn.name, _number(defaults["margin"], consts)))
        for call in ast.walk(tree):
            if not (isinstance(call, ast.Call) and _called(call) in readers):
                continue
            arg = _margin_arg(call, readers[_called(call)])
            if arg is None or (isinstance(arg, ast.Name) and arg.id == "margin"):
                continue  # the default (checked above), or a caller's (checked at it)
            value = _number(arg, consts)
            if value is None:
                unread.append(f"{path.name}:{call.lineno}")
            else:
                seen.append((path.name, call.lineno, value))
    assert not unread, f"margins the test cannot read (a literal or a module constant): {unread}"
    assert len(seen) > 20
    wide = [s for s in seen if s[2] is not None and s[2] > osm_source.MAX_MARGIN_DEG]
    assert not wide, f"read beyond MAX_MARGIN_DEG — raise it, and the docs' coverage table: {wide}"
    assert max(s[2] for s in seen if s[2] is not None) == osm_source.MAX_MARGIN_DEG
