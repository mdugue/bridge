/**
 * `bun scripts/walks.ts <site> <command>`: the author's tools for the
 * Erzählte Spaziergänge (lib/city/walks.ts) of `data/<site>/walks/`.
 *
 *   ground          writes each stop's `ground` from the site's DGM1
 *   shots [walk]    writes each stop as a snapshot to shots/ (bun run shots
 *                   renders them; needs the site built, for its offset)
 *   photos [--force] [--refs]
 *                   fetches the Commons file each stop's `photo` names
 *                   (with --refs, a stop naming none gets its first ref's
 *                   Wikidata image) as a small WebP into walks/photos/,
 *                   and writes the credit Commons gives (network: an
 *                   author's tool, never part of a build)
 *   check           prints what walks.test.ts would refuse
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { siteDataDir } from "../lib/city/tile";
import {
  stopCamera,
  stopDate,
  type Walk,
  type WalkStop,
  WALKS_DIR,
  walkPhotoFile,
  walkProblems,
} from "../lib/city/walks";
import { siteFromArgs } from "../sites";
import { readDgmFile } from "./dgm-cache";
import { siteDgm } from "./line-levels";

const ROOT = join(import.meta.dir, "..");
const { site, rest } = siteFromArgs(process.argv.slice(2));
const dir = join(ROOT, siteDataDir(site), WALKS_DIR);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const walks = files.map((f) => ({
  file: join(dir, f),
  walk: JSON.parse(readFileSync(join(dir, f), "utf8")) as Walk,
}));
const out = (line: string) => process.stdout.write(`${line}\n`);

async function fillGround(): Promise<void> {
  const heightAt = await siteDgm(site, (tif, tfw) =>
    readDgmFile(tif, tfw, "native")
  );
  for (const { file, walk } of walks) {
    for (const stop of walk.stops) {
      const h = heightAt(stop.from[0], stop.from[1]);
      if (h === null) {
        out(`${walk.id}/${stop.id}: no ground at ${stop.from.join(", ")}`);
        continue;
      }
      stop.ground = Math.round(h * 10) / 10;
    }
    writeFileSync(file, `${JSON.stringify(walk, null, 2)}\n`);
    out(`${walk.id}: ${walk.stops.length} stops grounded`);
  }
}

function writeShots(only?: string): void {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "public/data", site.id, "manifest.json"), "utf8")
  ) as { files: Record<string, string> };
  const tileset = JSON.parse(
    readFileSync(
      join(ROOT, "public/data", site.id, manifest.files["tileset.json"]),
      "utf8"
    )
  ) as { extras: { offset: { cx: number; cy: number } } };
  const offset = tileset.extras.offset;
  mkdirSync(join(ROOT, "shots"), { recursive: true });
  const today = new Date();
  for (const { walk } of walks.filter((w) => !only || w.walk.id === only)) {
    walk.stops.forEach((stop, i) => {
      const camera = stopCamera(stop, offset);
      const date = stopDate(stop, today);
      const snapshot = {
        v: 1,
        camera,
        date: date.toISOString(),
        look: { style: stop.style ?? "pastel" },
      };
      const name = `walk-${walk.id}-${String(i + 1).padStart(2, "0")}-${stop.id}.json`;
      writeFileSync(join(ROOT, "shots", name), JSON.stringify(snapshot));
      out(name);
    });
  }
}

// --- photos -------------------------------------------------------------------

/** How wide a stop's photo is kept (px): a card's width on a sharp screen. */
const PHOTO_WIDTH = 800;
/** The Commons thumbnail it is made from: one of the standard widths,
 *  which Commons keeps ready; another width is rendered on demand and
 *  rate-limited hard. */
const COMMONS_WIDTH = 960;
const USER_AGENT = "city-walk walk photos (https://mit.manuel.fyi)";

/** A Wikimedia request, waiting out its rate limit (429) a few times. */
async function wikimedia(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    // politely spaced: Wikimedia limits bursts
    await Bun.sleep(1500);
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status !== 429 || attempt === 8) {
      if (!res.ok) {
        throw new Error(`${url}: ${res.status}`);
      }
      return res;
    }
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 5;
    out(`Wikimedia asks to wait ${wait} s`);
    await Bun.sleep(wait * 1000);
  }
}

async function json<T>(url: string): Promise<T> {
  return (await (await wikimedia(url)).json()) as T;
}

/** Up to 50 names per Wikimedia API call: one call for many stops, since
 *  Wikimedia's rate limit counts calls, not names. */
function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += 50) {
    out.push(list.slice(i, i + 50));
  }
  return out;
}

