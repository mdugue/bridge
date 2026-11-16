"""rasterio, the package, as the bakes reach it (rasterio 1.5.2).

rasterio ships no types. A partial stub package (`py.typed` says `partial`):
a module not stubbed here — `rasterio.features`, `.transform`, `.warp`, … — is
read from rasterio's source as before; only this file and `windows.pyi`
replace theirs.

Why this file: rasterio's `__init__.py` imports `rasterio.transform`,
`.windows`, `.errors` and the others with absolute imports, which at run time
binds each as an attribute of the package, but which pyright does not count
as binding it, so `import rasterio` then `rasterio.transform.xy(…)` read as an
unknown attribute. Here they are the package's members, as they are at run
time (`import rasterio; rasterio.transform` works without importing it), each
re-exported from its source.

The names `__init__.py` itself defines and the bakes call are declared from
its source: `open`, whose parameters rasterio annotates nowhere and this stub
leaves as they are (creation options pass to GDAL as keywords, and what GDAL
accepts is GDAL's to say), its return the dataset classes of
`rasterio/io.py` by mode; `band`, `Band` and `pad` (whose `mode` is
numpy's: a name or a function). Every other name the package has at run
time is re-exported from where `__init__.py` takes it.

Check against the source on a bump of rasterio (plan 089, maintenance notes).
"""

from collections.abc import Sequence
from typing import Literal, NamedTuple, overload

import numpy as np
from rasterio import (
    control,
    coords,
    crs,
    drivers,
    dtypes,
    enums,
    env,
    errors,
    io,
    profiles,
    rpc,
    sample,
    serde,
    session,
    transform,
    vrt,
    windows,
)
from rasterio._base import DatasetBase
from rasterio._io import Statistics
from rasterio._show_versions import show_versions
from rasterio._version import gdal_version, get_geos_version, get_proj_version
from rasterio.crs import CRS
from rasterio.drivers import driver_from_extension, is_blacklisted
from rasterio.dtypes import (
    bool_,
    check_dtype,
    complex_,
    complex_int16,
    float16,
    float32,
    float64,
    int8,
    int16,
    int32,
    int64,
    sbyte,
    ubyte,
    uint8,
    uint16,
    uint32,
    uint64,
)
from rasterio.env import Env, ensure_env_with_credentials
from rasterio.errors import DriverCapabilityError, RasterioDeprecationWarning, RasterioIOError
from rasterio.io import (
    BufferedDatasetWriter,
    DatasetReader,
    DatasetWriter,
    FilePath,
    MemoryFile,
    get_writer_for_driver,
    get_writer_for_path,
)
from rasterio.profiles import default_gtiff_profile
from rasterio.transform import Affine, guard_transform

__version__: str
__gdal_version__: str
__proj_version__: str
__geos_version__: str
have_vsi_plugin: bool

# `open` on a path: "r" builds a DatasetReader; "r+", "w" and "w+" the writer
# `get_writer_for_path` (or `get_writer_for_driver`) picks — a DatasetWriter,
# or a BufferedDatasetWriter for a driver GDAL cannot create in place.
@overload
def open(
    fp,
    mode: Literal["r"] = "r",
    driver=None,
    width=None,
    height=None,
    count=None,
    crs=None,
    transform=None,
    dtype=None,
    nodata=None,
    sharing: bool = False,
    thread_safe: bool = False,
    opener=None,
    **kwargs,
) -> DatasetReader: ...
@overload
def open(
    fp,
    mode: Literal["r+", "w", "w+"],
    driver=None,
    width=None,
    height=None,
    count=None,
    crs=None,
    transform=None,
    dtype=None,
    nodata=None,
    sharing: bool = False,
    thread_safe: bool = False,
    opener=None,
    **kwargs,
) -> DatasetWriter | BufferedDatasetWriter: ...

_Dataset = DatasetReader | DatasetWriter | BufferedDatasetWriter

class Band(NamedTuple):
    """Band(s) of a Dataset: `namedtuple('Band', ['ds', 'bidx', 'dtype',
    'shape'])` in rasterio, typed as `band` fills it: the dataset, the band
    index or indexes, `set(ds.dtypes).pop()` (a dtype's name), `ds.shape`."""

    ds: _Dataset
    bidx: int | Sequence[int]
    dtype: str
    shape: tuple[int, int]

def band(ds: _Dataset, bidx: int | Sequence[int]) -> Band: ...
def pad(
    array: np.ndarray, transform: Affine, pad_width: int, mode: object = None, **kwargs: object
) -> tuple[np.ndarray, Affine]: ...

# The module's public names: in a stub, an imported name is public only when
# it is named here.
__all__ = [
    "Affine",
    "band",
    "Band",
    "bool_",
    "check_dtype",
    "complex_",
    "complex_int16",
    "control",
    "coords",
    "CRS",
    "crs",
    "DatasetBase",
    "DatasetReader",
    "default_gtiff_profile",
    "driver_from_extension",
    "DriverCapabilityError",
    "drivers",
    "dtypes",
    "ensure_env_with_credentials",
    "enums",
    "Env",
    "env",
    "errors",
    "FilePath",
    "float16",
    "float32",
    "float64",
    "gdal_version",
    "get_geos_version",
    "get_proj_version",
    "get_writer_for_driver",
    "get_writer_for_path",
    "guard_transform",
    "int16",
    "int32",
    "int64",
    "int8",
    "io",
    "is_blacklisted",
    "MemoryFile",
    "open",
    "pad",
    "profiles",
    "RasterioDeprecationWarning",
    "RasterioIOError",
    "rpc",
    "sample",
    "sbyte",
    "serde",
    "session",
    "show_versions",
    "Statistics",
    "transform",
    "ubyte",
    "uint16",
    "uint32",
    "uint64",
    "uint8",
    "vrt",
    "windows",
]
