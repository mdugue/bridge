"use client";

/**
 * *Frag die Stadt* (ADR 0056): the card where a visitor asks about the
 * city with their own key. Its own chunk (city-walk.tsx loads it on the
 * first open), so the chat client, the tool schemas and this card cost a
 * visitor nothing until they ask — and nothing of three.js is in it.
 *
 * The answers are generated and say so; the tools the model used stand
 * in one line above the answer (a click lists each), so the visitor sees
 * what it looked up and what it did to the view, and the places it
 * showed are links in its text. The first questions read the moment
 * (`lib/city/ask-starters.ts`).
 */
import {
  fetchServerSentEvents,
  type UIMessage,
  useChat,
} from "@tanstack/ai-react";
import {
  EarIcon,
  KeyRoundIcon,
  LoaderIcon,
  MapPinIcon,
  MessageCircleQuestionIcon,
  MicIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  SquarePenIcon,
  Volume2Icon,
  VolumeXIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASK_KEY_HEADER,
  ASK_LIMITS,
  ASK_PROVIDER_BY_ID,
  ASK_PROVIDERS,
  type AskProviderId,
  maskedKey,
  plausibleKey,
  CUT_SHORT,
  providerForKey,
  TOO_LONG,
  TOO_MANY_STEPS,
} from "@/lib/city/ask-city";
import { nearReach } from "@/lib/city/ask-knowledge";
import { type MentionRun, mentionRuns } from "@/lib/city/ask-mentions";
import { starterQuestions } from "@/lib/city/ask-starters";
import { NEAR_RADIUS } from "@/lib/city/ask-tools";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "cn";
import { AnswerChipRows, answerChips, shownPlaces } from "./ask-chips";
import { type AskKey, clearAskKey, readAskKey, writeAskKey } from "./ask-key";
import {
  type AskPlace,
  type AskScene,
  sceneTools,
  showPlaces,
} from "./ask-scene-tools";
import { useSite } from "./site-context";
import {
  type Dictation,
  type Speech,
  useDictation,
  useSpeech,
} from "./ask-voice";

interface Props {
  coarse: boolean;
  onClose: () => void;
  scene: AskScene;
  site: string;
}

export default function AskCity({ coarse, onClose, scene, site }: Props) {
  const [key, setKey] = useState<AskKey | null>(() => {
    const stored = readAskKey();
    // a key checked without a token (a server not yet set up, or a local
    // one) is checked again rather than refused at the first question
    return stored?.token && stored.expires > Date.now() ? stored : null;
  });
  // the Hörmodus (the Sprachführer, ADR 0057): a soft vignette, the scene
  // barely drawn, the answers read aloud
  const [hearing, setHearing] = useState(false);
  // read aloud: kept here, so a new key does not silence a Hörmodus
  const [reading, setReading] = useState(false);
  // a new conversation is a new card body: a new thread, new first questions
  const [round, setRound] = useState(0);
  useEffect(() => {
    scene.setListening(hearing);
    return () => scene.setListening(false);
  }, [scene, hearing]);
  // the key the conversation runs on, kept while the form is open
  const [held, setHeld] = useState(key);
  return (
    <>
      {hearing && (
        <>
          {/* a soft vignette, not a blackout: the city stays visible */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(0_0_0/0.28))]"
          />
          <button
            aria-label="Hörmodus beenden"
            className="pointer-events-auto absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-[12px] text-white/85 shadow-sm backdrop-blur-sm hover:bg-black/60"
            data-testid="ask-hearing"
            onClick={() => setHearing(false)}
            type="button"
          >
            Hörmodus · die Antworten werden vorgelesen · beenden
          </button>
        </>
      )}
      <section
        aria-label="Frag die Stadt"
        className={cn(
          "pointer-events-auto absolute z-30 flex flex-col rounded-xl bg-background/95 shadow-xl backdrop-blur-lg",
          coarse
            ? "top-3 right-16 left-3 max-h-[55dvh]"
            : "bottom-6 left-4 h-[min(34rem,calc(100%-3rem))] w-[min(24rem,calc(100%-2rem))] lg:w-[26rem]"
        )}
        data-testid="ask-card"
      >
        <header className="flex items-start gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium tracking-[0.14em] text-primary uppercase">
              Frag die Stadt
            </p>
            <h2 className="font-heading text-base leading-tight">
              {key
                ? `${ASK_PROVIDER_BY_ID[key.provider].label} · ${ASK_PROVIDER_BY_ID[key.provider].models.find((m) => m.id === key.model)?.label ?? key.model}`
                : "Mit deinem eigenen Schlüssel"}
            </h2>
          </div>
          {key && (
            <button
              aria-label="Neues Gespräch"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              data-testid="ask-new"
              onClick={() => setRound((r) => r + 1)}
              title="Neues Gespräch beginnen"
              type="button"
            >
              <SquarePenIcon className="size-4" />
            </button>
          )}
          {key && (
            <button
              aria-label="Schlüssel ändern"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setKey(null)}
              title={`Schlüssel ${maskedKey(key.key)} ändern`}
              type="button"
            >
              <KeyRoundIcon className="size-4" />
            </button>
          )}
          <button
            aria-label="Frag die Stadt schließen"
            className="-mr-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            title="Schließen"
            type="button"
          >
            <XIcon className="size-4" />
          </button>
        </header>
        {held && (
          // a renewed token keeps the conversation: it stays mounted, hidden,
          // while the key is checked again, and remounts only for another key
          <div className={key ? "contents" : "hidden"}>
            <Conversation
              askKey={key ?? held}
              hearing={hearing}
              key={`${held.provider}:${held.key}:${round}`}
              onHearing={setHearing}
              onKeyProblem={() => setKey(null)}
              paused={!key}
              reading={reading}
              scene={scene}
              setReading={setReading}
              site={site}
            />
          </div>
        )}
        {!key && (
          <KeyForm
            // a forgotten key ends the conversation that runs on it
            onForget={() => {
              setHeld(null);
              setHearing(false);
              setReading(false);
            }}
            onKey={(k) => {
              writeAskKey(k);
              setKey(k);
              setHeld(k);
            }}
          />
        )}
      </section>
    </>
  );
}

