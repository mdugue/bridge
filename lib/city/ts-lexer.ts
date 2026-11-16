/**
 * The TypeScript reader of the ledger's counters (ledger-counters.ts): a
 * source's code told from its comments, its strings, templates and regular
 * expressions, and — in a `.tsx` file — from the text of its JSX. Not a
 * parser: what it gets wrong is named at `lexTs`.
 */
import { Lexing, stringEnd } from "./source-lexer";
import type { Lexed, SourceText } from "./source-lexer";

/** After these words a value may start: a slash opens a regular
 *  expression, not a division, and (in a `.tsx` file) a `<` a JSX tag. */
export const BEFORE_REGEX: ReadonlySet<string> = new Set([
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

/** What the reader is inside of, innermost last. */
type Context =
  /** a template's `${`, a JSX tag's or child's `{`: code until the brace
   *  at `depth` closes */
  | { depth: number; kind: "hole"; after: "template" | "jsx" }
  /** a JSX tag, between its `<` and its `>`; `closing`: `</a>` */
  | { closing: boolean; kind: "tag" }
  /** a JSX element's children: text, until a `<` or a `{` */
  | { kind: "children" };

/** After these characters a `<` may open a JSX tag (with `=>`, `return`
 *  and the like, `BEFORE_REGEX`). */
const BEFORE_JSX = "(,=:?&|{};[!";
/** After these a slash opens a regular expression (with `=>` and
 *  `BEFORE_REGEX`); after `<` it closes a JSX tag, after `>` it divides. */
const BEFORE_SLASH = "(,=:[!&|?{};+-*%~^}";

/** A TypeScript source's reader (`lexTs`). */
class TsLexer {
  private readonly text: string;
  private readonly jsx: boolean;
  private readonly out: Lexing;
  private readonly contexts: Context[] = [];
  /** the depth of braces in code */
  private depth = 0;
  private i = 0;
  /** where the code not yet handed over starts */
  private from = 0;

  constructor(text: string, jsx: boolean) {
    this.text = text;
    this.jsx = jsx;
    this.out = new Lexing(text);
  }

  private flush(to: number): void {
    if (to > this.from) {
      this.out.plain(this.from, to);
    }
    this.from = to;
  }

  /** `text[at, end)` as a string's text; reading goes on at `next`. */
  private quote(at: number, end: number, next: number): void {
    this.flush(at);
    this.out.quoted(at, end);
    this.from = end;
    this.i = next;
  }

  /** A template's text from `at` (after its backtick or a hole's `}`). */
  private template(at: number): void {
    const { closed, end } = templateText(this.text, at);
    if (closed) {
      this.quote(at, end, Math.min(end + 1, this.text.length));
      return;
    }
    this.quote(at, end, end + 2);
    this.contexts.push({ kind: "hole", depth: this.depth, after: "template" });
    this.depth += 1;
  }

  /** A comment that opens at `i`. */
  private comment(): void {
    const { text, i } = this;
    const line = text[i + 1] === "/";
    const stop = text.indexOf(line ? "\n" : "*/", i + 2);
    let end = text.length;
    if (stop !== -1) {
      end = line ? stop : stop + 2;
    }
    this.flush(i);
    this.out.comment(i, end, line);
    this.from = end;
    this.i = end;
  }

  /** Whether a value may start here: after an operator, an opening
   *  bracket, an arrow or a word of `BEFORE_REGEX`. */
  private valueStarts(after: string): boolean {
    const { last, arrow, word } = this.out;
    return (
      last === "" || after.includes(last) || arrow || BEFORE_REGEX.has(word)
    );
  }

  /** A slash at `i`: a comment, a regular expression or a division. */
  private slash(): void {
    const { text, i } = this;
    const next = text[i + 1];
    if (next === "/" || next === "*") {
      this.comment();
      return;
    }
    this.flush(i);
    // (`</` and `/>` are a JSX tag's, never an expression's)
    const opens =
      next !== ">" && this.out.last !== "<" && this.valueStarts(BEFORE_SLASH);
    const end = opens ? regexEnd(text, i) : -1;
    if (end === -1) {
      this.i += 1;
    } else {
      this.quote(i, end, end);
    }
  }

  /** A quoted string that opens at `i`. */
  private string(): void {
    const { text, i } = this;
    const end = stringEnd(text, i);
    const inner = end - 1 > i && text[end - 1] === text[i] ? end - 1 : end;
    this.quote(i + 1, inner, end);
  }

  /**
   * Whether the `<` at `i` opens a JSX tag: where a value may start, before
   * a name that a blank, `>` or `/` follows — not a generic's parameter
   * (`<T,>`, `<T extends U>`, `<T = U>`), and not a generic signature
   * (`<T>(…) => …`: no `</T>` follows it).
   */
  private opensTag(): boolean {
    const { text, i } = this;
    if (!this.jsx) {
      return false;
    }
    // (what the code last ended on is known once it is handed over)
    this.flush(i);
    if (!this.valueStarts(BEFORE_JSX)) {
      return false;
    }
    const rest = text.slice(i + 1, i + 200);
    if (rest.startsWith(">")) {
      return true;
    }
    const name = /^[A-Za-z_$][\w$.:-]*/u.exec(rest)?.[0];
    if (name === undefined) {
      return false;
    }
    const after = rest.slice(name.length);
    if (/^\s*>\s*\(/u.test(after)) {
      return text.includes(`</${name}>`, i);
    }
    return /^(?:\s*\/?>|\s+(?!extends\b|=|,))/u.test(after);
  }

  /** A brace or an angle bracket at `i`, in code. */
  private bracket(c: string): void {
    const top = this.contexts.at(-1);
    if (c === "{") {
      if (top?.kind === "tag") {
        this.contexts.push({ kind: "hole", depth: this.depth, after: "jsx" });
      }
      this.depth += 1;
    } else if (c === "}") {
      this.depth -= 1;
    } else if (c === "<" && top?.kind !== "tag" && this.opensTag()) {
      this.contexts.push({ kind: "tag", closing: false });
    } else if (c === ">" && top?.kind === "tag") {
      this.contexts.pop();
      if (top.closing) {
        // `</a>`: its element's children end with it
        this.contexts.pop();
      } else if (this.text[this.i - 1] !== "/") {
        this.contexts.push({ kind: "children" });
      }
    }
    this.i += 1;
  }

  /** A JSX element's children from `i`: text to the next `<` or `{`. */
  private children(): void {
    const { text, i } = this;
    const stop = text.slice(i).search(/[<{]/u);
    const end = stop === -1 ? text.length : i + stop;
    this.quote(i, end, end);
    if (end >= text.length) {
      return;
    }
    if (text[end] === "{") {
      this.contexts.push({ kind: "hole", depth: this.depth, after: "jsx" });
      this.depth += 1;
    } else {
      this.contexts.push({ kind: "tag", closing: text[end + 1] === "/" });
    }
    this.i = end + 1;
  }

  /** One step in code. */
  private code(): void {
    const { text, i } = this;
    const c = text[i] ?? "";
    const top = this.contexts.at(-1);
    if (c === "/") {
      this.slash();
    } else if (c === '"' || c === "'") {
      this.string();
    } else if (c === "`") {
      this.template(i + 1);
    } else if (
      c === "}" &&
      top?.kind === "hole" &&
      top.depth === this.depth - 1
    ) {
      this.contexts.pop();
      this.depth -= 1;
      if (top.after === "template") {
        this.template(i + 1);
      } else {
        this.i += 1;
      }
    } else if ("{}<>".includes(c)) {
      this.bracket(c);
    } else {
      this.i += 1;
    }
  }

  read(): Lexed {
    while (this.i < this.text.length) {
      if (this.contexts.at(-1)?.kind === "children") {
        this.children();
      } else {
        this.code();
      }
    }
    this.flush(this.text.length);
    return this.out.done();
  }
}

/**
 * A TypeScript source's code, comments and strings told apart; with `jsx`
 * (a `.tsx` file) a JSX element's text is text too, so an apostrophe, a
 * bracket or `//` in it is neither string, code nor comment.
 *
 * Not a parser. A slash is read as a regular expression where a value may
 * start — after an operator, an opening bracket, an arrow or one of
 * `BEFORE_REGEX` — and as a division elsewhere (so `if (x) /re/.test(y)`
 * is misread, at the cost of that line). A `<` opens a JSX tag by the
 * same test and `opensTag`'s. `topFunctions` refuses a file whose brackets
 * do not close as read.
 */
export function lexTs(text: string, jsx = false): Lexed {
  return new TsLexer(text, jsx).read();
}

/** A source read by its path: a `.tsx` file with its JSX. */
export const lexSource = ({ path, text }: SourceText): Lexed =>
  lexTs(text, path.endsWith(".tsx"));
