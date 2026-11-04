/**
 * The Sprachführer's voice (ADR 0057): *Frag die Stadt* read aloud and
 * asked by speaking, with the browser's own Web Speech API — no service of
 * the site's, no model of its own. Reading aloud runs on the device;
 * dictation is the browser's (Chrome and Safari send the audio to their
 * maker's servers, which the privacy page says). Where a browser has
 * neither, the card shows neither.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "./storage-keys";
import { useOnce } from "./use-once";

// reason: SpeechRecognition is not in TypeScript's DOM library yet; the
// part used here, typed by hand.
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  addEventListener: (
    type: "error",
    listener: (event: { error: string }) => void
  ) => void;
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
const MARKDOWN_LINK = new RegExp(
  String.raw`\[(?<words>[^\]]+)\]\(${LINK}\)`,
  "gu"
);
/** (link) or (Quelle: link): gone with its brackets */
const BRACKETED_LINK = new RegExp(
  String.raw`\s?\((?:Quelle:\s*)?${LINK}\)`,
  "gu"
);
/** a bare link */
const BARE_LINK = new RegExp(String.raw`\s?${LINK}`, "gu");

const UNITS = [
  "",
  "ein",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
];
const TEENS = [
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];
const TENS = [
  "",
  "",
  "zwanzig",
  "dreißig",
  "vierzig",
  "fünfzig",
  "sechzig",
  "siebzig",
  "achtzig",
  "neunzig",
];

/** 1–99 in German words ("eins" alone, "einund…" in a compound). */
function below100(n: number): string {
  if (n < 10) {
    return n === 1 ? "eins" : UNITS[n];
  }
  if (n < 20) {
    return TEENS[n - 10];
  }
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)];
  return unit === 0 ? tens : `${UNITS[unit]}und${tens}`;
}

/**
 * A year as German says it: 1711 "siebzehnhundertelf", 2013
 * "zweitausenddreizehn" — a voice reading the digits says
 * "eintausendsiebenhundertelf", which no one does. 1100–2099 only.
 */
export function yearWords(year: number): string {
  const rest = year % 100;
  const tail = rest === 0 ? "" : below100(rest);
  if (year >= 2000) {
    return `zweitausend${tail}`;
  }
  return `${TEENS[Math.floor(year / 100) - 10]}hundert${tail}`;
}

/** Shortenings a voice reads letter by letter or stumbles on. */
const SPOKEN: [RegExp, string][] = [
  [/\bz\. ?B\./gu, "zum Beispiel"],
  [/\bca\./gu, "circa"],
  [/\bNr\./gu, "Nummer"],
  [/\bSt\. (?=[A-ZÄÖÜ])/gu, "Sankt "],
  [/\bu\. ?a\./gu, "unter anderem"],
  [/\bv\. Chr\./gu, "vor Christus"],
  [/\bn\. Chr\./gu, "nach Christus"],
  [/(?<n>\d)\s?km\b/gu, "$<n> Kilometer"],
  [/(?<n>\d)\s?%/gu, "$<n> Prozent"],
];

