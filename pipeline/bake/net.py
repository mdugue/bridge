"""Downloads for the fetch adapters: whole files (cached, never fetched twice)
and single members of remote ZIPs read through HTTP range requests, for
providers that pack a whole city into one archive (Hamburg)."""

from __future__ import annotations

import hashlib
import http.client
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


def _check_zip(path: Path, url: str) -> None:
    """Raises OSError unless every member of the ZIP reads back intact."""
    try:
        with zipfile.ZipFile(path) as z:
            bad = z.testzip()
    except zipfile.BadZipFile as err:
        raise OSError(f"{url}: not a ZIP ({err})") from err
    if bad is not None:
        raise OSError(f"{url}: corrupt member {bad}")


def _published_md5(md5_url: str) -> str | None:
    """The hash a `<hash>  <name>` file publishes, or None when it cannot be
    read (the download then goes on unverified rather than being lost)."""
    try:
        with _request(md5_url) as res:
            return res.read().decode("ascii", "replace").split()[0].lower()
    except (OSError, http.client.HTTPException, IndexError) as err:
        print(f"{md5_url}: {err} — keeping the download unverified")
        return None


def _cached(url: str, dest: Path, marker: Path) -> bool:
    """Whether `dest` is a usable cached copy. A ZIP cached before the
    checks existed is tested once; a broken one is dropped."""
    if not dest.exists() or dest.stat().st_size == 0:
        return False
    if dest.suffix.lower() != ".zip" or marker.exists():
        return True
    try:
        _check_zip(dest, url)
    except OSError as err:
        print(f"{err} — the cached copy is dropped and fetched again")
        dest.unlink()
        return False
    marker.touch()
    return True


def _fetch(url: str, tmp: Path, data: bytes | None) -> tuple[int, str | None, str]:
    """`url` into `tmp`: (bytes written, Content-Length, md5 hex)."""
    digest = hashlib.md5()
    written = 0
    try:
        with _request(url, data=data) as res, open(tmp, "wb") as out:
            # A portal's error page served with 200 is not a download.
            if res.headers.get("Content-Type", "").startswith("text/html"):
                raise OSError(f"{url}: got an HTML page, not the file")
            expected = res.headers.get("Content-Length")
            while chunk := res.read(1 << 20):
                out.write(chunk)
                digest.update(chunk)
                written += len(chunk)
    except http.client.HTTPException as err:  # e.g. IncompleteRead
        raise OSError(f"{url}: {err!r}") from err
    return written, expected, digest.hexdigest()


def download(url: str, dest: Path, data: bytes | None = None, md5_url: str | None = None) -> Path:
    """`url` into `dest`, unless it is already there, checked before it takes
    the name: the byte count against Content-Length (a cut connection), a
    ZIP's CRCs, and the published md5 when there is one (read first, so an
    extract replaced mid-download fails the check instead of passing a stale
    one). A download that fails a check is deleted and raises OSError, so the
    cache never holds a broken file (a `.part` file never counts)."""
    marker = dest.with_suffix(dest.suffix + ".checked")
    if _cached(url, dest, marker):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    # A marker left from a deleted copy must not vouch for the next one.
    marker.unlink(missing_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    published = _published_md5(md5_url) if md5_url is not None else None
    print(f"downloading {url}")
    try:
        written, expected, md5 = _fetch(url, tmp, data)
        if expected is not None and written != int(expected):
            raise OSError(f"{url}: {written} of {expected} bytes")
        if dest.suffix.lower() == ".zip":
            _check_zip(tmp, url)
        if published is not None and published != md5:
            raise OSError(f"{url}: md5 {md5}, published {published}")
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    tmp.rename(dest)
    if dest.suffix.lower() == ".zip":
        marker.touch()
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
