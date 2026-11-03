/**
 * The Sprachführer's voice (ADR 0057): *Frag die Stadt* read aloud and
 * asked by speaking, with the browser's own Web Speech API — no service of
 * the site's, no model of its own. Reading aloud runs on the device;
 * dictation is the browser's (Chrome and Safari send the audio to their
 * maker's servers, which the privacy page says). Where a browser has
 * neither, the card shows neither.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// reason: SpeechRecognition is not in TypeScript's DOM library yet; the
// part used here, typed by hand.
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// a web link, with at most one level of brackets in it (Zwinger_(Dresden))
// (a sentence's full stop after it is not the link's)
const LINK = String.raw`https?:\/\/(?:[^\s()]|\([^\s()]*\))*(?:[^\s().,;:!?]|\([^\s()]*\))`;
/** [words](link): the words stay */
const MARKDOWN_LINK = new RegExp(String.raw`\[([^\]]+)\]\(${LINK}\)`, "g");
/** (link) or (Quelle: link): gone with its brackets */
const BRACKETED_LINK = new RegExp(
  String.raw`\s?\((?:Quelle:\s*)?${LINK}\)`,
  "g"
);
/** a bare link */
const BARE_LINK = new RegExp(String.raw`\s?${LINK}`, "g");

/**
 * Text as it should be heard: no web links (the card shows them; a
 * Markdown link keeps its words), no list marks or Markdown stars, "m" and
 * "m²" as words.
 */
export function speakable(text: string): string {
  return (
    text
      .replace(MARKDOWN_LINK, "$1")
      .replace(BRACKETED_LINK, "")
      .replace(BARE_LINK, "")
      .replace(/^[ \t]*[-*•][ \t]+/gm, "")
      // Markdown's marks, but not an underscore inside a word (DESN_0815)
      .replace(/[*#`]|(?<!\w)_|_(?!\w)/g, "")
      // a line without its own end is a sentence still: a list item, a heading
      // (after a number a comma: "1726." reads as an ordinal)
      .replace(/(\d)[ \t]*\n+/g, "$1, ")
      .replace(/([^\s.!?:;,])[ \t]*\n+/g, "$1. ")
      .replace(/(\d)\s?m²/g, "$1 Quadratmeter")
      .replace(/(\d)\s?m³/g, "$1 Kubikmeter")
      .replace(/(\d)\s?m\b/g, "$1 Meter")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * The device's own German voice, or null. Only a local one: a network
 * voice (Chrome's "Google Deutsch") would send the answer to its maker,
 * and the privacy page promises that reading aloud stays on the device.
 */
function germanVoice(): SpeechSynthesisVoice | null {
  const local = speechSynthesis
    .getVoices()
    .filter((v) => v.localService && v.lang.toLowerCase().startsWith("de"));
  // the device's default first, then Germany's German (dictation's too)
  const rank = (v: SpeechSynthesisVoice) =>
    (v.default ? 0 : 2) + (v.lang.toLowerCase() === "de-de" ? 0 : 1);
  return local.toSorted((a, b) => rank(a) - rank(b))[0] ?? null;
}

export interface Speech {
  /**
   * Starts the speech engine from a tap: iOS Safari speaks only what a
   * gesture began, and an answer is read later, from an effect.
   */
  prime: () => void;
  speak: (text: string) => void;
  stop: () => void;
  supported: boolean;
}

/**
 * Reading aloud, one text at a time; a new one cuts the last off. Only
 * where the device has a German voice of its own — the voices load late,
 * so `supported` follows them.
 */
export function useSpeech(): Speech {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      return;
    }
    const pick = () => setVoice(germanVoice());
    pick();
    speechSynthesis.addEventListener("voiceschanged", pick);
    return () => speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);
  const supported = voice !== null;
  const stop = useCallback(() => {
    if (supported) {
      speechSynthesis.cancel();
    }
  }, [supported]);
  const primed = useRef(false);
  const prime = useCallback(() => {
    if (supported && !primed.current) {
      primed.current = true;
      // a silent word, not an empty text: WebKit may skip that unstarted
      const silent = new SpeechSynthesisUtterance(" ");
      silent.volume = 0;
      speechSynthesis.speak(silent);
    }
  }, [supported]);
  const speak = useCallback(
    (text: string) => {
      const words = speakable(text);
      if (!(voice && words)) {
        return;
      }
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(words);
      utterance.lang = voice.lang;
      utterance.voice = voice;
      speechSynthesis.speak(utterance);
    },
    [voice]
  );
  // a closed card stops talking
  useEffect(() => stop, [stop]);
  return useMemo(
    () => ({ prime, speak, stop, supported }),
    [prime, speak, stop, supported]
  );
}

export interface Dictation {
  /** why the last attempt heard nothing, in German; null when it did */
  problem: string | null;
  listening: boolean;
  /** listens for one question and hands it over when it ends */
  start: (onText: (text: string) => void) => void;
  stop: () => void;
  supported: boolean;
}

/** What a recognition error tells the visitor; null where it is theirs. */
export function dictationProblem(error: string): string | null {
  switch (error) {
    case "aborted":
    case "no-speech":
      // they stopped, or said nothing: nothing to explain
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Das Mikrofon ist für diese Seite nicht freigegeben.";
    case "audio-capture":
      return "Kein Mikrofon gefunden.";
    case "network":
      return "Die Spracherkennung des Browsers ist nicht erreichbar.";
    case "language-not-supported":
      return "Der Browser erkennt kein Deutsch.";
    default:
      return "Die Spracherkennung hat nicht geklappt.";
  }
}

/** Push to talk: one question per press, in German. */
export function useDictation(): Dictation {
  const [supported] = useState(() => recognitionClass() !== null);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = useRef<Recognition | null>(null);
  const stop = useCallback(() => {
    current.current?.stop();
  }, []);
  const start = useCallback((onText: (text: string) => void) => {
    const Class = recognitionClass();
    if (!Class || current.current) {
      return;
    }
    const r = new Class();
    r.lang = "de-DE";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (event) => {
      const text = Array.from(event.results)
        .map((alternatives) => alternatives[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) {
        onText(text);
      }
    };
    r.onerror = (event) => setProblem(dictationProblem(event.error));
    r.onend = () => {
      current.current = null;
      setListening(false);
    };
    setProblem(null);
    try {
      r.start();
    } catch {
      setProblem(dictationProblem("start"));
      return;
    }
    current.current = r;
    setListening(true);
  }, []);
  useEffect(() => () => current.current?.abort(), []);
  return useMemo(
    () => ({ listening, problem, start, stop, supported }),
    [listening, problem, start, stop, supported]
  );
}
