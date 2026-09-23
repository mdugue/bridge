"use client";

import { Maximize2Icon, MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Lang } from "@/lib/docs/routes";

const LABEL: Record<
  Lang,
  {
    open: string;
    fit: string;
    actual: string;
    zoomIn: string;
    zoomOut: string;
    hint: string;
    fallback: string;
  }
> = {
  de: {
    open: "Vergrößern",
    fit: "Einpassen",
    actual: "Originalgröße",
    zoomIn: "Vergrößern",
    zoomOut: "Verkleinern",
    hint: "Ziehen oder scrollen, um das Diagramm zu verschieben.",
    fallback: "Diagramm",
  },
  en: {
    open: "Enlarge",
    fit: "Fit",
    actual: "Actual size",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    hint: "Drag or scroll to move around the diagram.",
    fallback: "Diagram",
  },
};

const STEP = 1.25;
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * A prerendered diagram (the SVG arrives in the HTML). In the text it is
 * fitted to the column; when that shrinks it, a click opens it in a dialog
 * at a size of the reader's choosing, panned by scrolling or dragging.
 */
export function Diagram({
  children,
  height,
  lang,
  title,
  width,
}: {
  children: ReactNode;
  height: number;
  lang: Lang;
  title: string | null;
  width: number;
}) {
  const t = LABEL[lang];
  const figure = useRef<HTMLElement>(null);
  const [shrunk, setShrunk] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = figure.current;
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
    <figure
      className="diagram"
      data-not-typeset
      data-shrunk={shrunk || undefined}
      ref={figure}
    >
      <div className="diagram-canvas">{children}</div>
      {shrunk ? (
        // Stretched over the whole figure (see .diagram-open::after), so a
        // click anywhere on the drawing opens it; one real button for the
        // keyboard and screen readers.
        <Button
          aria-label={`${title ?? t.fallback}: ${t.open}`}
          className="diagram-open"
          onClick={() => setOpen(true)}
          size="sm"
          variant="outline"
        >
          <Maximize2Icon data-icon="inline-start" />
          {t.open}
        </Button>
      ) : null}
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="diagram-dialog flex h-[88dvh] w-[96vw] max-w-[min(96vw,1500px)] flex-col gap-0 p-0 sm:max-w-[min(96vw,1500px)]">
          {open ? (
            <ZoomView height={height} labels={t} title={title} width={width}>
              {children}
            </ZoomView>
          ) : null}
        </DialogContent>
      </Dialog>
    </figure>
  );
}

function ZoomView({
  children,
  height,
  labels: t,
  title,
  width,
}: {
  children: ReactNode;
  height: number;
  labels: (typeof LABEL)[Lang];
  title: string | null;
  width: number;
}) {
  const stage = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [scale, setScale] = useState<number | null>(null);

  /** Along each axis, the scale at which the diagram just fits the stage. */
  const fits = (el: HTMLElement | null) => {
    const pad = 48;
    return el
      ? {
          x: (el.clientWidth - pad) / width,
          y: (el.clientHeight - pad) / height,
        }
      : { x: 1, y: 1 };
  };
  /** The whole diagram in view. */
  const fitScale = (el: HTMLElement | null) => {
    const f = fits(el);
    return clamp(Math.min(1, f.x, f.y));
  };
  /**
   * Where the dialog opens: the whole diagram if it is still legible that
   * way, otherwise fitted along its better axis (at most 80 %) and scrolled
   * along the other – a wide strip on a phone reads, a tall column too.
   */
  const openingScale = (el: HTMLElement | null) => {
    const f = fits(el);
    return clamp(Math.max(fitScale(el), Math.min(0.8, Math.max(f.x, f.y))));
  };

  const attachStage = (el: HTMLDivElement | null) => {
    stage.current = el;
    if (el && scale === null) {
      setScale(openingScale(el));
    }
  };

  const zoomTo = (next: number) => {
    const el = stage.current;
    const prev = scale ?? 1;
    const s = clamp(next);
    setScale(s);
    if (!el) {
      return;
    }
    // Keep the centre of the view where it was.
    const cx = (el.scrollLeft + el.clientWidth / 2) / prev;
    const cy = (el.scrollTop + el.clientHeight / 2) / prev;
    requestAnimationFrame(() => {
      el.scrollLeft = cx * s - el.clientWidth / 2;
      el.scrollTop = cy * s - el.clientHeight / 2;
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el || e.pointerType !== "mouse") {
      return; // touch scrolls natively
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    const d = drag.current;
    if (!(el && d)) {
      return;
    }
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const style = {
    "--diagram-zoom-width": `${width * (scale ?? 1)}px`,
  } as CSSProperties;

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 border-b py-2.5 pr-12 pl-4">
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-sm">
            {title ?? t.fallback}
          </DialogTitle>
          <DialogDescription className="hidden sm:block">
            {t.hint}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button
            aria-label={t.zoomOut}
            onClick={() => zoomTo((scale ?? 1) / STEP)}
            size="icon-sm"
            variant="ghost"
          >
            <MinusIcon />
          </Button>
          <Button
            className="min-w-14 font-mono tabular-nums"
            onClick={() => zoomTo(1)}
            size="sm"
            title={t.actual}
            variant="ghost"
          >
            {Math.round((scale ?? 1) * 100)} %
          </Button>
          <Button
            aria-label={t.zoomIn}
            onClick={() => zoomTo((scale ?? 1) * STEP)}
            size="icon-sm"
            variant="ghost"
          >
            <PlusIcon />
          </Button>
          <Button
            onClick={() => zoomTo(fitScale(stage.current))}
            size="sm"
            variant="outline"
          >
            <ScanIcon data-icon="inline-start" />
            {t.fit}
          </Button>
        </div>
      </DialogHeader>
      <div
        className="diagram-stage"
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={attachStage}
        style={style}
      >
        <div
          className="diagram-stage-inner"
          data-ready={scale !== null || undefined}
        >
          {children}
        </div>
      </div>
    </>
  );
}
