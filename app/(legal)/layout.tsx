import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { LegalLinks } from "../_components/legal-links";
import "../wissen/wissen.css";

/**
 * /impressum and /datenschutz (ADR 0045): plain documents on the Wissen
 * pages' paper and type, with the way back to the cities.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-(--wissen-paper)">
      <header className="sticky top-0 z-20 border-b bg-(--wissen-paper)/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2.5 px-4">
          <Link
            className="flex items-center gap-2.5 whitespace-nowrap font-semibold text-sm"
            href="/"
          >
            <span
              aria-hidden
              className="size-3 rotate-45 rounded-xs border-2 border-primary"
            />
            City Walk
          </Link>
          <Link
            className={buttonVariants({
              className: "ml-auto",
              size: "lg",
              variant: "outline",
            })}
            href="/"
          >
            <span className="hidden sm:inline">Zum Stadtspaziergang</span>
            <span className="sm:hidden">Städte</span>
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <article className="typeset typeset-wissen">{children}</article>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-6 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <Link
            className="underline underline-offset-2 hover:text-foreground"
            href="/wissen"
          >
            Wissen: wie die Städte entstehen
          </Link>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}
