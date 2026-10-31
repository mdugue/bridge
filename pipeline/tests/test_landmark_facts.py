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
    cache.write_text(json.dumps({"items": {"Q1": FRAUENKIRCHE}}))
    lf.run_site(raw, data, "x")
    doc = json.loads((data / "landmark-facts.json").read_text())
    assert doc["attribution"] == "Wikidata (CC0)"
    assert [e["id"] for e in doc["landmarks"]] == ["Q1"]
    assert doc["landmarks"][0]["buildings"] == ["B1"]
    assert doc["landmarks"][0]["built"] == [1726, 1734]
