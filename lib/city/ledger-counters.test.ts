import { expect, test } from "bun:test";
import {
  codeLines,
  layerModules,
  lexPy,
  lexTs,
  longestFunction,
  seamModules,
  topFunctions,
  upstreamWorkarounds,
} from "./ledger-counters";

const ts = (...lines: string[]) => lines.join("\n");
/** A template's hole, opened (written so that no line here reads as one). */
const HOLE = "${";

test("a TypeScript source's comments are told from its code", () => {
  const lexed = lexTs(
    ts(
      "/** A head comment",
      " *  on two lines. */",
      "const a = 1; // trailing",
      "",
      "// one",
      "// comment",
      "const b = 2;",
      "// another",
      "/* block */ const c = 3;"
    )
  );
  expect(lexed.comments).toEqual([
    "A head comment on two lines.",
    "trailing",
    "one comment",
    "another",
    "block",
  ]);
  expect(codeLines(lexed)).toBe(3);
  expect(lexed.code.split("\n")).toHaveLength(9);
  expect(lexed.code).toContain("const c = 3;");
  expect(lexed.code).not.toContain("trailing");
});

test("a comment marker inside a string, a template or a regex is text", () => {
  const lexed = lexTs(
    ts(
      'const url = "https://example.org/*x*/";',
      "const quote = 'it\\'s // fine';",
      "const t = `// not $[1 + /* yes */ 2} a comment { ` + `}`;".replace(
        "$[",
        HOLE
      ),
      "const re = /\\/\\/[/*]+'/u;",
      "const half = 4 / 2; // real",
      "const r = x.replace(/'/gu, '\"');"
    )
  );
  expect(lexed.comments).toEqual(["yes", "real"]);
  expect(codeLines(lexed)).toBe(6);
  // strings keep their place in the code, and lose their text in `bare`
  expect(lexed.code).toContain("https://example.org/*x*/");
  expect(lexed.bare).not.toContain("example");
  expect(lexed.bare).not.toContain("not");
  expect(lexed.bare).toContain("1 + ");
  expect(lexed.bare).toContain("const half = 4 / 2;");
  expect(lexed.bare.length).toBe(lexed.code.length);
});

test("a template's braces and a string's do not count as code's", () => {
  const source = {
    path: "a.ts",
    text: ts(
      "function a() {",
      "  const s = `{{{ $[[1].map((n) => `$[n}}`)} `;".replaceAll("$[", HOLE),
      '  return "}" + s;',
      "}",
      "function b() {}"
    ),
  };
  expect(topFunctions(source)).toEqual([
    { name: "a", lines: 4 },
    { name: "b", lines: 1 },
  ]);
});

test("the lines that hold code: no blank, no comment alone", () => {
  expect(codeLines(lexTs(""))).toBe(0);
  expect(codeLines(lexTs("\n\n// only\n/* a\n b */\n"))).toBe(0);
  expect(codeLines(lexTs("a;\n\nb; // c\n/* d */ e;\n"))).toBe(3);
  // a template's lines are code
  expect(codeLines(lexTs("const s = `a\nb\n\nc`;"))).toBe(3);
});

const LAYER = ts(
  "/** A layer. */",
  "",
  "// builds",
  "export function build() {",
  "  return 1; // one",
  "}"
);

test("the layer modules by their code, wherever they lie", () => {
  const counted = layerModules([
    { path: "app/_components/tree-layer.ts", text: LAYER },
    { path: "app/_components/tree-layer.test.ts", text: LAYER },
    { path: "app/_components/tile-stream.ts", text: LAYER },
    { path: "app/_components/rail-layer.ts", text: "const a = 1;\n" },
    { path: "app/_components/player.ts", text: LAYER },
  ]);
  expect(counted).toEqual({ files: 2, codeLines: 4 });
  // a move into a folder, or to a package, moves no figure
  expect(
    layerModules([
      { path: "app/_components/layers/tree-layer.ts", text: LAYER },
      { path: "packages/viewer/src/rail-layer.tsx", text: "const a = 1;\n" },
      { path: "packages/viewer/src/rail-layer.test.tsx", text: LAYER },
    ])
  ).toEqual(counted);
  // nor does a comment or a blank line
  expect(
    layerModules([
      {
        path: "app/_components/tree-layer.ts",
        text: `// more\n\n/* and\n more */\n${LAYER}\n\n`,
      },
      { path: "app/_components/rail-layer.ts", text: "const a = 1;\n" },
    ])
  ).toEqual(counted);
  // a folder named like a layer is not one
  expect(
    layerModules([{ path: "app/tree-layer.ts/index.ts", text: LAYER }])
  ).toEqual({ files: 0, codeLines: 0 });
});

