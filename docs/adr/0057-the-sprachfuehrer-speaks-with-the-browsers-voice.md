# ADR 0057: The Sprachführer speaks and listens with the browser's own voice, and the scene rests while it does

- **Status:** accepted
- **Date:** 2026-10

## Context

The third step of the agentic concept: *Frag die Stadt* (ADR 0056) on a
real walk — the phone in the pocket, "Was ist das da vorne?", the answer
in the ear. Three things decide how:

- **No voice service of the site's.** A text-to-speech or speech-to-text
  model would be a second provider, a second key or a bill, and audio of
  the visitor on a server.
- **A phone's battery.** The scene renders 30 to 120 frames a second; a
  visitor who listens does not look.
- **The question is about the real view.** In live mode (`live-mode.ts`)
  the camera follows GPS and compass, so the view's centre is roughly
  what the visitor faces.

## Decision

**The browser speaks and listens.** `app/_components/ask-voice.ts` reads
each finished answer aloud with `speechSynthesis` (a German voice, a
local one first; links, list marks and Markdown left out, units as
words) and takes a spoken question with `SpeechRecognition` (push to
talk, one question per press, German). A browser without either shows
neither; a spoken question turns reading aloud on, and the request tells
the server so (`voice`), whose prompt then asks for short spoken
sentences without lists, links or coordinates.

**One more scene tool: `was_ist_da`.** It asks the twin what stands at
the view's centre (`inquireAt`, ADR 0042), opens its card in the viewer
and gives the model the card's lines — kind, name, address, facts,
sources — so "what is that" is answered from the measured data, not the
model's guess.

**The Hörmodus rests the scene.** A switch in the card darkens the
screen and lets the render loop draw at two frames a second while the
scene stands still (`FramePace.setListening`, `LISTENING_FPS`): enough
for `was_ist_da` to see the current view, a sliver of the GPU's work.
While it moves — a glide an answer started, live mode following the
walker — it draws at 20 (`LISTENING_MOVING_FPS`): the loop clamps its
time step to 0.05 s, so at two frames a glide would take ten times as
long. A tap ends it; closing the card ends it.

## Consequences

- Dictation goes through the browser maker (Chrome and Safari send the
  audio to Google's and Apple's servers); the privacy page says so. The
  site never gets audio, only the recognised text, as a typed question.
- Voices and recognition differ by browser and device; Firefox has no
  recognition. Typing stays the way in.
- Nothing new loads before the card opens; the Hörmodus lowers a phone's
  GPU work rather than adding any.

## Alternatives

- **A speech model through the visitor's provider** (OpenAI's voices,
  realtime APIs): a second cost per answer, and only for some providers.
- **Pausing the loop entirely**: live mode and the centre question would
  see a stale camera.
- **Continuous listening ("hey city")**: a microphone always open on a
  phone in a pocket.

## References

- `app/_components/ask-voice.ts`, `ask-city.tsx` (`VoiceBar`,
  `useReadAloud`, the Hörmodus), `ask-scene.ts` (`look`, `setListening`)
- `lib/city/frame-pace.ts` (`setListening`), `lib/city/ask-tools.ts`
  (`was_ist_da`), `lib/city/ask-city.ts` (the spoken prompt)
- ADR 0042, 0056
