# QA views

Written by `bun scripts/qa-views.ts` (plan 048): edit the table there,
never these files. Each view is a Snapshot (`<name>.json`, ADR 0018);
`bun run shots` renders them as `shots/qa-<name>.png` (one view:
`bun run shots -- --grep qa-<name>`). The link opens the view: put the
origin of the preview or production in front (`https://…/dresden?snap=…`);
a check's own knobs are already in its link, before `snap`. The
sidebar's *Erweitert › Snapshot › Anwenden* takes the JSON instead.

## shore-eye

The Elbe bank below the Brühlsche Terrasse at eye level, late morning: the class colours at the shore, the water's soft edge, the landing stage.

For: 019 B, 019 K (031), 070 step 4.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMDk0LjIyLCJ5IjoxMDkuMzgsInoiOjQ4MS41fSwiZXBzZyI6eyJ4Ijo0MTIwMjAsInkiOjU2NTY1MzZ9LCJmb3YiOjYyLCJoZWFkaW5nRGVnIjoyODUsInBpdGNoRGVnIjoyLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0wNy0xNVQwOTowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## meadow-eye

The Großer Garten's lawn towards the Palais at eye level, early evening: the meadow's tint and mottle, crowns and their shadows.

For: 019 B, 019 K (025).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOjIyNS43OCwieSI6MTE1Ljk4LCJ6IjoyMzk3LjV9LCJlcHNnIjp7IngiOjQxMzM0MCwieSI6NTY1NDYyMH0sImZvdiI6NjIsImhlYWRpbmdEZWciOjMzMS4wNSwicGl0Y2hEZWciOjAuMzIsIm1vZGUiOiJ3YWxrIn0sImRhdGUiOiIyMDI2LTA2LTIwVDE1OjMwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## seam-eye

Antonstraße across the tile seam at E 412 000, at eye level with the sun behind: nothing steps, gaps or changes at the seam (ground, kerbs, markings, shadows); the neighbour's shadows from the shadow camera's coarse stream (64 px phone, 128 px desktop).

For: 019 D, 019 K, 019 M, 071.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMTU0LjIyLCJ5IjoxMTQuODEsInoiOi03MzEuNX0sImVwc2ciOnsieCI6NDExOTYwLCJ5Ijo1NjU3NzQ5fSwiZm92Ijo2MiwiaGVhZGluZ0RlZyI6MTA5LjMyLCJwaXRjaERlZyI6LTAuMDQsIm1vZGUiOiJ3YWxrIn0sImRhdGUiOiIyMDI2LTA3LTE1VDE1OjMwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## seam-fly

200 m above the four-tile corner (E 412 000 / N 5 658 000) at −35°: the far crown tier's switch, the coarse/fine hand-over at the corner, the shadow rings from the air, no seam between them.

For: 019 D, 019 E, 019 M.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMzE2LjQ1LCJ5IjozMTIuMDYsInoiOi03ODAuMjd9LCJlcHNnIjp7IngiOjQxMTc5Ny43NywieSI6NTY1Nzc5Ny43N30sImZvdiI6NTUsImhlYWRpbmdEZWciOjQ1LCJwaXRjaERlZyI6LTM0Ljg0LCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA3LTE1VDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## oblique-400

400 m up, oblique over the Altstadt towards the Frauenkirche: LOD switches, the shadow frustum's reach, the horizon's shade past it; a frame-time and memory reading.

For: 019 D, 019 H.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi04MjkuMTksInkiOjUxNC45OCwieiI6MTE2MS41Mn0sImVwc2ciOnsieCI6NDEyMjg1LjAyLCJ5Ijo1NjU1ODU1Ljk4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzE1LCJwaXRjaERlZyI6LTMwLjA2LCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA3LTE1VDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## low-sun

The Neumarkt on 21 December at 09:00, the sun a few degrees up: long shadows without acne, peter-panning or a staircase.

