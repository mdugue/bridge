/**
 * What *Frag die Stadt*'s server tools answer from (ADR 0056): the
 * Stadtwissen (lib/city/stadtwissen.ts) searched and cut down to what a
 * model needs — a few entries, short keys, each with its source — so a
 * tool result stays a few hundred tokens. Pure: the route loads the files
 * and hands them in.
 */
import { ASK_LIMITS } from "./ask-city";
import {
  matchesQuery,
  nearby,
  type StadtwissenIndex,
  WIKIDATA_PROPERTIES,
  type WikidataProperty,
  type WissenBuilding,
  type WissenLandmark,
  type WissenMonument,
  type WissenTile,
  wikipediaUrl,
} from "./stadtwissen";

/** A site's Stadtwissen, loaded: the index and every tile's directory. */
export interface Knowledge {
  buildings: readonly WissenBuilding[];
  index: StadtwissenIndex;
  /** each landmark's footprint radius round its point, from the buildings
   *  that draw it (m) */
  landmarkRadius: ReadonlyMap<string, number>;
  monuments: readonly WissenMonument[];
}

export function knowledgeOf(
  index: StadtwissenIndex,
  tiles: readonly WissenTile[]
): Knowledge {
  const buildings = tiles.flatMap((t) => t.buildings);
  const at = new Map(index.landmarks.map((lm) => [lm.id, lm]));
  const landmarkRadius = new Map<string, number>();
  for (const b of buildings) {
    const lm = b.wd === undefined ? undefined : at.get(b.wd);
    if (lm && b.r !== undefined) {
      const reach = Math.hypot(b.x - lm.x, b.y - lm.y) + b.r;
      landmarkRadius.set(
        lm.id,
        Math.max(landmarkRadius.get(lm.id) ?? 0, reach)
      );
    }
  }
  return {
    index,
    buildings,
    landmarkRadius,
    monuments: tiles.flatMap((t) => t.monuments),
  };
}

/** One entry as a tool returns it. */
export interface KnowledgeHit {
  /** Gebäude, Wahrzeichen, Denkmal… */
  art: string;
  /** distance from the asked point (m), for the neighbourhood */
  abstand?: number;
  adresse?: string;
  /** height above ground (m) */
  h?: number;
  /** the id `fakten` takes */
  id: string;
  name: string;
  nutzung?: string;
  quelle: string;
  /** the radius of its footprint (m), where the model knows it */
  r?: number;
  wikidata?: string;
  x: number;
  y: number;
  /** ground at its base (m a.s.l.) */
  z?: number;
}

const round = (v: number) => Math.round(v);

function landmarkHit(k: Knowledge, lm: WissenLandmark): KnowledgeHit {
  const r = k.landmarkRadius.get(lm.id);
  return {
    art: "Wahrzeichen",
    id: lm.id,
    name: lm.name,
    x: round(lm.x),
    y: round(lm.y),
    ...(lm.z === undefined ? {} : { z: round(lm.z) }),
    h: round(lm.h),
    ...(r === undefined ? {} : { r: round(r) }),
    wikidata: lm.id,
    quelle: "Wikidata, LoD2",
  };
}

function monumentHit(m: WissenMonument): KnowledgeHit {
  return {
    art: m.kind,
    id: m.id,
    name: m.name,
    x: round(m.x),
    y: round(m.y),
    ...(m.wd ? { wikidata: m.wd } : {}),
    quelle: "Basis-DLM, OpenStreetMap",
  };
}

/** An AdV use that says nothing (ALKIS's "not to be specified"). */
const NO_USE = /nicht zu spezifizieren/i;

function buildingHit(b: WissenBuilding): KnowledgeHit {
  return {
    art: "Gebäude",
    id: b.id,
    name: b.name ?? b.addr ?? "Gebäude",
    x: round(b.x),
    y: round(b.y),
    z: round(b.z),
    ...(b.h === undefined ? {} : { h: round(b.h) }),
    ...(b.r === undefined ? {} : { r: round(b.r) }),
    ...(b.addr ? { adresse: b.addr } : {}),
    ...(b.use && !NO_USE.test(b.use) ? { nutzung: b.use } : {}),
    ...(b.wd ? { wikidata: b.wd } : {}),
    quelle: b.name || b.addr ? "OpenStreetMap, LoD2" : "LoD2",
  };
}

/**
 * Landmarks, monuments and buildings whose name or address holds every
 * word, the most notable first; a building that draws a found landmark
 * is that landmark, not a second hit.
 */
