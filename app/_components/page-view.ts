/**
 * The page as the scene sees it: whether it is hidden, whether it is
 * online, the page's own address and its comings and goings (pageshow,
 * pagehide). The scene runs in a worker where it can (ADR 0061), and a
 * worker has no document: there the page feeds this view (scene-host.ts
 * `pageState`, `feedPageView`); on the page itself it reads the document.
 * Scene code reads the page through this view only, never `document`,
 * `window` or `location` (oxlint.config.ts guards it).
 */

/** The events the view passes on. */
export type PageEventType =
  | "online"
  | "offline"
  | "pagehide"
  | "pageshow"
  | "visibilitychange";

/** What the page tells a worker's view: the state after an event. */
export interface PageState {
  hidden: boolean;
  /** the page's address (a worker's own `location` is its script's) */
  href: string;
  onLine: boolean;
}

/** An event the view passes on; pageshow says whether the bfcache kept
 *  the page (as PageTransitionEvent does, which a worker cannot make). */
export class PageEvent extends Event {
  readonly persisted: boolean;
  /** the page's wall clock when it happened (`Date.now()`), stamped on the
   *  page; a DOM event (the scene on the page) has none: it is now */
  readonly wall?: number;
  constructor(type: PageEventType, persisted = false, wall?: number) {
    super(type);
    this.persisted = persisted;
    this.wall = wall;
  }
}

type Listener = (event: PageEvent) => void;

export interface PageView {
  readonly hidden: boolean;
  readonly visibilityState: DocumentVisibilityState;
  readonly onLine: boolean;
  /** the page's address and its query (`?trace=1`, `?scene=lite`, …) */
  readonly href: string;
  readonly search: string;
  addEventListener: (type: PageEventType, listener: Listener) => void;
  removeEventListener: (type: PageEventType, listener: Listener) => void;
}

/** Where the event comes from on a page with a document. */
const onDocument = (type: PageEventType) => type === "visibilitychange";

/** The view over the page's own document. */
function documentView(): PageView {
  return {
    get hidden() {
      return document.hidden;
    },
    get visibilityState() {
      return document.visibilityState;
    },
    get onLine() {
      return navigator.onLine;
    },
    get href() {
      return location.href;
    },
    get search() {
      return location.search;
    },
    addEventListener: (type, listener) => {
      // reason: the DOM's events are a PageEvent's shape (`persisted` on
      // pageshow), not its class
      const l = listener as unknown as EventListener;
      (onDocument(type) ? document : window).addEventListener(type, l);
    },
    removeEventListener: (type, listener) => {
      const l = listener as unknown as EventListener;
      (onDocument(type) ? document : window).removeEventListener(type, l);
    },
  };
}

/** A worker's view: the last state the page sent, its events replayed. */
function fedView(): PageView & {
  feed: (state: PageState, event?: PageEvent) => void;
} {
  let state: PageState = {
    hidden: false,
    // a worker's own address until the page's first word: the query it
    // carries is the page's (the worker's URL keeps none)
    href: globalThis.location?.href ?? "",
    onLine: globalThis.navigator?.onLine ?? true,
  };
  const events = new EventTarget();
  return {
    get hidden() {
      return state.hidden;
    },
    get visibilityState(): DocumentVisibilityState {
      return state.hidden ? "hidden" : "visible";
    },
    get onLine() {
      return state.onLine;
    },
    get href() {
      return state.href;
    },
    get search() {
      return state.href ? new URL(state.href).search : "";
    },
    addEventListener: (type, listener) => {
      // reason: only PageEvents are dispatched here (`feedPageView`)
      events.addEventListener(type, listener as EventListener);
    },
    removeEventListener: (type, listener) => {
      events.removeEventListener(type, listener as EventListener);
    },
    feed: (next, event) => {
      state = next;
      if (event) {
        events.dispatchEvent(event);
      }
    },
  };
}

const fed = typeof document === "undefined" ? fedView() : null;

/** The page this scene runs in. */
export const pageView: PageView = fed ?? documentView();

/**
 * What the page tells a worker's scene (scene-host.ts): its state, and the
 * event that changed it. A no-op on the page itself, which reads the
 * document.
 */
export function feedPageView(
  state: PageState,
  event?: { persisted?: boolean; type: PageEventType; wall?: number }
): void {
  fed?.feed(
    state,
    event ? new PageEvent(event.type, event.persisted, event.wall) : undefined
  );
}

/** The page's state now, for a worker (scene-host.ts). */
export function pageState(): PageState {
  return {
    hidden: pageView.hidden,
    href: pageView.href,
    onLine: pageView.onLine,
  };
}
