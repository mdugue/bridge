/**
 * What a page is called and how it describes itself, read off its Markdown so
 * the site never carries a second copy of either.
 */

/** Markdown inline syntax reduced to its text: links, code, emphasis. */
export function plainText(markdown: string): string {
  return markdown
    .replaceAll(/!?\[(?<text>[^\]]*)\]\([^)]*\)/gu, "$<text>")
    .replaceAll(/`(?<code>[^`]*)`/gu, "$<code>")
    .replaceAll(/(?<mark>\*\*|__)(?<inner>.*?)\k<mark>/gu, "$<inner>")
    .replaceAll(
      /(?<lead>^|[^\w*])[*_](?<inner>[^*_\n]+)[*_](?![\w*])/gu,
      "$<lead>$<inner>"
    )
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/** The first `# ` heading, as text. */
export function titleOf(markdown: string): string | null {
  const line = /^# (?<title>.+)$/mu.exec(markdown)?.groups?.title;
  return line ? plainText(line) : null;
}

/**
 * The first real paragraph after the title – not the italic line that links
 * the other language – cut at a sentence end near `max` characters.
 */
export function descriptionOf(markdown: string, max = 180): string | null {
  const body = markdown.replace(/^[\s\S]*?^# .+$/mu, "");
  const inFence = /^```[\s\S]*?^```/gmu;
  const first = body
    .replaceAll(inFence, "")
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .find(
      (p) =>
        p !== "" &&
        !/^(?:#|\||>|[-*] |\d+\. |<|```)/u.test(p) &&
        !/^\*[^*]+\*$/u.test(p)
    );
  const text = first ? plainText(first) : null;
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
  return [...markdown.matchAll(/\]\((?<target>[^)\s]+)\)/gu)].map(
    (m) => m.groups?.target ?? ""
  );
}
