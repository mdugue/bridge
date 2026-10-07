"""The fetch's own caches (Wikidata, the trams' timetable): written through
a `.part` file, and a truncated one is deleted and named, not kept."""

import json
from pathlib import Path

import pytest

from bake import bridge, landmarks
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


@pytest.mark.parametrize("module,name", [(landmarks, "landmarks"), (bridge, "bridges")])
def test_a_truncated_wikidata_cache_is_deleted_and_named(tmp_path, module, name):
    path = tmp_path / "raw" / "wikidata" / f"{name}_t.json"
    path.parent.mkdir(parents=True)
    path.write_text('{"source": "Wikidata (CC0)", "' + name + '": [{"id": "Q1"')
    with pytest.raises(OSError, match="not JSON"):
        module.load_wikidata(_tile(tmp_path / "raw"))
    assert not path.exists()


def test_the_wikidata_landmarks_cache_is_written_through_part(tmp_path, monkeypatch):
    row = {
        "i": {"value": "http://www.wikidata.org/entity/Q42"},
        "label": {"value": "Zwinger"},
        "coord": {"value": "Point(13.73 51.05)"},
        "links": {"value": "30"},
    }
    monkeypatch.setattr(landmarks.urllib.request, "urlopen", lambda req, timeout: Answer([row]))
    raw = tmp_path / "raw"
    landmarks.fetch_wikidata(raw, "t", BOUNDS, 25833)
    folder = raw / "wikidata"
    assert [p.name for p in folder.iterdir()] == ["landmarks_t.json"]
    doc = json.loads((folder / "landmarks_t.json").read_text())
    assert [i["id"] for i in doc["landmarks"]] == ["Q42"]


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
