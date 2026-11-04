/**
 * Scaling checks that do not depend on how fast or busy the machine is.
 *
 * A wall-clock cap ("must finish within 5 s") fails on a slow shared runner without saying anything about the code. These helpers
 * compare the CPU time used for an input with the CPU time used for one eight times larger: linear work gives a ratio of about 8,
 * quadratic work about 64.
 */

/** Largest acceptable CPU-time ratio for an 8x larger input. */
export const MAX_GROWTH = 24;

/**
 * CPU microseconds of the calling thread. Not the whole process: V8's parallel garbage-collector threads spin while waiting when the
 * machine is oversubscribed, which inflates process-wide CPU time for allocation-heavy (larger) inputs and has nothing to do with the code.
 */
function threadCpuMicros(): number {
  const used = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage();
  return used.user + used.system;
}

/** CPU milliseconds used by `fn`; the best of five runs, so a busy machine does not inflate it. */
function cpuMs(fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const before = threadCpuMicros();
    fn();
    best = Math.min(best, (threadCpuMicros() - before) / 1000);
  }
  return best;
}

/**
 * CPU time of `fn` on `make(8 * n)` divided by its CPU time on `make(n)`. The small time is floored at 10 ms so timer granularity
 * and one-off hiccups cannot inflate the ratio.
 */
export function growth<T>(make: (size: number) => T, n: number, fn: (input: T) => unknown): number {
  const small = make(n);
  const large = make(8 * n);
  fn(small);
  return cpuMs(() => fn(large)) / Math.max(cpuMs(() => fn(small)), 10);
}