/** The Wikidata image (P18) of each item that has one. */
async function refImages(ids: string[]): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  for (const part of chunks(ids)) {
    const got = await json<{
      entities: Record<
        string,
        {
          claims?: {
            P18?: { mainsnak: { datavalue?: { value: string } } }[];
          };
        }
      >;
    }>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids=${part.join("|")}`
    );
    for (const [id, entity] of Object.entries(got.entities)) {
      const file = entity.claims?.P18?.[0]?.mainsnak.datavalue?.value;
      if (file) {
        images.set(id, file);
      }
    }
  }
  return images;
}

/** Text from Commons' HTML credit fields. */
const plain = (html: string | undefined) =>
  (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

interface CommonsInfo {
  descriptionurl: string;
  extmetadata: Record<string, { value: string } | undefined>;
  thumbheight: number;
  thumburl: string;
  thumbwidth: number;
}

/** Each file's thumbnail and credit, by the name the stop gave. */
async function commonsInfo(files: string[]): Promise<Map<string, CommonsInfo>> {
  const infos = new Map<string, CommonsInfo>();
  for (const part of chunks(files)) {
    const got = await json<{
      query: {
        normalized?: { from: string; to: string }[];
        redirects?: { from: string; to: string }[];
        pages: Record<string, { imageinfo?: CommonsInfo[]; title: string }>;
      };
    }>(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&redirects=1&iiprop=url|extmetadata&iiurlwidth=${COMMONS_WIDTH}&titles=${encodeURIComponent(part.map((f) => `File:${f}`).join("|"))}`
    );
    // back from the title Commons answers with to the one asked for:
    // through a redirect (a moved file), then the normalisation
    const back = new Map(
      [...(got.query.normalized ?? []), ...(got.query.redirects ?? [])].map(
        (n) => [n.to, n.from]
      )
    );
    const asked = (title: string): string => {
      const from = back.get(title);
      return from === undefined ? title : asked(from);
    };
    for (const page of Object.values(got.query.pages)) {
      const info = page.imageinfo?.[0];
      if (info) {
        infos.set(asked(page.title).replace(/^File:/, ""), info);
      }
    }
  }
  return infos;
}

/** The thumbnail as WebP (ImageMagick), where ImageMagick is there. */
async function webp(url: string, to: string): Promise<void> {
  const bytes = new Uint8Array(await (await wikimedia(url)).arrayBuffer());
  const magick = Bun.spawnSync(
    [
      "convert",
      "-",
      "-strip",
      "-resize",
      `${PHOTO_WIDTH}x>`,
      "-quality",
      "62",
      "-define",
      "webp:method=6",
      `webp:${to}`,
    ],
    { stdin: bytes }
  );
  if (magick.exitCode !== 0) {
    throw new Error(`convert failed: ${magick.stderr.toString()}`);
  }
}

/** The copy's size: the thumbnail's, narrowed to PHOTO_WIDTH. */
function photoSize(info: CommonsInfo): { h: number; w: number } {
  const w = Math.min(info.thumbwidth, PHOTO_WIDTH);
  return { h: Math.round((info.thumbheight * w) / info.thumbwidth), w };
}

/** Whether the credit a stop holds is the named file's (not a former one's). */
function fetchedAs(photo: WalkStop["photo"], name: string): boolean {
  if (!photo?.author) {
    return false;
  }
  const page = decodeURIComponent(photo.page).replace(/_/g, " ");
  return page.endsWith(`File:${name.replace(/_/g, " ")}`);
}

interface PhotoJob {
  copy: string;
  name: string;
  stop: WalkStop;
  where: string;
}

/** The stops whose photo is to be fetched: named, or (with `--refs`) the
 *  first ref's Wikidata image for a stop that names none. */
async function photoJobs(force: boolean, refs: boolean): Promise<PhotoJob[]> {
  const stops = walks.flatMap(({ walk }) =>
    walk.stops.map((stop) => ({ stop, walk }))
  );
  const firstRef = (stop: WalkStop) => stop.refs?.find((r) => /^Q\d+$/.test(r));
  const unnamed = refs
    ? stops.flatMap(({ stop }) =>
        stop.photo?.file ? [] : [firstRef(stop) ?? []].flat()
      )
    : [];
  const images = await refImages(unnamed);
  const jobs: PhotoJob[] = [];
  for (const { stop, walk } of stops) {
    const where = `${walk.id}/${stop.id}`;
    const ref = firstRef(stop);
    const name = stop.photo?.file ?? (ref && images.get(ref));
    if (!name) {
      if (refs) {
        out(`${where}: no photo (name one in photo.file)`);
      }
      continue;
    }
    const copy = join(dir, walkPhotoFile(walk.id, stop.id));
    if (force || !(fetchedAs(stop.photo, name) && existsSync(copy))) {
      jobs.push({ copy, name, stop, where });
    }
  }
  return jobs;
}

async function fetchPhotos(force: boolean, refs: boolean): Promise<void> {
  mkdirSync(join(dir, "photos"), { recursive: true });
  const jobs = await photoJobs(force, refs);
  const infos = await commonsInfo([...new Set(jobs.map((j) => j.name))]);
  for (const { copy, name, stop, where } of jobs) {
    const info = infos.get(name);
    if (!info) {
      out(`${where}: Commons has no file ${name}`);
      continue;
    }
    const meta = info.extmetadata;
    await webp(info.thumburl, copy);
    stop.photo = {
      file: name,
      ...(stop.photo?.caption ? { caption: stop.photo.caption } : {}),
      author: plain(meta.Artist?.value) || plain(meta.Credit?.value),
      licence: plain(meta.LicenseShortName?.value),
      ...(meta.LicenseUrl?.value ? { licenceUrl: meta.LicenseUrl.value } : {}),
      page: info.descriptionurl,
      ...photoSize(info),
    };
    out(`${where}: ${name} · ${stop.photo.author} · ${stop.photo.licence}`);
    // written at once: a stopped run keeps what it fetched
    const own = walks.find((w) => w.walk.stops.includes(stop));
    if (own) {
      writeFileSync(own.file, `${JSON.stringify(own.walk, null, 2)}\n`);
    }
  }
}

switch (rest[0]) {
  case "photos":
    await fetchPhotos(rest.includes("--force"), rest.includes("--refs"));
    break;
  case "ground":
    await fillGround();
    break;
  case "shots":
    writeShots(rest[1]);
    break;
  case "check":
    for (const { walk } of walks) {
      walkProblems(walk).forEach(out);
    }
    break;
  default:
    out("ground | shots [walk] | photos [--force] [--refs] | check");
}
