import {
  BookOpenTextIcon,
  DatabaseIcon,
  EyeIcon,
  FileTextIcon,
  GlobeIcon,
  LayersIcon,
  LibraryIcon,
  ListChecksIcon,
  type LucideProps,
  MilestoneIcon,
  MousePointerClickIcon,
  RouteIcon,
  ScaleIcon,
  WaypointsIcon,
  WorkflowIcon,
} from "lucide-react";
import type { ReactNode } from "react";

type Glyph = (props: LucideProps) => ReactNode;

/**
 * One glyph per page, keyed by file name so a guide page and its twin share
 * it. Decoration only: a page without an entry gets the plain document.
 */
const ICONS: Record<string, Glyph> = {
  "how-it-works": (p) => <EyeIcon {...p} />,
  "data-sources": (p) => <DatabaseIcon {...p} />,
  "data-journey": (p) => <RouteIcon {...p} />,
  "using-the-viewer": (p) => <MousePointerClickIcon {...p} />,
  glossary: (p) => <BookOpenTextIcon {...p} />,
  README: (p) => <LibraryIcon {...p} />,
  rendering: (p) => <LayersIcon {...p} />,
  "data-pipeline": (p) => <WorkflowIcon {...p} />,
  "data-flow": (p) => <WaypointsIcon {...p} />,
  transformations: (p) => <ListChecksIcon {...p} />,
  portability: (p) => <GlobeIcon {...p} />,
  "adr/README": (p) => <ScaleIcon {...p} />,
  "plans/README": (p) => <MilestoneIcon {...p} />,
};

const DOCUMENT: Glyph = (p) => <FileTextIcon {...p} />;

/** The page's glyph, as an element. */
export function docIcon(file: string, props: LucideProps): ReactNode {
  const inner = file
    .replace(/^docs\/(guide\/(de|en)\/)?/u, "")
    .replace(/\.md$/u, "");
  return (ICONS[inner] ?? DOCUMENT)({ "aria-hidden": true, ...props });
}
