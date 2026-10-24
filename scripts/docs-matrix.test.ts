import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceMatrix, sourceMatrixPage } from "../lib/city/source-matrix";
import { SITES } from "../sites";
import { matrixInputs, matrixPath } from "./docs-matrix";

test("the committed sources-by-city pages are what the configs say", () => {
  const { sites, built } = matrixInputs();
  for (const lang of ["en", "de"] as const) {
    expect(readFileSync(matrixPath(lang), "utf8")).toBe(
      sourceMatrixPage(sites, lang, built)
    );
  }
});

test("a Land without an open DLM is drawn from OSM, marked as a stand-in", () => {
  const [row] = sourceMatrix([SITES.hamburg, SITES.dresden]).slice(3, 4);
  expect(row[0]).toMatchObject({ quality: "substitute", reason: "noDlm" });
  expect(row[1].quality).toBe("best");
});

test("every footnote a page marks is listed once, in order", () => {
  const { sites, built } = matrixInputs();
  const page = sourceMatrixPage(sites, "en", built);
  const notes = page.split("## Why not the best source")[1];
  const listed = (notes.match(/^\d+\. /gm) ?? []).map((s) =>
    Number.parseInt(s, 10)
  );
  // the marks in the order the table first shows them, as numbers
  const digit = (m: string) =>
    Number(
      m
        .split("")
        .map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c))
        .join("")
    );
  const marks = [...new Set((page.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g) ?? []).map(digit))];
  const oneToN = Array.from({ length: marks.length }, (_, i) => i + 1);
  expect(marks.length).toBeGreaterThan(0);
  expect(marks).toEqual(oneToN);
  expect(listed).toEqual(oneToN);
});
