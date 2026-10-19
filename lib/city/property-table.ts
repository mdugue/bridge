/**
 * The per-object table of a building glTF (EXT_structural_metadata,
 * written by scripts/tile-glb.ts `addPropertyTable`), read the way
 * 3DTilesRendererJS's `PropertyTableAccessor` reads it — its answers, not
 * its classes: those come with the property-texture reader, which renders
 * through a classic WebGLRenderer and so shipped all of three's WebGL and
 * GLSL with the viewer, for textures no tile has.
 *
 * A table's `properties` are its class's (the bake writes a class per tile
 * from the columns it has, so a column the tile lacks is absent there); a
 * class property the table carries no column for answers its default, a
 * value equal to `noData` the default too (the bake's "unknown" marker,
 * which it also writes as the default), an ENUM its name ("" for the
 * `noData` name). The kinds read are the ones the bake writes and their
 * neighbours: SCALAR and VEC2–4 of 8–32-bit integer or float components
 * (offset, scale and `normalized` applied), STRING, ENUM and BOOLEAN — an
 * array, a matrix or a 64-bit integer column throws when read. No THREE, no
 * DOM.
 */

/** One property of a schema class (the parts read here). */
export interface ClassProperty {
  array?: boolean;
  componentType?: string;
  default?: unknown;
  enumType?: string;
  noData?: unknown;
  normalized?: boolean;
  offset?: number | number[];
  scale?: number | number[];
  type: string;
}

/** One column of a property table: where its values lie. */
interface TableColumn {
  arrayOffsets?: number;
  offset?: number | number[];
  scale?: number | number[];
  stringOffsetType?: string;
  stringOffsets?: number;
  values: number;
}

interface SchemaEnum {
  valueType?: string;
  values: { name: string; value: number }[];
}

/** The root EXT_structural_metadata object of a glTF (embedded schema). */
export interface StructuralMetadataJson {
  propertyTables?: {
    class: string;
    count: number;
    properties?: Record<string, TableColumn>;
  }[];
  schema?: {
    classes?: Record<string, { properties?: Record<string, ClassProperty> }>;
    enums?: Record<string, SchemaEnum>;
  };
}

/** One property table: `count` rows of the class's properties. */
export interface PropertyTable {
  count: number;
  /** one row's value: a number, a number[] (VECn), a string (STRING, an
   *  ENUM's name) or a boolean; throws for a name outside the class */
  getPropertyValue: (name: string, id: number) => unknown;
  /** the class's properties (a column the tile lacks is absent here) */
  properties: Readonly<Record<string, ClassProperty>>;
}

/** What a glTF's content carries as `userData.structuralMetadata`. */
export interface StructuralMetadata {
  /** the renderer calls it when the tile goes; the tables hold only views
   *  over the file's own buffers */
  dispose: () => void;
  tableAccessors: PropertyTable[];
}

type Read = (id: number) => unknown;
type NumberArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

const ARRAYS: Record<string, new (buffer: ArrayBuffer) => NumberArray> = {
  FLOAT32: Float32Array,
  FLOAT64: Float64Array,
  INT8: Int8Array,
  INT16: Int16Array,
  INT32: Int32Array,
  UINT8: Uint8Array,
  UINT16: Uint16Array,
  UINT32: Uint32Array,
};

/** an integer component type's largest value (a `normalized` value's 1) */
const INT_MAX: Record<string, number> = {
  INT8: 127,
  INT16: 32_767,
  INT32: 2_147_483_647,
  UINT8: 255,
  UINT16: 65_535,
  UINT32: 4_294_967_295,
};

const COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

const decoder = new TextDecoder();

/** The buffer views a glTF's property tables read (values and offsets). */
export function propertyTableViews(ext: StructuralMetadataJson): number[] {
  const views = new Set<number>();
  for (const table of ext.propertyTables ?? []) {
    for (const column of Object.values(table.properties ?? {})) {
      for (const view of [
        column.values,
        column.arrayOffsets,
        column.stringOffsets,
      ]) {
        if (view !== undefined) {
          views.add(view);
        }
      }
    }
  }
  return [...views];
}

/** The tables of a glTF's EXT_structural_metadata over its buffer views
 *  (`view(i)`: buffer view i's bytes, at least those propertyTableViews
 *  names). */
