# Stubs for what the bakes' libraries leave untyped

Read by pyright only (`stubPath = "typings"` in `pyproject.toml`), never at
run time, and outside `bake/`: no step's cache key reaches them
(`bake.step_cache.code_hash`), so a change here re-bakes nothing. Plan 089,
phase 2.

Each is a **partial stub package** (`<library>-stubs/` with a `py.typed` that
says `partial`, PEP 561): only the modules it holds replace the library's for
the checker, every other module is read from the library's source as before.
A module stub re-exports by name what it does not type, from the library's own
modules, so what it leaves alone keeps the type pyright infers from the
source.

| Stub | What it types | Why |
|---|---|---|
| `scipy-stubs/ndimage` | `label`, `distance_transform_edt`, the binary morphology but `binary_opening` | pyright infers their returns from every branch of the source (`Literal[0]` for `label`) |
| `scipy-stubs/fft` | `rfft2`, `irfft2`, `next_fast_len` | dispatched through uarray, or replaced by a compiled function after the `def` |
| `rasterio-stubs` (`__init__`) | the submodules as the package's members; `open`, `band` | absolute imports in `__init__.py` bind them at run time, not for pyright |
| `rasterio-stubs/windows` | `Window`, `from_bounds`, `transform` | an old-style attrs class: pyright sees no constructor |
| `pyogrio-stubs` (`__init__`) | `raw` (and the rest) as the package's members | as rasterio's |
| `laspy-stubs/point/record` | the point records | `__getitem__` read as returning every branch at once |

The rules:

- A stub says what the library does, read from its installed source (the
  file and version are in each stub's docstring) or, for a compiled
  function, measured on that version. Never `Any` to quiet the checker;
  `NDArray[Any]` only where numpy itself says it (a structured array's field
  read by name).
- Only what the bakes use: a bake that calls more of a stubbed module adds it
  here, from the source.
- A bump of scipy, rasterio, pyogrio or laspy: check the stubs against the
  new source, then run `uv run python typecheck.py`.
- A stub that would raise a count in `typecheck-baseline.json` — a finding
  where none was, or one re-worded — waits for the phase 4 fix it reveals.
