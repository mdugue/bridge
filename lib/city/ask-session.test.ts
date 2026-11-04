import { beforeEach, describe, expect, test } from "bun:test";
import { createAskSession } from "./ask-session";
import type { AskSession, AskSessionEvent } from "./ask-session";

/** Every port's calls, in the order they came. */
let calls: string[] = [];
/** Whether the device has a voice; whether the microphone opens. */
const device = { voice: true, mic: true };

/** The ports' second adapters: each records its calls. */
function fakeSpeech() {
  return {
    prime: () => calls.push("speech.prime"),
    speak: (text: string) => calls.push(`speech.speak:${text}`),
    stop: () => calls.push("speech.stop"),
    supported: () => device.voice,
  };
}
function fakeDictation() {
  return {
    start: () => {
      calls.push("dictation.start");
      return device.mic;
    },
    stop: () => calls.push("dictation.stop"),
    abort: () => calls.push("dictation.abort"),
  };
}
function fakeWaits() {
  return {
    abandon: () => calls.push("waits.abandon"),
    setListening: (on: boolean) => calls.push(`waits.setListening:${on}`),
    haltAnswerGlide: () => calls.push("waits.haltAnswerGlide"),
  };
}
function fakeRun() {
  return {
    send: (text: string, voice: boolean) =>
      calls.push(`run.send:${text}:${voice}`),
    stop: () => calls.push("run.stop"),
  };
}

let session: AskSession;
const dispatch = (event: AskSessionEvent) => session.dispatch(event);

beforeEach(() => {
  calls = [];
  device.voice = true;
  device.mic = true;
  session = createAskSession({
    speech: fakeSpeech(),
    dictation: fakeDictation(),
    waits: fakeWaits(),
  });
  session.attachRun(fakeRun());
});

/** Asks, and lets the answer run and end with `text`. */
function answered(text: string, { failed = false } = {}) {
  dispatch({ type: "typed", text: "Frage?" });
  dispatch({ type: "answerStarted" });
  dispatch({ type: "answerEnded", text, failed });
}

/** Clears the record, so a test reads only what follows. */
const since = () => {
  calls = [];
};

describe("asking", () => {
  test("a typed question stops the last reading and is sent with the reading's voice", () => {
    expect(dispatch({ type: "typed", text: "Wo?" })).toBe("sent");
    expect(calls).toEqual(["speech.stop", "run.send:Wo?:false"]);
    dispatch({ type: "answerStarted" });
    dispatch({ type: "answerEnded", text: "Da.", failed: false });
    dispatch({ type: "readingPressed" });
    since();
    dispatch({ type: "typed", text: "Und?" });
    // reading on: the engine is primed from the tap that asked
    expect(calls).toEqual([
      "speech.stop",
      "speech.prime",
      "run.send:Und?:true",
    ]);
  });

  test("a typed question is refused while an answer loads", () => {
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    since();
    expect(dispatch({ type: "typed", text: "Und?" })).toBe("ignored");
    expect(calls).toEqual([]);
  });

  test("a spoken question turns reading on and is asked with a voice", () => {
    expect(dispatch({ type: "spoken", text: "Was ist das?" })).toBe("sent");
    expect(session.state().reading).toBe(true);
    expect(calls).toEqual([
      "speech.stop",
      "speech.prime",
      "run.send:Was ist das?:true",
    ]);
  });

  test("a spoken question on a device without a voice asks without one", () => {
    device.voice = false;
    dispatch({ type: "spoken", text: "Was ist das?" });
    expect(session.state().reading).toBe(false);
    expect(calls).toEqual(["speech.stop", "run.send:Was ist das?:false"]);
  });

  test("a spoken question waits in the field while an answer loads or the key is checked", () => {
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    since();
    expect(dispatch({ type: "spoken", text: "Und?" })).toBe("draft");
    dispatch({ type: "answerEnded", text: "Da.", failed: false });
    dispatch({ type: "paused", on: true });
    expect(dispatch({ type: "spoken", text: "Und?" })).toBe("draft");
    expect(calls).toEqual([]);
  });
});