export function searchKnowledge(k: Knowledge, query: string): KnowledgeHit[] {
  const landmarks = k.index.landmarks
    .filter((lm) => matchesQuery(lm, query))
    .sort((a, b) => b.links - a.links);
  const covered = new Set(landmarks.map((lm) => lm.id));
  const hits = [
    ...landmarks.map((lm) => landmarkHit(k, lm)),
    ...k.monuments.filter((m) => matchesQuery(m, query)).map(monumentHit),
    ...k.buildings
      .filter(
        (b) =>
          matchesQuery(b, query) && !(b.wd !== undefined && covered.has(b.wd))
      )
      .map(buildingHit),
  ];
  return hits.slice(0, ASK_LIMITS.results);
}

/** How far the neighbourhood reaches for an asked radius (m): the
 *  buildings and monuments, and the landmarks (seen from further). */
export function nearReach(radius: number): {
  buildings: number;
  landmarks: number;
} {
  const r = Math.min(Math.max(radius, 10), ASK_LIMITS.radius);
  return { buildings: r, landmarks: r * 3 };
}

/**
 * What stands near a point, nearest first: landmarks within three times
 * the radius (they are seen from further), named monuments and the named
 * or addressed buildings within it — one entry per landmark.
 */
export function nearKnowledge(
  k: Knowledge,
  x: number,
  y: number,
  radius: number
): KnowledgeHit[] {
  const { buildings: r, landmarks: far } = nearReach(radius);
  const landmarks = nearby(k.index.landmarks, x, y, far);
  const covered = new Set(landmarks.map((lm) => lm.id));
  const hits: KnowledgeHit[] = [
    ...landmarks.map((lm) => ({
      ...landmarkHit(k, lm),
      abstand: round(lm.d),
    })),
    ...nearby(k.monuments, x, y, r).map((m) => ({
      ...monumentHit(m),
      abstand: round(m.d),
    })),
    ...nearby(
      k.buildings.filter(
        (b) =>
          (b.name !== undefined || b.addr !== undefined) &&
          !(b.wd !== undefined && covered.has(b.wd))
      ),
      x,
      y,
      r
    ).map((b) => ({ ...buildingHit(b), abstand: round(b.d) })),
  ];
  return hits
    .sort((a, b) => (a.abstand ?? 0) - (b.abstand ?? 0))
    .slice(0, ASK_LIMITS.results);
}

/** Wikidata's statements of a landmark in words, each with its label. */
function landmarkFacts(
  k: Knowledge,
  lm: WissenLandmark
): Record<string, unknown> {
  const f = lm.facts;
  const aussagen: Record<string, string> = {};
  for (const [p, values] of Object.entries(f?.claims ?? {})) {
    const label = WIKIDATA_PROPERTIES[p as WikidataProperty];
    if (label && values && values.length > 0) {
      aussagen[label] = values.map((v) => v.v).join("; ");
    }
  }
  return {
    ...landmarkHit(k, lm),
    ...(f?.description ? { beschreibung: f.description } : {}),
    aussagen,
    quellen: [
      `https://www.wikidata.org/wiki/${lm.id}`,
      ...(f?.wiki ? [wikipediaUrl(f.wiki)] : []),
    ],
    gebaeudeteile: lm.objects.length,
  };
}

/**
 * Everything the twin knows of one id: a landmark's Wikidata statements
 * (`Q…`), a monument's row (`m<x>_<y>`) or a building's (its gml:id) with
 * the landmark it belongs to. Null for an unknown id.
 */
export function factsOf(
  k: Knowledge,
  id: string
): Record<string, unknown> | null {
  const lm = k.index.landmarks.find((l) => l.id === id);
  if (lm) {
    return landmarkFacts(k, lm);
  }
  const m = k.monuments.find((e) => e.id === id);
  if (m) {
    return {
      ...monumentHit(m),
      ...(m.material ? { material: m.material } : {}),
    };
  }
  const b = k.buildings.find((e) => e.id === id);
  if (!b) {
    return null;
  }
  const owner = b.wd ? k.index.landmarks.find((l) => l.id === b.wd) : undefined;
  return {
    ...buildingHit(b),
    ...(b.roof ? { dach: b.roof } : {}),
    ...(b.levels === undefined ? {} : { geschosse: b.levels }),
    ...(b.heritage ? { denkmal: true } : {}),
    ...(b.shop ? { laden: true } : {}),
    ...(owner ? { teil_von: owner.name } : {}),
  };
}

/** Who publishes the facts, under which licence. */
export function sourcesOf(k: Knowledge): Record<string, string>[] {
  return Object.values(k.index.sources).flatMap((s) =>
    s
      ? [
          {
            quelle: s.label,
            lizenz: s.licence,
            vermerk: s.credit,
            ...(s.stand ? { stand: s.stand } : {}),
          },
        ]
      : []
  );
}
