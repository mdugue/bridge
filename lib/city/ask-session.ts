/**
 * An answer's lifetime in *Frag die Stadt* (ADR 0056, 0057): asked (typed
 * or spoken), streaming, waiting on a scene tool, done, failed or
 * stopped — and what reading aloud, the microphone, the Hörmodus and the
 * scene's waits do at each turn of it. One session per card
 * (`app/_components/ask-city.tsx` creates it and turns the chat's and the
 * microphone's edges into events); it takes events and calls four ports.
 * Pure: no DOM, no React, no timer.
 *
 * Every command runs inside `dispatch`, in the caller's call stack: iOS
 * speaks only what a tap began, so `prime` and `speak` from a pressed
 * event must not wait for an effect, a promise or a timer.
 */

/** Reading aloud (`useSpeech`: speechSynthesis, a local voice). */
export interface SpeechPort {
  /** starts the engine from a tap (iOS) */
  prime: () => void;
  speak: (text: string) => void;
  stop: () => void;
  /** whether the device has a voice to read with (it loads late) */
  supported: () => boolean;
}

/** Push to talk (`useDictation`: the browser's SpeechRecognition). */
export interface DictationPort {
  /** listens for one question; whether the microphone opened */
  start: () => boolean;
  /** ends listening: the question heard so far is handed over */
  stop: () => void;
  /** ends listening and drops what was heard */
  abort: () => void;
}

/** The scene's half (`useAskScene`). */
export interface SceneWaitsPort {
  /** ends the scene tools' waits (`was_ist_da`) */
  abandon: () => void;
  /** the Hörmodus's frame pace */
  setListening: (on: boolean) => void;
  /** stops the glide an answer started, if it still flies */
  haltAnswerGlide: () => void;
}

/** The conversation's chat (`useChat`), attached while it is mounted. */
export interface RunPort {
  send: (text: string, voice: boolean) => void;
  stop: () => void;
}

export interface AskSessionPorts {
  speech: SpeechPort;
  dictation: DictationPort;
  waits: SceneWaitsPort;
}

export type AskSessionEvent =
  /** a typed question or a suggestion */
  | { type: "typed"; text: string }
  /** a question the microphone heard */
  | { type: "spoken"; text: string }
  /** the chat started loading */
  | { type: "answerStarted" }
  /** the chat stopped loading: the answer's text (empty between a scene
   *  tool's requests) and whether the chat holds an error */
  | { type: "answerEnded"; text: string; failed: boolean }
  | { type: "stopPressed" }
  | { type: "micPressed" }
  /** the microphone stopped listening */
  | { type: "micClosed" }
  | { type: "readingPressed" }
  /** the switch, or the banner while the Hörmodus is on */
  | { type: "hearingPressed" }
  /** the key form opened (the conversation runs on, hidden) or closed */
  | { type: "paused"; on: boolean }
  /** the conversation unmounted: another key, or the key forgotten */
  | { type: "conversationEnded" }
  | { type: "keyForgotten" }
  /** the card closed */
  | { type: "closed" };

/** What a dispatch did: a spoken question asked (`sent`), or left for the
 *  field (`draft`); `ignored` for a question refused, `done` otherwise. */
export type AskSessionResult = "sent" | "draft" | "ignored" | "done";

/** What the switches show. */
export interface AskSessionState {
  reading: boolean;
  hearing: boolean;
}

export interface AskSession {
  dispatch: (event: AskSessionEvent) => AskSessionResult;
  /** the same object until something the switches show changes */
  state: () => AskSessionState;
  subscribe: (listener: () => void) => () => void;
  /** the conversation's run; returns its detach */
  attachRun: (run: RunPort) => () => void;
}