describe("the microphone", () => {
  test("a tap opens it, stopping and priming the voice first", () => {
    dispatch({ type: "micPressed" });
    expect(calls).toEqual(["speech.stop", "speech.prime", "dictation.start"]);
  });

  test("a tap on the open microphone ends it", () => {
    dispatch({ type: "micPressed" });
    since();
    dispatch({ type: "micPressed" });
    expect(calls).toEqual(["dictation.stop"]);
  });

  test("it does not open while an answer loads", () => {
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    since();
    expect(dispatch({ type: "micPressed" })).toBe("ignored");
    expect(calls).toEqual([]);
  });

  test("an answer that ends into the open microphone is read once it closes", () => {
    dispatch({ type: "readingPressed" });
    dispatch({ type: "micPressed" });
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    since();
    dispatch({ type: "answerEnded", text: "Da.", failed: false });
    expect(calls).toEqual([]);
    dispatch({ type: "micClosed" });
    expect(calls).toEqual(["speech.speak:Da."]);
  });

  test("a microphone that did not open owes nothing", () => {
    device.mic = false;
    dispatch({ type: "readingPressed" });
    dispatch({ type: "micPressed" });
    since();
    answered("Da.");
    expect(calls.at(-1)).toBe("speech.speak:Da.");
  });
});

describe("an answer's end", () => {
  test("a finished answer is read while reading is on", () => {
    dispatch({ type: "readingPressed" });
    since();
    answered("Da.");
    expect(calls.at(-1)).toBe("speech.speak:Da.");
  });

  test("a finished answer is not read while reading is off", () => {
    answered("Da.");
    expect(calls.filter((c) => c.startsWith("speech.speak"))).toEqual([]);
  });

  test("a tool-resume gap reads nothing", () => {
    dispatch({ type: "readingPressed" });
    since();
    answered("");
    expect(calls.filter((c) => c.startsWith("speech.speak"))).toEqual([]);
  });

  test("a failed answer leaves the waits", () => {
    dispatch({ type: "readingPressed" });
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    since();
    dispatch({ type: "answerEnded", text: "Da.", failed: true });
    expect(calls).toEqual([]);
  });

  test("an answer that ends while the page is hidden is read at once", () => {
    // no visibility event exists: the session reads when the answer ends
    dispatch({ type: "readingPressed" });
    since();
    answered("Da.");
    expect(calls.at(-1)).toBe("speech.speak:Da.");
  });
});

describe("the stop button", () => {
  test("ends the run, then its waits; the answer is not read", () => {
    dispatch({ type: "readingPressed" });
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    since();
    dispatch({ type: "stopPressed" });
    expect(calls).toEqual(["run.stop", "waits.abandon"]);
    dispatch({ type: "answerEnded", text: "Da halb", failed: false });
    expect(calls).toEqual(["run.stop", "waits.abandon"]);
  });

  test("stop leaves the glide", () => {
    dispatch({ type: "typed", text: "Zeig!" });
    dispatch({ type: "answerStarted" });
    since();
    dispatch({ type: "stopPressed" });
    expect(calls).not.toContain("waits.haltAnswerGlide");
  });

  test("an answer after a stopped one is read again", () => {
    dispatch({ type: "readingPressed" });
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    dispatch({ type: "stopPressed" });
    dispatch({ type: "answerEnded", text: "", failed: false });
    since();
    answered("Da.");
    expect(calls.at(-1)).toBe("speech.speak:Da.");
  });
});

