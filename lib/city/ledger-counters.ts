/**
 * The ledger's complexity counters (plan 087, phase 1; plan 086's table
 * "Less complexity"): each a pure function of source texts the caller reads
 * (scripts/ledger.ts). A counter counts code, never where a file lies or
 * how its text is wrapped: a move, a comment, a blank line or a wrapper
 * function moves none of them. Each says below what it counts and what it
 * cannot see.
 *
 * They read sources through two small lexers, not parsers: `lexTs` and
 * `lexPy` tell code from comments and from the text of strings, which is
 * all the counters need. What the TypeScript one gets wrong is named at it.
 */

/** A source file as the counters read it. */
export interface SourceText {
  path: string;
  text: string;
}

/** A source with its comments apart. */
export interface Lexed {
  /** the text with every comment and every string's contents blanked */
  bare: string;
  /** the text with every comment blanked (spaces; line breaks kept) */
  code: string;
  /** each comment's words, its markers and line breaks taken out; `//`
   *  comments on consecutive lines are one comment */
  comments: string[];
}

const blank = (text: string): string => text.replaceAll(/[^\n]/gu, " ");

/** A comment's words on one line: `//`, the block's ends and a JSDoc's
 *  leading stars gone, white space collapsed. */
const commentWords = (raw: string): string =>
  raw
    .replace(/^\/\*+/u, "")
    .replace(/\*+\/$/u, "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\/\/+|\*+|#+)?/u, ""))
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();

/** What a lexer collects. */
class Lexing {
  readonly text: string;
  private readonly bare: string[] = [];
  private readonly code: string[] = [];
  private readonly comments: string[] = [];
  /** where the last comment ended, and whether it was a line comment */
  private lastLine: { end: number } | null = null;
  /** the last code character that is not white space */
  last = "";
  /** the word the code last ended on, if it ended on one */
  word = "";

  constructor(text: string) {
    this.text = text;
  }

  /** `text[from, to)` as code. */
  plain(from: number, to: number): void {
    const piece = this.text.slice(from, to);
    this.code.push(piece);
    this.bare.push(piece);
    const trimmed = piece.trimEnd();
    if (trimmed !== "") {
      this.last = trimmed.at(-1) ?? "";
      this.word = /[\w$]+$/u.exec(trimmed)?.[0] ?? "";
    }
  }

  /** `text[from, to)` as a string's (or a regular expression's) text: code,
   *  but nothing a counter matches a call or a brace in. */
  quoted(from: number, to: number): void {
    const piece = this.text.slice(from, to);
    this.code.push(piece);
    this.bare.push(blank(piece));
    this.last = '"';
    this.word = "";
  }

  /** `text[from, to)` as a comment; `line`: one that runs to its line's
   *  end, joined to such a comment on the line before. */
  comment(from: number, to: number, line: boolean): void {
    const piece = this.text.slice(from, to);
    this.code.push(blank(piece));
    this.bare.push(blank(piece));
    const words = commentWords(piece);
    const joins =
      line &&
      this.lastLine !== null &&
      /^[ \t]*\r?\n[ \t]*$/u.test(this.text.slice(this.lastLine.end, from));
    if (joins) {
      this.comments[this.comments.length - 1] =
        `${this.comments.at(-1) ?? ""} ${words}`.trim();
    } else {
      this.comments.push(words);
    }
    this.lastLine = line ? { end: to } : null;
  }

  done(): Lexed {
    return {
      code: this.code.join(""),
      bare: this.bare.join(""),
      comments: this.comments,
    };
  }
}

/** The index after a quoted string that opens at `at` (its quote is
 *  `text[at]`): its closing quote, or its line's end where it has none. */
function stringEnd(text: string, at: number): number {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length && text[i] !== "\n") {
    if (text[i] === "\\") {
      i += 2;
    } else if (text[i] === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return Math.min(i, text.length);
}

/** After these words a slash opens a regular expression, not a division. */
const BEFORE_REGEX = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "void",
  "delete",
  "throw",
  "new",
  "else",
  "do",
  "yield",
  "await",
]);

/** The index after a regular expression that opens at `at`, or -1 where
 *  the line holds none (a division after all). */
function regexEnd(text: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < text.length && text[i] !== "\n") {
    const c = text[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "[") {
      inClass = true;
      i += 1;
    } else if (c === "]") {
      inClass = false;
      i += 1;
    } else if (c === "/" && !inClass) {
      i += 1;
      while (/[a-z]/u.test(text[i] ?? "")) {
        i += 1;
      }
      return i;
    } else {
      i += 1;
    }
  }
  return -1;
}

