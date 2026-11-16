/**
 * POST /api/frag — one answer of *Frag die Stadt* (ADR 0056), streamed as
 * server-sent events. The turn itself is `answerTurn`
 * (lib/city/ask-run.ts); this binds it to the provider's adapter or the
 * scripted one, the site's Stadtwissen, the secret, the clock and the
 * log. The key comes in the `x-frag-key` header and goes to the provider
 * and nowhere else; where the visitor stands in the model comes in
 * `x-frag-ort`, for `wo_bin_ich` and a search round them. Neither the
 * pose nor anything else of the request is kept or logged.
 */
import {
  ASK_KEY_HEADER,
  ASK_VISITOR_HEADER,
  parseAskVisitor,
} from "@/lib/city/ask-city";
import { askPromptSite } from "@/lib/city/ask-prompt";
import { answerTurn } from "@/lib/city/ask-run";
import { siteById } from "@/sites";
import { askAdapter, fakeAskAdapter } from "./adapters";
import { fakeModel } from "./env";
import { siteKnowledge } from "./knowledge";

/** Up to eight model calls with tool rounds between them: a careful
 *  model's answer can outlast a minute (Vercel's ceiling with fluid
 *  compute). */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const scripted = fakeModel();
  return await answerTurn(
    {
      // a body that is not JSON is refused as a bad request
      body: await request.json().catch(() => null),
      key: request.headers.get(ASK_KEY_HEADER)?.trim() ?? "",
      signal: request.signal,
      visitor: parseAskVisitor(request.headers.get(ASK_VISITOR_HEADER)),
    },
    {
      adapterFor: (props, key) =>
        scripted
          ? fakeAskAdapter()
          : askAdapter(props.provider, props.model, key),
      knowledgeFor: async (id) => {
        const site = siteById(id);
        const knowledge = site ? await siteKnowledge(site.id) : null;
        return site && knowledge
          ? { site: askPromptSite(site), knowledge }
          : null;
      },
      secret: process.env.FRAG_SECRET,
      production: process.env.NODE_ENV === "production",
      scripted,
      now: Date.now,
      // the host ends the function at maxDuration without a word: the
      // answer ends a little before, with an error the visitor sees
      deadlineMs: (maxDuration - 10) * 1000,
      log: (line) => console.warn(line),
    }
  );
}
