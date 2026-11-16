/**
 * Rails as a table of segments (plan 090, phase 0 — the third of the
 * lines' three homes, a spike): each piece of track between two samples of
 * its line is one record, and the GPU expands it into the pair of rails —
 * an instanced profile (app/_components/rail-segments.ts) — where the
 * runtime builder writes twenty-four vertices and the spike of PR #156
 * baked them.
 *
 * A record is ten unsigned 16-bit words (twenty bytes), little-endian:
 *
 *   word 0–2   a: x, y, z   the track's middle at the segment's start,
 *                           from its chunk's origin: x and z in steps of
 *                           RAIL_STEP_M, the height in RAIL_STEP_Y_M
 *   word 3     the track's bearing at a (0..2π over 0..65536): the rails
 *              are offset across it, so neighbours meet without a gap
 *   word 4–6   b: x, y, z   the segment's end
 *   word 7     the bearing at b
 *   word 8     the track's offset across its line, mm + 32 768 (a double
 *              track's two, a yard's twelve)
 *   word 9     spare
 *
 * Tables are cut into chunks of RAIL_CHUNK_M, each with its own origin:
 * sixteen bits then step 4 mm in height and 8 mm in plan — a street rail
 * stands 2 cm over its paving, and the 3 cm a tile-wide step gives (the
 * spike's finding) would bury it. A segment belongs to the chunk its
 * start lies in and may reach RAIL_MAX_SEGMENT_M out of it. What differs in kind — the gauge, the rail's depth, its steel — is
 * the set's (one profile geometry and material each), not the record's.
 *
 * No THREE, no DOM.
 */

/** Bytes and words a record. */
export const RAIL_RECORD_BYTES = 20;
export const RAIL_RECORD_WORDS = RAIL_RECORD_BYTES / 2;
/** One step of a record's x and z (m): sixteen bits span 512 m. */
export const RAIL_STEP_M = 1 / 128;
/** One step of its height (m): 256 m of relief a chunk. */
export const RAIL_STEP_Y_M = 1 / 256;
/** A chunk's side (m), and how far its origin lies outside it: what a
 *  segment may reach past its chunk on either side. */
export const RAIL_CHUNK_M = 250;
const CHUNK_MARGIN_M = 128;
/** The longest segment a table holds (m). */
export const RAIL_MAX_SEGMENT_M = 120;
export const RAIL_TURN_UNIT = 65_536;
/** The track offset's unit (m) and its zero. */
export const RAIL_OFFSET_STEP_M = 0.001;
export const RAIL_OFFSET_ZERO = 32_768;

/** Where each field starts in a record (words). */
export const RAIL_WORD = { a: 0, b: 4, more: 8 } as const;

/** Which steel a run is drawn in (its colour and finish are the
 *  viewer's). */
export type RailLook = "rail" | "tram" | "tram-street";

export interface RailPoint {
  x: number;
  y: number;
  z: number;
}

/** One track's rails along a run of samples, as the builders lay them:
 *  the rail heads' middle line, the track's offset across it, and its
 *  profile. */
export interface RailRun {
  /** the track's bearing at each point, where the points are not every
   *  sample of the line any more (`simplifyRun`); else from the points */
  bearings?: readonly number[];
  gauge: number;
  /** the track's offset across the line (m) */
  lateral: number;
  look: RailLook;
  pts: readonly RailPoint[];
  /** the rail's depth below its head (m) */
  web: number;
}

/** Collects the runs a tile's builders would have drawn as triangles. */
export interface RailSink {
  runs: RailRun[];
}

export const railSink = (): RailSink => ({ runs: [] });

/** A set's profile: every run of one key shares a geometry and a
 *  material. */
export const profileKey = (
  r: Pick<RailRun, "gauge" | "look" | "web">
): string => `${r.look}:${r.gauge}:${r.web}`;

/** The unit tangents of a run in the ground plane, as the runtime's
 *  ribbons take them (mesh-kit.ts `tangentsXZ`): from the neighbours on
 *  both sides. */
export function runBearings(pts: readonly RailPoint[]): number[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return dx === 0 && dz === 0 ? 0 : Math.atan2(dz, dx);
  });
}

/** How far a dropped sample may lie from the segment that replaces it:
 *  across the track and in height (m). */
export interface RailTolerance {
  across: number;
  height: number;
}

/** What a build may leave out where a fixed-step builder cannot: 1 cm
 *  across, 5 mm in height — a quarter of what a street rail stands proud. */
export const RAIL_TOLERANCE: RailTolerance = { across: 0.01, height: 0.005 };

