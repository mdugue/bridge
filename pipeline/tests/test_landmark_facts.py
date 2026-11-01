"""The nameplate's facts from Wikidata's statements (landmark_facts.py)."""

import json

from bake import landmark_facts as lf

FRAUENKIRCHE = [
    {"p": "inception", "v": "1726-01-01T00:00:00Z"},
    {"p": "event", "ev": "Q18752057", "t": "1726-08-26T00:00:00Z"},
    {"p": "event", "ev": "Q1762010", "t": "1734-02-28T00:00:00Z"},
    {"p": "event", "ev": "Q1370468", "t": "2005-10-30T00:00:00Z"},
    {"p": "architect", "v": "George Bähr", "lang": "de"},
    {"p": "architect", "v": "George Bahr", "lang": "en"},
    {"p": "height", "v": "91.24"},
]


def test_frauenkirche():
    assert lf.facts_of(FRAUENKIRCHE) == {
        "built": [1726, 1734],
        "rebuilt": [2005],
        "architects": ["George Bähr"],
        "height": 91.2,
    }


def test_a_late_end_is_not_the_building():
    # consecrated centuries after its foundation: the start alone
    facts = lf.facts_of(
        [
            {"p": "inception", "v": "1248-01-01T00:00:00Z"},
            {"p": "event", "ev": "Q25640113", "t": "1880-10-15T00:00:00Z"},
        ]
    )
    assert facts == {"built": [1248]}


def test_spans_and_rebuilds_with_start_and_end():
    facts = lf.facts_of(
        [
            {
                "p": "event",
                "ev": "Q385378",
                "s": "1838-01-01T00:00:00Z",
                "e": "1841-01-01T00:00:00Z",
            },
            {
                "p": "event",
                "ev": "Q94394406",
                "s": "1977-01-01T00:00:00Z",
                "e": "1985-01-01T00:00:00Z",
            },
        ]
    )
    assert facts == {"built": [1838, 1841], "rebuilt": [1977, 1985]}


def test_a_rebuild_keeps_its_stated_end():
    # a start at or after the end, or a century before it: the end alone
    for start, end in (("1950", "1950"), ("1880", "1990")):
        facts = lf.facts_of(
            [
                {
                    "p": "event",
                    "ev": "Q1370468",
                    "s": f"{start}-01-01T00:00:00Z",
                    "e": f"{end}-01-01T00:00:00Z",
                }
            ]
        )
        assert facts == {"rebuilt": [int(end)]}


def test_a_rebuild_only_begun():
    facts = lf.facts_of([{"p": "event", "ev": "Q1370468", "s": "1945-01-01T00:00:00Z"}])
    assert facts == {"rebuiltFrom": 1945}


def test_unknown_and_ancient_dates_are_left_out():
    facts = lf.facts_of(
        [
            {"p": "inception", "v": "http://www.wikidata.org/.well-known/genid/abc"},
            {"p": "inception", "v": "-0500-01-01T00:00:00Z"},
            {"p": "height", "v": "n/a"},
        ]
    )
    assert facts == {}


def test_architects_fall_back_and_are_capped():
    facts = lf.facts_of(
        [
            {"p": "architect", "v": "C", "lang": "en"},
            {"p": "architect", "v": "B", "lang": "mul"},
            {"p": "architect", "v": "A", "lang": "mul"},
            {"p": "architect", "v": "Z", "lang": "mul"},
        ]
    )
    assert facts == {"architects": ["A", "B"]}


def test_rows_by_item():
    rows = [
        {
            "i": {"value": "http://www.wikidata.org/entity/Q1"},
            "p": {"value": "event"},
            "ev": {"value": "http://www.wikidata.org/entity/Q1762010"},
            "t": {"value": "1734-02-28T00:00:00Z"},
        }
    ]
    assert lf.rows_by_item(rows) == {
        "Q1": [{"p": "event", "t": "1734-02-28T00:00:00Z", "ev": "Q1762010"}]
    }


def test_run_site_climbs_to_buildings(tmp_path):
    raw, data = tmp_path / "raw", tmp_path / "data"
    (data / "dlm").mkdir(parents=True)
    (data / "cityjson").mkdir()
    (data / "dlm" / "landmarks_t1.json").write_text(
        json.dumps(
            {
                "landmarks": [
                    {"id": "Q1", "name": "Kirche", "objects": ["B1", "P1", "P2"]},
                    {"id": "Q2", "name": "Ohne Fakten", "objects": ["B2"]},
                ]
            }
        )
    )
    (data / "cityjson" / "lod2_t1.city.json").write_text(
        json.dumps(
            {
                "CityObjects": {
                    "B1": {"children": ["P1", "P2"]},
                    "P1": {"parents": ["B1"]},
                    "P2": {"parents": ["B1"]},
                    "B2": {},
                }
            }
        )
    )
    cache = lf.cache_path(raw, "x")
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps({"version": lf.CACHE_VERSION, "items": {"Q1": FRAUENKIRCHE}}))
    lf.run_site(raw, data, "x")
    doc = json.loads((data / "landmark-facts.json").read_text())
    assert doc["attribution"] == "Wikidata (CC0)"
    assert [e["id"] for e in doc["landmarks"]] == ["Q1"]
    assert doc["landmarks"][0]["buildings"] == ["B1"]
    assert doc["landmarks"][0]["built"] == [1726, 1734]


