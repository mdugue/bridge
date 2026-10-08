import { cn } from "cn";
import { METHOD_ORDER, METHODS, type Method } from "@/lib/city/methods";

/** Each method's colours: solid for the deterministic two, dashed for the
 *  inferred two, so the family reads without the colour. */
const TONE: Record<Method, string> = {
  taken: "border-slate-300 bg-slate-50 text-slate-600",
  computed: "border-teal-300 bg-teal-50 text-teal-800",
  detected: "border-dashed border-amber-400 bg-amber-50 text-amber-800",
  assumed: "border-dashed border-violet-300 bg-violet-50 text-violet-700",
};

/** The badge saying how the viewer came by a statement (lib/city/methods.ts). */
export function MethodBadge({
  method,
  className,
}: {
  method: Method;
  className?: string;
}) {
  const info = METHODS[method];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[9px] leading-tight font-semibold tracking-[0.02em] whitespace-nowrap",
        TONE[method],
        className
      )}
      data-method={method}
      title={`${info.label}: ${info.meaning}`}
    >
      <span aria-hidden className="text-[9.5px] font-bold">
        {info.glyph}
      </span>
      {info.label}
    </span>
  );
}

/** The glyph alone, after a fact the viewer inferred (detected or assumed). */
export function MethodMark({ method }: { method: Method }) {
  const info = METHODS[method];
  return (
    <span
      className={cn(
        "ml-1.5 text-[11px] font-bold",
        method === "detected" ? "text-amber-600" : "text-violet-600"
      )}
      data-method={method}
      title={`${info.label}: ${info.meaning}`}
    >
      <span aria-hidden>{info.glyph}</span>
      <span className="sr-only">({info.label})</span>
    </span>
  );
}

/** The four badges and what they mean, deterministic first. */
export function MethodLegend() {
  return (
    <dl className="space-y-1.5 text-[10.5px] leading-snug text-muted-foreground">
      {METHOD_ORDER.map((method) => (
        <div className="flex items-start gap-2" key={method}>
          <dt className="w-[5.5rem] shrink-0">
            <MethodBadge method={method} />
          </dt>
          <dd>{METHODS[method].meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
