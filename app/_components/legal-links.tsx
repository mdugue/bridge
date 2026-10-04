import Link from "next/link";
import { cn } from "cn";

const LINK = "underline underline-offset-2 hover:text-foreground";

/**
 * The way to /impressum and /datenschutz, in every page's footer and the
 * viewer's sidebar (ADR 0045): an Impressum must be reachable from
 * everywhere, in a click or two. From the viewer they open in a new tab,
 * so the walk is still there to come back to.
 */
export function LegalLinks({
  className,
  newTab = false,
}: {
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
    </nav>
  );
}
