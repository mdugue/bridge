---
name: card-rendering
description: Use when implementing or debugging anything that touches DOM-to-PNG rasterisation, the route SVG path, the elevation/pace chart SVG, font loading for export, or the shared component contract every theme implements. Covers html-to-image gotchas (iOS Safari, fonts.ready, pixelRatio), Ramer–Douglas–Peucker route simplification, lat/lng→viewport projection, and the ActivityCardProps interface.
---

# card-rendering

The non-obvious technical bits of rendering an activity card and converting it to a PNG.

## The export pipeline

The card is a normal React component rendered in the DOM. The user sees the actual card as a live preview. On download, we rasterise that exact DOM node to PNG.

```ts
// app/lib/rasterise.ts
import { toPng } from 'html-to-image'

export async function rasteriseCard(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready

  // iOS Safari: first call sometimes returns blank. Discard and retry.
  await toPng(node, { pixelRatio: 2, cacheBust: true })
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true })

  const res = await fetch(dataUrl)
  return res.blob()
}
```

### Why these specific options

- **`pixelRatio: 2`** — DOM renders at 540×675; output is crisp 1080×1350. Lay the card out at the smaller size and let pixelRatio do the upscale; trying to render the DOM at 1080×1350 directly causes Tailwind sizing and font rendering to look heavy.
- **`cacheBust: true`** — forces fonts and background images to be re-fetched so they actually inline into the PNG.
- **`await document.fonts.ready`** — without this, fallback fonts sneak into the export even though the preview looks correct.
- **The double call** — iOS Safari quirk in html-to-image. The first call warms the canvas; the second produces real output. Don't remove this.

### Sharing the result

```ts
const blob = await rasteriseCard(cardRef.current!)
const file = new File([blob], 'activity-card.png', { type: 'image/png' })

if (navigator.canShare?.({ files: [file] })) {
  await navigator.share({ files: [file], title: activity.title })
} else {
  // Fallback: direct download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'activity-card.png'
  a.click()
  URL.revokeObjectURL(url)
}
```

## Route SVG rendering

No map tiles. The route is an SVG polyline drawn from `routeCoordinates: [lat, lng][]`.

### Coordinate projection

```ts
export function projectRoute(
  coords: Array<[number, number]>,
  width: number,
  height: number,
  padding = 16,
): string {
  if (coords.length === 0) return ''

  const lats = coords.map(([lat]) => lat)
  const lngs = coords.map(([, lng]) => lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  // Preserve aspect ratio of the route
  const latRange = maxLat - minLat || 1
  const lngRange = maxLng - minLng || 1
  const scaleX = (width - padding * 2) / lngRange
  const scaleY = (height - padding * 2) / latRange
  const scale = Math.min(scaleX, scaleY)

  // Centre within the box
  const offsetX = (width - lngRange * scale) / 2
  const offsetY = (height - latRange * scale) / 2

  return coords
    .map(([lat, lng]) => {
      const x = (lng - minLng) * scale + offsetX
      const y = (maxLat - lat) * scale + offsetY // flip Y
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
```

Render as `<polyline points={projected} fill="none" stroke="..." strokeWidth={...} strokeLinejoin="round" strokeLinecap="round" />`.

### Simplification

Raw GPX often has 5000+ points. Simplify to ~150 with Ramer–Douglas–Peucker before storing on `Activity.routeCoordinates`. Implement in `lib/metrics/simplify.ts`. If you reach for `turf` for this, that's fine — but RDP is ~30 lines and avoids a dependency.

### Path styling

The polyline should never look like a generic mapping line. Each theme styles it differently — gradient stroke, glow, dashed, segmented by elevation, etc. The `RoutePath` component in `themes/shared/` should expose enough props for themes to restyle without re-deriving geometry.

## Elevation / pace chart

Same pattern: project an array of numbers to an SVG path.

```ts
export function projectProfile(
  values: number[],
  width: number,
  height: number,
  padding = 8,
): { area: string; line: string } {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = (width - padding * 2) / (values.length - 1)

  const points = values.map((v, i) => {
    const x = padding + i * step
    const y = padding + (1 - (v - min) / range) * (height - padding * 2)
    return [x, y] as const
  })

  const line = points
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const area =
    `M ${points[0][0]},${height} ` +
    points.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` L ${points[points.length - 1][0]},${height} Z`

  return { area, line }
}
```

Render the area as a filled `<path>` and the line as a stroked `<path>` on top.

## Theme component contract

Every theme implements the same interface:

```ts
// app/_components/themes/types.ts
export type ActivityCardProps = {
  activity: Activity
  accentColor?: string // user-overridable
  visibleStats?: StatKey[] // user-toggleable
}

export type ActivityCardTheme = React.FC<ActivityCardProps>
```

Each theme file exports a default component with this signature. The editor maps a `themeId` to a component:

```ts
const themes: Record<ThemeId, ActivityCardTheme> = {
  path: PathTheme,
  altitude: AltitudeTheme,
  photo: PhotoTheme,
  data: DataTheme,
  editorial: EditorialTheme,
  triathlon: TriathlonTheme,
}
```

### Theme dimensions

Author themes at **540×675** (so `pixelRatio: 2` exports as 1080×1350). Use Tailwind arbitrary values where needed:

```tsx
<div className="w-[540px] h-[675px] ...">
```

This is the only fixed-size container; everything inside flows from there.

### Sport awareness

Themes branch on `activity.sport` to choose which stats to show and how to render the profile chart. The mapping rules are in the `sport-data` skill — read that before implementing per-sport logic in a theme.

### Background photo

When `activity.backgroundImage` is set, themes that support it (Photo theme always, others optionally) use it as a CSS `background-image` on a layer. For html-to-image to capture it correctly, the photo should be an object URL or data URL — not a remote URL that would fail CORS.

## Fonts

Self-host theme fonts in `public/fonts/` and load via `@font-face` in `app/globals.css`. Google Fonts CDN also works but adds a network dependency for export — self-hosting is more reliable.

Each theme uses its own font pairing; don't share a single font system across themes. List the fonts at the top of each theme file as a comment so they're easy to swap.

## Debugging the export

If the PNG looks wrong vs the preview:

1. Did you await `document.fonts.ready`?
2. Is the background image a remote URL? Convert to object URL first.
3. Are you using `backdrop-filter`? It rasterises imperfectly. Switch to a solid overlay.
4. Are SVG `<text>` elements present? html-to-image handles them but check the font is loaded.
5. iOS specifically: are you doing the double-call?

If the PNG is blank: it's almost always the iOS double-call issue or fonts not ready.
