/** Where an address is on earth, as far as three public providers can tell. */

export interface Place {
  cc: string;
  city: string;
}

/** What a provider answers, as far as we look at it. */
type Answer = Record<string, string> & { success?: boolean };

interface Source {
  host: string;
  url: (ip: string) => string;
  read: (j: Answer) => Place | null;
}

/**
 * Country and city behind an address. Three providers, tried in order: the first
 * that answers wins, so one of them being down or rate-limiting costs nothing but
 * a moment. (ip-api.com is deliberately absent — it is unreachable from this host.)
 *
 * Answers are remembered for as long as the process lives, and a failure is
 * remembered only briefly so a provider having a bad minute does not leave an
 * address unknown for good. Nothing is looked up until an administrator actually
 * opens the page, and only for the rows shown.
 */
export const GEO_SOURCES: Source[] = [
  {
    host: "ipinfo.io",
    url: (ip) => "https://ipinfo.io/" + ip + "/json",
    read: (j) => (j.country ? { cc: j.country, city: j.city || "" } : null),
  },
  {
    host: "geojs.io",
    url: (ip) => "https://get.geojs.io/v1/ip/geo/" + ip + ".json",
    read: (j) => (j.country_code ? { cc: j.country_code, city: j.city || "" } : null),
  },
  {
    host: "ipwho.is",
    url: (ip) => "https://ipwho.is/" + ip,
    read: (j) => (j.success && j.country_code ? { cc: j.country_code, city: j.city || "" } : null),
  },
];

const GEO_RETRY = 10 * 60e3;

/** An address with no place on earth: nothing out there can tell us about it. */
export const isLocal = (ip: string): boolean =>
  !ip ||
  ip === "-" ||
  ip === "::1" ||
  /^127\./.test(ip) ||
  /^10\./.test(ip) ||
  /^192\.168\./.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  /^169\.254\./.test(ip) ||
  /^f[cde]/i.test(ip);

export interface Geo {
  /** Resolve whatever among `ips` we do not know yet, a few at a time. */
  fill(ips: string[]): Promise<void>;
  /** "City, CC", "CC", "—" for a local address, "?" for one nobody could place. */
  placeOf(ip: string): string;
}

export function createGeo(): Geo {
  const known = new Map<string, Place>(); // ip -> { cc, city } once somebody answered
  const missed = new Map<string, number>(); // ip -> when we gave up, so we can try again later

  async function lookup(ip: string): Promise<void> {
    for (const src of GEO_SOURCES) {
      try {
        const r = await fetch(src.url(ip), { signal: AbortSignal.timeout(4000) });
        if (!r.ok) continue;
        const found = src.read((await r.json()) as Answer);
        if (found) {
          known.set(ip, found);
          missed.delete(ip);
          return;
        }
      } catch {
        /* down, slow or rate-limiting — the next one gets its turn */
      }
    }
    missed.set(ip, Date.now());
  }

  return {
    async fill(ips) {
      const todo = [...new Set(ips)].filter(
        (ip) => !isLocal(ip) && !known.has(ip) && !(Date.now() - (missed.get(ip) ?? 0) < GEO_RETRY),
      );
      while (todo.length) await Promise.all(todo.splice(0, 8).map(lookup));
    },
    placeOf(ip) {
      if (isLocal(ip)) return "—";
      const g = known.get(ip);
      if (!g) return "?";
      return g.city ? g.city + ", " + g.cc : g.cc;
    },
  };
}