/** The index after a template's text that starts at `at`: at its closing
 *  backtick (`closed`) or after a `${`. */
function templateText(
  text: string,
  at: number
): { closed: boolean; end: number } {
  let i = at;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text[i] === "`") {
      return { closed: true, end: i };
    } else if (text[i] === "$" && text[i + 1] === "{") {
      return { closed: false, end: i };
    } else {
      i += 1;
    }
  }
  return { closed: true, end: text.length };
}

/**
 * A TypeScript source's code, comments and strings told apart.
 *
 * Not a parser. A slash is read as a regular expression after an operator,
 * an opening bracket or one of `BEFORE_REGEX`, and as a division elsewhere
 * (so `if (x) /re/.test(y)` is misread); JSX text is read as code, so an
 * apostrophe or `//` in it runs to its line's end as a string or comment.
 * Both cost a line or a brace on that line at most, and `longestFunction`
 * refuses a file whose brackets do not close.
 */
export function lexTs(text: string): Lexed {
  const out = new Lexing(text);
  /** the brace depths at which a template's `${` closes again */
  const templates: number[] = [];
  let depth = 0;
  let i = 0;
  /** where the code not yet handed over starts */
  let from = 0;
  const flush = (to: number) => {
    if (to > from) {
      out.plain(from, to);
    }
    from = to;
  };
  /** a template's text from `at` (after its backtick or a `}`): the index
   *  to read on from */
  const template = (at: number): number => {
    flush(at);
    const { closed, end } = templateText(text, at);
    out.quoted(at, end);
    from = end;
    if (closed) {
      return Math.min(end + 1, text.length);
    }
    templates.push(depth);
    depth += 1;
    return end + 2;
  };
  /** a comment or a regular expression that opens at `i`: its end, or -1 */
  const apart = (): number => {
    if (text[i + 1] === "/" || text[i + 1] === "*") {
      const line = text[i + 1] === "/";
      const stop = text.indexOf(line ? "\n" : "*/", i + 2);
      let end = text.length;
      if (stop !== -1) {
        end = line ? stop : stop + 2;
      }
      flush(i);
      out.comment(i, end, line);
      return end;
    }
    flush(i);
    const opens =
      out.last === "" ||
      "(,=:[!&|?{};+-*%<>~^".includes(out.last) ||
      BEFORE_REGEX.has(out.word);
    const end = opens ? regexEnd(text, i) : -1;
    if (end !== -1) {
      out.quoted(i, end);
    }
    return end;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "/") {
      const end = apart();
      if (end === -1) {
        i += 1;
      } else {
        from = end;
        i = end;
      }
    } else if (c === '"' || c === "'") {
      flush(i + 1);
      const end = stringEnd(text, i);
      const inner = end - 1 > i && text[end - 1] === c ? end - 1 : end;
      out.quoted(i + 1, inner);
      from = inner;
      i = end;
    } else if (c === "`") {
      i = template(i + 1);
    } else if (c === "}" && templates.at(-1) === depth - 1) {
      templates.pop();
      depth -= 1;
      i = template(i + 1);
    } else {
      if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
      }
      i += 1;
    }
  }
  flush(text.length);
  return out.done();
}

/** The index after a Python string that opens at `at` (after any prefix). */
function pyStringEnd(text: string, at: number): number {
  const quote = text[at] ?? "";
  const triple = quote.repeat(3);
  if (text.startsWith(triple, at)) {
    let i = at + 3;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
      } else if (text.startsWith(triple, i)) {
        return i + 3;
      } else {
        i += 1;
      }
    }
    return text.length;
  }
  return stringEnd(text, at);
}

/** A Python source's code, comments and strings told apart (a docstring is
 *  a string: nothing a counter matches a call in). */
export function lexPy(text: string): Lexed {
  const out = new Lexing(text);
  let i = 0;
  let from = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "#") {
      out.plain(from, i);
      const stop = text.indexOf("\n", i);
      const end = stop === -1 ? text.length : stop;
      out.comment(i, end, true);
      from = end;
      i = end;
    } else if (c === '"' || c === "'") {
      out.plain(from, i);
      const end = pyStringEnd(text, i);
      out.quoted(i, end);
      from = end;
      i = end;
    } else {
      i += 1;
    }
  }
  out.plain(from, text.length);
  return out.done();
}