describe("the switches", () => {
  test("Vorlesen on primes the voice", () => {
    dispatch({ type: "readingPressed" });
    expect(session.state()).toEqual({ reading: true, hearing: false });
    expect(calls).toEqual(["speech.prime"]);
  });

  test("reading on reads nothing past", () => {
    answered("Da.");
    since();
    dispatch({ type: "readingPressed" });
    expect(calls).toEqual(["speech.prime"]);
  });

  test("Vorlesen off silences, ends the Hörmodus and drops an owed answer", () => {
    dispatch({ type: "hearingPressed" });
    dispatch({ type: "micPressed" });
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    dispatch({ type: "answerEnded", text: "Da.", failed: false });
    since();
    dispatch({ type: "readingPressed" });
    expect(session.state()).toEqual({ reading: false, hearing: false });
    expect(calls).toEqual(["speech.stop", "waits.setListening:false"]);
    since();
    dispatch({ type: "micClosed" });
    expect(calls).toEqual([]);
  });

  test("Hörmodus on primes the voice, turns reading on and rests the scene", () => {
    dispatch({ type: "hearingPressed" });
    expect(session.state()).toEqual({ reading: true, hearing: true });
    expect(calls).toEqual(["speech.prime", "waits.setListening:true"]);
  });

  test("hearing off keeps reading", () => {
    dispatch({ type: "hearingPressed" });
    since();
    dispatch({ type: "hearingPressed" });
    expect(session.state()).toEqual({ reading: true, hearing: false });
    expect(calls).toEqual(["waits.setListening:false"]);
  });

  test("the state stays the same object until a switch changes", () => {
    const before = session.state();
    dispatch({ type: "typed", text: "Wo?" });
    expect(session.state()).toBe(before);
    let heard = 0;
    const unsubscribe = session.subscribe(() => {
      heard += 1;
    });
    dispatch({ type: "readingPressed" });
    expect(heard).toBe(1);
    expect(session.state()).not.toBe(before);
    unsubscribe();
  });
});

describe("the card", () => {
  test("a key form mid-answer: the answer runs on hidden and is read", () => {
    dispatch({ type: "readingPressed" });
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    dispatch({ type: "paused", on: true });
    since();
    dispatch({ type: "answerEnded", text: "Da.", failed: false });
    expect(calls).toEqual(["speech.speak:Da."]);
  });

  test("a new key ends the conversation's run, waits, voice and microphone; the switches stay", () => {
    dispatch({ type: "hearingPressed" });
    since();
    dispatch({ type: "conversationEnded" });
    expect(calls).toEqual([
      "run.stop",
      "waits.abandon",
      "speech.stop",
      "dictation.abort",
    ]);
    expect(session.state()).toEqual({ reading: true, hearing: true });
  });

  test("a forgotten key ends the Hörmodus and reading", () => {
    dispatch({ type: "hearingPressed" });
    since();
    dispatch({ type: "keyForgotten" });
    expect(session.state()).toEqual({ reading: false, hearing: false });
    expect(calls).toEqual(["waits.setListening:false"]);
  });

  test("closing ends the run, its waits, the voice, the microphone and the Hörmodus", () => {
    dispatch({ type: "hearingPressed" });
    dispatch({ type: "typed", text: "Wo?" });
    dispatch({ type: "answerStarted" });
    since();
    dispatch({ type: "closed" });
    expect(calls).toEqual([
      "run.stop",
      "waits.abandon",
      "speech.stop",
      "dictation.abort",
      "waits.setListening:false",
    ]);
    expect(calls).not.toContain("waits.haltAnswerGlide");
  });

  test("a detached run is not asked", () => {
    const detach = session.attachRun(fakeRun());
    detach();
    since();
    expect(dispatch({ type: "typed", text: "Wo?" })).toBe("ignored");
    expect(calls).toEqual([]);
  });
});

describe("invariants", () => {
  test("commands run inside dispatch, before it returns", () => {
    dispatch({ type: "readingPressed" });
    // iOS: the tap's call stack is the dispatch's
    expect(calls).toEqual(["speech.prime"]);
    since();
    answered("Da.");
    expect(calls.at(-1)).toBe("speech.speak:Da.");
  });

  test("the run stops before the waits are abandoned, everywhere", () => {
    for (const end of ["stopPressed", "conversationEnded", "closed"] as const) {
      since();
      dispatch({ type: "typed", text: "Wo?" });
      dispatch({ type: "answerStarted" });
      dispatch({ type: end });
      const stop = calls.indexOf("run.stop");
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf("waits.abandon")).toBeGreaterThan(stop);
      session.attachRun(fakeRun());
      dispatch({ type: "answerEnded", text: "", failed: false });
    }
  });

  test("nothing is spoken while the microphone is open", () => {
    dispatch({ type: "readingPressed" });
    dispatch({ type: "micPressed" });
    since();
    answered("Da.");
    dispatch({ type: "readingPressed" });
    dispatch({ type: "readingPressed" });
    expect(calls.filter((c) => c.startsWith("speech.speak"))).toEqual([]);
  });
});