const BOOT = ts(
  "import { x } from './x';",
  "",
  "const TABLE = {",
  "  a: 1,",
  "  b: 2,",
  "  c: 3,",
  "  d: 4,",
  "  e: 5,",
  "  f: 6,",
  "  g: 7,",
  "};",
  "",
  "/** Boots. */",
  "export async function bootApp(",
  "  opts: { a: number }",
  "): Promise<{ b: number }> {",
  "  // a comment",
  "",
  "  const inner = () => {",
  "    return opts.a;",
  "  };",
  "  return { b: inner() };",
  "}",
  "",
  "export const small = (a: { b: number }) => {",
  "  return a.b;",
  "};",
  "",
  "const HOOKS: Record<string, (a: number) => number> = {",
  "  a: (n) => n,",
  "  b: (n) => n,",
  "  c: (n) => n,",
  "  d: (n) => n,",
  "  e: (n) => n,",
  "  f: (n) => n,",
  "  g: (n) => n,",
  "};",
  "",
  "class Owner {",
  "  a = 1;",
  "}",
  "",
  "interface Long {",
  "  a: 1;",
  "  b: 2;",
  "  c: 3;",
  "  d: 4;",
  "  e: 5;",
  "  f: 6;",
  "  g: 7;",
  "  h: 8;",
  "}",
  "export default function () {",
  "  return 1;",
  "}"
);

test("a module's top-level functions with their lines of code", () => {
  // a table (of functions, too) and an interface are no functions; the
  // head counts, comments and blank lines do not
  expect(topFunctions({ path: "create-app.ts", text: BOOT })).toEqual([
    { name: "bootApp", lines: 8 },
    { name: "small", lines: 3 },
    { name: "Owner", lines: 3 },
    { name: "(anonymous)", lines: 3 },
  ]);
});

test("the longest function, however the boot is wrapped", () => {
  const files = [
    { path: "app/create-app.ts", text: BOOT },
    { path: "app/other.ts", text: "export function f() {\n  return 1;\n}\n" },
    { path: "app/huge.test.ts", text: BOOT.replaceAll("return", "x;\nreturn") },
  ];
  expect(longestFunction(files)).toEqual({
    lines: 8,
    name: "bootApp",
    path: "app/create-app.ts",
  });
  // behind a wrapper, the wrapped function is the longest
  const wrapped = BOOT.replace("function bootApp(", "function reallyBoot(");
  expect(
    longestFunction([
      {
        path: "app/create-app.ts",
        text: `${wrapped}\nexport function bootApp(o: { a: number }) {\n  return reallyBoot(o);\n}\n`,
      },
    ])
  ).toEqual({ lines: 8, name: "reallyBoot", path: "app/create-app.ts" });
  // moved to another module, it is found there
  expect(
    longestFunction([
      { path: "app/create-app.ts", text: "export function bootApp() {}\n" },
      { path: "lib/boot/impl.ts", text: BOOT },
    ]).path
  ).toBe("lib/boot/impl.ts");
  // as an arrow constant or a class's method, it counts the same
  const arrow = BOOT.replace(
    "export async function bootApp(",
    "export const bootApp = async ("
  ).replace("): Promise<{ b: number }> {", "): Promise<{ b: number }> => {");
  expect(longestFunction([{ path: "a.ts", text: arrow }])).toEqual({
    lines: 8,
    name: "bootApp",
    path: "a.ts",
  });
  // a tie goes to the first path, then the first function
  expect(
    longestFunction([
      { path: "b.ts", text: BOOT },
      { path: "a.ts", text: BOOT },
    ]).path
  ).toBe("a.ts");
  expect(longestFunction([])).toEqual({ lines: 0, name: "", path: "" });
});

