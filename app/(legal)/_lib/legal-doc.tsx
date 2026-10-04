import { readFileSync } from "node:fs";
import path from "node:path";
import type { Root as HastRoot } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { ReportsChoice } from "../../_components/reports-choice";

/**
 * /impressum and /datenschutz are Markdown next to their routes
 * (`app/(legal)/<name>/<name>.md`, ADR 0045), rendered here at build time
 * with the same remark/rehype chain as the Wissen pages, minus what only
 * docs/ needs (diagrams, GitHub links, code highlighting). Links starting
 * with `/` stay on the site; `<reports-choice></reports-choice>` in the
 * Markdown is the privacy page's switch for the crash reports.
 */
export type LegalDocName = "impressum" | "datenschutz";

function LegalLink({ children, href = "", ...rest }: ComponentProps<"a">) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  const external = /^https?:/u.test(href) ? { rel: "noopener" } : {};
  return (
    <a href={href} {...external} {...rest}>
      {children}
    </a>
  );
}

/**
 * One legal page, rendered once at build time. Cached because the
 * Markdown chain reads the clock on its way (Cache Components refuses that
 * in a prerender otherwise), and its output only changes with the file.
 */
export async function LegalDoc({ name }: { name: LegalDocName }) {
  "use cache";
  // A static path keeps the trace to the two files.
  const file = path.join(process.cwd(), "app", "(legal)", name, `${name}.md`);
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug);
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
    components: { a: LegalLink, "reports-choice": ReportsChoice },
  });
  return rendered as ReactNode;
}
