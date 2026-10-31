// Places mentioned in location restrictions ("US only", "EU residents", "based in Canada") and
// the freelancer's declared location, resolved onto canonical place ids.
// A country belongs to zero or more regions; a restriction naming a region includes all its countries.

interface Place {
  readonly id: string;
  readonly names: readonly string[];
  readonly regions: readonly string[];
}

function p(id: string, names: readonly string[], regions: readonly string[] = []): Place {
  return { id, names, regions };
}

const COUNTRIES: readonly Place[] = [
  p('us', ['united states', 'united states of america', 'usa', 'u.s.', 'u.s.a.', 'us', 'america'], ['north-america', 'americas']),
  p('ca', ['canada', 'canadian'], ['north-america', 'americas']),
  p('mx', ['mexico'], ['latam', 'north-america', 'americas']),
  p('br', ['brazil', 'brasil'], ['latam', 'americas']),
  p('ar', ['argentina'], ['latam', 'americas']),
  p('co', ['colombia'], ['latam', 'americas']),
  p('cl', ['chile'], ['latam', 'americas']),
  p('gb', ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales'], ['europe']),
  p('ie', ['ireland'], ['europe', 'eu']),
  p('de', ['germany', 'deutschland'], ['europe', 'eu']),
  p('fr', ['france'], ['europe', 'eu']),
  p('es', ['spain'], ['europe', 'eu']),
  p('pt', ['portugal'], ['europe', 'eu']),
  p('it', ['italy'], ['europe', 'eu']),
  p('nl', ['netherlands', 'the netherlands', 'holland'], ['europe', 'eu']),
  p('be', ['belgium'], ['europe', 'eu']),
  p('se', ['sweden'], ['europe', 'eu']),
  p('dk', ['denmark'], ['europe', 'eu']),
  p('fi', ['finland'], ['europe', 'eu']),
  p('pl', ['poland'], ['europe', 'eu']),
  p('ro', ['romania'], ['europe', 'eu']),
  p('at', ['austria'], ['europe', 'eu']),
  p('cz', ['czech republic', 'czechia'], ['europe', 'eu']),
  p('gr', ['greece'], ['europe', 'eu']),
  p('ch', ['switzerland'], ['europe']),
  p('no', ['norway'], ['europe']),
  p('ua', ['ukraine'], ['europe']),
  p('ru', ['russia'], ['europe']),
  p('tr', ['turkey', 'türkiye', 'turkiye'], ['europe', 'middle-east']),
  p('il', ['israel'], ['middle-east']),
  p('ae', ['united arab emirates', 'uae', 'dubai'], ['middle-east']),
  p('sa', ['saudi arabia'], ['middle-east']),
  p('eg', ['egypt'], ['middle-east', 'africa']),
  p('ng', ['nigeria'], ['africa']),
  p('ke', ['kenya'], ['africa']),
  p('za', ['south africa'], ['africa']),
  p('in', ['india', 'indian'], ['asia', 'apac']),
  p('pk', ['pakistan'], ['asia']),
  p('bd', ['bangladesh'], ['asia']),
  p('vn', ['vietnam', 'viet nam'], ['asia', 'apac', 'sea']),
  p('th', ['thailand'], ['asia', 'apac', 'sea']),
  p('id', ['indonesia'], ['asia', 'apac', 'sea']),
  p('ph', ['philippines'], ['asia', 'apac', 'sea']),
  p('my', ['malaysia'], ['asia', 'apac', 'sea']),
  p('sg', ['singapore'], ['asia', 'apac', 'sea']),
  p('cn', ['china'], ['asia', 'apac']),
  p('jp', ['japan'], ['asia', 'apac']),
  p('kr', ['south korea', 'korea'], ['asia', 'apac']),
  p('au', ['australia'], ['apac', 'oceania']),
  p('nz', ['new zealand'], ['apac', 'oceania']),
];

const REGIONS: readonly Place[] = [
  p('north-america', ['north america']),
  p('americas', ['the americas']),
  p('latam', ['latin america', 'latam']),
  p('europe', ['europe', 'european']),
  p('eu', ['european union', 'eu', 'eea']),
  p('asia', ['asia']),
  p('apac', ['apac', 'asia pacific', 'asia-pacific']),
  p('sea', ['southeast asia', 'south east asia']),
  p('middle-east', ['middle east', 'mena']),
  p('africa', ['africa']),
  p('oceania', ['oceania']),
];

const ALL: readonly Place[] = [...COUNTRIES, ...REGIONS];
const COUNTRY_IDS = new Set(COUNTRIES.map((c) => c.id));
const REGIONS_OF = new Map(COUNTRIES.map((c) => [c.id, c.regions] as const));

export function isCountry(id: string): boolean {
  return COUNTRY_IDS.has(id);
}

/** Resolves a place name such as "Viet Nam" or "EU" to its id; undefined when unknown. */
export function resolvePlace(name: string): string | undefined {
  const needle = name.trim().toLowerCase();
  for (const place of ALL) if (place.id === needle || place.names.includes(needle)) return place.id;
  return undefined;
}

/** True when `placeId` (a country or region) contains or equals `countryId`. */
export function placeIncludes(placeId: string, countryId: string): boolean {
  if (placeId === countryId) return true;
  return REGIONS_OF.get(countryId)?.includes(placeId) ?? false;
}

export interface PlaceMention {
  readonly id: string;
  readonly index: number;
  readonly text: string;
}

let placeRegex: RegExp | undefined;
const nameToId = new Map<string, string>();

function buildPlaceRegex(): RegExp {
  const names: string[] = [];
  for (const place of ALL) {
    for (const name of place.names) {
      names.push(name);
      if (!nameToId.has(name)) nameToId.set(name, place.id);
    }
  }
  names.sort((a, b) => b.length - a.length);
  const alternation = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![a-z0-9])(?:${alternation})(?![a-z0-9])`, 'gi');
}

/** Place mentions in `text`, left to right. Names of up to three characters (US, EU, UK) match only when upper-case. */
export function findPlaces(text: string): PlaceMention[] {
  placeRegex ??= buildPlaceRegex();
  const out: PlaceMention[] = [];
  for (const m of text.matchAll(placeRegex)) {
    const raw = m[0];
    const key = raw.toLowerCase();
    if (key.length <= 3 && raw !== raw.toUpperCase()) continue; // "us", "eu", "uk" only count when upper-case
    const id = nameToId.get(key);
    if (id !== undefined) out.push({ id, index: m.index ?? 0, text: raw });
  }
  return out;
}

/** Approximate UTC offsets in hours for the abbreviations job posts use. */
const ZONES: Readonly<Record<string, number>> = {
  pst: -8, pdt: -7, pt: -8, mst: -7, mdt: -6, cst: -6, cdt: -5, est: -5, edt: -4, et: -5, ct: -6, mt: -7,
  gmt: 0, utc: 0, wet: 0, bst: 1, cet: 1, cest: 2, eet: 2, eest: 3, msk: 3,
  ist: 5.5, ict: 7, wib: 7, sgt: 8, hkt: 8, awst: 8, jst: 9, kst: 9, aest: 10, aedt: 11, nzst: 12,
};

export function zoneOffset(abbreviation: string): number | undefined {
  return ZONES[abbreviation.toLowerCase()];
}

export const ZONE_ABBREVIATIONS: readonly string[] = Object.keys(ZONES);

/** Parses "UTC+7", "UTC-5:30", "GMT+1" into hours; undefined if the shape is not recognised. */
export function parseUtcOffset(text: string): number | undefined {
  const m = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(text.trim());
  if (m === null) return undefined;
  const hours = Number(m[2]) + (m[3] === undefined ? 0 : Number(m[3]) / 60);
  if (hours > 14) return undefined;
  return m[1] === '-' ? -hours : hours;
}
