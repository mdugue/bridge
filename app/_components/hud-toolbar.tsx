"use client";

import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "cn";

/** localStorage key of the minimised state — a per-viewer convenience. */
const COLLAPSED_KEY = "hud-toolbar-collapsed";

export interface HudTool {
  /** a spinner instead of the icon while it works */
  busy?: boolean;
  icon: LucideIcon;
  id: string;
  /** the visible word under the icon — and the button's accessible name */
  label: string;
  onClick: () => void;
  /** a toggle's state; omit for a plain action */
  pressed?: boolean;
  /** the longer explanation on hover */
  title: string;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode / blocked storage: it just isn't remembered.
  }
}

/**
 * The scene's floating tools (locate, live, walk/fly) as ONE labelled
 * vertical group rather than a stack of loose round buttons: each shows a
 * word under its icon, so none relies on an icon alone. It folds away into
 * a single small button; while folded, a dot on it says a toggle is on
 * (live mode keeps running behind it).
 */
export function HudToolbar({ tools }: { tools: HudTool[] }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  if (tools.length === 0) {
    return null;
  }
  const fold = (next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
  };
  if (collapsed) {
    const active = tools.some((t) => t.pressed);
    return (
      <button
        aria-label="Werkzeuge zeigen"
        className="relative flex size-12 items-center justify-center rounded-full border border-white/30 bg-black/25 text-white/80 backdrop-blur-sm"
        onClick={() => fold(false)}
        title="Werkzeuge zeigen"
        type="button"
      >
        <EllipsisVerticalIcon className="size-4" />
        {active && (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-emerald-300"
          />
        )}
      </button>
    );
  }
  return (
    <div
      aria-label="Werkzeuge"
      aria-orientation="vertical"
      className="flex w-12 flex-col items-center gap-0.5 rounded-full border border-white/30 bg-black/25 py-1 text-white/80 backdrop-blur-sm"
      role="toolbar"
    >
      {tools.map((tool) => {
        const Icon = tool.busy ? LoaderCircleIcon : tool.icon;
        return (
          <button
            aria-busy={tool.busy}
            aria-pressed={tool.pressed}
            className={cn(
              "flex w-10 flex-col items-center gap-0.5 rounded-full py-2 text-[9px] leading-none",
              tool.pressed ? "bg-white/70 text-black" : "hover:bg-white/10"
            )}
            key={tool.id}
            onClick={tool.onClick}
            title={tool.title}
            type="button"
          >
            <Icon className={cn("size-4", tool.busy && "animate-spin")} />
            {tool.label}
          </button>
        );
      })}
      <button
        aria-label="Werkzeuge einklappen"
        className="flex h-5 w-10 items-center justify-center rounded-full text-white/60 hover:bg-white/10"
        onClick={() => fold(true)}
        title="Werkzeuge einklappen"
        type="button"
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
    </div>
  );
}
