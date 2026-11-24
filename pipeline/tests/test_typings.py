"""The stubs in `typings/` (plan 089) stay what they claim: partial stub
packages, each for a library that ships no types of its own.

A stub in pyright's `stubPath` wins over a library's inline types. Were
scipy to ship them (a `py.typed`), the stub
would go on shadowing them unnoticed; this fails instead, so that the stub
is checked against the library's own types and dropped where they cover
it."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

TYPINGS = Path(__file__).resolve().parent.parent / "typings"
STUBS = sorted(p for p in TYPINGS.iterdir() if p.is_dir() and p.name.endswith("-stubs"))


def test_there_are_stub_packages():
    assert [p.name for p in STUBS] == ["scipy-stubs"]


@pytest.mark.parametrize("stub", STUBS, ids=lambda p: p.name)
def test_each_stub_package_is_partial(stub: Path):
    # Without `partial`, the modules it does not hold would vanish for the
    # checker instead of being read from the library's source.
    assert (stub / "py.typed").read_text().strip() == "partial"


@pytest.mark.parametrize("stub", STUBS, ids=lambda p: p.name)
def test_the_stubbed_library_ships_no_types_of_its_own(stub: Path):
    library = stub.name.removesuffix("-stubs")
    spec = importlib.util.find_spec(library)
    assert spec is not None and spec.submodule_search_locations, library
    shipped = [Path(d) / "py.typed" for d in spec.submodule_search_locations]
    assert not any(p.exists() for p in shipped), (
        f"{library} now ships its own types ({shipped[0]}): check typings/{stub.name} "
        "against them and drop what they cover (typings/README.md)"
    )