test("a file whose brackets do not close is refused, not miscounted", () => {
  expect(() =>
    topFunctions({ path: "broken.ts", text: "function a() {\n  if (x) {\n}\n" })
  ).toThrow(/broken\.ts/u);
  expect(() =>
    topFunctions({ path: "broken.ts", text: "function a() {}\n}\n" })
  ).toThrow();
  expect(() =>
    topFunctions({ path: "broken.ts", text: "const a = f(1;\n" })
  ).toThrow();
});

test("a Python source's comments and strings are told from its code", () => {
  const lexed = lexPy(
    [
      '"""Reads the neighbours() of a tile."""',
      "MARGIN = 20  # the margin",
      "s = 'owns(' + \"read_osm(\"",
      "r = r'''a",
      "mosaic(' '''",
      "x = owns(b, 1, 2)",
    ].join("\n")
  );
  expect(lexed.comments).toEqual(["the margin"]);
  expect(lexed.bare).not.toContain("neighbours");
  expect(lexed.bare).not.toContain("read_osm");
  expect(lexed.bare).not.toContain("mosaic");
  expect(lexed.bare).toContain("x = owns(b, 1, 2)");
  expect(lexed.bare).toContain("MARGIN = 20");
});

const py = (name: string, text: string) => ({
  path: `pipeline/bake/${name}`,
  text,
});

test("the bake modules that handle a tile's edge, by the calls that do", () => {
  const counted = seamModules([
    py("a.py", "g = read_osm(tile, 'lines', where, cols)"),
    py("b.py", "if owns(bounds, x, y):\n    z = mosaic(dgm_paths(tile, b), b)"),
    py("c.py", "for tid, box in tile.neighbours():\n    c = tile.classes(tid)"),
    py("d.py", "return step_cache.memo(_STORE, key, make)"),
    py("e.py", "MARGIN = 10\nbox = (xmin - MARGIN, ymin)"),
    py("f.py", "def cells(tile, km, margin=0):\n    pass"),
    py("providers/g.py", "ways = read_ways(tile, where, cols, margin=0.001)"),
    py("h.py", "box = wgs84_bbox(tile)\nd = dom_paths(tile, box)"),
    // none of these handles an edge
    py("i.py", "# reads the neighbour tile across the seam, with a margin"),
    py("j.py", '"""owns( read_osm( .neighbours( margin"""\nx = 1'),
    py("k.py", "REG_MARGIN = 0.12\nbest = alias + REG_MARGIN"),
    py("l.py", "roof_seams = seamark(neighbourhood)\ncls = tile.classes()"),
    py("m.py", "pad = style.margin\ndisowns(x)\nmemoize(f)"),
    // not a bake module
    { path: "pipeline/tests/test_a.py", text: "owns(b, 1, 2)" },
    { path: "pipeline/bake/tree_allometry.json", text: "owns(" },
  ]);
  expect(counted).toEqual({
    matching: 8,
    of: 13,
    ways: {
      osmMargin: 3,
      readMargin: 3,
      owns: 1,
      neighbourRasters: 2,
      neighbourFiles: 1,
      siteMemo: 1,
    },
  });
});

const REGISTER = [
  "# Rendering",
  "",
  "## Something before",
  "",
  "**Not an entry.** Text.",
  "",
  "## Workarounds for upstream bugs",
  "",
  "Each entry is a bug in a dependency.",
  "",
  "**three r187: one.** It does",
  "**this** and that.",
  "",
  "**three r187: two.** More.",
  "",
  "### A sub-heading stays inside",
  "",
  "**tiles 0.5: three.** More.",
  "",
  "## After",
  "",
  "**Not an entry either.**",
].join("\n");

