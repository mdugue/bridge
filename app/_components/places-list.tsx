"use client";

import {
  ChevronDownIcon,
  FootprintsIcon,
  LandmarkIcon,
  PlaneIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { filterPlaces, type Place, PLACES_FIRST } from "@/lib/city/places";
import { cn } from "cn";

const SECTION_LABEL =
  "font-semibold text-[11px] uppercase leading-none tracking-widest text-muted-foreground";

const ROW =
  "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50";

/** What a row's icon says: on foot, from the air, or a landmark. */
function PlaceIcon({ place }: { place: Place }) {
  const Icon =
    place.kind === "landmark"
      ? LandmarkIcon
      : place.mode === "fly"
        ? PlaneIcon
        : FootprintsIcon;
  return <Icon aria-hidden className="size-3.5 shrink-0 opacity-60" />;
}

/** A row's tooltip: its line and the landmarks it shows too. */
function titleOf(place: Place): string {
  const how =
    place.kind === "landmark"
      ? "Wahrzeichen · aus der Luft"
      : place.mode === "fly"
        ? "Aus der Luft"
        : "Auf Augenhöhe";
  return [
    place.description ?? how,
    place.also.length > 0 ? `Mit ${place.also.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
}

function PlaceRow({
  disabled,
  onTravel,
  place,
  showKey,
}: {
  disabled: boolean;
  onTravel: (place: Place) => void;
  place: Place;
  showKey: boolean;
}) {
  return (
    <li>
      <button
        className={ROW}
        data-place={place.id}
        disabled={disabled}
        onClick={() => onTravel(place)}
        title={titleOf(place)}
        type="button"
      >
        <PlaceIcon place={place} />
        <span className="min-w-0 flex-1 truncate font-medium">
          {place.label}
        </span>
        {showKey && place.key !== undefined && (
          <kbd className="rounded-sm bg-muted px-1 font-sans text-[10px] text-muted-foreground leading-4">
            {place.key}
          </kbd>
        )}
      </button>
    </li>
  );
}

/**
 * The saved view: the first row while it is set, its ✕ beside it — clear,
 * then save again from wherever you stand, as before. The two buttons are
 * siblings, not nested (a button in a button is neither valid HTML nor
 * reachable by keyboard).
 */
function RememberedRow({
  onForget,
  onRestore,
}: {
  onForget: () => void;
  onRestore: () => void;
}) {
  return (
    <li className="flex items-center gap-1">
      <button
        className={cn(ROW, "flex-1")}
        onClick={onRestore}
        title="Zur gemerkten Sicht zurückspringen"
        type="button"
      >
        <StarIcon aria-hidden className="size-3.5 shrink-0 fill-current" />
        <span className="flex-1 truncate font-medium">Gemerkte Sicht</span>
      </button>
      <button
        aria-label="Gemerkte Sicht entfernen"
        // 20px reads right beside the row; the ::after pad makes it a real
        // touch target without the bulk (as the sidebar primitives do).
        className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground after:absolute after:-inset-2 hover:bg-accent hover:text-foreground"
        onClick={onForget}
        title="Gemerkte Sicht entfernen"
        type="button"
      >
        <XIcon className="size-3" />
      </button>
    </li>
  );
}

/**
 * *Orte* (lib/city/places.ts): the authored vantages and the city's
 * landmarks as one list — a landmark a vantage already shows is in that
 * vantage, not a second row. The first few show; the rest open below,
 * with a search over every name, the folded landmarks' included. A row
 * travels there (in Modell: centres the picture on it).
 */
export function PlacesList({
  canRemember,
  canTravel,
  onForget,
  onRemember,
  onRestore,
  onTravel,
  places,
  remembered,
  showKeys,
}: {
  /** there is a view to keep: the scene is up */
  canRemember: boolean;
  /** a row can go somewhere: the scene is up or can start (a GPU) */
  canTravel: boolean;
  onForget: () => void;
  onRemember: () => void;
  onRestore: () => void;
  onTravel: (place: Place) => void;
  places: readonly Place[];
  remembered: boolean;
  /** show the 1–9 keys (keyboard devices) */
  showKeys: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const more = places.length - PLACES_FIRST;
  const shown = open
    ? filterPlaces(places, query)
    : places.slice(0, PLACES_FIRST);
  return (
    <section
      aria-label="Orte"
      className="flex flex-col gap-1.5 border-t px-3 pt-3 pb-3.5"
    >
      <div className="flex items-center justify-between px-1">
        <span className={SECTION_LABEL}>Orte</span>
        {!remembered && (
          <button
            aria-label="Aktuelle Sicht merken"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
            disabled={!canRemember}
            onClick={onRemember}
            title="Die aktuelle Sicht merken — sie steht dann oben in der Liste"
            type="button"
          >
            <StarIcon aria-hidden className="size-3" />
            Sicht merken
          </button>
        )}
      </div>
      {open && more > 0 && (
        <div className="relative px-1 pb-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-controls={listId}
            aria-label="Orte durchsuchen"
            // 16 px on phones: a smaller field makes iOS zoom the page in
            className="h-8 pl-7 text-base md:text-xs"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ort oder Wahrzeichen suchen"
            type="search"
            value={query}
          />
        </div>
      )}
      <ul className="flex flex-col" id={listId}>
        {remembered && !query && (
          <RememberedRow onForget={onForget} onRestore={onRestore} />
        )}
        {shown.map((place) => (
          <PlaceRow
            disabled={!canTravel}
            key={place.id}
            onTravel={onTravel}
            place={place}
            showKey={showKeys}
          />
        ))}
        {shown.length === 0 && (
          <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
            Kein Ort heißt so.
          </li>
        )}
      </ul>
      {more > 0 && (
        <button
          aria-controls={listId}
          aria-expanded={open}
          className="group/more mx-1 flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(!open);
            setQuery("");
          }}
          type="button"
        >
          <ChevronDownIcon
            aria-hidden
            className="size-3 transition-transform group-aria-expanded/more:rotate-180"
          />
          {open ? "Weniger zeigen" : `Alle ${places.length} Orte zeigen`}
        </button>
      )}
    </section>
  );
}
