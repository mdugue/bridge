"""What the nameplate says under a landmark's name (the scene's lettering at
a picked landmark, app/_components/nameplate-layer.ts): when it was built,
by whom, when it was rebuilt, how tall it is — from Wikidata (CC0), for the
landmarks the `landmarks` step matched to what the viewer draws.

- `bun run fetch` asks Wikidata once for the site (`fetch_wikidata`): every
  item the tiles' landmark caches name, in one POSTed query (the endpoint
  rate-limits hard). The answer is cached raw under
  `data/_raw/<provider>/wikidata/landmark_facts_<site>.json`; the bake never
  goes to the network.
- The site step (`run_site`) reads the committed `landmarks_<tile>.json`
  (which landmarks the viewer draws, and their LoD2 objects), climbs each
  object to its Building in the tile's CityJSON (the viewer's object facts
  carry the Building's id, `buildingId`) and writes
  `data/<site>/landmark-facts.json`: one entry per landmark with at least
  one fact.

Which statements count (`facts_of`):

  built     the first year of P571 (inception) and of the events that begin
            a building (P793: Baubeginn, Grundsteinlegung, Spatenstich,
            Bauausführung's start), to the last of those that end it (P1619
            opening; P793: Bauende, Einweihung, Kirchweihe,
            Einweihungsfeier, Inbetriebnahme, Bauausführung's end) — an end
            more than `MAX_BUILD_YEARS` after the start is a later event,
            not the building's (a cathedral's consecration centuries on),
            and is left out
  rebuilt   P793 Wiederaufbau / Rekonstruktion: its start and end, or its
            point in time (its end); `rebuiltFrom` where only its start is
            stated
  architects  P84, German labels, at most `MAX_ARCHITECTS`
  height    P2048 in metres (normalised), the largest
"""

from __future__ import annotations

import contextlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .osm_buildings import root_of

SPARQL = "https://query.wikidata.org/sparql"
ATTRIBUTION = "Wikidata (CC0)"
USER_AGENT = "bridge-bake/0.1 (city walker; offline bake)"
# Items per query: the ids ride in the POST body, but the endpoint times a
# query out past a minute.
BATCH = 300
# The endpoint answers a burst with 429 and a Retry-After; it is asked
# again after that long (at least this), this many times.
RETRY_S = 61
RETRIES = 4
MAX_BUILD_YEARS = 100
MAX_ARCHITECTS = 2

# P793 (significant event) items, by what they say about the building.
STARTS = {
    "Q27136782",  # Baubeginn
    "Q18752057",  # Grundsteinlegung
    "Q1068633",  # Spatenstich
}
ENDS = {
    "Q59913255",  # Bauende
    "Q1762010",  # Einweihung
    "Q3010369",  # Einweihungsfeier
    "Q25640113",  # Kirchweihe
    "Q29933828",  # Inbetriebnahme
}
SPANS = {
    "Q385378",  # Bauausführung
    "Q811972",  # Bauzeit
    "Q3875186",  # Bau
}
REBUILDS = {
    "Q1370468",  # bauliche Rekonstruktion
    "Q2478058",  # Rekonstruktion
    "Q94394406",  # Wiederaufbau
    "Q3422086",  # Wiederaufbau nach dem Krieg
}

QUERY = """
SELECT ?i ?p ?v ?lang ?ev ?t ?s ?e WHERE {
  VALUES ?i { %(ids)s }
  {
    ?i wdt:P571 ?v . BIND("inception" AS ?p)
  } UNION {
    ?i wdt:P1619 ?v . BIND("opening" AS ?p)
  } UNION {
    ?i wdt:P84 ?a . ?a rdfs:label ?v . BIND(LANG(?v) AS ?lang)
    FILTER(?lang IN ("de", "mul", "en")) BIND("architect" AS ?p)
  } UNION {
    ?i p:P2048/psn:P2048/wikibase:quantityAmount ?v . BIND("height" AS ?p)
  } UNION {
    ?i p:P793 ?st . ?st ps:P793 ?ev . BIND("event" AS ?p)
    OPTIONAL { ?st pq:P585 ?t . }
    OPTIONAL { ?st pq:P580 ?s . }
    OPTIONAL { ?st pq:P582 ?e . }
  }
}
"""