def test_a_late_consecration_does_not_hide_the_opening():
    facts = lf.facts_of(
        [
            {"p": "inception", "v": "1868-01-01T00:00:00Z"},
            {"p": "opening", "v": "1871-01-01T00:00:00Z"},
            {"p": "event", "ev": "Q25640113", "t": "1990-10-15T00:00:00Z"},
        ]
    )
    assert facts == {"built": [1868, 1871]}


def test_a_decade_or_century_is_no_year():
    facts = lf.facts_of(
        [
            {"p": "inception", "v": "1700-01-01T00:00:00Z", "vp": "7"},
            {"p": "event", "ev": "Q1762010", "t": "1730-01-01T00:00:00Z", "tp": "8"},
            {"p": "opening", "v": "1734-02-28T00:00:00Z", "vp": "11"},
        ]
    )
    assert facts == {"built": [1734]}


def test_a_rebuild_pairs_its_own_start_and_end():
    # two rebuilds: the latest with its own start, not the first one's
    facts = lf.facts_of(
        [
            {
                "p": "event",
                "ev": "Q94394406",
                "s": "1950-01-01T00:00:00Z",
                "e": "1955-01-01T00:00:00Z",
            },
            {
                "p": "event",
                "ev": "Q94394406",
                "s": "1993-01-01T00:00:00Z",
                "e": "2005-01-01T00:00:00Z",
            },
        ]
    )
    assert facts == {"rebuilt": [1993, 2005]}


def test_retry_after_reads_seconds_and_dates():
    assert lf.retry_after("120") == 120
    assert lf.retry_after(None) == 0
    assert lf.retry_after("soon") == 0
    assert lf.retry_after("Wed, 21 Oct 2015 07:28:00 GMT") == 0


def test_a_new_site_reads_the_tiles_raw_caches(tmp_path):
    raw, data = tmp_path / "raw", tmp_path / "data"
    (raw / "wikidata").mkdir(parents=True)
    (raw / "wikidata" / "landmarks_t1.json").write_text(json.dumps({"landmarks": [{"id": "Q7"}]}))
    (raw / "wikidata" / "landmarks_other.json").write_text(
        json.dumps({"landmarks": [{"id": "Q8"}]})
    )
    assert lf.landmark_ids(data, raw, ["t1"]) == ["Q7"]


def test_each_architect_once_in_their_order():
    facts = lf.facts_of(
        [
            {"p": "architect", "a": "Q1", "v": "Zacharias", "lang": "de", "o": "1"},
            {"p": "architect", "a": "Q1", "v": "Zachary", "lang": "en", "o": "1"},
            {"p": "architect", "a": "Q2", "v": "Bertha", "lang": "en"},
            {"p": "architect", "a": "Q3", "v": "Anna", "lang": "de"},
        ]
    )
    # Q1 first by its ordinal, its German label; then by name, whatever
    # language each has
    assert facts == {"architects": ["Zacharias", "Anna"]}


def test_an_old_cache_is_asked_anew(tmp_path, monkeypatch):
    raw, data = tmp_path / "raw", tmp_path / "data"
    (data / "dlm").mkdir(parents=True)
    (data / "dlm" / "landmarks_t1.json").write_text(json.dumps({"landmarks": [{"id": "Q1"}]}))
    cache = lf.cache_path(raw, "x")
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps({"ids": ["Q1"], "items": {}}))
    asked = []
    monkeypatch.setattr(lf, "_post", lambda q: asked.append(q) or [])
    lf.fetch_wikidata(raw, data, "x")
    assert len(asked) == 1
    assert json.loads(cache.read_text())["version"] == lf.CACHE_VERSION
    lf.fetch_wikidata(raw, data, "x")
    assert len(asked) == 1


def test_run_site_refuses_an_older_cache(tmp_path):
    raw, data = tmp_path / "raw", tmp_path / "data"
    (data / "dlm").mkdir(parents=True)
    cache = lf.cache_path(raw, "x")
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps({"items": {"Q1": FRAUENKIRCHE}}))
    lf.run_site(raw, data, "x")
    assert not (data / "landmark-facts.json").exists()