For: 019 E.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMzg0LjIyLCJ5IjoxMTQuODQsInoiOjc3Ny41fSwiZXBzZyI6eyJ4Ijo0MTE3MzAsInkiOjU2NTYyNDB9LCJmb3YiOjY2LCJoZWFkaW5nRGVnIjozMiwicGl0Y2hEZWciOjEwLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0xMi0yMVQwODowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## roof-close

Neustadt roofs from about 30 m above them at 13:00: no quantisation steps, cracks or wobble in the roofs and facades.

For: 019 C.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0zODAuMjIsInkiOjE2NC4yLCJ6IjotNjE5LjV9LCJlcHNnIjp7IngiOjQxMjczNCwieSI6NTY1NzYzN30sImZvdiI6NjIsImhlYWRpbmdEZWciOjM0NywicGl0Y2hEZWciOi0zMCwibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0wNi0yMFQxMTowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## night-street

Hauptstraße in the Neustadt at eye level, 21:00 in September: lamps, shop glow, the trees in lamp light (and in Film noir: `night-street-noir`).

For: 019 K (027), 019 G.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMTg0LjIyLCJ5IjoxMTUuNDYsInoiOi0yMzIuNX0sImVwc2ciOnsieCI6NDExOTMwLCJ5Ijo1NjU3MjUwfSwiZm92Ijo2MiwiaGVhZGluZ0RlZyI6MzQsInBpdGNoRGVnIjozLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0wOS0yMFQxOTowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## night-street-noir

The night street in Film noir: ink and tone bands by lamp light.

For: 019 G.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMTg0LjIyLCJ5IjoxMTUuNDYsInoiOi0yMzIuNX0sImVwc2ciOnsieCI6NDExOTMwLCJ5Ijo1NjU3MjUwfSwiZm92Ijo2MiwiaGVhZGluZ0RlZyI6MzQsInBpdGNoRGVnIjozLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0wOS0yMFQxOTowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoibm9pciIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## street-crossings

The Albertplatz's junction with the Antonstraße from 25 m, afternoon sun: crossings, stop lines, kerbs and paving on the fine level; on a phone FXAA against the desktop's SMAA — softer is fine, crawling is not.

For: 019 M (FXAA), 077 step 0.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05NTQuNzIsInkiOjEzOC4wOCwieiI6LTU5OC44N30sImVwc2ciOnsieCI6NDEyMTU5LjUsInkiOjU2NTc2MTYuMzd9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjozMCwicGl0Y2hEZWciOi0yNC40MywibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0wOC0yMFQxNDowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## street-crossings-comic

The same junction in Comic: the ink lines and roof edges under FXAA (phone) against SMAA (desktop).

For: 019 M (FXAA).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05NTQuNzIsInkiOjEzOC4wOCwieiI6LTU5OC44N30sImVwc2ciOnsieCI6NDEyMTU5LjUsInkiOjU2NTc2MTYuMzd9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjozMCwicGl0Y2hEZWciOi0yNC40MywibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0wOC0yMFQxNDowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoiY29taWMiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## ao-wall-foot

The Palais im Großen Garten's south wall from its lawn at a low October sun: the contact shadow's gradient at the wall's foot shows no banding beyond one step; sky view and GTAO together read as soft light, not dirt.

For: 019 M (AO in one byte), 019 F.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOjE0Ny43OCwieSI6MTE1LjcxLCJ6IjoyMzE3LjV9LCJlcHNnIjp7IngiOjQxMzI2MiwieSI6NTY1NDcwMH0sImZvdiI6NjIsImhlYWRpbmdEZWciOjAsInBpdGNoRGVnIjoyLjA1LCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0xMC0xNVQxNDozMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## pitches-200

200 m over the football pitches at the Großer Garten's north-west corner (on a phone): beyond the fine level the pitches show their land-cover class and gain their lines as the fine level arrives — no flash of a wrong colour.

For: 019 M (coarse level), 070 step 3.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMDEwLjIyLCJ5IjozMTQuMDMsInoiOjIxMjEuMDF9LCJlcHNnIjp7IngiOjQxMjEwNCwieSI6NTY1NDg5Ni40OX0sImZvdiI6NTUsImhlYWRpbmdEZWciOjMwLCJwaXRjaERlZyI6LTM4LjgxLCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA2LTIwVDEyOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## oblique-400-paper

