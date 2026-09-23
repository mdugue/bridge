import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  FileCodeIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { descriptionOf } from "@/lib/docs/content";
import {
  type Lang,
  langOf,
  routeOf,
  segmentsOf,
  sourceUrl,
  twinOf,
} from "@/lib/docs/routes";
import { cn } from "cn";
import { docIcon } from "../_components/doc-icon";
import { DocNav, SECTION_LABEL } from "../_components/doc-nav";
import { Landing, type LandingEntry } from "../_components/landing";
import {
  descriptionFor,
  fileAt,
  type HeroImage,
  heroImage,
  nav,
  neighbours,
  pageFiles,
  readDoc,
  titleFor,
} from "../_lib/docs";
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
  Record<
    "contents" | "onPage" | "source" | "other" | "pager" | "prev" | "next",
    string
  >
> = {
  de: {
    contents: "Inhalt",
    onPage: "Auf dieser Seite",
    source: "Quelle auf GitHub",
    other: "English version",
    pager: "Weiterlesen",
    prev: "Zurück",
    next: "Weiter",
  },
  en: {
    contents: "Contents",
    onPage: "On this page",
    source: "Source on GitHub",
    other: "Deutsche Fassung",
    pager: "Continue reading",
    prev: "Previous",
    next: "Next",
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
  return routeOf(file) === "/wissen" ? <Entry /> : <DocPage file={file} />;
}

/** /wissen: the landing, built from the menu so it lists what the site has. */
async function Entry() {
  "use cache";
  const groups = nav();
  const pages = new Set(pageFiles());
  const entry = (file: string, href: string, title: string): LandingEntry => {
    const twin = twinOf(file);
    const twinRoute = twin && pages.has(twin.file) ? routeOf(twin.file) : null;
    return {
      file,
      href,
      title,
      description: descriptionFor(file),
      twin: twinRoute ? { href: twinRoute, label: "English" } : null,
    };
  };
  const guide = groups.find((g) => g.id === "de")?.items ?? [];
  const developer = groups.find((g) => g.id === "dev")?.items ?? [];
  return (
    <Landing
      developer={developer.map((i) => ({
        ...entry(i.file, i.href, i.title),
        twin: null,
      }))}
      guide={guide.map((i) => entry(i.file, i.href, i.title))}
      hero={heroImage()}
    />
  );
}

/**
 * Spots of the map worth a strip (x% y% of the block), picked by eye on the
 * baked picture: the river, the meadows along it, the green valley in the
 * north-east, the rail yards. A bare stretch of sand says nothing.
 */
const FOCUS = [
  "34% 72%",
  "12% 42%",
  "84% 24%",
  "50% 46%",
  "86% 64%",
  "62% 84%",
];

/** A narrow strip of the city map above a page, a different place per page. */
function Cover({
  file,
  hero,
  kicker,
}: {
  file: string;
  hero: HeroImage | null;
  kicker: string;
}) {
  let hash = 0;
  for (const c of file) {
    hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  }
  const position = FOCUS[hash % FOCUS.length];
  return (
    <div className="relative isolate mb-10 flex h-28 items-end overflow-hidden rounded-xl ring-1 ring-foreground/10 sm:h-32">
      {hero ? (
        <Image
          alt=""
          className="-z-20 scale-[1.6] object-cover"
          fill
          sizes="(min-width: 1024px) 48rem, 100vw"
          src={hero.src}
          style={{ objectPosition: position, transformOrigin: position }}
        />
      ) : null}
      <div className="wissen-cover-veil absolute inset-0 -z-10" />
      <div className="flex items-center gap-2.5 p-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-background/85 text-primary ring-1 ring-foreground/10 backdrop-blur">
          {docIcon(file, { className: "size-4" })}
        </span>
        <span className={cn(SECTION_LABEL, "text-foreground/70")}>
          {kicker}
        </span>
      </div>
    </div>
  );
}

/** One end of the pager: the neighbouring page as a card, whole card the link. */
function PagerCard({
  direction,
  href,
  label,
  title,
}: {
  direction: "prev" | "next";
  href: string;
  label: string;
  title: string;
}) {
  const next = direction === "next";
  return (
    <Card
      className="group/pager relative transition-shadow hover:shadow-md hover:ring-primary/30"
      size="sm"
    >
      <CardHeader className={cn(next && "justify-items-end text-right")}>
        <CardDescription className="flex items-center gap-1.5">
          {next ? (
            <>
              {label}
              <ArrowRightIcon className="size-3.5 transition-transform group-hover/pager:translate-x-0.5" />
            </>
          ) : (
            <>
              <ArrowLeftIcon className="size-3.5 transition-transform group-hover/pager:-translate-x-0.5" />
              {label}
            </>
          )}
        </CardDescription>
        <CardTitle>
          <Link className="after:absolute after:inset-0" href={href}>
            {title}
          </Link>
        </CardTitle>
      </CardHeader>
    </Card>
  );
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
  const place = neighbours(file);
  const kicker = place
    ? place.group.id === "dev"
      ? place.group.label
      : `${place.group.label} · ${place.index + 1} / ${place.count}`
    : "Wissen";

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

        <Cover file={file} hero={heroImage()} kicker={kicker} />

        <article
          className="typeset typeset-wissen"
          lang={langOf(file) ?? undefined}
        >
          {content}
        </article>

        {place && (place.prev || place.next) ? (
          <nav
            aria-label={label.pager}
            className="mt-16 grid gap-3 sm:grid-cols-2"
          >
            {place.prev ? (
              <PagerCard
                direction="prev"
                href={place.prev.href}
                label={label.prev}
                title={place.prev.title}
              />
            ) : (
              <span />
            )}
            {place.next ? (
              <PagerCard
                direction="next"
                href={place.next.href}
                label={label.next}
                title={place.next.title}
              />
            ) : null}
          </nav>
        ) : null}

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
