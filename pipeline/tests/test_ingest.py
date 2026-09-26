"""The ingest adapter's download: nothing broken ever takes the cache name."""

from __future__ import annotations

import hashlib
import io
import zipfile

import pytest

from bake.ingest_sn import download


def _zip_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("tile.tif", b"x" * 4096)
    return buf.getvalue()


def test_a_good_download_takes_its_name(tmp_path):
    src = tmp_path / "src.zip"
    src.write_bytes(_zip_bytes())
    dest = download(src.as_uri(), tmp_path / "cache" / "tile.zip")
    assert dest.read_bytes() == src.read_bytes()
    assert not dest.with_suffix(".zip.part").exists()


def test_a_corrupt_zip_is_dropped(tmp_path):
    data = bytearray(_zip_bytes())
    data[60] ^= 0xFF  # inside the compressed member: its CRC no longer holds
    src = tmp_path / "src.zip"
    src.write_bytes(bytes(data))
    dest = tmp_path / "cache" / "tile.zip"
    with pytest.raises((OSError, zipfile.BadZipFile)):
        download(src.as_uri(), dest)
    assert not dest.exists()
    assert not dest.with_suffix(".zip.part").exists()


def test_the_published_md5_is_checked(tmp_path):
    src = tmp_path / "extract.osm.pbf"
    src.write_bytes(b"osm data")
    good = tmp_path / "good.md5"
    good.write_text(f"{hashlib.md5(b'osm data').hexdigest()}  extract.osm.pbf\n")
    bad = tmp_path / "bad.md5"
    bad.write_text("0" * 32 + "  extract.osm.pbf\n")
    dest = tmp_path / "osm" / "extract.osm.pbf"
    with pytest.raises(OSError, match="md5"):
        download(src.as_uri(), dest, md5_url=bad.as_uri())
    assert not dest.exists()
    assert download(src.as_uri(), dest, md5_url=good.as_uri()) == dest


def test_something_that_is_not_a_zip_is_an_oserror(tmp_path):
    src = tmp_path / "page.zip"
    src.write_bytes(b"<html>maintenance</html>")
    dest = tmp_path / "cache" / "tile.zip"
    with pytest.raises(OSError, match="not a ZIP"):
        download(src.as_uri(), dest)
    assert not dest.exists()


def test_an_unreachable_md5_keeps_the_download(tmp_path):
    src = tmp_path / "extract.osm.pbf"
    src.write_bytes(b"osm data")
    dest = tmp_path / "osm" / "extract.osm.pbf"
    missing = (tmp_path / "nowhere.md5").as_uri()
    assert download(src.as_uri(), dest, md5_url=missing).read_bytes() == b"osm data"


def test_a_zip_cached_before_the_checks_is_tested_once(tmp_path):
    dest = tmp_path / "cache" / "old.zip"
    dest.parent.mkdir()
    dest.write_bytes(b"truncated")
    src = tmp_path / "fresh.zip"
    src.write_bytes(_zip_bytes())
    # the broken copy is dropped and fetched again
    assert download(src.as_uri(), dest).read_bytes() == src.read_bytes()
    good = tmp_path / "cache" / "good.zip"
    good.write_bytes(_zip_bytes())
    assert download("file:///unused", good) == good
    assert good.with_suffix(".zip.checked").exists()