/**
 * `run` with every sample dropped that its neighbours' segment stands in
 * for within `tolerance` (Douglas–Peucker, the height weighed apart from
 * the plan): a straight, evenly graded street keeps its ends. The kept
 * points keep the bearing the full run had there, so the rails still turn
 * as the line does.
 */
export function simplifyRun(
  run: RailRun,
  tolerance: RailTolerance = RAIL_TOLERANCE
): RailRun {
  const { pts } = run;
  if (pts.length < 3) {
    return run;
  }
  const bearings = run.bearings ?? runBearings(pts);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  for (let span = stack.pop(); span; span = stack.pop()) {
    const [a, b] = span;
    const pa = pts[a];
    const pb = pts[b];
    const dx = pb.x - pa.x;
    const dz = pb.z - pa.z;
    const length2 = dx * dx + dz * dz;
    let worst = 1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const p = pts[i];
      const t =
        length2 === 0
          ? 0
          : Math.min(
              Math.max(((p.x - pa.x) * dx + (p.z - pa.z) * dz) / length2, 0),
              1
            );
      const across = Math.hypot(pa.x + dx * t - p.x, pa.z + dz * t - p.z);
      const height = Math.abs(pa.y + (pb.y - pa.y) * t - p.y);
      const miss = Math.max(
        across / tolerance.across,
        height / tolerance.height
      );
      if (miss > worst) {
        worst = miss;
        at = i;
      }
    }
    if (at < 0 && Math.sqrt(length2) > RAIL_MAX_SEGMENT_M && b - a > 1) {
      // within tolerance but longer than a record reaches: cut it
      at = (a + b) >> 1;
    }
    if (at >= 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const kept = pts.flatMap((_, i) => (keep[i] ? [i] : []));
  return {
    ...run,
    pts: kept.map((i) => pts[i]),
    bearings: kept.map((i) => bearings[i]),
  };
}

/** One chunk of one profile: its records and where they count from. */
export interface RailChunk {
  gauge: number;
  look: RailLook;
  origin: [number, number, number];
  web: number;
  words: Uint16Array<ArrayBuffer>;
}

interface Segment {
  a: RailPoint;
  b: RailPoint;
  bearingA: number;
  bearingB: number;
  lateral: number;
}

const TAU = Math.PI * 2;
const WORD_MAX = 65_535;
const turnWord = (rad: number): number =>
  Math.round(((((rad % TAU) + TAU) % TAU) / TAU) * RAIL_TURN_UNIT) %
  RAIL_TURN_UNIT;

/** How many coordinates had to be clamped into a chunk's sixteen bits by
 *  the last `packRails` (0 unless a segment is longer than a chunk's
 *  margin or a chunk's relief exceeds 256 m). */
export interface RailPackReport {
  clamped: number;
  segments: number;
}

/**
 * `runs` as chunks of records, sorted by profile and chunk — what a file
 * would hold, section by section.
 */
export function packRails(
  runs: readonly RailRun[],
  report?: RailPackReport
): RailChunk[] {
  const groups = new Map<
    string,
    { run: RailRun; cx: number; cz: number; segments: Segment[] }
  >();
  for (const run of runs) {
    const bearings = run.bearings ?? runBearings(run.pts);
    for (let i = 0; i < run.pts.length - 1; i += 1) {
      const a = run.pts[i];
      const cx = Math.floor(a.x / RAIL_CHUNK_M);
      const cz = Math.floor(a.z / RAIL_CHUNK_M);
      const key = `${profileKey(run)}|${cx}|${cz}`;
      let group = groups.get(key);
      if (!group) {
        group = { run, cx, cz, segments: [] };
        groups.set(key, group);
      }
      group.segments.push({
        a,
        b: run.pts[i + 1],
        bearingA: bearings[i],
        bearingB: bearings[i + 1],
        lateral: run.lateral,
      });
    }
  }
  let clamped = 0;
  let count = 0;
  const step = (v: number, unit = RAIL_STEP_M): number => {
    const w = Math.round(v / unit);
    if (w < 0 || w > WORD_MAX) {
      clamped += 1;
    }
    return Math.min(Math.max(w, 0), WORD_MAX);
  };
  const chunks = [...groups.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, { run, cx, cz, segments }]): RailChunk => {
      // the chunk's corner, a margin out: a segment's far end still
      // counts upward from it
      const minY = Math.min(...segments.flatMap((s) => [s.a.y, s.b.y]));
      const origin: [number, number, number] = [
        cx * RAIL_CHUNK_M - CHUNK_MARGIN_M,
        Math.floor(minY) - 1,
        cz * RAIL_CHUNK_M - CHUNK_MARGIN_M,
      ];
      const words = new Uint16Array(segments.length * RAIL_RECORD_WORDS);
      for (const [i, s] of segments.entries()) {
        const at = i * RAIL_RECORD_WORDS;
        words[at] = step(s.a.x - origin[0]);
        words[at + 1] = step(s.a.y - origin[1], RAIL_STEP_Y_M);
        words[at + 2] = step(s.a.z - origin[2]);
        words[at + 3] = turnWord(s.bearingA);
        words[at + 4] = step(s.b.x - origin[0]);
        words[at + 5] = step(s.b.y - origin[1], RAIL_STEP_Y_M);
        words[at + 6] = step(s.b.z - origin[2]);
        words[at + 7] = turnWord(s.bearingB);
        // (an offset past ±32.7 m is counted like a coordinate out of
        // its chunk)
        words[at + 8] = step(
          s.lateral + RAIL_OFFSET_ZERO * RAIL_OFFSET_STEP_M,
          RAIL_OFFSET_STEP_M
        );
      }
      count += segments.length;
      return { gauge: run.gauge, look: run.look, origin, web: run.web, words };
    });
  if (report) {
    report.clamped = clamped;
    report.segments = count;
  }
  return chunks;
}

