/**
 * What a page is called and how it describes itself, read off its Markdown so
 * the site never carries a second copy of either.
 */

/** Markdown inline syntax reduced to its text: links, code, emphasis. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/(\*\*|__)(.*?)\1/gu, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/gu, "$1$2")
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The first `# ` heading, as text. */
export function titleOf(markdown: string): string | null {
  const line = markdown.match(/^# (.+)$/mu)?.[1];
  return line ? plainText(line) : null;
}

/**
 * The first real paragraph after the title – not the italic line that links
 * the other language – cut at a sentence end near `max` characters.
 */
export function descriptionOf(markdown: string, max = 180): string | null {
  const body = markdown.replace(/^[\s\S]*?^# .+$/mu, "");
  const inFence = /^```[\s\S]*?^```/gmu;
  const paragraphs = body
    .replace(inFence, "")
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p !== "" &&
        !/^(#|\||>|[-*] |\d+\. |<|```)/u.test(p) &&
        !/^\*[^*]+\*$/u.test(p)
    );
  const text = paragraphs[0] ? plainText(paragraphs[0]) : null;
  if (!text || text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > max / 2
    ? cut.slice(0, end + 1)
    : `${cut.replace(/\s+\S*$/u, "")} …`;
}

/** Every link target of a Markdown text, in the order they appear. */
export function linkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/gu)].map((m) => m[1] ?? "");
}
