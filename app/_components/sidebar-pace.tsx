"use client";

import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import type { FramePace } from "@/lib/city/frame-pace";

/**
 * Tells the render loop's pace (lib/city/frame-pace.ts) when the phone's
 * sidebar covers the scene and when it scrolls. On a desktop the panel
 * floats beside the scene and the pace stays out of it.
 *
 * The scroll is read on the document in the capture phase (a scroll event
 * does not bubble), passive, from any scroller inside the sidebar: the tab
 * panels scroll on their own, and a momentum scroll keeps firing.
 */
export function SidebarPace({ pace }: { pace: FramePace }) {
  const { isMobile, openMobile } = useSidebar();
  const covered = isMobile && openMobile;
  useEffect(() => {
    pace.setCovered(covered);
    if (!covered) {
      return;
    }
    const onScroll = (e: Event) => {
      if (
        e.target instanceof Element &&
        e.target.closest("[data-sidebar=sidebar]")
      ) {
        pace.noteScroll(performance.now());
      }
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      pace.setCovered(false);
    };
  }, [covered, pace]);
  return null;
}
