# Writing a walk

How the *Erzählte Spaziergänge* are written, checked and shown
([ADR 0055](./adr/0055-stadtwissen-and-written-walks.md)). A walk is a
file, `data/<site>/walks/<id>.json` (`lib/city/walks.ts` is its shape);
the build bundles a site's walks into `walks.json`, and the viewer plays
them from the panel's *Erkunden → Spaziergänge*.

## What makes a walk worth taking

Before the first four Dresden walks were written we asked what makes a
city tour interesting, from the interpretation literature and from the
guides who write about their craft:

- **Relate, reveal, provoke, make it whole** (Freeman Tilden's
  principles of heritage interpretation, 1957, still the canon of the
  U.S. National Park Service): a stop that only lists facts is
  information, not interpretation. Tie it to something the listener
  knows, reveal a meaning behind the surface, provoke a question rather
  than close one, and let the stops add up to one idea.
- **A through-line, not a list of sights.** The good tours are stories
  with a theme — power as theatre, a city's wounds, a district's
  stubbornness — and the stops are its chapters. Each walk here has one,
  named in its teaser.
- **Serial vision** (Gordon Cullen, *Townscape*, 1961): a city is
  experienced as a sequence of views, each revealed by the last — a
  narrow passage opening onto a square, a tower appearing over roofs.
  Alternate near and far, ground and air, open and closed; save the
  widest view for the end.
- **The detail you would walk past.** The remembered moments are the
  small, odd and funny ones: the gilded king looking towards Poland, the
  dairy shop tiled like a chapel, the bridge that cost two pfennigs, the
  drainpipes that play music in the rain. Each stop has a *closer look*:
  something to find in the picture or in the stop's photo.
- **Point only at what the model draws** (ADR 0055). The twin has
  masses, roof planes, towers, bridges, river and ground; a statue is a
  generic figure, and reliefs, inscriptions, colours and interiors are
  not there. "Vor dir die Kuppel" is fine; "Schau auf das Relief" is
  not, unless the photo shows it: then say so ("Auf dem Foto …"). A
  sentence starting with *Schau, Sieh, Achte, Zoom, Zähl* or *Such* must
  name the photo, or the check refuses it.
- **People with their flaws.** Kings, mistresses, architects and
  shopkeepers are more interesting than styles; their vanity and their
  stubbornness carry a story.
- **Legend is told as legend.** A tour may tell what people say (Schiller
  wrote *Ode to Joy* in the summerhouse — perhaps), but it says so. Only a
  claim a source states goes into `facts`.
- **Today matters.** A stop can say more on certain days (the
  consecration's anniversary, the night of 13 February, Advent's
  Striezelmarkt) and in a season (the Elbe meadows in summer, bare trees
  that open a view in winter). The viewer shows the stop today, at the
  hour the stop names: a facade in evening light, a square at night.
- **End with orientation.** The last stop is a view that puts the walk
  together: the whole stage seen from across the river, the valley from
  the hill.