export function readStructuralMetadata(
  ext: StructuralMetadataJson,
  view: (index: number) => ArrayBuffer | undefined
): StructuralMetadata {
  const classes = ext.schema?.classes ?? {};
  const enums = ext.schema?.enums ?? {};
  const tableAccessors = (ext.propertyTables ?? []).map(
    (table): PropertyTable => {
      const properties = classes[table.class]?.properties ?? {};
      const columns = table.properties ?? {};
      const readers = new Map<string, Read>();
      const reader = (name: string): Read => {
        let read = readers.get(name);
        if (!read) {
          read = columnReader(properties[name], columns[name], enums, view);
          readers.set(name, read);
        }
        return read;
      };
      return {
        count: table.count,
        properties,
        getPropertyValue: (name, id) => {
          if (!Object.hasOwn(properties, name)) {
            throw new Error(`property table: no property "${name}"`);
          }
          if (id >= table.count) {
            throw new Error(`property table: no row ${id} in ${table.count}`);
          }
          return reader(name)(id);
        },
      };
    }
  );
  return { tableAccessors, dispose: () => undefined };
}

/** A property's default: its schema's, else the type's zero. */
function defaultOf(property: ClassProperty): unknown {
  const value = property.default;
  if (value !== undefined && value !== null) {
    return Array.isArray(value) ? [...(value as unknown[])] : value;
  }
  switch (property.type) {
    case "STRING":
    case "ENUM":
      return "";
    case "BOOLEAN":
      return false;
    case "SCALAR":
      return 0;
    default:
      return Array.from({ length: COMPONENTS[property.type] ?? 0 }, () => 0);
  }
}

function typedArray(
  componentType: string | undefined,
  bytes: ArrayBuffer | undefined
): NumberArray {
  const View = componentType === undefined ? undefined : ARRAYS[componentType];
  if (!(View && bytes)) {
    throw new Error(
      `property table: cannot read ${componentType ?? "untyped"} values`
    );
  }
  return new View(bytes);
}

/** How one property is read row by row; built on its first read, so a
 *  column of a kind not read here throws only when someone asks for it. */
function columnReader(
  property: ClassProperty,
  column: TableColumn | undefined,
  enums: Record<string, SchemaEnum>,
  view: (index: number) => ArrayBuffer | undefined
): Read {
  if (!column) {
    return () => defaultOf(property);
  }
  if (property.array) {
    throw new Error("property table: array properties are not read");
  }
  const noData = (value: unknown): unknown =>
    value === property.noData ? defaultOf(property) : value;
  switch (property.type) {
    case "STRING": {
      const bytes = new Uint8Array(view(column.values) ?? new ArrayBuffer(0));
      const offsets = typedArray(
        column.stringOffsetType ?? "UINT32",
        column.stringOffsets === undefined
          ? undefined
          : view(column.stringOffsets)
      );
      return (id) =>
        noData(decoder.decode(bytes.subarray(offsets[id], offsets[id + 1])));
    }
    case "ENUM": {
      const set = enums[property.enumType ?? ""];
      const values = typedArray(
        property.componentType ?? set?.valueType ?? "UINT16",
        view(column.values)
      );
      const names = new Map(set?.values.map((v) => [v.value, v.name]));
      return (id) => noData(names.get(values[id]) ?? "");
    }
    case "BOOLEAN": {
      const bits = new Uint8Array(view(column.values) ?? new ArrayBuffer(0));
      return (id) => noData(((bits[id >> 3] >> (id & 7)) & 1) === 1);
    }
    default:
      return numberReader(property, column, view);
  }
}

/** A SCALAR or VECn column: the stored numbers, normalised, scaled and
 *  offset as the schema says; the `noData` value (as stored) its default. */
function numberReader(
  property: ClassProperty,
  column: TableColumn,
  view: (index: number) => ArrayBuffer | undefined
): Read {
  const n = COMPONENTS[property.type];
  if (n === undefined) {
    throw new Error(`property table: ${property.type} values are not read`);
  }
  const type = property.componentType ?? "";
  const values = typedArray(type, view(column.values));
  const max = property.normalized ? INT_MAX[type] : undefined;
  const transformed = property.normalized === true || type.startsWith("FLOAT");
  const scale = column.scale ?? property.scale ?? 1;
  const offset = column.offset ?? property.offset ?? 0;
  const component = (v: number | number[], i: number): number =>
    Array.isArray(v) ? (v[i] ?? 0) : v;
  const value = (raw: number, i: number): number => {
    const v = max === undefined ? raw : Math.max(raw / max, -1);
    return transformed ? v * component(scale, i) + component(offset, i) : v;
  };
  const noData = property.noData;
  if (n === 1) {
    return (id) =>
      values[id] === noData ? defaultOf(property) : value(values[id], 0);
  }
  return (id) => {
    const raw = Array.from(values.subarray(id * n, id * n + n));
    if (Array.isArray(noData) && raw.every((v, i) => v === noData[i])) {
      return defaultOf(property);
    }
    return raw.map(value);
  };
}