`oblique-400` in Papier once a few tiles have loaded: no missing geometry, no WebGPU validation error (an empty vertex buffer).

For: 019 M (dropped CPU copies).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi04MjkuMTksInkiOjUxNC45OCwieiI6MTE2MS41Mn0sImVwc2ciOnsieCI6NDEyMjg1LjAyLCJ5Ijo1NjU1ODU1Ljk4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzE1LCJwaXRjaERlZyI6LTMwLjA2LCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA3LTE1VDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXBlciIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## oblique-400-line

`oblique-400` in Strich: as `oblique-400-paper`.

For: 019 M (dropped CPU copies), 019 N (Modell).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi04MjkuMTksInkiOjUxNC45OCwieiI6MTE2MS41Mn0sImVwc2ciOnsieCI6NDEyMjg1LjAyLCJ5Ijo1NjU1ODU1Ljk4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzE1LCJwaXRjaERlZyI6LTMwLjA2LCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA3LTE1VDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJsaW5lIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## oblique-400-figure

`oblique-400` in Schwarzplan: as `oblique-400-paper`.

For: 019 M (dropped CPU copies).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi04MjkuMTksInkiOjUxNC45OCwieiI6MTE2MS41Mn0sImVwc2ciOnsieCI6NDEyMjg1LjAyLCJ5Ijo1NjU1ODU1Ljk4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzE1LCJwaXRjaERlZyI6LTMwLjA2LCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA3LTE1VDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJmaWd1cmUiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## modell-iso-low

Modell, Isometrie over the Elbe at the Brühlsche Terrasse, low October sun: the specular and halo terms, the water's glitter — none flat, blown or missing against `modell-fly-low`.

For: 019 N (Modell).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMjE0LjIyLCJ5Ijo0MDQuMjUsInoiOjM2Ny41fSwiZXBzZyI6eyJ4Ijo0MTE5MDAsInkiOjU2NTY2NTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjo0NSwicGl0Y2hEZWciOi0zNSwibW9kZSI6ImZseSIsIm1vZGVsIjp7InBpdm90Ijp7IngiOi0xMjE0LjIyLCJ5IjoxMDQuMjUsInoiOjM2Ny41fSwicHJlc2V0IjoiaXNvIiwic2NhbGUiOjI1MDAsInRpbHREZWciOjM1LjI2NDM4OTY4Mjc1NDY1NCwidHVybkRlZyI6NDV9fSwiZGF0ZSI6IjIwMjYtMTAtMTVUMTU6NDU6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## modell-iso-high

As `modell-iso-low` at a high June sun.

For: 019 N (Modell).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMjE0LjIyLCJ5Ijo0MDQuMjUsInoiOjM2Ny41fSwiZXBzZyI6eyJ4Ijo0MTE5MDAsInkiOjU2NTY2NTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjo0NSwicGl0Y2hEZWciOi0zNSwibW9kZSI6ImZseSIsIm1vZGVsIjp7InBpdm90Ijp7IngiOi0xMjE0LjIyLCJ5IjoxMDQuMjUsInoiOjM2Ny41fSwicHJlc2V0IjoiaXNvIiwic2NhbGUiOjI1MDAsInRpbHREZWciOjM1LjI2NDM4OTY4Mjc1NDY1NCwidHVybkRlZyI6NDV9fSwiZGF0ZSI6IjIwMjYtMDYtMjFUMTE6MzA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## modell-plan-low

Modell, Lageplan over the same reach at the low sun.

For: 019 N (Modell).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMjE0LjIyLCJ5Ijo0MDQuMjUsInoiOjM2Ny41fSwiZXBzZyI6eyJ4Ijo0MTE5MDAsInkiOjU2NTY2NTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjowLCJwaXRjaERlZyI6LTYwLCJtb2RlIjoiZmx5IiwibW9kZWwiOnsicGl2b3QiOnsieCI6LTEyMTQuMjIsInkiOjEwNC4yNSwieiI6MzY3LjV9LCJwcmVzZXQiOiJwbGFuIiwic2NhbGUiOjI1MDAsInRpbHREZWciOjkwLCJ0dXJuRGVnIjowfX0sImRhdGUiOiIyMDI2LTEwLTE1VDE1OjQ1OjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## modell-plan-high

