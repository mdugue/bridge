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
   reads each finished answer aloud with `speechSynthesis` and takes a
   spoken question with `SpeechRecognition` (push to talk, one question
   per press). A browser without either shows neither. A spoken
   question turns reading aloud on and tells the server (`voice`), whose
   prompt then asks for short spoken sentences.
2. **Read as German says it, with Google Deutsch where the browser has
   it.** The text is prepared for the ear first (`speakable`: years as
   words, shortenings spelled out, dashes as pauses; links, list marks
   and Markdown left out) and read sentence by sentence, a touch slower
   than the voice's default. A told text comes in parts with a tone
   (`SpokenPart`): a walk stop's title slower and a little higher, its
   notes and closer look a little lower after their label, a pause after
   each part (`spokenLines`; the API has pace, pitch and the wait between
   utterances, no emphasis of single words). The visitor's pick reads;
   without one, Chrome's online "Google Deutsch" — the one voice that
   reads a story well (maintainer's call, 2026-10-31) —, else the best
   German voice on the device. The card lists them all, online ones
   (Google's, Microsoft's, `localService` false) marked as such; the
   pick is remembered in `vorlese-stimme`.
3. **`was_ist_da` asks the twin what stands at the view's centre**
   (`inquireAt`, ADR 0042), opens its card and gives the model the card's
   lines, so "what is that" is answered from the measured data.
4. **The Hörmodus rests the scene.** A switch lays a soft vignette and the
   loop draws two frames a second while the scene stands still, 20 while
   a glide or live mode moves it (`FramePace.setListening`). A tap or
   closing the card ends it.

## Consequences

- An online voice sends the text it reads to its maker. In Chrome that
  is Google, by default, once reading aloud is switched on; the privacy
  page says so, and picking a device voice keeps the text on the device.
- Dictation goes through the browser maker (Chrome and Safari send the
  audio to Google's and Apple's servers); the privacy page says so. The
  site only ever gets the recognised text.
- Voices and recognition differ by browser; Firefox has no recognition,
  and typing stays the way in.
- Nothing new loads before the card opens; the Hörmodus lowers a phone's
  GPU work.
