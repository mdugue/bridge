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
        'const s = "upstream workaround";',
        "// a workaround of our own, nothing upstream",
        "const b = 2; // Upstream   Workaround"
      ),
    },
    { path: "app/a.test.ts", text: "// upstream workaround" },
  ];
  expect(upstreamWorkarounds(files, REGISTER)).toEqual({
    entries: 3,
    sites: 4,
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
