"""pyogrio, the package, as the bakes reach it (pyogrio 0.13.0).

pyogrio ships no types. A partial stub package (`py.typed` says `partial`):
every module but this one is read from pyogrio's source as before.

Why this file: pyogrio's `__init__.py` runs `from pyogrio.raw import
open_arrow, …`, an absolute import that at run time binds `pyogrio.raw` as an
attribute of the package but which pyright does not count as binding it, so
`import pyogrio` then `pyogrio.raw.read(…)` read as an unknown attribute.
Here `raw` is the package's member, re-exported from its source, beside every
name `__init__.py` imports, re-exported from the same modules.

Check against the source on a bump of pyogrio (plan 089, maintenance notes).
"""

from pyogrio import core, errors, geopandas, raw, util
from pyogrio.core import (
    __gdal_geos_version__,
    __gdal_version__,
    __gdal_version_string__,
    detect_write_driver,
    get_gdal_config_option,
    get_gdal_data_path,
    list_drivers,
    list_drivers_details,
    list_layers,
    read_bounds,
    read_info,
    set_gdal_config_options,
    vsi_curl_clear_cache,
    vsi_listtree,
    vsi_rmtree,
    vsi_unlink,
)
from pyogrio.geopandas import read_dataframe, write_dataframe
from pyogrio.raw import open_arrow, read_arrow, write_arrow

__version__: str

# The module's public names: in a stub, an imported name is public only when
# it is named here.
__all__ = [
    "__gdal_geos_version__",
    "__gdal_version__",
    "__gdal_version_string__",
    "core",
    "detect_write_driver",
    "errors",
    "geopandas",
    "get_gdal_config_option",
    "get_gdal_data_path",
    "list_drivers",
    "list_drivers_details",
    "list_layers",
    "open_arrow",
    "raw",
    "read_arrow",
    "read_bounds",
    "read_dataframe",
    "read_info",
    "set_gdal_config_options",
    "util",
    "vsi_curl_clear_cache",
    "vsi_listtree",
    "vsi_rmtree",
    "vsi_unlink",
    "write_arrow",
    "write_dataframe",
]
