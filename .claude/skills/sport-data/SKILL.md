---
name: sport-data
description: Use when parsing GPX or .fit files, normalising activity data, deciding which metrics to display for a sport, formatting paces and speeds, or implementing triathlon segmentation. Covers the unified Activity shape, sport detection heuristics, per-sport metric priorities, unit conventions (min/km vs km/h vs min/100m), and how to split a multi-sport file into segments and transitions.
---

# sport-data

Sport-specific data rules: parsing, normalising, formatting, and choosing which metrics each theme should surface.

## Parsing strategy

### GPX (.gpx)

XML. Parse with `fast-xml-parser`. The structure varies between providers but the common path is `gpx.trk.trkseg.trkpt[]` where each `trkpt` has `@_lat`, `@_lon`, optional `ele`, and optional `time`.

GPX rarely contains sport type explicitly. Heuristics:

- File metadata `<gpx><metadata><type>` if present
- Filename hint (e.g. `running_2026-05-18.gpx`)
- Speed range (avg < 6 m/s → run; > 6 m/s → ride; many short pauses → swim is uncommon in GPX)
- Default to `ride` if ambiguous; let the user override in the UI

### FIT (.fit)

Binary. Parse with `fit-file-parser`. The `sport` field is explicit in the file's session message — use it directly. Map FIT sport codes:

| FIT sport                                                              | Our `Sport` |
| ---------------------------------------------------------------------- | ----------- |
| `cycling`                                                              | `ride`      |
| `running`                                                              | `run`       |
| `swimming`                                                             | `swim`      |
| `triathlon`, `multisport`, or session contains multiple sport segments | `triathlon` |

## Normalisation

Both parsers feed into a single `normalise()` function that returns the unified `Activity` shape (see SPEC.md). Rules:

- **Distance**: compute from coords using haversine, even if the file reports it (file values are often wrong by a few percent). Sum and store as `distanceKm`.
- **Duration**: difference between first and last timestamp. Subtract long pauses (>5 min gaps) for moving time — but store total elapsed as `durationSec`.
- **Elevation gain**: sum of positive elevation deltas after smoothing. Apply a 5-point moving average before computing gain or barometer noise gives wildly inflated values. Skip entirely if elevation is missing or all-zero.
- **Route coordinates**: simplify to ~150 points via RDP after distance calc. Store in `routeCoordinates`.
- **Elevation profile**: resample to ~80 evenly-spaced points for charting. Different from routeCoordinates count.
- **Pace profile** (runs only): seconds-per-km over each 100m bucket, smoothed.

## Sport-specific metrics

Each sport has a default "what matters" list. Themes render from this — they don't show power for a swim or SWOLF for a ride.

### Ride

Primary: distance, elevation gain, avg speed, duration
Secondary: max speed, avg heart rate, avg cadence, normalised power
Hide: pace per km, pace per 100m, SWOLF

### Run

Primary: distance, avg pace (min/km), duration, elevation gain
Secondary: avg heart rate, avg cadence, splits
Hide: avg speed (km/h), max speed, power, SWOLF

Note: even though `avgPaceMinPerKm` is derived from speed, runners _think_ in pace. Always show pace, never speed, for runs.

### Swim

Primary: distance, avg pace per 100m, duration, SWOLF (if available)
Secondary: stroke rate, lap count
Hide: elevation, speed in km/h, power, cadence

### Triathlon

Show overall summary plus per-segment breakdown. Each segment carries its own sport-appropriate metrics. Transitions get their own minimal block (just duration).

## Formatting

Centralise in `/metrics/format.ts`. Always format at render time, never store formatted strings on `Activity`.

```ts
// Distance — round to 1 decimal under 100km, integer above
formatDistance(87.34) → "87.3 km"
formatDistance(127.8) → "128 km"
formatDistance(0.85) → "850 m"          // for short swims

// Duration — drop hours when zero
formatDuration(3742) → "1:02:22"
formatDuration(742) → "12:22"

// Pace min/km — always M:SS
formatPace(4.533) → "4:32 /km"

// Pace per 100m — always M:SS
formatPace100(1.8) → "1:48 /100m"

// Speed — 1 decimal
formatSpeed(23.6) → "23.6 km/h"
```

Locale: assume metric for now. Imperial is a Step 2+ concern; don't add a units toggle to the MVP.

## Triathlon segmentation

If the FIT file reports multiple sport changes in one session, split into `segments` and `transitions`:

```ts
type Segment = {
  sport: 'swim' | 'ride' | 'run'
  distanceKm: number
  durationSec: number
  elevationGainM?: number
}
```

Detection: walk the records, group by current `sport` field. A "transition" is the gap between two segments — typically a low-speed period of 30s to 5min. Store as:

```ts
type Transition = { name: 'T1' | 'T2'; durationSec: number }
```

T1 follows swim, T2 follows ride. If the file doesn't have explicit sport changes (some watches report triathlon as one big session), don't try to be clever — leave segments empty and render as a single activity. The user can re-upload with a properly segmented file.

For GPX triathlon files (rare but they exist as separate `<trk>` blocks per leg), each `<trk>` becomes a segment.

## Sport detection in the UI

After parsing, the editor shows the detected sport in a small label with a one-click override (`ride / run / swim / triathlon`). The override updates `activity.sport` and re-renders the card with the new sport's metric set. Don't bury this — it's a real correction users will need to make occasionally.

## Edge cases worth handling

- **No elevation data**: many indoor or low-end devices. Hide elevation in stats, skip the elevation chart, themes that depend on elevation (Altitude) fall back to pace chart or a tasteful "no elevation data" treatment.
- **No GPS (pool swim, treadmill)**: `routeCoordinates` is empty. Themes that need a route (Path) fall back gracefully — show distance + duration prominently, omit the silhouette.
- **Very short activities (<1km)**: still valid; the card should look good. Don't impose minimums.
- **Activities crossing the antimeridian**: unlikely for the target user but possible. The longitude projection in `card-rendering` breaks here — known limitation, defer.
