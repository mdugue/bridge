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
   reads each finished answer aloud with `speechSynthesis` (a tap starts
   the engine, which iOS needs; a device without a German voice shows no
   reading aloud) and
   takes a spoken question with `SpeechRecognition` (push to talk, one
   question per press). A browser without either shows neither. A spoken
   question turns reading aloud on; while it is on, every request tells
   the server (`voice`), whose prompt then asks for short spoken
   sentences — the provider learns that much, never the audio.
2. **Read as German says it, on the device unless chosen otherwise.**
   The text is prepared for the ear first (`speakable`: years as words,
   shortenings spelled out, dashes as pauses; links, list marks and
   Markdown left out, a line's end heard as a sentence's) and read
   sentence by sentence, a touch slower than the voice's default. The
   best German voice on the device reads; the card lists the others, an
   online one (Google's in Chrome, Microsoft's in Edge, `localService`
   false) marked as such, and reads with it only when the visitor picks
   it, remembered in `vorlese-stimme`.
3. **`was_ist_da` asks the twin what stands where the view points** (its
   centre; in Modell the preset's pivot, where a place is put), once a
   glide has landed and the tiles there have come
   (`inquireAt`, ADR 0042), opens its card and gives the model the card's
   lines, so "what is that" is answered from the measured data.
4. **The Hörmodus rests the scene.** A switch lays a soft vignette and the
   loop draws two frames a second while the scene stands still, 30 while
   a glide or live mode moves it (`FramePace.setListening`). Its banner,
   its switch, turning reading aloud off or closing the card ends it.

## Consequences

- An online voice sends the text it reads to its maker; the privacy page
  says so, and nothing is sent unless the visitor chose that voice.
- Dictation goes through the browser maker (Chrome and Safari send the
  audio to Google's and Apple's servers); the privacy page says so. The
  site only ever gets the recognised text.
- Voices and recognition differ by browser; Firefox has no recognition,
  and typing stays the way in.
- Nothing new loads before the card opens; the Hörmodus lowers a phone's
  GPU work.
