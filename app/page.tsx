import { ArrowRightIcon, BookOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { landcoverCredit, type Site } from "@/lib/city/site";
import { SITES } from "@/sites";
import { type BuiltSite, builtSites } from "./_lib/built-sites";
import "./start.css";

export const metadata: Metadata = {
  title: "City Walk — Städte zum Durchlaufen",
  description:
    "Deutsche Städte als begehbare 3D-Modelle aus offenen Geodaten: Gelände, Gebäude, Bäume, Sonne und Schatten, direkt im Browser.",
  alternates: { canonical: "/" },
};

const SMALL_CAPS =
  "font-medium text-[11px] uppercase leading-none tracking-widest";

/** "Dresden · Altstadt" → "Altstadt": the part of the label the name lacks. */
function districtOf(site: Site): string | null {
  const [, district] = site.label.split(" · ");
  return district ?? null;
}

/** The area the site's tiles cover (each tile is 2 × 2 km). */
function areaOf(site: Site): string {
  return `${site.tiles.length * 4} km²`;
}

function CityCard({ built, first }: { built: BuiltSite; first: boolean }) {
  const { site, map } = built;
  const district = districtOf(site);
  return (
    <li>
      <Link
        className="group flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-xs outline-none transition-[box-shadow,translate] duration-300 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/${site.id}`}
      >
        <div className="relative aspect-[4/3] overflow-hidden border-b bg-muted">
          {map ? (
            <Image
              alt={`Landnutzung von ${site.name}, so wie der Viewer den Boden einfärbt`}
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              fill
              priority={first}
              sizes="(min-width: 1280px) 400px, (min-width: 640px) 50vw, 100vw"
              src={map}
            />
          ) : (
            <div className="start-card-blank absolute inset-0" />
          )}
          <span
            className={cn(
              SMALL_CAPS,
              "absolute top-3 left-3 rounded-full bg-background/85 px-2.5 py-1.5 text-foreground/80 backdrop-blur"
            )}
          >
            {site.provider.land}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div>
            <h2 className="font-heading font-semibold text-2xl tracking-tight">
              {site.name}
            </h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              {[district, areaOf(site), `${site.viewpoints.length} Aussichten`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {site.viewpoints.slice(0, 3).map((view) => (
              <li
                className="rounded-full bg-muted px-2.5 py-1 text-foreground/75 text-xs"
                key={view.id}
              >
                {view.label}
              </li>
            ))}
          </ul>
          <div className="mt-auto flex items-end justify-between gap-3 pt-2">
            <span className="text-[10px] text-muted-foreground/80 leading-snug">
              Karte: {landcoverCredit(site)}
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-primary text-sm">
              Losgehen
              <ArrowRightIcon className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * The start page: every city this deployment serves (the ones whose data the
 * build prepared, public/data/sites.json), each as its ground map — the land
 * cover in the viewer's palette — leading to its route.
 */
export default function StartPage() {
  const built = builtSites();
  const servedIds = new Set(built.map((b) => b.site.id));
  const coming = Object.values(SITES).filter((s) => !servedIds.has(s.id));
  const backdrop = built.find((b) => b.map)?.map;
  return (
    <div className="start-paper flex min-h-dvh flex-col">
      <header className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2.5 px-4">
        <span
          aria-hidden
          className="size-3 rotate-45 rounded-xs border-2 border-primary"
        />
        <span className="font-semibold text-sm">City Walk</span>
        <Link
          className={buttonVariants({
            className: "ml-auto",
            size: "sm",
            variant: "ghost",
          })}
          href="/wissen"
        >
          <BookOpenIcon data-icon="inline-start" />
          Wissen
        </Link>
      </header>

      <main className="flex-1">
        <section className="relative isolate overflow-hidden">
          {backdrop ? (
            <Image
              alt=""
              className="start-hero-map -z-20 object-cover"
              fill
              sizes="100vw"
              src={backdrop}
            />
          ) : null}
          <div className="start-hero-veil absolute inset-0 -z-10" />
          <div className="mx-auto max-w-7xl px-4 pt-14 pb-14 sm:pt-24 sm:pb-20">
            <p className={cn(SMALL_CAPS, "text-primary")}>
              {built.length === 1 ? "Eine Stadt" : `${built.length} Städte`} zum
              Durchlaufen
            </p>
            <h1 className="mt-4 max-w-3xl text-balance font-heading font-semibold text-4xl leading-[1.05] tracking-tight sm:text-6xl">
              Geh durch eine Stadt, die aus offenen Daten gebaut ist
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-base text-foreground/75 leading-relaxed sm:text-lg">
              Gelände, Gebäude, Bäume, Laternen und Bänke – aus den Geodaten der
              Landesvermessung und von OpenStreetMap, in Pastell, mit echter
              Sonne und echten Schatten. Wähle eine Stadt und geh los, oder
              flieg darüber.
            </p>
          </div>
        </section>

        <section
          aria-label="Städte"
          className="mx-auto max-w-7xl px-4 pb-16 sm:pb-24"
        >
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {built.map((b, i) => (
              <CityCard built={b} first={i < 3} key={b.site.id} />
            ))}
          </ul>
          {coming.length > 0 ? (
            <p className="mt-8 text-muted-foreground text-sm">
              In Vorbereitung: {coming.map((s) => s.name).join(", ")}.
            </p>
          ) : null}
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            Geodaten der Länder (u. a. dl-de/by-2-0) und © OpenStreetMap
            contributors (ODbL) – die Quellen jeder Stadt stehen im Viewer.
          </p>
          <Link
            className="underline underline-offset-2 hover:text-foreground"
            href="/wissen"
          >
            Wie die Städte entstehen
          </Link>
        </div>
      </footer>
    </div>
  );
}
