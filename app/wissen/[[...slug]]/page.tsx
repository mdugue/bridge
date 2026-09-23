import { ChevronDownIcon, FileCodeIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { descriptionOf } from "@/lib/docs/content";
import {
  type Lang,
  langOf,
  routeOf,
  segmentsOf,
  sourceUrl,
  twinOf,
} from "@/lib/docs/routes";
import { cn } from "@/lib/utils";
import { DocNav, SECTION_LABEL } from "../_components/doc-nav";
import { fileAt, nav, pageFiles, readDoc, titleFor } from "../_lib/docs";
import { renderDoc } from "../_lib/markdown";

interface Props {
  params: Promise<{ slug?: string[] }>;
}

/** Every page of docs/, prerendered; there is nothing to render per request. */
export function generateStaticParams() {
  return pageFiles().map((file) => ({ slug: segmentsOf(file) ?? [] }));
}

async function fileOf(params: Props["params"]) {
  const { slug = [] } = await params;
  return fileAt(slug);
}

const LABELS: Record<
  Lang,
  Record<"contents" | "onPage" | "source" | "other", string>
> = {
  de: {
    contents: "Inhalt",
    onPage: "Auf dieser Seite",
    source: "Quelle auf GitHub",
    other: "English version",
  },
  en: {
    contents: "Contents",
    onPage: "On this page",
    source: "Source on GitHub",
    other: "Deutsche Fassung",
  },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const file = await fileOf(params);
  if (!file) {
    return {};
  }
  const twin = twinOf(file);
  const route = routeOf(file) ?? undefined;
  const lang = langOf(file);
  return {
    title: `${titleFor(file)} · Wissen · City Walk Dresden`,
    description: descriptionOf(readDoc(file)) ?? undefined,
    alternates: {
      canonical: route,
      languages:
        twin && lang && pageFiles().includes(twin.file)
          ? {
              [lang]: route,
              [twin.lang]: routeOf(twin.file) ?? undefined,
            }
          : undefined,
    },
  };
}

export default async function WissenPage({ params }: Props) {
  const file = await fileOf(params);
  if (!file) {
    notFound();
  }
  return <DocPage file={file} />;
}

/**
 * One page, rendered once at build time. Cached because the Markdown pipeline
 * reads the clock on its way (Cache Components refuses that in a prerender
 * otherwise), and its output only changes with the file.
 */
async function DocPage({ file }: { file: string }) {
  "use cache";
  const pages = new Set(pageFiles());
  const lang: Lang = langOf(file) ?? "de";
  const label = LABELS[lang];
  const route = routeOf(file) ?? "";
  const twin = twinOf(file);
  const twinRoute = twin && pages.has(twin.file) ? routeOf(twin.file) : null;
  const groups = nav();
  const { content, toc } = await renderDoc(file, readDoc(file), pages, lang);

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-7xl flex-1 gap-x-12 px-4 lg:grid-cols-[15rem_minmax(0,1fr)]",
        toc.length > 1 && "xl:grid-cols-[15rem_minmax(0,1fr)_13rem]"
      )}
    >
      <aside className="hidden lg:block">
        <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-8 pr-2">
          <DocNav current={route} groups={groups} />
        </div>
      </aside>

      <main className="min-w-0 py-8 lg:py-10">
        <details className="group/menu mb-8 rounded-lg border lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium text-sm">
            {label.contents}
            <ChevronDownIcon className="size-4 opacity-50 transition-transform group-open/menu:rotate-180" />
          </summary>
          <div className="border-t px-1 py-4">
            <DocNav current={route} groups={groups} />
          </div>
        </details>

        <article className="doc" lang={langOf(file) ?? undefined}>
          {content}
        </article>

        <footer className="mt-16 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-5 text-muted-foreground text-xs">
          <a
            className="inline-flex items-center gap-1.5 hover:text-foreground"
            href={sourceUrl(file)}
            rel="noopener"
          >
            <FileCodeIcon className="size-3.5" />
            {label.source}: <span className="font-mono">{file}</span>
          </a>
          {twinRoute ? (
            <Link className="hover:text-foreground" href={twinRoute}>
              {label.other} →
            </Link>
          ) : null}
        </footer>
      </main>

      {toc.length > 1 ? (
        <aside className="hidden xl:block">
          <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-10">
            <span className={cn(SECTION_LABEL, "mb-3 block")}>
              {label.onPage}
            </span>
            <ul className="flex flex-col gap-1.5 border-l text-[12.5px] leading-snug">
              {toc.map((entry) => (
                <li key={entry.id}>
                  <a
                    className={cn(
                      "-ml-px block border-transparent border-l pl-3 text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                      entry.depth === 3 && "pl-6"
                    )}
                    href={`#${entry.id}`}
                  >
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
