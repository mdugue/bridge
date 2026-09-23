"use client";

import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * The sidebar's three-way segmented control — Erkunden · Szene · Erweitert.
 *
 * Built on the base-ui Tabs primitive rather than a vendored shadcn component:
 * the registry has no tabs entry for this project's style, and hand-writing one
 * into `components/ui/` would break the "regenerate, never hand-edit" rule. The
 * look is the shadcn segmented control — a muted track, the active tab a raised
 * white pill — and the a11y (tablist / tab / tabpanel, arrow-key roving focus)
 * comes from the primitive.
 */

export type SceneTabId = "erkunden" | "erweitert" | "szene";

const TABS: { id: SceneTabId; label: string }[] = [
  { id: "erkunden", label: "Erkunden" },
  { id: "szene", label: "Szene" },
  { id: "erweitert", label: "Erweitert" },
];

export function SceneTabs({
  children,
  onValueChange,
  value,
}: {
  /** one <SceneTabPanel> per tab */
  children: ReactNode;
  onValueChange: (value: SceneTabId) => void;
  value: SceneTabId;
}) {
  return (
    <Tabs.Root
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={(next) => onValueChange(next as SceneTabId)}
      value={value}
    >
      <div className="px-3 pb-2.5">
        <Tabs.List className="grid grid-cols-3 gap-0.75 rounded-lg bg-muted p-0.75">
          {TABS.map((tab) => (
            <Tabs.Tab
              className={cn(
                "h-7.5 rounded-md font-medium text-muted-foreground text-xs transition-colors",
                "hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1",
                // base-ui marks the selected tab with `data-active`, the same
                // hook the vendored sidebar primitives style against.
                "data-active:bg-background data-active:text-foreground data-active:shadow-sm"
              )}
              key={tab.id}
              value={tab.id}
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </div>
      {children}
    </Tabs.Root>
  );
}

/** One tab's content, scrolling on its own inside the sidebar. */
export function SceneTabPanel({
  children,
  value,
}: {
  children: ReactNode;
  value: SceneTabId;
}) {
  return (
    <Tabs.Panel
      className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-auto focus-visible:outline-none"
      value={value}
    >
      {children}
    </Tabs.Panel>
  );
}