/** Words a year follows ("im Juni 1813", "seit 1990"). */
const BEFORE_YEAR =
  /(?:^|[\s(])(?:im|seit|bis|von|um|ab|nach|vor|anno|Jahre?|zwischen|und|oder|Ende|Anfang|Mitte|Sommer|Herbst|Winter|Frühjahr|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s$/iu;

/** A measure after a number: it counts, whatever stands before it. */
const UNIT_AFTER = /^\s(?:Meter|Kilometer|Quadratmeter|Kubikmeter|Prozent)\b/u;

/** "1800 Leute", "1200 Meter": a number before a noun counts something,
 *  unless the words before it make it a year ("im Mai 1945 Truppen");
 *  one before a measure always does ("um 1900 Meter"). */
function isCount(text: string, at: number): boolean {
  if (UNIT_AFTER.test(text.slice(at + 4, at + 20))) {
    return true;
  }
  const noun = /^\s[A-ZÄÖÜ]/u.test(text.slice(at + 4, at + 6));
  return noun && !BEFORE_YEAR.test(text.slice(Math.max(0, at - 16), at));
}

/**
 * Text as it should be heard: no web links (the card shows them; a
 * Markdown link keeps its words), no list marks or Markdown stars, "m" and
 * "m²" as words, years as German says them, shortenings spelled out, a
 * dash or a bracket as the pause it is, quotation marks unspoken.
 */
export function speakable(text: string): string {
  let out = text
    .replaceAll(MARKDOWN_LINK, "$<words>")
    .replaceAll(BRACKETED_LINK, "")
    .replaceAll(BARE_LINK, "")
    .replaceAll(/^[ \t]*[-*•][ \t]+/gmu, "")
    // Markdown's marks, but not an underscore inside a word (DESN_0815)
    .replaceAll(/[*#`]|(?<!\w)_|_(?!\w)/gu, "")
    // a line without its own end is a sentence still: a list item, a heading
    // (after a number a pause: "1726." reads as an ordinal)
    .replaceAll(/(?<n>\d)[ \t]*\n+/gu, "$<n>; ")
    .replaceAll(/(?<c>[^\s.!?:;,])[ \t]*\n+/gu, "$<c>. ")
    .replaceAll(/(?<n>\d)\s?m²/gu, "$<n> Quadratmeter")
    .replaceAll(/(?<n>\d)\s?m³/gu, "$<n> Kubikmeter")
    .replaceAll(/(?<n>\d)\s?m(?![\p{L}\d])/gu, "$<n> Meter");
  for (const [pattern, words] of SPOKEN) {
    out = out.replaceAll(pattern, words);
  }
  return (
    out
      // a year alone (not 35.798, not a span's 1,5): as German says it
      .replaceAll(
        /(?<![\w.,])(?<year>1[1-9]\d\d|20\d\d)(?![\d.,]\d)/gu,
        (y: string, _: string, at: number, all: string) =>
          isCount(all, at) ? y : yearWords(Number(y))
      )
      .replaceAll(/\s[–—]\s/gu, ", ")
      .replaceAll(/[„“”"»«]/gu, "")
      .replaceAll(/\s+/gu, " ")
      .trim()
  );
}

/** A voice the card can offer: its name, and whether the text leaves. */
export interface VoiceChoice {
  name: string;
  /** spoken by a service (Google's, Microsoft's): the text goes there */
  online: boolean;
}

/** How natural a voice's name says it sounds: the better, the higher. */
function voiceRank(v: SpeechSynthesisVoice): number {
  const { name } = v;
  let rank = 0;
  if (/natural|neural|premium|enhanced|erweitert|siri/iu.test(name)) {
    rank += 4;
  }
  if (/google/iu.test(name)) {
    rank += 3;
  }
  if (/compact|espeak|kompakt/iu.test(name)) {
    rank -= 4;
  }
  return rank + (v.lang.toLowerCase() === "de-de" ? 1 : 0);
}

function germanVoices(): SpeechSynthesisVoice[] {
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("de"))
    .sort((a, b) => voiceRank(b) - voiceRank(a));
}

/**
 * The voice to read with: the visitor's choice where the device has it,
 * else the best one on the device — an online voice only by choice (the
 * privacy page: nothing leaves the device unless the visitor picks one).
 * Null where the device has only online voices and none was picked: then
 * nothing is read, since the browser's own default may be online.
 */
function chosenVoice(
  chosen: string | null,
  voices: readonly SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  return (
    voices.find((v) => v.name === chosen) ??
    voices.find((v) => v.localService) ??
    null
  );
}

function storedVoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.voice);
  } catch {
    return null;
  }
}

/** Where one sentence ends and the next begins: not after an ordinal's
 *  point ("am 15. September"), after a year's; the next starts with a
 *  capital, a figure, or a year `speakable` put in words. */
const SENTENCE_END = new RegExp(
  String.raw`(?<=(?:[^\d\s]|\d{3})[.!?:;]|\d[!?:;])\s+(?=[A-ZÄÖÜ„"0-9])` +
    // a year in words starts one after a full stop, not after a label's colon
    String.raw`|(?<=[.!?;])\s+(?=(?:${TEENS.slice(1).join("|")})hundert|zweitausend)`,
  "u"
);

/** Sentences, each its own utterance: a long one is cut off by some
 *  voices (Chrome's online ones stop after about fifteen seconds), and a
 *  sentence's end is where a voice should breathe anyway. */
export function sentences(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The pace the voices read at: a touch slower than their default, which
 *  hurries a told story. */
const RATE = 0.94;

export interface Speech {
  /**
   * Starts the speech engine from a tap: iOS Safari speaks only what a
   * gesture began, and an answer is read later, from an effect.
   */
  prime: () => void;
  speak: (text: string) => void;
  stop: () => void;
  supported: boolean;
  /** the German voices the device offers, the best first */
  voices: VoiceChoice[];
  /** the voice reading now (its name), or null for none there */
  voice: string | null;
  /** picks a voice, remembered on this device */
  setVoice: (name: string) => void;
}

/**
 * Reading aloud, one text at a time; a new one cuts the last off. Only
 * where the device has a German voice (an online one reads only once
 * picked) — the voices load late, so `supported` follows them.
 */
export function useSpeech(): Speech {
  const supportedApi = useOnce(
    () => typeof window !== "undefined" && "speechSynthesis" in window
  );
  const [chosen, setChosen] = useState<string | null>(() =>
    supportedApi ? storedVoice() : null
  );
  // the voices arrive late in Chrome: listed once they are there
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    // a list the same as before keeps its identity: a stop being read is
    // not cut off and started again; a reload that briefly lists none
    // keeps the voices it had, and the switch does not vanish
    const list = () => {
      setVoices((was) => {
        const now = germanVoices();
        const same =
          now.length === was.length && now.every((v, i) => v === was[i]);
        return same || now.length === 0 ? was : now;
      });
    };
    if (supportedApi) {
      list();
      // (older Safari: speechSynthesis is no EventTarget, the one list stands)
      speechSynthesis.addEventListener?.("voiceschanged", list);
    }
    return () => {
      if (supportedApi) {
        speechSynthesis.removeEventListener?.("voiceschanged", list);
      }
    };
  }, [supportedApi]);
  // reading aloud where the device has a German voice to read with
  const supported = voices.length > 0;
  const stop = useCallback(() => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
  }, []);
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
      const voice = chosenVoice(chosen, voices);
      if (!(voice && words)) {
        return;
      }
      speechSynthesis.cancel();
      for (const sentence of sentences(words)) {
        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.lang = voice.lang;
        utterance.rate = RATE;
        utterance.voice = voice;
        speechSynthesis.speak(utterance);
      }
    },
    // the first list arrives late: a text asked for before it is read
    // once the voices are there (the caller's effect runs again)
    [chosen, voices]
  );
  const setVoice = useCallback((name: string) => {
    setChosen(name);
    try {
      localStorage.setItem(STORAGE_KEYS.voice, name);
    } catch {
      // not remembered: this page still reads with it
    }
  }, []);
  // a closed card stops talking
  useEffect(() => stop, [stop]);
  const choices = useMemo(
    () => voices.map((v) => ({ name: v.name, online: !v.localService })),
    [voices]
  );
  const voice = useMemo(
    () => chosenVoice(chosen, voices)?.name ?? null,
    [voices, chosen]
  );
  return useMemo(
    () => ({
      prime,
      speak,
      stop,
      supported,
      voices: choices,
      voice,
      setVoice,
    }),
    [prime, speak, stop, supported, choices, voice, setVoice]
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
    case "no-speech": {
      // they stopped, or said nothing: nothing to explain
      return null;
    }
    case "not-allowed":
    case "service-not-allowed": {
      return "Das Mikrofon ist für diese Seite nicht freigegeben.";
    }
    case "audio-capture": {
      return "Kein Mikrofon gefunden.";
    }
    case "network": {
      return "Die Spracherkennung des Browsers ist nicht erreichbar.";
    }
    case "language-not-supported": {
      return "Der Browser erkennt kein Deutsch.";
    }
    default: {
      return "Die Spracherkennung hat nicht geklappt.";
    }
  }
}

/** Push to talk: one question per press, in German. */
export function useDictation(): Dictation {
  const supported = useOnce(() => recognitionClass() !== null);
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
    r.addEventListener("error", (event) =>
      setProblem(dictationProblem(event.error))
    );
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
