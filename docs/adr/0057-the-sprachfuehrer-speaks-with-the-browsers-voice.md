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
   voice of the device's own, never a network voice, so the answer stays
   on the device; a device without one shows no reading aloud; links,
   list marks and Markdown left out; a tap starts the engine, which iOS
   needs). Switched on, reading aloud starts with the last finished
   answer. An answer is never read into an open microphone — it waits
   until the microphone closes — and is read at once even with the page
   hidden, as long as the page still runs. A stopped or failed answer is
   never read. The browser takes a spoken question with
   `SpeechRecognition` (push to talk, one question per press). A
   browser without either shows neither. A spoken
   question turns reading aloud on; while it is on, every request tells
   the server (`voice`), whose prompt then asks for short spoken
   sentences — the provider learns that much, never the audio.
2. **`was_ist_da` asks the twin what stands where the view points** (its
   centre; in Modell the preset's pivot, where a place is put), once a
   glide has landed and the tiles there have come
   (`inquireAt`, ADR 0042), opens its card and gives the model the card's
   lines, so "what is that" is answered from the measured data.
3. **The Hörmodus rests the scene.** A switch lays a soft vignette and the
   loop draws two frames a second while the scene stands still, 30 while
   a glide or live mode moves it (`FramePace.setListening`). Its banner,
   its switch, turning reading aloud off or closing the card ends it.
   Ending it turns reading aloud off again when the Hörmodus turned it
   on; reading the visitor chose stays.
4. **One session owns an answer's lifetime.** `lib/city/ask-session.ts`
   takes the answer's events (asked, started, ended, stopped, the
   microphone, the switches, the card) and drives reading aloud, the
   microphone, the scene and the run through four ports. The stop button
   halts the answer's run, then its glide (the camera stops where it is;
   a glide the visitor started since goes on). Stopping the run ends a
   scene tool's wait too: the tool holds the chat client's own abort
   signal, and the client drops what a stopped tool ends with. A failed
   answer ends its run the same way, so no scene tool resumes it. Every
   command runs inside the tap's dispatch, for iOS speaks only what a
   tap began.

## Consequences

- Dictation goes through the browser maker (Chrome and Safari send the
  audio to Google's and Apple's servers); the privacy page says so. The
  site only ever gets the recognised text.
- Voices and recognition differ by browser; Firefox has no recognition,
  and typing stays the way in.
- Nothing new loads before the card opens; the Hörmodus lowers a phone's
  GPU work.
- The lifetime's rules are unit-tested against fakes of the four ports
  (`ask-session.test.ts`); a new rule goes there, never into a handler
  of the card.
