"use client";

import { useEffect } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import type { ScenePace } from "./scene-client";

/**
 * Tells the scene's pace (lib/city/frame-pace.ts) when the phone's sidebar
 * covers it: covered, it draws only what the HUD asks of it, and a scroll
 * in the sheet asks nothing. On a desktop the panel floats beside the
 * scene and the pace stays out of it.
 */
export const SidebarPace = ({ pace }: { pace: ScenePace }) => {
  const { isMobile, openMobile } = useSidebar();
  const covered = isMobile && openMobile;
  useEffect(() => {
    pace.setCovered(covered);
    return () => pace.setCovered(false);
  }, [covered, pace]);
  return null;
};