/** A record as the vertex stage reads it. */
export interface RailSegment {
  a: RailPoint;
  b: RailPoint;
  bearingA: number;
  bearingB: number;
  lateral: number;
}

export function railSegmentAt(chunk: RailChunk, index: number): RailSegment {
  const { origin, words } = chunk;
  const at = index * RAIL_RECORD_WORDS;
  const point = (o: number): RailPoint => ({
    x: origin[0] + words[at + o] * RAIL_STEP_M,
    y: origin[1] + words[at + o + 1] * RAIL_STEP_Y_M,
    z: origin[2] + words[at + o + 2] * RAIL_STEP_M,
  });
  return {
    a: point(0),
    b: point(4),
    bearingA: (words[at + 3] / RAIL_TURN_UNIT) * TAU,
    bearingB: (words[at + 7] / RAIL_TURN_UNIT) * TAU,
    lateral: (words[at + 8] - RAIL_OFFSET_ZERO) * RAIL_OFFSET_STEP_M,
  };
}

export const railSegmentCount = (chunk: RailChunk): number =>
  chunk.words.length / RAIL_RECORD_WORDS;

/**
 * Where the vertex stage puts a profile vertex of a segment: `t` along it
 * (0 at a, 1 at b), `across` metres from the track's middle (a rail's
 * side), `down` metres under the rail head. The same arithmetic as
 * rail-segments.ts's position node, for the tests and the measurements.
 */
export function expandRail(
  s: RailSegment,
  t: number,
  across: number,
  down = 0
): RailPoint {
  const mix = (a: number, b: number) => a + (b - a) * t;
  // the normal across the track: the tangent (cos, sin) turned a quarter
  const nx = mix(-Math.sin(s.bearingA), -Math.sin(s.bearingB));
  const nz = mix(Math.cos(s.bearingA), Math.cos(s.bearingB));
  const off = s.lateral + across;
  return {
    x: mix(s.a.x, s.b.x) + nx * off,
    y: mix(s.a.y, s.b.y) - down,
    z: mix(s.a.z, s.b.z) + nz * off,
  };
}

const MAGIC = "RLS0";

/**
 * The chunks as one file's bytes (the spike's stand-in for a section of
 * plan 090's container): a magic, the chunk count, then per chunk a
 * 24-byte header (origin as three float32, gauge and web as float32, the
 * look and the record count) and its records. Measured gzipped against
 * the GeoJSON and the baked triangles; nothing publishes it.
 */
export function railFile(chunks: readonly RailChunk[]): Uint8Array {
  const LOOKS: RailLook[] = ["rail", "tram", "tram-street"];
  const HEADER = 28;
  const size =
    8 + chunks.reduce((sum, c) => sum + HEADER + c.words.byteLength, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < MAGIC.length; i += 1) {
    view.setUint8(i, MAGIC.codePointAt(i) ?? 0);
  }
  view.setUint32(4, chunks.length, true);
  let at = 8;
  for (const c of chunks) {
    view.setFloat32(at, c.origin[0], true);
    view.setFloat32(at + 4, c.origin[1], true);
    view.setFloat32(at + 8, c.origin[2], true);
    view.setFloat32(at + 12, c.gauge, true);
    view.setFloat32(at + 16, c.web, true);
    view.setUint32(at + 20, LOOKS.indexOf(c.look), true);
    view.setUint32(at + 24, c.words.length / RAIL_RECORD_WORDS, true);
    at += HEADER;
    bytes.set(
      new Uint8Array(c.words.buffer, c.words.byteOffset, c.words.byteLength),
      at
    );
    at += c.words.byteLength;
  }
  return bytes;
}