test("the workarounds: the register's entries and the marked comments", () => {
  const files = [
    {
      path: "app/a.ts",
      text: ts(
        "// An upstream workaround (docs/rendering.md)",
        "const a = 1;",
        "/**",
        " * three's dispose — an upstream",
        " * workaround, said twice: upstream workaround.",
        " */",
        "// wrapped over two lines, an upstream",
        "// workaround all the same",
        "const c = 3;",
        "/* and in a block: upstream",
        "   workaround */",
        'const s = "upstream workaround";',
        "// a workaround of our own, nothing upstream",
        "const b = 2; // Upstream   Workaround"
      ),
    },
    { path: "app/a.test.ts", text: "// upstream workaround" },
  ];
  expect(upstreamWorkarounds(files, REGISTER)).toEqual({
    entries: 3,
    sites: 5,
  });
  expect(upstreamWorkarounds([], REGISTER)).toEqual({ entries: 3, sites: 0 });
  // a register without its section is an error, not no workaround
  expect(() => upstreamWorkarounds(files, "# Rendering\n")).toThrow(
    /Workarounds for upstream bugs/u
  );
  // the section's name in the prose is not its heading
  expect(() =>
    upstreamWorkarounds(files, "See Workarounds for upstream bugs.\n")
  ).toThrow();
  // the register's last section runs to the end
  expect(
    upstreamWorkarounds([], "## Workarounds for upstream bugs\n\n**a.** b\n")
  ).toEqual({ entries: 1, sites: 0 });
});

/* ------------------------------------------- the lexers, edge by edge */

/** A source's comments, and its text with strings and comments blanked. */
const read = (text: string) => {
  const { bare, code, comments } = lexTs(text);
  expect(bare.length).toBe(text.length);
  expect(code.length).toBe(text.length);
  return { bare, comments };
};

test("a string ends at its quote, an escape is no quote", () => {
  expect(read('const a = "x\\\\"; // c')).toEqual({
    bare: 'const a = "   ";     ',
    comments: ["c"],
  });
  expect(read("f('a\\'b', 1); // c")).toEqual({
    bare: "f('    ', 1);     ",
    comments: ["c"],
  });
  expect(read('a = ""; b = "//"; // c').comments).toEqual(["c"]);
  expect(read("a = '' + 1; /* c */").bare).toBe("a = '' + 1;        ");
});

test("a string that does not close ends with its line", () => {
  expect(read('const a = "abc\nconst b = 1; // c')).toEqual({
    bare: 'const a = "   \nconst b = 1;     ',
    comments: ["c"],
  });
  expect(read('"abc').bare).toBe('"   ');
  expect(read('"').bare).toBe('"');
  expect(read('"ab\\').bare).toBe('"   ');
});

test("a slash opens a regular expression where a value may start", () => {
  expect(read("x = /[/]\\//gi.test(s); // c")).toEqual({
    bare: "x =          .test(s);     ",
    comments: ["c"],
  });
  expect(read("a = b / c / d; // c")).toEqual({
    bare: "a = b / c / d;     ",
    comments: ["c"],
  });
  expect(read("a = (b) / 2 / c; // c").bare).toBe("a = (b) / 2 / c;     ");
  expect(read("return /'/.test(s); // c")).toEqual({
    bare: "return    .test(s);     ",
    comments: ["c"],
  });
  expect(read("f(/[\"'`]/u, /\\//); // c")).toEqual({
    bare: "f(        ,     );     ",
    comments: ["c"],
  });
  // a class holds a slash, and closes; an escape in it is no bracket
  expect(read("s.split(/[/\\]]+x/); // c").bare).toBe(
    "s.split(         );     "
  );
  expect(read("s.split(/[a]\\[/); // c").comments).toEqual(["c"]);
  // no closing slash on the line: a division after all
  expect(read("a = [/ 2,\n'x']; // c")).toEqual({
    bare: "a = [/ 2,\n' '];     ",
    comments: ["c"],
  });
  expect(read("/a/.test(s)").bare).toBe("   .test(s)");
  expect(read("x = /a/").bare).toBe("x =    ");
});

