import type { Element, Root as HastRoot } from "hast";
import Link from "next/link";
import type { ComponentProps } from "react";
import { visit } from "unist-util-visit";

/**
 * What every Markdown page of the site renders alike — the Wissen pages
 * (app/wissen/_lib/markdown.tsx) and the legal ones
 * (app/(legal)/_lib/legal-doc.tsx).
 */

/**
 * Wide tables scroll inside their own box instead of widening the page. Not
 * typeset's `typeset-scroll`: that one sets tables to max-content, which
 * turns this repo's prose tables into single endless lines.
 */
export function rehypeTableScroll() {
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

/** A link to the site stays a client-side navigation; any other is a plain one. */
export function DocLink({ children, href = "", ...rest }: ComponentProps<"a">) {
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
