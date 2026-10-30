import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";

const LINK = "underline underline-offset-2 hover:text-foreground";

/**
 * The way to /impressum and /datenschutz, in every page's footer and the
 * viewer's sidebar (ADR 0043): an Impressum must be reachable from
 * everywhere, in a click or two. From the viewer they open in a new tab,
 * so the walk is still there to come back to. `children` are further
 * links the place puts in the same row (the sidebar's Wissen).
 */
export function LegalLinks({
  children,
  className,
  newTab = false,
}: {
  children?: ReactNode;
  className?: string;
  newTab?: boolean;
}) {
  const target = newTab ? { rel: "noopener", target: "_blank" } : {};
  return (
    <nav aria-label="Rechtliches" className={cn("flex gap-3", className)}>
      <Link className={LINK} href="/impressum" {...target}>
        Impressum
      </Link>
      <Link className={LINK} href="/datenschutz" {...target}>
        Datenschutz
      </Link>
      {children}
    </nav>
  );
}
