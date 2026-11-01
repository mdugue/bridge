"use client";

/**
 * The Prüfstand of *Frag die Stadt* (ADR 0056, lib/city/ask-qa.ts), in
 * the card behind `?pruefstand=1`: plans every first question at the
 * places that matter, asks each of the chosen models with the visitor's
 * key (two at a time, through /api/frag/pruefen), has a thorough model
 * judge every answer and sums it up — per question keep, change or
 * replace, per model the time to the first word — with the report to
 * download. Its own chunk: nothing of it loads without the knob.
 */
import { DownloadIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ASK_KEY_HEADER, ASK_PROVIDER_BY_ID } from "@/lib/city/ask-city";
import type { QaAnswer, QaCase, QaPlace, QaVerdict } from "@/lib/city/ask-qa";
import {
  modelSums,
  type QaResult,
  qaReport,
  questionSums,
} from "@/lib/city/ask-qa-report";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { AskKey } from "./ask-key";

/** How many cases run at once: a provider's rate limit is the visitor's. */
const AT_ONCE = 2;

interface Props {
  askKey: AskKey;
  city: string;
  site: string;
}

/** What one case returns, as the route sends it. */
interface CaseReply {
  antwort?: QaAnswer;
  urteil?: QaVerdict | null;
  message?: string;
}

