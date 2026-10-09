"""The fetch's own caches (Wikidata, the trams' timetable): written through
a `.part` file, and a truncated one is deleted and named, not kept."""

import json
import urllib.request
from pathlib import Path

import pytest

from bake import bridge, landmarks, monuments
from bake.common import Tile

BOUNDS = (412000.0, 5656000.0, 414000.0, 5658000.0)


class Answer:
    def __init__(self, rows):
        self.body = json.dumps({"results": {"bindings": rows}}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, *_):
        return self.body


def _tile(raw: Path) -> Tile:
    return Tile("t", BOUNDS, 25833, raw, raw.parent / "data")


WIKIDATA_CACHES = [(landmarks, "landmarks"), (bridge, "bridges"), (monuments, "monuments")]


@pytest.mark.parametrize("module,name", WIKIDATA_CACHES)
def test_a_truncated_wikidata_cache_is_deleted_and_named(tmp_path, module, name):
    path = tmp_path / "raw" / "wikidata" / f"{name}_t.json"
    path.parent.mkdir(parents=True)
    path.write_text('{"source": "Wikidata (CC0)", "' + name + '": [{"id": "Q1"')
    with pytest.raises(OSError, match="not JSON"):
        module.load_wikidata(_tile(tmp_path / "raw"))
    assert not path.exists()


ROWS = {
    "landmarks": {
        "i": {"value": "http://www.wikidata.org/entity/Q42"},
        "label": {"value": "Zwinger"},
        "coord": {"value": "Point(13.73 51.05)"},
        "links": {"value": "30"},
    },
    "bridges": {
        "b": {"value": "http://www.wikidata.org/entity/Q42"},
        "label": {"value": "Augustusbrücke"},
        "coord": {"value": "Point(13.74 51.05)"},
        "types": {"value": "arch bridge"},
    },
    "monuments": {
        "i": {"value": "http://www.wikidata.org/entity/Q42"},
        "label": {"value": "Goldener Reiter"},
        "coord": {"value": "Point(13.74 51.05)"},
        "materials": {"value": "copper|gold leaf"},
    },
}


WIKIDATA_CACHES = [(landmarks, "landmarks"), (bridge, "bridges"), (monuments, "monuments")]


@pytest.mark.parametrize("module,name", WIKIDATA_CACHES)
def test_a_wikidata_cache_killed_mid_write_leaves_no_file_by_its_name(
    tmp_path, monkeypatch, module, name
):
    # The write dies half-way (a killed run, a full disk): what it left
    # must not carry the cache's name, or every later fetch would skip the
    # tile and every bake would read the truncated file.
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: Answer([ROWS[name]]))
    write_text = Path.write_text
    killed = []

    def dies_half_way(self, data, *args, **kwargs):
        if not killed:
            killed.append(self)
            write_text(self, data[: len(data) // 2], *args, **kwargs)
            raise OSError("killed mid-write")
        return write_text(self, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", dies_half_way)
    raw = tmp_path / "raw"
    dest = raw / "wikidata" / f"{name}_t.json"
    with pytest.raises(OSError, match="killed"):
        module.fetch_wikidata(raw, "t", BOUNDS, 25833)
    assert killed and killed[0] != dest
    assert not dest.exists()
    # the next run fetches the tile again and writes the whole cache
    module.fetch_wikidata(raw, "t", BOUNDS, 25833)
    assert sorted(p.name for p in dest.parent.iterdir() if p.suffix == ".json") == [dest.name]
    doc = json.loads(dest.read_text())
    assert [i["id"] for i in doc[name]] == ["Q42"]


def test_a_non_json_wikidata_answer_writes_nothing(tmp_path, monkeypatch):
    class Outage(Answer):
        def __init__(self):
            self.body = b"<html>503 Service Unavailable</html>"

    monkeypatch.setattr(bridge.urllib.request, "urlopen", lambda req, timeout: Outage())
    raw = tmp_path / "raw"
    bridge.fetch_wikidata(raw, "t", BOUNDS, 25833)
    assert not (raw / "wikidata").exists()


def test_the_trams_cache_is_written_through_part_and_rebuilt_when_unreadable(tmp_path, monkeypatch):
    from bake import transit

    (tmp_path / "nv_free.zip").write_bytes(b"zip")
    built = []
    monkeypatch.setattr(
        transit, "site_trams", lambda zip_path, bounds, epsg: built.append(1) or {"lines": []}
    )
    assert transit.cached_site_trams(tmp_path, BOUNDS, 25833) == {"lines": []}
    caches = sorted(p.name for p in tmp_path.iterdir() if p.name.startswith("trams_"))
    assert len(caches) == 1 and not caches[0].endswith(".part")
    cache = tmp_path / caches[0]
    cache.write_text('{"lines": [')
    assert transit.cached_site_trams(tmp_path, BOUNDS, 25833) == {"lines": []}
    assert len(built) == 2
    assert json.loads(cache.read_text()) == {"lines": []}
