"use client";

import { ArrowRightIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { cn } from "cn";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { landcoverCredit, type Site } from "@/lib/city/site";
import {
  orderingOf,
  orderSites,
  SITE_ORDERINGS,
  type SiteOrder,
  type SiteStats,
} from "@/lib/city/site-stats";
import { REFERENCE_SITE, siteById } from "@/sites";
import { SMALL_CAPS } from "../_lib/start-style";

/** A built city as the start page gets it from the index (sites.json). */
interface CityEntry {
  map?: string;
  site: Site;
  stats?: SiteStats;
}

/** "Dresden · Altstadt" → "Altstadt": the part of the label the name lacks. */
function districtOf(site: Site): string | null {
  const [, district] = site.label.split(" · ");
  return district ?? null;
}

/** The area the site's tiles cover (each tile is 2 × 2 km). */
function areaOf(site: Site): string {
  return `${site.tiles.length * 4} km²`;
}

function CityCard({
  built,
  figure,
  first,
}: {
  built: CityEntry;
  /** the figure the chosen ordering ranks by, when it has one */
  figure?: string;
  first: boolean;
}) {
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
          {figure ? (
            <span className="absolute right-3 bottom-3 left-3 w-fit rounded-xl bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm shadow-md">
              {figure}
            </span>
          ) : null}
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
 * The start page's cities, in an order the visitor picks: featured (the
 * reference site first — the best kept — then by name), or by a figure the
 * build measured for every city alike (lib/city/site-stats.ts) — the most
 * trees, the most water, the tallest houses … The chosen figure shows on
 * each card. Orderings no city has figures for are not offered.
 */
export function CityGrid({
  cities,
}: {
  cities: readonly { id: string; map?: string; stats?: SiteStats }[];
}) {
  const [order, setOrder] = useState<SiteOrder>("featured");
  const entries = cities.flatMap(({ id, map, stats }) => {
    const site = siteById(id);
    return site ? [{ id, map, name: site.name, site, stats }] : [];
  });
  const measured = entries.some((e) => e.stats);
  const ordering = orderingOf(order);
  const shown = orderSites(entries, order, REFERENCE_SITE);
  return (
    <>
      {measured && entries.length > 1 ? (
        <div className="-mx-4 mb-5 flex items-center gap-3 overflow-x-auto px-4 pb-1">
          <span
            className={cn(SMALL_CAPS, "shrink-0 text-muted-foreground")}
            id="city-order"
          >
            Sortieren
          </span>
          <ToggleGroup
            aria-labelledby="city-order"
            onValueChange={(value: string[]) => {
              const [next] = value;
              if (next) {
                setOrder(next as SiteOrder);
              }
            }}
            size="sm"
            spacing={1}
            value={[order]}
            variant="outline"
          >
            {SITE_ORDERINGS.map((o) => (
              <ToggleGroupItem
                className="shrink-0 rounded-full px-3 data-[pressed]:bg-primary data-[pressed]:text-primary-foreground"
                key={o.id}
                value={o.id}
              >
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((b, i) => (
          <CityCard
            built={b}
            figure={b.stats ? ordering.figure?.(b.stats) : undefined}
            first={i < 3}
            key={b.site.id}
          />
        ))}
      </ul>
    </>
  );
}
