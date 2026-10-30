# ADR 0047: Every device gets a budget in true bytes, a phone's memory never grows, and a device that lost its GPU gets a lighter page

- **Status:** accepted
- **Date:** 2026-10

## Context

The viewer must work on phones. An iPhone's tab dies past a few hundred
megabytes, and Safari says nothing about the device's memory. Before this
decision the phone's numbers did not add up: about 100 MiB of post targets
and shadow map nobody counted, a tile cache whose bound sat above every
loss, a sun camera that refined every tile it touched, CPU copies kept
after upload. A lost GPU reloaded the page into the very budget that had
just failed, in a loop, until a frozen canvas.

## Decision

1. **A phone's memory must not grow with a change.** A change that adds
   bytes on a phone pays for them elsewhere, measured.
2. **A budget per device tier and safety level**, in one table
   (`scene-profile.ts`): pixel ratio, shadow map, tile cache, post profile.
   A phone builds no depth of field and antialiases with FXAA; every tier
   uses one-byte targets where a channel suffices.
3. **Fixed costs are counted**, and a phone's tile cache is derived from
   the memory governor's soft line minus them.
4. **Fewer bytes a tile:** buffers the site shares are one copy; CPU copies
   go once a compile has uploaded them, except what is read on the CPU
   later; the shadow camera streams at a low resolution of its own; a
   phone paces its downloads and decodes rasters one at a time.
5. **A safety level 0–3 per device**, in local storage (`gpu-safety`). A
   GPU lost in use, a crashed previous page or a memory emergency raises it
   by one, once per incident; time lowers it by one every three days. Each
   level is a lighter budget, applied at boot.
6. **Recovery is bounded by levels:** one reload per level, the old
   renderer and device released first, back at the player's pose. A GPU
   reclaimed in the background, or a frame that threw on a working GPU,
   reloads at the same level. Past the last level the failure card offers
   *Leichter weiter* and *Neu laden*.
7. **The level is visible:** *Qualität* in the sidebar shows it and resets
   it to full detail through a reload after the whole app is torn down.

## Consequences

- What a tile adds beyond its glTF reaches the cache's weighing
  (`calculateBytesUsed`).
- An attribute read on the CPU after the dressing stays off the drop lists;
  a buffer the site shares is detached before its geometry is disposed.
- A device that crashed once runs plainer for days, and says so.

## Alternatives

- **Governing on the page's own footprint:** Safari exposes nothing to
  read.
- **Caps in time on recovery reloads:** bound the loop's length, not its
  load.
- **Session-only safety state:** lost on Safari's kill-and-reopen and on
  the next visit, where the device runs out again.
- **Stepping the budget down inside a page:** rebuilds on a device already
  short of memory; a level is a new page.
- **Counting background reclaims as losses:** every phone left in a pocket
  would end up plain.
- **Dropping every CPU copy:** collision, picking and the height samplers
  read them.
