/**
 * The ledger's complexity counters (plan 087, phase 1; plan 086's table
 * "Less complexity"): each a pure function of source texts the caller reads
 * (scripts/ledger.ts). A counter counts code, never where a file lies or
 * how its text is wrapped: a move, a comment, a blank line or a wrapper
 * function moves no count (`longestFunction.path` says where the function
 * lies, and follows it). Each says below what it counts and what it
 * cannot see.
 *
 * They read sources through two small lexers, not parsers (ts-lexer.ts,
 * source-lexer.ts): code told from comments and from the text of strings,
 * which is all the counters need. What the TypeScript one gets wrong is
 * named at it.
 */
import { codeLines, lexPy } from "./source-lexer";
import type { SourceText } from "./source-lexer";
import { lexSource } from "./ts-lexer";

const isTest = (path: string): boolean => /\.test\.tsx?$/u.test(path);
const baseName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/**
 * The viewer's mesh builders: the modules named `*-layer.ts` (or `.tsx`;
 * a test's name ends otherwise), wherever they lie among the sources
 * handed in — how many, and their lines of code (`codeLines`: no comment,
 * no blank line).
 *
 * Cannot see: a builder under another name (`tile-stream.ts` builds
 * meshes too), nor one renamed away from `-layer`: a rename shows as a
 * file fewer, which the reviewer reads in the ledger's diff.
 */
export function layerModules(files: readonly SourceText[]): {
  codeLines: number;
  files: number;
} {
  const layers = files.filter(({ path }) =>
    /-layer\.tsx?$/u.test(baseName(path))
  );
  return {
    files: layers.length,
    codeLines: layers.reduce(
      (sum, file) => sum + codeLines(lexSource(file)),
      0
    ),
  };
}

/* ------------------------------------------------------ longest function */

/** A module's top-level function: declared, assigned or handed to a call;
 *  or a class. */
export interface TopFunction {
  /** its lines of code, head and body */
  lines: number;
  name: string;
}

const DECLARED =
  /^\s*(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function\b\s*\*?\s*(?<fn>[\w$]*)|(?:abstract\s+)?class\b\s*(?<cls>[\w$]*))/u;
