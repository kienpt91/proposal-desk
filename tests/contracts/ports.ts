import { describe, expect, it } from 'vitest';
import type { ConfigStore, FactStore, LogStore, ObjectStore, SecretStore } from '../../src/application/ports/index.js';
import { defaultConfig, setConfigValue, type Config } from '../../src/domain/config/config.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import { nextEntry, verifyChain } from '../../src/domain/log/chain.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { fact, rateFact } from '../support/builders.js';

// Behaviour every adapter of a port must show. The same suite runs against the in-memory fake
// used by the application tests and against the real file adapter, so the fake cannot drift.

type Factory<T> = () => Promise<T> | T;

export function logStoreContract(name: string, create: Factory<LogStore>): void {
  describe(`LogStore contract: ${name}`, () => {
    const add = (log: LogStore, n: number) => log.append((previous) => nextEntry(previous, '2026-10-31T10:00:00.000Z', 'job.analyzed', { n }));

    it('starts empty', async () => {
      expect(await (await create()).readAll()).toEqual([]);
    });

    it('hands the previous entry to the builder and returns what it appended', async () => {
      const log = await create();
      const first = await add(log, 1);
      const seen: unknown[] = [];
      const second = await log.append((previous) => {
        seen.push(previous);
        return nextEntry(previous, '2026-10-31T10:00:01.000Z', 'job.analyzed', { n: 2 });
      });
      expect(seen).toEqual([first]);
      expect(await log.readAll()).toEqual([first, second]);
      expect(verifyChain(await log.readAll()).ok).toBe(true);
    });

    it('keeps the chain intact under concurrent appends', async () => {
      const log = await create();
      await Promise.all(Array.from({ length: 15 }, (_, i) => add(log, i)));
      const entries = await log.readAll();
      expect(entries.map((e) => e.seq)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(verifyChain(entries)).toMatchObject({ ok: true, length: 15 });
    });

    it('stores text with quotes, newlines and unicode faithfully', async () => {
      const log = await create();
      const text = 'line\nbreak "quoted" \\ đồng ✓ \u202e';
      await log.append((previous) => nextEntry(previous, '2026-10-31T10:00:00.000Z', 'outcome.recorded', { note: text }));
      expect((await log.readAll())[0]?.payload.note).toBe(text);
    });
  });
}

export function objectStoreContract(name: string, create: Factory<ObjectStore>): void {
  describe(`ObjectStore contract: ${name}`, () => {
    it('stores content under its SHA-256 and returns it unchanged', async () => {
      const store = await create();
      const text = 'Senior engineer wanted\nđồng ✓';
      const digest = await store.put(text);
      expect(digest).toBe(sha256(text));
      expect(await store.get(digest)).toBe(text);
    });

    it('is idempotent and reports unknown keys as absent', async () => {
      const store = await create();
      expect(await store.put('same')).toBe(await store.put('same'));
      expect(await store.get(sha256('never stored'))).toBeUndefined();
    });

    it('stores the empty string', async () => {
      const store = await create();
      const digest = await store.put('');
      expect(await store.get(digest)).toBe('');
    });
  });
}

export function factStoreContract(name: string, create: Factory<FactStore>): void {
  describe(`FactStore contract: ${name}`, () => {
    const base = () => FactBase.empty().add(fact()).value.add(rateFact()).value;

    it('reports a missing file as undefined', async () => {
      expect(await (await create()).load()).toBeUndefined();
    });

    it('round-trips facts and replaces them on save', async () => {
      const store = await create();
      await store.save(base());
      expect((await store.load())?.facts).toEqual(base().facts);
      await store.save(FactBase.empty());
      expect((await store.load())?.facts).toEqual([]);
    });
  });
}

export function configStoreContract(name: string, create: Factory<ConfigStore>): void {
  describe(`ConfigStore contract: ${name}`, () => {
    it('is empty until saved, then returns what was saved', async () => {
      const store = await create();
      expect(await store.load()).toBeUndefined();
      const changed = setConfigValue(defaultConfig(), 'scoring.applyThreshold', '65');
      const config: Config = changed.ok ? { ...changed.value, version: 2 } : defaultConfig();
      await store.save(config);
      expect(await store.load()).toEqual(config);
    });
  });
}

export function secretStoreContract(name: string, create: Factory<SecretStore>): void {
  describe(`SecretStore contract: ${name}`, () => {
    it('has no key until one is created, then always returns the same 32 bytes', async () => {
      const store = await create();
      expect(await store.load()).toBeUndefined();
      const key = await store.loadOrCreate();
      expect(key).toHaveLength(32);
      expect(await store.loadOrCreate()).toEqual(key);
      expect(await store.load()).toEqual(key);
    });

    it('does not hand out an all-zero key', async () => {
      const key = await (await create()).loadOrCreate();
      expect(key.some((b) => b !== 0)).toBe(true);
    });
  });
}
