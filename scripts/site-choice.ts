/**
 * Which sites a run of scripts/prepare-sites.ts prepares, and which it
 * leaves served as they are:
 *
 * - sites named on the command line: those alone, and every other site's
 *   folder is pruned (a deployment of some cities);
 * - `PREPARE_SITES=dresden,meissen` (`bun dev` at one city): those alone
 *   are prepared, and every other site already in public/data stays as it
 *   was built last — served, possibly stale, never pruned;
 * - neither: every site whose data is ready.
 *
 * No file access: the caller says what is known, ready and built.
 */

export interface SiteChoice {
  /** left as it was built last, and still served */
  keep: string[];
  /** prepared now */
  prepare: string[];
  /** a name that is no site (the caller fails with it) */
  unknown?: string;
}

export function chosenSites(given: {
  /** `PREPARE_SITES` */
  env?: string;
  /** the registry's ids, in its order */
  known: readonly string[];
  /** the command line's ids */
  named: readonly string[];
  /** whether a site's source data is on disk */
  ready: (id: string) => boolean;
  /** whether a site was built into public/data before */
  built: (id: string) => boolean;
}): SiteChoice {
  const { known, named, ready, built } = given;
  const asked = (given.env ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  const unknown = [...named, ...asked].find((id) => !known.includes(id));
  if (unknown !== undefined) {
    return { keep: [], prepare: [], unknown };
  }
  if (named.length > 0) {
    return { keep: [], prepare: [...named] };
  }
  if (asked.length === 0) {
    return { keep: [], prepare: known.filter(ready) };
  }
  return {
    keep: known.filter((id) => !asked.includes(id) && built(id)),
    prepare: known.filter((id) => asked.includes(id)),
  };
}
