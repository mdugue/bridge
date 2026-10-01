import { BookOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { SITES } from "@/sites";
import { builtSites } from "./_lib/built-sites";
import { CityGrid } from "./_components/city-grid";
import { SMALL_CAPS } from "./_lib/start-style";
import "./start.css";

export const metadata: Metadata = {
  title: "City Walk — Städte zum Durchlaufen",
  description:
    "Deutsche Städte als begehbare 3D-Modelle aus offenen Geodaten: Gelände, Gebäude, Bäume, Sonne und Schatten, direkt im Browser.",
  alternates: { canonical: "/" },
};

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
          <CityGrid
            cities={built.map((b) => ({
              id: b.site.id,
              map: b.map,
              stats: b.stats,
            }))}
          />
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
