import { defaultConfig, type Config } from '../../src/domain/config/config.js';
import { FactBase } from '../../src/domain/facts/fact-base.js';
import type { LogEntry } from '../../src/domain/log/chain.js';
import { sha256 } from '../../src/domain/shared/sha256.js';
import { AppError } from '../../src/application/errors.js';
import type {
  Clock,
  ConfigStore,
  ConfirmRequest,
  Deps,
  EvidenceChecker,
  EvidenceDigest,
  FactStore,
  FactsHandle,
  FileSink,
  LogStore,
  ObjectStore,
  Prompt,
  SecretStore,
} from '../../src/application/ports/index.js';

/** A clock that only moves when a test says so. */
export class FixedClock implements Clock {
  constructor(private current = '2026-10-31T10:00:00.000Z') {}

  now(): string {
    return this.current;
  }

  set(timestamp: string): void {
    this.current = timestamp;
  }
}

export class InMemoryLogStore implements LogStore {
  entries: LogEntry[] = [];

  async readAll(): Promise<LogEntry[]> {
    return [...this.entries];
  }

  async append(build: (previous: LogEntry | undefined) => LogEntry): Promise<LogEntry> {
    const entry = build(this.entries.at(-1));
    this.entries.push(entry);
    return entry;
  }
}

export class InMemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, string>();

  async put(content: string): Promise<string> {
    const digest = sha256(content);
    this.objects.set(digest, content);
    return digest;
  }

  async get(digest: string): Promise<string | undefined> {
    const content = this.objects.get(digest);
    if (content !== undefined && sha256(content) !== digest) throw new AppError('io', `object ${digest} is corrupt`);
    return content;
  }
}

export class InMemoryConfigStore implements ConfigStore {
  constructor(public current: Config | undefined = undefined) {}

  async load(): Promise<Config | undefined> {
    return this.current;
  }

  async save(config: Config): Promise<void> {
    this.current = config;
  }
}

/** A fixed or generated key; `key` is undefined until something needs it. */
export class InMemorySecretStore implements SecretStore {
  constructor(public key: Uint8Array | undefined = undefined) {}

  async load(): Promise<Uint8Array | undefined> {
    return this.key;
  }

  async loadOrCreate(): Promise<Uint8Array> {
    this.key ??= new Uint8Array(32).map((_, i) => (i * 7 + 13) % 256);
    return this.key;
  }
}

export class InMemoryFactStore implements FactStore {
  constructor(
    public base: FactBase | undefined = undefined,
    readonly location = '/memory/facts.json',
  ) {}

  async load(): Promise<FactBase | undefined> {
    return this.base;
  }

  async save(base: FactBase): Promise<void> {
    this.base = base;
  }
}

/** Evidence files are a map from reference to content. */
export class FakeEvidence implements EvidenceChecker {
  constructor(readonly files = new Map<string, string>()) {}

  async digestOf(reference: string): Promise<EvidenceDigest> {
    const content = this.files.get(reference);
    return content === undefined ? { ok: false, reason: 'no such file' } : { ok: true, digest: sha256(content) };
  }
}

export class ScriptedPrompt implements Prompt {
  readonly requests: ConfirmRequest[] = [];

  constructor(public answer = true) {}

  async confirm(request: ConfirmRequest): Promise<boolean> {
    this.requests.push(request);
    return this.answer;
  }
}

export class MemorySink implements FileSink {
  readonly files = new Map<string, string>();

  async write(path: string, content: string, options: { readonly overwrite: boolean }): Promise<void> {
    if (this.files.has(path) && !options.overwrite) throw new AppError('refused', `${path} already exists`);
    this.files.set(path, content);
  }
}

export interface Harness extends Deps {
  readonly clockFake: FixedClock;
  readonly logFake: InMemoryLogStore;
  readonly objectsFake: InMemoryObjectStore;
  readonly configFake: InMemoryConfigStore;
  readonly secretsFake: InMemorySecretStore;
  readonly promptFake: ScriptedPrompt;
  readonly sinkFake: MemorySink;
  readonly factStore: InMemoryFactStore;
  readonly evidenceFake: FakeEvidence;
}

/** All ports in memory. `facts(path)` always returns the same single store, whatever the path. */
export function harness(options: { readonly facts?: FactBase; readonly config?: Config } = {}): Harness {
  const clock = new FixedClock();
  const log = new InMemoryLogStore();
  const objects = new InMemoryObjectStore();
  const config = new InMemoryConfigStore(options.config);
  const secrets = new InMemorySecretStore();
  const prompt = new ScriptedPrompt();
  const sink = new MemorySink();
  const factStore = new InMemoryFactStore(options.facts);
  const evidence = new FakeEvidence();
  const handle: FactsHandle = { store: factStore, evidence };
  return {
    clock,
    log,
    objects,
    config,
    secrets,
    prompt,
    sink,
    facts: () => handle,
    clockFake: clock,
    logFake: log,
    objectsFake: objects,
    configFake: config,
    secretsFake: secrets,
    promptFake: prompt,
    sinkFake: sink,
    factStore,
    evidenceFake: evidence,
  };
}

export { defaultConfig };
