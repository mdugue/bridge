"""scipy.fft as the bakes call it.

scipy ships no types for fft, and its transforms are dispatched through
uarray (`_basic.py`'s `_dispatch`), so pyright infers a `Dispatchable` tuple
where an array returns. The two real 2-D transforms the bakes call are typed
here from scipy 1.18.1's `fft/_basic.py` and what they return at run time:
precision is kept (float32 and float16 in, complex64 out; longdouble in,
clongdouble out; any other real input, complex128) and `irfft2` gives back
the matching real type. So is
`next_fast_len` (`_helper.py`): its `def` has a docstring and `pass` and is
then replaced by the compiled `good_size`, so pyright infers it as returning
None; it returns an int.
Every other public name is scipy's own, re-exported from the modules its
`__init__.py` reads.

Check against the source on a bump of scipy (plan 089, maintenance notes).
"""

from collections.abc import Sequence
from typing import Literal, overload

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.fft._backend import register_backend, set_backend, set_global_backend, skip_backend
from scipy.fft._basic import (
    fft,
    fft2,
    fftn,
    hfft,
    hfft2,
    hfftn,
    ifft,
    ifft2,
    ifftn,
    ihfft,
    ihfft2,
    ihfftn,
    irfft,
    irfftn,
    rfft,
    rfftn,
)
from scipy.fft._duccfft.helper import get_workers, set_workers
from scipy.fft._fftlog import fht, fhtoffset, ifht
from scipy.fft._helper import fftfreq, fftshift, ifftshift, prev_fast_len, rfftfreq
from scipy.fft._realtransforms import dct, dctn, dst, dstn, idct, idctn, idst, idstn

def next_fast_len(target: int, real: bool = False) -> int: ...

_Norm = Literal["backward", "ortho", "forward"] | None

@overload
def rfft2(
    x: NDArray[np.float32 | np.float16],
    s: Sequence[int] | None = None,
    axes: Sequence[int] = (-2, -1),
    norm: _Norm = None,
    overwrite_x: bool = False,
    workers: int | None = None,
    *,
    plan: None = None,
) -> NDArray[np.complex64]: ...
@overload
def rfft2(
    x: NDArray[np.longdouble],
    s: Sequence[int] | None = None,
    axes: Sequence[int] = (-2, -1),
    norm: _Norm = None,
    overwrite_x: bool = False,
    workers: int | None = None,
    *,
    plan: None = None,
) -> NDArray[np.clongdouble]: ...
@overload
def rfft2(
    x: ArrayLike,
    s: Sequence[int] | None = None,
    axes: Sequence[int] = (-2, -1),
    norm: _Norm = None,
    overwrite_x: bool = False,
    workers: int | None = None,
    *,
    plan: None = None,
) -> NDArray[np.complex128]: ...
@overload
def irfft2(
    x: NDArray[np.complex64],
    s: Sequence[int] | None = None,
    axes: Sequence[int] = (-2, -1),
    norm: _Norm = None,
    overwrite_x: bool = False,
    workers: int | None = None,
    *,
    plan: None = None,
) -> NDArray[np.float32]: ...
@overload
def irfft2(
    x: NDArray[np.clongdouble],
    s: Sequence[int] | None = None,
    axes: Sequence[int] = (-2, -1),
    norm: _Norm = None,
    overwrite_x: bool = False,
    workers: int | None = None,
    *,
    plan: None = None,
) -> NDArray[np.longdouble]: ...
@overload
def irfft2(
    x: ArrayLike,
    s: Sequence[int] | None = None,
    axes: Sequence[int] = (-2, -1),
    norm: _Norm = None,
    overwrite_x: bool = False,
    workers: int | None = None,
    *,
    plan: None = None,
) -> NDArray[np.float64]: ...

# The module's public names: in a stub, an imported name is public only when
# it is named here.
__all__ = [
    "dct",
    "dctn",
    "dst",
    "dstn",
    "fft",
    "fft2",
    "fftfreq",
    "fftn",
    "fftshift",
    "fht",
    "fhtoffset",
    "get_workers",
    "hfft",
    "hfft2",
    "hfftn",
    "idct",
    "idctn",
    "idst",
    "idstn",
    "ifft",
    "ifft2",
    "ifftn",
    "ifftshift",
    "ifht",
    "ihfft",
    "ihfft2",
    "ihfftn",
    "irfft",
    "irfft2",
    "irfftn",
    "next_fast_len",
    "prev_fast_len",
    "register_backend",
    "rfft",
    "rfft2",
    "rfftfreq",
    "rfftn",
    "set_backend",
    "set_global_backend",
    "set_workers",
    "skip_backend",
]