Modell, Lageplan at the high sun.

For: 019 N (Modell).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMjE0LjIyLCJ5Ijo0MDQuMjUsInoiOjM2Ny41fSwiZXBzZyI6eyJ4Ijo0MTE5MDAsInkiOjU2NTY2NTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjowLCJwaXRjaERlZyI6LTYwLCJtb2RlIjoiZmx5IiwibW9kZWwiOnsicGl2b3QiOnsieCI6LTEyMTQuMjIsInkiOjEwNC4yNSwieiI6MzY3LjV9LCJwcmVzZXQiOiJwbGFuIiwic2NhbGUiOjI1MDAsInRpbHREZWciOjkwLCJ0dXJuRGVnIjowfX0sImRhdGUiOiIyMDI2LTA2LTIxVDExOjMwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## modell-iso-line

Modell, Isometrie in Strich at the high sun: the washes.

For: 019 N (Modell).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMjE0LjIyLCJ5Ijo0MDQuMjUsInoiOjM2Ny41fSwiZXBzZyI6eyJ4Ijo0MTE5MDAsInkiOjU2NTY2NTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjo0NSwicGl0Y2hEZWciOi0zNSwibW9kZSI6ImZseSIsIm1vZGVsIjp7InBpdm90Ijp7IngiOi0xMjE0LjIyLCJ5IjoxMDQuMjUsInoiOjM2Ny41fSwicHJlc2V0IjoiaXNvIiwic2NhbGUiOjI1MDAsInRpbHREZWciOjM1LjI2NDM4OTY4Mjc1NDY1NCwidHVybkRlZyI6NDV9fSwiZGF0ZSI6IjIwMjYtMDYtMjFUMTE6MzA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6ImxpbmUiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## modell-fly-low

The Modell views' reference: the same reach in Fliegen at the low sun (the pose Modell leaves to).

For: 019 N (Modell).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMjE0LjIyLCJ5Ijo0MDQuMjUsInoiOjM2Ny41fSwiZXBzZyI6eyJ4Ijo0MTE5MDAsInkiOjU2NTY2NTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjo0NSwicGl0Y2hEZWciOi0zNSwibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0xMC0xNVQxNTo0NTowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## frozen-start

The start view in the afternoon: the fixed look table against production.

For: 019 N (073).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05MTQuMjIsInkiOjE0OC4wOSwieiI6MjE3LjV9LCJlcHNnIjp7IngiOjQxMjIwMCwieSI6NTY1NjgwMH0sImZvdiI6NDYsImhlYWRpbmdEZWciOjIzNSwicGl0Y2hEZWciOi0xLjUsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjYtMDYtMjBUMTM6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## neumarkt-dusk

The Neumarkt at dusk: the clay's windows and facade reading, the glow, against production.

For: 019 N (073).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMzg0LjIyLCJ5IjoxMTQuODQsInoiOjc3Ny41fSwiZXBzZyI6eyJ4Ijo0MTE3MzAsInkiOjU2NTYyNDB9LCJmb3YiOjY2LCJoZWFkaW5nRGVnIjozMiwicGl0Y2hEZWciOjEwLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0xMC0xNVQxNjo0NTowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## elbufer-evening

The Neustädter Elbufer at eye level in the June evening sun, the path along the meadow at a grazing angle: the ground detail and the meadow's edge — no blockier class boundary (070's half-resolution splat).

For: 019 N (073), 070 step 4.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi02OTQuMjIsInkiOjExNC4yNywieiI6MTAyLjV9LCJlcHNnIjp7IngiOjQxMjQyMCwieSI6NTY1NjkxNX0sImZvdiI6NjIsImhlYWRpbmdEZWciOjI0MywicGl0Y2hEZWciOjEsIm1vZGUiOiJ3YWxrIn0sImRhdGUiOiIyMDI2LTA2LTIwVDE4OjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## night-boot