/** Runs `jobs` `AT_ONCE` at a time until done or stopped. */
async function pool<T>(
  jobs: readonly T[],
  run: (job: T) => Promise<boolean>,
  stopped: () => boolean
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !stopped()) {
      const job = jobs[next];
      next += 1;
      if (!(await run(job))) {
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const CALL_STYLE = {
  behalten: "text-emerald-700 dark:text-emerald-400",
  anpassen: "text-amber-700 dark:text-amber-400",
  ersetzen: "text-destructive",
} as const;

export default function AskQa({ askKey, city, site }: Props) {
  const def = ASK_PROVIDER_BY_ID[askKey.provider];
  // a gateway reaches every maker: its fast models first, by default
  const routed = def.models.length > 4;
  const [models, setModels] = useState<string[]>(() =>
    def.models.filter((m) => !routed || m.hint === "schnell").map((m) => m.id)
  );
  const [judge, setJudge] = useState(
    () => def.models.find((m) => m.hint === "gründlich")?.id ?? askKey.model
  );
  const [count, setCount] = useState(4);
  const [plan, setPlan] = useState<{
    cases: QaCase[];
    places: QaPlace[];
  } | null>(null);
  const [results, setResults] = useState<QaResult[]>([]);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);

  const loadPlan = async () => {
    setProblem(null);
    setResults([]);
    try {
      const res = await fetch("/api/frag/pruefen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ art: "plan", site, orte: count }),
      });
      const body = (await res.json()) as {
        faelle?: QaCase[];
        message?: string;
        orte?: QaPlace[];
      };
      if (!(res.ok && body.faelle && body.orte)) {
        setProblem(body.message ?? `Der Plan schlug fehl (${res.status}).`);
        return;
      }
      setPlan({ cases: body.faelle, places: body.orte });
    } catch {
      setProblem("Keine Verbindung zum Server.");
    }
  };

  const ask = async (c: QaCase, model: string, signal: AbortSignal) => {
    const res = await fetch("/api/frag/pruefen", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        [ASK_KEY_HEADER]: askKey.key,
      },
      body: JSON.stringify({
        art: "fall",
        site,
        provider: askKey.provider,
        model,
        richter: judge,
        token: askKey.token,
        fall: c,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as CaseReply;
    return { res, body };
  };

  const start = async () => {
    if (!plan) {
      return;
    }
    const controller = new AbortController();
    stop.current = controller;
    setRunning(true);
    setProblem(null);
    setResults([]);
    const jobs = plan.cases.flatMap((c) =>
      models.map((model) => ({ c, model }))
    );
    await pool(
      jobs,
      async ({ c, model }) => {
        try {
          const { res, body } = await ask(c, model, controller.signal);
          if (res.status === 401 || res.status === 400) {
            // the key or the request is wrong for every case: stop
            setProblem(body.message ?? `Abgelehnt (${res.status}).`);
            return false;
          }
          const answer: QaAnswer = body.antwort ?? {
            calls: [],
            error: body.message ?? `Antwort ${res.status}`,
            firstTextMs: null,
            text: "",
            totalMs: 0,
            turns: 0,
          };
          setResults((r) => [
            ...r,
            { case: c, model, answer, verdict: body.urteil ?? null },
          ]);
          return true;
        } catch {
          return !controller.signal.aborted;
        }
      },
      () => controller.signal.aborted
    );
    setRunning(false);
  };

  const label = (id: string) =>
    def.models.find((m) => m.id === id)?.label ?? id;
  const sums = useMemo(() => questionSums(results), [results]);
  const byModel = useMemo(() => modelSums(results), [results]);
  const total = plan ? plan.cases.length * models.length : 0;
  const report = () =>
    qaReport(
      results.map((r) => ({ ...r, model: label(r.model) })),
      {
        city,
        date: new Date().toISOString().slice(0, 10),
        judge: label(judge),
        places: plan?.places.map((p) => p.name) ?? [],
      }
    );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 text-[12px]"
      data-testid="ask-qa"
    >
      <p className="leading-relaxed text-foreground/90">
        Der Prüfstand stellt jede Startfrage an den maßgeblichen Orten allen
        gewählten Modellen, lässt jede Antwort bewerten und sagt, welche Frage
        bleibt, angepasst oder ersetzt werden sollte. Er läuft mit deinem
        Schlüssel: jede Antwort und jede Bewertung kostet.
      </p>
      <fieldset className="flex flex-col gap-1" disabled={running}>
        <legend className="text-[11px] text-muted-foreground">Modelle</legend>
        {def.models.map((m) => (
          <label className="flex items-center gap-2" key={m.id}>
            <input
              checked={models.includes(m.id)}
              onChange={(e) =>
                setModels((list) =>
                  e.target.checked
                    ? [...list, m.id]
                    : list.filter((id) => id !== m.id)
                )
              }
              type="checkbox"
            />
            {m.label} <span className="text-muted-foreground">{m.hint}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Bewertung</span>
          <select
            className="rounded-md border bg-background px-1.5 py-1"
            disabled={running}
            onChange={(e) => setJudge(e.target.value)}
            value={judge}
          >
            {def.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Orte</span>
          <select
            className="rounded-md border bg-background px-1.5 py-1"
            disabled={running}
            onChange={(e) => {
              setCount(Number(e.target.value));
              setPlan(null);
            }}
            value={count}
          >
            {[2, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button
            onClick={() => stop.current?.abort()}
            size="sm"
            variant="secondary"
          >
            <SquareIcon /> Anhalten
          </Button>
        ) : plan ? (
          <Button
            data-testid="ask-qa-start"
            disabled={models.length === 0}
            onClick={() => void start()}
            size="sm"
          >
            <PlayIcon /> {total} Antworten und Bewertungen starten
          </Button>
        ) : (
          <Button
            data-testid="ask-qa-plan"
            onClick={() => void loadPlan()}
            size="sm"
            variant="secondary"
          >
            Fälle planen
          </Button>
        )}
        {results.length > 0 && (
          <span className="text-muted-foreground">
            {results.length} / {total}
          </span>
        )}
      </div>
      {plan && !running && results.length === 0 && (
        <p className="text-muted-foreground">
          {plan.cases.length} Fälle an {plan.places.length} Orten (
          {plan.places.map((p) => p.name).join("; ")}) × {models.length}{" "}
          Modelle.
        </p>
      )}
      {problem && (
        <p className="text-destructive" role="alert">
          {problem}
        </p>
      )}
      {results.length > 0 && (
        <>
          <table className="w-full border-collapse text-left">
            <thead className="text-[10px] text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Modell</th>
                <th className="font-normal">erstes Wort</th>
                <th className="font-normal">ohne Text</th>
                <th className="font-normal">Antwort ⌀</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => (
                <tr className="border-t" key={m.model}>
                  <td className="py-1">{label(m.model)}</td>
                  <td>
                    {m.firstTextMs === null
                      ? "–"
                      : `${(m.firstTextMs / 1000).toFixed(1)} s`}
                  </td>
                  <td>{m.noText}</td>
                  <td>{m.answer.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col gap-1.5" data-testid="ask-qa-questions">
            {sums.map((q) => (
              <li key={q.template}>
                <span className={cn("font-medium", CALL_STYLE[q.call])}>
                  {q.call}
                </span>{" "}
                {q.template}
                {q.suggestions.length > 0 && (
                  <span className="block text-muted-foreground">
                    → {q.suggestions.join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                download(
                  `pruefstand-${site}.md`,
                  report(),
                  "text/markdown;charset=utf-8"
                )
              }
              size="sm"
              variant="secondary"
            >
              <DownloadIcon /> Bericht
            </Button>
            <Button
              onClick={() =>
                download(
                  `pruefstand-${site}.json`,
                  JSON.stringify(results, null, 1),
                  "application/json"
                )
              }
              size="sm"
              variant="ghost"
            >
              <DownloadIcon /> Daten
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
