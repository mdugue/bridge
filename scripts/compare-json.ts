/**
 * The JSON half of scripts/compare-tilesets.ts: two documents compared by
 * content and the differences said in lines. The order of an object's keys
 * is ignored; the order of an array never is (rows are read by position:
 * a markings raster names `1 + row`, `treefacts_<tile>.json` is a column
 * over the trees' features), and a pure reordering is said as such. A
 * string that names a file a site serves reads as that file's logical
 * name, marked as served, so a tileset naming a re-hashed file is not
 * itself named and an unhashed name never passes for the served one.
 * Non-finite numbers (NaN, ±Infinity, which JSON writes as null) and a
 * member named `__proto__` are compared as what they are. Build-time only.
 */

/** How many lines a differing file reports at most. */
export const MAX_DETAILS = 5;
/** How many characters of a value a line quotes. */
const QUOTE = 160;
/** How a served name reads once canonical: never equal to a literal. */
const SERVED = "⟪served⟫";
/** How a non-finite number reads once canonical. */
const NUMBER = "⟪number⟫";

/** The served names a site's documents may contain: served → logical. */
export type ServedNames = ReadonlyMap<string, string>;

export function quote(value: unknown): string {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
  return text.length > QUOTE ? `${text.slice(0, QUOTE)}…` : text;
}

/** A value's JSON (`undefined` for none). */
export const asJson = (v: unknown): string => JSON.stringify(v) ?? "undefined";

/** The rows only in `a` and only in `b`, each row once per copy. */
export function multisetDiff(
  a: readonly string[],
  b: readonly string[]
): { onlyA: string[]; onlyB: string[] } {
  const left = new Map<string, number>();
  for (const row of a) {
    left.set(row, (left.get(row) ?? 0) + 1);
  }
  const onlyB: string[] = [];
  for (const row of b) {
    const n = left.get(row) ?? 0;
    if (n > 0) {
      left.set(row, n - 1);
    } else {
      onlyB.push(row);
    }
  }
  const onlyA = [...left].flatMap(([row, n]) =>
    Array.from({ length: n }, () => row)
  );
  return { onlyA, onlyB };
}

/** Two lists of rows compared in order: none when equal, else one line —
 *  the same rows in another order, or what is in one list only. */
export function rowsLine(
  where: string,
  a: readonly string[],
  b: readonly string[],
  noun = "records"
): string[] {
  if (a.length === b.length && a.every((row, i) => row === b[i])) {
    return [];
  }
  const { onlyA, onlyB } = multisetDiff(a, b);
  if (onlyA.length === 0 && onlyB.length === 0) {
    return [`${where}the same ${a.length} ${noun} in another order`];
  }
  const examples = [
    onlyA.length > 0 ? `a: ${quote(onlyA[0])}` : "",
    onlyB.length > 0 ? `b: ${quote(onlyB[0])}` : "",
  ].filter(Boolean);
  return [
    `${where}${onlyA.length} ${noun} only in a, ${onlyB.length} only in b (${examples.join("; ")})`,
  ];
}

type Plain = Record<string, unknown>;

export const isRecord = (v: unknown): v is Plain =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An object's own member (`__proto__` included, which `o[key]` is not). */
export const own = (o: Plain, key: string): unknown =>
  Object.getOwnPropertyDescriptor(o, key)?.value;

/** An object without a prototype, so any key is an ordinary member. */
function bare(entries: Iterable<[string, unknown]>): Plain {
  const out = Object.create(null) as Plain;
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return out;
}

/** A string that names a served file, as that file's logical name marked
 *  as served; any other string as it is. */
function logicalString(s: string, served: ServedNames): string {
  const slash = s.lastIndexOf("/");
  const base = served.get(s.slice(slash + 1));
  return base === undefined ? s : `${SERVED}${s.slice(0, slash + 1)}${base}`;
}

/** `value` in a form whose JSON is the same for the same content: keys
 *  sorted, arrays as they are, served names marked, non-finite numbers
 *  spelled out. */
export function canonical(value: unknown, served: ServedNames): unknown {
  if (typeof value === "string") {
    return logicalString(value, served);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `${NUMBER}${value}`;
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonical(v, served));
  }
  if (isRecord(value)) {
    return bare(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(own(value, key), served)])
    );
  }
  return value;
}

/** Where two canonical arrays differ. */
function arrayDiff(a: unknown[], b: unknown[], at: string, out: string[]) {
  const rowsA = a.map(asJson);
  const rowsB = b.map(asJson);
  const { onlyA, onlyB } = multisetDiff(rowsA, rowsB);
  const reordered = onlyA.length === 0 && onlyB.length === 0;
  if (a.length === b.length && !reordered) {
    for (const [i, v] of a.entries()) {
      jsonDiff(v, b[i], `${at}[${i}]`, out);
    }
    return;
  }
  out.push(...rowsLine(at === "" ? "" : `${at}: `, rowsA, rowsB, "items"));
}

/** Where two canonical objects differ. */
function objectDiff(a: Plain, b: Plain, at: string, out: string[]) {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const next = at === "" ? key : `${at}.${key}`;
    if (!Object.hasOwn(b, key)) {
      out.push(`${next}: only in a`);
    } else if (Object.hasOwn(a, key)) {
      jsonDiff(own(a, key), own(b, key), next, out);
    } else {
      out.push(`${next}: only in b`);
    }
  }
}

/** Where two canonical values differ, as up to MAX_DETAILS lines. */
function jsonDiff(a: unknown, b: unknown, at: string, out: string[]): void {
  if (out.length >= MAX_DETAILS || asJson(a) === asJson(b)) {
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    arrayDiff(a, b, at, out);
  } else if (isRecord(a) && isRecord(b)) {
    objectDiff(a, b, at, out);
  } else {
    out.push(`${at === "" ? "" : `${at}: `}${quote(a)} → ${quote(b)}`);
  }
}

/** Two JSON documents compared, as lines (none: the same content). */
export function compareJson(
  a: unknown,
  b: unknown,
  servedA: ServedNames,
  servedB: ServedNames
): string[] {
  const out: string[] = [];
  jsonDiff(canonical(a, servedA), canonical(b, servedB), "", out);
  return out;
}