Open the link cold (cache disabled): the boot with a night view applied before it — `boot:light-to-veil`, `boot:first-shadow-frame` (none by night), the veil to loaded.

For: 069 step 2.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05MTQuMjIsInkiOjE0OC4wOSwieiI6MjE3LjV9LCJlcHNnIjp7IngiOjQxMjIwMCwieSI6NTY1NjgwMH0sImZvdiI6NDYsImhlYWRpbmdEZWciOjIzNSwicGl0Y2hEZWciOi0xLjUsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjYtMDctMTVUMjE6MzA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## park-50

The Großer Garten from 50 m: the class boundaries of paths and lawns in the desktop's half-resolution fine splat.

For: 070 step 4.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi02NC4yMiwieSI6MTY0LjQ5LCJ6IjoyNDE3LjV9LCJlcHNnIjp7IngiOjQxMzA1MCwieSI6NTY1NDYwMH0sImZvdiI6NTUsImhlYWRpbmdEZWciOjYwLCJwaXRjaERlZyI6LTIwLCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA2LTIwVDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## coarse-300

On a phone at `?safety=3` (the coarse level from ≈ 300 m): the Elbwiesen and the shore 300 m ahead in the 1024² coarse raster — acceptable, or keep 2048² for a phone's coarse level.

For: 070 step 5. Open with `?safety=3`.

```text
/dresden?safety=3&snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0zNjQuMjIsInkiOjE1My42LCJ6IjotMjMyLjV9LCJlcHNnIjp7IngiOjQxMjc1MCwieSI6NTY1NzI1MH0sImZvdiI6NjIsImhlYWRpbmdEZWciOjIyNSwicGl0Y2hEZWciOi02LCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA2LTIwVDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## rooftops

The "Über den Dächern" vantage: roof edges and facade lines at the desktop's 1.5× pixel ratio — acceptable aliasing.

For: 071.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0zODAuMjIsInkiOjE0NS4yLCJ6IjotNjE5LjV9LCJlcHNnIjp7IngiOjQxMjczNCwieSI6NTY1NzYzN30sImZvdiI6NjIsImhlYWRpbmdEZWciOjM0NywicGl0Y2hEZWciOi02LCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA2LTIwVDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## site-edge

250 m over the site's east edge looking out: the ground plate beyond the last tile, no hole; on a phone, `heldMB` and frame time on the way out.

For: 076.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOjQ1ODUuNzgsInkiOjQ1NS4wNiwieiI6MjE3LjV9LCJlcHNnIjp7IngiOjQxNzcwMCwieSI6NTY1NjgwMH0sImZvdiI6NTUsImhlYWRpbmdEZWciOjgwLCJwaXRjaERlZyI6LTMwLCJtb2RlIjoiZmx5In0sImRhdGUiOiIyMDI2LTA2LTIwVDEzOjAwOjAwLjAwMFoiLCJsb29rIjp7Im11bHRpVHVmdCI6dHJ1ZSwic3R5bGUiOiJwYXN0ZWwiLCJmb2dQY3QiOjIwLCJ0cmFmZmljTGF5ZXIiOmZhbHNlLCJiaWtlTGF5ZXIiOmZhbHNlLCJ0cmFtTGF5ZXIiOmZhbHNlfX0
```

## across-400

400 m up across the city to the west: the far buildings at LoD1, the coarse crowns from the start, the coarse level, the sky view and the horizon past the shadow frustum.

For: 076, 077 step 0.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOjY4NS43OCwieSI6NTEyLjIyLCJ6IjotMjgyLjV9LCJlcHNnIjp7IngiOjQxMzgwMCwieSI6NTY1NzMwMH0sImZvdiI6NTUsImhlYWRpbmdEZWciOjI1MCwicGl0Y2hEZWciOi0xMiwibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0wOC0yMFQxNDowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## sports-ground

The pitches at the Großer Garten's north-west corner from 60 m: their lines on a desktop's fine level.

