# docs/ — project knowledge base

Durable, version-controlled documentation for the 3D city-walker. This is where
decisions and mappings live so they **survive across chat threads and
contributors** instead of scattering into one-off conversations.

Scope split (don't duplicate — cross-link):

| Doc | Answers |
|---|---|
| **[data-flow.md](./data-flow.md)** | *What becomes what?* The source→feature provenance diagram + feature table. |
| **[transformations.md](./transformations.md)** | *What have we built / tried / rejected, and why?* The transformation ledger — active, experimental, planned, **discontinued**. |
| **[portability.md](./portability.md)** | *How do we render a different location?* The data-availability degradation matrix + porting checklist. |
| **[AGENTS.md](../AGENTS.md)** | Repo entrypoint: stack, commands, conventions, coordinate frame. |
| **[city-walker skill](../.claude/skills/city-walker/SKILL.md)** | *How is it built?* Deep rendering/data/QA reference + the shadow recipe and its dead-ends. |

Roles at a glance: **AGENTS.md** = orientation, **skill** = how it's built,
**docs/** = what maps to what + status + portability. Personal agent memory is a
scratchpad; **anything durable belongs here, in the repo.**

## Keeping these docs current

These docs are only useful if they don't rot. Treat them as part of "done":

> **Definition of Done** — a change that **adds, alters, or drops a
> data→feature transformation** is not complete until:
> 1. [transformations.md](./transformations.md) has the entry (correct status:
>    ✅ / 🧪 / 📋 / 🗃️ — and *why*, especially for 🗃️ discontinued);
> 2. [data-flow.md](./data-flow.md)'s diagram + table reflect any new source,
>    feature, or edge;
> 3. [portability.md](./portability.md) records the fallback if a new optional
>    source was introduced.

Rejected an idea? **Write it down as 🗃️ discontinued** — a documented dead-end is
worth as much as a shipped feature; it stops the next thread from retrying it.