/** One card's session, over its ports. */
export function createAskSession(ports: AskSessionPorts): AskSession {
  const { speech, dictation, waits } = ports;
  let run: RunPort | null = null;
  let reading = false;
  let hearing = false;
  let loading = false;
  let stopped = false;
  let micOpen = false;
  let paused = false;
  /** a finished answer waits for the microphone to close */
  let owed: string | null = null;

  let snapshot: AskSessionState = { reading, hearing };
  const listeners = new Set<() => void>();
  const publish = () => {
    if (snapshot.reading === reading && snapshot.hearing === hearing) {
      return;
    }
    snapshot = { reading, hearing };
    for (const listener of listeners) {
      listener();
    }
  };

  /** Reads `text` now, or once the microphone closes: never into it, which
   *  would hear the answer as a question. */
  const read = (text: string) => {
    if (micOpen) {
      owed = text;
    } else {
      owed = null;
      speech.speak(text);
    }
  };

  const setHearing = (on: boolean) => {
    hearing = on;
    waits.setListening(on);
  };

  /**
   * Ends the running answer: the run first, then the scene's waits — a
   * scene tool that returns at the abort would otherwise resume the run
   * with one more request on the visitor's key.
   */
  const endRun = () => {
    run?.stop();
    waits.abandon();
  };

  const ask = (text: string, voice: boolean): AskSessionResult => {
    if (loading || !run) {
      return "ignored";
    }
    // the last answer stops: the next one is on its way
    speech.stop();
    if (voice) {
      speech.prime();
    }
    run.send(text, voice);
    return "sent";
  };

  const handlers: {
    [K in AskSessionEvent["type"]]: (
      event: Extract<AskSessionEvent, { type: K }>
    ) => AskSessionResult;
  } = {
    typed: ({ text }) => ask(text, reading),
    spoken: ({ text }) => {
      // one heard while an answer loads, or while the key is checked
      // again (its token would be refused), waits in the field
      if (loading || paused) {
        return "draft";
      }
      // read aloud only where the device can: a voice-style answer
      // nobody hears, with no switch to undo it, helps no one
      reading = speech.supported();
      return ask(text, reading);
    },
    answerStarted: () => {
      loading = true;
      stopped = false;
      owed = null;
      return "done";
    },
    answerEnded: ({ text, failed }) => {
      loading = false;
      // between a scene tool's requests: the answer is not done yet
      if (text === "") {
        return "done";
      }
      if (failed || stopped) {
        return "done";
      }
      if (reading) {
        read(text);
      }
      return "done";
    },
    stopPressed: () => {
      // a stopped answer is owed no more, and not read
      stopped = true;
      owed = null;
      endRun();
      return "done";
    },
    micPressed: () => {
      if (micOpen) {
        dictation.stop();
        return "done";
      }
      // no second question by voice while an answer is on its way
      if (loading) {
        return "ignored";
      }
      speech.stop();
      speech.prime();
      micOpen = dictation.start();
      return "done";
    },
    micClosed: () => {
      micOpen = false;
      if (owed !== null && reading) {
        read(owed);
      }
      owed = null;
      return "done";
    },
    readingPressed: () => {
      if (reading) {
        speech.stop();
        // the Hörmodus promises the answers read aloud
        if (hearing) {
          setHearing(false);
        }
        reading = false;
        owed = null;
      } else {
        speech.prime();
        reading = true;
      }
      return "done";
    },
    hearingPressed: () => {
      if (hearing) {
        setHearing(false);
      } else {
        speech.prime();
        reading = true;
        setHearing(true);
      }
      return "done";
    },
    paused: ({ on }) => {
      paused = on;
      return "done";
    },
    conversationEnded: () => {
      endRun();
      speech.stop();
      dictation.abort();
      loading = false;
      stopped = false;
      micOpen = false;
      owed = null;
      return "done";
    },
    keyForgotten: () => {
      if (hearing) {
        setHearing(false);
      }
      reading = false;
      owed = null;
      return "done";
    },
    closed: () => {
      endRun();
      speech.stop();
      dictation.abort();
      setHearing(false);
      reading = false;
      owed = null;
      return "done";
    },
  };

  return {
    dispatch: (event) => {
      const handle = handlers[event.type] as (
        e: AskSessionEvent
      ) => AskSessionResult;
      const result = handle(event);
      publish();
      return result;
    },
    state: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachRun: (next) => {
      run = next;
      return () => {
        if (run === next) {
          run = null;
        }
      };
    },
  };
}
