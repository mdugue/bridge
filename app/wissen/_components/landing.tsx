import { ArrowRightIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { HeroImage } from "../_lib/docs";
import { docIcon } from "./doc-icon";
import { SECTION_LABEL } from "./doc-nav";
import { landcoverCredit } from "@/lib/city/site";
import { currentSite } from "@/sites";

export interface LandingEntry {
  file: string;
  href: string;
  title: string;
  description: string | null;
  twin?: { href: string; label: string } | null;
}

/**
 * The entry of /wissen: the city as the viewer paints its ground, then the
 * guide and the developer docs as cards. Titles and descriptions are read
 * from the pages themselves (lib/docs/content.ts); only the lead is written
 * here.
 */
export function Landing({
  developer,
  guide,
  hero,
}: {
  developer: LandingEntry[];
  guide: LandingEntry[];
  hero: HeroImage | null;
}) {
  const first = guide[0];
  return (
    <main className="flex-1">
      <section className="relative isolate overflow-hidden border-b">
        {hero ? (
          <Image
            alt=""
            className="-z-20 object-cover object-[50%_68%]"
            fill
            priority
            sizes="100vw"
            src={hero.src}
          />
        ) : null}
        <div className="wissen-hero-veil absolute inset-0 -z-10" />
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <p className={cn(SECTION_LABEL, "text-primary")}>Wissen</p>
          <h1 className="mt-4 max-w-2xl text-balance font-heading font-semibold text-4xl leading-[1.1] tracking-tight sm:text-5xl">
            Wie aus offenen Geodaten ein begehbares {currentSite().name} wird
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-base text-foreground/75 leading-relaxed sm:text-lg">
            Alles, was du im Viewer siehst, ist aus offenen Daten abgeleitet:
            von der Landesvermessung und von OpenStreetMap. Hier steht, woher
            sie kommen, wie sie zu einer Szene werden und wie viel davon echt
            ist.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {first ? (
              <Link
                className={buttonVariants({
                  size: "lg",
                  className: "h-9 px-3.5 text-sm",
                })}
                href={first.href}
              >
                Leitfaden lesen
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            ) : null}
            <Link
              className={buttonVariants({
                size: "lg",
                variant: "outline",
                className: "h-9 bg-background/70 px-3.5 text-sm backdrop-blur",
              })}
              href="/"
            >
              Zum Stadtspaziergang
            </Link>
          </div>
        </div>
        {hero ? (
          <p className="absolute right-4 bottom-2.5 max-w-[60%] text-right text-[10px] text-foreground/55 leading-snug">
            Im Hintergrund: die Landnutzung, mit der der Viewer den Boden
            einfärbt · {landcoverCredit(currentSite())}
          </p>
        ) : null}
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={SECTION_LABEL}>Leitfaden</p>
            <h2 className="mt-3 font-heading font-semibold text-2xl tracking-tight">
              Ohne Vorwissen in Geodaten oder 3D-Grafik
            </h2>
          </div>
          <p className="text-muted-foreground text-sm">
            Jede Seite gibt es auch auf Englisch.
          </p>
        </div>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guide.map((entry, i) => (
            <li key={entry.file}>
              <EntryCard entry={entry} number={i + 1} />
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t bg-background/60">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:py-20">
          <p className={SECTION_LABEL}>Entwicklung · English</p>
          <h2 className="mt-3 font-heading font-semibold text-2xl tracking-tight">
            Wie es gebaut ist
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Die Dokumentation für alle, die am Projekt arbeiten: Datenpipeline,
            Rendering, jede Transformation mit ihrem Status und die
            Architekturentscheidungen.
          </p>
          <ul className="mt-8 grid gap-x-8 gap-y-1 md:grid-cols-2">
            {developer.map((entry) => (
              <li key={entry.file}>
                <DevRow entry={entry} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

function EntryCard({ entry, number }: { entry: LandingEntry; number: number }) {
  return (
    <Card className="group/entry relative h-full transition-shadow hover:shadow-md hover:ring-primary/30">
      <CardHeader>
        <CardTitle className="font-heading text-base leading-snug">
          {/* Stretched over the card, so the whole card is the link. */}
          <Link className="after:absolute after:inset-0" href={entry.href}>
            {entry.title}
          </Link>
        </CardTitle>
        {entry.description ? (
          <CardDescription className="line-clamp-3">
            {entry.description}
          </CardDescription>
        ) : null}
        <CardAction className="flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary">
          {docIcon(entry.file, { className: "size-4.5" })}
        </CardAction>
      </CardHeader>
      <CardFooter className="mt-auto justify-between gap-3">
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-muted-foreground tabular-nums">
            {String(number).padStart(2, "0")}
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            Lesen
            <ArrowRightIcon className="size-3.5 transition-transform group-hover/entry:translate-x-0.5" />
          </span>
        </span>
        {entry.twin ? (
          <Link
            className="relative z-10 text-muted-foreground hover:text-foreground"
            href={entry.twin.href}
            lang="en"
          >
            {entry.twin.label}
          </Link>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function DevRow({ entry }: { entry: LandingEntry }) {
  return (
    <Link
      className="group/dev -mx-3 flex gap-3 rounded-lg px-3 py-3 hover:bg-card hover:ring-1 hover:ring-foreground/10"
      href={entry.href}
      lang="en"
    >
      {docIcon(entry.file, {
        className:
          "mt-0.5 size-4 shrink-0 text-muted-foreground group-hover/dev:text-primary",
      })}
      <span className="min-w-0">
        <span className="block font-medium text-sm">{entry.title}</span>
        {entry.description ? (
          <span className="mt-0.5 line-clamp-2 block text-muted-foreground text-xs leading-relaxed">
            {entry.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
