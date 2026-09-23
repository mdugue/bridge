"use client";

import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/docs/routes";

const LABEL: Record<Lang, { grow: string; fit: string }> = {
  de: { grow: "Volle Größe", fit: "Einpassen" },
  en: { grow: "Full size", fit: "Fit" },
};

/**
 * A prerendered diagram (the SVG arrives in the HTML). It is fitted to the
 * column; when that shrinks it, a button shows it at its drawn size inside a
 * box that scrolls sideways. The only script on a /wissen page.
 */
export function Diagram({
  children,
  lang,
  width,
}: {
  children: ReactNode;
  lang: Lang;
  width: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shrunk, setShrunk] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => setShrunk(width > el.clientWidth - 32);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  return (
    <figure className="diagram" data-full={full || undefined} ref={ref}>
      <div className="diagram-canvas">{children}</div>
      {shrunk || full ? (
        <button
          className="diagram-zoom"
          onClick={() => setFull((f) => !f)}
          type="button"
        >
          {full ? (
            <Minimize2Icon aria-hidden className="size-3" />
          ) : (
            <Maximize2Icon aria-hidden className="size-3" />
          )}
          {full ? LABEL[lang].fit : LABEL[lang].grow}
        </button>
      ) : null}
    </figure>
  );
}