For: 077 step 0.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05NDUuMjIsInkiOjE3Ni40MSwieiI6MjAwOC40Mn0sImVwc2ciOnsieCI6NDEyMTY5LCJ5Ijo1NjU1MDA5LjA4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzAsInBpdGNoRGVnIjotMjcuODcsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjYtMDgtMjBUMTQ6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## colony

An allotment colony in Löbtau from 50 m: the faint beds.

For: 077 step 0.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi00ODMzLjA3LCJ5IjoxOTguMSwieiI6MjM5NS4zNX0sImVwc2ciOnsieCI6NDA4MjgxLjE1LCJ5Ijo1NjU0NjIyLjE1fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6NDUsInBpdGNoRGVnIjotMjQuNCwibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0wOC0yMFQxNDowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## elbwiesen

The Neustädter Elbwiesen from 40 m along the river: NDVI, the water, the class raster's shoreline.

For: 077 step 0.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi04MTQuMjIsInkiOjE1MC45MywieiI6MTY3LjV9LCJlcHNnIjp7IngiOjQxMjMwMCwieSI6NTY1Njg1MH0sImZvdiI6NTUsImhlYWRpbmdEZWciOjI2MCwicGl0Y2hEZWciOi0xMiwibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0wOC0yMFQxNDowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## lamps-july-day

Albertstraße at eye level towards an advertising column, lamps and street trees: halos and pools on at dusk and after, off by day; the lit column; autumn and bare crowns and their thin winter shadow. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05ODMuMjIsInkiOjExNC44MSwieiI6LTQzNy41fSwiZXBzZyI6eyJ4Ijo0MTIxMzEsInkiOjU2NTc0NTV9LCJmb3YiOjYyLCJoZWFkaW5nRGVnIjozNTIuNDgsInBpdGNoRGVnIjoxLjkxLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0wNy0xNVQxMjowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## lamps-july-dusk

Albertstraße at eye level towards an advertising column, lamps and street trees: halos and pools on at dusk and after, off by day; the lit column; autumn and bare crowns and their thin winter shadow. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05ODMuMjIsInkiOjExNC44MSwieiI6LTQzNy41fSwiZXBzZyI6eyJ4Ijo0MTIxMzEsInkiOjU2NTc0NTV9LCJmb3YiOjYyLCJoZWFkaW5nRGVnIjozNTIuNDgsInBpdGNoRGVnIjoxLjkxLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0wNy0xNVQxOTo0MDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## lamps-july-night

Albertstraße at eye level towards an advertising column, lamps and street trees: halos and pools on at dusk and after, off by day; the lit column; autumn and bare crowns and their thin winter shadow. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05ODMuMjIsInkiOjExNC44MSwieiI6LTQzNy41fSwiZXBzZyI6eyJ4Ijo0MTIxMzEsInkiOjU2NTc0NTV9LCJmb3YiOjYyLCJoZWFkaW5nRGVnIjozNTIuNDgsInBpdGNoRGVnIjoxLjkxLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0wNy0xNVQyMTozMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## lamps-january-day

Albertstraße at eye level towards an advertising column, lamps and street trees: halos and pools on at dusk and after, off by day; the lit column; autumn and bare crowns and their thin winter shadow. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05ODMuMjIsInkiOjExNC44MSwieiI6LTQzNy41fSwiZXBzZyI6eyJ4Ijo0MTIxMzEsInkiOjU2NTc0NTV9LCJmb3YiOjYyLCJoZWFkaW5nRGVnIjozNTIuNDgsInBpdGNoRGVnIjoxLjkxLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNy0wMS0xNVQxMjowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## lamps-january-night

Albertstraße at eye level towards an advertising column, lamps and street trees: halos and pools on at dusk and after, off by day; the lit column; autumn and bare crowns and their thin winter shadow. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05ODMuMjIsInkiOjExNC44MSwieiI6LTQzNy41fSwiZXBzZyI6eyJ4Ijo0MTIxMzEsInkiOjU2NTc0NTV9LCJmb3YiOjYyLCJoZWFkaW5nRGVnIjozNTIuNDgsInBpdGNoRGVnIjoxLjkxLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNy0wMS0xNVQxOTowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## fountain-july-day

