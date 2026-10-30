"use client";

/**
 * *Frag die Stadt* (ADR 0056): the card where a visitor asks about the
 * city with their own key. Its own chunk (city-walk.tsx loads it on the
 * first open), so the chat client, the tool schemas and this card cost a
 * visitor nothing until they ask — and nothing of three.js is in it.
 *
 * The answers are generated and say so; each tool the model used shows
 * as a line under the answer, so the visitor sees what it looked up and
 * what it did to the view.
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
  SquareIcon,
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
  providerForKey,
} from "@/lib/city/ask-city";
import { nearReach } from "@/lib/city/ask-knowledge";
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
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { cn } from "cn";
import { AnswerChipRows, answerChips } from "./ask-chips";
import { type AskKey, clearAskKey, readAskKey, writeAskKey } from "./ask-key";
import { type AskScene, sceneTools } from "./ask-scene-tools";
import { type Speech, useDictation, useSpeech } from "./ask-voice";

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
  // the Hörmodus (the Sprachführer, ADR 0057): the screen dark, the scene
  // barely drawn, the answers read aloud
  const [hearing, setHearing] = useState(false);
  // read aloud: kept here, so a new key does not silence a Hörmodus
  const [reading, setReading] = useState(false);
  useEffect(() => {
    scene.setListening(hearing);
    return () => scene.setListening(false);
  }, [scene, hearing]);
  // a closed card takes its scenarios with it (ADR 0058)
  useEffect(
    () => () => {
      scene.setFlood(null);
      scene.setVolume(null);
    },
    [scene]
  );
  return (
    <>
      {hearing && (
        <button
          aria-label="Hörmodus beenden"
          className="pointer-events-auto absolute inset-0 z-20 flex items-end justify-center bg-black/90 pb-10 text-[12px] text-white/60"
          data-testid="ask-hearing"
          onClick={() => setHearing(false)}
          type="button"
        >
          Hörmodus: Die Antworten werden vorgelesen. Tippen zum Beenden.
        </button>
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
        {key ? (
          <Conversation
            askKey={key}
            hearing={hearing}
            onHearing={setHearing}
            key={key.token || key.key}
            onKeyProblem={() => setKey(null)}
            reading={reading}
            setReading={setReading}
            scene={scene}
            site={site}
          />
        ) : (
          <KeyForm
            onKey={(k) => {
              writeAskKey(k);
              setKey(k);
            }}
          />
        )}
      </section>
    </>
  );
}

// --- the key ------------------------------------------------------------------

function KeyForm({ onKey }: { onKey: (key: AskKey) => void }) {
  const stored = readAskKey();
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

const SUGGESTIONS = [
  "Was steht hier vor mir?",
  "Zeig mir das älteste Gebäude in der Nähe.",
  "Wie sieht es hier am Abend aus?",
];

/** A failed answer in words, by the status the server sent. */
function errorText(error: Error): { key: boolean; text: string } {
  const status = (error as { status?: unknown }).status;
  if (status === 401) {
    return { key: true, text: "Der Schlüssel muss neu geprüft werden." };
  }
  if (status === 413) {
    return {
      key: false,
      text: "Das Gespräch ist zu lang geworden — bitte neu beginnen.",
    };
  }
  if (status === 404) {
    return { key: false, text: "Für diese Stadt gibt es kein Stadtwissen." };
  }
  if (status === 501) {
    return {
      key: false,
      text: "Frag die Stadt ist auf diesem Server nicht eingerichtet.",
    };
  }
  if (typeof status === "number") {
    return { key: false, text: `Der Server antwortet mit Status ${status}.` };
  }
  return { key: false, text: error.message || "Die Antwort brach ab." };
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
  speech: Speech
): () => void {
  const was = useRef(loading);
  const stopped = useRef(false);
  useEffect(() => {
    if (was.current && !loading && on && !failed && !stopped.current) {
      speech.speak(lastAnswer(messages));
    }
    if (loading) {
      stopped.current = false;
    }
    was.current = loading;
  }, [loading, failed, on, messages, speech]);
  return useCallback(() => {
    stopped.current = true;
  }, []);
}

