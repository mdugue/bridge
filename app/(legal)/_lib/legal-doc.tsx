import { readFileSync } from "node:fs";
import path from "node:path";
import type { Root as HastRoot } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { ReportsChoice } from "../../_components/reports-choice";
import { DocLink, rehypeTableScroll } from "../../_lib/markdown-parts";

/**
 * /impressum and /datenschutz are Markdown next to their routes
 * (`app/(legal)/<name>/<name>.md`, ADR 0045), rendered here with the
 * Wissen pages' remark/rehype chain and its shared parts
 * (app/_lib/markdown-parts.tsx), minus what only docs/ needs (diagrams,
 * links resolved to GitHub, code highlighting). Links starting with `/`
 * stay on the site. The privacy page's switch for the crash reports is
 * written as `<reports-choice>` and `</reports-choice>` on two lines — on
 * one line it would be inline HTML, wrapped in a paragraph.
 *
 * Nothing here reads a request or the clock, so the pages prerender as
 * plain static ones: the file is read at build time (and on every request
 * in `bun dev`, where an edit shows on reload).
 */
export type LegalDocName = "impressum" | "datenschutz";

export async function LegalDoc({ name }: { name: LegalDocName }) {
  const file = path.join(process.cwd(), "app", "(legal)", name, `${name}.md`);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeTableScroll);
  // As in app/wissen/_lib/markdown.tsx: the chain ends in hast.
  const run: unknown = await processor.run(
    processor.parse(readFileSync(file, "utf8"))
  );
  // Typed against the global JSX namespace React 19 no longer declares, so
  // the result arrives untyped; it is React nodes by construction.
  const rendered: unknown = toJsxRuntime(run as HastRoot, {
    Fragment,
    jsx,
    jsxs,
    components: { a: DocLink, "reports-choice": ReportsChoice },
  });
  return rendered as ReactNode;
}
