"""The site spec `bun run fetch` / `bun run bake` hand to Python
(scripts/pipeline.ts writes it from sites/<id>.ts): one JSON document, so
the site config stays TypeScript-only and Python never re-derives it."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .common import Products, Tile


@dataclass(frozen=True)
class Spec:
    site: str
    provider: str
    epsg: int
    products: Products
    raw: Path  # data/_raw/<provider>
    data: Path  # data/<site>
    osm_url: str
    tiles: list[Tile]

    @property
    def osm(self) -> Path:
        return osm_path(self.raw, self.osm_url)


def osm_path(raw: Path, url: str) -> Path:
    """Where the extract lives: the provider's `osm/`, under its own name."""
    return raw / "osm" / url.rsplit("/", 1)[-1]


def parse(text: str) -> Spec:
    doc = json.loads(text)
    raw, data = Path(doc["raw"]), Path(doc["data"])
    products = Products(**doc["products"])
    osm_url = doc["osm"]
    osm = osm_path(raw, osm_url)
    tiles = [
        Tile(t["id"], tuple(t["bounds"]), doc["epsg"], raw, data, osm, products, doc["credit"])
        for t in doc["tiles"]
    ]
    return Spec(doc["site"], doc["provider"], doc["epsg"], products, raw, data, osm_url, tiles)