/** Read aloud, speak a question, the Hörmodus: where the browser can. */
function VoiceBar({
  hearing,
  onHearing,
  onSpoken,
  reading,
  setReading,
  speech,
}: {
  hearing: boolean;
  onHearing: (on: boolean) => void;
  onSpoken: (text: string) => void;
  reading: boolean;
  setReading: (on: boolean) => void;
  speech: Speech;
}) {
  const dictation = useDictation();
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
          className={chip}
          onClick={() => {
            if (dictation.listening) {
              dictation.stop();
              return;
            }
            speech.stop();
            dictation.start((question) => {
              // a spoken question gets a spoken answer
              setReading(true);
              spoken.current(question);
            });
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
            setReading(true);
            onHearing(!hearing);
          }}
          title="Hörmodus: Bildschirm dunkel, die Szene ruht, die Antworten werden vorgelesen — für unterwegs, das Telefon in der Tasche"
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
  hearing,
  onHearing,
  onKeyProblem,
  reading,
  scene,
  setReading,
  site,
}: {
  askKey: AskKey;
  hearing: boolean;
  onHearing: (on: boolean) => void;
  onKeyProblem: () => void;
  reading: boolean;
  scene: AskScene;
  setReading: (on: boolean) => void;
  site: string;
}) {
  const speech = useSpeech();
  const tools = useMemo(() => sceneTools(scene), [scene]);
  // the card remounts for another key (keyed by it), so this one is fixed
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
  const stopReading = useReadAloud(
    chat.messages,
    chat.isLoading,
    chat.error !== undefined,
    reading,
    speech
  );
  const [text, setText] = useState("");
  // `voice` with the question itself: a spoken one sets `reading` in the
  // same handler, before forwardedProps has seen it
  const ask = (question: string, voice = reading) => {
    const q = question.trim().slice(0, ASK_LIMITS.questionChars);
    if (q && !chat.isLoading) {
      setText("");
      void chat.sendMessage(q, { body: { voice } });
    }
  };
  const failure = chat.error ? errorText(chat.error) : null;

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
                  {SUGGESTIONS.map((s) => (
                    <button
                      className="w-fit rounded-full border px-3 py-1 text-left text-[12px] hover:bg-accent"
                      key={s}
                      onClick={() => ask(s)}
                      type="button"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {chat.messages.map((m, i) => {
                // an answer that used the browser's tools comes as several
                // messages: the label marks its first, the chips its last
                const last =
                  m.role === "assistant" &&
                  chat.messages[i + 1]?.role !== "assistant";
                const pending =
                  chat.isLoading && i === chat.messages.length - 1;
                return (
                  <MessageScrollerItem key={m.id}>
                    <ChatMessage
                      labelled={chat.messages[i - 1]?.role !== "assistant"}
                      message={m}
                    />
                    {last && !pending && (
                      <AnswerChipRows
                        ask={ask}
                        busy={chat.isLoading}
                        chips={answerChips(chat.messages, i)}
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
                </p>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <VoiceBar
        hearing={hearing}
        onHearing={onHearing}
        onSpoken={(q) => ask(q, true)}
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
        Antworten sind von einer KI generiert und können irren; die Werkzeuge
        darunter zeigen, was sie nachgeschlagen hat.
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

/** What a tool call says it did, in the trace under an answer. */
function toolLine(name: string, input: unknown, output?: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
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
      return "Fragt, was in der Bildmitte steht";
    case "zeige": {
      if (args.aus_der_luft === false) {
        return "Geht hin";
      }
      // what it showed, once the browser has run it: the places together,
      // or the first alone when they lie too far apart
      const shown = (output as { gezeigt?: unknown } | undefined)?.gezeigt;
      const n = Array.isArray(shown) ? shown.length : 1;
      return n > 1 ? `Zeigt ${n} Orte` : "Fliegt hin";
    }
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

/** Text with its web links clickable; nothing else is interpreted. */
function Linked({ text }: { text: string }) {
  // a sentence's closing punctuation after a link is not part of it
  const parts = text.split(/(https:\/\/[^\s)\]]*[^\s)\].,;:!?»“”"'])/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("https://") ? (
          <a
            className="break-all underline underline-offset-2"
            // the same link may stand twice in an answer: its place keys it
            // reason: parts never reorder, the index is stable
            key={`${i}:${part}`}
            href={part}
            rel="noreferrer"
            target="_blank"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

function ChatMessage({
  labelled,
  message,
}: {
  labelled: boolean;
  message: UIMessage;
}) {
  if (message.role === "user") {
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
  // the follow-ups are the chips under the answer, not a step of it
  const calls = message.parts
    .filter((p) => p.type === "tool-call")
    .filter((p) => p.name !== "vorschlaege");
  return (
    <Message>
      <MessageContent>
        {labelled && (
          <span className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            KI
          </span>
        )}
        {calls.length > 0 && (
          <Trace>
            {calls.map((c) => (
              <TraceLine
                key={c.id}
                status={
                  c.state === "input-complete" || c.state === "input-streaming"
                    ? "running"
                    : undefined
                }
              >
                <TraceIcon>{toolIcon(c.name)}</TraceIcon>
                <TraceTitle>{toolLine(c.name, c.input, c.output)}</TraceTitle>
              </TraceLine>
            ))}
          </Trace>
        )}
        {message.parts.map((p, i) =>
          p.type === "text" && p.content.trim() !== "" ? (
            <p
              className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90"
              // reason: a message's parts never reorder
              key={`t${i}`}
            >
              <Linked text={p.content} />
            </p>
          ) : null
        )}
      </MessageContent>
    </Message>
  );
}