const ASSIGNED =
  /^\s*(?:export\s+)?(?:const|let|var)\s+(?:(?<name>[\w$]+)|[{[])/u;
/** Statements that hold no function of their own. */
const NO_VALUE =
  /^\s*(?:import\b|export\s*[{*]|(?:export\s+)?(?:declare\s+)?(?:type|interface|enum|namespace|module)\b)/u;
const CALLED = /^\s*(?:export\s+default\s+)?(?:await\s+)?(?<name>[\w$.]+)/u;

/**
 * Whether a statement's value holds a function: an `=>`, a `function` or a
 * `class` outside every brace and square bracket — at the top, or as a
 * call's argument (`traced(async function boot() {…})`), which is the
 * same body wrapped. One inside an object or an array is a table's entry.
 * `from`: where the value starts (after a constant's `=`, so that its
 * type's arrows are not the value's).
 */
function holdsFunction(bare: string, from: number): boolean {
  let tables = 0;
  for (let i = from; i < bare.length; i += 1) {
    const c = bare[i] ?? "";
    if (c === "{" || c === "[") {
      tables += 1;
    } else if (c === "}" || c === "]") {
      tables -= 1;
    } else if (tables === 0) {
      if (c === "=" && bare[i + 1] === ">") {
        return true;
      }
      const word =
        (c === "f" && /^function\b/u.test(bare.slice(i, i + 9))) ||
        (c === "c" && /^class\b/u.test(bare.slice(i, i + 6)));
      if (word && !/[\w$.]/u.test(bare[i - 1] ?? "")) {
        return true;
      }
    }
  }
  return false;
}

/** Where a constant's value starts: after its first `=` that is no
 *  arrow's or comparison's and no default's inside a destructuring
 *  pattern (-1: it has none). */
function valueStart(bare: string): number {
  let depth = 0;
  for (let i = 0; i < bare.length; i += 1) {
    const c = bare[i] ?? "";
    if (c === "{" || c === "[") {
      depth += 1;
    } else if (c === "}" || c === "]") {
      depth -= 1;
    } else if (depth === 0 && c === "=" && !"=>".includes(bare[i + 1] ?? "")) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * A top-level statement's name where it is a function: a `function` or a
 * `class` declared; a constant whose value holds one (an arrow, a function
 * expression, either wrapped in a call); or a call that is handed one
 * (`register(function big() {…})`, named after what is called).
 */
function functionName(bare: string): string | null {
  if (NO_VALUE.test(bare)) {
    return null;
  }
  const declared = DECLARED.exec(bare);
  if (declared) {
    const { fn, cls } = declared.groups ?? {};
    return [fn, cls].find(Boolean) ?? "(anonymous)";
  }
  const assigned = ASSIGNED.exec(bare);
  if (assigned) {
    const from = valueStart(bare);
    return from !== -1 && holdsFunction(bare, from)
      ? (assigned.groups?.name ?? "(destructured)")
      : null;
  }
  const called = CALLED.exec(bare)?.groups?.name;
  return called !== undefined && holdsFunction(bare, 0) ? called : null;
}

/** Whether the code goes on at a line's start after `at`: the next line
 *  that has any (none: the source's end) begins in its first column. */
function nextCodeAtLineStart(bare: string, at: number): boolean {
  const rest = /^[ \t]*(?:\r?\n|$)(?<rest>[^]*)$/u.exec(bare.slice(at));
  if (!rest) {
    return false;
  }
  const next = /^(?:[ \t]*\r?\n)*(?<lead>[ \t]*)\S/u.exec(
    rest.groups?.rest ?? ""
  );
  return !next || next.groups?.lead === "";
}

/**
 * A module's top-level functions with their lines of code. A statement
 * ends at a `;` outside every bracket, or at a `}` that closes the last
 * brace and ends its line where the code goes on in the first column (a
 * return type's `}` before an indented `| Promise<…> {` ends nothing).
 * Throws where the brackets do not close: the lexer misread the file (see
 * `lexTs`), and a wrong figure must not pass as one.
 */
export function topFunctions(source: SourceText): TopFunction[] {
  const { bare, code } = lexSource(source);
  const codeRows = code.split("\n");
  const out: TopFunction[] = [];
  let round = 0;
  let curly = 0;
  let start = 0;
  const close = (end: number) => {
    const statement = bare.slice(start, end);
    const name = functionName(statement);
    if (name !== null) {
      const lead = /^\s*/u.exec(statement)?.[0].length ?? 0;
      const first = bare.slice(0, start + lead).split("\n").length - 1;
      const last = bare.slice(0, end).split("\n").length - 1;
      const lines = codeRows
        .slice(first, last + 1)
        .filter((row) => row.trim() !== "").length;
      out.push({ name, lines });
    }
    start = end;
  };
  for (let i = 0; i < bare.length; i += 1) {
    const c = bare[i];
    if (c === "(" || c === "[") {
      round += 1;
    } else if (c === ")" || c === "]") {
      round -= 1;
    } else if (c === "{") {
      curly += 1;
    } else if (c === "}") {
      curly -= 1;
      if (curly === 0 && round === 0 && nextCodeAtLineStart(bare, i + 1)) {
        close(i + 1);
      }
    } else if (c === ";" && curly === 0 && round === 0) {
      close(i + 1);
    }
    if (round < 0 || curly < 0) {
      break;
    }
  }
  if (round !== 0 || curly !== 0) {
    throw new Error(
      `ledger: the brackets of ${source.path} do not close as read (lexTs): its functions cannot be measured`
    );
  }
  close(bare.length);
  return out;
}

/**
 * The longest top-level function among the sources (tests left out): its
 * lines of code, its name and its module. Today that is the boot,
 * `bootApp` in create-app.ts (plan 095: "owners, not one function"), and
 * the figure follows the boot's code however it is written or wrapped: as
 * a declaration, an arrow or a function expression, as a call's argument
 * (`traced(async function …)`), behind a wrapper function (the wrapped one
 * is the longest then), in another module (`path` says which), split in
 * two (the larger half).
 *
 * Counts a class whole and a function with everything nested in it.
 * Cannot see: a body cut into top-level functions (each shorter — which is
 * the cut plan 095 asks for, or its imitation: the reviewer reads which),
 * nor one held in a table (an object's method, an array's entry). A tie
 * goes to the path, then to the first in its module.
 */
export function longestFunction(files: readonly SourceText[]): {
  lines: number;
  name: string;
  path: string;
} {
  let best = { lines: 0, name: "", path: "" };
  const sorted = files
    .filter(({ path }) => !isTest(path))
    .toSorted((a, b) => (a.path < b.path ? -1 : 1));
  for (const file of sorted) {
    for (const fn of topFunctions(file)) {
      if (fn.lines > best.lines) {
        best = { lines: fn.lines, name: fn.name, path: file.path };
      }
    }
  }
  return best;
}

/* ----------------------------------------------------------------- seams */

/**
 * The ways a bake handles a tile's edge, each by the calls that do it —
 * matched in code, never in a comment, a docstring or a string. Five are
 * plan 092's ("Seams, five ways"); `readMargin` is its first row's margin
 * on every other read (a fetch's ring of cells, a raster's halo, a
 * register's request), which that table counted by the word.
 */
export const SEAM_WAYS = {
  /** the OSM read, which takes a margin in degrees around the tile */
  osmMargin: /\b(?:read_osm|read_ways|wgs84_bbox)\s*\(/u,
  /** any other read widened around the tile: a variable, a parameter or a
   *  constant named `margin` (`REG_MARGIN` is another word) */
  readMargin: /(?<![\w.])(?:margin|MARGIN)\b/u,
  /** ownership: the west and south edge in */
  owns: /\bowns\s*\(/u,
  /** the neighbours' rasters: the DGM and DOM beyond the tile */
  neighbourRasters: /\b(?:dgm_paths|dom_paths)\s*\(/u,
  /** the neighbours' finished files: every tile of the site, or another
   *  tile's class raster (`classes` with an argument) */
  neighbourFiles: /\.neighbours\s*\(|\.classes\s*\(\s*[\w.]/u,
  /** a measurement over the whole site, kept for the process */
  siteMemo: /\bmemo\s*\(/u,
} as const;
export type SeamWay = keyof typeof SEAM_WAYS;

/**
 * The bake modules (every `.py` under `pipeline/bake/`, any depth) that
 * handle a tile's edge in one of `SEAM_WAYS`, of all of them, and each
 * way's modules (a module counts in each way it takes). The module that defines a call counts with its callers.
 *
 * Cannot see: a call under another name (`from .common import owns as o`),
 * a module that reaches a seam only through another's helper (it is
 * counted where the call is), a margin under another word (`pad`, `reach`),
 * nor a margin set to zero.
 */
export function seamModules(files: readonly SourceText[]): {
  matching: number;
  of: number;
  ways: Record<SeamWay, number>;
} {
  const modules = files
    .filter(({ path }) => /(?:^|\/)pipeline\/bake\/.+\.py$/u.test(path))
    .map(({ text }) => lexPy(text).bare);
  const ways = Object.fromEntries(
    Object.entries(SEAM_WAYS).map(([way, pattern]) => [
      way,
      modules.filter((bare) => pattern.test(bare)).length,
    ])
  ) as Record<SeamWay, number>;
  return {
    matching: modules.filter((bare) =>
      Object.values(SEAM_WAYS).some((pattern) => pattern.test(bare))
    ).length,
    of: modules.length,
    ways,
  };
}

/* ----------------------------------------------------------- workarounds */

/** What marks a comment as a workaround kept for a dependency (written so
 *  that this module's own comments do not match it). */
export const WORKAROUND_PATTERN = /upstream\s+workaround/iu;

/** The register's heading in docs/rendering.md. */
export const WORKAROUND_HEADING = "Workarounds for upstream bugs";

/**
 * The workarounds kept for a dependency's bug, counted twice:
 *
 * - `entries`: the register's entries — the paragraphs that open in bold
 *   under `WORKAROUND_HEADING` in docs/rendering.md, one a bug;
 * - `sites`: the comments in the sources (tests left out) that match
 *   `WORKAROUND_PATTERN`, however their lines are wrapped (a comment that
 *   says it twice is one).
 *
 * Cannot see: a workaround that is neither registered nor marked — the
 * register is the rule (AGENTS.md), these count what follows it. Throws
 * where the register's heading is gone: a renamed section must not read
 * as no workaround.
 */
export function upstreamWorkarounds(
  files: readonly SourceText[],
  register: string
): { entries: number; sites: number } {
  const lines = register.split("\n");
  const head = lines.findIndex(
    (line) => /^#{1,6}\s/u.test(line) && line.includes(WORKAROUND_HEADING)
  );
  if (head === -1) {
    throw new Error(
      `ledger: no section "${WORKAROUND_HEADING}" in the register`
    );
  }
  const level = /^#+/u.exec(lines[head] ?? "")?.[0].length ?? 1;
  const next = lines.findIndex(
    (line, i) => i > head && new RegExp(`^#{1,${level}}\\s`, "u").test(line)
  );
  const section = lines.slice(head + 1, next === -1 ? lines.length : next);
  const entries = section.filter(
    (line, i) => line.startsWith("**") && (section[i - 1] ?? "").trim() === ""
  ).length;
  const sites = files
    .filter(({ path }) => !isTest(path))
    .reduce(
      (sum, file) =>
        sum +
        lexSource(file).comments.filter((comment) =>
          WORKAROUND_PATTERN.test(comment)
        ).length,
      0
    );
  return { entries, sites };
}

/* ------------------------------------------------------------- the shape */

export interface Counters {
  askKinds: number;
  bakeSeamModules: ReturnType<typeof seamModules>;
  coarseDressingKinds: number;
  dressingKinds: number;
  layerModules: ReturnType<typeof layerModules>;
  longestFunction: ReturnType<typeof longestFunction>;
  publishedExtensions: string[];
  upstreamWorkarounds: ReturnType<typeof upstreamWorkarounds>;
}
