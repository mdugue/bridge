/**
 * A told text as the voice reads it (app/_components/ask-voice.ts,
 * ADR 0057): its parts, each in a tone — a walk stop's title slower and a
 * little higher, its closer look set apart as an aside after its own
 * label. No DOM.
 */

/** How a part is said. */
export type SpokenTone = "aside" | "label" | "story" | "title";

/** A piece of what is read, and how. */
export interface SpokenPart {
  text: string;
  tone: SpokenTone;
}