test("a comment's ends are its own", () => {
  expect(read("/*/ x */ y")).toEqual({ bare: "         y", comments: ["/ x"] });
  expect(read("/**/x")).toEqual({ bare: "    x", comments: [""] });
  expect(read("a /* open")).toEqual({ bare: "a        ", comments: ["open"] });
  expect(read("a // end")).toEqual({ bare: "a       ", comments: ["end"] });
  expect(read("//\na")).toEqual({ bare: "  \na", comments: [""] });
  // a line comment joins the one on the line before, not one further up
  expect(read("a; // one\n// two\n\n// three\nb; /* four */\n// five")).toEqual(
    {
      bare: "a;       \n      \n\n        \nb;           \n       ",
      comments: ["one two", "three", "four", "five"],
    }
  );
  expect(read("// one\na;\n// two").comments).toEqual(["one", "two"]);
});

test("a template's text, holes and escapes", () => {
  expect(read(`a = \`x \\\` y\`; // c`)).toEqual({
    bare: "a = `      `;     ",
    comments: ["c"],
  });
  expect(read(`a = \`x \\${HOLE}y} z\`; // c`).comments).toEqual(["c"]);
  expect(read(`a = \`x ${HOLE}{ b: \`q\` }.b} y\`; // c`)).toEqual({
    bare: `a = \`  ${HOLE}{ b: \` \` }.b}  \`;     `,
    comments: ["c"],
  });
  expect(read(`a = \`x ${HOLE}f("}")} y\`; b = {};`).bare).toBe(
    `a = \`  ${HOLE}f(" ")}  \`; b = {};`
  );
  // one that does not close runs to the end, a hole that does not too
  expect(read("a = `x // y").bare).toBe("a = `      ");
  expect(read(`a = \`x ${HOLE}b`).bare).toBe(`a = \`  ${HOLE}b`);
  expect(read("a = `` + ``; // c").comments).toEqual(["c"]);
  expect(read(`a = \`${HOLE}b}\`; // c`).comments).toEqual(["c"]);
});

test("a function's braces after a template's hole are code's again", () => {
  expect(
    topFunctions({
      path: "a.ts",
      text: ts(
        "function a() {",
        `  return \`${HOLE}1}\`;`,
        "}",
        "function b() {",
        "  return { c: `}` };",
        "}"
      ),
    })
  ).toEqual([
    { name: "a", lines: 3 },
    { name: "b", lines: 3 },
  ]);
});

/** A Python source's comments, and its code with strings blanked. */
const readPy = (text: string) => {
  const { bare, comments } = lexPy(text);
  expect(bare.length).toBe(text.length);
  return { bare, comments };
};

test("a Python string's ends, and a comment's", () => {
  const first = readPy("a = 'it\\'s # no' # yes");
  expect(first.bare.trimEnd()).toBe("a =");
  expect(first.comments).toEqual(["yes"]);
  const triple = readPy('a = """x\\""" y""" + b # c');
  expect(triple.bare.replaceAll(/ +/gu, " ").trimEnd()).toBe("a = + b");
  expect(triple.comments).toEqual(["c"]);
  const lines = readPy('a = """x"\n# no\n""" + owns(b) # c');
  expect(lines.bare.split("\n").map((l) => l.trim())).toEqual([
    "a =",
    "",
    "+ owns(b)",
  ]);
  expect(lines.comments).toEqual(["c"]);
  expect(readPy("a = '' + owns(b) + \"\"").bare.trim()).toBe(
    "a =    + owns(b) +"
  );
  expect(readPy("a = '''open\nowns(").bare.trim()).toBe("a =");
  expect(readPy("a = 'open\nowns(b)").bare.split("\n")[1]).toBe("owns(b)");
  expect(readPy("# one\n# two\nx = 1\n# three").comments).toEqual([
    "one two",
    "three",
  ]);
  expect(readPy("#").comments).toEqual([""]);
  expect(readPy("x = 1").bare).toBe("x = 1");
});

const names = (text: string) =>
  topFunctions({ path: "a.ts", text }).map((f) => `${f.name} ${f.lines}`);

