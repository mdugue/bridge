import { readFileSync } from "node:fs";
import path from "node:path";
import rehypeShiki, { type RehypeShikiOptions } from "@shikijs/rehype";
import type { Element, Root as HastRoot } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { toString as hastText } from "hast-util-to-string";
import type { Root as MdastRoot } from "mdast";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { METHODS, methodOfToken } from "@/lib/city/methods";
import { diagramKey } from "@/lib/docs/diagrams";
import { type Lang, resolveHref } from "@/lib/docs/routes";
import { Diagram } from "../_components/diagram";

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

export interface RenderedDoc {
  content: ReactNode;
  toc: TocEntry[];
}

/** The text of an mdast node, for the heading a diagram sits under. */
function mdText(node: { value?: unknown; children?: unknown[] }): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? [])
    .map((c) => mdText(c as { value?: unknown; children?: unknown[] }))
    .join("");
}

/**
 * Each ```mermaid block becomes its committed SVG (scripts/render-diagrams.ts).
 * A missing one fails the build rather than shipping a code listing – the
 * freshness test says the same thing earlier, in `bun run verify`. The
 * heading above a diagram becomes its title in the zoom dialog.
 */
function remarkDiagrams() {
  return (tree: MdastRoot) => {
    let heading: string | null = null;
    visit(tree, (node, index, parent) => {
      if (node.type === "heading") {
        heading = mdText(node).trim();
        return;
      }
      if (node.type !== "code" || !parent || index === undefined) {
        return;
      }
      if (node.lang !== "mermaid") {
        return;
      }
      const key = diagramKey(node.value);
      // DIAGRAM_DIR, spelled out: a static path keeps the trace to docs/.
      const file = path.join(process.cwd(), "docs", "diagrams", `${key}.svg`);
      let svg: string;
      try {
        svg = readFileSync(file, "utf8").trim();
      } catch {
        throw new Error(
          `No rendered diagram docs/diagrams/${key}.svg – run \`bun run docs:diagrams\``
        );
      }
      const box = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/u);
      const attrs = [
        `data-width="${Math.round(Number(box?.[1] ?? 0))}"`,
        `data-height="${Math.round(Number(box?.[2] ?? 0))}"`,
        heading ? `data-title="${heading.replaceAll('"', "&quot;")}"` : "",
      ].join(" ");
      parent.children[index] = {
        type: "html",
        value: `<figure class="diagram" ${attrs}>${svg}</figure>`,
      };
    });
  };
}

/** Links are written for GitHub; on the site they go to the page or to GitHub. */
function rehypeLinks(file: string, pages: ReadonlySet<string>) {
  return () => (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "a" || typeof node.properties.href !== "string") {
        return;
      }
      const resolved = resolveHref(file, node.properties.href, pages);
      node.properties.href = resolved.href;
      if (resolved.kind === "external") {
        node.properties.rel = ["noopener"];
      }
    });
  };
}

/**
 * A method badge written as inline code (`◎ erkannt`, `≈ assumed`: the
 * glyph and the word, lib/city/methods.ts) becomes the badge the inquiry
 * card shows; on GitHub it stays a readable token. Code in a block is left
 * alone, and so is any other inline code.
 */
function rehypeMethodBadges(lang: Lang) {
  return () => (tree: HastRoot) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (
        node.tagName !== "code" ||
        !parent ||
        index === undefined ||
        (parent.type === "element" && parent.tagName === "pre")
      ) {
        return;
      }
      const method = methodOfToken(hastText(node));
      if (!method) {
        return;
      }
      const info = METHODS[method];
      const label = lang === "de" ? info.label : info.labelEn;
      parent.children[index] = {
        type: "element",
        tagName: "span",
        properties: {
          className: ["method-badge"],
          dataMethod: method,
          title: `${label}: ${lang === "de" ? info.meaning : info.meaningEn}`,
        },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { ariaHidden: "true" },
            children: [{ type: "text", value: info.glyph }],
          },
          { type: "text", value: label },
        ],
      };
    });
  };
}

/**
 * Wide tables scroll inside their own box instead of widening the page. Not
 * typeset's `typeset-scroll`: that one sets tables to max-content, which
 * turns this repo's prose tables into single endless lines.
 */
function rehypeTableScroll() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "table" || !parent || index === undefined) {
        return;
      }
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["doc-table"] },
        children: [node],
      };
    });
  };
}

function tocOf(tree: HastRoot): TocEntry[] {
  const toc: TocEntry[] = [];
  visit(tree, "element", (node: Element) => {
    if (
      (node.tagName === "h2" || node.tagName === "h3") &&
      node.properties.id
    ) {
      toc.push({
        id: String(node.properties.id),
        text: hastText(node),
        depth: node.tagName === "h2" ? 2 : 3,
      });
    }
  });
  return toc;
}

function DocLink({ children, href = "", ...rest }: ComponentProps<"a">) {
  return href.startsWith("/") ? (
    <Link href={href} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** The code fences' languages the highlighter loads up front (```mermaid
 *  becomes a diagram before it runs). */
const SHIKI_LANGS: RehypeShikiOptions["langs"] = [
  "bash",
  "markdown",
  "python",
  "toml",
  "tsx",
  "typescript",
  "yaml",
];

/** One docs file, rendered: Markdown → hast → React, on the server only. */
export async function renderDoc(
  file: string,
  markdown: string,
  pages: ReadonlySet<string>,
  lang: Lang
): Promise<RenderedDoc> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDiagrams)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeLinks(file, pages))
    .use(rehypeTableScroll)
    .use(rehypeMethodBadges(lang))
    .use(rehypeShiki, {
      theme: "github-light",
      // The languages docs/ fences: without a list the plugin loads every
      // grammar Shiki bundles (346, ~5.5 s per build worker). Any other one
      // Shiki has loads when a page first fences it (`lazy`); a name it does
      // not know stays plain text.
      langs: SHIKI_LANGS,
      lazy: true,
      defaultLanguage: "text",
      fallbackLanguage: "text",
    });
  // unified's processor types are too deep for the type-aware lint pass; the
  // plugin chain above ends in hast, which is all this needs to know.
  const run: unknown = await processor.run(processor.parse(markdown));
  const tree = run as HastRoot;
  // Typed against the global JSX namespace React 19 no longer declares, so
  // the result arrives untyped; it is React nodes by construction.
  const rendered: unknown = toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: {
      a: DocLink,
      figure: (
        props: ComponentProps<"figure"> & {
          "data-width"?: string;
          "data-height"?: string;
          "data-title"?: string;
        }
      ) =>
        props.className === "diagram" ? (
          <Diagram
            height={Number(props["data-height"] ?? 0)}
            lang={lang}
            title={props["data-title"] ?? null}
            width={Number(props["data-width"] ?? 0)}
          >
            {props.children}
          </Diagram>
        ) : (
          <figure {...props} />
        ),
    },
  });
  return { content: rendered as ReactNode, toc: tocOf(tree) };
}
