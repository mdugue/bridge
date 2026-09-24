import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import "./wissen.css";
import { currentSite } from "@/sites";

/**
 * The knowledge base on the site: docs/ rendered as pages (ADR 0021). A plain
 * scrolling document with the viewer's type, colours and small caps labels –
 * no canvas, no HUD.
 */
export default function WissenLayout({ children }: { children: ReactNode }) {
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
            City Walk {currentSite().name}
          </Link>
          <span aria-hidden className="text-muted-foreground/60">
            /
          </span>
          <Link
            className="font-medium text-sm hover:text-primary"
            href="/wissen"
          >
            Wissen
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
            <span className="sm:hidden">Viewer</span>
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