test("top-level statements end at a semicolon or a closing brace", () => {
  expect(names("function a() {}\nfunction b() {}\n")).toEqual(["a 1", "b 1"]);
  expect(names("const a = 1;function b() {\n}\n")).toEqual(["b 2"]);
  expect(names("\n\nfunction a() {\n  return 1;\n}\n")).toEqual(["a 3"]);
  expect(names("// c\n\n/* d */\nfunction a() {\n\n  // e\n}\n")).toEqual([
    "a 2",
  ]);
  expect(names("{\n}\nfunction a() {\n}\n")).toEqual(["a 2"]);
  expect(names("(function () {\n})();\nfunction a() {\n}\n")).toEqual(["a 2"]);
  // a type's arrows are not a value's
  expect(
    names("const t: Map<() => void, () => void> = m;\nconst f = () => 1;\n")
  ).toEqual(["f 1"]);
  expect(names("const g = a >= b;\nconst h = async (x) => x;\n")).toEqual([
    "h 1",
  ]);
  expect(names("const o = { f: () => 1 };\nlet k = (a = 1) => a;\n")).toEqual([
    "k 1",
  ]);
  expect(names("export default class {\n}\n")).toEqual(["(anonymous) 2"]);
  expect(names("export abstract class A {\n}\n")).toEqual(["A 2"]);
  expect(names("async function* gen() {\n}\n")).toEqual(["gen 2"]);
  expect(names("")).toEqual([]);
});

test("brackets that close in the wrong order are refused", () => {
  expect(() =>
    topFunctions({ path: "a.ts", text: "const a = 1);\nconst b = (2;\n" })
  ).toThrow(/a\.ts/u);
  expect(() =>
    topFunctions({ path: "a.ts", text: "}\nfunction a() {\n" })
  ).toThrow();
});

const sized = (path: string, lines: number) => ({
  path,
  text: `function ${path.replaceAll(/\W/gu, "_")}() {\n${"  x();\n".repeat(lines - 2)}}\n`,
});

test("the longest function of files in any order, tests left out", () => {
  for (const files of [
    [sized("b.ts", 5), sized("a.ts", 5), sized("c.ts", 4)],
    [sized("c.ts", 4), sized("a.ts", 5), sized("b.ts", 5)],
    [sized("a.ts", 5), sized("c.ts", 4), sized("b.ts", 5)],
  ]) {
    expect(longestFunction(files)).toEqual({
      lines: 5,
      name: "a_ts",
      path: "a.ts",
    });
  }
  expect(
    longestFunction([
      sized("a.ts", 3),
      sized("a.test.ts", 9),
      sized("b.test.tsx", 9),
    ]).path
  ).toBe("a.ts");
});

const count = (path: string) => layerModules([{ path, text: "a;\n" }]).files;

test("a layer module is one by its file's name", () => {
  expect(count("tree-layer.ts")).toBe(1);
  expect(count("app/x/tree-layer.tsx")).toBe(1);
  expect(count("app/x-layer.ts/a.ts")).toBe(0);
  expect(count("app/layer.ts")).toBe(0);
  expect(count("app/tree-layer.ts.bak")).toBe(0);
  expect(count("app/tree-layers.ts")).toBe(0);
});

const entries = (register: string) => upstreamWorkarounds([], register).entries;

test("the register's section by its heading, whatever its level", () => {
  expect(entries("# Workarounds for upstream bugs\n**a.** b")).toBe(1);
  // it ends at the next heading of its level or above, not below
  expect(
    entries(
      "## Workarounds for upstream bugs\n\n**a.** b\n\n### Sub\n\n**c.** d\n\n# Top\n\n**e.** f"
    )
  ).toBe(2);
  expect(
    entries(
      "### Workarounds for upstream bugs\n\n**a.** b\n\n## Up\n\n**c.** d"
    )
  ).toBe(1);
  // an entry opens its paragraph: bold further down is its text
  expect(
    entries(
      "## Workarounds for upstream bugs\n\n**a.** one\ntwo\nthree\n\n**b.** one\n**two** three\nfour\n\nPlain **bold** text.\n\n**c.** last"
    )
  ).toBe(3);
  expect(() => entries("Workarounds for upstream bugs\n\n**a.** b")).toThrow();
  expect(() =>
    entries("####### Workarounds for upstream bugs\n\n**a.** b")
  ).toThrow();
});