The Artesischer Brunnen on the Albertplatz from 30 m: jets and basin at night, drained in January. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05MjEuMjcsInkiOjE0My4wNCwieiI6LTYxOC4xOH0sImVwc2ciOnsieCI6NDEyMTkyLjk1LCJ5Ijo1NjU3NjM1LjY4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzAsInBpdGNoRGVnIjotMzMuMzUsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjYtMDctMTVUMTI6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## fountain-july-night

The Artesischer Brunnen on the Albertplatz from 30 m: jets and basin at night, drained in January. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05MjEuMjcsInkiOjE0My4wNCwieiI6LTYxOC4xOH0sImVwc2ciOnsieCI6NDEyMTkyLjk1LCJ5Ijo1NjU3NjM1LjY4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzAsInBpdGNoRGVnIjotMzMuMzUsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjYtMDctMTVUMjE6MzA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## fountain-january-day

The Artesischer Brunnen on the Albertplatz from 30 m: jets and basin at night, drained in January. Identical before and after plan 078.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05MjEuMjcsInkiOjE0My4wNCwieiI6LTYxOC4xOH0sImVwc2ciOnsieCI6NDEyMTkyLjk1LCJ5Ijo1NjU3NjM1LjY4fSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6MzAsInBpdGNoRGVnIjotMzMuMzUsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjctMDEtMTVUMTI6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## river-night

The Elbe at the Terrassenufer's ferry line from 150 m on a July night: mist, wakes and fences at their night value.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi00MDQuNTgsInkiOjI1OC40MSwieiI6MjM3LjA4fSwiZXBzZyI6eyJ4Ijo0MTI3MDkuNjQsInkiOjU2NTY3ODAuNDJ9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjoyNTAsInBpdGNoRGVnIjotMzEuNTMsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjYtMDctMTVUMjE6MzA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## modell-night

Modell far out (1 : 20 000, 5 m/px: only coarse levels) on a July night: mist, wakes and fences at their night value — may differ from before plan 078 (its finding 2). A phone stops at 1 : 10 000.

For: 078.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMTQuMjIsInkiOjQwOC4wMywieiI6MTcuNX0sImVwc2ciOnsieCI6NDEzMDAwLCJ5Ijo1NjU3MDAwfSwiZm92Ijo1NSwiaGVhZGluZ0RlZyI6NDUsInBpdGNoRGVnIjotNDAsIm1vZGUiOiJmbHkiLCJtb2RlbCI6eyJwaXZvdCI6eyJ4IjotMTE0LjIyLCJ5IjoxMDguMDMsInoiOjE3LjV9LCJwcmVzZXQiOiJpc28iLCJzY2FsZSI6MjAwMDAsInRpbHREZWciOjM1LjI2NDM4OTY4Mjc1NDY1NCwidHVybkRlZyI6NDV9fSwiZGF0ZSI6IjIwMjYtMDctMTVUMjE6MzA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## modell-comic

Modell and Comic for the recovery checks: after a forced loss at level 1 the page comes back in both, at level 2 without either (the link itself is gated the same way).

For: 079. Open with `?gpu=webgl2&trail=1`.

