"""laspy.point.record as the bakes use it (laspy 2.7.0).

laspy ships no types for its point records (a `lib.pyi` beside them, none
for this module), so pyright infers them from `record.py`, where
`__getitem__` returns from every branch at once: indexing a record with a
mask reads as `PackedPointRecord | SubFieldView | ScaledArrayView`, and
`pts[keep].x` as an attribute none of the views has. A partial stub package
(`py.typed` says `partial`): every other laspy module is read from its source.

What `record.py` returns for a key:

- an int, a slice, an array (a mask, indices), a list (of indices or field
  names) or a tuple of field names: a record of the same class over those
  points or fields;
- a dimension's name (`__getitem__` with a str, and attribute access:
  `__getattr__` is `self[item]`): a `SubFieldView` for a packed sub-field
  (`classification`, `number_of_returns`, …), a `ScaledArrayView` for `x`,
  `y`, `z` on a ScaleAwarePointRecord and for a scaled extra-bytes dimension,
  else the structured array's field — numpy types a field read by name as an
  array of any dtype, and so does this stub (`NDArray[Any]`).

Assignment to a dimension (`rec.x = …`, `rec[name] = …`) takes anything
numpy can make an array of; the views are (they define `__array__`).
`ScaleAwarePointRecord.zeros` and `.empty` take keywords where the base
class's take a point format: laspy overrides them so, and so does this stub.

Check against the source on a bump of laspy (plan 089, maintenance notes).
"""

from enum import Enum
from typing import Any, Self, overload

import numpy as np
from laspy.header import LasHeader
from laspy.point.dims import ScaledArrayView, SubFieldView
from laspy.point.format import PointFormat
from numpy.typing import ArrayLike, NDArray

_Points = int | slice | np.ndarray | list[int] | list[str] | tuple[str, ...]
_Dimension = SubFieldView | ScaledArrayView | NDArray[Any]

class DimensionNameValidity(Enum):
    Valid = ...
    Unsupported = ...
    Invalid = ...

class PackedPointRecord:
    array: np.ndarray
    point_format: PointFormat
    def __init__(self, data: np.ndarray, point_format: PointFormat) -> None: ...
    @property
    def point_size(self) -> int: ...
    @staticmethod
    def zeros(point_count: int, point_format: PointFormat) -> PackedPointRecord: ...
    @staticmethod
    def empty(point_format: PointFormat) -> PackedPointRecord: ...
    @classmethod
    def from_point_record(
        cls, other_point_record: PackedPointRecord, new_point_format: PointFormat
    ) -> Self: ...
    @classmethod
    def from_buffer(
        cls, buffer: ArrayLike, point_format: PointFormat, count: int = -1, offset: int = 0
    ) -> Self: ...
    def copy_fields_from(self, other_record: PackedPointRecord) -> None: ...
    def copy(self) -> PackedPointRecord: ...
    def memoryview(self) -> memoryview: ...
    def resize(self, new_size: int) -> None: ...
    def __len__(self) -> int: ...
    @overload
    def __getitem__(self, item: _Points) -> Self: ...
    @overload
    def __getitem__(self, item: str) -> _Dimension: ...
    def __setitem__(self, key: str | _Points, value: ArrayLike) -> None: ...
    def __getattr__(self, item: str) -> _Dimension: ...
    def __setattr__(self, key: str, value: ArrayLike) -> None: ...
    def validate_dimension_name(self, key: str) -> DimensionNameValidity: ...

def apply_new_scaling(
    record: ScaleAwarePointRecord, scales: np.ndarray, offsets: np.ndarray
) -> None: ...

class ScaleAwarePointRecord(PackedPointRecord):
    scales: np.ndarray
    offsets: np.ndarray
    def __init__(
        self, array: np.ndarray, point_format: PointFormat, scales: ArrayLike, offsets: ArrayLike
    ) -> None: ...
    @staticmethod
    def zeros(
        point_count: int,
        *,
        point_format: PointFormat | None = None,
        scales: ArrayLike | None = None,
        offsets: ArrayLike | None = None,
        header: LasHeader | None = None,
    ) -> ScaleAwarePointRecord: ...
    @staticmethod
    def empty(
        point_format: PointFormat | None = None,
        scales: ArrayLike | None = None,
        offsets: ArrayLike | None = None,
        header: LasHeader | None = None,
    ) -> ScaleAwarePointRecord: ...
    def change_scaling(
        self, scales: ArrayLike | None = None, offsets: ArrayLike | None = None
    ) -> None: ...
