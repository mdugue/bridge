/**
 * What the ledger's counters read sources with (ledger-counters.ts): a
 * source's code told from its comments and from the text of its strings.
 * Lexers, not parsers — that is all a counter needs. This module has the
 * shared collector and the Python reader; ts-lexer.ts reads TypeScript.
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
const commentWords = (raw: string): string => {
  let inner = raw;
  if (raw.startsWith("/*")) {
    inner = raw.slice(
      2,
      raw.length >= 4 && raw.endsWith("*/") ? -2 : undefined
    );
  }
  return inner
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\/\/+|\*+|#+)?/u, ""))
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
};

/** What a lexer collects. */
export class Lexing {
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
  /** whether the code last ended on an arrow, `=>` */
  arrow = false;

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
      this.arrow = trimmed.endsWith("=>");
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
    this.arrow = false;
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
export function stringEnd(text: string, at: number): number {
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
