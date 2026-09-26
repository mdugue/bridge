"""Hamburg (LGV, daten-hamburg.de): each product is one ZIP for the whole
city, holding 1 km tiles; only the tiles a site needs are read out of it
through range requests. The orthophotos are one ZIP per district, so each
district's directory is searched for the tile. The Basis-DLM is published
as NAS only — land cover comes from OSM (sites/providers.ts).

The editions are dated URLs. When LGV publishes a new one, the dataset
pages on suche.transparenz.hamburg.de (search the titles below) carry the
new link: "Digitales Höhenmodell Hamburg DGM 1", "… bDOM", "3D-Gebäudemodell
LoD2-DE Hamburg", "Luftbilder Hamburg DOP Zeitreihe belaubt"."""

from __future__ import annotations

from pathlib import Path

from ..common import Tile
from ..fetch import Ctx, cells
from ..net import remote_zip_members

OPEN = "https://www.daten-hamburg.de/opendata"
DGM = f"{OPEN}/fernerkundung_hoehenmodelle/dgm/dgm1_hh_2022-04-30.zip"
DOM = f"{OPEN}/Digitales_Hoehenmodell_bDOM/dom1_hh_2022-11-21.zip"
LOD2 = f"{OPEN}/3d_stadtmodell_lod2/LoD2-DE_HH_2026-04-28.zip"
DOP = f"{OPEN}/fernerkundung_luftbilder/dop_belaubt/DOP2024_belaubt_Hamburg_{{}}.zip"
DISTRICTS = (
    "Hamburg-Mitte",
    "Altona",
    "Eimsbuettel",
    "Hamburg-Nord",
    "Wandsbek",
    "Bergedorf",
    "Harburg",
)


def _members(ctx: Ctx, tile: Tile, urls: list[str], pattern: str, folder: str) -> list[Path]:
    """The 1 km members for the tile from every archive that has them — the
    district archives are cut at district borders, so a cell on one is in
    two, each with its half (the fetch mosaics them)."""
    out = []
    for e, n in cells(tile, 1):
        found = []
        for i, url in enumerate(urls):
            dest = ctx.scratch / folder / str(i)
            found += remote_zip_members(url, pattern.format(e=e, n=n), dest)
        if not found:
            raise FileNotFoundError(f"{folder}: no file for the 1 km cell {e}_{n}")
        out += found
    return out


def dgm(ctx: Ctx, tile: Tile) -> list[Path]:
    return _members(ctx, tile, [DGM], r"dgm1_32_{e}_{n}_1_hh_\d{{4}}\.tif$", "dgm")


def dom(ctx: Ctx, tile: Tile) -> list[Path]:
    return _members(ctx, tile, [DOM], r"dom1_32_{e}_{n}_1_hh_\d{{4}}\.tif$", "dom")


def dop(ctx: Ctx, tile: Tile) -> list[Path]:
    urls = [DOP.format(d) for d in DISTRICTS]
    return _members(ctx, tile, urls, r"dop20rgbi_32_{e}_{n}_1_hh_\d{{4}}(_\d)?\.tif$", "dop")


def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    return _members(ctx, tile, [LOD2], r"LoD2_32_{e}_{n}_1_HH\.gml$", "lod2")


def dlm(ctx: Ctx) -> None:
    raise SystemExit("Hamburg publishes no Basis-DLM in the Shape profile (products.dlm)")