Sources: Tilden, *Interpreting Our Heritage* (1957), via the NPS's
[history of interpretation](https://www.nps.gov/parkhistory/online_books/mackintosh2/interp_interp.htm);
Cullen, *Townscape* (1961); Forbidden Vancouver,
[What makes a great walking tour](https://forbiddenvancouver.ca/what-makes-a-great-walking-tour/);
[Journal of Tourism and Hospitality, *storytelling in guided tours*](https://jtos.polban.ac.id/JTOSPOLBAN/article/view/72);
[the tour guide as interpreter (University of Suffolk)](https://oars.uos.ac.uk/4769/).

## The file

```jsonc
{
  "id": "augusts-buehne",          // kebab-case, the file's name
  "title": "Augusts Bühne",
  "teaser": "Die Altstadt als Theater der Macht: …",
  "by": "Claude",                   // shown on every stop
  "written": "2026-10-29",
  "minutes": 25,
  "stops": [{
    "id": "zwinger-hof",
    "title": "Ein Festplatz ohne Schloss",
    "from": [411180, 5656380, 1.6], // eye: x, y (site CRS), metres above the ground
    "ground": 112.4,                // the DGM under the eye (written by the script)
    "at": [411197, 5656449, 125],   // what it looks at: x, y, height a.s.l.
    "fov": 60,                      // optional lens
    "hour": 10.5,                   // today at 10:30
    "style": "pastel",              // optional picture style
    "text": "…",                    // ≤ 560 characters, a phone screen
    "closer": "…",                  // the detail to find
    "days": [{ "from": "10-25", "to": "11-04", "text": "…" }],
    "seasons": { "winter": "…" },
    "facts": [{ "claim": "…", "source": "https://…" }],
    "refs": ["Q4176", "m411594_5656615"],
    "photo": {
      "file": "Kronentor (Zwinger, Dresden).jpg",
      "caption": "…",
      "focus": [0.5, 0.3]             // optional: what a crop keeps in sight
    }
  }]
}
```

A `source` is an https URL (Wikipedia, an institution's page, a paper) or
`stadtwissen:<id>` — a Q-id, a building's gml:id or a monument's
`m<x>_<y>` from the Stadtwissen.

## How the card shows it

- **The photo** keeps its proportion. A wide one spans the card above
  the story, cut only past a height (17rem, 8rem on a phone) and then
  round its `focus` (shares of width and height from the top left, the
  centre when absent); its caption and credit lie on its lower edge. A
  tall one (narrower than 0.85 of its height, `photoIsTall`) stands
  beside the story, which flows round it; on a phone, whose card is too
  narrow for both, it lies above the story like a wide one. A click
  shows it whole.
- **The places.** The build turns each `refs` id the Stadtwissen knows
  into a place (`places`: name, position, footprint radius;
  `stopPlaces`). Where the story or the closer look names one — by its
  name, its name without Wikidata's subtitle or place ("Kügelgenhaus",
  "Pöppelmannbrücke"), with its adjective declined ("der Katholischen
  Hofkirche"), or its noun alone ("diese Hofkirche": not where another
  place, or the adjective before it, says another is meant — "das Alte
  Rathaus" — nor where a name goes on, "Bahnhof Mitte") — the name is a
  button that picks it in the scene and
  opens its card, as in *Frag die Stadt*. The ones the text only points
  at ("das Opernhaus vor dir") stand in a row, *Im Bild*, under it.
- **The hour** turns with the glide: the light travels from the last
  stop's hour to this one's at the camera's own progress (`glideTo`,
  fed by the flight's `onProgress`), eased as the glide is, so it stops
  where the camera stops (an export's held frames) and lands with it.
  The scene follows every frame, the HUD a few times a second.
- **The voice** reads the title as its own sentence, slower and a little
  higher, then a pause; the story; today's notes and the closer look
  after its label, each set off by a pause and said a little lower
  (`stopSpeech`, `spokenLines`).
- **On a phone** the card is a sheet at the bottom, at most 62 % of the
  screen high, that starts folded: the title and the way on, the scene
  above free. Its handle unfolds it by a tap or a drag up and folds it by
  a drag down; folded, it shows no photo and no story. The stick and
  the toolbar step aside while it is up; a drag still looks about.

## Writing one

1. **Find the material** in the Stadtwissen (after `bun dev` or
   `bun run build` has published it):
   `bun scripts/stadtwissen.ts dresden such Kügelgenhaus`,
   `… nah 411600 5656600 120`, `… wahrzeichen Zwinger`. It gives
   positions, heights, gml:ids and Wikidata's facts with their sources.
2. **Check every claim** against a source you can link, and write it into
   `facts` as the stop tells it. What no source says goes into the
   narration as a legend or not at all.
3. **Place the eye.** Pick `from` and `at` on a map of the area (the
   positions above, the minimap); keep the eye at 1.6 m for a walker's
   view, higher for a view from the air (above 3 m the stop flies).
4. **Measure the ground:** `DGM_CACHE=1 bun scripts/walks.ts dresden
   ground` writes each stop's `ground` from the DGM1.
5. **Check it:** `bun scripts/walks.ts dresden check` and
   `bun test scripts/walks.test.ts`.
6. **Pick a photo** where the text needs one: a Commons file that shows
   the detail the text tells (the statue, the relief, the interior), named
   in `photo.file`, with a `caption` where it is not obvious. `bun
   scripts/walks.ts dresden photos` copies it as an 800 px WebP into
   `walks/photos/` and writes the credit (author, licence, page); `--refs`
   suggests the first ref's Wikidata image for stops that name none,
   `--force` fetches again. Commit the WebP and credit with the walk: without them the
   build shows the stop without a photo and the walks' unit test fails.
7. **Look at it:** `bun scripts/walks.ts dresden shots [walk]` writes a
   snapshot per stop into `shots/` (today's date at the stop's hour, its
   style), `bun run shots` renders them on a real GPU. Move `from`/`at`
   until the picture shows what the text says, then measure the ground
   again.

## Checks

`scripts/walks.test.ts`, over every committed walk: well formed
(`walkProblems`: ids, a fact per stop, a checkable source per fact, the
hour, the style, no Modell view, MM-DD days, the text's length, a
photo's credit, no look sent where the model shows nothing);
every eye and target inside the site's tiles; every `ground` within
0.2 m of the DGM1; every Stadtwissen id named one the build publishes.
`prepare-data.ts` refuses to bundle a walk with a problem.