def _post(query: str) -> list[dict]:
    req = urllib.request.Request(
        SPARQL,
        data=urllib.parse.urlencode({"query": query}).encode(),
        headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
    )
    for attempt in range(RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.load(res)["results"]["bindings"]
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt == RETRIES:
                raise
            wait = max(RETRY_S, int(err.headers.get("Retry-After") or 0))
            print(f"Wikidata asks to wait {wait} s (429)")
            time.sleep(wait)
    raise AssertionError("unreachable")


def _value(row: dict, key: str) -> str | None:
    cell = row.get(key)
    return cell["value"] if cell else None


def _qid(uri: str | None) -> str | None:
    return uri.rsplit("/", 1)[-1] if uri else None


def rows_by_item(rows: list[dict]) -> dict[str, list[dict]]:
    """The query's rows as compact records per item (what the cache keeps)."""
    out: dict[str, list[dict]] = {}
    for r in rows:
        qid = _qid(_value(r, "i"))
        if not qid:
            continue
        rec = {"p": _value(r, "p")}
        for key in ("v", "lang", "t", "s", "e"):
            if (val := _value(r, key)) is not None:
                rec[key] = val
        if (ev := _qid(_value(r, "ev"))) is not None:
            rec["ev"] = ev
        out.setdefault(qid, []).append(rec)
    return out


def cache_path(raw: Path, site: str) -> Path:
    return raw / "wikidata" / f"landmark_facts_{site}.json"


def landmark_ids(data: Path) -> list[str]:
    """Every item the site's committed landmark files name (the provider's
    raw caches are shared by every city of the Land: not read)."""
    ids: set[str] = set()
    for path in (data / "dlm").glob("landmarks_*.json"):
        doc = json.loads(path.read_text())
        ids.update(i["id"] for i in doc.get("landmarks", []) if "id" in i)
    return sorted(ids)


def fetch_wikidata(raw: Path, data: Path, site: str) -> None:
    """Asks Wikidata for the facts of the site's landmarks (fetch time
    only) and caches the answer; a rerun asks only for the items the cache
    has not asked for yet."""
    ids = landmark_ids(data)
    if not ids:
        print(f"{site}: no landmarks known yet — the landmark facts are not fetched")
        return
    dest = cache_path(raw, site)
    items: dict[str, list[dict]] = {}
    asked: set[str] = set()
    if dest.exists():
        cached = json.loads(dest.read_text())
        items = cached.get("items", {})
        asked = set(cached.get("ids", []))
    missing = [i for i in ids if i not in asked]
    if not missing:
        print(f"{site}: Wikidata facts cached for all {len(ids)} landmarks")
        return
    for k in range(0, len(missing), BATCH):
        batch = missing[k : k + BATCH]
        rows = _post(QUERY % {"ids": " ".join(f"wd:{i}" for i in batch)})
        items.update(rows_by_item(rows))
    ids = sorted(asked | set(ids))
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {"source": ATTRIBUTION, "query": SPARQL, "ids": ids, "items": items}
    part = dest.with_name(dest.name + ".part")
    part.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    part.replace(dest)
    print(f"{site}: Wikidata facts for {len(items)} of {len(ids)} landmarks")


def year(value: str | None) -> int | None:
    """The year of a Wikidata time ("1726-01-01T00:00:00Z"); None for an
    unknown value (a blank node) or a date before the common era."""
    if not value or not value[:4].isdigit():
        return None
    return int(value[:4])


def _span(start: int | None, end: int | None) -> list[int] | None:
    if start is None:
        return [end] if end is not None else None
    if end is None or end <= start or end - start > MAX_BUILD_YEARS:
        return [start]
    return [start, end]


def facts_of(records: list[dict]) -> dict:
    """The nameplate's facts from one item's cached records."""
    starts: list[int] = []
    ends: list[int] = []
    rebuilt_from: list[int] = []
    rebuilt_to: list[int] = []
    rebuilt_at: list[int] = []
    names: dict[str, list[str]] = {}
    heights: list[float] = []
    for r in records:
        p = r.get("p")
        if p == "inception" and (y := year(r.get("v"))) is not None:
            starts.append(y)
        elif p == "opening" and (y := year(r.get("v"))) is not None:
            ends.append(y)
        elif p == "architect" and r.get("v"):
            names.setdefault(r.get("lang", ""), []).append(r["v"])
        elif p == "height":
            with contextlib.suppress(KeyError, ValueError):
                heights.append(float(r["v"]))
        elif p == "event":
            ev = r.get("ev")
            at, s, e = year(r.get("t")), year(r.get("s")), year(r.get("e"))
            if ev in STARTS:
                starts += [y for y in (at, s) if y is not None]
            elif ev in ENDS:
                ends += [y for y in (at, e) if y is not None]
            elif ev in SPANS:
                starts += [y for y in (s,) if y is not None]
                ends += [y for y in (e,) if y is not None]
            elif ev in REBUILDS:
                if s is not None:
                    rebuilt_from.append(s)
                if e is not None:
                    rebuilt_to.append(e)
                if at is not None:
                    rebuilt_at.append(at)
    out: dict = {}
    start = min(starts) if starts else None
    end = max((y for y in ends if start is None or y >= start), default=None)
    if (built := _span(start, end)) is not None:
        out["built"] = built
    r_start = min(rebuilt_from) if rebuilt_from else None
    r_end = max(rebuilt_to + rebuilt_at) if (rebuilt_to or rebuilt_at) else None
    if r_end is not None:
        # a stated end is the rebuild's year; its start only where it fits
        fits = r_start is not None and 0 < r_end - r_start <= MAX_BUILD_YEARS
        out["rebuilt"] = [r_start, r_end] if fits else [r_end]
    elif r_start is not None:
        # begun, its end not stated: "from"
        out["rebuiltFrom"] = r_start
    for lang in ("de", "mul", "en"):
        if names.get(lang):
            out["architects"] = sorted(set(names[lang]))[:MAX_ARCHITECTS]
            break
    if heights:
        out["height"] = round(max(heights), 1)
    return out


def buildings_of(objects: list[str], city: dict | None) -> list[str]:
    """The landmark's LoD2 objects as the Buildings they belong to (the
    viewer's `buildingId`); the objects as they are without the CityJSON."""
    if city is None:
        return sorted(set(objects))
    return sorted({root_of(city, oid) for oid in objects})


def run_site(raw: Path, data: Path, site: str) -> None:
    """Writes `data/<site>/landmark-facts.json` from the fetch's cache."""
    cache = cache_path(raw, site)
    if not cache.exists():
        print(f"{site}: no Wikidata facts cached ({cache}) — run bun run fetch")
        return
    items = json.loads(cache.read_text()).get("items", {})
    entries = []
    for path in sorted((data / "dlm").glob("landmarks_*.json")):
        landmarks = json.loads(path.read_text()).get("landmarks", [])
        if not landmarks:
            continue
        tile = path.stem.removeprefix("landmarks_")
        cityjson = data / "cityjson" / f"lod2_{tile}.city.json"
        city = json.loads(cityjson.read_text()) if cityjson.exists() else None
        for lm in landmarks:
            facts = facts_of(items.get(lm["id"], []))
            if not facts:
                continue
            entries.append(
                {
                    "id": lm["id"],
                    "name": lm["name"],
                    "buildings": buildings_of(lm.get("objects", []), city),
                    **facts,
                }
            )
    entries.sort(key=lambda e: e["id"])
    out = data / "landmark-facts.json"
    doc = {"attribution": ATTRIBUTION, "landmarks": entries}
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{site}: landmark facts for {len(entries)} landmarks → {out}")