/** The lines that hold code: not blank, not comment alone. */
export function codeLines(lexed: Lexed): number {
  return lexed.code.split("\n").filter((line) => line.trim() !== "").length;
}

const isTest = (path: string): boolean => /\.test\.tsx?$/u.test(path);
const baseName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

/**
 * The viewer's mesh builders: the modules named `*-layer.ts` (or `.tsx`),
 * tests left out, wherever they lie among the sources handed in — how
 * many, and their lines of code (`codeLines`: no comment, no blank line).
 *
 * Cannot see: a builder under another name (`tile-stream.ts` builds
 * meshes too), nor one renamed away from `-layer`: a rename shows as a
 * file fewer, which the reviewer reads in the ledger's diff.
 */
export function layerModules(files: readonly SourceText[]): {
  codeLines: number;
  files: number;
} {
  const layers = files.filter(
    ({ path }) => /-layer\.tsx?$/u.test(baseName(path)) && !isTest(path)
  );
  return {
    files: layers.length,
    codeLines: layers.reduce(
      (sum, { text }) => sum + codeLines(lexTs(text)),
      0
    ),
  };
}

/* ------------------------------------------------------ longest function */

/** A module's top-level function, arrow constant or class. */
export interface TopFunction {
  /** its lines of code, head and body */
  lines: number;
  name: string;
}

const FUNCTION_HEAD =
  /^\s*(?:export\s+)?(?:default\s+)?(?:(?:async\s+)?function\b\s*\*?\s*(?<fn>[\w$]*)|(?:abstract\s+)?class\s+(?<cls>[\w$]+))/u;
const CONST_HEAD = /^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[\w$]+)/u;

/** A top-level statement's name where it is a function: a `function`, a
 *  `class`, or a constant whose value (after its `=`: a type's arrows are
 *  not the value's) has an `=>` outside every bracket. */
function functionName(bare: string): string | null {
  const head = FUNCTION_HEAD.exec(bare);
  if (head) {
    const { fn, cls } = head.groups ?? {};
    return [fn, cls].find(Boolean) ?? "(anonymous)";
  }
  const name = CONST_HEAD.exec(bare)?.groups?.name;
  if (name === undefined) {
    return null;
  }
  // an arrow outside every bracket: a typed parameter's braces and a
  // return type's are skipped, an object's or a call's arrows are inside
  let depth = 0;
  let assigned = false;
  for (let i = 0; i < bare.length; i += 1) {
    const c = bare[i] ?? "";
    if ("([{".includes(c)) {
      depth += 1;
    } else if (")]}".includes(c)) {
      depth -= 1;
    } else if (depth === 0 && c === "=") {
      if (assigned && bare[i + 1] === ">") {
        return name;
      }
      assigned ||= bare[i + 1] !== ">";
    }
  }
  return null;
}

/**
 * A module's top-level functions with their lines of code. A statement
 * ends at a `;` outside every bracket, or at a `}` that closes the last
 * brace and ends its line. Throws where the brackets do not close: the
 * lexer misread the file (see `lexTs`), and a wrong figure must not pass
 * as one.
 */
export function topFunctions(source: SourceText): TopFunction[] {
  const { bare, code } = lexTs(source.text);
  const codeRows = code.split("\n");
  const out: TopFunction[] = [];
  let round = 0;
  let curly = 0;
  let start = 0;
  const close = (end: number) => {
    const name = functionName(bare.slice(start, end));
    if (name !== null) {
      const lead = /^\s*/u.exec(bare.slice(start, end))?.[0].length ?? 0;
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
      if (
        curly === 0 &&
        round === 0 &&
        /^[ \t]*(?:\r?\n|$)/u.test(bare.slice(i + 1))
      ) {
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
 * the figure follows the boot's code wherever it goes: behind a wrapper,
 * the wrapped function is the longest; split in two, the larger half.
 *
 * Counts a class whole and a function with everything nested in it.
 * Cannot see: a body cut into top-level functions of the same module (each
 * shorter — which is the cut plan 095 asks for, or its imitation: the
 * reviewer reads which). A tie goes to the path, then the name.
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
 * - `sites`: the comments in the sources (tests left out) that say
 *   *upstream workaround*, however their lines are wrapped (a comment
 *   that says it twice is one).
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
      (sum, { text }) =>
        sum +
        lexTs(text).comments.filter((comment) =>
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
