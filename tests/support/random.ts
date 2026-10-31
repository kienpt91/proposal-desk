// Small seeded PRNG (mulberry32) so property-style tests are reproducible.
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }

  subset<T>(items: readonly T[], max = items.length): T[] {
    const copy = [...items];
    const out: T[] = [];
    const count = this.int(Math.min(max, copy.length) + 1);
    for (let i = 0; i < count; i++) out.push(copy.splice(this.int(copy.length), 1)[0] as T);
    return out;
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.int(256);
    return out;
  }
}

/** Runs `body` for `runs` different seeds; the failing seed is part of the error message. */
export function forSeeds(runs: number, body: (random: Random, seed: number) => void): void {
  for (let seed = 1; seed <= runs; seed++) {
    try {
      body(new Random(seed), seed);
    } catch (error) {
      throw new Error(`property failed for seed ${seed}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }
}
