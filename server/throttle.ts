/**
 * Password guessing, slowed down per address. Every wrong password counts against the
 * address it came from; after `tries` of them within `window` ms the address is locked
 * out for `lock` ms, and while it is, no password is even looked at — the right one
 * included, so a guesser cannot tell when they have hit it. A right password before
 * that clears the count. Parallel requests count one by one, so firing many guesses at
 * once gains nothing.
 *
 * Kept in memory only: a restart forgets it, which costs a guesser a restart of our
 * server they cannot cause. The map is pruned as it is used, and never holds more than
 * `MAX_KEYS` addresses.
 */

export interface ThrottleOptions {
  tries: number;
  window: number;
  lock: number;
  /** the clock, from outside so the tests can move it */
  now?: () => number;
}

export interface Throttle {
  /** ms until this address may try again, 0 when it may now */
  wait(ip: string): number;
  /** a wrong password from this address */
  fail(ip: string): void;
  /** a right one: the count starts afresh */
  pass(ip: string): void;
}

interface Entry {
  /** the times of the wrong passwords within the window, oldest first */
  fails: number[];
  /** locked until then; 0 when not locked */
  until: number;
}

const MAX_KEYS = 10000;

export function createThrottle({ tries, window, lock, now = Date.now }: ThrottleOptions): Throttle {
  const seen = new Map<string, Entry>();

  const prune = (t: number) => {
    for (const [ip, e] of seen) {
      if (e.until <= t && (e.fails.length === 0 || e.fails[e.fails.length - 1] <= t - window)) seen.delete(ip);
    }
  };

  return {
    wait(ip) {
      const e = seen.get(ip);
      return e ? Math.max(0, e.until - now()) : 0;
    },
    fail(ip) {
      const t = now();
      if (seen.size >= MAX_KEYS) prune(t);
      const e = seen.get(ip) ?? { fails: [], until: 0 };
      e.fails = e.fails.filter((at) => at > t - window).concat(t);
      if (e.fails.length >= tries) {
        e.until = t + lock;
        e.fails = [];
      }
      // a map full of locked addresses drops the oldest: the newest guesser stays locked
      if (!seen.has(ip) && seen.size >= MAX_KEYS) seen.delete(seen.keys().next().value as string);
      seen.set(ip, e);
    },
    pass(ip) {
      seen.delete(ip);
    },
  };
}
