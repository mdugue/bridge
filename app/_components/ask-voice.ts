/**
 * The Sprachführer's voice (ADR 0057): *Frag die Stadt* read aloud and
 * asked by speaking, with the browser's own Web Speech API — no service of
 * the site's, no model of its own. Reading aloud runs on the device;
 * dictation is the browser's (Chrome and Safari send the audio to their
 * maker's servers, which the privacy page says). Where a browser has
 * neither, the card shows neither.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Text as it should be heard: no web links (the card shows them), no
 * list marks or Markdown stars, "m" and "m²" as words.
 */
export function speakable(text: string): string {
  return text
    .replace(/\s?\(?https?:\/\/[^\s)]+\)?/g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[*_#`]/g, "")
    .replace(/(\d)\s?m²/g, "$1 Quadratmeter")
    .replace(/(\d)\s?m\b/g, "$1 Meter")
    .replace(/\s+/g, " ")
    .trim();
}

/** The best German voice the device has: a local one first. */
function germanVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("de"));
  return voices.find((v) => v.localService) ?? voices[0] ?? null;
}

export interface Speech {
  speak: (text: string) => void;
  speaking: boolean;
  stop: () => void;
  supported: boolean;
}

/** Reading aloud, one text at a time; a new one cuts the last off. */
export function useSpeech(): Speech {
  const [supported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window
  );
  const [speaking, setSpeaking] = useState(false);
  const stop = useCallback(() => {
    if (supported) {
      speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, [supported]);
  const speak = useCallback(
    (text: string) => {
      const words = speakable(text);
      if (!(supported && words)) {
        return;
      }
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(words);
      utterance.lang = "de-DE";
      const voice = germanVoice();
      if (voice) {
        utterance.voice = voice;
      }
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      speechSynthesis.speak(utterance);
    },
    [supported]
  );
  // a closed card stops talking
  useEffect(() => stop, [stop]);
  return { speak, speaking, stop, supported };
}

export interface Dictation {
  listening: boolean;
  /** listens for one question and hands it over when it ends */
  start: (onText: (text: string) => void) => void;
  stop: () => void;
  supported: boolean;
}

/** Push to talk: one question per press, in German. */
export function useDictation(): Dictation {
  const [supported] = useState(() => recognitionClass() !== null);
  const [listening, setListening] = useState(false);
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
    r.onerror = () => undefined;
    r.onend = () => {
      current.current = null;
      setListening(false);
    };
    current.current = r;
    setListening(true);
    r.start();
  }, []);
  useEffect(() => () => current.current?.abort(), []);
  return { listening, start, stop, supported };
}