```text
/dresden?gpu=webgl2&trail=1&snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMjE0LjIyLCJ5Ijo0MDQuMjUsInoiOjM2Ny41fSwiZXBzZyI6eyJ4Ijo0MTE5MDAsInkiOjU2NTY2NTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjo0NSwicGl0Y2hEZWciOi0zNSwibW9kZSI6ImZseSIsIm1vZGVsIjp7InBpdm90Ijp7IngiOi0xMjE0LjIyLCJ5IjoxMDQuMjUsInoiOjM2Ny41fSwicHJlc2V0IjoiaXNvIiwic2NhbGUiOjI1MDAsInRpbHREZWciOjM1LjI2NDM4OTY4Mjc1NDY1NCwidHVybkRlZyI6NDV9fSwiZGF0ZSI6IjIwMjYtMDYtMjBUMTM6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6ImNvbWljIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## ask-cone-tree

A cone crown under the crosshair: ask it (click the centre) — the outline is a cone, not an ellipsoid.

For: 080 step 6, 019 M (outline).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMDY0LjMyLCJ5IjoxMTUuMjQsInoiOi00MzcuNX0sImVwc2ciOnsieCI6NDEyMDQ5LjksInkiOjU2NTc0NTV9LCJmb3YiOjYyLCJoZWFkaW5nRGVnIjowLCJwaXRjaERlZyI6MTAuOSwibW9kZSI6IndhbGsifSwiZGF0ZSI6IjIwMjYtMDYtMjBUMTM6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## ask-round-crown

A round crown under the crosshair: ask it — an ellipsoid outline.

For: 080 step 6, 019 M (outline).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMTExLjgyLCJ5IjoxMTUuNywieiI6LTMyMi41fSwiZXBzZyI6eyJ4Ijo0MTIwMDIuNCwieSI6NTY1NzM0MH0sImZvdiI6NjIsImhlYWRpbmdEZWciOjAsInBpdGNoRGVnIjoyMi4wOCwibW9kZSI6IndhbGsifSwiZGF0ZSI6IjIwMjYtMDYtMjBUMTM6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6ZmFsc2UsImJpa2VMYXllciI6ZmFsc2UsInRyYW1MYXllciI6ZmFsc2V9fQ
```

## ask-bridge

The Albertbrücke from the side, its deck under the crosshair: ask it — the outline follows the deck and its piers.

For: 080 step 6, 019 M (outline).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi01MjQuMDIsInkiOjE1NS4wNSwieiI6MTgwLjJ9LCJlcHNnIjp7IngiOjQxMjU5MC4yLCJ5Ijo1NjU2ODM3LjN9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjo1NywicGl0Y2hEZWciOi0xNC4yMiwibW9kZSI6ImZseSJ9LCJkYXRlIjoiMjAyNi0wNi0yMFQxMzowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## traffic-albertstrasse

Albertstraße from 50 m on a weekday morning with *Kfz-Verkehr* on: on a desktop GPU how long the bodies hold the compile lane after the switch-on; ask a flow for the outline.

For: 083 finding 4, 019 M (outline).

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi05NTQuMjIsInkiOjE2NC4yOCwieiI6LTEzMi41fSwiZXBzZyI6eyJ4Ijo0MTIxNjAsInkiOjU2NTcxNTB9LCJmb3YiOjU1LCJoZWFkaW5nRGVnIjozNTEuNDcsInBpdGNoRGVnIjotMTQuMDMsIm1vZGUiOiJmbHkifSwiZGF0ZSI6IjIwMjYtMTEtMDRUMDc6MDA6MDAuMDAwWiIsImxvb2siOnsibXVsdGlUdWZ0Ijp0cnVlLCJzdHlsZSI6InBhc3RlbCIsImZvZ1BjdCI6MjAsInRyYWZmaWNMYXllciI6dHJ1ZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```

## ask-frauenkirche

The Neumarkt with the Frauenkirche ahead: the start for the device checks of *Frag die Stadt* (reading aloud, Hörmodus, dictation) — ask about the church.

For: 084.

```text
/dresden?snap=eyJ2IjoxLCJjYW1lcmEiOnsicG9zIjp7IngiOi0xMzg0LjIyLCJ5IjoxMTQuODQsInoiOjc3Ny41fSwiZXBzZyI6eyJ4Ijo0MTE3MzAsInkiOjU2NTYyNDB9LCJmb3YiOjY2LCJoZWFkaW5nRGVnIjozMiwicGl0Y2hEZWciOjEwLCJtb2RlIjoid2FsayJ9LCJkYXRlIjoiMjAyNi0wNi0yMFQxMDowMDowMC4wMDBaIiwibG9vayI6eyJtdWx0aVR1ZnQiOnRydWUsInN0eWxlIjoicGFzdGVsIiwiZm9nUGN0IjoyMCwidHJhZmZpY0xheWVyIjpmYWxzZSwiYmlrZUxheWVyIjpmYWxzZSwidHJhbUxheWVyIjpmYWxzZX19
```
