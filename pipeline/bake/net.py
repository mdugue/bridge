"""Downloads for the fetch adapters: whole files (cached, never fetched twice)
and single members of remote ZIPs read through HTTP range requests, for
providers that pack a whole city into one archive (Hamburg)."""

from __future__ import annotations

import io
import re
import shutil
import urllib.request
import zipfile
from functools import cache
from pathlib import Path

# Registers Deflate64 with zipfile: Bavaria's Basis-DLM package uses it.
import zipfile_deflate64  # noqa: F401

USER_AGENT = "bridge-bake (+https://github.com/mdugue/bridge)"


def _request(url: str, headers: dict[str, str] | None = None, data: bytes | None = None):
    req = urllib.request.Request(
        url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})}
    )
    return urllib.request.urlopen(req, timeout=120)


def download(url: str, dest: Path, data: bytes | None = None) -> Path:
    """`url` into `dest`, unless it is already there (a `.part` file never
    counts: an interrupted download starts over)."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    print(f"downloading {url}")
    with _request(url, data=data) as res, open(tmp, "wb") as out:
        # A portal's error page served with 200 is not a download.
        if res.headers.get("Content-Type", "").startswith("text/html"):
            raise OSError(f"{url}: got an HTML page, not the file")
        shutil.copyfileobj(res, out, length=1 << 20)
    tmp.rename(dest)
    return dest


def fetch_text(url: str) -> str:
    with _request(url) as res:
        return res.read().decode("utf-8", errors="replace")


def unzip_members(zip_path: Path, pattern: str, dest: Path) -> list[Path]:
    """The members of a local ZIP whose name matches `pattern` (a regex,
    case-insensitive), flattened into `dest`."""
    with zipfile.ZipFile(zip_path) as archive:
        return _extract(archive, pattern, dest)


@cache
def _remote_archive(url: str) -> zipfile.ZipFile:
    """A remote ZIP's directory, read once per run (Hamburg's district
    archives are searched for every 1 km cell)."""
    return zipfile.ZipFile(io.BufferedReader(RemoteFile(url), 1 << 20))


def remote_zip_members(url: str, pattern: str, dest: Path) -> list[Path]:
    """Like `unzip_members`, for a ZIP on a server that honours range
    requests: only the central directory and the wanted members travel."""
    return _extract(_remote_archive(url), pattern, dest)


def _extract(archive: zipfile.ZipFile, pattern: str, dest: Path) -> list[Path]:
    wanted = re.compile(pattern, re.IGNORECASE)
    out = []
    for member in archive.namelist():
        if member.endswith("/") or not wanted.search(member):
            continue
        dest.mkdir(parents=True, exist_ok=True)
        target = dest / Path(member).name
        if not target.exists():
            tmp = target.with_name(target.name + ".part")
            with archive.open(member) as src, open(tmp, "wb") as dst:
                shutil.copyfileobj(src, dst, length=1 << 20)
            tmp.rename(target)
        out.append(target)
    return out


class RemoteFile(io.RawIOBase):
    """A read-only, seekable view of a remote file over HTTP range requests.
    Reads stream from one open-ended range request until the next seek, so
    extracting a member costs one request, not one per buffer."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.pos = 0
        self.stream = None
        self.stream_pos = -1
        # HEAD is refused by some portals (GeoSN's cloud); a one-byte range
        # tells the size in Content-Range.
        with _request(url, {"Range": "bytes=0-0"}) as res:
            total = res.headers.get("Content-Range", "").rsplit("/", 1)[-1]
        if not total.isdigit():
            raise OSError(f"{url}: the server does not serve byte ranges")
        self.size = int(total)

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = max(0, base + offset)
        return self.pos

    def readinto(self, buffer) -> int:
        if self.pos >= self.size:
            return 0
        want = min(len(buffer), self.size - self.pos)
        try:
            data = self._stream().read(want)
        except OSError:
            data = b""
        if not data:
            # A server may drop a stream left idle while a tile was processed:
            # one fresh request from here before giving up.
            self._close_stream()
            data = self._stream().read(want)
        if not data:
            raise OSError(f"{self.url}: the connection ended at byte {self.pos} of {self.size}")
        buffer[: len(data)] = data
        self.pos += len(data)
        self.stream_pos = self.pos
        return len(data)

    def _stream(self):
        if self.stream is None or self.stream_pos != self.pos:
            self._close_stream()
            self.stream = _request(self.url, {"Range": f"bytes={self.pos}-"})
            self.stream_pos = self.pos
        return self.stream

    def _close_stream(self) -> None:
        if self.stream is not None:
            self.stream.close()
            self.stream = None

    def close(self) -> None:
        self._close_stream()
        super().close()
