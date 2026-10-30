# ADR 0057: The Sprachführer speaks and listens with the browser's own voice, and the scene rests while it does

- **Status:** accepted
- **Date:** 2026-10

## Context

*Frag die Stadt* (ADR 0056) on a real walk: the phone in the pocket,
"Was ist das da vorne?", the answer in the ear. A voice service of the
site's would be a second provider, a second bill and the visitor's audio
on a server; a phone that renders 60 frames a second for a visitor who
listens wastes its battery.

## Decision

1. **The browser speaks and listens.** `app/_components/ask-voice.ts`
   reads each finished answer aloud with `speechSynthesis` (a German
   voice, a local one first; links, list marks and Markdown left out) and
   takes a spoken question with `SpeechRecognition` (push to talk, one
   question per press). A browser without either shows neither. A spoken
   question turns reading aloud on and tells the server (`voice`), whose
   prompt then asks for short spoken sentences.
2. **`was_ist_da` asks the twin what stands at the view's centre**
   (`inquireAt`, ADR 0042), opens its card and gives the model the card's
   lines, so "what is that" is answered from the measured data.
3. **The Hörmodus rests the scene.** A switch lays a soft vignette and the
   loop draws two frames a second while the scene stands still, 20 while
   a glide or live mode moves it (`FramePace.setListening`). A tap or
   closing the card ends it.

## Consequences

- Dictation goes through the browser maker (Chrome and Safari send the
  audio to Google's and Apple's servers); the privacy page says so. The
  site only ever gets the recognised text.
- Voices and recognition differ by browser; Firefox has no recognition,
  and typing stays the way in.
- Nothing new loads before the card opens; the Hörmodus lowers a phone's
  GPU work.