// --- the key ------------------------------------------------------------------

function KeyForm({
  onForget,
  onKey,
}: {
  onForget: () => void;
  onKey: (key: AskKey) => void;
}) {
  const [stored, setStored] = useState(readAskKey);
  const [provider, setProvider] = useState<AskProviderId>(
    stored?.provider ?? "anthropic"
  );
  const [model, setModel] = useState(
    stored?.model ?? ASK_PROVIDER_BY_ID.anthropic.models[0].id
  );
  // a stored key whose token ran out comes back for one more check
  const [text, setText] = useState(stored?.key ?? "");
  const [remember, setRemember] = useState(stored?.remember ?? false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const def = ASK_PROVIDER_BY_ID[provider];

  const pickProvider = (id: AskProviderId) => {
    setProvider(id);
    setModel(ASK_PROVIDER_BY_ID[id].models[0].id);
  };
  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const key = text.trim();
    if (!plausibleKey(key)) {
      setProblem("Das sieht nicht nach einem Schlüssel aus.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/schluessel", {
        method: "POST",
        headers: { "Content-Type": "application/json", [ASK_KEY_HEADER]: key },
        body: JSON.stringify({ provider }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        expires?: number;
        message?: string;
        token?: string;
      };
      if (!res.ok) {
        setProblem(body.message ?? `Die Prüfung schlug fehl (${res.status}).`);
        return;
      }
      onKey({
        provider,
        model,
        key,
        remember,
        token: body.token ?? "",
        expires: body.expires ?? Date.now() + ASK_LIMITS.tokenMs,
      });
    } catch {
      setProblem("Keine Verbindung zum Server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 text-[13px]"
      onSubmit={(e) => void submit(e)}
    >
      <p className="leading-relaxed text-foreground/90">
        Frag nach Gebäuden, Plätzen und Geschichte — die Antwort zeigt dir den
        Ort im Modell. Das Sprachmodell läuft mit deinem eigenen Schlüssel und
        auf deine Kosten; eine Frage kostet meist unter einem Cent.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Anbieter</span>
        <select
          className="rounded-md border bg-background px-2 py-1.5"
          onChange={(e) => pickProvider(e.target.value as AskProviderId)}
          value={provider}
        >
          {ASK_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Modell</span>
        <select
          className="rounded-md border bg-background px-2 py-1.5"
          onChange={(e) => setModel(e.target.value)}
          value={model}
        >
          {def.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">
          Schlüssel ({def.prefix}…) ·{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href={def.keysUrl}
            rel="noreferrer"
            target="_blank"
          >
            einen erstellen
          </a>
        </span>
        <input
          autoComplete="off"
          className="rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
          data-testid="ask-key"
          onChange={(e) => {
            setText(e.target.value);
            // from ten characters on, so typing "sk-" does not jump to
            // OpenAI on the way to "sk-ant-"
            const guess =
              e.target.value.trim().length >= 10
                ? providerForKey(e.target.value)
                : null;
            if (guess && guess !== provider) {
              pickProvider(guess);
            }
          }}
          placeholder={`${def.prefix}…`}
          spellCheck={false}
          type="password"
          value={text}
        />
      </label>
      <label className="flex items-start gap-2 text-[12px]">
        <input
          checked={remember}
          className="mt-0.5"
          onChange={(e) => setRemember(e.target.checked)}
          type="checkbox"
        />
        <span>
          Auf diesem Gerät merken. Sonst vergisst der Browser ihn, wenn der Tab
          schließt.
        </span>
      </label>
      {problem && (
        <p className="text-[12px] text-destructive" role="alert">
          {problem}
        </p>
      )}
      <Button disabled={busy || text.trim() === ""} size="sm" type="submit">
        {busy ? <LoaderIcon className="animate-spin" /> : <KeyRoundIcon />}
        Prüfen und loslegen
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Der Schlüssel bleibt in deinem Browser. Zu jeder Frage geht er über
        unseren Server direkt an {def.label}; gespeichert oder protokolliert
        wird er dort nicht.{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="/datenschutz#frag-die-stadt"
          target="_blank"
        >
          Datenschutz
        </a>
        {stored && (
          <>
            {" · "}
            <button
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                clearAskKey();
                setStored(null);
                onForget();
                setText("");
              }}
              type="button"
            >
              gespeicherten Schlüssel löschen
            </button>
          </>
        )}
      </p>
    </form>
  );
}

// --- the conversation -------------------------------------------------------------

/** A provider's error that names the key or the account's credit. */
const KEY_TROUBLE =
  /\b(401|402|403|unauthori[sz]ed|forbidden|authenticat\w*|api[ _-]?key|credits?|credentials?|quota|billing|insufficient)\b/i;
/** The same, as the code a provider's error carries. */
const KEY_CODES = new Set(["401", "402", "403"]);

/** A failed answer in words, by the status the server sent, and what
 *  the visitor can do about it: check the key again or start over. */
function errorText(error: Error): {
  key: boolean;
  reset: boolean;
  text: string;
} {
  const status = (error as { status?: unknown }).status;
  const say = (text: string, key = false, reset = false) => ({
    key,
    reset,
    text,
  });
  if (status === 401) {
    return say("Der Schlüssel muss neu geprüft werden.", true);
  }
  if (status === 400) {
    // an older page, or a model the server no longer offers
    return say(
      "Die Anfrage passt nicht zu diesem Server — lade die Seite neu."
    );
  }
  if (status === 413) {
    return say(TOO_LONG, false, true);
  }
  if (status === 422) {
    return say(`${TOO_MANY_STEPS} Frag bitte anders.`, false, true);
  }
  if (status === 404) {
    return say("Für diese Stadt gibt es kein Stadtwissen.");
  }
  if (status === 501) {
    return say("Frag die Stadt ist auf diesem Server nicht eingerichtet.");
  }
  if (typeof status === "number") {
    return say(`Der Server antwortet mit Status ${status}.`);
  }
  // a key revoked or out of credit after the check fails in the stream,
  // in the provider's words: offer the check again for those only
  const message = error.message || "Die Antwort brach ab.";
  const code = argText((error as { code?: unknown }).code);
  if (message === TOO_MANY_STEPS) {
    return say(`${TOO_MANY_STEPS} Frag bitte anders.`, false, true);
  }
  // the codes first, the provider's words only where no code says it
  if (KEY_CODES.has(code)) {
    return say(message, true);
  }
  // the adapters' codes for a spent output budget and a full context
  if (
    code === "max_tokens" ||
    (code === "incomplete" && message === "max_output_tokens")
  ) {
    return say(CUT_SHORT);
  }
  if (code === "context_overflow") {
    return say(TOO_LONG, false, true);
  }
  return say(message, KEY_TROUBLE.test(message));
}

/**
 * The text of a finished answer: its assistant messages since the last
 * question — empty while the last of them still waits on a tool (a scene
 * tool's run ends at the interrupt, and the answer comes after it).
 */
function lastAnswer(messages: readonly UIMessage[]): string {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.parts.at(-1)?.type !== "text") {
    return "";
  }
  const texts: string[] = [];
  for (
    let i = messages.length - 1;
    i >= 0 && messages[i].role !== "user";
    i--
  ) {
    texts.unshift(
      messages[i].parts
        .map((p) => (p.type === "text" ? p.content : ""))
        .join(" ")
    );
  }
  return texts.join(" ").trim();
}

/**
 * Reads each finished answer aloud while `on` — not one that broke off,
 * failed or was stopped (the returned call, for the stop button).
 */
function useReadAloud(
  messages: readonly UIMessage[],
  loading: boolean,
  failed: boolean,
  on: boolean,
  speech: Speech,
  listening: boolean
): () => void {
  const was = useRef(loading);
  const stopped = useRef(false);
  // an answer that ended while the microphone listened, read once it closes
  const owed = useRef(false);
  useEffect(() => {
    if (was.current && !loading) {
      owed.current = on && !failed && !stopped.current;
    }
    if (loading) {
      stopped.current = false;
      owed.current = false;
    }
    was.current = loading;
    // reading switched off since: owed no more
    if (!on) {
      owed.current = false;
    }
    // not into an open microphone: it would hear the answer as a question
    if (owed.current && !listening) {
      owed.current = false;
      speech.speak(lastAnswer(messages));
    }
  }, [loading, failed, on, messages, speech, listening]);
  return useCallback(() => {
    stopped.current = true;
    owed.current = false;
  }, []);
}

/** Read aloud, speak a question, the Hörmodus: where the browser can. */
function VoiceBar({
  busy,
  dictation,
  hearing,
  onHearing,
  onSpoken,
  reading,
  setReading,
  speech,
}: {
  /** an answer is on its way: no second question by voice */
  busy: boolean;
  dictation: Dictation;
  hearing: boolean;
  onHearing: (on: boolean) => void;
  onSpoken: (text: string) => void;
  reading: boolean;
  setReading: (on: boolean) => void;
  speech: Speech;
}) {
  // the question goes to the conversation as it is when it is heard
  const spoken = useRef(onSpoken);
  useEffect(() => {
    spoken.current = onSpoken;
  });
  if (!(speech.supported || dictation.supported)) {
    return null;
  }
  const chip =
    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground";
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
      {dictation.supported && (
        <button
          aria-pressed={dictation.listening}
          className={cn(chip, "disabled:opacity-50")}
          disabled={busy && !dictation.listening}
          onClick={() => {
            if (dictation.listening) {
              dictation.stop();
              return;
            }
            speech.stop();
            speech.prime();
            dictation.start((question) => spoken.current(question));
          }}
          title="Frage sprechen (der Browser erkennt die Sprache)"
          type="button"
        >
          <MicIcon className="size-3" />
          {dictation.listening ? "Ich höre …" : "Sprechen"}
        </button>
      )}
      {speech.supported && (
        <button
          aria-pressed={reading}
          className={chip}
          onClick={() => {
            if (reading) {
              speech.stop();
              // the Hörmodus promises the answers read aloud
              onHearing(false);
            } else {
              speech.prime();
            }
            setReading(!reading);
          }}
          title="Antworten vorlesen"
          type="button"
        >
          {reading ? (
            <Volume2Icon className="size-3" />
          ) : (
            <VolumeXIcon className="size-3" />
          )}
          Vorlesen
        </button>
      )}
      {speech.supported && (
        <button
          aria-pressed={hearing}
          className={chip}
          onClick={() => {
            if (!hearing) {
              speech.prime();
              setReading(true);
            }
            onHearing(!hearing);
          }}
          title="Hörmodus: die Szene ruht, die Antworten werden vorgelesen — für unterwegs, das Telefon in der Tasche"
          type="button"
        >
          <EarIcon className="size-3" />
          Hörmodus
        </button>
      )}
      {dictation.problem && (
        <span className="text-[11px] text-destructive" role="alert">
          {dictation.problem}
        </span>
      )}
    </div>
  );
}

function Conversation({
  askKey,
  paused,
  hearing,
  onHearing,
  onKeyProblem,
  reading,
  scene,
  setReading,
  site,
}: {
  askKey: AskKey;
  /** hidden while the key is checked again */
  paused: boolean;
  hearing: boolean;
  onHearing: (on: boolean) => void;
  onKeyProblem: () => void;
  reading: boolean;
  scene: AskScene;
  setReading: (on: boolean) => void;
  site: string;
}) {
  const speech = useSpeech();
  const dictation = useDictation();
  const tools = useMemo(() => sceneTools(scene), [scene]);
  // the conversation remounts for another key (keyed by it): fixed here
  const secret = askKey.key;
  const connection = useMemo(
    () =>
      fetchServerSentEvents("/api/frag", {
        headers: { [ASK_KEY_HEADER]: secret },
        // the route keeps no run to rejoin: a drop is the answer's end
        reconnect: { maxAttempts: 0 },
      }),
    [secret]
  );
  // one conversation per card: the provider's prompt cache is keyed by it
  const [threadId] = useState(() => crypto.randomUUID());
  // drawn once per conversation from the moment, not per render
  const [starters] = useState(() => starterQuestions(scene.moment()));
  const chat = useChat({
    threadId,
    connection,
    tools,
    forwardedProps: {
      site,
      provider: askKey.provider,
      model: askKey.model,
      token: askKey.token,
      voice: reading,
    },
  });
  // a closed conversation leaves no tool waiting on the scene
  // (the answer stops first: a tool that returns at the abort would
  // otherwise resume the run with one more request on the visitor's key)
  const stopChat = useRef(chat.stop);
  useEffect(() => {
    stopChat.current = chat.stop;
  });
  useEffect(
    () => () => {
      stopChat.current();
      scene.abandon();
    },
    [scene]
  );
  const stopReading = useReadAloud(
    chat.messages,
    chat.isLoading,
    chat.error !== undefined,
    reading,
    speech,
    dictation.listening
  );
  const [text, setText] = useState("");
  // `voice` with the question itself: a spoken one sets `reading` in the
  // same handler, before forwardedProps has seen it
  const ask = (question: string, voice = reading, fromField = true) => {
    const q = question.trim().slice(0, ASK_LIMITS.questionChars);
    if (q && !chat.isLoading) {
      if (fromField) {
        setText("");
      }
      // the last answer stops: the next one is on its way
      speech.stop();
      if (voice) {
        speech.prime();
      }
      void chat.sendMessage(q, { body: { voice } });
    }
  };
  // a spoken question gets a spoken answer; one heard while an answer
  // still loads waits in the field, as a typed one would
  const askSpoken = (question: string) => {
    // (or while the key is checked again: its token would be refused)
    if (chat.isLoading || paused) {
      // the microphone opened before a typed question went: it waits
      // in an empty field, never over what was typed
      setText((t) => t || question.slice(0, ASK_LIMITS.questionChars));
      return;
    }
    // read aloud only where the device can: a voice-style answer nobody
    // hears, with no switch to undo it, helps no one
    setReading(speech.supported);
    // a spoken question leaves a typed draft where it is
    ask(question, speech.supported, false);
  };
  // a renewed token (same key, no remount) clears the error it answered
  // (each check sets a new expiry, with or without a token)
  const [renewed, setRenewed] = useState({
    at: askKey.expires,
    error: undefined as Error | undefined,
  });
  if (renewed.at !== askKey.expires) {
    // only an error the check answers: one about the key
    const keyError = chat.error && errorText(chat.error).key;
    setRenewed({
      at: askKey.expires,
      error: keyError ? chat.error : undefined,
    });
  }
  const failure =
    chat.error && chat.error !== renewed.error ? errorText(chat.error) : null;
  const turns = turnsOf(chat.messages);

  return (
    <>
      <MessageScrollerProvider>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="px-4">
            <MessageScrollerContent className="gap-4 pb-3">
              {chat.messages.length === 0 && (
                <div className="flex flex-col gap-2 pt-1 text-[13px]">
                  <p className="text-foreground/90 leading-relaxed">
                    Was möchtest du wissen? Die Antwort zeigt dir den Ort.
                  </p>
                  {starters.map((s) => (
                    <button
                      className="w-fit rounded-full border px-3 py-1 text-left text-[12px] hover:bg-accent"
                      data-testid="ask-starter"
                      key={s}
                      onClick={() => ask(s)}
                      type="button"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {turns.map((t, k) => {
                const pending = chat.isLoading && k === turns.length - 1;
                const chips =
                  t.answer.length > 0
                    ? answerChips(chat.messages, t.end)
                    : null;
                return (
                  <MessageScrollerItem key={t.question?.id ?? t.answer[0].id}>
                    {t.question && <Question message={t.question} />}
                    {(t.answer.length > 0 || pending) && (
                      <Answer
                        messages={t.answer}
                        onPlace={
                          chat.isLoading
                            ? null
                            : (place) =>
                                showPlaces(scene, {
                                  ziele: [place],
                                  aus_der_luft: !chips?.onFoot,
                                })
                        }
                        pending={pending}
                        places={shownPlaces(chips?.places ?? [], scene)}
                      />
                    )}
                    {chips && !pending && (
                      <AnswerChipRows
                        // a chip's question leaves a typed draft where it is
                        ask={(q) => ask(q, reading, false)}
                        busy={chat.isLoading}
                        chips={chips}
                        scene={scene}
                      />
                    )}
                  </MessageScrollerItem>
                );
              })}
              {failure && (
                <p className="text-[12px] text-destructive" role="alert">
                  {failure.text}{" "}
                  {failure.key && (
                    <button
                      className="underline underline-offset-2"
                      onClick={onKeyProblem}
                      type="button"
                    >
                      Schlüssel prüfen
                    </button>
                  )}
                  {failure.reset && (
                    <button
                      className="underline underline-offset-2"
                      onClick={chat.clear}
                      type="button"
                    >
                      Neu beginnen
                    </button>
                  )}
                </p>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <VoiceBar
        busy={chat.isLoading}
        dictation={dictation}
        hearing={hearing}
        onHearing={onHearing}
        onSpoken={askSpoken}
        reading={reading}
        setReading={setReading}
        speech={speech}
      />
      <form
        className="flex items-end gap-2 border-t px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <textarea
          aria-label="Deine Frage"
          className="max-h-28 min-h-9 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-[13px]"
          data-testid="ask-input"
          maxLength={ASK_LIMITS.questionChars}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // keys typed here are the question's, not the walker's
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(text);
            }
          }}
          placeholder="Frag die Stadt …"
          rows={1}
          value={text}
        />
        {chat.isLoading ? (
          <Button
            aria-label="Antwort abbrechen"
            onClick={() => {
              stopReading();
              scene.abandon();
              chat.stop();
            }}
            size="icon-sm"
            type="button"
            variant="secondary"
          >
            <SquareIcon />
          </Button>
        ) : (
          <Button
            aria-label="Fragen"
            disabled={text.trim() === ""}
            size="icon-sm"
            type="submit"
          >
            <SendIcon />
          </Button>
        )}
      </form>
      <p className="px-4 pb-2 text-[10px] text-muted-foreground leading-snug">
        <MessageCircleQuestionIcon aria-hidden className="mr-1 inline size-3" />
        Antworten sind von einer KI generiert und können irren; die Zeile über
        jeder Antwort zeigt, was sie nachgeschlagen hat.
      </p>
    </>
  );
}

/** A tool argument as text: strings and numbers as written, else nothing. */
function argText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/** Why a refused call was refused, in the card's words (the model's are
 *  longer); null for a call that ran. */
function refusalLine(output: unknown): string | null {
  const refused = output as
    | {
        ausserhalb?: unknown;
        gefunden?: unknown;
        hinweis?: unknown;
        ok?: unknown;
      }
    | undefined;
  // (was_ist_da says `gefunden: false` where the others say `ok: false`)
  if (refused?.ok !== false && refused?.gefunden !== false) {
    return null;
  }
  return refused.ausserhalb === true
    ? "Findet den Ort nicht in der Stadt"
    : argText(refused.hinweis) || "Abgelehnt";
}

/** What `zeige` showed, once the browser has run it: the places
 *  together, or the first alone when they lie too far apart. */
function showLine(args: Record<string, unknown>, output: unknown): string {
  if (args.aus_der_luft === false) {
    return "Geht hin";
  }
  const shown = (output as { gezeigt?: unknown } | undefined)?.gezeigt;
  const n = Array.isArray(shown) ? shown.length : 1;
  return n > 1 ? `Zeigt ${n} Orte` : "Fliegt hin";
}

/** What a tool call says it did, in the steps of an answer. */
function toolLine(name: string, input: unknown, output?: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const refused = refusalLine(output);
  if (refused !== null) {
    return refused;
  }
  switch (name) {
    case "suche_stadt":
      return `Sucht „${argText(args.anfrage)}“`;
    case "in_der_naehe":
      return `Sieht sich im Umkreis von ${nearReach(typeof args.radius === "number" ? args.radius : NEAR_RADIUS).buildings} m um`;
    case "fakten":
      return `Liest die Fakten zu ${argText(args.id)}`;
    case "quellen":
      return "Liest die Quellen";
    case "wo_bin_ich":
      return "Schaut, wo du stehst";
    case "was_ist_da":
      return "Fragt, was dort steht, wohin die Ansicht zeigt";
    case "zeige":
      return showLine(args, output);
    case "setze_zeit":
      return `Stellt die Uhr auf ${argText(args.stunde)} Uhr`;
    case "setze_stil":
      return `Wechselt den Bildstil (${argText(args.stil)})`;
    case "datenschicht":
      return `${args.an ? "Zeigt" : "Verbirgt"} eine Datenebene`;
    default:
      return name;
  }
}

function toolIcon(name: string) {
  if (name === "zeige") {
    return <MapPinIcon />;
  }
  return name === "suche_stadt" || name === "in_der_naehe" ? (
    <SearchIcon />
  ) : (
    <WrenchIcon />
  );
}

/** A question and the messages of its answer (an answer that used the
 *  browser's tools comes as several); `end` is the answer's last index. */
interface Turn {
  answer: UIMessage[];
  end: number;
  question?: UIMessage;
}

function turnsOf(messages: readonly UIMessage[]): Turn[] {
  const turns: Turn[] = [];
  messages.forEach((m, i) => {
    const open = turns.at(-1);
    if (m.role === "user" || !open) {
      turns.push(
        m.role === "user"
          ? { answer: [], end: i, question: m }
          : { answer: [m], end: i }
      );
    } else {
      open.answer.push(m);
      open.end = i;
    }
  });
  return turns;
}

/** What the card says while the model has not answered yet. */
const WAITING = [
  "Fragt die Stadt …",
  "Blättert in der Stadtchronik …",
  "Klopft an alte Mauern …",
  "Sortiert die Jahrhunderte …",
  "Sucht die richtige Ecke …",
  "Wischt den Staub von alten Plänen …",
];
/** How long one waiting line stands (ms). */
const WAITING_MS = 1800;

/** A line that shows at once that the question was heard, and keeps
 *  changing while the model thinks. */
function Waiting() {
  const [n, setN] = useState(() => Math.floor(Math.random() * WAITING.length));
  useEffect(() => {
    const id = setInterval(
      () => setN((k) => (k + 1) % WAITING.length),
      WAITING_MS
    );
    return () => clearInterval(id);
  }, []);
  return (
    <TraceLine data-testid="ask-waiting" status="running">
      <TraceIcon>
        <SparklesIcon />
      </TraceIcon>
      <TraceTitle>{WAITING[n]}</TraceTitle>
    </TraceLine>
  );
}

/** What the model looked things up with (the rest acts on the view). */
const LOOKUPS = new Set([
  "suche_stadt",
  "in_der_naehe",
  "fakten",
  "quellen",
  "wo_bin_ich",
  "was_ist_da",
]);

/** The steps of a finished answer in one line: "3× nachgeschlagen ·
 *  gezeigt". */
function stepsSummary(names: readonly string[]): string {
  const lookups = names.filter((n) => LOOKUPS.has(n)).length;
  const shown = names.includes("zeige");
  const set = names.filter((n) => !LOOKUPS.has(n) && n !== "zeige").length;
  return [
    lookups > 0 && `${lookups}× nachgeschlagen`,
    shown && "gezeigt",
    set > 0 && `${set}× die Szene gestellt`,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface CallPart {
  id: string;
  input?: unknown;
  name: string;
  output?: unknown;
  state: string;
}

/** Whether a call never got its result: still running while the answer
 *  is live, stopped otherwise. */
function unanswered(c: CallPart): boolean {
  return (
    c.output === undefined &&
    (c.state === "awaiting-input" ||
      c.state === "input-streaming" ||
      c.state === "input-complete")
  );
}

/** The answer's steps as one collapsed line (the chain of thought): while
 *  the model works, its latest step; once it writes, a summary; a click
 *  lists them all, a stopped one marked. */
function Steps({
  calls,
  live,
  working,
}: {
  calls: CallPart[];
  /** the answer is still on its way: an open call runs, not stopped */
  live: boolean;
  working: boolean;
}) {
  const now = calls.at(-1);
  const running = working && now !== undefined;
  return (
    <Trace data-testid="ask-steps">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon>
              {running ? toolIcon(now.name) : <SparklesIcon />}
            </TraceIcon>
            <TraceTitle>
              {running
                ? toolLine(now.name, now.input, now.output)
                : stepsSummary(calls.map((c) => c.name))}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {calls.map((c) => (
              <TraceLine key={c.id}>
                <TraceIcon>{toolIcon(c.name)}</TraceIcon>
                <TraceTitle>
                  {toolLine(c.name, c.input, c.output)}
                  {!live && unanswered(c) && " (abgebrochen)"}
                </TraceTitle>
              </TraceLine>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** A paragraph's pieces: a web link, or text runs with place mentions. */
type Piece = { url: string } | { runs: MentionRun[] };

/** An answer's paragraphs as pieces, each place linked where the answer
 *  first names it; nothing else is interpreted. */
function piecesOf(
  texts: readonly string[],
  places: readonly AskPlace[],
  city: string
): Piece[][] {
  const linked = new Set<number>();
  return texts.map((text) =>
    // a sentence's closing punctuation after a link is not part of it
    text
      .split(
        // and a bracketed part, as in Wikipedia's „Zwinger_(Dresden)“, is
        /(https:\/\/(?:[^\s()[\]]|\([^\s()]*\))*(?:[^\s()[\].,;:!?»“”"']|\([^\s()]*\)))/g
      )
      .map((part) =>
        part.startsWith("https://")
          ? { url: part }
          : { runs: mentionRuns(part, places, city, linked) }
      )
  );
}

/** A paragraph with its web links clickable and the places the answer
 *  showed as buttons that fly there. */
function Linked({
  onPlace,
  pieces,
  places,
}: {
  onPlace: ((place: AskPlace) => void) | null;
  pieces: readonly Piece[];
  places: readonly AskPlace[];
}) {
  return (
    <>
      {pieces.map((piece, i) =>
        "url" in piece ? (
          <a
            className="break-all underline underline-offset-2"
            // the same link may stand twice in an answer: its place keys it
            // reason: pieces never reorder, the index is stable
            key={`${i}:${piece.url}`}
            href={piece.url}
            rel="noreferrer"
            target="_blank"
          >
            {piece.url}
          </a>
        ) : (
          piece.runs.map((run, j) =>
            "place" in run ? (
              <button
                className="rounded-sm font-medium text-primary underline decoration-primary/30 decoration-dotted underline-offset-[3px] hover:decoration-solid disabled:cursor-default disabled:text-inherit disabled:no-underline"
                data-testid="ask-mention"
                disabled={onPlace === null}
                // reason: runs never reorder, the index is stable
                key={`${i}.${j}`}
                onClick={() => onPlace?.(places[run.place])}
                title={`Zu ${places[run.place].name}`}
                type="button"
              >
                {run.text}
              </button>
            ) : (
              // reason: runs never reorder, the index is stable
              <span key={`${i}.${j}`}>{run.text}</span>
            )
          )
        )
      )}
    </>
  );
}

function Question({ message }: { message: UIMessage }) {
  return (
    <Message align="end">
      <MessageContent>
        <p className="w-fit max-w-[85%] self-end rounded-lg bg-primary px-2.5 py-1.5 text-[13px] text-primary-foreground">
          {message.parts
            .map((p) => (p.type === "text" ? p.content : ""))
            .join("")}
        </p>
      </MessageContent>
    </Message>
  );
}

/** One answer: the label, its steps in one line, its text. */
function Answer({
  messages,
  onPlace,
  pending,
  places,
}: {
  messages: readonly UIMessage[];
  onPlace: ((place: AskPlace) => void) | null;
  pending: boolean;
  places: readonly AskPlace[];
}) {
  const city = useSite().name;
  const parts = messages.flatMap((m) => m.parts);
  // the follow-ups are the chips under the answer, not a step of it
  const calls = parts
    .filter((p) => p.type === "tool-call")
    .filter((p) => p.name !== "vorschlaege");
  const texts = parts
    .map((p) => (p.type === "text" ? p.content : ""))
    .filter((t) => t.trim() !== "");
  // still looking things up: nothing written since the last step
  const tail = parts.at(-1);
  const working =
    pending && !(tail?.type === "text" && tail.content.trim() !== "");
  const pieces = piecesOf(texts, places, city);
  return (
    <Message>
      <MessageContent>
        <span className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          KI
        </span>
        {calls.length > 0 && (
          <Steps calls={calls} live={pending} working={working} />
        )}
        {pending && texts.length === 0 && calls.length === 0 && <Waiting />}
        {pieces.map((p, i) => (
          <p
            className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90"
            // reason: a message's parts never reorder
            key={`t${i}`}
          >
            <Linked onPlace={onPlace} pieces={p} places={places} />
          </p>
        ))}
      </MessageContent>
    </Message>
  );
}
