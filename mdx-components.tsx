import type { MDXComponents } from "mdx/types";

/**
 * The MDX pages' components (required by @next/mdx in the App Router): the
 * legal pages, app/(legal)/impressum and datenschutz (ADR 0045), render
 * plain Markdown elements, styled by their layout's typeset article.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return components;
}
